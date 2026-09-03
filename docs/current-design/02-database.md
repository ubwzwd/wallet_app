# 02 — 数据库设计（现状）

> 本文回答的问题：这个后端"现在"是怎么连数据库、怎么建表、每张表长什么样、哪些数据规则真的由数据库兜底、哪些只靠应用代码、哪些完全没有人管；索引服务于哪些查询；Alembic 迁移链是怎么走到今天的；测试到底在什么样的库上跑；一条交易从创建到删除在数据库里经历了什么；金额、UUID、时间字段在 Postgres 与 SQLite 上分别是什么类型、时区怎么处理。所有陈述都以仓库当前代码为准，并带有 `(路径:行号)` 引用；本文只描述现状，不做设计建议。

## 0. 总览：技术栈与 schema 的来源

| 项目 | 现状 | 证据 |
|---|---|---|
| ORM | SQLAlchemy 2.0.44（锁定版本），使用同步引擎（sync engine） | (backend/poetry.lock:1455-1456)、(backend/pyproject.toml:13) |
| 迁移工具 | Alembic 1.17.0 | (backend/poetry.lock:4-5)、(backend/pyproject.toml:14) |
| Postgres 驱动 | psycopg2-binary 2.9.11；`postgresql://` 无后缀 URL 即选中 psycopg2 | (backend/poetry.lock:946-947)、(backend/pyproject.toml:21) |
| 生产 / 开发 compose 数据库 | `postgres:15-alpine` | (infra/docker-compose.dev.yml:3)、(infra/docker-compose.prod.yml:7) |
| 本机开发当前使用 | SQLite 文件 `backend/wallet_dev.db`（`DATABASE_URL=sqlite:///./wallet_dev.db`） | (backend/.env:1) |
| 初始化 SQL | 不存在。仓库内没有任何 `*.sql` 文件，两个 compose 文件都没有挂载 `docker-entrypoint-initdb.d` | `find . -name "*.sql"` 与 `grep -rn initdb infra/ backend/` 均为空 |
| schema 来源 | 生产：Alembic 迁移链（`alembic upgrade head`）；测试：`Base.metadata.create_all`；本机 SQLite 文件：也是从 ORM 元数据建出来的（见 §6 说明） | (infra/docker-compose.prod.yml:40)、(backend/tests/conftest.py:67) |

四张表：`users`、`finance_sources`（资金账户，finance source）、`transactions`（交易）、`transaction_tags`（交易标签）。模型文件位于 `backend/app/models/`，由 `backend/app/models/__init__.py` 统一导入注册 (backend/app/models/__init__.py:5-9)。

---

## 1. 引擎与会话（engine / session）

### 1.1 `DATABASE_URL` 从哪里来

| 来源 | 值 | 证据 |
|---|---|---|
| 代码默认值 | `postgresql://wallet_user:wallet_password@localhost:5432/wallet_db` | (backend/app/core/config.py:12) |
| 配置加载器 | pydantic-settings：先读进程环境变量，再读当前工作目录下的 `.env`；键区分大小写；允许未知键（`extra="allow"`） | (backend/app/core/config.py:33-38) |
| `backend/env.example`（模板） | `postgresql://wallet_user:wallet_password@localhost:5432/wallet_db` | (backend/env.example:2) |
| `backend/.env`（被 gitignore） | `sqlite:///./wallet_dev.db`，相对当前工作目录，即 `backend/wallet_dev.db` | (backend/.env:1)、(backend/.gitignore:31) |
| `infra/.env.example`（生产 compose 模板） | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`，主机名是 compose 服务名 `db` | (infra/.env.example:17) |
| 测试 | 在导入任何 `app` 模块之前执行 `os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")`；环境变量优先级高于 `.env` | (backend/tests/conftest.py:9-11) |

运行镜像里安装了 `libpq5` 供 psycopg2 使用 (infra/Dockerfile.api:56)；`sqlite://` 走标准库 `sqlite3`。

### 1.2 引擎构造（`backend/app/core/database.py`）

引擎是**同步**的 SQLAlchemy 引擎，在模块导入时创建一次 (backend/app/core/database.py:33)。构造参数按 URL 前缀分两套 (backend/app/core/database.py:19-30)：

| 参数 | Postgres（任何不以 `sqlite` 开头的 URL） | SQLite | 证据 |
|---|---|---|---|
| `echo` | `settings.ENVIRONMENT == "development" and settings.DEBUG` | 同左 | (backend/app/core/database.py:20-22)；默认 `DEBUG=False`、`ENVIRONMENT="development"` (backend/app/core/config.py:22,31)；本机 `backend/.env` 设了 `DEBUG=True` 和 `ENVIRONMENT=development`，因此本机会打印 SQL (backend/.env:7,10) |
| `pool_pre_ping` | `True`（复用连接前先 `SELECT 1`） | 不设置 | (backend/app/core/database.py:24) |
| `pool_recycle` | `3600` 秒 | 不设置 | (backend/app/core/database.py:25)；文件头注释说明这是 03-03 诊断之后加的"defence-in-depth" (backend/app/core/database.py:10-16) |
| `pool_size` | `5` | 不设置 | (backend/app/core/database.py:26) |
| `max_overflow` | `10` | 不设置 | (backend/app/core/database.py:27) |
| `connect_args` | 不设置 | `{"check_same_thread": False}` | (backend/app/core/database.py:28-30) |

由此产生的事实：

- Postgres 使用 SQLAlchemy 默认的 `QueuePool`：5 个常驻 + 10 个溢出 = **每个 API 进程最多 15 个连接**。API 容器只跑一个 `uvicorn` 进程、没有 `--workers` (infra/Dockerfile.api:78)；生产 Postgres 以 `max_connections=50` 启动 (infra/docker-compose.prod.yml:21-22)。
- SQLite：文件型 URL 得到 SQLAlchemy 2.0 默认的 `QueuePool`；`sqlite:///:memory:` 得到 `SingletonThreadPool`（本机用 SQLAlchemy 2.0.x 实例化引擎验证）。`pool_size` / `max_overflow` 对 SQLite 不传，因为内存库的池类不接受这些参数（代码注释 (backend/app/core/database.py:18)）。
- 后端任何地方都**没有**执行 `PRAGMA foreign_keys=ON`（`grep -rn PRAGMA backend/ --include=*.py` 为空）。因此当应用跑在 SQLite 上时，**外键、`ON DELETE CASCADE`、`ON DELETE SET NULL` 都不生效**（SQLite 默认 `PRAGMA foreign_keys = 0`；以只读方式打开 `backend/wallet_dev.db` 查询 `PRAGMA foreign_keys` 返回 0）。

### 1.3 会话工厂与 `get_db`

```python
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)   # backend/app/core/database.py:36-40
Base = declarative_base()                                                     # backend/app/core/database.py:43

def get_db():                                                                 # backend/app/core/database.py:46-57
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- 每个 HTTP 请求一个 `Session`；`get_db` 自身既不 commit 也不 rollback，路由函数显式调用 `db.commit()`；`close()` 把连接还回池（未提交的事务随之回滚）。
- `autoflush=False`：查询之前不会自动 flush 待写对象。需要拿到新生成主键的路由要显式 `db.flush()`（例如 (backend/app/api/transactions.py:103)），因为 `id` 的默认值是 Python 侧的 `uuid.uuid4` 可调用对象，只在 INSERT 时求值。
- `expire_on_commit` 保持默认值 `True`：commit 之后对象全部过期，下次访问属性会重新 SELECT。这就是路由在 commit 后调用 `db.refresh(...)` 的原因（(backend/app/api/transactions.py:115,387)、(backend/app/api/finance_sources.py:41,133)、(backend/app/api/auth.py:51,132)），也是 `update_current_user` 在会话关闭前逐个触碰所有字段的原因 (backend/app/api/auth.py:134-136)。
- `get_current_user` 也依赖 `get_db` (backend/app/core/security.py:83-86)。FastAPI 在同一请求内缓存依赖结果，所以鉴权依赖和路由函数共用同一个 `Session` 实例。
- 没有任何地方设置 `server_default` 或 `onupdate`（`grep -rn "server_default\|onupdate\|expire_on_commit" backend/app` 为空）。

### 1.4 Alembic 环境（`backend/migrations/env.py`、`backend/alembic.ini`）

- `alembic.ini`：`script_location = %(here)s/migrations`，`prepend_sys_path = .` (backend/alembic.ini:8,19)；`sqlalchemy.url` 是占位符 `driver://user:pass@localhost/dbname` (backend/alembic.ini:87)。
- `env.py`：把 `backend/` 加进 `sys.path`，导入 `settings` 和 `Base`（后者通过 `app.models` 导入全部四个模型），然后用 `settings.DATABASE_URL` 覆盖 `sqlalchemy.url` (backend/migrations/env.py:11-22)。`target_metadata = Base.metadata` (backend/migrations/env.py:31)，因此支持 autogenerate。
- 在线模式用 `poolclass=pool.NullPool` 建引擎，整个 `run_migrations()` 包在一个 `context.begin_transaction()` 里，且没有设置 `transaction_per_migration`（Alembic 默认 `False`） (backend/migrations/env.py:70-82)。因此在 Postgres（支持事务性 DDL）上，一次 `alembic upgrade head` 中待执行的**全部** revision 处于同一个事务中：任一 revision 失败则整批回滚，`alembic_version` 不前进；并不是逐个 revision 单独提交。
- 生产环境由一次性的 `migrate` 容器执行迁移：与 API 同一镜像，`command: ["alembic", "upgrade", "head"]`，在 `db` 健康后启动；`api` 容器要等 `migrate` 以 0 退出才启动 (infra/docker-compose.prod.yml:33-53)。镜像 `WORKDIR` 是 `/app`，`alembic.ini` 与 `migrations/` 随 `COPY . .` 进入镜像 (infra/Dockerfile.api:63,68)。运维手册描述的启动顺序是 `db -> migrate -> api -> caddy` (infra/RUNBOOK.md:543)。
- 本机开发文档同样让开发者执行 `poetry run alembic upgrade head` (backend/README.md:61)，但本机实际使用的 SQLite 文件并不是迁移建出来的（原因见 §6）。

---

## 2. 表结构

所有模型继承 `backend/app/core/database.py:43` 的 `Base`，由 (backend/app/models/__init__.py:5-9) 注册。`users`、`finance_sources`、`transactions` 三张表的主键都是单列 `sqlalchemy.Uuid()`，Python 侧默认值 `uuid.uuid4`（没有 server default）；`transaction_tags` 使用复合主键 `(transaction_id Uuid, tag String(64))`，两列都没有默认值，由路由显式赋值 (backend/app/models/transaction_tag.py:13-18)。`Uuid()` 是在提交 `78b7c10`（2026-04-17，`fix(backend): use SQLAlchemy Uuid() for SQLite compatibility`）中替换掉 `sqlalchemy.dialects.postgresql.UUID` 的，目的是兼容 SQLite (.planning/phases/02-complete-transfer-transactions/02-02-SUMMARY.md:44)。

下表中"Postgres 类型"和"SQLite 类型"是 SQLAlchemy 2.0 用 `CreateTable(...)` 为两种方言编译 `Base.metadata` 得到的 DDL（本机验证；SQLite 列与 `backend/wallet_dev.db` 的 `sqlite_master` 一致，见 §2.6）。"默认值"是 Python 侧默认值。

### 2.1 `users`（`backend/app/models/user.py`）

| 列 | SQLAlchemy | Postgres | SQLite | 可空 | 默认值 | 键 | 索引 | 唯一 | 代码注释 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| `id` | `Uuid()` | `UUID` | `CHAR(32)` | NOT NULL | `uuid.uuid4` | PK | (PK) | — | — | (backend/app/models/user.py:16) |
| `email` | `String` | `VARCHAR` | `VARCHAR` | NOT NULL | — | — | `ix_users_email`（唯一索引） | 是 | — | (backend/app/models/user.py:17) |
| `password_hash` | `String` | `VARCHAR` | `VARCHAR` | NOT NULL | — | — | — | — | 存 bcrypt 哈希，由 `get_password_hash` 生成 (backend/app/core/security.py:33-37) | (backend/app/models/user.py:18) |
| `base_currency` | `String(3)` | `VARCHAR(3)` | `VARCHAR(3)` | NOT NULL | `"USD"` | — | — | — | `# ISO 4217 code` | (backend/app/models/user.py:19) |
| `default_source_id` | `Uuid()` | `UUID` | `CHAR(32)` | NULL | — | FK -> `finance_sources.id`，**ON DELETE SET NULL** | 无 | — | — | (backend/app/models/user.py:20) |
| `created_at` | `DateTime` | `TIMESTAMP WITHOUT TIME ZONE` | `DATETIME` | NOT NULL | `datetime.utcnow` | — | — | — | — | (backend/app/models/user.py:21) |

ORM relationship (backend/app/models/user.py:24-26)：

| 属性 | 目标 | `back_populates` | `cascade` | `lazy` | 备注 |
|---|---|---|---|---|---|
| `finance_sources` | `FinanceSource`（一对多） | `user` | `all, delete-orphan` | `select`（默认） | 显式 `foreign_keys="[FinanceSource.user_id]"`，因为两表之间存在两条外键路径 |
| `default_source` | `FinanceSource`（多对一，`uselist=False`） | 无 | 默认（`save-update, merge`） | `select` | `foreign_keys=[default_source_id]`；没有 delete 级联 |
| `transactions` | `Transaction`（一对多） | `user` | `all, delete-orphan` | `select` | — |

### 2.2 `finance_sources`（`backend/app/models/finance_source.py`）

| 列 | SQLAlchemy | Postgres | SQLite | 可空 | 默认值 | 键 | 索引 | 唯一 | 代码注释 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| `id` | `Uuid()` | `UUID` | `CHAR(32)` | NOT NULL | `uuid.uuid4` | PK | (PK) | — | — | (backend/app/models/finance_source.py:16) |
| `user_id` | `Uuid()` | `UUID` | `CHAR(32)` | NOT NULL | — | FK -> `users.id`（无 `ondelete`，即 NO ACTION） | `ix_finance_sources_user_id` | — | — | (backend/app/models/finance_source.py:17) |
| `name` | `String` | `VARCHAR` | `VARCHAR` | NOT NULL | — | — | — | — | `# e.g., "Chase Checking", "Amex Credit"` | (backend/app/models/finance_source.py:18) |
| `type` | `String(32)` | `VARCHAR(32)` | `VARCHAR(32)` | NOT NULL | — | — | — | — | `# checking, savings, credit, other`；没有 CHECK 约束 | (backend/app/models/finance_source.py:19) |
| `default_currency` | `String(3)` | `VARCHAR(3)` | `VARCHAR(3)` | NOT NULL | — | — | — | — | `# ISO 4217 code` | (backend/app/models/finance_source.py:20) |
| `archived` | `Boolean` | `BOOLEAN` | `BOOLEAN`（实际存 0/1） | NOT NULL | `False` | — | — | — | — | (backend/app/models/finance_source.py:21) |
| `created_at` | `DateTime` | `TIMESTAMP WITHOUT TIME ZONE` | `DATETIME` | NOT NULL | `datetime.utcnow` | — | — | — | — | (backend/app/models/finance_source.py:22) |

ORM relationship (backend/app/models/finance_source.py:25-26)：

| 属性 | 目标 | `back_populates` | `cascade` | `lazy` | 备注 |
|---|---|---|---|---|---|
| `user` | `User`（多对一） | `finance_sources` | 默认 | `select` | `foreign_keys=[user_id]` |
| `transactions` | `Transaction`（一对多） | `source` | `all, delete-orphan` | `select` | — |

### 2.3 `transactions`（`backend/app/models/transaction.py`）

| 列 | SQLAlchemy | Postgres | SQLite | 可空 | 默认值 | 键 | 索引 | 唯一 | 代码注释 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| `id` | `Uuid()` | `UUID` | `CHAR(32)` | NOT NULL | `uuid.uuid4` | PK | (PK) | — | — | (backend/app/models/transaction.py:16) |
| `user_id` | `Uuid()` | `UUID` | `CHAR(32)` | NOT NULL | — | FK -> `users.id`（无 `ondelete`） | `ix_transactions_user_id` | — | — | (backend/app/models/transaction.py:17) |
| `source_id` | `Uuid()` | `UUID` | `CHAR(32)` | NOT NULL | — | FK -> `finance_sources.id`（无 `ondelete`） | `ix_transactions_source_id` | — | — | (backend/app/models/transaction.py:18) |
| `amount` | `Numeric(18, 4)` | `NUMERIC(18, 4)` | `NUMERIC(18, 4)`（实际按 REAL / INTEGER 亲和性存储） | NOT NULL | — | — | — | — | `# Original amount`；正负号表示收入 / 支出 | (backend/app/models/transaction.py:19) |
| `currency` | `String(3)` | `VARCHAR(3)` | `VARCHAR(3)` | NOT NULL | — | — | — | — | `# ISO 4217 code` | (backend/app/models/transaction.py:20) |
| `occurred_at` | `Date` | `DATE` | `DATE` | NOT NULL | — | — | `ix_transactions_occurred_at` | — | `# Transaction date` | (backend/app/models/transaction.py:21) |
| `description` | `String` | `VARCHAR` | `VARCHAR` | NULL | — | — | — | — | — | (backend/app/models/transaction.py:22) |
| `merchant` | `String` | `VARCHAR` | `VARCHAR` | NULL | — | — | — | — | — | (backend/app/models/transaction.py:23) |
| `transfer_pair_id` | `Uuid()` | `UUID` | `CHAR(32)` | NULL | — | **没有外键** | `ix_transactions_transfer_pair_id`（ORM 命名；Alembic 建出的库叫 `idx_transactions_transfer_pair`，见 §5） | — | `# Links paired transfer transactions` | (backend/app/models/transaction.py:24) |
| `created_at` | `DateTime` | `TIMESTAMP WITHOUT TIME ZONE` | `DATETIME` | NOT NULL | `datetime.utcnow` | — | — | — | — | (backend/app/models/transaction.py:25) |

ORM relationship (backend/app/models/transaction.py:28-30)：

| 属性 | 目标 | `back_populates` | `cascade` | `lazy` | 备注 |
|---|---|---|---|---|---|
| `user` | `User`（多对一） | `transactions` | 默认 | `select` | — |
| `source` | `FinanceSource`（多对一） | `transactions` | 默认 | `select` | — |
| `tags` | `TransactionTag`（一对多） | `transaction` | `all, delete-orphan` | `select` | 每次读取 `tx.tags` 都是一条额外 SELECT，例如列表接口逐条读取 (backend/app/api/transactions.py:268) |

### 2.4 `transaction_tags`（`backend/app/models/transaction_tag.py`）

| 列 | SQLAlchemy | Postgres | SQLite | 可空 | 默认值 | 键 | 索引 | 唯一 | 代码注释 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| `transaction_id` | `Uuid()` | `UUID` | `CHAR(32)` | NOT NULL | — | 复合 PK 的一部分；FK -> `transactions.id`，**ON DELETE CASCADE** | (PK) | — | — | (backend/app/models/transaction_tag.py:13) |
| `tag` | `String(64)` | `VARCHAR(64)` | `VARCHAR(64)` | NOT NULL | — | 复合 PK 的一部分 | (PK) | — | — | (backend/app/models/transaction_tag.py:14) |

表级定义：`PrimaryKeyConstraint('transaction_id', 'tag')`，以及表注释 `'Transaction tags for flexible categorization'` (backend/app/models/transaction_tag.py:17-20)；在 Postgres 上会生成 `COMMENT ON TABLE transaction_tags IS ...`。这是唯一一张带注释的表。**没有独立的 `tags` 字典表**——一个标签只以本表的行的形式存在。

ORM relationship (backend/app/models/transaction_tag.py:23)：`transaction` -> `Transaction`（多对一），`back_populates="tags"`，默认 cascade，`lazy="select"`。

### 2.5 由 ORM 元数据为 Postgres 生成的 DDL

以下是用 SQLAlchemy 2.0 对 `Base.metadata` 编译出的 Postgres DDL（本机验证）：

```sql
CREATE TABLE users (
    id UUID NOT NULL,
    email VARCHAR NOT NULL,
    password_hash VARCHAR NOT NULL,
    base_currency VARCHAR(3) NOT NULL,
    default_source_id UUID,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(default_source_id) REFERENCES finance_sources (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE TABLE finance_sources (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    name VARCHAR NOT NULL,
    type VARCHAR(32) NOT NULL,
    default_currency VARCHAR(3) NOT NULL,
    archived BOOLEAN NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE INDEX ix_finance_sources_user_id ON finance_sources (user_id);

CREATE TABLE transactions (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    source_id UUID NOT NULL,
    amount NUMERIC(18, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    occurred_at DATE NOT NULL,
    description VARCHAR,
    merchant VARCHAR,
    transfer_pair_id UUID,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES users (id),
    FOREIGN KEY(source_id) REFERENCES finance_sources (id)
);
CREATE INDEX ix_transactions_user_id ON transactions (user_id);
CREATE INDEX ix_transactions_source_id ON transactions (source_id);
CREATE INDEX ix_transactions_occurred_at ON transactions (occurred_at);
CREATE INDEX ix_transactions_transfer_pair_id ON transactions (transfer_pair_id);

CREATE TABLE transaction_tags (
    transaction_id UUID NOT NULL,
    tag VARCHAR(64) NOT NULL,
    PRIMARY KEY (transaction_id, tag),
    FOREIGN KEY(transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
);
COMMENT ON TABLE transaction_tags IS 'Transaction tags for flexible categorization';
```

`users.default_source_id -> finance_sources.id` 与 `finance_sources.user_id -> users.id` 构成环。实际执行 `Base.metadata.create_all` 时（用 mock Postgres 引擎验证），SQLAlchemy **不发出警告**：它先建四张表，再把这两条环上的外键作为单独的 `ALTER TABLE finance_sources ADD FOREIGN KEY(user_id) REFERENCES users (id)` 与 `ALTER TABLE users ADD FOREIGN KEY(default_source_id) REFERENCES finance_sources (id) ON DELETE SET NULL` 补上。只有直接访问 `Base.metadata.sorted_tables` 时才会得到 `SAWarning: Cannot correctly sort tables; there are unresolvable cycles between tables "finance_sources, users"`。在 SQLite 上外键保持内联（SQLite 建表时不校验被引用表是否存在）。`Base.metadata.drop_all` 在 Postgres 上抛 `CircularDependencyError: Can't sort tables for DROP; an unresolvable foreign key dependency exists between tables: finance_sources, users`（因为外键未命名、无法先 drop 约束），在 SQLite 上只发警告并成功（见 §7）。

### 2.6 本机 SQLite 文件里的实际 DDL

只读打开 `backend/wallet_dev.db` 读取 `sqlite_master` 得到：

```sql
CREATE TABLE users (
    id CHAR(32) NOT NULL, email VARCHAR NOT NULL, password_hash VARCHAR NOT NULL,
    base_currency VARCHAR(3) NOT NULL, default_source_id CHAR(32), created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(default_source_id) REFERENCES finance_sources (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX ix_users_email ON users (email);
CREATE TABLE finance_sources (
    id CHAR(32) NOT NULL, user_id CHAR(32) NOT NULL, name VARCHAR NOT NULL, type VARCHAR(32) NOT NULL,
    default_currency VARCHAR(3) NOT NULL, archived BOOLEAN NOT NULL, created_at DATETIME NOT NULL,
    PRIMARY KEY (id), FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE INDEX ix_finance_sources_user_id ON finance_sources (user_id);
CREATE TABLE transactions (
    id CHAR(32) NOT NULL, user_id CHAR(32) NOT NULL, source_id CHAR(32) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL, currency VARCHAR(3) NOT NULL, occurred_at DATE NOT NULL,
    description VARCHAR, merchant VARCHAR, transfer_pair_id CHAR(32), created_at DATETIME NOT NULL,
    PRIMARY KEY (id), FOREIGN KEY(user_id) REFERENCES users (id), FOREIGN KEY(source_id) REFERENCES finance_sources (id)
);
CREATE INDEX ix_transactions_user_id ON transactions (user_id);
CREATE INDEX ix_transactions_source_id ON transactions (source_id);
CREATE INDEX ix_transactions_occurred_at ON transactions (occurred_at);
CREATE INDEX ix_transactions_transfer_pair_id ON transactions (transfer_pair_id);
CREATE TABLE transaction_tags (
    transaction_id CHAR(32) NOT NULL, tag VARCHAR(64) NOT NULL,
    PRIMARY KEY (transaction_id, tag),
    FOREIGN KEY(transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
);
```

该文件没有 `alembic_version` 表；当前数据量：`users` 1 行、`finance_sources` 2 行、`transactions` 2 行、`transaction_tags` 4 行（其中 2 行引用的交易已不存在，见 §8.4）。

---

## 3. 实体关系图（ER）

```
                           1                                   N
 +----------------------------+   users.id = finance_sources.user_id   +-------------------------------+
 | users                      |--------------------------------------->| finance_sources               |
 |----------------------------|            (FK, NO ACTION)             |-------------------------------|
 | PK id              UUID    |                                        | PK id              UUID       |
 |    email           VARCHAR | UNIQUE (ix_users_email)                | FK user_id         UUID  NN   | ix_finance_sources_user_id
 |    password_hash   VARCHAR |                                        |    name            VARCHAR NN |
 |    base_currency   VC(3)   | 默认 'USD'                             |    type            VC(32) NN  |
 | FK default_source_id UUID  |---------------------------------------->|    default_currency VC(3) NN  |
 |    created_at      TS      |   0..1 -> 1   (FK, ON DELETE SET NULL)  |    archived        BOOL  NN   | 默认 false
 +----------------------------+                                        |    created_at      TS    NN   |
        | 1                                                            +-------------------------------+
        |                                                                       | 1
        | users.id = transactions.user_id (FK, NO ACTION)                       | finance_sources.id = transactions.source_id
        |                                                                       | (FK, NO ACTION)
        | N                                                                     | N
 +---------------------------------------------------------------------------------------------+
 | transactions                                                                                |
 |---------------------------------------------------------------------------------------------|
 | PK id                UUID                                                                   |
 | FK user_id           UUID   NN   ix_transactions_user_id                                    |
 | FK source_id         UUID   NN   ix_transactions_source_id                                  |
 |    amount            NUMERIC(18,4) NN   (正负号 = 方向; 无 CHECK)                            |
 |    currency          VC(3)  NN                                                              |
 |    occurred_at       DATE   NN   ix_transactions_occurred_at                                |
 |    description       VARCHAR                                                                |
 |    merchant          VARCHAR                                                                |
 |    transfer_pair_id  UUID        ix_transactions_transfer_pair_id   (无 FK —— 由客户端生成、  |
 |                                  两条转账腿共用的自由 UUID)                                    |
 |    created_at        TS     NN                                                              |
 +---------------------------------------------------------------------------------------------+
        | 1
        | transactions.id = transaction_tags.transaction_id  (FK, ON DELETE CASCADE)
        | N
 +-------------------------------------------+
 | transaction_tags                          |  表注释: 'Transaction tags for flexible categorization'
 |-------------------------------------------|
 | PK,FK transaction_id  UUID   NN           |
 | PK    tag             VC(64) NN           |  (复合 PK => 同一交易内同一标签最多出现一次)
 +-------------------------------------------+

 图例: NN = NOT NULL, VC(n) = VARCHAR(n), TS = TIMESTAMP WITHOUT TIME ZONE (naive UTC),
       UUID 在 Postgres 上是原生 uuid, 在 SQLite 上是 CHAR(32) 十六进制。
```

---

## 4. 约束与不变量：数据库保证 / 应用层保证 / 无人保证

| 不变量 | 数据库是否保证 | 应用层是否保证 | 证据 |
|---|---|---|---|
| `users.email` 唯一 | **是** — 唯一索引 `ix_users_email`（按字节区分大小写；没有 `lower()` 或 citext） | 是，两道：注册前 `SELECT ... WHERE email = ?` 命中则 400 `"Email already registered"`；commit 时 `IntegrityError` 被捕获也映射为同一 400。另外 pydantic `EmailStr` 会把域名部分转小写、本地部分原样保留（本机用 pydantic 2.12 验证） | (backend/app/models/user.py:17)、(backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:44)、(backend/app/api/auth.py:32-37)、(backend/app/api/auth.py:48-57) |
| `email` 是合法邮箱 | 否（普通 `VARCHAR`） | 是 — 注册 / 登录 schema 用 `EmailStr`，失败时 FastAPI 返回 422 | (backend/app/schemas/user.py:10,17) |
| 密码至少 8 位、只存哈希 | 否 | 是 — `min_length=8`；存 bcrypt 哈希 | (backend/app/schemas/user.py:11)、(backend/app/core/security.py:33-37) |
| `base_currency` 是 3 字母 ISO 代码 | 否（Postgres 只限制 `VARCHAR(3)` 长度；SQLite 忽略长度） | 部分 — 注册 / PATCH 要求恰好 3 个字符（任意字符，无正则）并转大写；**不**对照 Frankfurter 币种列表校验 | (backend/app/schemas/user.py:12,35-40)、(backend/app/api/auth.py:45,124-126) |
| `transactions.currency`、`finance_sources.default_currency` 匹配 `^[A-Z]{3}$` | 否（Postgres 只限长度） | 是 — 创建 / 更新 schema 用 `CurrencyCode` 正则，落库前再 `.upper()`；不对照币种列表 | (backend/app/schemas/currency.py:9)、(backend/app/schemas/transaction.py:24-28,65-68)、(backend/app/schemas/finance_source.py:27-31)、(backend/app/api/transactions.py:95,369-370)、(backend/app/api/finance_sources.py:35) |
| `finance_sources.type` 只能是 checking、savings、credit、other 之一 | **否** — 只有 `VARCHAR(32)`，没有 CHECK | 是 — 创建 schema 的正则四选一（见下方代码块）；`type` 不在 `FinanceSourceUpdate` 里，PATCH 改不了 | (backend/app/models/finance_source.py:19)、(backend/app/schemas/finance_source.py:21-26,34-48) |
| `finance_sources.default_currency` 创建后不可改 | 不适用 | 是（靠省略）— `FinanceSourceUpdate` 只有 `name` 和 `archived` | (backend/app/schemas/finance_source.py:34-48)、(backend/app/api/finance_sources.py:127-130) |
| `amount` 的正负 / 非零 | **否** — 无 CHECK，任意符号，允许 0 | **否** — `TransactionCreate.amount` 只是 `Decimal` 加 `decimal_places=4`（没有 `gt` / `ne`）；"正数收入、负数支出"仅是文档约定。前端自己的表单拒绝 `<= 0`，转账时由前端把来源腿取负 | (backend/app/schemas/transaction.py:19-23)、(backend/app/api/transactions.py:62,94)、(frontend/src/screens/TransactionFormScreen.tsx:141-143,182) |
| `amount` 精度 | Postgres：`NUMERIC(18,4)`，最多 14 位整数、4 位小数，超出由 Postgres 报错（代码里没有对应的异常处理）；SQLite：按 REAL / INTEGER 存 | pydantic 拒绝超过 4 位小数（`decimal_places=4`），没有 `max_digits` | (backend/app/models/transaction.py:19)、(backend/app/schemas/transaction.py:19-23)、(backend/app/api/transactions.py:102-114)；`wallet_dev.db` 中 `amount = -13123` 的 `typeof` 是 `integer` |
| `transactions.source_id` 与 `transactions.user_id` 属于同一用户 | **否** — 外键只检查资金账户存在 | 是 — 创建时查 `FinanceSource.id == source_id AND user_id == current_user.id`，否则 404；`source_id` 不在 `TransactionUpdate` 里，PATCH 改不了 | (backend/app/api/transactions.py:78-88)、(backend/app/schemas/transaction.py:57-86) |
| `source_id` 必填 | **是** — NOT NULL | 是 — 缺省时回退到 `current_user.default_source_id`，仍为空则 400 | (backend/app/models/transaction.py:18)、(backend/app/api/transactions.py:70-76) |
| 已归档账户不能再记新交易 | 否 | **否** — 所有权检查不看 `archived` | (backend/app/api/transactions.py:79-82) |
| `users.default_source_id` 属于该用户 | **否** — 外键只检查存在 | 是 — `PATCH /auth/me` 校验所有权（404）；创建第一个资金账户时自动指向自己 | (backend/app/api/auth.py:113-120)、(backend/app/api/finance_sources.py:43-49) |
| `user_id` / `source_id` / `transaction_id` 外键的引用完整性 | **Postgres 上是**；**SQLite 上否**（没有 `PRAGMA foreign_keys=ON`；本机验证向 SQLite 插入悬空 `user_id` / `source_id` 的交易被接受） | 不适用 | `backend/app/core/database.py` 无 PRAGMA；`wallet_dev.db` 的 `PRAGMA foreign_keys` = 0 |
| 同一交易内标签唯一 | **是** — 复合主键 `(transaction_id, tag)`（Postgres、SQLite 都生效） | 标签会 `strip().lower()` 规范化但**不去重**；请求 `["Food","food"]` 在 commit 时违反主键 -> 未捕获的 `IntegrityError`（`UNIQUE constraint failed: transaction_tags.transaction_id, transaction_tags.tag`）-> HTTP 500（本机在内存 SQLite 上验证） | (backend/app/models/transaction_tag.py:17-19)、(backend/app/api/transactions.py:106-112,379-384) |
| 标签长度 <= 64 | **仅 Postgres**（`VARCHAR(64)` 超长报错 -> 500）；SQLite 任意长度都存（本机验证 100 字符标签成功写入） | **否** — `tags: List[str]` 没有单项长度限制 | (backend/app/models/transaction_tag.py:14)、(backend/app/schemas/transaction.py:46-50) |
| `description` <= 500、`merchant` <= 200、资金账户 `name` 1..100 字符 | 否（无长度的 `VARCHAR`） | 是 — pydantic `max_length` / `min_length` | (backend/app/schemas/transaction.py:34-45)、(backend/app/schemas/finance_source.py:14-20,37-43) |
| 转账对完整性（恰好两腿、符号相反、同一用户、同币种同日期、两腿都存在） | **否** — `transfer_pair_id` 是没有外键、没有唯一性、没有 CHECK 的自由 `UUID` | **否**（服务端）— 创建接口接受任意客户端给的 `transfer_pair_id`；PATCH 改不了它；DELETE 删除所有 `transfer_pair_id` 相同**且** `user_id` 相同的行。配对完全由客户端编排：`crypto.randomUUID()` -> POST 第一腿（`-abs`）-> POST 第二腿（`+abs`）-> 第二腿失败则 DELETE 第一腿 | (backend/app/models/transaction.py:24)、(backend/app/api/transactions.py:99,447-452)、(backend/app/schemas/transaction.py:51-54)、(frontend/src/screens/TransactionFormScreen.tsx:164,173,180-184,197-201,214) |
| `occurred_at` 取值范围 | 否 | 否（任何合法日期） | (backend/app/schemas/transaction.py:29-33) |
| `created_at` 只在插入时设置、不可变 | NOT NULL，但默认值只在 Python 侧——绕过 ORM 的原生 INSERT 不带它会失败 | 从不更新（没有 `onupdate`，也没有 `updated_at` 列） | (backend/app/models/user.py:21)、(backend/app/models/finance_source.py:22)、(backend/app/models/transaction.py:25) |
| PATCH 不能把非空列置空 | **是** — NOT NULL | **仅 `PATCH /transactions/{id}` 有保护**：`update_transaction` 对 `amount`、`currency`、`occurred_at` 跳过 `None`。`PATCH /auth/me` 收到显式 `{"base_currency": null}`、`PATCH /finance-sources/{id}` 收到显式 `{"name": null}` 或 `{"archived": null}` 时，`exclude_unset` 保留该键，路由直接 `setattr(..., None)` 并 commit，触发未捕获的 `IntegrityError`（NOT NULL 违反）-> HTTP 500 | (backend/app/api/transactions.py:364-371)、(backend/app/api/auth.py:122-131)、(backend/app/api/finance_sources.py:127-132) |
| 多租户隔离（只能看到自己的行） | 无行级安全（RLS） | 是 — 每条查询都带 `current_user.id` 过滤 | (backend/app/api/transactions.py:172,289-292,347-350,435-438)、(backend/app/api/finance_sources.py:65,85-88,115-118) |

`finance_sources.type` 的创建校验正则 (backend/app/schemas/finance_source.py:23)：

```python
pattern="^(checking|savings|credit|other)$"
```

---

## 5. 索引及其服务的查询

下表索引名是 ORM 命名（`index=True` -> `ix_<table>_<column>`）。Alembic 建出的 Postgres 库实际名字见表后说明。

| 索引 | 列 | 唯一 | 服务的查询 | 证据 |
|---|---|---|---|---|
| `users_pkey` | `users(id)` | PK | 每个需要鉴权的请求里 `get_current_user` 的查找（`WHERE users.id = :uuid`） | (backend/app/core/security.py:134) |
| `ix_users_email` | `users(email)` | **是** | 注册前的重复检查；登录 `authenticate_user`；同时承担邮箱唯一约束 | (backend/app/api/auth.py:32)、(backend/app/core/security.py:159) |
| `finance_sources_pkey` | `finance_sources(id)` | PK | 所有 `id == source_id AND user_id == ...` 的所有权检查 | (backend/app/api/finance_sources.py:85-88,115-118)、(backend/app/api/transactions.py:79-82,177-180)、(backend/app/api/auth.py:115-118) |
| `ix_finance_sources_user_id` | `finance_sources(user_id)` | 否 | `GET /finance-sources`（`WHERE user_id = ? [AND archived = false] ORDER BY created_at DESC`，`created_at` 无索引）；创建首个账户后的 `COUNT(*)` | (backend/app/api/finance_sources.py:65-70,44-46) |
| `transactions_pkey` | `transactions(id)` | PK | 按 id 的 get / patch / delete（与 `user_id` 过滤联用） | (backend/app/api/transactions.py:289-292,347-350,435-438) |
| `ix_transactions_user_id` | `transactions(user_id)` | 否 | `GET /transactions` 的基础过滤；转账批量删除（`transfer_pair_id = ? AND user_id = ?`） | (backend/app/api/transactions.py:172,449-452) |
| `ix_transactions_source_id` | `transactions(source_id)` | 否 | `GET /transactions?source_id=` 过滤 | (backend/app/api/transactions.py:186) |
| `ix_transactions_occurred_at` | `transactions(occurred_at)` | 否 | `from_date` / `to_date` 范围过滤；`ORDER BY occurred_at DESC, created_at DESC OFFSET ? LIMIT ?`（`limit` 上限 100）。没有 `(user_id, occurred_at)` 复合索引，`created_at` 无索引 | (backend/app/api/transactions.py:192,203,215,167-169) |
| `ix_transactions_transfer_pair_id` | `transactions(transfer_pair_id)` | 否 | 删除转账：`WHERE transfer_pair_id = ? AND user_id = ?` | (backend/app/api/transactions.py:449-452) |
| `transaction_tags_pkey` | `transaction_tags(transaction_id, tag)` | PK | `GET /transactions?tag=` 的内连接（`JOIN transaction_tags ... WHERE tag = lower(?)`）；替换标签时的 `DELETE ... WHERE transaction_id = ?`；`Transaction.tags` 的懒加载（每条交易一次 SELECT） | (backend/app/api/transactions.py:212,376,268) |
| （无） | `users(default_source_id)` | — | 只被 `ON DELETE SET NULL` 动作用到；应用没有按它查询 | (backend/app/models/user.py:20) |

**Alembic 建出的 Postgres 库**里索引和约束名与 ORM 命名不同：重命名迁移只改了表名和列名，Postgres 在 rename 时保留索引 / 约束原名 (backend/migrations/versions/026ee0aecb66_rename_accounts_to_finance_sources.py:24,27)：

| Postgres 上的对象（Alembic 路径） | ORM / `create_all` 的名字 | 来源 |
|---|---|---|
| `ix_accounts_user_id` on `finance_sources(user_id)` | `ix_finance_sources_user_id` | (backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:56) |
| `ix_transactions_account_id` on `transactions(source_id)` | `ix_transactions_source_id` | (backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:71) |
| `idx_transactions_transfer_pair` on `transactions(transfer_pair_id)` | `ix_transactions_transfer_pair_id` | (backend/migrations/versions/8a4f4d66d893_add_transfer_pair_id_to_transactions.py:30-34) |
| `fk_users_default_source`（有名字的外键） | 无名外键 | (backend/migrations/versions/76227e076393_add_default_source_to_users.py:30-35) |
| `accounts_pkey`、`accounts_user_id_fkey`、`transactions_account_id_fkey`（Postgres 按原表名 `accounts` 自动命名） | `finance_sources_pkey`、无名外键 | (backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:45-55,67) |

索引覆盖的列完全一致，查询计划不受影响；只有 `alembic check` / autogenerate 会报出名字差异。

---

## 6. 迁移历史

线性链，六个 revision 的文件头 `Create Date` 与首次提交日期都是 2025-10-28；当前 head 是 `8a4f4d66d893`。文件位于 `backend/migrations/versions/`。"SQLite 兼容"一列是用 Alembic 离线模式（`as_sql=True`）分别以 `sqlite` 和 `postgresql` 方言渲染每个操作得到的结论（本机验证）。

| # | Revision | `down_revision` | Create Date / 首次提交 | upgrade 做了什么 | downgrade | SQLite 兼容 |
|---|---|---|---|---|---|---|
| 1 | `e533c88884b7` "Initial schema: users, accounts, transactions, tags, exchange_rates" | `None` | 2025-10-28 17:08:28 / `b9e4403` | 建 `exchange_rates`（`id BIGINT` 自增 PK、`source VARCHAR(32)`、`base VARCHAR(3)`、`symbol VARCHAR(3)`、`rate NUMERIC(18,8)`、`date DATE`、唯一约束 `uix_base_symbol_date(base,symbol,date)`、索引 `ix_exchange_rates_date`、表注释）(:24-35)；建 `users`（`id UUID`、`email`、`password_hash`、`base_currency VARCHAR(3)`、`created_at`；唯一索引 `ix_users_email`）(:36-44)；建 `accounts`（`id`、`user_id` FK `users.id`、`name`、`type VARCHAR(32)`、`currency VARCHAR(3)`、`archived BOOLEAN`、`created_at`；索引 `ix_accounts_user_id`）(:45-56)；建 `transactions`（`id`、`user_id` FK、`account_id` FK `accounts.id`、`amount NUMERIC(18,4)`、`currency`、`occurred_at DATE`、`description`、`merchant`、`created_at`；索引 `ix_transactions_account_id`、`ix_transactions_occurred_at`、`ix_transactions_user_id`）(:57-73)；建 `transaction_tags`（复合 PK、FK `ON DELETE CASCADE`、表注释）(:74-80) | 逆序全部 drop (:87-97) | 是（纯 `CREATE TABLE` / `CREATE INDEX`） |
| 2 | `d671e51094c8` "Rename accounts.currency to default_currency" | `e533c88884b7` | 2025-10-28 17:12:27 / `b33986b` | `op.alter_column('accounts','currency', new_column_name='default_currency')` (:24) | 改回 (:30) | 是 — SQLite 方言渲染为 `ALTER TABLE accounts RENAME COLUMN currency TO default_currency`（需要 SQLite >= 3.25） |
| 3 | `5ca7fe6e37db` "Remove exchange_rates table - use real-time API instead" | `d671e51094c8` | 2025-10-28 17:30:56 / `a14797c` | drop 索引 `ix_exchange_rates_date` 与表 `exchange_rates` (:24-25) | 用带 Postgres 专属参数（`postgresql_include`、`postgresql_nulls_not_distinct`）的 `UniqueConstraint` 重建表 (:32-43) | upgrade 是；downgrade 带 Postgres 专属 kwargs |
| 4 | `026ee0aecb66` "rename_accounts_to_finance_sources" | `5ca7fe6e37db` | 2025-10-28 18:44:18 / `5670baf` | `op.rename_table('accounts','finance_sources')`；`op.alter_column('transactions','account_id', new_column_name='source_id')` (:24-27)。索引 / 约束保留旧名（见 §5） | 反向 (:33-36) | 是（`RENAME TO` / `RENAME COLUMN`） |
| 5 | `76227e076393` "add_default_source_to_users" | `026ee0aecb66` | 2025-10-28 19:02:50 / `c937a9c` | `op.add_column('users', Column('default_source_id', postgresql.UUID(as_uuid=True), nullable=True))` (:25-27)；`op.create_foreign_key('fk_users_default_source', 'users', 'finance_sources', ['default_source_id'], ['id'], ondelete='SET NULL')` (:30-35) | `drop_constraint` + `drop_column` (:41-44) | **否** — `create_foreign_key` 在非 batch 模式下，Alembic 的 SQLite 实现抛 `NotImplementedError("No support for ALTER of constraints in SQLite dialect. Please refer to the batch mode feature ...")`；downgrade 的 `drop_constraint` 同样。另外该文件从 Postgres 方言导入 `UUID` 类型 (:12) |
| 6 | `8a4f4d66d893` "add_transfer_pair_id_to_transactions"（**head**） | `76227e076393` | 2025-10-28 20:22:43 / `2b79f9b` | `op.add_column('transactions', Column('transfer_pair_id', postgresql.UUID(as_uuid=True), nullable=True))` (:25-27)；`op.create_index('idx_transactions_transfer_pair', 'transactions', ['transfer_pair_id'])` (:30-34) | drop 索引、drop 列 (:40-43) | 操作本身是（`ADD COLUMN` / `CREATE INDEX`）；类型从 Postgres 方言导入 (:12) |

说明：

- 迁移 1 里资金账户表叫 `accounts`、币种列叫 `currency`；ORM 对应的是迁移 2、4 之后的形态（`finance_sources.default_currency`、`transactions.source_id`），与 head schema 一致 (backend/app/models/finance_source.py:14,20)、(backend/app/models/transaction.py:18)。
- 迁移里 UUID 列声明为 `sa.UUID()` / `postgresql.UUID(as_uuid=True)`，模型里是 `sa.Uuid()`；三者在 Postgres 方言下都渲染为 `UUID`（本机编译验证），Postgres 上没有类型漂移。
- 因为迁移 5，**这条链无法在 SQLite 上跑完**。本机的 `backend/wallet_dev.db` 因此不是 Alembic 建的：它没有 `alembic_version` 表，索引名是 ORM 命名（`ix_transactions_transfer_pair_id`），即来自 `Base.metadata`。`backend/app/` 里没有 `create_all` 调用，仓库里唯一的一处在 (backend/tests/conftest.py:67)。
- 2025-10-28 之后没有新迁移，尽管模型在 2026-04-17（提交 `78b7c10`，`Uuid()` 类型替换）有过改动；该改动在 Postgres 上不改变 DDL。
- 运维手册规定 `wallet_pgdata_prod` 卷绝不能删（禁止 `docker compose down -v` 和 `docker volume rm wallet_pgdata_prod`），因为它承载全部用户数据 (infra/RUNBOOK.md:596,959-963)；手册里没有 `pg_dump` 或备份 / 恢复流程（`grep -n -i "pg_dump\|backup" infra/RUNBOOK.md` 为空）。

---

## 7. 测试如何建表（`backend/tests/conftest.py`）

1. 在导入任何 `app` 模块之前，用 `setdefault` 把 `DATABASE_URL=sqlite:///:memory:` 和一个测试用 `SECRET_KEY` 放进环境 (backend/tests/conftest.py:9-11)。环境变量优先于 `backend/.env`，所以测试不会碰 `wallet_dev.db`。注意 `app.core.database` 在导入时仍会用 `settings.DATABASE_URL` 建一个（测试中未使用的）引擎 (backend/app/core/database.py:33)。
2. 如果 `psycopg2` 不可导入，就用 `MagicMock` 顶替 `psycopg2`、`psycopg2.extensions`、`psycopg2.extras` 三个模块，避免环境里的 Postgres URL 让引擎创建失败 (backend/tests/conftest.py:32-38)。
3. 在模块导入时创建专用测试引擎 `create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})` 和 `sessionmaker(autocommit=False, autoflush=False)` (backend/tests/conftest.py:45-55)。池类是 `SingletonThreadPool`（每线程一条共享连接），这正是内存库能跨 fixture 存活的原因。
4. `create_tables`（session 作用域、`autouse=True`）显式导入 `app.models.user`、`app.models.finance_source`、`app.models.transaction`、`app.models.transaction_tag`，然后 `Base.metadata.create_all(bind=_test_engine)`；会话结束时 `drop_all` (backend/tests/conftest.py:58-69)。**测试从不运行 Alembic**，迁移脚本没有被任何测试执行过。`drop_all` 在 SQLite 上成功但发出 `SAWarning: Can't sort tables for DROP; an unresolvable foreign key dependency exists between tables: finance_sources, users; and backend does not support ALTER`（本机验证）。
5. `db_session` 打开一条连接、开一个外层事务、把 Session 绑到这条连接上；测试结束后关闭 Session 并**回滚外层事务** (backend/tests/conftest.py:72-83)。路由里会调用 `db.commit()`，但在 SQLAlchemy 2.0 默认的 `join_transaction_mode` 下 Session 不会提交外部开启的事务，所以测试期间写入的行在回滚后全部消失（本机验证：外层事务回滚后，已 commit 的用户查不到）。
6. `client` 用一个每次都 yield 该 fixture 会话的生成器覆盖 `get_db`，并包一层 `TestClient(app)` (backend/tests/conftest.py:86-104)。没有执行任何 `PRAGMA`。
7. 当前只有 `backend/tests/test_session_persistence.py` 使用 `client` fixture 真正访问数据库（注册 -> GET /auth/me -> PATCH -> GET）。其余测试都不触库：`test_auto_default_source.py`、`test_profile_structure.py`、`test_transactions_structure.py` 是读取源码文本做断言的"结构测试"（例如 (backend/tests/test_auto_default_source.py:1-8)）；`test_config.py` 只实例化 `Settings()` 检查 `DEBUG` 默认值与 SQL echo 门控 (backend/tests/test_config.py:6-19)；`test_conversion.py` 直接导入 `_build_conversion_fields` 并用 `unittest.mock.patch` 打桩汇率服务 (backend/tests/test_conversion.py:1-10)。

测试库与生产库的差异：

| 方面 | 测试 | 生产 |
|---|---|---|
| 引擎 | SQLite 内存库，`SingletonThreadPool`，单连接 | Postgres 15，`QueuePool` 5+10，`pool_pre_ping`，`pool_recycle=3600` |
| schema 来源 | `Base.metadata.create_all`（ORM 命名、无名外键、环上外键内联） | Alembic 链（`ix_accounts_user_id`、`idx_transactions_transfer_pair`、`fk_users_default_source`） |
| UUID 存储 | `CHAR(32)` 十六进制文本 | 原生 `UUID` |
| `NUMERIC(18,4)` | REAL / INTEGER 亲和性（浮点往返，读出时 SQLAlchemy 重建为 4 位小数的 `Decimal`） | 精确十进制，整数部分超过 14 位报错 |
| `VARCHAR(n)` 长度 | 不强制 | 强制（`VARCHAR(3)`、`VARCHAR(32)`、`VARCHAR(64)`） |
| 外键、`ON DELETE CASCADE`、`ON DELETE SET NULL` | **不强制**（`PRAGMA foreign_keys` = 0） | 强制 |
| PK / 唯一索引（`transaction_tags` 主键、`ix_users_email`） | 强制 | 强制 |
| 事务 | 每个测试一个外层事务，最后回滚 | 真实 commit |
| 并发 | 一条连接 | 连接池；服务端 `max_connections=50` |

规划文档记录了会话持久化修复只在 SQLite 上验证过，真实 Postgres 的验证被推迟到人工 UAT (.planning/phases/03-user-profile-management/03-HUMAN-UAT.md:26)。

---

## 8. 数据生命周期

所有删除都是**硬删除**；除了 `finance_sources.archived` 之外没有任何软删除标记，也没有 `updated_at` / `deleted_at` 列。下面每个流程都按"客户端动作 -> HTTP 请求 -> 服务端逐项检查 -> 数据库写入 -> 响应 -> 客户端状态"记述。所有需要鉴权的接口在进入路由前都先经过 `get_current_user`：Bearer 令牌解码失败、无 `sub`、或用户不存在时返回 401，`detail` 为 `"Could not validate credentials"` (backend/app/core/security.py:105-109,140-142)。请求体不满足 pydantic schema 时由 FastAPI 返回 422。路由前缀是 `/api/v1` (backend/app/main.py:27-30)。

### 8.1 用户（`users`）

**注册** — `POST /api/v1/auth/register` (backend/app/api/auth.py:20-62)：

1. 客户端提交 `{"email": "...", "password": "...", "base_currency": "usd"}`；schema 要求 `EmailStr`、密码 `min_length=8`、`base_currency` 恰好 3 个字符 (backend/app/schemas/user.py:8-12)。
2. 服务端 `SELECT ... FROM users WHERE email = ?`，命中则 400 `"Email already registered"` (backend/app/api/auth.py:32-37)。
3. 用 bcrypt 生成 `password_hash` (backend/app/api/auth.py:40)；构造 `User(email, password_hash, base_currency=upper())`，`id` 由 `uuid4` 生成，`default_source_id` 为 NULL，`created_at` 为 `utcnow()` (backend/app/api/auth.py:42-46)。
4. `db.add` + `db.commit` + `db.refresh`；commit 抛 `IntegrityError`（唯一索引冲突）则回滚并同样返回 400 `"Email already registered"` (backend/app/api/auth.py:48-57)。
5. 响应 201，`{"access_token": "<jwt>", "token_type": "bearer"}`，JWT 的 `sub` 是 `str(new_user.id)` (backend/app/api/auth.py:60-62)。
6. 客户端进入已登录状态。

**更新资料** — `PATCH /api/v1/auth/me` (backend/app/api/auth.py:101-138)，请求体 `UserUpdate` 只有 `base_currency` 和 `default_source_id` 两个可选字段 (backend/app/schemas/user.py:33-44)：

1. 若 `default_source_id` 不为 `None`，查 `finance_sources WHERE id = ? AND user_id = current_user.id`，查不到则 404 `"Finance source not found"` (backend/app/api/auth.py:114-120)。
2. `model_dump(exclude_unset=True)`：只处理请求里出现的键；显式的 `"default_source_id": null` 会保留键并把列置 NULL（上一步的所有权检查对 `None` 跳过） (backend/app/api/auth.py:122)。
3. `base_currency` 非空则转大写 (backend/app/api/auth.py:124-126)。
4. 逐字段 `setattr`，`db.commit()`，`db.refresh()`，再触碰所有字段 (backend/app/api/auth.py:128-136)。
5. 响应 200，`UserResponse`：`{"id", "email", "base_currency", "default_source_id", "created_at"}` (backend/app/schemas/user.py:21-30)。

**删除** — 不存在用户删除接口（`auth.py` 只有 `:20` register、`:65` login、`:91` GET me、`:101` PATCH me 四个路由）。如果通过 ORM 删除 `User`，`finance_sources` 与 `transactions` 上的 `cascade="all, delete-orphan"` (backend/app/models/user.py:24,26) 会先删掉其资金账户、交易，再经 `Transaction.tags` 删掉标签行。在 Postgres 上直接 `DELETE FROM users` 会在存在子行时失败，因为 `finance_sources.user_id`、`transactions.user_id` 都没有 `ON DELETE` 动作 (backend/app/models/finance_source.py:17)、(backend/app/models/transaction.py:17)。

### 8.2 资金账户（`finance_sources`）

```
  POST /finance-sources                       PATCH {"archived": true}
 (无) ----------------> [active, archived=false] ----------------------> [archived=true]
                                 ^                                             |
                                 |          PATCH {"archived": false}          |
                                 +---------------------------------------------+
   （没有 DELETE 接口；行永远不会经 API 被删除）
```

**创建** — `POST /api/v1/finance-sources` (backend/app/api/finance_sources.py:17-51)：

1. 客户端提交 `{"name": "Chase Checking", "type": "checking", "default_currency": "USD"}`；schema 要求 `name` 1..100 字符、`type` 四选一正则、`default_currency` 匹配 `^[A-Z]{3}$` (backend/app/schemas/finance_source.py:11-31)。
2. 构造 `FinanceSource(user_id=current_user.id, name, type, default_currency=upper(), archived=False)` (backend/app/api/finance_sources.py:31-37)。
3. `db.add` + `db.commit` + `db.refresh`（第一次 commit） (backend/app/api/finance_sources.py:39-41)。
4. `SELECT COUNT(*) FROM finance_sources WHERE user_id = ?`；若等于 1，把 `current_user.default_source_id` 设为新账户 id 并再 commit（第二次 commit） (backend/app/api/finance_sources.py:43-49)。
5. 响应 201，`FinanceSourceResponse`：`{"id", "user_id", "name", "type", "default_currency", "archived", "created_at"}` (backend/app/schemas/finance_source.py:51-63)。

**列表** — `GET /api/v1/finance-sources?include_archived=false`：`WHERE user_id = ?`，默认再加 `archived = false`，`ORDER BY created_at DESC` (backend/app/api/finance_sources.py:65-70)。

**更新 / 归档** — `PATCH /api/v1/finance-sources/{source_id}` (backend/app/api/finance_sources.py:99-135)：所有权检查失败 404 `"Finance source {source_id} not found"` (backend/app/api/finance_sources.py:115-124)；`exclude_unset` 后逐字段 `setattr`（只可能是 `name`、`archived`），commit，refresh (backend/app/api/finance_sources.py:127-133)。归档不会改动该账户下已有交易的 `source_id`，也不会改动 `users.default_source_id`。已归档账户仍能接收新交易（创建交易时的所有权检查不看 `archived` (backend/app/api/transactions.py:79-82)）。

**删除** — 不存在接口（`finance_sources.py` 路由只有 `:17` POST、`:54` GET 列表、`:74` GET 单个、`:99` PATCH）。在 Postgres 层面，若直接删除一行资金账户：有交易引用时会失败（`transactions.source_id` 无 `ON DELETE`），同时 `users.default_source_id` 会被置 NULL（`ON DELETE SET NULL`，(backend/app/models/user.py:20)）。通过 ORM 删除时，`FinanceSource.transactions` 的 `all, delete-orphan` (backend/app/models/finance_source.py:26) 会删掉其交易及标签；ORM 自身不会清 `users.default_source_id`（`User.default_source` 没有 delete 级联，(backend/app/models/user.py:25)）。

### 8.3 `users.default_source_id` 的状态

```
              第一次 POST /finance-sources（count == 1）
 [NULL] ---------------------------------------------------> [账户 A 的 id]
   ^      PATCH /auth/me {"default_source_id": "<自己拥有的 id>"}    |
   |<---------------------------------------------------------------+   （可重新指向任意自己拥有的账户）
   |      PATCH /auth/me {"default_source_id": null}                |
   +<---------------------------------------------------------------+   （显式 null 清空；exclude_unset 保留键，None 跳过所有权检查）
   |      数据库 ON DELETE SET NULL（资金账户行被删除时）             |
   +<---------------------------------------------------------------+   （仅 Postgres；API 无法触发）
```

证据：(backend/app/api/finance_sources.py:44-49)；(backend/app/api/auth.py:114-129)。

### 8.4 交易与标签（`transactions`、`transaction_tags`）

```
                 POST /transactions (201)
 (无) -----------------------------------------> [1 行 transactions + 0..n 行 transaction_tags]
                                                        |            ^
                                                        |            | PATCH /transactions/{id}
                                                        |            |   字段: amount / currency / occurred_at / description / merchant
                                                        |            |   tags 出现且非 null -> DELETE 全部标签行, INSERT 新集合
                                                        |            |   tags 缺省或 null   -> 标签行不动
                                                        |            |   （source_id 与 transfer_pair_id 改不了）
                                                        |            +------------------------------------------------
                                                        |
                                                        | DELETE /transactions/{id}
                                                        v
   transfer_pair_id IS NULL : ORM session.delete(tx) -> SQLAlchemy 先删其标签行, 再删交易行        (deleted_count = 1)
   transfer_pair_id NOT NULL: 批量 DELETE ... WHERE transfer_pair_id = ? AND user_id = ?            (deleted_count = n, 通常为 2)
                              标签行只靠数据库的 ON DELETE CASCADE 清理 (Postgres);
                              SQLite 上没有 PRAGMA foreign_keys, 标签行成为孤儿
```

**创建** — `POST /api/v1/transactions` (backend/app/api/transactions.py:52-141)：

1. 客户端提交 `TransactionCreate`：`source_id`（可选）、`amount`（`Decimal`，最多 4 位小数）、`currency`（`^[A-Z]{3}$`）、`occurred_at`（`YYYY-MM-DD`）、`description`（<= 500）、`merchant`（<= 200）、`tags`（默认 `[]`）、`transfer_pair_id`（可选 UUID） (backend/app/schemas/transaction.py:12-54)。
2. `source_id = transaction_data.source_id or current_user.default_source_id`；两者都为空则 400，`detail` 为 `"No finance source specified and user has no default source. Please create a finance source first."` (backend/app/api/transactions.py:70-76)。
3. `SELECT ... FROM finance_sources WHERE id = ? AND user_id = current_user.id`，查不到则 404，`detail` 为 `f"Finance source {source_id} not found or does not belong to you"` (backend/app/api/transactions.py:78-88)。
4. 构造 `Transaction(user_id=current_user.id, source_id, amount, currency=upper(), occurred_at, description, merchant, transfer_pair_id)` (backend/app/api/transactions.py:91-100)。
5. `db.add` + `db.flush()`：此时执行 INSERT，`id` 与 `created_at` 的 Python 侧默认值被求值 (backend/app/api/transactions.py:102-103)。
6. 若 `tags` 非空，为每个标签构造 `TransactionTag(transaction_id=new_transaction.id, tag=tag.strip().lower())` 并 `db.add`；不去重，重复标签在 commit 时触发未捕获的 `IntegrityError` -> 500 (backend/app/api/transactions.py:106-112)。
7. `db.commit()` + `db.refresh(new_transaction)` (backend/app/api/transactions.py:114-115)。
8. 若 `currency` 与用户 `base_currency` 不同，调用 Frankfurter 计算 `converted_amount` / `conversion_rate` / `conversion_date`（不落库；调用失败则三者为 `null`） (backend/app/api/transactions.py:117-122,20-46)。
9. 响应 201，`TransactionResponse`（字段见 §9.1 示例），`tags` 通过 `new_transaction.tags` 懒加载再读一次 (backend/app/api/transactions.py:124-141)。
10. 客户端把交易加入本地列表（转账场景下再发第二腿，见下文）。

**更新** — `PATCH /api/v1/transactions/{transaction_id}` (backend/app/api/transactions.py:327-413)：

1. `WHERE id = ? AND user_id = current_user.id`，查不到则 404，`detail` 为 `f"Transaction {transaction_id} not found"` (backend/app/api/transactions.py:347-356)。
2. `model_dump(exclude_unset=True)`；`tags` 键先弹出 (backend/app/api/transactions.py:359-362)。
3. 对其余字段逐个 `setattr`：`amount`、`currency`、`occurred_at` 三个非空列遇到 `None` 跳过；`currency` 转大写；`description`、`merchant` 可以被显式 `null` 置空 (backend/app/api/transactions.py:364-371)。
4. 若 `tags` 出现且不为 `None`：`DELETE FROM transaction_tags WHERE transaction_id = ?`，然后按 `strip().lower()` 逐个插入新标签（`tags: []` 即清空） (backend/app/api/transactions.py:374-384)。
5. `db.commit()` + `db.refresh()`，计算换算字段，响应 200 `TransactionResponse` (backend/app/api/transactions.py:386-413)。

**删除** — `DELETE /api/v1/transactions/{transaction_id}` (backend/app/api/transactions.py:416-468)：

1. 同样的所有权查询，失败则 404 `f"Transaction {transaction_id} not found"` (backend/app/api/transactions.py:435-444)。
2. 若 `transaction.transfer_pair_id` 非空：`db.query(Transaction).filter(transfer_pair_id == ?, user_id == current_user.id).delete()`（`Query.delete()` 批量语句，绕过 ORM 级联），commit，响应 200 `{"deleted_count": n, "message": f"Transfer deleted successfully ({n} transactions)"}` (backend/app/api/transactions.py:447-459)。标签行的清理只能依靠 `transaction_tags.transaction_id` 的 `ON DELETE CASCADE` (backend/app/models/transaction_tag.py:13)——Postgres 上生效，SQLite 上没有开启外键因此留下孤儿行（本机在内存 SQLite 上验证：批量删除 2 行后标签行仍在）。
3. 否则：`db.delete(transaction)`，ORM 依据 `Transaction.tags` 的 `all, delete-orphan` (backend/app/models/transaction.py:30) 先删标签行再删交易行（本机验证 SQLite 上标签行被删除），commit，响应 200 `{"deleted_count": 1, "message": "Transaction deleted successfully"}` (backend/app/api/transactions.py:460-468)。

本机 `wallet_dev.db` 里能观察到步骤 2 的后果：`transactions` 有 2 行，`transaction_tags` 有 4 行，其中 2 行的 `transaction_id`（`3ab0918c...`、`73bb1e29...`）在 `transactions` 里已不存在。

**转账（transfer）的创建**是客户端驱动的两次独立服务端事务 (frontend/src/screens/TransactionFormScreen.tsx:161-234)：

1. 前端生成 `pairId = crypto.randomUUID()`，`absAmount = Math.abs(Number(amount))` (frontend/src/screens/TransactionFormScreen.tsx:164-165)。
2. `POST /transactions` 第一腿：`source_id = 来源账户`，`amount = -absAmount`，`transfer_pair_id = pairId` (frontend/src/screens/TransactionFormScreen.tsx:180-184)；失败则直接报错返回。
3. `POST /transactions` 第二腿：`source_id = 目标账户`，`amount = +absAmount`，同一个 `transfer_pair_id` (frontend/src/screens/TransactionFormScreen.tsx:197-201)。
4. 第二腿失败则 `DELETE /transactions/{firstLeg.id}`（服务端按 `transfer_pair_id` 批量删，此时只有一腿）；若删除也失败，提示用户可能残留一条交易 (frontend/src/screens/TransactionFormScreen.tsx:211-225)。

服务端对"转账"没有任何概念，只知道两行共享同一个 UUID。

交易从来不会因为资金账户或用户被删除而级联删除——因为这两者都没有删除接口。

---

## 9. 类型、大小与时间处理

### 9.1 类型

| ORM 类型 | Postgres | SQLite（实际存储） | 备注 |
|---|---|---|---|
| `Uuid()` | `UUID`（16 字节） | `CHAR(32)`，小写十六进制、**无连字符**，例如 `0d63769c1ff041418245603bb42f29dc`（取自 `wallet_dev.db`） | Python 侧始终是 `uuid.UUID`；JWT 的 `sub` 字符串在查询前用 `uuid.UUID(user_id)` 转换 (backend/app/core/security.py:134)。API JSON 输出带连字符（`"id": "0d63769c-1ff0-4141-8245-603bb42f29dc"`） |
| `String(3)` | `VARCHAR(3)`（不是 `CHAR(3)`） | `VARCHAR(3)`（长度不强制） | 币种代码，API 落库前一律转大写 |
| `String(32)` / `String(64)` | `VARCHAR(32)` / `VARCHAR(64)` | 长度不强制 | `finance_sources.type`、`transaction_tags.tag` |
| `String`（无长度） | `VARCHAR`（不限长） | `VARCHAR` | `email`、`password_hash`、`name`、`description`、`merchant` |
| `Numeric(18, 4)` | `NUMERIC(18, 4)` — 最多 14 位整数、恰好 4 位小数、精确运算 | 声明为 `NUMERIC(18, 4)`，但 SQLite 按 REAL 存（整数值按 INTEGER 存：`wallet_dev.db` 里 `-13123` 的 `typeof` 是 `integer`）；SQLAlchemy 读出时转成 4 位小数的 `Decimal`（本机验证读回 `Decimal('-13123.0000')`） | API 把 `amount` 序列化为 JSON 字符串，如 `"amount": "-13123.0000"`（pydantic v2 对 `Decimal` 的默认 JSON 行为）；Frankfurter 换算结果量化到 `0.0001` (backend/app/services/rates.py:139)、(backend/app/api/transactions.py:252) |
| `Boolean` | `BOOLEAN` | 声明 `BOOLEAN`，实际存 `0/1` 整数 | `archived` |
| `Date` | `DATE` | 文本 `YYYY-MM-DD` | `occurred_at` |
| `DateTime` | `TIMESTAMP WITHOUT TIME ZONE` | 文本 `YYYY-MM-DD HH:MM:SS.ffffff` | `created_at` |

一条已存储交易经 API 返回的样子（值取自 `wallet_dev.db` 的第一行；三个 `conversion_*` 字段是请求时计算的，不落库；此处币种与用户 `base_currency` 相同，所以为 `null`）：

```json
{
  "id": "0d63769c-1ff0-4141-8245-603bb42f29dc",
  "user_id": "ffc0b036-ffd5-4ce7-8f96-2120919b5217",
  "source_id": "986c05cf-467d-439d-bcb7-861b5f8a0549",
  "amount": "-13123.0000",
  "currency": "USD",
  "occurred_at": "2026-04-16",
  "description": "test",
  "merchant": "test",
  "transfer_pair_id": null,
  "created_at": "2026-04-16T20:19:08.305632",
  "converted_amount": null,
  "conversion_rate": null,
  "conversion_date": null,
  "tags": ["test1"]
}
```

（`TransactionResponse` 字段定义：(backend/app/schemas/transaction.py:89-124)。）

### 9.2 时区

- 三张带时间戳的表的 `created_at` 默认值都是 `datetime.utcnow` (backend/app/models/user.py:21)、(backend/app/models/finance_source.py:22)、(backend/app/models/transaction.py:25)：一个**naive** 的 UTC datetime，由 SQLAlchemy 在 API 进程执行 INSERT 时求值，存入 `TIMESTAMP WITHOUT TIME ZONE`。读出时没有任何转换，API 返回不带偏移量的字符串（`"2026-04-16T20:19:08.305632"`），客户端需要自行知道它是 UTC。`datetime.utcnow` 在 Python 3.12+ 已弃用，但项目锁定 `python = "^3.11"` (backend/pyproject.toml:10)，镜像是 `python:3.11-slim` (infra/Dockerfile.api:22,54)。
- `occurred_at` 是客户端以 `YYYY-MM-DD` 提供的日历日期 (backend/app/schemas/transaction.py:29-33)；列表过滤按同样格式解析 (backend/app/api/transactions.py:191,202)。不存时刻、不存时区。
- 响应里的 `conversion_date` 是 API 进程的 `date.today()` (backend/app/api/transactions.py:43,255)，即容器的本地日期（Docker 镜像里是 UTC），从不持久化。汇率也不落库——`exchange_rates` 表已在迁移 `5ca7fe6e37db` 中删除。
- Postgres 容器使用镜像默认时区（UTC）；这对应用写入的 naive 时间戳没有影响。

### 9.3 大小与容量

- 三张主表用 UUID 主键（Postgres 16 字节，SQLite 32 字符文本），`transaction_tags` 用 `(transaction_id, tag)` 复合主键；`exchange_rates` 删除后不再有整数自增键。
- 行数无上限；没有保留期或归档逻辑。`GET /transactions` 采用 offset 分页，`limit` 默认 50、上限 100 (backend/app/api/transactions.py:150-151,167-169,215)。
- 生产 Postgres 针对目标 VM 调参：`shared_buffers=3GB`、`effective_cache_size=8GB`、`max_connections=50`、`shm_size: 1g`，数据在命名卷 `wallet_pgdata_prod` (infra/docker-compose.prod.yml:15-25,82)。开发 compose 使用 Postgres 默认参数、卷 `postgres_data`，并把 5432 端口发布到宿主机 (infra/docker-compose.dev.yml:11-13,24-25)。

---

## 另见

- [./README.md](./README.md) — 项目总览、术语表与文档索引
- [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域概念与端到端业务流程
- [./03-backend-api.md](./03-backend-api.md) — 每个 HTTP 接口的请求 / 响应与检查顺序
- [./04-frontend.md](./04-frontend.md) — 前端如何编排转账、如何处理 `amount` 与 401
- [./05-infra-and-ops.md](./05-infra-and-ops.md) — compose 栈、`migrate` 容器、卷与运维手册
