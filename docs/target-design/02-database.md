# 02 — 数据库设计（目标）

> 本文回答的问题：v3.0 的数据库里有哪些表、每张表的完整 DDL 长什么样、哪些规则由数据库兜底、哪些只能由应用层保证、每个索引服务于哪条查询、从今天的 head `8a4f4d66d893` 怎么一步步迁到目标 schema、一条数据从产生到消失经历了什么、测试在什么样的库上跑。
>
> 本文的每个决定都可以追溯到 [`00-decisions.md`](./00-decisions.md) 的某一节，标注形如"（决策 §1.2）"。凡描述**现状**处均带 `path:line` 引用，指向仓库当前代码；凡描述**目标**处一律用 DDL / 伪代码表达，仓库里目前没有对应实现。现状的完整描述见 [`../current-design/02-database.md`](../current-design/02-database.md)。

技术栈不变：SQLAlchemy 2.0 同步引擎 + Alembic + Postgres 15，测试用 SQLite 内存库（backend/pyproject.toml:13-14,21）。

---

## 0. 总览：目标表清单与对现状的差异

目标 schema 共十张表（决策 §10）：

| # | 表 | 现状 | 说明 |
|---|---|---|---|
| 1 | `users` | 已有 | 去掉 `default_source_id`、加 `language` / `updated_at` |
| 2 | `user_llm_settings` | **新增** | 每用户一份 LLM 配置（决策 §6） |
| 3 | `ledgers` | **新增** | 账本，基准币种的归属者（决策 §2） |
| 4 | `ledger_members` | **新增** | 账本成员与角色（决策 §2） |
| 5 | `ledger_invites` | **新增** | 6 位一次性邀请码（决策 §2） |
| 6 | `finance_sources` | 已有 | 归属从用户改为账本，加 `opening_balance` 等（决策 §3） |
| 7 | `transactions` | 已有 | 加 kind / 分类 / 转账 / 退款 / 导入等列（决策 §1、§10） |
| 8 | `import_batches` | **新增** | 一次账单上传（决策 §5） |
| 9 | `import_rows` | **新增** | 导入草稿行（决策 §5） |
| 10 | `exchange_rates` | **已被删除**，需补建 | Frankfurter 结果缓存（决策 §8，另见 §待决 D-1） |

删除的表：`transaction_tags`（决策 §1.3"现有 `transaction_tags` 表、`?tag=` 筛选、标签输入框全部移除"）。现状模型见 backend/app/models/transaction_tag.py:11-20。

### 0.1 列级差异

**新增表**：`user_llm_settings`、`ledgers`、`ledger_members`、`ledger_invites`、`import_batches`、`import_rows`；`exchange_rates` 需重新建（现状里它在 backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25 被 drop 掉了）。

**删除表**：`transaction_tags`。

**改名列**：

| 表 | 现状列 | 目标列 | 依据 |
|---|---|---|---|
| `transactions` | `description`（backend/app/models/transaction.py:22） | `note` | 决策 §1.4 |

**删除列**：

| 表 | 列 | 现状证据 | 原因 |
|---|---|---|---|
| `users` | `default_source_id` | backend/app/models/user.py:20 | 账户已归属账本、一个用户可属于多本账（决策 §3、§2）；决策 §11 的 `PATCH /me` 只剩默认币种与语言。替代方案见 §待决 D-2 |
| `finance_sources` | `user_id` | backend/app/models/finance_source.py:17 | 由 `ledger_id` + `created_by` 取代（决策 §2 归属段） |
| `transactions` | `user_id` | backend/app/models/transaction.py:17 | 同上 |

**新增列**：

| 表 | 新增列 | 依据 |
|---|---|---|
| `users` | `language`、`updated_at` | 决策 §11（`PATCH /me` 改语言）、§0.4 |
| `finance_sources` | `ledger_id`、`opening_balance`、`created_by`、`updated_by`、`updated_at`；`type` 增加取值 `cash` | 决策 §3 |
| `transactions` | `ledger_id`、`kind`、`category_l1`、`category_l2`、`transfer_role`、`transfer_subtype`、`counterparty`、`refund_of`、`import_batch_id`、`created_by`、`updated_by`、`updated_at` | 决策 §1、§2、§5、§10 |

**保持不变**：`transactions.amount`（`NUMERIC(18,4)`）、`transactions.occurred_at`（`DATE`，决策 §0.7 明确不加时刻）、`transactions.merchant`、`transactions.transfer_pair_id`（仍可空、仍无外键）、`users.email` / `password_hash` / `base_currency`。

---

## 1. 表结构与 DDL

下面给出的是 **Postgres** DDL，也就是 Alembic 迁移在生产库上最终建出来的形状；同一份 schema 由 SQLAlchemy 模型描述，测试库（SQLite）由 `Base.metadata.create_all` 建出（§8）。约定：

- 所有主键都是 `UUID`（`sa.Uuid()`，Python 侧 `uuid.uuid4` 默认值），`exchange_rates` 除外（沿用自增 BIGINT）。
- 所有枚举列都是 `VARCHAR(n) + CHECK`，不使用 Postgres ENUM（决策 §10）。
- 所有金额 `NUMERIC(18,4)`、所有币种 `CHAR(3)`、所有时间戳 `TIMESTAMP WITHOUT TIME ZONE` 存 naive UTC（§7）。
- 约束一律显式命名，命名规则见 §5.0；`create_all` 与 Alembic 用同一套 `naming_convention`，这样 `batch_alter_table` 才能按名字 drop 约束。
- **§1 各表 DDL 里写的是最终落库的约束名**（`pg_constraint.conname` / SQLite `sqlite_master` 里能查到的名字）。因为 `ck` 的命名规则含 `%(constraint_name)s`，模型与迁移代码里的 CHECK **只写去掉 `ck_<表名>_` 前缀后的后缀**（例如 DDL 里的 `ck_transactions_kind` 对应代码里的 `name="kind"`），前缀由 convention 自动补齐；`uq` / `fk` / `ix` / `pk` 四类的规则不含 `%(constraint_name)s`，代码里照旧写 DDL 中的全名。详见 §5.0。
- `created_at` / `updated_at` 由应用层赋值，**不设** `server_default` / `onupdate`（§7.3）。

### 1.1 `users`

```sql
CREATE TABLE users (
    id             UUID         NOT NULL,
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    base_currency  CHAR(3)      NOT NULL,
    language       VARCHAR(8),
    created_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT ck_users_base_currency_upper CHECK (base_currency = upper(base_currency)),
    CONSTRAINT ck_users_language CHECK (language IS NULL OR language IN ('zh', 'en'))
);
CREATE UNIQUE INDEX ix_users_email ON users (email);
```

列语义：`email` 由应用层在写入前统一 `lower()`，唯一索引因此等价于大小写不敏感（现状不做归一化，是 `../current-design/06-known-issues.md` 记录的问题）。`base_currency` 没有 `DEFAULT`——初始迁移建这一列时就没给 `server_default`（backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:40），迁移第 6 步也不补，默认值由模型的 Python 侧 `default="USD"` 提供（与本节开头"应用层赋值"的约定一致）。它不再是"记账币种"，只是**新建账本时的默认基准币种**（决策 §13 第 6 步）；账本自己的 `ledgers.base_currency` 才是统计口径（决策 §2）。`language` 为 `NULL` 表示"跟随系统"（决策 §0.4），只允许 `zh` / `en`。`updated_at` 仅作审计，`PATCH /me` 不做 409 乐观并发（决策 §2 只对 `transactions`、`finance_sources`、`ledgers` 要求）。

### 1.2 `user_llm_settings`

```sql
CREATE TABLE user_llm_settings (
    user_id            UUID          NOT NULL,
    base_url           VARCHAR(500)  NOT NULL DEFAULT 'https://openrouter.ai/api/v1',
    api_key            TEXT          NOT NULL,
    model              VARCHAR(200)  NOT NULL,
    vision_model       VARCHAR(200),
    created_at         TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at         TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_user_llm_settings PRIMARY KEY (user_id),
    CONSTRAINT fk_user_llm_settings_user_id_users
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_user_llm_settings_base_url
        CHECK (lower(base_url) LIKE 'http://%' OR lower(base_url) LIKE 'https://%')
);
```

列语义：主键就是 `user_id`，一个用户最多一份（决策 §6）。`api_key` 列名沿用决策 §6 的字段清单；存的是 Fernet 密文（决策 §6"服务端 Fernet 加密存"），接口回显时解密后只返回尾 4 位，数据库里**不存明文、也不另存尾 4 位**——建议改名为 `api_key_encrypted` 见 §待决 D-4。`base_url` 的 CHECK 先 `lower()` 再比：裸 `LIKE` 在 SQLite 上对 ASCII 大小写不敏感、在 Postgres 上敏感，不归一化的话 `'HTTP://x'` 两边行为会不一致（§8.1）。`vision_model` 为空表示导入图片时复用 `model`。`ON DELETE CASCADE`：本版本没有删用户的接口（§6.8），级联只是为了将来运维脚本删用户时不留孤儿。

### 1.3 `ledgers`

```sql
CREATE TABLE ledgers (
    id             UUID         NOT NULL,
    name           VARCHAR(100) NOT NULL,
    base_currency  CHAR(3)      NOT NULL,
    created_by     UUID         NOT NULL,
    created_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_ledgers PRIMARY KEY (id),
    CONSTRAINT fk_ledgers_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT ck_ledgers_name_not_blank CHECK (length(trim(name)) > 0),
    CONSTRAINT ck_ledgers_base_currency_upper CHECK (base_currency = upper(base_currency))
);
CREATE INDEX ix_ledgers_created_by ON ledgers (created_by);
```

列语义：`base_currency` 是这本账的统计与折算口径（决策 §2、§7）；owner 可以改（决策 §2 权限段），改了不动历史交易——折算是读取时算的（决策 §8）。`created_by` 只记录"谁建的"，**不等于当前 owner**（owner 可转让，见 `ledger_members.role`）；外键无 `ON DELETE` 动作（NO ACTION），因为用户不会被删。`updated_at` 参与 409 乐观并发（决策 §2）。

### 1.4 `ledger_members`

```sql
CREATE TABLE ledger_members (
    ledger_id  UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    role       VARCHAR(16) NOT NULL DEFAULT 'member',
    joined_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_ledger_members PRIMARY KEY (ledger_id, user_id),
    CONSTRAINT fk_ledger_members_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_ledger_members_user_id_users
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_ledger_members_role CHECK (role IN ('owner', 'member'))
);
CREATE INDEX ix_ledger_members_user_id ON ledger_members (user_id);
```

列语义：复合主键即"一人在一本账里最多一行"（决策 §2）。`role` 只有两种；"每本账恰有一个 owner"由应用层保证（§3），数据库不做部分唯一索引——转让 owner 需要在同一事务里把旧 owner 降级、新 owner 升级，中间态会短暂违反"恰好一个"，用部分唯一索引会把这个事务卡死。删除账本时成员行随 `ON DELETE CASCADE` 消失。

### 1.5 `ledger_invites`

```sql
CREATE TABLE ledger_invites (
    id          UUID       NOT NULL,
    ledger_id   UUID       NOT NULL,
    code        CHAR(6)    NOT NULL,
    created_by  UUID       NOT NULL,
    created_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    used_by     UUID,
    used_at     TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT pk_ledger_invites PRIMARY KEY (id),
    CONSTRAINT fk_ledger_invites_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_ledger_invites_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT fk_ledger_invites_used_by_users
        FOREIGN KEY (used_by) REFERENCES users (id),
    CONSTRAINT ck_ledger_invites_code_digits
        CHECK (length(code) = 6 AND replace(replace(replace(replace(replace(
               replace(replace(replace(replace(replace(code,
               '0',''),'1',''),'2',''),'3',''),'4',''),
               '5',''),'6',''),'7',''),'8',''),'9','') = ''),
    CONSTRAINT ck_ledger_invites_used_pair
        CHECK ((used_by IS NULL) = (used_at IS NULL)),
    CONSTRAINT ck_ledger_invites_expiry CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX uq_ledger_invites_code ON ledger_invites (code);
CREATE INDEX ix_ledger_invites_ledger_id ON ledger_invites (ledger_id);
```

列语义：`code` 是 6 位数字（决策 §2），全表唯一——所以"生成邀请码"要在冲突时重试。因为码空间只有 100 万，**必须清理**已用 / 已过期的行才不会耗尽（§6.3）。`expires_at = created_at + 10 分钟`（决策 §2），过期判断在应用层用 `expires_at > now()`，数据库不做（`now()` 不是不可变函数，进不了 CHECK 或部分索引谓词）。`used_by` / `used_at` 同时为空或同时非空，由 `ck_ledger_invites_used_pair` 保证；一次性使用 = 应用层在 `UPDATE ... WHERE id = ? AND used_by IS NULL` 命中 0 行时报错。`ck_ledger_invites_code_digits` 不用正则（SQLite 没有 `~` 运算符，Postgres 的 `~` 又不可移植），改用**嵌套 `replace` 把十个数字字符逐个剥掉、结果必须是空串**：`replace()` 与 `length()` 在 Postgres 和 SQLite 里语义完全一致，两边都能真正挡下 `'12a456'` 这类含非数字字符的值。注意不能写成 `code >= '000000' AND code <= '999999'`——那只是字符串区间比较，`'12a456'` 会因为首字符 `'1'` 落在区间内而通过，属于假保证。

### 1.6 `finance_sources`

```sql
CREATE TABLE finance_sources (
    id                UUID          NOT NULL,
    ledger_id         UUID          NOT NULL,
    name              VARCHAR(100)  NOT NULL,
    type              VARCHAR(32)   NOT NULL,
    default_currency  CHAR(3)       NOT NULL,
    opening_balance   NUMERIC(18,4) NOT NULL DEFAULT 0,
    archived          BOOLEAN       NOT NULL,
    created_by        UUID          NOT NULL,
    updated_by        UUID          NOT NULL,
    created_at        TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at        TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_finance_sources PRIMARY KEY (id),
    CONSTRAINT fk_finance_sources_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_finance_sources_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT fk_finance_sources_updated_by_users
        FOREIGN KEY (updated_by) REFERENCES users (id),
    CONSTRAINT ck_finance_sources_type
        CHECK (type IN ('checking', 'savings', 'credit', 'cash', 'other')),
    CONSTRAINT ck_finance_sources_currency_upper
        CHECK (default_currency = upper(default_currency)),
    CONSTRAINT ck_finance_sources_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE INDEX ix_finance_sources_ledger_id ON finance_sources (ledger_id);
```

列语义：账户属于账本、账本内完全共享（决策 §2、§3）。`type` 相对现状（backend/app/models/finance_source.py:19 只有注释、没有 CHECK）新增 `cash` 并加上真正的 CHECK（决策 §3、§13 第 3 步）。`opening_balance` 是账户建立时的初始余额，余额 = `opening_balance + Σ transactions.amount`（决策 §3），因此**不存**余额列。`default_currency` 建后不可改（应用层：`PATCH` 的请求体里没有这个字段）。`archived` 同样没有 `DEFAULT`（初始迁移 e533c88884b7:51 建列时就没给，第 3 步也不补），Python 侧 `default=False`；本表里唯一带 `server_default` 的列是 `opening_balance`，因为它是第 3 步给存量行加的非空列（§5.3）。`archived = TRUE` 的账户不能再记账、不能作为导入目标，历史保留（决策 §3）；有交易的账户不能删除，只能归档——这条由应用层保证，数据库侧 `transactions.source_id` 用 NO ACTION 兜底（§1.7 说明为什么不能用 RESTRICT）。账本内账户重名的问题见 §待决 D-5。

### 1.7 `transactions`

```sql
CREATE TABLE transactions (
    id                UUID          NOT NULL,
    ledger_id         UUID          NOT NULL,
    source_id         UUID          NOT NULL,
    amount            NUMERIC(18,4) NOT NULL,
    currency          CHAR(3)       NOT NULL,
    occurred_at       DATE          NOT NULL,
    kind              VARCHAR(16)   NOT NULL,
    note              VARCHAR(500),
    merchant          VARCHAR(200),
    category_l1       VARCHAR(32),
    category_l2       VARCHAR(32),
    transfer_role     VARCHAR(8),
    transfer_subtype  VARCHAR(16),
    transfer_pair_id  UUID,
    counterparty      VARCHAR(100),
    refund_of         UUID,
    import_batch_id   UUID,
    created_by        UUID          NOT NULL,
    updated_by        UUID          NOT NULL,
    created_at        TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at        TIMESTAMP WITHOUT TIME ZONE NOT NULL,

    CONSTRAINT pk_transactions PRIMARY KEY (id),

    CONSTRAINT fk_transactions_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_transactions_source_id_finance_sources
        FOREIGN KEY (source_id) REFERENCES finance_sources (id),          -- NO ACTION，见下
    CONSTRAINT fk_transactions_refund_of_transactions
        FOREIGN KEY (refund_of) REFERENCES transactions (id) ON DELETE SET NULL,
    CONSTRAINT fk_transactions_import_batch_id_import_batches
        FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE SET NULL,
    CONSTRAINT fk_transactions_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT fk_transactions_updated_by_users
        FOREIGN KEY (updated_by) REFERENCES users (id),

    -- 决策 §10 的 7 条关键约束
    CONSTRAINT ck_transactions_kind
        CHECK (kind IN ('expense', 'income', 'refund', 'transfer')),

    CONSTRAINT ck_transactions_amount_sign CHECK (
        (kind = 'expense'  AND amount < 0) OR
        (kind = 'income'   AND amount > 0) OR
        (kind = 'refund'   AND amount > 0) OR
        (kind = 'transfer' AND transfer_role = 'out' AND amount < 0) OR
        (kind = 'transfer' AND transfer_role = 'in'  AND amount > 0)
    ),

    CONSTRAINT ck_transactions_transfer_role
        CHECK ((kind = 'transfer') = (transfer_role IS NOT NULL)),
    CONSTRAINT ck_transactions_transfer_subtype
        CHECK ((kind = 'transfer') = (transfer_subtype IS NOT NULL)),

    CONSTRAINT ck_transactions_category CHECK (
        (kind = 'transfer' AND category_l1 IS NULL AND category_l2 IS NULL) OR
        (kind <> 'transfer' AND category_l1 IS NOT NULL)
    ),

    CONSTRAINT ck_transactions_refund_of
        CHECK (refund_of IS NULL OR kind = 'refund'),

    CONSTRAINT uq_transactions_transfer_pair_role
        UNIQUE (transfer_pair_id, transfer_role),

    CONSTRAINT ck_transactions_counterparty
        CHECK (transfer_pair_id IS NULL OR counterparty IS NULL),

    -- 枚举列的取值约束（决策 §10"枚举一律 VARCHAR + CHECK"）
    CONSTRAINT ck_transactions_transfer_role_values
        CHECK (transfer_role IS NULL OR transfer_role IN ('out', 'in')),
    CONSTRAINT ck_transactions_transfer_subtype_values
        CHECK (transfer_subtype IS NULL OR transfer_subtype IN ('plain', 'repayment')),
    CONSTRAINT ck_transactions_category_l2_needs_l1
        CHECK (category_l2 IS NULL OR category_l1 IS NOT NULL),
    CONSTRAINT ck_transactions_currency_upper
        CHECK (currency = upper(currency)),
    CONSTRAINT ck_transactions_not_self_refund
        CHECK (refund_of IS NULL OR refund_of <> id)
);

CREATE INDEX ix_transactions_ledger_occurred
    ON transactions (ledger_id, occurred_at DESC, created_at DESC);
CREATE INDEX ix_transactions_ledger_source     ON transactions (ledger_id, source_id);
CREATE INDEX ix_transactions_ledger_kind_cat   ON transactions (ledger_id, kind, category_l1);
CREATE INDEX ix_transactions_refund_of         ON transactions (refund_of) WHERE refund_of IS NOT NULL;
CREATE INDEX ix_transactions_import_batch_id   ON transactions (import_batch_id) WHERE import_batch_id IS NOT NULL;
```

#### 1.7.1 决策 §10 的 7 条约束逐条对照

| 决策 §10 的条目 | 约束名 | SQL 表达式 | SQLite 兼容 |
|---|---|---|---|
| `kind IN (...)` | `ck_transactions_kind` | `kind IN ('expense','income','refund','transfer')` | 是 |
| 符号：expense 负、income/refund 正、transfer out 负 in 正 | `ck_transactions_amount_sign` | 见上方五路 `OR` | 是（纯比较与布尔运算） |
| `(kind='transfer') = (transfer_role IS NOT NULL)` | `ck_transactions_transfer_role` | 原样 | 是（SQLite 把两侧求值为 0/1 再比较，语义一致） |
| `(kind='transfer') = (transfer_subtype IS NOT NULL)` | `ck_transactions_transfer_subtype` | 原样 | 是 |
| transfer → 分类为空；其他 → `category_l1` 非空 | `ck_transactions_category` | 见上方两路 `OR` | 是 |
| `refund_of IS NULL OR kind='refund'` | `ck_transactions_refund_of` | 原样 | 是 |
| `UNIQUE (transfer_pair_id, transfer_role)`（NULL 不参与） | `uq_transactions_transfer_pair_role` | 唯一约束 | 是 —— SQLite 与 Postgres 的唯一索引都把 NULL 视为互不相等，因此任意多行 `(NULL, NULL)` 并存 |
| `transfer_pair_id IS NULL OR counterparty IS NULL` | `ck_transactions_counterparty` | 原样 | 是 |

关于 `(kind = 'transfer') = (transfer_role IS NOT NULL)` 这种写法：Postgres 里两侧都是 `boolean`，`=` 就是布尔等价；SQLite 里两侧是 `0/1` 整数，`=` 是整数比较——两个方言得到同一语义。因为 `kind` 是 `NOT NULL`，左侧永不为 NULL，CHECK 不会因"结果为 NULL 视为通过"而漏判。若将来需要更保守的写法，等价形式是：

```sql
CHECK ((kind =  'transfer' AND transfer_role IS NOT NULL) OR
       (kind <> 'transfer' AND transfer_role IS     NULL))
```

`ck_transactions_amount_sign` 顺带蕴含了 `amount <> 0`（现状没有任何符号或非零约束，见 backend/app/models/transaction.py:19），这会影响迁移回填，见 §5.4。

#### 1.7.2 外键删除行为

| 外键 | 行为 | 依据 |
|---|---|---|
| `ledger_id → ledgers.id` | `ON DELETE CASCADE` | 决策 §2"owner 可删除账本（级联删除账户、交易、导入）" |
| `source_id → finance_sources.id` | **NO ACTION**（不写 `ON DELETE`），有交易时禁止删账户由应用层保证 | 决策 §3"有交易的账户不能删除，只能归档" |
| `refund_of → transactions.id` | `ON DELETE SET NULL` | 决策 §1.1"原单被删除时退款行的 `refund_of` 置空" |
| `import_batch_id → import_batches.id` | `ON DELETE SET NULL`（兜底），正常路径由应用层在同一事务内先删交易再删批次 | 决策 §5（撤销 = 删除这批建的所有交易）；见 §6.6 |
| `created_by` / `updated_by → users.id` | NO ACTION | 本版本没有删用户的接口（决策 §11 的"我"分组里没有 `DELETE /me`） |
| `transfer_pair_id` | **无外键**（它不指向任何表，是两腿共用的自由 UUID） | 决策 §1.2；沿用现状（backend/app/models/transaction.py:24 也没有外键） |

**为什么 `source_id` 用 NO ACTION 而不是 RESTRICT**：删除账本时 `ledgers → finance_sources` 和 `ledgers → transactions` 两条 CASCADE 在同一条 `DELETE FROM ledgers` 语句里触发。RESTRICT 在被引用行删除的**当下**立即检查，此时交易行还没删完，会直接报错；NO ACTION 的检查推迟到语句结束，那时交易行已随 CASCADE 消失，检查通过。所以要让"账本级联删除"和"有交易的账户禁止删除"同时成立，`source_id` 必须是 NO ACTION，"禁止删账户"落在应用层（§3）。

#### 1.7.3 列语义

`ledger_id` 冗余于 `source_id → finance_sources.ledger_id`，但所有列表查询都按账本过滤，直接带上它可以省掉一次 join，代价是应用层必须保证两者一致（§3）。`kind` 是唯一的方向来源，符号只是它的推论（决策 §1）。`note` 即原 `description`，≤500 字（决策 §1.4）；`merchant` ≤200 字，搜索、退款匹配、导入去重都靠它。`category_l1` / `category_l2` 存的是 `backend/app/core/categories.py` 常量表里的 code，取值合法性、二级归属一级、一级收支方向与 kind 匹配，全部由应用层校验（决策 §1.3）——**数据库不存分类表，也就没有外键**。`counterparty` 是单腿转账的对方文本（"老婆""工资卡"，决策 §1.2）。`import_batch_id` 非空表示这条交易由某批导入生成（决策 §5）。

### 1.8 `import_batches`

```sql
CREATE TABLE import_batches (
    id             UUID         NOT NULL,
    ledger_id      UUID         NOT NULL,
    source_id      UUID         NOT NULL,
    created_by     UUID         NOT NULL,
    filename       VARCHAR(255) NOT NULL,
    mime_type      VARCHAR(128) NOT NULL,
    size_bytes     INTEGER      NOT NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'uploaded',
    error_code     VARCHAR(64),
    error_message  VARCHAR(2000),
    model          VARCHAR(200),
    used_vision    BOOLEAN      NOT NULL DEFAULT FALSE,
    raw_response   JSON,
    row_count      INTEGER      NOT NULL DEFAULT 0,
    created_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    parsed_at      TIMESTAMP WITHOUT TIME ZONE,
    committed_at   TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT pk_import_batches PRIMARY KEY (id),
    CONSTRAINT fk_import_batches_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_import_batches_source_id_finance_sources
        FOREIGN KEY (source_id) REFERENCES finance_sources (id),
    CONSTRAINT fk_import_batches_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT ck_import_batches_status
        CHECK (status IN ('uploaded', 'parsing', 'ready', 'committed', 'failed')),
    CONSTRAINT ck_import_batches_size
        CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    CONSTRAINT ck_import_batches_row_count
        CHECK (row_count >= 0 AND row_count <= 2000),
    CONSTRAINT ck_import_batches_failed_has_error
        CHECK (status <> 'failed' OR error_code IS NOT NULL),
    CONSTRAINT ck_import_batches_committed_at
        CHECK ((status = 'committed') = (committed_at IS NOT NULL))
);
CREATE INDEX ix_import_batches_ledger_created
    ON import_batches (ledger_id, created_at DESC);
CREATE UNIQUE INDEX uq_import_batches_one_parsing
    ON import_batches (ledger_id) WHERE status = 'parsing';
```

列语义：一行 = 一次上传（决策 §5）。`source_id` 是用户上传时选定的目标账户，不让 LLM 猜（决策 §5）；外键 NO ACTION，配合"有导入记录的账户不能删除"的应用层规则。`status` 的取值就是决策 §5 的状态机 `uploaded → parsing → ready → committed`、`parsing → failed`。`size_bytes ≤ 10 MB`、`row_count ≤ 2000` 直接把决策 §5 的限制写进 CHECK。`raw_response` 存 LLM 原始响应（决策 §5），列类型见 §1.11。`used_vision` 记录是否走了视觉路径，review 界面据此决定要不要显示页面缩略图（决策 §5）。部分唯一索引 `uq_import_batches_one_parsing` 把"同一账本同时只允许一个批次在 parsing"（决策 §5）交给数据库——Postgres 与 SQLite（3.8+）都支持带 `WHERE` 的唯一索引，SQLAlchemy 里写成 `Index(..., unique=True, postgresql_where=..., sqlite_where=...)`。

### 1.9 `import_rows`

```sql
CREATE TABLE import_rows (
    id                     UUID          NOT NULL,
    batch_id               UUID          NOT NULL,
    row_no                 INTEGER       NOT NULL,
    status                 VARCHAR(16)   NOT NULL DEFAULT 'pending',
    date                   DATE,
    amount                 NUMERIC(18,4),
    currency               CHAR(3),
    kind                   VARCHAR(16),
    merchant               VARCHAR(200),
    note                   VARCHAR(500),
    category_l1            VARCHAR(32),
    category_l2            VARCHAR(32),
    transfer_subtype       VARCHAR(16),
    confidence             NUMERIC(3,2),
    source_ref             VARCHAR(200),
    flags                  JSON,
    matched_transaction_id UUID,
    counterpart_source_id  UUID,
    transaction_id         UUID,
    created_at             TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at             TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_import_rows PRIMARY KEY (id),
    CONSTRAINT fk_import_rows_batch_id_import_batches
        FOREIGN KEY (batch_id) REFERENCES import_batches (id) ON DELETE CASCADE,
    CONSTRAINT fk_import_rows_matched_transaction_id_transactions
        FOREIGN KEY (matched_transaction_id) REFERENCES transactions (id) ON DELETE SET NULL,
    CONSTRAINT fk_import_rows_counterpart_source_id_finance_sources
        FOREIGN KEY (counterpart_source_id) REFERENCES finance_sources (id) ON DELETE SET NULL,
    CONSTRAINT fk_import_rows_transaction_id_transactions
        FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL,
    CONSTRAINT ck_import_rows_status
        CHECK (status IN ('pending', 'edited', 'skipped')),
    CONSTRAINT ck_import_rows_kind
        CHECK (kind IS NULL OR kind IN ('expense', 'income', 'refund', 'transfer')),
    CONSTRAINT ck_import_rows_transfer_subtype
        CHECK (transfer_subtype IS NULL OR transfer_subtype IN ('plain', 'repayment')),
    CONSTRAINT ck_import_rows_confidence
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    CONSTRAINT ck_import_rows_row_no CHECK (row_no >= 1)
);
CREATE UNIQUE INDEX uq_import_rows_batch_row ON import_rows (batch_id, row_no);
CREATE INDEX ix_import_rows_transaction_id
    ON import_rows (transaction_id) WHERE transaction_id IS NOT NULL;
```

列语义：草稿行，**与正式交易表完全隔离**——决策 §5 明确"草稿不能污染正式交易表；JSON 单列在多人 review 时会互相覆盖且没法建外键"。除 `batch_id`、`row_no`、`status` 外所有业务列都可空：LLM 解析不出日期或金额的行要保留下来让人补（决策 §6"日期/金额解析失败的行标 `needs_review` 而不是丢弃"）。`date` 列名沿用决策 §5 的字段清单，LLM 输出 JSON 与 API 字段同样叫 `date`（决策 §6）；`date` 在 Postgres 与 SQLite 里都只是非保留的类型名，可以直接当列名用（`exchange_rates.date` 现状就是这么用的）。建议改名为 `occurred_at`（与 `transactions` 对齐）见 §待决 D-3。`flags` 是服务端自动标记的数组，取值 `duplicate` / `refund_candidate` / `repayment` / `needs_review`（决策 §5、§6）。`matched_transaction_id` 是退款候选原单（决策 §5"仅在候选唯一时预填"）；`counterpart_source_id` 是还款行的对手账户；`transaction_id` 在 commit 之后回填，指向这行生成的正式交易。三个外键都是 `ON DELETE SET NULL`：草稿引用的交易被删掉时，草稿行本身要留下（否则历史批次会缺行）。

### 1.10 `exchange_rates`

沿用初始迁移里的形状（backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:24-35），它在 backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25 被删掉了，目标态需要补建（决策 §8、§10；见 §待决 D-1）：

```sql
CREATE TABLE exchange_rates (
    id      BIGSERIAL      NOT NULL,
    source  VARCHAR(32)    NOT NULL,
    base    CHAR(3)        NOT NULL,
    symbol  CHAR(3)        NOT NULL,
    rate    NUMERIC(18,8)  NOT NULL,
    date    DATE           NOT NULL,
    CONSTRAINT pk_exchange_rates PRIMARY KEY (id),
    CONSTRAINT uix_base_symbol_date UNIQUE (base, symbol, date),
    CONSTRAINT ck_exchange_rates_rate_positive CHECK (rate > 0)
);
CREATE INDEX ix_exchange_rates_date ON exchange_rates (date);
COMMENT ON TABLE exchange_rates IS 'Daily exchange rates from external API';
```

列语义：这是 Frankfurter 拉回来的**日汇率缓存**，不是"把折算结果落库"——决策 §8 的"读取时计算，不落库"说的是 `converted_amount` 之类的派生值不写进 `transactions`（现状也是这样，见 backend/app/api/transactions.py:117-122 的注释与 `../current-design/02-database.md` §9.2）。`source` 固定 `'frankfurter'`。`(base, symbol, date)` 唯一，写入用 upsert（Postgres `ON CONFLICT DO NOTHING`）。一经公布的历史汇率不再变（决策 §8），因此缓存可以永久保留、不需要失效策略；"最新汇率"取 `date` 最大的一行，"发生日汇率"取 `date <= occurred_at` 里最大的一行——这就是 `ix_exchange_rates_date` 服务的查询。`id BIGSERIAL` 在 SQLAlchemy 里必须写成 `sa.BigInteger().with_variant(sa.Integer, "sqlite")`，否则 SQLite 上 `BIGINT PRIMARY KEY` 不是 rowid 别名、拿不到自增（`INTEGER PRIMARY KEY` 才是）。

### 1.11 JSON 列为什么用 `JSON().with_variant(JSONB, 'postgresql')`

`import_rows.flags` 和 `import_batches.raw_response` 两列在模型里这样声明：

```python
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

flags = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
raw_response = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
```

原因：直接用 `JSONB` 会让 `Base.metadata.create_all` 在 SQLite 上失败（`JSONB` 是 Postgres 方言专有类型，SQLite 方言不知道怎么编译它），而测试库正是 SQLite 内存库（backend/tests/conftest.py:45-50,67）。`with_variant` 让同一列在 Postgres 上编译成 `JSONB`（可建 GIN 索引、比较高效），在 SQLite 上编译成 `JSON`（实际按 TEXT 存，SQLAlchemy 负责序列化/反序列化）。上面 DDL 里写的 `JSON` 是给 SQLite 看的通用形状，生产迁移里写 `postgresql.JSONB`。本版本不对 `flags` 建 GIN 索引：标记的筛选永远发生在"某个批次的几百行"范围内，先按 `batch_id` 收窄即可。

---

## 2. ER 图

```
 [users] ---1:1--- [user_llm_settings]        (user_id 既是 PK 又是 FK, ON DELETE CASCADE)
   |
   | created_by / updated_by / used_by  (NO ACTION, 出现在 ledgers, ledger_invites,
   |                                     finance_sources, transactions, import_batches)
   v
 +-------------------------+          N +----------------------------------+
 | ledgers                 |<-----------| ledger_members                   |
 |-------------------------| ledger_id  |----------------------------------|
 | PK id            UUID   | (CASCADE)  | PK,FK ledger_id UUID             |
 |    name          VC(100)|            | PK,FK user_id   UUID  ---> users |
 |    base_currency CHAR(3)|            |    role         VC(16) owner|member
 | FK created_by ---> users|            |    joined_at    TS               |
 |    created_at    TS     |            +----------------------------------+
 |    updated_at    TS     |          N +----------------------------------+
 +-------------------------+<-----------| ledger_invites                   |
   |1        |1        |1    ledger_id  |----------------------------------|
   |         |         |     (CASCADE)  | PK id         UUID               |
   |         |         |                |    code       CHAR(6) UNIQUE     |
   |         |         |                | FK created_by ---> users         |
   |         |         |                |    expires_at TS / used_at TS    |
   |         |         |                | FK used_by    ---> users (NULL)  |
   |         |         |                +----------------------------------+
   |         |         |
   | ledger_id (CASCADE)|  ledger_id (CASCADE)
   v N       |         v N
 +---------------------------+     +--------------------------------------+
 | finance_sources           |     | import_batches                       |
 |---------------------------|     |--------------------------------------|
 | PK id              UUID   |     | PK id           UUID                 |
 | FK ledger_id       UUID NN|     | FK ledger_id    UUID NN (CASCADE)    |
 |    name            VC(100)|     | FK source_id ---> finance_sources    |
 |    type            VC(32) |<----| FK created_by ---> users             |
 |    default_currency CHAR(3)| src |    filename/mime_type/size_bytes     |
 |    opening_balance NUM(18,4)|    |    status VC(16) uploaded|parsing|   |
 |    archived        BOOL   |     |           ready|committed|failed      |
 | FK created_by/updated_by  |     |    error_code / error_message        |
 |    created_at/updated_at  |     |    model / used_vision / raw_response |
 +---------------------------+     |    row_count / 4 个时间戳             |
   |1                    ^         +--------------------------------------+
   | source_id           | counterpart_    |1                    |1
   | (NO ACTION)         | source_id       | batch_id (CASCADE)  | import_batch_id
   v N                   | (SET NULL)      v N                   | (SET NULL)
 +------------------------------------+  +-----------------------------------+
 | transactions                       |  | import_rows                       |
 |------------------------------------|  |-----------------------------------|
 | PK id               UUID           |  | PK id                    UUID     |
 | FK ledger_id        UUID NN CASCADE|  | FK batch_id              UUID NN  |
 | FK source_id        UUID NN NOACT  |  |    row_no INT NN  UNIQUE(batch,no)|
 |    amount    NUMERIC(18,4) NN      |  |    status VC(16) pending|edited|  |
 |    currency  CHAR(3) NN            |  |           skipped                 |
 |    occurred_at DATE  NN            |  |    date/amount/currency           |
 |    kind      VC(16)  NN            |  |    kind/merchant/note             |
 |    note VC(500) / merchant VC(200) |  |    category_l1/category_l2        |
 |    category_l1/category_l2 VC(32)  |  |    transfer_subtype/confidence    |
 |    transfer_role    VC(8)  out|in  |  |    source_ref / flags JSON|JSONB  |
 |    transfer_subtype VC(16) plain|  |  | FK matched_transaction_id -------->| (SET NULL)
 |                     repayment      |  | FK counterpart_source_id --------->| (SET NULL)
 |    transfer_pair_id UUID (无 FK)   |  | FK transaction_id ---------------->| (SET NULL)
 |    counterparty     VC(100)        |  |    created_at/updated_at TS       |
 | FK refund_of --+ 自引用 SET NULL   |  +-----------------------------------+
 | FK import_batch_id  UUID SET NULL  |
 | FK created_by/updated_by ---> users|  +--------------------------------------+
 |    created_at/updated_at TS NN     |  | exchange_rates  (无外键, 独立缓存表)  |
 +------------------------------------+  |--------------------------------------|
   ^            |                         | PK id BIGSERIAL                      |
   +------------+ refund_of               |    source VC(32) / rate NUM(18,8)    |
                                          |    base CHAR(3) / symbol CHAR(3)     |
                                          |    date DATE   UNIQUE(base,symbol,date)
                                          +--------------------------------------+

 图例：NN = NOT NULL；VC(n) = VARCHAR(n)；TS = TIMESTAMP WITHOUT TIME ZONE（naive UTC）；
      箭头从子表指向父表（外键方向），括号内是 ON DELETE 行为；NOACT = NO ACTION。
      transfer_pair_id 没有外键，是两条转账腿共用的自由 UUID（决策 §1.2）。
      唯一约束：ledger_invites.code、transactions(transfer_pair_id, transfer_role)、
      import_rows(batch_id, row_no)、exchange_rates(base, symbol, date)、
      import_batches(ledger_id) WHERE status='parsing'（部分唯一）。
```

注意：目标 schema 里 `users` 与 `finance_sources` 之间**不再有环**（现状的环来自 `users.default_source_id`，backend/app/models/user.py:20）。环消失的直接好处是 `Base.metadata.drop_all` 不再抛 `CircularDependencyError`，测试 teardown 干净（现状问题见 `../current-design/02-database.md` §2.5、§7）。

---

## 3. 约束与不变量：数据库保证 / 应用层保证 / 无人保证

目标是把现状里"无人保证"的一栏清空。下表逐条对应决策 §2、§10。

### 3.1 数据库保证

| 不变量 | 手段 | 依据 |
|---|---|---|
| `users.email` 唯一 | `ix_users_email` 唯一索引 | 沿用现状 |
| 一人在一本账里最多一行成员 | `pk_ledger_members (ledger_id, user_id)` | 决策 §2 |
| 成员角色只能是 owner / member | `ck_ledger_members_role` | 决策 §2 |
| 邀请码全局唯一、恰好 6 个数字字符 | `uq_ledger_invites_code` + `ck_ledger_invites_code_digits`（长度 + 嵌套 `replace` 剥数字，见 §1.5） | 决策 §2 |
| 邀请码"已用"的两列同步 | `ck_ledger_invites_used_pair` | 决策 §2 |
| 账户类型五选一 | `ck_finance_sources_type` | 决策 §3 |
| 交易 kind 四选一 | `ck_transactions_kind` | 决策 §10 |
| 金额符号与 kind / transfer_role 一致，且非零 | `ck_transactions_amount_sign` | 决策 §1、§10 |
| transfer 必有 role 与 subtype，非 transfer 必无 | `ck_transactions_transfer_role`、`ck_transactions_transfer_subtype` | 决策 §10 |
| transfer 无分类，其他 kind 必有一级分类 | `ck_transactions_category` | 决策 §1.3、§10 |
| 二级分类不能脱离一级存在 | `ck_transactions_category_l2_needs_l1` | 决策 §1.3 |
| 只有 refund 能有 `refund_of`，且不能指向自己 | `ck_transactions_refund_of`、`ck_transactions_not_self_refund` | 决策 §1.1、§10 |
| 一个 `transfer_pair_id` 最多一条 out、一条 in | `uq_transactions_transfer_pair_role` | 决策 §10 |
| 有对腿就不填 `counterparty` | `ck_transactions_counterparty` | 决策 §10 |
| 删账本级联删账户、交易、导入批次、成员、邀请码 | 五条 `ON DELETE CASCADE` | 决策 §2 |
| 删批次级联删草稿行 | `import_rows.batch_id ON DELETE CASCADE` | 决策 §5 |
| 原单删除后退款行 `refund_of` 置空 | `ON DELETE SET NULL` | 决策 §1.1 |
| 同一账本同时只有一个 parsing 批次 | 部分唯一索引 `uq_import_batches_one_parsing` | 决策 §5 |
| 批次内行号唯一 | `uq_import_rows_batch_row` | 决策 §5 |
| 上传 ≤10 MB、单批 ≤2000 行 | `ck_import_batches_size`、`ck_import_batches_row_count` | 决策 §5 |
| 汇率 (base, symbol, date) 唯一且为正 | `uix_base_symbol_date`、`ck_exchange_rates_rate_positive` | 决策 §8 |

### 3.2 应用层保证（数据库不管）

| 不变量 | 实现要点 | 依据 |
|---|---|---|
| 每本账恰有一个 owner | 建账本时写入 owner 行；`POST /transfer-ownership` 在一个事务内降旧升新；`POST /leave` 拒绝 owner | 决策 §2 |
| 当前用户是该账本成员才能访问 | 所有 `/ledgers/{id}/...` 路由的公共依赖先查 `ledger_members` | 决策 §2 |
| `transactions.ledger_id` 与 `finance_sources.ledger_id` 一致 | 创建 / 改交易时按 `(source_id, ledger_id)` 查账户，查不到就 404 | 决策 §2 |
| 归档账户不能记账、不能作为导入目标 | 创建交易 / 上传导入前检查 `archived = FALSE` | 决策 §3 |
| 有交易或有导入批次的账户不能删除 | `DELETE /sources/{sid}` 先 `COUNT(*)`，非零返回 409 | 决策 §3 |
| 分类 code 合法、二级属于一级、一级收支方向与 kind 匹配 | 校验函数读 `backend/app/core/categories.py` 常量 | 决策 §1.3 |
| `refund_of` 指向同账本、`kind='expense'` 的交易 | 关联时按 `(id, ledger_id, kind)` 查 | 决策 §1.1 |
| 有 `transfer_pair_id` 的两腿只能一起增删改 | 只开放 `/transactions/transfer` 系列接口写这类交易，普通接口拒绝带 pair 的行 | 决策 §1.2 |
| 两腿属于同一账本、账户不同 | transfer 接口内校验 | 决策 §1.2 |
| 乐观并发：`updated_at` 不匹配返回 409 `stale_update` | `UPDATE ... WHERE id = ? AND updated_at = ?`，影响 0 行则 409 | 决策 §2 |
| 每人 ≤10 本账、每本 ≤10 人 | 建账本 / 加入前 `COUNT(*)` | 决策 §2（软限制，见 §待决 D-7） |
| 邀请码未过期、未使用、非本人已在成员 | 加入时按 `code` 查后逐条判断 | 决策 §2 |
| 邀请码一次性 | `UPDATE ledger_invites SET used_by=?, used_at=? WHERE id=? AND used_by IS NULL` 影响行数必须为 1 | 决策 §2 |
| `import_batches` 状态机的合法迁移 | 每个写接口先断言当前状态 | 决策 §5 |
| 提交导入时一个事务建完所有交易 | 单个 `db.commit()` | 决策 §5 |
| 撤销导入时先删交易再删批次 | 见 §6.6 | 决策 §5 |
| 币种是真实 ISO 代码 | 对照 Frankfurter 币种列表校验（现状不校验，backend/app/schemas/currency.py:9 只有正则） | 决策 §8 |
| 邮箱小写归一化 | 注册 / 登录前 `email.lower()` | — |

### 3.3 无人保证（目标态残留）

| 项 | 为什么不管 |
|---|---|
| `transfer_pair_id` 指向的对腿真的存在 | 它没有外键（决策 §1.2 允许单腿）。唯一约束只能保证"最多两腿"，不能保证"要么零腿要么两腿"。应用层只在 transfer 接口里保证成对写入，直接改库可以造出孤儿腿 |
| `category_l1` / `category_l2` 的 code 真的在常量表里 | 分类表在代码里不在库里（决策 §1.3），所以没有外键。改分类常量时需要写数据迁移重映射（决策 §1.3 已明确） |
| 跨腿的币种 / 金额关系 | 决策 §1.2 明确允许两腿金额与币种都不同，本来就没有不变量 |
| `import_rows.flags` 的取值集合 | JSON 列，不做 CHECK；由服务端唯一写入点保证 |
| 已归档账户的历史交易不被再编辑 | 决策没有禁止编辑历史交易，仅禁止新增 |

---

## 4. 索引及其服务的查询

| 索引 | 服务的查询 | 说明 |
|---|---|---|
| `ix_transactions_ledger_occurred (ledger_id, occurred_at DESC, created_at DESC)` | 交易列表主查询：`WHERE ledger_id=? [AND occurred_at BETWEEN ? AND ?] ORDER BY occurred_at DESC, created_at DESC LIMIT ? OFFSET ?`；统计按月汇总 | 决策 §4 的 `from`/`to` 与默认排序都命中它；`created_at` 作为第二排序键保证同一天内顺序稳定、分页不跳行 |
| `ix_transactions_ledger_source (ledger_id, source_id)` | `source_id` 筛选（决策 §4，可多值 → `IN`）；账户余额 `SELECT SUM(amount) WHERE ledger_id=? AND source_id=?`（决策 §3） | 余额是每次读账户列表都要算的，是最热的聚合查询 |
| `ix_transactions_ledger_kind_cat (ledger_id, kind, category_l1)` | `kind` / `category_l1` 筛选（决策 §4）；首页按一级分类汇总（决策 §7） | `category_l2` 的筛选量小，落在这个索引取回的行上再过滤 |
| `ix_transactions_refund_of (refund_of) WHERE refund_of IS NOT NULL` | "这张原单已退多少"：`SELECT SUM(amount) WHERE refund_of = ?`（决策 §1.1 要求每条候选显示已退/可退金额）；原单删除时 `ON DELETE SET NULL` 的反查 | 部分索引：绝大多数行 `refund_of` 为空，只索引退款行 |
| `uq_transactions_transfer_pair_role (transfer_pair_id, transfer_role)` | 既是约束也是索引：`WHERE transfer_pair_id = ?` 取两腿（`PATCH/DELETE /transactions/transfer/{pair_id}`，决策 §1.2） | 前导列就是 `transfer_pair_id`，**不需要**再单独建 `ix_transactions_transfer_pair_id`（现状那个独立索引 backend/migrations/versions/8a4f4d66d893_add_transfer_pair_id_to_transactions.py:30-34 在目标态被它取代） |
| `ix_transactions_import_batch_id (import_batch_id) WHERE import_batch_id IS NOT NULL` | 撤销导入：`DELETE FROM transactions WHERE import_batch_id = ?`（决策 §5） | 部分索引，同上 |
| 无索引：`merchant` / `note` 的 `ILIKE '%q%'` | 决策 §4"ILIKE 足够，不做全文索引" | 前导通配的 `ILIKE` 用不上 B-tree。查询一定带 `ledger_id`，规划器先用 `ix_transactions_ledger_occurred` 收窄到单账本再逐行匹配；一本账几万行的量级下是毫秒级。将来若真的慢，加 `pg_trgm` 的 GIN 索引即可，但那会让 SQLite 测试路径分叉 |
| `ix_finance_sources_ledger_id` | 账户列表 `WHERE ledger_id = ? [AND archived = FALSE]` | 决策 §3 |
| `ix_ledger_members_user_id` | "我有哪些账本"：`SELECT ... FROM ledger_members WHERE user_id = ?` 再 join `ledgers`（决策 §11 `GET /ledgers`）；每个请求的成员鉴权走主键 `(ledger_id, user_id)` | 决策 §2 |
| `uq_ledger_invites_code`（唯一） | 加入账本：`WHERE code = ?`（决策 §2）；生成时的冲突检测 | 唯一约束顺带提供查询路径 |
| `ix_ledger_invites_ledger_id` | 账本设置页列出 / 清理本账本的邀请码 | 决策 §2 |
| `uq_import_rows_batch_row (batch_id, row_no)`（唯一） | review 表格分页：`WHERE batch_id = ? ORDER BY row_no LIMIT ?`（决策 §5、§11 `GET .../rows`） | 前导列 `batch_id` 也服务"这批有多少行" |
| `ix_import_rows_transaction_id` | 撤销后回查、以及"这条交易来自哪一行草稿" | 部分索引 |
| `ix_import_batches_ledger_created (ledger_id, created_at DESC)` | 导入历史列表（决策 §11 `GET /ledgers/{id}/imports`） | — |
| `uq_import_batches_one_parsing (ledger_id) WHERE status='parsing'`（唯一） | 并发控制而非查询：第二个 parsing 批次插入即冲突（决策 §5） | — |
| `ix_exchange_rates_date` | 发生日汇率 `WHERE base=? AND symbol=? AND date <= ? ORDER BY date DESC LIMIT 1`；最新汇率 `ORDER BY date DESC LIMIT 1`（决策 §8） | 沿用初始迁移的索引（e533c88884b7:35）。`uix_base_symbol_date` 的前导列是 `base`，对"按日期回退"的查询更有用，两者并存 |
| `uix_base_symbol_date`（唯一） | upsert 的冲突目标；(base, symbol) 的精确查找 | 沿用现状 |
| `ix_ledgers_created_by` | 运维 / 迁移回填时按创建者找账本 | 低频 |

---

## 5. 迁移计划

### 5.0 前置约定

- 起点是当前 head `8a4f4d66d893`（backend/migrations/versions/8a4f4d66d893_add_transfer_pair_id_to_transactions.py:16）。下面六步是决策 §13 的六个步骤，一步一个 revision，链式串联。
- 下面的 revision id 是**占位**（真实 id 由 `alembic revision` 随机生成），有意义的是文件 slug 与顺序。
- **迁移里不 import 任何 `app.*` 模块**。需要的表结构在迁移文件内用 `sa.table(...)` / `sa.column(...)` 现场声明，需要的常量（默认账本名、分类 code）直接写字面量。允许 import 标准库（`uuid`、`datetime`、`logging`）与 `sqlalchemy`。理由：迁移必须能在任意历史版本的应用代码下重放，一旦 import 应用模型，模型的后续演进会让旧迁移报错。
- 回填里凡是**删行**的地方都不静默执行：先 `SELECT count(*)`，非零就打一条 warning 日志再删。下面第 3、4 步用到的 `delete_and_warn` 就是写在各自迁移文件顶部的这么一段（复制两份，不做成共享模块——迁移之间不互相 import）：

```python
def delete_and_warn(table: str, where: str, why: str) -> None:
    bind = op.get_bind()
    n = bind.execute(sa.text(f"SELECT count(*) FROM {table} WHERE {where}")).scalar_one()
    if n:
        logging.getLogger("alembic.runtime.migration").warning(
            "backfill: deleting %d rows from %s (%s)", n, table, why)
    bind.execute(sa.text(f"DELETE FROM {table} WHERE {where}"))
```

  `table` / `where` 都是迁移文件内的字面量，不来自外部输入，所以 f-string 拼接是安全的。
- 在 `backend/migrations/env.py` 与 `Base.metadata` 上配置同一套命名规则，否则 `batch_alter_table` 无法按名字 drop 约束：

```python
NAMING_CONVENTION = {
    "ix":  "ix_%(column_0_label)s",
    "uq":  "uq_%(table_name)s_%(column_0_name)s",
    "ck":  "ck_%(table_name)s_%(constraint_name)s",
    "fk":  "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk":  "pk_%(table_name)s",
}
# app/core/database.py: Base = declarative_base(metadata=MetaData(naming_convention=NAMING_CONVENTION))
# migrations/env.py:    context.configure(..., render_as_batch=True)
```

  **`ck` 规则的一个坑（必须遵守，否则 §1 的约束名一条都对不上）**：`%(constraint_name)s` 展开的是**你显式传入的 `name` 的完整字符串**，不是"后缀"。所以显式写全名会被再套一层前缀。SQLAlchemy 2.0.49 实测：

```python
sa.CheckConstraint("kind IN ('expense','income','transfer','refund')", name="ck_transactions_kind")
#  -> CONSTRAINT ck_transactions_ck_transactions_kind CHECK (...)      # 双写，错
sa.CheckConstraint("kind IN ('expense','income','transfer','refund')", name="kind")
#  -> CONSTRAINT ck_transactions_kind CHECK (...)                      # 正确，等于 §1.7 DDL
```

  迁移侧同样受影响：Alembic 1.18.4 的 `SchemaObjects.metadata()` 会把 `target_metadata.naming_convention` 带进 `op.create_table` / `batch_op.create_check_constraint` 构造的临时 `MetaData`，而 `backend/migrations/env.py:31` 设的正是 `target_metadata = Base.metadata`，所以迁移里写全名一样会双写。

  因此本文的**书写约定**是：

  | 类型 | convention 是否含 `%(constraint_name)s` | 模型 / 迁移里写什么 | §1 DDL 里显示什么 |
  |---|---|---|---|
  | `ck` | 含 | **只写后缀**：`name="kind"`、`create_check_constraint("amount_sign", ...)` | 全名 `ck_transactions_kind` |
  | `uq` / `fk` / `ix` / `pk` | 不含 | 写全名：`name="uq_transactions_transfer_pair_role"` | 同名，原样保留 |

  显式名对 `uq` / `fk` / `ix` / `pk` 是**原样保留**（这四条规则里没有 `%(constraint_name)s`，SQLAlchemy 遇到已命名对象直接跳过 convention），所以只有 CHECK 需要特殊对待。`drop_constraint` / `batch_op.drop_constraint` 走的是**最终名**，也就是 §1 DDL 里的全名（例如 `b.drop_constraint("ck_transactions_kind", type_="check")`）——创建时写后缀、删除时写全名，这是 convention 的固有不对称，写迁移时注意区分。

- **SQLite 上的 ALTER 限制**：SQLite 只支持 `ADD COLUMN`、`RENAME TO`、`RENAME COLUMN`、`DROP COLUMN`（3.35+），**不支持**加/删约束、改列类型、改可空性。Alembic 在 SQLite 上执行 `create_foreign_key` / `create_check_constraint` / `alter_column(nullable=...)` 会抛 `NotImplementedError`——现状的 `76227e076393` 就因此无法在 SQLite 上跑（`../current-design/02-database.md` §6 第 5 行）。解决办法是 `with op.batch_alter_table("t", schema=None) as batch_op:`：Alembic 会建新表、拷数据、删旧表、改名，从而模拟出 ALTER。**下面每一步凡涉及加列/加约束/改类型的都写成 batch 形式**，这样这条链在 Postgres 和 SQLite 上都能跑完。代价：batch 重建表时必须能看见表的完整定义，因此 `batch_alter_table` 要带上 `copy_from=` 或依赖反射（本项目用反射即可，因为没有 SQLite 不认识的类型）。
- 每一步都能在**空库**上运行：所有回填都是 `UPDATE`/`INSERT ... SELECT` 形式，作用于 0 行时是 no-op。
- 生产执行方式不变：`migrate` 一次性容器跑 `alembic upgrade head`（infra/docker-compose.prod.yml:40）。因为 `env.py` 没有开 `transaction_per_migration`，整条链在 Postgres 上处于**同一个事务**里，任何一步失败会整体回滚、`alembic_version` 不前进（`../current-design/02-database.md` §1.4）。

### 5.1 第 1 步：建新表

**revision** `b1f3c2a10d41_create_ledgers_llm_and_import_tables`，`down_revision = '8a4f4d66d893'`。

`upgrade()`：按依赖顺序 `op.create_table(...)` 建 `ledgers`、`ledger_members`、`ledger_invites`、`user_llm_settings`、`import_batches`、`import_rows`，DDL 与 §1.2–§1.5、§1.8、§1.9 一致，随后 `op.create_index(...)` 建 §4 里属于这些表的索引（含两个部分唯一索引，用 `postgresql_where=sa.text("status = 'parsing'")`）。

注意：`import_batches.source_id` 引用 `finance_sources`，`import_rows.matched_transaction_id` 引用 `transactions`——这两张表此时已存在（现状就有），所以外键可以在 `create_table` 里内联。

```python
op.create_table(
    "ledgers",
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("name", sa.String(100), nullable=False),
    sa.Column("base_currency", sa.CHAR(3), nullable=False),
    sa.Column("created_by", sa.Uuid(), nullable=False),
    sa.Column("created_at", sa.DateTime(), nullable=False),
    sa.Column("updated_at", sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint("id", name="pk_ledgers"),
    sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_ledgers_created_by_users"),
    sa.CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),                    # -> ck_ledgers_name_not_blank
    sa.CheckConstraint("base_currency = upper(base_currency)", name="base_currency_upper"),  # -> ck_ledgers_base_currency_upper
)
op.create_index("ix_ledgers_created_by", "ledgers", ["created_by"])
# ... ledger_members / ledger_invites / user_llm_settings / import_batches / import_rows 同理
op.create_index(
    "uq_import_batches_one_parsing", "import_batches", ["ledger_id"], unique=True,
    postgresql_where=sa.text("status = 'parsing'"),
    sqlite_where=sa.text("status = 'parsing'"),
)
```

**空库可运行**：是，纯 DDL。`exchange_rates` 是否在本步一并补建见 §待决 D-1。

### 5.2 第 2 步：为每个现有用户建默认账本

**revision** `b1f3c2a10d42_backfill_default_ledgers`。

```python
import uuid
from datetime import datetime, timezone

def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    ledgers = sa.table(
        "ledgers",
        sa.column("id", sa.Uuid()), sa.column("name", sa.String()),
        sa.column("base_currency", sa.CHAR(3)), sa.column("created_by", sa.Uuid()),
        sa.column("created_at", sa.DateTime()), sa.column("updated_at", sa.DateTime()),
    )
    members = sa.table(
        "ledger_members",
        sa.column("ledger_id", sa.Uuid()), sa.column("user_id", sa.Uuid()),
        sa.column("role", sa.String()), sa.column("joined_at", sa.DateTime()),
    )

    rows = conn.execute(sa.text("SELECT id, base_currency FROM users ORDER BY created_at")).fetchall()
    ledger_rows, member_rows = [], []
    for user_id, base_currency in rows:
        ledger_id = uuid.uuid4()
        ledger_rows.append({
            "id": ledger_id, "name": "我的账本",
            "base_currency": (base_currency or "USD").upper(),
            "created_by": user_id, "created_at": now, "updated_at": now,
        })
        member_rows.append({
            "ledger_id": ledger_id, "user_id": user_id,
            "role": "owner", "joined_at": now,
        })
    if ledger_rows:
        op.bulk_insert(ledgers, ledger_rows)
        op.bulk_insert(members, member_rows)
```

账本名 `"我的账本"`、`role='owner'` 都来自决策 §2；`base_currency` 复制自 `users.base_currency`（决策 §13 第 2 步）。用 `sa.table` 现场声明而不是 import 模型，符合 §5.0 的规则。

**空库可运行**：是，`rows` 为空时两次 `bulk_insert` 都跳过。

### 5.3 第 3 步：账户与交易归属账本

**revision** `b1f3c2a10d43_scope_sources_and_transactions_to_ledger`。

```python
def upgrade() -> None:
    # --- finance_sources ---
    with op.batch_alter_table("finance_sources") as b:
        b.add_column(sa.Column("ledger_id", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("opening_balance", sa.Numeric(18, 4), nullable=False, server_default="0"))
        b.add_column(sa.Column("created_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))

    op.execute("""
        UPDATE finance_sources
           SET ledger_id = (SELECT l.id FROM ledgers l
                             WHERE l.created_by = finance_sources.user_id
                             ORDER BY l.created_at LIMIT 1)
    """)
    op.execute("UPDATE finance_sources SET created_by = user_id, updated_by = user_id WHERE created_by IS NULL")
    op.execute("UPDATE finance_sources SET updated_at = created_at WHERE updated_at IS NULL")
    op.execute("UPDATE finance_sources SET default_currency = upper(default_currency)")  # ck_..._currency_upper 之前

    with op.batch_alter_table("finance_sources") as b:
        b.alter_column("ledger_id",  nullable=False)
        b.alter_column("created_by", nullable=False)
        b.alter_column("updated_by", nullable=False)
        b.alter_column("updated_at", nullable=False)
        b.alter_column("default_currency", type_=sa.CHAR(3), existing_type=sa.String(3))
        b.create_foreign_key("fk_finance_sources_ledger_id_ledgers", "ledgers", ["ledger_id"], ["id"], ondelete="CASCADE")
        b.create_foreign_key("fk_finance_sources_created_by_users", "users", ["created_by"], ["id"])
        b.create_foreign_key("fk_finance_sources_updated_by_users", "users", ["updated_by"], ["id"])
        # CHECK 只写后缀，convention 补 ck_finance_sources_ 前缀（§5.0）
        b.create_check_constraint("type",
            "type IN ('checking','savings','credit','cash','other')")            # -> ck_finance_sources_type
        b.create_check_constraint("currency_upper",
            "default_currency = upper(default_currency)")                      # -> ck_finance_sources_currency_upper
        b.create_check_constraint("name_not_blank", "length(trim(name)) > 0")   # -> ck_finance_sources_name_not_blank
        b.drop_column("user_id")          # 旧索引随列消失（Alembic 库里叫 ix_accounts_user_id，create_all 库里叫 ix_finance_sources_user_id）
    op.create_index("ix_finance_sources_ledger_id", "finance_sources", ["ledger_id"])

    # --- transactions ---
    with op.batch_alter_table("transactions") as b:
        b.add_column(sa.Column("ledger_id", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("created_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))

    op.execute("""
        UPDATE transactions
           SET ledger_id = (SELECT fs.ledger_id FROM finance_sources fs
                             WHERE fs.id = transactions.source_id)
    """)
    op.execute("UPDATE transactions SET created_by = user_id, updated_by = user_id WHERE created_by IS NULL")
    op.execute("UPDATE transactions SET updated_at = created_at WHERE updated_at IS NULL")
    # 只可能命中开发用 SQLite 库里的孤儿行（见下方说明）；Postgres 上必然是 0 行。
    # 删之前先数一遍并打 warning，别让回填漏洞被静默吞掉（同 §待决 D-9）。
    delete_and_warn("transactions", "ledger_id IS NULL", "no resolvable ledger_id")

    with op.batch_alter_table("transactions") as b:
        b.alter_column("ledger_id",  nullable=False)
        b.alter_column("created_by", nullable=False)
        b.alter_column("updated_by", nullable=False)
        b.alter_column("updated_at", nullable=False)
        b.alter_column("currency", type_=sa.CHAR(3), existing_type=sa.String(3))
        b.create_foreign_key("fk_transactions_ledger_id_ledgers", "ledgers", ["ledger_id"], ["id"], ondelete="CASCADE")
        b.create_foreign_key("fk_transactions_created_by_users", "users", ["created_by"], ["id"])
        b.create_foreign_key("fk_transactions_updated_by_users", "users", ["updated_by"], ["id"])
        b.drop_column("user_id")
    op.drop_index("ix_transactions_occurred_at", table_name="transactions")   # 两种来源同名，可直接 drop
    # 这一条不能直接 drop_index：初始迁移建的名字是 ix_transactions_account_id
    # (e533c88884b7_initial_schema_users_accounts_.py:71)，而 026ee0aecb66_rename_accounts_to_finance_sources.py:27
    # 只 rename 了列、没 rename 索引 —— 所以 Alembic 建出的库里是旧名，create_all 建的开发库里
    # 才是 ORM 名 ix_transactions_source_id。两个都试着 drop。
    for _idx in ("ix_transactions_account_id", "ix_transactions_source_id"):
        op.execute(sa.text(f'DROP INDEX IF EXISTS {_idx}'))
    op.create_index("ix_transactions_ledger_occurred", "transactions",
                    ["ledger_id", sa.text("occurred_at DESC"), sa.text("created_at DESC")])
    op.create_index("ix_transactions_ledger_source", "transactions", ["ledger_id", "source_id"])
```

`opening_balance` 用 `server_default="0"` 加列，这样已有行不会违反 NOT NULL；模型侧同样声明 `server_default`，保持 DDL 与迁移一致（其余新列先加成可空、回填后再收紧）。回填 SQL 全部是相关子查询而非 `UPDATE ... FROM`，因为后者是 Postgres 方言、SQLite 不认。

**这一步 drop 旧索引时必须当心命名分叉**：现状里 Alembic 建出的 Postgres 库和 `create_all` 建出的开发 SQLite 库，索引名并不相同——重命名迁移只改了表名/列名，Postgres 在 rename 时保留索引原名。对照表见 `../current-design/02-database.md` 的索引命名分叉表（第 370–372 行三处：`ix_accounts_user_id` / `ix_transactions_account_id` / `idx_transactions_transfer_pair`）。因此：

| 要处理的索引 | Alembic 库里的名字 | `create_all` 库里的名字 | 本步的写法 |
|---|---|---|---|
| `transactions(occurred_at)` | `ix_transactions_occurred_at` | 同名 | `op.drop_index(...)` 直接删 |
| `transactions(source_id)` | `ix_transactions_account_id` | `ix_transactions_source_id` | 两个名字都跑一遍 `DROP INDEX IF EXISTS` |
| `finance_sources(user_id)` | `ix_accounts_user_id` | `ix_finance_sources_user_id` | 不用管，随 `drop_column("user_id")` 自动消失 |
| `transactions(transfer_pair_id)` | `idx_transactions_transfer_pair` | `ix_transactions_transfer_pair_id`（模型上是 `index=True`，backend/app/models/transaction.py:24） | 第 4 步同样两个名字都跑 `DROP INDEX IF EXISTS` |

`DROP INDEX IF EXISTS` 在 Postgres 与 SQLite 上都受支持，所以"两个名字都试"是安全的；如果换成 `op.drop_index("ix_transactions_source_id")`，在生产 Postgres 上会直接报 `index "ix_transactions_source_id" does not exist`，让整条链回滚到第 2 步。

**空库可运行**：是。**有数据库可运行**：是，前提是第 2 步已给每个用户建了账本。

关于 `DELETE FROM transactions WHERE ledger_id IS NULL`：**在 Postgres 上它不会命中任何行**——`transactions.source_id` 是 `NOT NULL` 且带外键（`backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:60,67`），指向已删账户的孤儿交易在库层面就不可能存在，回填的相关子查询必然取到值。它只对**开发用 SQLite 库**有意义：SQLite 默认 `PRAGMA foreign_keys = OFF`，现状也没有在连接上打开它（`../current-design/02-database.md` §1.2 第 53 行），所以本地库里确实可能留下指向已删账户的行。为了不把"回填逻辑写错"和"本来就是脏数据"混为一谈，删除前先 `SELECT count(*)` 并打 warning 日志（与 §待决 D-9 对 `amount = 0` 行的处理一致）：如果生产迁移日志里出现这条 warning，说明回填 SQL 本身有问题，应当中止排查而不是接受静默删除。

### 5.4 第 4 步：交易的 kind、分类、退款、导入列

**revision** `b1f3c2a10d44_transactions_kind_category_refund`。

```python
def upgrade() -> None:
    with op.batch_alter_table("transactions") as b:
        b.alter_column("description", new_column_name="note", existing_type=sa.String(),
                       type_=sa.String(500))                      # 决策 §1.4
        b.alter_column("merchant", existing_type=sa.String(), type_=sa.String(200))
        b.add_column(sa.Column("kind", sa.String(16), nullable=True))
        b.add_column(sa.Column("transfer_role", sa.String(8), nullable=True))
        b.add_column(sa.Column("transfer_subtype", sa.String(16), nullable=True))
        b.add_column(sa.Column("counterparty", sa.String(100), nullable=True))
        b.add_column(sa.Column("refund_of", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("category_l1", sa.String(32), nullable=True))
        b.add_column(sa.Column("category_l2", sa.String(32), nullable=True))
        b.add_column(sa.Column("import_batch_id", sa.Uuid(), nullable=True))

    # --- 回填（决策 §13 第 4 步）---
    # (0) 币种大写归一化，否则稍后的 ck_transactions_currency_upper 加不上
    op.execute("UPDATE transactions SET currency = upper(currency)")

    # (a) amount = 0 的历史行不满足新的符号约束；现状无任何符号/非零约束，这类行只可能是测试数据。
    #     与第 3 步一样先计数打 warning，再删（§待决 D-9）
    delete_and_warn("transactions", "amount = 0", "zero amount")

    # (b) 同一 pair 的两腿符号相同会撞 UNIQUE(transfer_pair_id, transfer_role)，先打散成单腿
    op.execute("""
        UPDATE transactions SET transfer_pair_id = NULL
         WHERE transfer_pair_id IN (
               SELECT transfer_pair_id FROM transactions
                WHERE transfer_pair_id IS NOT NULL
                GROUP BY transfer_pair_id
               HAVING COUNT(DISTINCT CASE WHEN amount < 0 THEN 'out' ELSE 'in' END) < COUNT(*)
         )
    """)

    # (c) kind
    op.execute("""
        UPDATE transactions
           SET kind = CASE WHEN transfer_pair_id IS NOT NULL THEN 'transfer'
                           WHEN amount < 0 THEN 'expense'
                           ELSE 'income' END
    """)
    # (d) transfer 的 role 与 subtype
    op.execute("UPDATE transactions SET transfer_role = CASE WHEN amount < 0 THEN 'out' ELSE 'in' END WHERE kind = 'transfer'")
    op.execute("UPDATE transactions SET transfer_subtype = 'plain' WHERE kind = 'transfer'")
    # (e) 分类：expense -> other，income -> other_income（决策 §1.3 的常量 code）
    op.execute("UPDATE transactions SET category_l1 = 'other'        WHERE kind = 'expense'")
    op.execute("UPDATE transactions SET category_l1 = 'other_income' WHERE kind = 'income'")

    with op.batch_alter_table("transactions") as b:
        b.alter_column("kind", nullable=False)
        b.create_foreign_key("fk_transactions_refund_of_transactions", "transactions",
                             ["refund_of"], ["id"], ondelete="SET NULL")
        b.create_foreign_key("fk_transactions_import_batch_id_import_batches", "import_batches",
                             ["import_batch_id"], ["id"], ondelete="SET NULL")
        b.create_unique_constraint("uq_transactions_transfer_pair_role", ["transfer_pair_id", "transfer_role"])
        # §1.7 里的 12 条 CHECK，表达式一字不差地照抄过来；suffix 是去掉
        # ck_transactions_ 前缀后的后缀，前缀由 naming convention 补（§5.0）
        for suffix, expr in TRANSACTION_CHECKS:    # 迁移文件内的字面量元组列表
            b.create_check_constraint(suffix, expr)
    # 被 uq_transactions_transfer_pair_role 的索引取代。名字同样分叉：Alembic 库里是
    # idx_transactions_transfer_pair（8a4f4d66d893_add_transfer_pair_id_to_transactions.py:30-34），
    # create_all 库里是 ORM 名 ix_transactions_transfer_pair_id —— 见 §5.3 的命名分叉表。
    for _idx in ("idx_transactions_transfer_pair", "ix_transactions_transfer_pair_id"):
        op.execute(sa.text(f'DROP INDEX IF EXISTS {_idx}'))
    op.create_index("ix_transactions_ledger_kind_cat", "transactions", ["ledger_id", "kind", "category_l1"])
    op.create_index("ix_transactions_refund_of", "transactions", ["refund_of"],
                    postgresql_where=sa.text("refund_of IS NOT NULL"),
                    sqlite_where=sa.text("refund_of IS NOT NULL"))
    op.create_index("ix_transactions_import_batch_id", "transactions", ["import_batch_id"],
                    postgresql_where=sa.text("import_batch_id IS NOT NULL"),
                    sqlite_where=sa.text("import_batch_id IS NOT NULL"))
```

`TRANSACTION_CHECKS` 是**写在这个迁移文件顶部的字面量列表**，内容是 §1.7 DDL 里那 12 条 CHECK 的 `(后缀, SQL 表达式)` 二元组（含决策 §10 的全部 7 条），照抄字符串、不 import 任何应用代码（§5.0）。这里存的是**后缀**而不是全名——`create_check_constraint` 会经过 naming convention，`ck_transactions_` 前缀由它补上（§5.0），拼出来正好是 §1.7 DDL 里的全名：

```python
TRANSACTION_CHECKS = [
    ("kind",                 "kind IN ('expense','income','transfer','refund')"),   # -> ck_transactions_kind
    ("amount_sign",          "..."),                                                # -> ck_transactions_amount_sign
    ("transfer_role",        "(kind = 'transfer') = (transfer_role IS NOT NULL)"),  # -> ck_transactions_transfer_role
    # ... 共 12 条，表达式一字不差地照抄 §1.7
]
```

对应地，`downgrade()` 里按名字删这些约束时要写**全名**（`b.drop_constraint("ck_transactions_kind", type_="check")`），因为 drop 走的是落库后的真实名字。

**空库可运行**：是（所有 `UPDATE`/`DELETE` 作用于 0 行）。**有数据库可运行**：是，(0)(a)(b) 三条清洗语句正是为此而写；决策 §13 已允许"粗回填"。回填顺序很重要——必须先归一化币种大小写、再删零金额行、再打散冲突 pair、再赋 kind，最后才加 CHECK，否则加约束时会因存量数据失败。

### 5.5 第 5 步：删除 `transaction_tags`

**revision** `b1f3c2a10d45_drop_transaction_tags`。

```python
def upgrade() -> None:
    op.drop_table("transaction_tags")      # 索引与外键随表消失

def downgrade() -> None:
    op.create_table(
        "transaction_tags",
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("tag", sa.String(64), nullable=False),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("transaction_id", "tag"),
        comment="Transaction tags for flexible categorization",
    )
```

依据决策 §1.3、§13 第 5 步。标签数据不迁移到别处——分类是固定常量表，与标签没有对应关系（决策 §1.3 明确不做标签）。现状里这张表已经有孤儿行（`../current-design/02-database.md` §8.4），丢弃无损失。

**空库可运行**：是。

### 5.6 第 6 步：`users` 收尾

**revision** `b1f3c2a10d46_users_base_currency_as_ledger_default`。

```python
def upgrade() -> None:
    op.execute("UPDATE users SET base_currency = upper(base_currency)")   # 先归一化，再加 CHECK
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("language", sa.String(8), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE users SET updated_at = created_at WHERE updated_at IS NULL")
    with op.batch_alter_table("users") as b:
        b.alter_column("updated_at", nullable=False)
        b.alter_column("base_currency", type_=sa.CHAR(3), existing_type=sa.String(3))
        b.alter_column("email", type_=sa.String(255), existing_type=sa.String())
        b.alter_column("password_hash", type_=sa.String(255), existing_type=sa.String())
        # 同样只写后缀，convention 补 ck_users_ 前缀（§5.0）
        b.create_check_constraint("base_currency_upper", "base_currency = upper(base_currency)")  # -> ck_users_base_currency_upper
        b.create_check_constraint("language", "language IS NULL OR language IN ('zh','en')")     # -> ck_users_language
        b.drop_constraint("fk_users_default_source", type_="foreignkey")   # 由 76227e076393 建立
        b.drop_column("default_source_id")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("COMMENT ON COLUMN users.base_currency IS "
                   "'Default base currency for newly created ledgers (see ledgers.base_currency)'")
```

决策 §13 第 6 步只要求"把 `users.base_currency` 保留为新建账本默认币种"——语义上的保留，schema 上只加一句注释。同一步顺带做完 `users` 的其余收尾：`language`（决策 §11 的 `PATCH /me` 要改语言）、`updated_at`，以及删掉 `default_source_id`（决策 §3 之后账户归账本，这个列已无处安放；替代方案见 §待决 D-2）。删掉它同时消除了 `users ↔ finance_sources` 的外键环（§2）。注意语句顺序：`upper()` 归一化必须在 `create_check_constraint("base_currency_upper", ...)`（落库名 `ck_users_base_currency_upper`）之前执行，否则存量小写币种会让加约束失败。第 3 步与第 4 步在加 `ck_finance_sources_currency_upper` / `ck_transactions_currency_upper` 之前也各跑了一条同样的 `upper()` 语句，三步保持对称。这两列在 API 层其实已被 `CurrencyCode`（`^[A-Z]{3}$`，backend/app/schemas/currency.py:9）挡住、存量值大概率已是大写，而 `users.base_currency` 用的是没有 pattern 的裸 `str`（backend/app/schemas/user.py:12,35）——但迁移不应依赖这种非对称的假设，三条语句在空库上都是 no-op。

**空库可运行**：是。

### 5.7 迁移链总览

| 步 | revision（占位 id）| slug | 关键动作 | 空库可跑 | 有数据可跑 |
|---|---|---|---|---|---|
| 1 | `b1f3c2a10d41` | create_ledgers_llm_and_import_tables | 建 6 张新表 + 索引（+ `exchange_rates`，取决于 §待决 D-1）| 是 | 是 |
| 2 | `b1f3c2a10d42` | backfill_default_ledgers | 每用户一本"我的账本" + owner 成员 | 是（0 行） | 是 |
| 3 | `b1f3c2a10d43` | scope_sources_and_transactions_to_ledger | `ledger_id` / `created_by` / `updated_by` / `updated_at` / `opening_balance`；删 `user_id` | 是 | 是 |
| 4 | `b1f3c2a10d44` | transactions_kind_category_refund | `description→note`；kind / 转账 / 分类 / 退款 / 导入列 + 全部 CHECK | 是 | 是（含三条清洗语句） |
| 5 | `b1f3c2a10d45` | drop_transaction_tags | 删 `transaction_tags` | 是 | 是 |
| 6 | `b1f3c2a10d46` | users_base_currency_as_ledger_default | `language` / `updated_at`；删 `default_source_id` | 是 | 是 |

每步的 `downgrade()` 策略（**只用于开发环境**；生产回退靠恢复备份）：

| 步 | downgrade 做什么 | 是否无损 |
|---|---|---|
| 1 | 逆序 `op.drop_table(...)` 六张表，索引随表消失 | 无损（表本来就是新建的） |
| 2 | `DELETE FROM ledger_members;` 再 `DELETE FROM ledgers;` | **破坏性**：第 2 步之后用户新建的账本与回填的账本无法区分，会一并删掉 |
| 3 | 加回 `user_id`（从 `created_by` 回填）、删掉新列与新约束、恢复旧索引名（`ix_transactions_account_id` / `ix_accounts_user_id`） | 有损：被 `delete_and_warn` 删掉的孤儿行不可恢复 |
| 4 | 按 §1.7 的**全名** drop 全部新 CHECK / UNIQUE / FK / 索引与新列（§5.0），`note` 改回 `description`，`op.create_index("idx_transactions_transfer_pair", ...)` | 有损：`amount = 0` 的行与被打散的 `transfer_pair_id` 不可恢复 |
| 5 | `op.create_table("transaction_tags", ...)` 重建空表 | 有损：标签数据不可恢复（这正是决策 §13 允许删表的前提） |
| 6 | 加回 `default_source_id` 与外键（值全为 NULL），删掉 `language` / `updated_at` 与两条 CHECK | 有损：`default_source_id` 的值不可恢复 |

---

## 6. 数据生命周期

所有删除仍是硬删除；唯一的软删除标记是 `finance_sources.archived`（决策 §3）。

### 6.1 注册

`POST /auth/register`（受 `REGISTRATION_OPEN` 控制，决策 §9）→ 一个事务内：`INSERT users` → `INSERT ledgers`（name `"我的账本"`、`base_currency = users.base_currency`）→ `INSERT ledger_members (role='owner')`（决策 §2）。不再自动建账户，也不再有 `default_source_id` 的自动赋值（现状 backend/app/api/finance_sources.py:43-49 的那段逻辑消失）。用户随后必须先建一个资金账户才能记账。

### 6.2 建账本 / 加入 / 退出 / 转让

账本的成员集合只由四个写入点改变：`POST /ledgers` 建账本（同一事务写 `ledgers` 一行 + `ledger_members` 一行 `role='owner'`）；`POST /ledgers/join` 凭邀请码加入（写 `ledger_members` 一行 `role='member'`）；`DELETE /{id}/members/{uid}`（owner 踢人）与 `POST /{id}/leave`（member 自己退出，owner 被拒）各删一行；`POST /{id}/transfer-ownership` 不增减行数，只在同一事务里把旧 owner 降为 member、新 member 升为 owner。`POST /{id}/invites` 只写 `ledger_invites`（10 分钟有效），不改成员表。

加入的写入序列（决策 §2）：`SELECT ... FROM ledger_invites WHERE code = ?` → 校验未过期、未使用、该用户不是成员、账本人数 < 10 → `INSERT ledger_members` → `UPDATE ledger_invites SET used_by=?, used_at=? WHERE id=? AND used_by IS NULL`（影响 0 行则整体回滚并报"邀请码已被使用"）。错码尝试限流：同一用户 15 分钟 5 次（决策 §2），计数放在进程内存或 Redis，不入库。

### 6.3 邀请码过期清理

邀请码全表唯一且只有 6 位数字（100 万空间），必须清理，否则生成时的冲突率会持续上升。规则：

- **惰性清理**：每次 `POST /ledgers/{id}/invites` 生成新码之前，先 `DELETE FROM ledger_invites WHERE ledger_id = ? AND (used_at IS NOT NULL OR expires_at < now())`。
- **兜底**：随导入批次超时扫描一起跑的后台任务每天执行一次 `DELETE FROM ledger_invites WHERE used_at IS NOT NULL OR expires_at < now()`。

清理后码可以被重新分配，这不产生歧义——邀请码从生成到失效最长 10 分钟（决策 §2）。

### 6.4 账户归档 / 删除

账户只有两个状态，由 `archived` 布尔列表示：`POST /{lid}/sources` 建出的是 `archived = false`，`PATCH {"archived": true/false}` 在两个状态间双向切换（归档可撤销）。`DELETE /{lid}/sources/{sid}` 是第三条路径，只在 `COUNT(transactions WHERE source_id = ?) = 0` **且** `COUNT(import_batches WHERE source_id = ?) = 0` 时真的删一行，否则返回 `409 source_has_transactions`。

归档后：不能作为新交易的 `source_id`、不能作为导入目标（决策 §3），历史交易与余额照常显示。删除只在账户干净时允许（决策 §3）；数据库侧 `transactions.source_id` 是 NO ACTION，会在应用层漏判时报外键错误兜底（§1.7.2）。

### 6.5 交易删除

| 场景 | 动作 | 依据 |
|---|---|---|
| 普通交易（`transfer_pair_id IS NULL`） | `DELETE FROM transactions WHERE id = ? AND ledger_id = ?` | — |
| 有对腿的转账 | 只能 `DELETE /ledgers/{id}/transactions/transfer/{pair_id}`：`DELETE ... WHERE transfer_pair_id = ? AND ledger_id = ?`，一次删两腿；对单腿交易走普通接口 | 决策 §1.2 |
| 被退款引用的原支出 | 原单行删除，指向它的退款行**保留**，`refund_of` 由 `ON DELETE SET NULL` 置空 | 决策 §1.1 |
| 被导入草稿引用的交易 | `import_rows.matched_transaction_id` / `transaction_id` 由 `ON DELETE SET NULL` 置空，草稿行保留 | §1.9 |

相比现状（backend/app/api/transactions.py:447-459 按 `transfer_pair_id` 批量删、且服务端对"转账"没有概念），目标态的差别是：删两腿走独立端点，`kind`/`transfer_role` 让服务端真的知道自己在删什么。

### 6.6 导入批次的丢弃与撤销

```
  POST /imports (multipart)
   |
   v
 [uploaded] --后台任务开始--> [parsing] --解析成功--> [ready] --commit--> [committed]
                                 |                      |                    |
                                 | 解析失败 / 服务重启   | DELETE = 丢弃      | DELETE = 撤销
                                 v                      v                    v
                             [failed] --POST retry--> [parsing]           (整批消失)
                                 |
                                 +-- DELETE = 丢弃
```

- **丢弃**（`ready` / `failed` / `uploaded`）：`DELETE FROM import_batches WHERE id = ?`，`import_rows` 随 `ON DELETE CASCADE` 消失。此时还没有任何正式交易。
- **撤销**（`committed`，决策 §5"可整批撤销，不限时限，撤销前确认并显示条数"）：一个事务内，**先删交易再删批次**：

```sql
BEGIN;
  SELECT count(*) FROM transactions WHERE import_batch_id = :bid;   -- 给用户确认的条数
  DELETE FROM transactions WHERE import_batch_id = :bid AND ledger_id = :lid;
  DELETE FROM import_batches WHERE id = :bid AND ledger_id = :lid;  -- import_rows 随 CASCADE
COMMIT;
```

顺序选择：**应用层在事务内先删交易再删批次**，列上的 `ON DELETE SET NULL` 只是兜底（万一有人绕过 API 直接删批次，交易不会丢，只是失去归属）。理由：如果反过来依赖 CASCADE 删交易，一次误删批次就会连带删掉用户已经手工编辑过的交易，不可逆；SET NULL 则至少保住数据。撤销时若某条交易是转账的一腿（还款行，决策 §5），两腿都带同一个 `import_batch_id`，会被同一条 `DELETE` 一起删掉。

- **服务重启**：启动时执行 `UPDATE import_batches SET status='failed', error_code='interrupted' WHERE status='parsing'`（决策 §5），这样 `uq_import_batches_one_parsing` 不会被僵尸批次长期占用。

### 6.7 账本删除

owner 调用 `DELETE /ledgers/{id}`（决策 §2）。数据库侧五条 CASCADE 会自动清理 `ledger_members`、`ledger_invites`、`finance_sources`、`transactions`、`import_batches`（进而 `import_rows`），但应用层仍在同一事务内按依赖顺序显式删除，保证在 SQLite 上（外键默认不生效，见 `../current-design/02-database.md` §1.2）行为一致：

```
import_rows -> transactions -> import_batches -> finance_sources -> ledger_invites -> ledger_members -> ledgers
```

删除前要求二次确认并显示"将删除 N 笔交易、M 个账户"。

### 6.8 用户删除

**本版本不提供接口**（决策 §11 的"我"分组只有 `GET /me`、`PATCH /me` 与 LLM 设置四个端点，没有 `DELETE /me`）。因此 `created_by` / `updated_by` / `ledgers.created_by` 上的外键都是 NO ACTION，不会产生悬垂引用。若运维必须删除某个用户，正确顺序是：先把该用户 owner 的账本转让或删除 → 删 `ledger_members` 行 → 删 `user_llm_settings`（有 CASCADE）→ 最后删 `users`；只要该用户在任何账本里创建过交易，最后一步就会因 `fk_transactions_created_by_users` 失败——这是有意的，防止把别人账本里的历史记录删出空洞。

---

## 7. 类型、大小与时间

### 7.1 类型映射

| 用途 | SQLAlchemy | Postgres | SQLite（测试） |
|---|---|---|---|
| 主键 / 外键 | `sa.Uuid()` | `UUID`（16 字节） | `CHAR(32)` 无连字符十六进制 |
| 金额 | `sa.Numeric(18, 4)` | `NUMERIC(18,4)`，精确十进制，最多 14 位整数 | 声明 `NUMERIC(18,4)`，实际按 REAL/INTEGER 亲和性存，读出时 SQLAlchemy 重建为 4 位小数 `Decimal` |
| 汇率 | `sa.Numeric(18, 8)` | `NUMERIC(18,8)` | 同上 |
| 置信度 | `sa.Numeric(3, 2)` | `NUMERIC(3,2)` | 同上 |
| 币种 | `sa.CHAR(3)` | `CHAR(3)`（bpchar） | `CHAR(3)`，长度不强制 |
| 枚举 | `sa.String(8/16/32)` + CHECK | `VARCHAR(n)` | 长度不强制，但 CHECK 生效 |
| 日期 | `sa.Date` | `DATE` | 文本 `YYYY-MM-DD` |
| 时间戳 | `sa.DateTime` | `TIMESTAMP WITHOUT TIME ZONE` | 文本 `YYYY-MM-DD HH:MM:SS.ffffff` |
| JSON | `JSON().with_variant(JSONB, "postgresql")` | `JSONB` | `JSON`（TEXT） |
| 自增主键 | `BigInteger().with_variant(Integer, "sqlite")` | `BIGSERIAL` | `INTEGER PRIMARY KEY`（rowid 别名） |

`CHAR(3)` 的一个细节：Postgres 的 `bpchar` 会把短值补空格，`length()` 又会忽略尾部空格——所以不要用 `length(currency) = 3` 做校验，用 `currency = upper(currency)` 加类型长度即可（§1.1）。所有币种在写入前由应用层 `.upper()`（沿用现状 backend/app/api/transactions.py:95）。

金额精度沿用现状的 `NUMERIC(18,4)`（backend/app/models/transaction.py:19）：4 位小数足够所有 ISO 货币的最小单位，14 位整数部分远超个人记账量级。pydantic 侧继续用 `decimal_places=4` 拒绝更细的小数。

### 7.2 时间

**沿用现状的选择：naive UTC datetime**（`TIMESTAMP WITHOUT TIME ZONE` + Python 侧 UTC 值），不改成 `timestamptz`。理由：

1. 现状全部时间列都是这个形状（backend/app/models/user.py:21、finance_source.py:22、transaction.py:25），改成 `timestamptz` 需要一次全表 ALTER，而收益为零——本应用没有任何"按用户时区展示时刻"的需求（`occurred_at` 是日期，决策 §0.7 明确不加交易时间）。
2. 时间戳只用于排序、审计和乐观并发比较，三者都不关心时区。

但要修一个现状的坑：`datetime.utcnow` 在 Python 3.12 起已弃用，新代码统一用

```python
def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
```

`occurred_at` 仍是客户端给的日历日 `YYYY-MM-DD`，不存时刻、不存时区（决策 §0.7）。汇率的 `date` 同样是日历日，由 Frankfurter 给出（决策 §8）。

### 7.3 `updated_at` 与乐观并发

`updated_at` **由应用层在每次写入时赋值**，不设 `server_default` 也不设 `onupdate`（沿用现状"没有任何 server_default / onupdate"的做法，见 `../current-design/02-database.md` §1.3）。原因是它要参与决策 §2 的乐观并发：

```sql
UPDATE transactions
   SET note = :note, ..., updated_by = :uid, updated_at = :now
 WHERE id = :tid AND ledger_id = :lid AND updated_at = :client_seen_updated_at;
-- 影响 0 行 -> 409 {"detail": "...", "code": "stale_update"}
```

用数据库触发器或 `onupdate` 生成新值也可以，但用应用层赋值能保证"写进去的那个值"和"返回给客户端的那个值"在同一个 Python 变量里，不必再 `SELECT` 一次。三张表参与：`transactions`、`finance_sources`、`ledgers`（决策 §2）。序列化要保留微秒（`isoformat()` 默认就保留），客户端把收到的字符串原样回传，避免精度截断导致永远 409。

### 7.4 容量

一本账本预期 10 人以内、每年数千笔交易（决策 §2 软限制）。所有列表接口都带 `ledger_id` 前缀过滤 + offset 分页；`import_rows` 单批 ≤2000 行（决策 §5）。`exchange_rates` 每天每个货币对一行，永久保留也只是每年几万行。没有分区、没有归档策略。

---

## 8. 测试如何建表

### 8.1 SQLite 内存库（默认路径）

沿用现状：`backend/tests/conftest.py:10` 在导入任何 `app` 模块前把 `DATABASE_URL` 设成 `sqlite:///:memory:`，`conftest.py:47-50` 建专用引擎，`conftest.py:58-69` 的 session 级 fixture 调 `Base.metadata.create_all` / `drop_all`。目标态对这条路径的要求：

1. **`create_all` 必须能建出全部十张表和全部 CHECK**。这就是 §1 里每条 CHECK 都避开 Postgres 专有语法的原因：不用 `~` 正则、不用 `ILIKE`、不用 `::` 转型、不用 `ANY(ARRAY[...])`；`length()`、`trim()`、`upper()`、`replace()`、`IN`、`BETWEEN`、布尔等价比较在两个方言里语义一致。另一个必须绕开的坑是**裸 `LIKE` 的大小写敏感性两边不同**（SQLite 对 ASCII 不敏感、Postgres 敏感），所以 `ck_user_llm_settings_base_url` 先 `lower()` 再匹配（§1.2）；同理 `code` 的"6 位数字"用嵌套 `replace` 而不是字符串区间（§1.5）。JSON 列用 `with_variant`（§1.11），自增主键用 `with_variant`（§1.10）。
2. **CHECK 在 SQLite 上是真的生效的**，所以约束测试可以全部跑在内存库上：插入 `kind='expense', amount=100` 必须抛 `IntegrityError`。这是把不变量写进数据库而不是只写在 pydantic 里的最大回报——现状的 `finance_sources.type` 只有注释没有 CHECK（backend/app/models/finance_source.py:19），SQLite 上根本测不到。
3. **外键在 SQLite 上默认不生效**，现状没有任何 `PRAGMA foreign_keys=ON`（`../current-design/02-database.md` §1.2）。目标态在测试引擎上挂一个连接事件把它打开，否则 `ON DELETE CASCADE` / `SET NULL` 的行为在测试里完全测不到：

```python
from sqlalchemy import event

@event.listens_for(_test_engine, "connect")
def _enable_sqlite_fk(dbapi_conn, _record):
    dbapi_conn.execute("PRAGMA foreign_keys=ON")
```

4. **约束名必须与 §1 的 DDL 一字不差**，否则 `batch_alter_table` 的 `drop_constraint` 和 downgrade 会按错名字找对象。加一个用例把落库名和文档对齐（这条正是 §5.0 那个 `ck` 前缀双写坑的护栏）：

```python
def test_check_constraint_names():
    names = {c.name for c in Transaction.__table__.constraints
             if isinstance(c, CheckConstraint)}
    assert names == {
        "ck_transactions_kind", "ck_transactions_amount_sign",
        "ck_transactions_transfer_role", "ck_transactions_transfer_subtype",
        # ... §1.7 的 12 条全名
    }   # 若模型里把 CHECK 写成全名，这里会看到 ck_transactions_ck_transactions_kind
```

5. `drop_all` 不再抛 `CircularDependencyError`——环随 `users.default_source_id` 一起消失（§2）。
6. 仍不强制 `VARCHAR(n)` 长度，所以"note ≤500 字"这类长度规则的测试必须打在 pydantic schema 上，不能指望数据库。

### 8.2 Postgres 迁移测试（`postgres` marker）

决策 §13 要求"有 Postgres 迁移测试"。方案：

在 backend/pyproject.toml **已有的** `[tool.pytest.ini_options]` 段（backend/pyproject.toml:47-52，已含 `testpaths` / `python_files` / `python_classes` / `python_functions` / `asyncio_mode`）里补一行 `markers`，不要另起一个同名表头：

```toml
markers = ["postgres: 需要一个真实 Postgres 实例（环境变量 TEST_POSTGRES_URL）"]
```

fixture 思路（`backend/tests/conftest.py`，两个 fixture）：

- `postgres_url`（session 级）：读环境变量 `TEST_POSTGRES_URL`，没有就 `pytest.skip`，这样默认的纯 SQLite 回路不受影响。
- `migrated_db`（函数级）：用 `isolation_level="AUTOCOMMIT"` 的管理连接 `CREATE DATABASE wallet_test_<随机 hex>`，把库名替换进 URL；构造一个 `alembic.Config`（`script_location` 指向 `backend/migrations`、`sqlalchemy.url` 指向新库），调 `alembic.command.upgrade(cfg, "head")`，`yield` 新库 URL，`finally` 里 `DROP DATABASE ... WITH (FORCE)`。每个用例一个全新空库，用例之间零耦合；要测"有数据的升级"就先 `command.upgrade(cfg, "8a4f4d66d893")` 灌数据、再 `upgrade("head")`。

必须覆盖的用例（全部 `@pytest.mark.postgres`）：

| 用例 | 断言 |
|---|---|
| 空库 `upgrade head` | 六步全部执行，`alembic_version` = 最后一个 revision |
| 空库 `upgrade head` 后再 `downgrade base` | 不报错，表全部消失（验证每个 `downgrade` 都写对了） |
| 有数据的库升级 | 先在 head `8a4f4d66d893` 上灌入：2 个用户、每人 2 个账户、若干交易（含一对正确的转账、一对同号的错误转账、一条 `amount = 0`、一条 `source_id` 指向已删账户的孤儿行）、若干 `transaction_tags`；升级后断言：每人恰好一本账本且是 owner、`finance_sources.ledger_id` / `transactions.ledger_id` 全部非空且一致、`kind` 回填正确、同号 pair 被打散成单腿、零金额行被删、`transaction_tags` 不存在 |
| schema 与模型一致 | 升级后用 `alembic revision --autogenerate` 的比较 API（`compare_metadata`）断言 diff 为空——防止迁移与模型漂移，这是现状最大的隐患（现状模型改过而没有对应迁移，`../current-design/02-database.md` §6）。本断言以 §待决 D-1 采纳建议默认值（第 1 步一并 `create_table` 建 `exchange_rates`）为前提；若 D-1 决定继续不落库，则模型里也不能有 `exchange_rates`，否则这条断言必然失败 |
| 约束真的生效 | 逐条插入违反 §1.7.1 七条约束的行，断言 `IntegrityError`；插入合法行断言成功 |

CI 里用一个 `postgres:15-alpine` service 提供 `TEST_POSTGRES_URL`；本地开发用 `infra/docker-compose.dev.yml` 已有的 db 容器（它把 5432 发布到宿主机）。没有该环境变量时这些测试自动 skip，`pytest -m "not postgres"` 保持纯 SQLite 的快速回路。

---

## 待决

以下问题在 [`00-decisions.md`](./00-decisions.md) 里没有覆盖，本文按"建议默认值"书写但**未拍板**，需要在决策记录里补一条后再定稿。

| # | 问题 | 建议默认值 |
|---|---|---|
| D-1 | 决策 §10 把 `exchange_rates` 列入目标表清单、§8 说"缓存表沿用现状"，但这张表在现状里已被 `5ca7fe6e37db` 删除，链上并不存在；六步迁移里也没有建它的位置 | 在第 1 步一并 `create_table`，形状沿用初始迁移（§1.10）。若决定继续不落库、每次实时调 Frankfurter，则从目标表清单里划掉这张表，十张表变九张 |
| D-2 | `users.default_source_id` 删除后，"记一笔"表单的默认账户从哪来 | 不入库：前端按当前账本在 `localStorage` 记住上次使用的账户 id。若要服务端记忆，可加 `ledger_members.default_source_id`（每人每账本一个），但这是新增列，需决策确认 |
| D-3 | `import_rows` 的日期列名：决策 §5 字段清单写作 `date`，但 `transactions` 用的是 `occurred_at` | DB 列用 `occurred_at`（与交易表一致、避开与类型名同名），LLM 输出 JSON 与 API 字段保持决策 §6 的 `date` |
| D-4 | `user_llm_settings` 的密钥列名：决策 §6 写作 `api_key` | 列名用 `api_key_encrypted`，避免被误读为明文；不额外存 `last4`，回显时解密取尾 4 位 |
| D-5 | 同一账本内账户是否允许重名 | 允许（不加唯一约束），创建时若同名则在响应里带一个 warning 由前端提示。加 `UNIQUE (ledger_id, lower(name))` 会让"招商银行"这类同名不同卡号的场景很别扭 |
| D-6 | 已用 / 已过期邀请码何时删 | §6.3 的双保险：生成新码前惰性清理本账本的，外加每日一次全表清理 |
| D-7 | "每人 ≤10 本账、每本 ≤10 人"是否需要数据库约束 | 只做应用层 `COUNT(*)` 校验。数据库侧要做需要触发器，代价与收益不匹配 |
| D-8 | 视觉解析路径的页面缩略图存哪里 | 不入库：解析时把页面 PNG 落在批次的临时目录，批次删除时一并清理，`import_rows.source_ref` 记页码即可。具体由 [`05-import-and-llm.md`](./05-import-and-llm.md) 定 |
| D-9 | 迁移第 3/4 步对回填不出 `ledger_id` 的行、以及 `amount = 0` 的历史行采取删除 | 保持删除（现状只有测试数据，决策 §13 允许粗回填）；本文已把 `delete_and_warn`（§5.0）写进两步，删前先计数打 warning。若上线前认为不能容忍任何静默删除，可把 warning 改成 `raise RuntimeError` 让迁移中止 |

---

## 另见

- [./README.md](./README.md) — 目标设计总览与文档索引
- [./00-decisions.md](./00-decisions.md) — 决策记录（唯一事实来源）
- [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域模型、状态机与端到端流程
- [./03-backend-api.md](./03-backend-api.md) — 后端结构与全部接口定义
- [./04-frontend.md](./04-frontend.md) — 信息架构、页面与 API 客户端
- [./05-import-and-llm.md](./05-import-and-llm.md) — 解析流水线、提示词、schema 与标记算法
- [../current-design/02-database.md](../current-design/02-database.md) — 现状数据库设计（本文所有"现状"引用的出处）
- [../current-design/01-domain-and-flows.md](../current-design/01-domain-and-flows.md) — 现状领域模型
- [../current-design/03-backend-api.md](../current-design/03-backend-api.md) — 现状接口
- [../current-design/06-known-issues.md](../current-design/06-known-issues.md) — 现状已知问题（本文修掉的那些）
