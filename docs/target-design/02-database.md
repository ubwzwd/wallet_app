# 02 — 数据库设计（目标）

> 本文回答的问题：v3.0 的数据库里有哪些表、每张表的完整 DDL 长什么样、哪些规则由数据库兜底、哪些只能由应用层保证、每个索引服务于哪条查询、从今天的 head `8a4f4d66d893` 怎么一步步迁到目标 schema、一条数据从产生到消失经历了什么、测试在什么样的库上跑。
>
> 本文的每个决定都可以追溯到 [`00-decisions.md`](./00-decisions.md) 的某一节，标注形如"（决策 §1.2）"。凡描述**现状**处均带 `path:line` 引用，指向仓库当前代码；凡描述**目标**处一律用 DDL / 伪代码表达，仓库里目前没有对应实现。现状的完整描述见 [`../current-design/02-database.md`](../current-design/02-database.md)。
>
> **本版按决策 §14.20–§14.52 修订（2026-09-09 至 09-11）**。相对上一版的实质变化，全部是删旧立新而不是加注：
>
> - **删表**：上一版的第 2 张表——每用户一份的模型配置（决策 §14.25：应用不接入 LLM，没有模型设置、没有 API key），DDL、ER 图、差异表、迁移、生命周期、索引一并删除。
> - **`import_batches` / `import_rows` 按决策 §5 重写**：批次只剩"谁、往哪个账户、传了什么名字多大的 CSV、skill 版本、状态 `ready`/`committed`、行数、警告"，草稿行只剩标准 CSV 的 11 个字段加标记与关联。解析、进度、分块、视觉、原始响应、批次错误三列（决策 §14.9、§14.12、§14.14、§14.15、§14.17、§14.23、§14.24 均已作废）全部不存在。
> - **`ledger_invites` 去掉"已用"两列与 `code` 的唯一索引**（决策 §14.29）：表里永远只有有效的码，用掉即删、过期即删、owner 作废也是删行。
> - **`users` 加 `display_name VARCHAR(40)`**（决策 §14.40）。
> - **`finance_sources.type` 四选一** `checking` / `credit` / `cash` / `other`（决策 §14.48，不再有第五种），并新增 `archived_at`（决策 §14.50）。
> - **新表 `transaction_events`**（决策 §14.51）：交易操作记录，只追加，随交易级联删除。
> - **没有任何文件系统状态**：不保存上传的账单文件，上传目录、上传卷、目录清理全部取消（决策 §14.28）。
> - **转账配对 / 拆开**（决策 §14.34）落在 `transactions` 的 `transfer_pair_id` 与 `counterparty` 两列上，由既有的 `UNIQUE (transfer_pair_id, transfer_role)` 与互斥 CHECK 兜底（§1.6.3）。
> - 02 章原有的待决七条（D-3 至 D-9）已由决策 §14.29、§14.40、§14.41 全部裁定或作废，本章不再有待决项。
>
> 关于篇幅：本文长于最初给写作者的 500–800 行参考区间，这是**有意保留**而不是漏了裁剪——决策 §14.8 明确"各章的行数目标只是参考，不作为验收项"，且不得为压行数删除被点名要求的内容、也不要拆附录。十张表的完整 DDL、六步迁移的可运行代码与 Postgres 迁移测试方案必须一次给全，读者才能照着实现。

技术栈不变：SQLAlchemy 2.0 同步引擎 + Alembic + Postgres 15，测试用 SQLite 内存库（backend/pyproject.toml:13-14,21）。

---

## 0. 总览：目标表清单与对现状的差异

目标 schema 共十张表：决策 §10 列出的九张，加上决策 §14.51 新增的 `transaction_events`（同时，决策 §14.25 取消了上一版的模型配置表，所以张数与上一版持平）。

| # | 表 | 现状 | 说明 |
|---|---|---|---|
| 1 | `users` | 已有 | 去掉 `default_source_id`，加 `display_name` / `language` / `updated_at`（决策 §14.6、§14.40） |
| 2 | `ledgers` | **新增** | 账本，基准币种的归属者（决策 §2） |
| 3 | `ledger_members` | **新增** | 账本成员与角色（决策 §2） |
| 4 | `ledger_invites` | **新增** | 6 位一次性邀请码；用掉即删、过期即删、作废即删，没有"已用"两列、`code` 不建唯一索引（决策 §2、§14.29） |
| 5 | `finance_sources` | 已有 | 归属从用户改为账本，加 `opening_balance` / `archived_at` 等；`type` 四选一 `checking`/`credit`/`cash`/`other`（决策 §3、§14.48、§14.50） |
| 6 | `transactions` | 已有 | 加 kind / 分类 / 转账 / 退款 / 导入等列（决策 §1、§10） |
| 7 | `import_batches` | **新增** | 一次标准 CSV 导入（决策 §5）；只记文件名与大小，**不保存文件**（决策 §14.28） |
| 8 | `import_rows` | **新增** | 导入草稿行（决策 §5）；含 `counterparty`（决策 §14.10），日期列叫 `occurred_at`（决策 §14.41） |
| 9 | `transaction_events` | **新增** | 交易操作记录，只追加、随交易级联删除（决策 §14.51） |
| 10 | `exchange_rates` | **新建（重建）** | Frankfurter 日汇率缓存。现状这张表已被迁移 `5ca7fe6e37db` 删除，目标态按决策 §14.1 用**新形状**重建，不是沿用现状（§1.10） |

删除的表：`transaction_tags`（决策 §1.3"现有 `transaction_tags` 表、`?tag=` 筛选、标签输入框全部移除"）。现状模型见 backend/app/models/transaction_tag.py:11-20。

**本轮从目标 schema 里去掉的表**：上一版的第 2 张表（每用户一份的模型配置）。决策 §14.25 决定应用不接入任何大模型——没有 API key、没有模型设置、没有服务端解析——这张表连同 `/me` 下的模型设置系列接口一起取消。它是**新增表**、现状库里从来没有过，所以不需要任何 drop 迁移，只是从迁移第 1 步的建表清单里拿掉（§5.1）。

### 0.1 列级差异

**新增表**：`ledgers`、`ledger_members`、`ledger_invites`、`import_batches`、`import_rows`、`transaction_events`、`exchange_rates`。最后一张是**重建**：现状里它在 backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25 被 drop 掉了；目标态按决策 §14.1 重新定义列与主键（复合主键 `(date, base, symbol)`、没有自增 `id`、没有 `source` 列、新增 `fetched_at`），**不**把初始迁移里的旧形状原样搬回来。

**删除表**：`transaction_tags`。

`import_rows` 里 `counterparty VARCHAR(100) NULL` 是评审后追加的列（决策 §14.10，提交单腿转账时写入 `transactions.counterparty`）。

**本轮从 `import_rows` 删掉的两列**：页码列（上一版用来把草稿行对上页面缩略图）随决策 §14.25 作废缩略图一并删除；置信度列同样删除——应用不解析账单，也就没有置信度可言。决策 §5 原话是"不再有置信度、页码、分块、原始响应、批次错误等列"。`import_batches` 删掉的列更多，逐列对照见 §1.7。

**改名列**：

| 表 | 现状列 | 目标列 | 依据 |
|---|---|---|---|
| `transactions` | `description`（backend/app/models/transaction.py:22） | `note` | 决策 §1.4 |

**删除列**：

| 表 | 列 | 现状证据 | 原因 |
|---|---|---|---|
| `users` | `default_source_id` | backend/app/models/user.py:20 | 决策 §14.6 明确删除：账户归属账本、一个用户可属于多本账（决策 §3、§2）之后这一列语义失效；决策 §11 的 `PATCH /me` 只剩默认币种与语言。默认账户改由前端本地记住上次使用的账户（决策 §14.6） |
| `finance_sources` | `user_id` | backend/app/models/finance_source.py:17 | 由 `ledger_id` + `created_by` 取代（决策 §2 归属段） |
| `transactions` | `user_id` | backend/app/models/transaction.py:17 | 同上 |

**新增列**：

| 表 | 新增列 | 依据 |
|---|---|---|
| `users` | `display_name`、`language`、`updated_at` | `display_name VARCHAR(40) NULL` 由决策 §14.40 要求：`PATCH /me` 可改，没填时界面显示邮箱 `@` 前的部分，成员退出后照旧显示、不匿名化；`language VARCHAR(8) NULL` 由决策 §14.6 要求（`PATCH /me` 可改，NULL = 跟随系统），取值范围见决策 §0.4、§11；`updated_at` 是审计列 |
| `finance_sources` | `ledger_id`、`opening_balance`、`archived_at`、`created_by`、`updated_by`、`updated_at`；`type` 收敛为四取值 `checking`/`credit`/`cash`/`other` | 决策 §3、§14.48、§14.50 |
| `transactions` | `ledger_id`、`kind`、`category_l1`、`category_l2`、`transfer_role`、`transfer_subtype`、`counterparty`、`refund_of`、`import_batch_id`、`created_by`、`updated_by`、`updated_at` | 决策 §1、§2、§5、§10 |
| `ledger_invites` | `created_at` | 决策 §14.6（新表要有创建时间） |

**取值收窄的列**：`finance_sources.type` 上一版是五取值，决策 §14.48 定为**四取值** `checking` / `credit` / `cash` / `other`（新加坡没有储蓄户口与活期户口之分，"储蓄卡"就是 `checking`），迁移把存量的旧值一律改写成 `checking`（§5.3）。

**保持不变**：`transactions.amount`（`NUMERIC(18,4)`）、`transactions.occurred_at`（`DATE`，决策 §0.7、§14.32 明确不加时刻、不带时区）、`transactions.merchant`、`transactions.transfer_pair_id`（仍可空、仍无外键）、`users.email` / `password_hash` / `base_currency`。

---

## 1. 表结构与 DDL

下面给出的是 **Postgres** DDL，也就是 Alembic 迁移在生产库上最终建出来的形状；同一份 schema 由 SQLAlchemy 模型描述，测试库（SQLite）由 `Base.metadata.create_all` 建出（§8）。约定：

- 所有主键都是 `UUID`（`sa.Uuid()`，Python 侧 `uuid.uuid4` 默认值），两张例外：`ledger_members` 是复合主键 `(ledger_id, user_id)`、`exchange_rates` 是复合主键 `(date, base, symbol)`（决策 §14.1，没有代理键）。
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
    display_name   VARCHAR(40),
    base_currency  CHAR(3)      NOT NULL,
    language       VARCHAR(8),
    created_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT ck_users_base_currency_upper CHECK (base_currency = upper(base_currency)),
    CONSTRAINT ck_users_language CHECK (language IS NULL OR language IN ('zh', 'en')),
    CONSTRAINT ck_users_display_name_not_blank
        CHECK (display_name IS NULL OR length(trim(display_name)) > 0)
);
CREATE UNIQUE INDEX ix_users_email ON users (email);
```

列语义：`email` 由应用层在写入前统一 `lower()`，唯一索引因此等价于大小写不敏感（现状不做归一化，是 `../current-design/06-known-issues.md` 记录的问题）。`base_currency` 没有 `DEFAULT`——初始迁移建这一列时就没给 `server_default`（backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:40），迁移第 6 步也不补，默认值由模型的 Python 侧 `default="USD"` 提供（与本节开头"应用层赋值"的约定一致）。它不再是"记账币种"，只是**新建账本时的默认基准币种**（决策 §13 第 6 步）；账本自己的 `ledgers.base_currency` 才是统计口径（决策 §2）。`display_name` 是决策 §14.40 新增的显示名（≤40 字符，`PATCH /me` 可改）：**为 `NULL` 表示没填**，这时所有显示记账人的地方（交易的 `created_by` / `updated_by`、成员列表、导入批次的上传人）都退回显示邮箱 `@` 前的部分；成员退出账本后历史记录里照旧显示他的名字，不做匿名化（决策 §14.40）。数据库只保证"要么为 NULL、要么去空白后非空"，唯一性不做要求——两个人可以叫同一个名字，界面靠邮箱区分。

`language` 为 `NULL` 表示"跟随系统"（决策 §0.4），只允许 `zh` / `en`；界面外观（跟随系统 / 浅色 / 深色）**不入库**，按决策 §14.52 存在浏览器本地。`updated_at` 仅作审计，`PATCH /me` 不做 409 乐观并发（决策 §2 只对 `transactions`、`finance_sources`、`ledgers` 要求）。

### 1.2 `ledgers`

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

### 1.3 `ledger_members`

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

### 1.4 `ledger_invites`

```sql
CREATE TABLE ledger_invites (
    id          UUID       NOT NULL,
    ledger_id   UUID       NOT NULL,
    code        CHAR(6)    NOT NULL,
    created_by  UUID       NOT NULL,
    created_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_ledger_invites PRIMARY KEY (id),
    CONSTRAINT fk_ledger_invites_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_ledger_invites_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT ck_ledger_invites_code_digits
        CHECK (length(code) = 6 AND replace(replace(replace(replace(replace(
               replace(replace(replace(replace(replace(code,
               '0',''),'1',''),'2',''),'3',''),'4',''),
               '5',''),'6',''),'7',''),'8',''),'9','') = ''),
    CONSTRAINT ck_ledger_invites_expiry CHECK (expires_at > created_at)
);
CREATE INDEX ix_ledger_invites_ledger_id ON ledger_invites (ledger_id);
```

列语义：**这张表里永远只有"当前有效的邀请码"**（决策 §14.29）。一行的一生最长 10 分钟，三种死法都是删行：被人用掉（加入成功的同一事务里 `DELETE`）、过期（下次生成或校验时顺手删）、被 owner 主动作废（`DELETE /ledgers/{id}/invites/{code}`，决策 §14.52 A2）。因此表上**没有**"已用人 / 已用时刻"这两列，也没有"已用"状态——上一版为它们准备的外键与配对 CHECK 一并删除。

`code` 是 6 位数字（决策 §2），**不建唯一索引**（决策 §14.29）：唯一性只需要在"当前有效的码"之间成立，而这正是这张表的全部内容。生成时先 `SELECT 1 FROM ledger_invites WHERE code = ? AND expires_at > now()`，撞上就重新摇一个（最多重试若干次）；因为有效码在任一时刻至多几十个、码空间 100 万，撞车概率可以忽略。为什么不加 `UNIQUE (code)`：过期行是靠"下次生成或校验时顺手删"清掉的，全表唯一会让一个躺在表里、逻辑上早已失效的码把新码挡在门外——那是一个数据库替业务发明的约束。校验也只在未过期的码里找：`SELECT ... WHERE code = ? AND expires_at > now()`，命中多行（历史上曾经重复过）时按 `created_at DESC` 取最新一条。

`expires_at = created_at + 10 分钟`（决策 §2），过期判断在应用层用 `expires_at > now()`，数据库不做（`now()` 不是不可变函数，进不了 CHECK 或部分索引谓词）。一次性使用 = 加入的同一个事务里 `INSERT ledger_members` 之后 `DELETE FROM ledger_invites WHERE id = ?`，影响行数必须为 1，否则整体回滚（§6.3）。`ck_ledger_invites_code_digits` 不用正则（SQLite 没有 `~` 运算符，Postgres 的 `~` 又不可移植），改用**嵌套 `replace` 把十个数字字符逐个剥掉、结果必须是空串**：`replace()` 与 `length()` 在 Postgres 和 SQLite 里语义完全一致，两边都能真正挡下 `'12a456'` 这类含非数字字符的值。注意不能写成 `code >= '000000' AND code <= '999999'`——那只是字符串区间比较，`'12a456'` 会因为首字符 `'1'` 落在区间内而通过，属于假保证。

### 1.5 `finance_sources`

```sql
CREATE TABLE finance_sources (
    id                UUID          NOT NULL,
    ledger_id         UUID          NOT NULL,
    name              VARCHAR(100)  NOT NULL,
    type              VARCHAR(32)   NOT NULL,
    default_currency  CHAR(3)       NOT NULL,
    opening_balance   NUMERIC(18,4) NOT NULL DEFAULT 0,
    archived          BOOLEAN       NOT NULL,
    archived_at       TIMESTAMP WITHOUT TIME ZONE,
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
        CHECK (type IN ('checking', 'credit', 'cash', 'other')),
    CONSTRAINT ck_finance_sources_currency_upper
        CHECK (default_currency = upper(default_currency)),
    CONSTRAINT ck_finance_sources_name_not_blank CHECK (length(trim(name)) > 0),
    CONSTRAINT ck_finance_sources_archived_at
        CHECK (archived = (archived_at IS NOT NULL))
);
CREATE INDEX ix_finance_sources_ledger_id ON finance_sources (ledger_id);
```

列语义：账户属于账本、账本内完全共享（决策 §2、§3）。`type` **四选一**——`checking` 储蓄卡 / `credit` 信用卡 / `cash` 现金 / `other` 其他（决策 §3、§14.48）：新加坡没有储蓄户口与活期户口的区分，界面上的"储蓄卡"就是 `checking`，所以第五种取值不存在，迁移把存量旧值一律改写成 `checking`（§5.3）。相对现状（backend/app/models/finance_source.py:19 只有注释、没有 CHECK），这里加上了真正的 CHECK。`opening_balance` 是账户建立时的初始余额，**以账户自己的 `default_currency` 计价**；账户余额 = `opening_balance + Σ convert(t.amount, t.currency → default_currency, 按 t.occurred_at 当日汇率)`，同币种交易不换算（决策 §3、§14.2）。因此**不存**余额列，也不按币种分桶；接口另给一个 `balance_base`＝按**最新**汇率把余额折算到 `ledgers.base_currency`（决策 §14.2，接口形状见 [`03-backend-api.md`](./03-backend-api.md)）。`default_currency` 建后不可改（应用层：`PATCH` 的请求体里没有这个字段）。`archived` 同样没有 `DEFAULT`（初始迁移 e533c88884b7:51 建列时就没给，第 3 步也不补），Python 侧 `default=False`；本表里唯一带 `server_default` 的列是 `opening_balance`，因为它是第 3 步给存量行加的非空列（§5.3）。`archived = TRUE` 的账户不能再记账、不能作为导入目标，历史保留（决策 §3）；有交易的账户不能删除，只能归档——这条由应用层保证，数据库侧 `transactions.source_id` 用 NO ACTION 兜底（§1.6 说明为什么不能用 RESTRICT）。

`archived_at`（决策 §14.50）记归档发生的时刻（naive UTC），账户列表里的归档分组直接显示它（"2026-03-12 归档"）。它与 `archived` 由 `ck_finance_sources_archived_at` 绑死：`archived = TRUE` ⇔ `archived_at IS NOT NULL`。为什么不干脆用 `archived_at IS NULL` 一列代替布尔列：`archived` 是所有查询的过滤条件（`WHERE archived = FALSE`），保留布尔列让索引与代码都直白，多出来的那一列由 CHECK 保证不会说谎。取消归档（`PATCH {"archived": false}`）时把 `archived_at` 置回 NULL——不保留"上次归档时间"，因为界面上没有这个概念。**归档账户不计入净资产与首页合计**（决策 §14.50）：这是读取时的过滤（`WHERE archived = FALSE`），数据库不为此存任何东西。

`default_currency` **创建后不可改**（决策 §14.50）：`PATCH` 的请求体里没有这个字段。理由是账户余额以它计价（决策 §14.2），改币种会让历史折算全部失去意义；要换币种就新建账户、把旧账户归档。

**账本内账户允许同名**（决策 §14.40 关闭 02-D-5）：不加 `UNIQUE (ledger_id, name)`，也不加 `UNIQUE (ledger_id, lower(name))`——"招商银行"这类同名不同卡号的账户是真实场景，按 id 区分，只在界面上提示"已有同名账户"（[`01-domain-and-flows.md`](./01-domain-and-flows.md)）。

### 1.6 `transactions`

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

    -- 决策 §10 的 7 条要求（落成 8 个约束）
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

#### 1.6.1 决策 §10 的 7 条要求对应的 8 个约束

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

表里是 8 行而不是 7 行：决策 §10 的第三条 bullet 一句话写了两件事（`(kind='transfer') = (transfer_role IS NOT NULL)` 与 `(kind='transfer') = (transfer_subtype IS NOT NULL)`），落库时必须是两个独立的 CHECK 对象，所以"7 条要求"对应"8 个约束"。全文凡提到这一组时都按"7 条要求 / 8 个约束"表述（另见 §1.6 DDL 里的注释与 §8.2 的约束测试用例）。

关于 `(kind = 'transfer') = (transfer_role IS NOT NULL)` 这种写法：Postgres 里两侧都是 `boolean`，`=` 就是布尔等价；SQLite 里两侧是 `0/1` 整数，`=` 是整数比较——两个方言得到同一语义。因为 `kind` 是 `NOT NULL`，左侧永不为 NULL，CHECK 不会因"结果为 NULL 视为通过"而漏判。若将来需要更保守的写法，等价形式是：

```sql
CHECK ((kind =  'transfer' AND transfer_role IS NOT NULL) OR
       (kind <> 'transfer' AND transfer_role IS     NULL))
```

`ck_transactions_amount_sign` 顺带蕴含了 `amount <> 0`（现状没有任何符号或非零约束，见 backend/app/models/transaction.py:19），这会影响迁移回填，见 §5.4。

#### 1.6.2 外键删除行为

| 外键 | 行为 | 依据 |
|---|---|---|
| `ledger_id → ledgers.id` | `ON DELETE CASCADE` | 决策 §2"owner 可删除账本（级联删除账户、交易、导入）" |
| `source_id → finance_sources.id` | **NO ACTION**（不写 `ON DELETE`），有交易时禁止删账户由应用层保证 | 决策 §3"有交易的账户不能删除，只能归档" |
| `refund_of → transactions.id` | `ON DELETE SET NULL` | 决策 §1.1"原单被删除时退款行的 `refund_of` 置空" |
| `import_batch_id → import_batches.id` | `ON DELETE SET NULL`（兜底），正常路径由应用层在同一事务内先删交易再删批次 | 决策 §5（撤销 = 删除这批建的所有交易）；见 §6.6 |
| `created_by` / `updated_by → users.id` | NO ACTION | 本版本没有删用户的接口（决策 §11 的"我"分组里没有 `DELETE /me`） |
| `transfer_pair_id` | **无外键**（它不指向任何表，是两腿共用的自由 UUID） | 决策 §1.2；沿用现状（backend/app/models/transaction.py:24 也没有外键） |

**为什么 `source_id` 用 NO ACTION 而不是 RESTRICT**：删除账本时 `ledgers → finance_sources` 和 `ledgers → transactions` 两条 CASCADE 在同一条 `DELETE FROM ledgers` 语句里触发。RESTRICT 在被引用行删除的**当下**立即检查，此时交易行还没删完，会直接报错；NO ACTION 的检查推迟到语句结束，那时交易行已随 CASCADE 消失，检查通过。所以要让"账本级联删除"和"有交易的账户禁止删除"同时成立，`source_id` 必须是 NO ACTION，"禁止删账户"落在应用层（§3）。

#### 1.6.3 列语义

`ledger_id` 冗余于 `source_id → finance_sources.ledger_id`，但所有列表查询都按账本过滤，直接带上它可以省掉一次 join，代价是应用层必须保证两者一致（§3）。`kind` 是唯一的方向来源，符号只是它的推论（决策 §1）。`note` 即原 `description`，≤500 字（决策 §1.4）；`merchant` ≤200 字，搜索、退款匹配、导入去重都靠它。`category_l1` / `category_l2` 存的是 `backend/app/core/categories.py` 常量表里的 code，取值合法性、二级归属一级、一级收支方向与 kind 匹配，全部由应用层校验（决策 §1.3）——**数据库不存分类表，也就没有外键**。`counterparty` 是单腿转账的对方文本（"老婆""工资卡"，决策 §1.2）。`import_batch_id` 非空表示这条交易由某批导入生成（决策 §5）。

**配对与拆开怎么落到这两列上**（决策 §14.34）。两条各自独立的单腿转账（`transfer_pair_id IS NULL`，方向相反、`kind='transfer'`）可以事后配成一笔转账，配好的一对也可以再拆开；两个动作都只改 `transfer_pair_id` 与 `counterparty`，不动金额、日期、账户，也不新建或删除行：

| 动作 | 触发 | 同一个事务里写什么 |
|---|---|---|
| **配对** | `POST /ledgers/{id}/transactions/{tid}/pair`（交易详情的"关联为转账对腿"），或导入 review 里勾选"关联为一笔转账"后提交（决策 §5） | 生成一个新的 `pair_id = uuid4()`，给两行都写 `transfer_pair_id = pair_id`、`counterparty = NULL`；两行的 `updated_by` / `updated_at` 各自刷新 |
| **拆开** | `POST /ledgers/{id}/transactions/transfer/{pair_id}/unpair` | 两行都写 `transfer_pair_id = NULL`；`counterparty` 保持 NULL（用户可事后各自填），两行的 `updated_by` / `updated_at` 各自刷新 |

两条 SQL（配对时的 `tid_new` / `tid_old` 是要配的两行）：

```sql
-- 配对：必须一条 UPDATE 同时命中两行，中间态不能被别的事务看见
UPDATE transactions
   SET transfer_pair_id = :pair_id, counterparty = NULL,
       updated_by = :uid, updated_at = :now
 WHERE ledger_id = :lid AND id IN (:tid_new, :tid_old);   -- 影响行数必须 = 2

-- 拆开
UPDATE transactions
   SET transfer_pair_id = NULL, updated_by = :uid, updated_at = :now
 WHERE ledger_id = :lid AND transfer_pair_id = :pair_id;  -- 影响行数必须 = 2
```

数据库替这两个动作兜住两件事，应用层不必自己查重：`uq_transactions_transfer_pair_role (transfer_pair_id, transfer_role)` 保证一个 `pair_id` 上最多一条 `out`、一条 `in`——所以"把一条已经配过对的腿再配一次"必然撞唯一约束；`ck_transactions_counterparty (transfer_pair_id IS NULL OR counterparty IS NULL)` 保证配对成功后不可能残留对方文本——所以"配对时忘了清 `counterparty`"这种漏写会被 CHECK 直接打回，而不是留下一条既有对腿又有对方文本的自相矛盾的行。应用层仍要校验的是数据库看不见的部分：两行同账本、`kind='transfer'`、账户不同、方向相反、都还是单腿（决策 §1.2、§14.34）。

配对与拆开各写一条 `transaction_events`（`paired` / `unpaired`，每腿一条，§1.9）。

### 1.7 `import_batches`

一行 = 一次标准 CSV 导入（决策 §5）。应用**不解析账单、不调用任何大模型、不保存上传的文件**（决策 §14.25、§14.28），所以这张表相对上一版少了一大半列：

```sql
CREATE TABLE import_batches (
    id             UUID         NOT NULL,
    ledger_id      UUID         NOT NULL,
    source_id      UUID         NOT NULL,
    created_by     UUID         NOT NULL,
    source         VARCHAR(8)   NOT NULL,
    filename       VARCHAR(255),
    size_bytes     INTEGER      NOT NULL,
    skill_version  VARCHAR(16)  NOT NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'ready',
    row_count      INTEGER      NOT NULL DEFAULT 0,
    warnings       JSON,
    created_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    committed_at   TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT pk_import_batches PRIMARY KEY (id),
    CONSTRAINT fk_import_batches_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_import_batches_source_id_finance_sources
        FOREIGN KEY (source_id) REFERENCES finance_sources (id),
    CONSTRAINT fk_import_batches_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT ck_import_batches_source
        CHECK (source IN ('csv', 'paste')),
    CONSTRAINT ck_import_batches_status
        CHECK (status IN ('ready', 'committed')),
    CONSTRAINT ck_import_batches_filename
        CHECK ((source = 'csv') = (filename IS NOT NULL)),
    CONSTRAINT ck_import_batches_size
        CHECK (size_bytes > 0 AND size_bytes <= 2097152),
    CONSTRAINT ck_import_batches_row_count
        CHECK (row_count >= 0 AND row_count <= 2000),
    CONSTRAINT ck_import_batches_committed_at
        CHECK ((status = 'committed') = (committed_at IS NOT NULL))
);
CREATE INDEX ix_import_batches_ledger_created
    ON import_batches (ledger_id, created_at DESC);
```

列语义：

- `source` **只有两种**：`csv`（上传文件）与 `paste`（在应用内文本框粘贴 CSV 文本）。决策 §14.47 定下"标准导入格式只有 CSV"，JSON 不再接受，所以上一版清单里的第三种取值不存在；两条入口走的是同一套校验、产出同一形状的批次，`source` 只用来在导入历史里区分来源。
- `filename` 只在 `source='csv'` 时有值（`paste` 没有文件名），由 `ck_import_batches_filename` 绑死。**只记名字，不保存文件**（决策 §14.28）：库里没有任何指向磁盘的路径，服务端也没有上传目录——原始 CSV 在校验完成后即被丢弃，用户要重来就重新上传。
- `size_bytes` 是上传文件或粘贴文本的 UTF-8 字节数，上限 2 MB 直接写进 CHECK（决策 §5、§9）。`row_count` 是校验后落库的草稿行数，上限 2000（决策 §5）。
- `skill_version` 是文件首行 `# version: 2026-09-10` 里的那个版本串，也就是生成这份 CSV 的 skill 所用的分类表版本（决策 §14.30）。它与应用当前的 `CATEGORY_VERSION` 不一致或缺失时**根本不会建批次**——那是 400 `skill_outdated`（决策 §5），所以能进这张表的 `skill_version` 一定等于当时的应用版本；留下这一列是为了事后能看出"这批是哪版分类表导进来的"。形如 `2026-09-10`，`VARCHAR(16)` 足够。
- `status` **只有两个值**：`ready`（校验通过、草稿已落库、等着 review）和 `committed`（已提交建账）。决策 §5 的状态机就是 `ready → committed` 两态：校验是同步完成的（秒级），不通过就返回 400 且**不产生批次**，因此没有 `uploaded` / `parsing` / `failed`，也没有进度、轮询、重试、僵尸批次。相应地，上一版为"同一账本同时只有一个批次在解析"准备的那个部分唯一索引一并删除。
- `warnings` 是整批级别的警告数组（JSON，列类型见 §1.11），例如"第 1 行是表头之外的注释行，已忽略"这类不针对某一行的提示。**行级**的校验说明不进这里，写在各行的 `hint` 上（决策 §5"每一处校验改动都写进该行的 `hint`"）。
- `committed_at` 与 `status` 由 `ck_import_batches_committed_at` 绑死。`created_at` 是上传时刻，`updated_at` 随草稿行编辑刷新（用于导入历史排序与调试），批次本身不参与 409 乐观并发（决策 §2 只对交易、账户、账本要求）。
- `source_id` 是用户上传时选定的目标账户（决策 §5"一份文件对应一个目标账户"，文件里不含账户信息）；外键 NO ACTION，配合"有导入记录的账户不能删除"的应用层规则（§6.4）。

**相对上一版删掉的列**，逐条对应决策：

| 删掉的列 | 为什么 |
|---|---|
| `mime_type` | 只接受 CSV 文本，没有第二种 MIME 可分辨（决策 §14.47） |
| `error_code` / `error_message` | 校验是同步的：不通过就 400 + 按行号的错误清单，压根不建批次，没有"失败的批次"需要存错误（决策 §14.15 已作废） |
| 失败块序号 | 同上，且没有分块（决策 §14.15 已作废） |
| 模型名 / 是否走视觉 / 原始响应 | 应用不接入 LLM（决策 §14.25、§14.24 已作废） |
| 已完成块数 / 总块数 | 没有后台解析就没有进度（决策 §14.23 已作废） |
| `committed_transaction_count` | 提交后要显示"将删除 N 笔"时现算即可（`SELECT count(*) FROM transactions WHERE import_batch_id = ?`，走 `ix_transactions_import_batch_id` 部分索引，一次索引扫描）；存一列冗余计数只会在事后手工删交易时说谎，而撤销确认的两个计数本来就要现算（决策 §14.52 B24，[`03-backend-api.md`](./03-backend-api.md)） |

### 1.8 `import_rows`

```sql
CREATE TABLE import_rows (
    id                     UUID          NOT NULL,
    batch_id               UUID          NOT NULL,
    row_no                 INTEGER       NOT NULL,
    status                 VARCHAR(16)   NOT NULL DEFAULT 'pending',
    occurred_at            DATE,
    amount                 NUMERIC(18,4),
    currency               CHAR(3),
    kind                   VARCHAR(16),
    transfer_role          VARCHAR(8),
    transfer_subtype       VARCHAR(16),
    merchant               VARCHAR(200),
    note                   VARCHAR(500),
    category_l1            VARCHAR(32),
    category_l2            VARCHAR(32),
    source_ref             VARCHAR(200),
    hint                   VARCHAR(500),
    flags                  JSON,
    matched_transaction_id UUID,
    counterpart_source_id  UUID,
    counterparty           VARCHAR(100),
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
    CONSTRAINT ck_import_rows_transfer_role
        CHECK (transfer_role IS NULL OR transfer_role IN ('out', 'in')),
    CONSTRAINT ck_import_rows_transfer_subtype
        CHECK (transfer_subtype IS NULL OR transfer_subtype IN ('plain', 'repayment')),
    CONSTRAINT ck_import_rows_row_no CHECK (row_no >= 1)
);
CREATE UNIQUE INDEX uq_import_rows_batch_row ON import_rows (batch_id, row_no);
CREATE INDEX ix_import_rows_transaction_id
    ON import_rows (transaction_id) WHERE transaction_id IS NOT NULL;
```

列语义：草稿行，**与正式交易表完全隔离**——决策 §5 明确"草稿不能污染正式交易表；JSON 单列在多人 review 时会互相覆盖且没法建外键"。`occurred_at` 到 `source_ref` 这 11 个业务列与标准 CSV 的 11 列固定表头一一对应（决策 §5、§14.47，文件里那一列叫 `date`），后面几列是服务端算出来的提示、标记与关联。

- `row_no` 是这一行在文件里的行号（决策 §14.5 定的列名），从 1 起，指的是**数据行序号**（不含 `# version:` 首行与表头行），校验错误按它回报、review 表格按它排序。
- **`occurred_at` 而不是 `date`**（决策 §14.41 裁定 02-D-3）：数据库列名与 `transactions.occurred_at` 保持一致，类型同样是 `DATE`（无时区的日历日，决策 §14.32）；而**导入文件的列名与接口字段仍然叫 `date`**（决策 §5 的固定表头、[`03-backend-api.md`](./03-backend-api.md) 的草稿行 schema），映射发生在服务层。这样"库里同一件事只有一个名字、对外契约不动"两头都成立。
- 除 `batch_id`、`row_no`、`status` 外所有业务列都可空：日期非法、金额不是数字这类行**不丢**，原样留下并打 `needs_review`，由用户在 review 里补（决策 §5）。
- `status` 三态：`pending`（服务端刚建、用户还没碰）、`edited`（用户在 review 里改过）、`skipped`（用户标了跳过，提交时不建交易）。没有"已确认"这类状态（决策 §14.52 B13：review 里没有"确认这行"）。
- `kind` / `transfer_role` / `transfer_subtype` 在 review 阶段就要能改：提交时它们直接落到 `transactions` 的同名列（[`05-import-and-llm.md`](./05-import-and-llm.md)），不靠金额符号现推，否则用户在 review 里改不了转账方向。
- `source_ref` 是 skill 写回的原文位置（"第 2 页第 14 行""交易流水号 …"），可选，只用于让用户核对，不进 `transactions`。
- `hint` 是服务端写给 review 界面的一句话，**只读、不进** `transactions.note`。它有两个来源：一是校验时每一处自动改动（"币种 XX 无效，已改为账户币种 SGD""kind 无法识别，已按金额符号推断为支出"，决策 §5"不另存原始值"）；二是批内重复行的提示（"本批内有相同的行（第 N 行）"，决策 §14.31）。多处改动拼在一句里，所以放宽到 `VARCHAR(500)`。
- `flags` 是服务端自动标记的字符串数组（JSON，列类型见 §1.11），取值**只有四种**（决策 §5、§14.31、§14.34）：`duplicate`（同账户同日同金额的交易已存在，或对方已是两腿转账的一半）、`refund_candidate`（按决策 §1.1 找到唯一候选原单）、`transfer_candidate`（按决策 §1.2、§14.34 找到可配对的单腿转账）、`needs_review`（校验有过自动改动，或批内有相同行）。上一版还有的"批内重复已合并"标记随决策 §14.31 删除——完全相同的行**全部保留**、都打 `needs_review`，由用户在 review 里取舍。
- `matched_transaction_id` 一列服务两种候选：`refund_candidate` 时指向原支出（提交时写进 `transactions.refund_of`，条件见决策 §14.7），`transfer_candidate` 时指向要配对的那条单腿转账（提交时两行共用一个新的 `transfer_pair_id`，见 §1.6.3 与决策 §14.34）。两种候选互斥（一行的 `kind` 要么是 `refund` 要么是 `transfer`），所以一列够用；候选唯一时才预填，多候选留空、由用户在 review 里选（决策 §5、§14.34）。
- `counterpart_source_id` 是转账行的对手账户（用户在 review 里选，只有转账行可选，决策 §14.52 A5）；提交两腿转账时它决定另一腿建在哪个账户上。
- `counterparty` 是单腿转账的对手文本（"老婆""工资卡"，决策 §14.10）：**校验阶段恒为 NULL**（skill 不猜对手账户，标准 CSV 里没有这个字段，决策 §14.16），由用户在 review 里 `PATCH .../rows/{rid}` 填写（≤100 字），提交时原样写进 `transactions.counterparty`。
- `transaction_id` 在 commit 之后回填，指向这行生成的正式交易（两腿转账回填的是本账户那一腿）。

三个外键都是 `ON DELETE SET NULL`：草稿引用的交易被删掉时，草稿行本身要留下（否则历史批次会缺行）。

**相对上一版删掉的列**：置信度（应用不解析账单，没有置信度可言）与页码（没有页面缩略图，决策 §14.12 已作废），连同它们的两条 CHECK 一并删除——决策 §5 明确列出了这一串被取消的列。

### 1.9 `transaction_events`

交易操作记录（决策 §14.51）：一行 = "谁在什么时候对这条交易做了什么"，**只追加、不修改、不更新**。交易详情页把它按时间倒序显示成一条时间线。

```sql
CREATE TABLE transaction_events (
    id               UUID        NOT NULL,
    ledger_id        UUID        NOT NULL,
    transaction_id   UUID        NOT NULL,
    actor_id         UUID        NOT NULL,
    at               TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    event            VARCHAR(24) NOT NULL,
    changes          JSON,
    import_batch_id  UUID,
    client           VARCHAR(16),
    CONSTRAINT pk_transaction_events PRIMARY KEY (id),
    CONSTRAINT fk_transaction_events_ledger_id_ledgers
        FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE CASCADE,
    CONSTRAINT fk_transaction_events_transaction_id_transactions
        FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE,
    CONSTRAINT fk_transaction_events_actor_id_users
        FOREIGN KEY (actor_id) REFERENCES users (id),
    CONSTRAINT fk_transaction_events_import_batch_id_import_batches
        FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE SET NULL,
    CONSTRAINT ck_transaction_events_event CHECK (event IN (
        'created', 'updated', 'imported', 'paired', 'unpaired',
        'refund_linked', 'refund_unlinked'))
);
CREATE INDEX ix_transaction_events_transaction_at
    ON transaction_events (transaction_id, at DESC);
```

七种 `event`（决策 §14.51 原样，不多不少）：

| event | 什么时候写 | `changes` 里有什么 |
|---|---|---|
| `created` | `POST /ledgers/{id}/transactions` 手工记一笔；`POST .../transactions/transfer` 建两腿转账（每腿一条） | `null`（新建时"变化"就是整行，详情页本来就显示当前值） |
| `imported` | `POST .../imports/{bid}/commit` 建出的每条交易 | `null`；批次记在 `import_batch_id` 上 |
| `updated` | `PATCH` 改了交易的任何字段（含 `PATCH .../transfer/{pair_id}` 改两腿，每腿一条） | 只含真正变了的字段：`{"amount": {"before": "-88.00", "after": "-99.00"}, "merchant": {...}}` |
| `paired` | 两条单腿转账配成一笔（`POST .../{tid}/pair`，或导入提交时按 `transfer_candidate` 配对），**两腿各写一条** | `{"transfer_pair_id": {"before": null, "after": "<pair_id>"}}`，`counterparty` 被清空时一并记 |
| `unpaired` | `POST .../transfer/{pair_id}/unpair` 拆开，**两腿各写一条** | `{"transfer_pair_id": {"before": "<pair_id>", "after": null}}` |
| `refund_linked` | 退款行关联到原单（手工选、`PATCH` 改 `refund_of`、导入提交时按 `refund_candidate` 写入） | `{"refund_of": {"before": null, "after": "<tid>"}}`；写在**退款行**上 |
| `refund_unlinked` | 解除退款关联（`PATCH` 把 `refund_of` 置空） | `{"refund_of": {"before": "<tid>", "after": null}}` |

列语义：

- `changes` 是"字段 → `{before, after}`"的对象（JSON，列类型见 §1.11），**只记真正变了的字段**；金额与日期按接口上的字符串形式记（金额四位小数字符串、日期 `YYYY-MM-DD`），这样时间线不必反查当时的类型约定。`created` / `imported` 为 `NULL`。
- `actor_id` 是操作人；导入提交时是点"提交"的那个人，不是生成 CSV 的聊天工具。外键 NO ACTION（本版本没有删用户的接口，§6.9）。
- `at` 是操作时刻（naive UTC，§7.2），与 `transactions.updated_at` 同一次赋值取同一个值，便于对账。
- `import_batch_id` 只在 `imported` 上有值（`ON DELETE SET NULL` 兜底；撤销导入会连交易一起删，事件随之级联消失，所以正常路径下用不上这个 SET NULL）。
- `client` 是请求头 `X-Client` 的值（`web` / `ios` / `android` …，≤16 字符，可空——没带头就是 NULL）。它只是显示用的来源标签，服务端不校验取值、不据此改变行为。
- `ledger_id` 冗余于 `transactions.ledger_id`，理由与交易表相同：所有读取都先按账本鉴权，带上它可省一次 join；应用层保证两者一致（§3.2）。

**生命周期只有两条规则**：写入时只 `INSERT`，永不 `UPDATE` / `DELETE`；交易被删除时它的事件随 `ON DELETE CASCADE` 一起消失——交易都没了，"这条交易的操作记录"没有留存意义（决策 §14.51"交易删除时级联删除其事件；撤销导入删除交易同样级联"）。删账本时 `ledger_id` 与 `transaction_id` 两条 CASCADE 都会命中，重复但无害。

容量：一条交易一生的事件数是个位数（建一次、改几次、关联一两次），所以不做归档、不做清理；索引 `(transaction_id, at DESC)` 直接服务详情页那一条查询，`GET /transactions/{tid}` 用它取 `events[]`（决策 §14.51）。

### 1.10 `exchange_rates`

**这张表是新建的，不是"沿用现状"**：初始迁移里曾有一张同名表（backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:24-35），但它已在 backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25 被 drop，现状库里根本不存在。目标态按**决策 §14.1** 重新定义形状（列、主键都与旧表不同）：

```sql
CREATE TABLE exchange_rates (
    date        DATE          NOT NULL,
    base        CHAR(3)       NOT NULL,
    symbol      CHAR(3)       NOT NULL,
    rate        NUMERIC(18,8) NOT NULL,
    fetched_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_exchange_rates PRIMARY KEY (date, base, symbol),
    CONSTRAINT ck_exchange_rates_rate_positive CHECK (rate > 0),
    CONSTRAINT ck_exchange_rates_base_upper   CHECK (base = upper(base)),
    CONSTRAINT ck_exchange_rates_symbol_upper CHECK (symbol = upper(symbol)),
    CONSTRAINT ck_exchange_rates_not_self     CHECK (base <> symbol)
);
CREATE INDEX ix_exchange_rates_pair_date ON exchange_rates (base, symbol, date DESC);
COMMENT ON TABLE exchange_rates IS 'Frankfurter daily rate cache; see 00-decisions.md 14.1';
```

与旧表的差别（都来自决策 §14.1）：

| 旧表（`e533c88884b7`，已删） | 目标表 | 为什么 |
|---|---|---|
| `id BIGSERIAL` 代理主键 + `UNIQUE (base, symbol, date)` | 没有代理键，主键就是 `(date, base, symbol)` | 决策 §14.1 直接指定了这个主键；缓存表没有任何东西引用它的行，代理键纯属多余，去掉后少一个索引 |
| `source VARCHAR(32) NOT NULL` | 没有这一列 | 决策 §8 已经把来源固定成 Frankfurter，列里存常量没有意义 |
| 无 | `fetched_at TIMESTAMP NOT NULL` | 决策 §14.1 的"同一 `(base, symbol)` 一小时内不重复请求"需要记住上次抓取时刻 |
| 目标币种叫 `symbol` | 仍叫 `symbol` | 决策 §14.1：与现有 `/rates` 接口的 `symbols` 参数同源，**不用** `quote` 这个名字 |

列语义：一行 = "某天、某个货币对的官方汇率 `1 base = rate symbol`"。这是 Frankfurter 拉回来的**日汇率缓存**，不是"把折算结果落库"——决策 §8 的"读取时计算，不落库"说的是 `converted_amount` 之类的派生值不写进 `transactions`（现状也是这样，见 backend/app/api/transactions.py:117-122 的注释与 `../current-design/02-database.md` §9.2）。

- `date` 是 Frankfurter 给出的**行情日**（周末与节假日没有行情，所以这张表不是每天都有行）。`date` 在 Postgres 与 SQLite 里都只是非保留的类型名，可以直接当列名。
- `rate` 用 `NUMERIC(18,8)`，8 位小数足够所有主流货币对。
- `fetched_at` 是这一行被写进来的时刻（naive UTC，§7.2）。决策 §14.1 的节流规则读它：同一 `(base, symbol)` 的最新一行 `fetched_at` 距今不足 1 小时就不再请求 Frankfurter，直接用库里的值。
- 写入用 upsert：Postgres `INSERT ... ON CONFLICT (date, base, symbol) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at`；SQLite 用等价的 `ON CONFLICT ... DO UPDATE`（3.24+）。一经公布的历史汇率不再变（决策 §8），所以 `DO UPDATE` 实际只刷新 `fetched_at`。
- 查询：**发生日汇率**（交易与统计，决策 §8）`SELECT rate FROM exchange_rates WHERE base=? AND symbol=? AND date <= ? ORDER BY date DESC LIMIT 1`——`date <= ?` 就是决策 §8 说的"无行情日回退到最近一个已公布交易日"；**最新汇率**（账户余额折算，决策 §8、§14.2）把 `date <= ?` 换成不加日期条件的 `ORDER BY date DESC LIMIT 1`。两条都被 `ix_exchange_rates_pair_date (base, symbol, date DESC)` 完整覆盖（前导两列等值 + 第三列有序），所以不再需要旧表那个单列 `ix_exchange_rates_date`。
- 主键 `(date, base, symbol)` 的列序按决策 §14.1 原样写；它对上面两条查询帮不上忙（前导列是 `date`），查询靠 `ix_exchange_rates_pair_date`，主键只负责唯一性和 upsert 的冲突目标。
- 没有任何外键，也没有任何表引用它——删账本、删用户都不影响这张表（生命周期见 §6.8）。

### 1.11 JSON 列为什么用 `JSON().with_variant(JSONB, 'postgresql')`

目标 schema 里有三个 JSON 列：`import_rows.flags`（自动标记数组）、`import_batches.warnings`（整批警告数组）、`transaction_events.changes`（字段 → `{before, after}`）。三列在模型里这样声明：

```python
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

flags    = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
warnings = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
changes  = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
```

原因：直接用 `JSONB` 会让 `Base.metadata.create_all` 在 SQLite 上失败（`JSONB` 是 Postgres 方言专有类型，SQLite 方言不知道怎么编译它），而测试库正是 SQLite 内存库（backend/tests/conftest.py:45-50,67）。`with_variant` 让同一列在 Postgres 上编译成 `JSONB`（可建 GIN 索引、比较高效），在 SQLite 上编译成 `JSON`（实际按 TEXT 存，SQLAlchemy 负责序列化/反序列化）。上面 DDL 里写的 `JSON` 是给 SQLite 看的通用形状，生产迁移里写 `postgresql.JSONB`。本版本对三列都不建 GIN 索引：`flags` 的筛选（review 里的"全部 / 待归类 / 有标记"，决策 §14.52 A4）永远发生在"某个批次的几百行"范围内，先按 `batch_id` 收窄即可；`warnings` 与 `changes` 只按主键 / 外键取回后整体读出，从不作为查询条件。

---

## 2. ER 图

```
 [users]  id / email / password_hash / display_name / base_currency / language
   |                     / created_at / updated_at
   |      （已无 default_source_id，决策 §14.6；display_name 见决策 §14.40）
   |
   | created_by / updated_by / actor_id  (NO ACTION, 出现在 ledgers, ledger_invites,
   |                                      finance_sources, transactions, import_batches,
   |                                      transaction_events)
   v
 +-------------------------+          N +----------------------------------+
 | ledgers                 |<-----------| ledger_members                   |
 |-------------------------| ledger_id  |----------------------------------|
 | PK id            UUID   | (CASCADE)  | PK,FK ledger_id UUID             |
 |    name          VC(100)|            | PK,FK user_id   UUID  ---> users |
 |    base_currency CHAR(3)|            |    role      VC(16) owner|member |
 | FK created_by ---> users|            |    joined_at    TS               |
 |    created_at    TS     |            +----------------------------------+
 |    updated_at    TS     |          N +----------------------------------+
 +-------------------------+<-----------| ledger_invites                   |
   |1                   |1   ledger_id  |----------------------------------|
   |                    |    (CASCADE)  | PK id         UUID               |
   |                    |               |    code       CHAR(6) 无唯一索引 |
   |                    |               | FK created_by ---> users         |
   |                    |               |    created_at TS / expires_at TS |
   |                    |               +----------------------------------+
   |                    |                用掉即删 / 过期即删 / 作废即删，
   |                    |                没有 "已用" 两列（决策 §14.29）
   |                    |
   | ledger_id (CASCADE)|  ledger_id (CASCADE)
   v N                  v N
 +---------------------------+     +--------------------------------------+
 | finance_sources           |     | import_batches                       |
 |---------------------------|     |--------------------------------------|
 | PK id              UUID   |     | PK id           UUID                 |
 | FK ledger_id       UUID NN|     | FK ledger_id    UUID NN (CASCADE)    |
 |    name            VC(100)|     | FK source_id ---> finance_sources    |
 |    type VC(32) checking|  |<----| FK created_by ---> users             |
 |         credit|cash|other | src |    source   VC(8)  csv|paste         |
 |    default_currency CHR(3)|     |    filename VC(255) / size_bytes INT |
 |    open_balance  NUM(18,4)|     |    skill_version VC(16)              |
 |    archived        BOOL   |     |    status   VC(16) ready|committed   |
 |    archived_at     TS     |     |    row_count INT / warnings JSON     |
 | FK created_by/updated_by  |     |    created_at/updated_at/committed_at|
 |    created_at/updated_at  |     +--------------------------------------+
 +---------------------------+           |1                    |1
   |1                    ^               | batch_id (CASCADE)  | import_batch_id
   | source_id           | counterpart_  |                     | (SET NULL)
   | (NO ACTION)         | source_id     v N                   |
   v N                   | (SET NULL)  +-----------------------------------+
 +------------------------------------+ | import_rows                       |
 | transactions                       | |-----------------------------------|
 |------------------------------------| | PK id                    UUID     |
 | PK id               UUID           | | FK batch_id              UUID NN  |
 | FK ledger_id        UUID NN CASCADE| |    row_no INT NN  UNIQUE(batch,no)|
 | FK source_id        UUID NN NOACT  | |    status VC(16) pending|edited|  |
 |    amount    NUMERIC(18,4) NN      | |           skipped                 |
 |    currency  CHAR(3) NN            | |    occurred_at DATE / amount      |
 |    occurred_at DATE  NN            | |    currency/kind                  |
 |    kind      VC(16)  NN            | |    transfer_role/transfer_subtype |
 |    note VC(500) / merchant VC(200) | |    merchant/note                  |
 |    category_l1/category_l2 VC(32)  | |    category_l1/category_l2        |
 |    transfer_role    VC(8)  out|in  | |    source_ref/hint/flags JSON     |
 |    transfer_subtype VC(16) plain|  | |    counterparty VC(100)           |
 |                     repayment      | | FK matched_transaction_id ------->| (SET NULL)
 |    transfer_pair_id UUID (无 FK)   | | FK counterpart_source_id -------->| (SET NULL)
 |    counterparty     VC(100)        | | FK transaction_id --------------->| (SET NULL)
 | FK refund_of --+ 自引用 SET NULL   | |    created_at/updated_at TS       |
 | FK import_batch_id  UUID SET NULL  | +-----------------------------------+
 | FK created_by/updated_by ---> users|
 |    created_at/updated_at TS NN     |  +--------------------------------------+
 +------------------------------------+  | exchange_rates (独立缓存表, 无外键)  |
   ^        |          |1                |--------------------------------------|
   +--------+ refund_of |                | PK date       DATE                   |
                        | transaction_id | PK base       CHAR(3)                |
                        | (CASCADE)      | PK symbol     CHAR(3)                |
                        v N              |    rate       NUMERIC(18,8)          |
 +-------------------------------------+ |    fetched_at TS                     |
 | transaction_events   （只追加）      | +--------------------------------------+
 |-------------------------------------|
 | PK id              UUID             |
 | FK ledger_id       UUID NN (CASCADE)|
 | FK transaction_id  UUID NN (CASCADE)|
 | FK actor_id ---> users              |
 |    at              TS   NN          |
 |    event VC(24) created|updated|    |
 |          imported|paired|unpaired|  |
 |          refund_linked|refund_      |
 |          unlinked                   |
 |    changes         JSON             |
 | FK import_batch_id UUID (SET NULL)  |
 |    client          VC(16)           |
 +-------------------------------------+

 图例：NN = NOT NULL；VC(n) = VARCHAR(n)；CHR(3) = CHAR(3)；NUM(p,s) = NUMERIC(p,s)；
      TS = TIMESTAMP WITHOUT TIME ZONE（naive UTC）；NOACT = NO ACTION。
      每条连线都是一条外键。**方向以线两端的 1 / N 标记为准，不以箭头头部为准**
      （箭头头部只是排版方向，本图里两种画法都出现过）：
        · 标 N 的一端是子表（外键列所在的表），标 1 的一端是父表；
          线旁的标注是子表上那一列的列名与 ON DELETE 行为，例如 ledger_id (CASCADE)。
        · 没有 1 / N 标记的连线是纯外键指向，一律 子表 -> 父表，旁边标 ON DELETE 行为；
          写在字段行里的 FK x ---> y 同理（如 FK created_by ---> users）。
      为省线没有画出来的两条 ledger_id -> ledgers (CASCADE)：transactions 与
      transaction_events 各一条，都写在各自的字段行里（删账本时 transaction_events
      被"账本"和"交易"两条 CASCADE 同时命中，重复但无害）。
      transfer_pair_id 没有外键，是两条转账腿共用的自由 UUID（决策 §1.2）；
      配对 = 两腿写同一个值并清空 counterparty，拆开 = 两腿写回 NULL（§1.6.3、决策 §14.34）。
      唯一 / 主键约束：transactions(transfer_pair_id, transfer_role)（唯一）、
      import_rows(batch_id, row_no)（唯一）、exchange_rates(date, base, symbol)（主键，决策 §14.1）。
      ledger_invites.code **不建唯一索引**（决策 §14.29），import_batches 也不再有
      "同一账本只允许一个批次在解析"的部分唯一索引（没有解析阶段，决策 §5）。
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
| 邀请码恰好 6 个数字字符 | `ck_ledger_invites_code_digits`（长度 + 嵌套 `replace` 剥数字，见 §1.4）。**全表唯一不做**：唯一性只在"当前有效的码"之间成立，由生成时的重试保证（决策 §14.29，§1.4） | 决策 §2、§14.29 |
| 邀请码的有效期非空且晚于创建时刻 | `ck_ledger_invites_expiry` | 决策 §2 |
| 账户类型四选一 | `ck_finance_sources_type` | 决策 §3、§14.48 |
| 归档标记与归档时刻同步 | `ck_finance_sources_archived_at`（`archived = (archived_at IS NOT NULL)`） | 决策 §14.50 |
| 用户显示名要么为空、要么去空白后非空 | `ck_users_display_name_not_blank` | 决策 §14.40 |
| 交易 kind 四选一 | `ck_transactions_kind` | 决策 §10 |
| 金额符号与 kind / transfer_role 一致，且非零 | `ck_transactions_amount_sign` | 决策 §1、§10 |
| transfer 必有 role 与 subtype，非 transfer 必无 | `ck_transactions_transfer_role`、`ck_transactions_transfer_subtype` | 决策 §10 |
| transfer 无分类，其他 kind 必有一级分类 | `ck_transactions_category` | 决策 §1.3、§10 |
| 二级分类不能脱离一级存在 | `ck_transactions_category_l2_needs_l1` | 决策 §1.3 |
| 只有 refund 能有 `refund_of`，且不能指向自己 | `ck_transactions_refund_of`、`ck_transactions_not_self_refund` | 决策 §1.1、§10 |
| 一个 `transfer_pair_id` 最多一条 out、一条 in | `uq_transactions_transfer_pair_role` | 决策 §10 |
| 有对腿就不填 `counterparty` | `ck_transactions_counterparty` | 决策 §10 |
| 删账本级联删账户、交易、导入批次、成员、邀请码、操作记录 | 六条 `ON DELETE CASCADE` | 决策 §2、§14.51 |
| 删批次级联删草稿行 | `import_rows.batch_id ON DELETE CASCADE` | 决策 §5 |
| 原单删除后退款行 `refund_of` 置空 | `ON DELETE SET NULL` | 决策 §1.1 |
| 批次内行号唯一 | `uq_import_rows_batch_row` | 决策 §5 |
| 上传 ≤2 MB、单批 ≤2000 行 | `ck_import_batches_size`、`ck_import_batches_row_count` | 决策 §5、§9 |
| 批次来源二选一（`csv` / `paste`）、状态二选一（`ready` / `committed`） | `ck_import_batches_source`、`ck_import_batches_status` | 决策 §5、§14.47 |
| 上传文件的批次必有文件名、粘贴的批次必没有 | `ck_import_batches_filename` | 决策 §5、§14.28 |
| 提交时刻与状态同步 | `ck_import_batches_committed_at` | 决策 §5 |
| 草稿行状态三选一、kind 四选一、转账腿二选一、子类型二选一 | `ck_import_rows_status`、`ck_import_rows_kind`、`ck_import_rows_transfer_role`、`ck_import_rows_transfer_subtype` | 决策 §1、§5 |
| 批次行号从 1 起 | `ck_import_rows_row_no` | 决策 §14.5 |
| 操作记录的事件名七选一 | `ck_transaction_events_event` | 决策 §14.51 |
| 删交易级联删它的操作记录 | `transaction_events.transaction_id ON DELETE CASCADE` | 决策 §14.51 |
| 汇率 (date, base, symbol) 唯一且为正、币种大写、base ≠ symbol | 主键 `pk_exchange_rates (date, base, symbol)` + `ck_exchange_rates_rate_positive` / `_base_upper` / `_symbol_upper` / `_not_self` | 决策 §8、§14.1 |

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
| 邀请码存在、未过期、非本人已在成员 | 加入时 `SELECT ... WHERE code = ? AND expires_at > now()` 后逐条判断 | 决策 §2、§14.29 |
| 邀请码一次性 | 加入的同一事务里 `DELETE FROM ledger_invites WHERE id = ?`，影响行数必须为 1，否则回滚（§6.3） | 决策 §2、§14.29 |
| 生成的邀请码与当前有效的码不重复 | 生成前查一次未过期的同码，撞上重摇（数据库无唯一索引，§1.4） | 决策 §14.29 |
| 账户 `default_currency` 创建后不可改 | `PATCH /sources/{sid}` 的请求体里没有这个字段 | 决策 §14.50 |
| 归档 / 取消归档时同步维护 `archived_at` | 写入点只有 `PATCH {"archived": …}` 一处，`TRUE` 时写 `now()`、`FALSE` 时写 NULL（CHECK 兜底） | 决策 §14.50 |
| 配对 / 拆开只改 `transfer_pair_id` 与 `counterparty`，且两腿同事务 | 见 §1.6.3 的两条 `UPDATE`，影响行数必须为 2 | 决策 §14.34 |
| 每一次改交易都追加一条 `transaction_events` | 所有写交易的路径（CRUD、转账接口、配对 / 拆开、导入提交、退款关联变化）共用同一个 `record_event()` 辅助函数，与交易写入同一事务 | 决策 §14.51 |
| `import_batches` 状态机的合法迁移（`ready → committed`，不可回头） | 每个写接口先断言当前状态；重复提交由 409 `batch_already_committed` 挡住（决策 §14.18） | 决策 §5 |
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
| `import_rows.flags` 的取值集合（四种标记） | JSON 列，不做 CHECK；由服务端唯一写入点保证 |
| `transaction_events.changes` 的形状与真实性 | JSON 列，不做 CHECK；事件是应用层自己记的账，直接改库可以造出与交易现状对不上的时间线 |
| `transaction_events.client` 的取值 | 来自请求头 `X-Client`，客户端可以随便写；它只是显示标签，服务端不据此改变任何行为 |
| 已归档账户的历史交易不被再编辑 | 决策没有禁止编辑历史交易，仅禁止新增 |

---

## 4. 索引及其服务的查询

| 索引 | 服务的查询 | 说明 |
|---|---|---|
| `ix_transactions_ledger_occurred (ledger_id, occurred_at DESC, created_at DESC)` | 交易列表主查询：`WHERE ledger_id=? [AND occurred_at BETWEEN ? AND ?] ORDER BY occurred_at DESC, created_at DESC LIMIT ? OFFSET ?`；统计按月汇总 | 决策 §4 的 `from`/`to` 与默认排序都命中它；`created_at` 作为第二排序键保证同一天内顺序稳定、分页不跳行 |
| `ix_transactions_ledger_source (ledger_id, source_id)` | `source_id` 筛选（决策 §4，可多值 → `IN`）；账户余额的取数 `SELECT amount, currency, occurred_at FROM transactions WHERE ledger_id=? AND source_id=?`（决策 §3、§14.2） | 余额是每次读账户列表都要算的，是最热的聚合查询。注意**不能**直接 `SUM(amount)`：决策 §14.2 要求把每笔按 `occurred_at` 当日汇率折算成账户 `default_currency` 再累加，同币种才免折算，所以 SQL 只负责取行，折算与求和在服务层做（同币种账户可以退化成一条 `SUM`） |
| `ix_transactions_ledger_kind_cat (ledger_id, kind, category_l1)` | `kind` / `category_l1` 筛选（决策 §4）；首页按一级分类汇总（决策 §7） | `category_l2` 的筛选量小，落在这个索引取回的行上再过滤 |
| `ix_transactions_refund_of (refund_of) WHERE refund_of IS NOT NULL` | "这张原单已退多少"：`SELECT SUM(amount) WHERE refund_of = ?`（决策 §1.1 要求每条候选显示已退/可退金额）；原单删除时 `ON DELETE SET NULL` 的反查 | 部分索引：绝大多数行 `refund_of` 为空，只索引退款行 |
| `uq_transactions_transfer_pair_role (transfer_pair_id, transfer_role)` | 既是约束也是索引：`WHERE transfer_pair_id = ?` 取两腿（`PATCH/DELETE /transactions/transfer/{pair_id}`，决策 §1.2） | 前导列就是 `transfer_pair_id`，**不需要**再单独建 `ix_transactions_transfer_pair_id`（现状那个独立索引 backend/migrations/versions/8a4f4d66d893_add_transfer_pair_id_to_transactions.py:30-34 在目标态被它取代） |
| `ix_transactions_import_batch_id (import_batch_id) WHERE import_batch_id IS NOT NULL` | 撤销导入：`DELETE FROM transactions WHERE import_batch_id = ?`（决策 §5） | 部分索引，同上 |
| 无索引：`merchant` / `note` 的 `ILIKE '%q%'` | 决策 §4"ILIKE 足够，不做全文索引" | 前导通配的 `ILIKE` 用不上 B-tree。查询一定带 `ledger_id`，规划器先用 `ix_transactions_ledger_occurred` 收窄到单账本再逐行匹配；一本账几万行的量级下是毫秒级。将来若真的慢，加 `pg_trgm` 的 GIN 索引即可，但那会让 SQLite 测试路径分叉 |
| `ix_finance_sources_ledger_id` | 账户列表 `WHERE ledger_id = ? [AND archived = FALSE]` | 决策 §3 |
| `ix_ledger_members_user_id` | "我有哪些账本"：`SELECT ... FROM ledger_members WHERE user_id = ?` 再 join `ledgers`（决策 §11 `GET /ledgers`）；每个请求的成员鉴权走主键 `(ledger_id, user_id)` | 决策 §2 |
| `ix_ledger_invites_ledger_id` | 账本设置页列出本账本的有效码、生成新码前的惰性清理（`WHERE ledger_id = ? AND expires_at < now()`）、owner 作废某个码（`WHERE ledger_id = ? AND code = ?`） | 决策 §2、§14.29、§14.52 A2 |
| 无索引：`ledger_invites.code` | 加入账本：`WHERE code = ? AND expires_at > now()`（决策 §2）；生成时的冲突检测 | **有意不建**（决策 §14.29 不要求全表唯一，§1.4）。这张表在任一时刻只有几十行——每个账本至多攥着一两个 10 分钟内的有效码——全表扫描比索引维护还便宜；`POST /ledgers/join` 又是全局 1 QPS 的端点（决策 §14.35），根本压不出热点。将来若真的需要，加一个非唯一的 `ix_ledger_invites_code` 即可，**不要**加 `UNIQUE` |
| `uq_import_rows_batch_row (batch_id, row_no)`（唯一） | review 表格分页：`WHERE batch_id = ? ORDER BY row_no LIMIT ?`（决策 §5、§11 `GET .../rows`） | 前导列 `batch_id` 也服务"这批有多少行" |
| `ix_import_rows_transaction_id` | 撤销后回查、以及"这条交易来自哪一行草稿" | 部分索引 |
| `ix_import_batches_ledger_created (ledger_id, created_at DESC)` | 导入历史列表（决策 §11 `GET /ledgers/{id}/imports`），列表每行要显示的净额 / 标记数（决策 §14.52 A17）在取回批次后按 `import_batch_id` / `batch_id` 分别聚合 | — |
| `ix_transaction_events_transaction_at (transaction_id, at DESC)` | 交易详情的操作记录：`SELECT ... WHERE transaction_id = ? ORDER BY at DESC`（决策 §14.51）；删交易时 `ON DELETE CASCADE` 的反查也走它 | 前导列等值 + 第二列有序，一次索引扫描取完一条交易的全部事件（个位数行） |
| `ix_exchange_rates_pair_date (base, symbol, date DESC)` | 发生日汇率 `WHERE base=? AND symbol=? AND date <= ? ORDER BY date DESC LIMIT 1`；最新汇率 `WHERE base=? AND symbol=? ORDER BY date DESC LIMIT 1`（决策 §8、§14.1）；节流判断"这个货币对上次抓取是什么时候"也走同一条路径取最新行的 `fetched_at` | 前导两列等值、第三列有序，两条查询都只读一行。**不是**沿用初始迁移那个单列 `ix_exchange_rates_date`（e533c88884b7:35）——那张旧表已被删除，本表按决策 §14.1 重建 |
| `pk_exchange_rates (date, base, symbol)`（主键） | upsert 的冲突目标（`ON CONFLICT (date, base, symbol)`）；按整天批量取汇率 | 决策 §14.1 直接指定的主键。前导列是 `date`，帮不上"按货币对回退"的查询，那条靠上一行的索引 |
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
#  -> CONSTRAINT ck_transactions_kind CHECK (...)                      # 正确，等于 §1.6 DDL
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

**revision** `b1f3c2a10d41_create_ledger_import_and_event_tables`，`down_revision = '8a4f4d66d893'`。

`upgrade()`：按依赖顺序 `op.create_table(...)` 建 `ledgers`、`ledger_members`、`ledger_invites`、`import_batches`、`import_rows`、`transaction_events`、`exchange_rates`（七张，与上一版张数相同——去掉了模型配置表、加上了 `transaction_events`），DDL 与 §1.2–§1.4、§1.7、§1.8、§1.9、§1.10 一致，随后 `op.create_index(...)` 建 §4 里属于这些表的索引（含 `ix_import_rows_transaction_id` 这类部分索引，用 `postgresql_where=` / `sqlite_where=`）。`ledger_invites` 上**只建** `ix_ledger_invites_ledger_id`，**不建** `code` 的唯一索引（决策 §14.29）。

`exchange_rates` 也在本步建（决策 §14.1）：这张表在现状里已被 `5ca7fe6e37db` 删除，目标态是**新建**，形状按 §1.10。它没有任何外键，放在本步的哪个位置都可以。

`import_rows` 的建表语句要包含 `counterparty`（`sa.String(100)`，决策 §14.10），可空；它和其余列一样在本步一次建出，后面没有补列的迁移。**不建**置信度列与页码列（决策 §5、§14.25）。

`transaction_events` 也在本步建（决策 §14.51），DDL 按 §1.9；它的 `transaction_id` 引用 `transactions`、`import_batch_id` 引用同一步刚建的 `import_batches`，所以要排在 `import_batches` 之后。

注意：`import_batches.source_id` 引用 `finance_sources`，`import_rows.matched_transaction_id` 与 `transaction_events.transaction_id` 引用 `transactions`——这两张表此时已存在（现状就有），所以外键可以在 `create_table` 里内联。

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
# ... ledger_members / ledger_invites / import_batches / import_rows 同理
op.create_index("ix_import_batches_ledger_created", "import_batches",
                ["ledger_id", sa.text("created_at DESC")])
op.create_index("uq_import_rows_batch_row", "import_rows", ["batch_id", "row_no"], unique=True)
op.create_index(
    "ix_import_rows_transaction_id", "import_rows", ["transaction_id"],
    postgresql_where=sa.text("transaction_id IS NOT NULL"),
    sqlite_where=sa.text("transaction_id IS NOT NULL"),
)

# 交易操作记录（决策 §14.51），只追加；两条 CASCADE 让它随交易 / 账本一起消失
op.create_table(
    "transaction_events",
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("ledger_id", sa.Uuid(), nullable=False),
    sa.Column("transaction_id", sa.Uuid(), nullable=False),
    sa.Column("actor_id", sa.Uuid(), nullable=False),
    sa.Column("at", sa.DateTime(), nullable=False),
    sa.Column("event", sa.String(24), nullable=False),
    sa.Column("changes", sa.JSON().with_variant(postgresql.JSONB, "postgresql"), nullable=True),
    sa.Column("import_batch_id", sa.Uuid(), nullable=True),
    sa.Column("client", sa.String(16), nullable=True),
    sa.PrimaryKeyConstraint("id", name="pk_transaction_events"),
    sa.ForeignKeyConstraint(["ledger_id"], ["ledgers.id"], ondelete="CASCADE",
                            name="fk_transaction_events_ledger_id_ledgers"),
    sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"], ondelete="CASCADE",
                            name="fk_transaction_events_transaction_id_transactions"),
    sa.ForeignKeyConstraint(["actor_id"], ["users.id"],
                            name="fk_transaction_events_actor_id_users"),
    sa.ForeignKeyConstraint(["import_batch_id"], ["import_batches.id"], ondelete="SET NULL",
                            name="fk_transaction_events_import_batch_id_import_batches"),
    sa.CheckConstraint(
        "event IN ('created','updated','imported','paired','unpaired',"
        "'refund_linked','refund_unlinked')", name="event"),   # -> ck_transaction_events_event
)
op.create_index("ix_transaction_events_transaction_at", "transaction_events",
                ["transaction_id", sa.text("at DESC")])

# 汇率缓存表（决策 §14.1）；现状里同名表已被 5ca7fe6e37db 删除，这里是新建
op.create_table(
    "exchange_rates",
    sa.Column("date", sa.Date(), nullable=False),
    sa.Column("base", sa.CHAR(3), nullable=False),
    sa.Column("symbol", sa.CHAR(3), nullable=False),
    sa.Column("rate", sa.Numeric(18, 8), nullable=False),
    sa.Column("fetched_at", sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint("date", "base", "symbol", name="pk_exchange_rates"),
    sa.CheckConstraint("rate > 0", name="rate_positive"),        # -> ck_exchange_rates_rate_positive
    sa.CheckConstraint("base = upper(base)", name="base_upper"),      # -> ck_exchange_rates_base_upper
    sa.CheckConstraint("symbol = upper(symbol)", name="symbol_upper"),  # -> ck_exchange_rates_symbol_upper
    sa.CheckConstraint("base <> symbol", name="not_self"),        # -> ck_exchange_rates_not_self
)
op.create_index("ix_exchange_rates_pair_date", "exchange_rates",
                ["base", "symbol", sa.text("date DESC")])
```

**空库可运行**：是，纯 DDL。

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
        b.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))    # 决策 §14.50
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
    # 账户类型收敛为四种（决策 §14.48）：存量里凡不在四种之内的（现状那种"储蓄"类型、
    # 空值、以及现状根本没有 CHECK 时被写进来的任何自造字符串）一律改成 checking。
    # 写成 NOT IN 而不是逐个点名旧值，是因为现状这一列只有注释、没有约束
    # (backend/app/models/finance_source.py:19)，实际存了什么无法穷举。
    op.execute("UPDATE finance_sources SET type = 'checking' "
               "WHERE type IS NULL OR type NOT IN ('checking', 'credit', 'cash', 'other')")
    # 归档时刻（决策 §14.50）：存量里已归档的行没有这个信息，用 updated_at 顶上（上一句刚回填过），
    # 否则 ck_finance_sources_archived_at 会因为"archived = TRUE 但 archived_at 为空"加不上。
    op.execute("UPDATE finance_sources SET archived_at = updated_at WHERE archived = TRUE AND archived_at IS NULL")
    op.execute("UPDATE finance_sources SET archived_at = NULL WHERE archived = FALSE")
    # 与下面 transactions 的处理对称：本地 SQLite 开发库不开 PRAGMA foreign_keys
    # (../current-design/02-database.md:53)，可能留下 user_id 指向已删用户的账户行，
    # 那种行上面的相关子查询取不到 ledger_id，随后的 alter_column(nullable=False) 会失败。
    # Postgres 上必然是 0 行（users.id 有外键），所以这条只对开发库有意义。
    delete_and_warn("finance_sources", "ledger_id IS NULL", "no resolvable ledger_id")

    # 必须在 batch 块之前把 user_id 上的索引显式删掉：batch 重建表时 Alembic 会用反射到的
    # 索引清单在新表上重建索引，而 drop_column("user_id") 不会把它从那份清单里剔除，
    # 于是新表上重建 ix_*_user_id 时报 OperationalError: no such column: user_id（见下方说明）。
    for _idx in ("ix_accounts_user_id", "ix_finance_sources_user_id"):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {_idx}"))

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
            "type IN ('checking','credit','cash','other')")                     # -> ck_finance_sources_type（决策 §14.48）
        b.create_check_constraint("currency_upper",
            "default_currency = upper(default_currency)")                      # -> ck_finance_sources_currency_upper
        b.create_check_constraint("name_not_blank", "length(trim(name)) > 0")   # -> ck_finance_sources_name_not_blank
        b.create_check_constraint("archived_at",
            "archived = (archived_at IS NOT NULL)")                            # -> ck_finance_sources_archived_at（决策 §14.50）
        b.drop_column("user_id")          # 索引已在 batch 之前显式 drop（两个名字都跑过 DROP INDEX IF EXISTS）
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

    # 同理：transactions.user_id 上也有索引（迁移侧 e533c88884b7:73 建、模型侧
    # backend/app/models/transaction.py:17 的 index=True，两条路径同名），
    # 必须在 batch 块之前删掉，否则 batch 重建会试图在没有 user_id 的新表上重建它。
    for _idx in ("ix_transactions_user_id",):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {_idx}"))

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

`archived_at` 是决策 §14.50 新增的列，加成可空、永远可空（未归档的账户就是 NULL），所以不需要收紧，只要在加 `ck_finance_sources_archived_at` **之前**把存量的两个方向都补齐：已归档的行给一个时刻（拿不到真实归档时间，用 `updated_at` 近似，日志里不必声张——这一列在现状里根本不存在，任何值都是编的），未归档的行强制置空。两条语句在空库上都是 no-op。

账户类型的收敛（决策 §14.48）同样必须排在 `create_check_constraint("type", ...)` 之前：现状这一列没有任何 CHECK，实际值不可穷举，所以用"不在四种之内的一律改成 `checking`"这种兜底写法，而不是点名某一个旧值——既覆盖了界面上原来的"储蓄"类型，也覆盖了直接写库写进来的任何脏值。改写是**有损**的（原来的类型信息没了），但账户类型只影响分组显示与还款目标校验，且决策 §13 已允许粗回填。

**这一步 drop 旧索引时必须当心命名分叉**：现状里 Alembic 建出的 Postgres 库和 `create_all` 建出的开发 SQLite 库，索引名并不相同——重命名迁移只改了表名/列名，Postgres 在 rename 时保留索引原名。对照表见 `../current-design/02-database.md` 的索引命名分叉表（第 370–372 行三处：`ix_accounts_user_id` / `ix_transactions_account_id` / `idx_transactions_transfer_pair`）。因此：

| 要处理的索引 | Alembic 库里的名字 | `create_all` 库里的名字 | 本步的写法 |
|---|---|---|---|
| `transactions(occurred_at)` | `ix_transactions_occurred_at` | 同名 | `op.drop_index(...)` 直接删 |
| `transactions(source_id)` | `ix_transactions_account_id` | `ix_transactions_source_id` | 两个名字都跑一遍 `DROP INDEX IF EXISTS` |
| `finance_sources(user_id)` | `ix_accounts_user_id` | `ix_finance_sources_user_id` | **batch 块之前**先对两个名字各跑一遍 `DROP INDEX IF EXISTS`；不能依赖 `drop_column` 自动清理——SQLite batch 重建会试图在新表上重建它并报 `no such column: user_id` |
| `transactions(user_id)` | `ix_transactions_user_id`（e533c88884b7:73） | 同名（模型上是 `index=True`，backend/app/models/transaction.py:17） | 同上：**batch 块之前** `DROP INDEX IF EXISTS ix_transactions_user_id` |
| `transactions(transfer_pair_id)` | `idx_transactions_transfer_pair` | `ix_transactions_transfer_pair_id`（模型上是 `index=True`，backend/app/models/transaction.py:24） | 第 4 步同样两个名字都跑 `DROP INDEX IF EXISTS` |

`DROP INDEX IF EXISTS` 在 Postgres 与 SQLite 上都受支持，所以"两个名字都试"是安全的；如果换成 `op.drop_index("ix_transactions_source_id")`，在生产 Postgres 上会直接报 `index "ix_transactions_source_id" does not exist`，让整条链回滚到第 2 步。

**为什么被 drop 的列上的索引必须自己删、不能等 `drop_column` 顺手带走**（本步两处 `drop_column("user_id")` 都受影响）：在 Postgres 上 `ALTER TABLE ... DROP COLUMN` 确实会连带删掉依赖该列的索引，所以只写 `drop_column` 也能跑通；但本文承诺整条链在 **SQLite** 上也跑得通（§5.0），而 SQLite 走的是 Alembic 的 batch 重建路径——Alembic 1.18.4 + SQLAlchemy 2.0.49 实测：`batch` 在进入块时反射出旧表的全部索引，`drop_column` 只从列清单里去掉这一列、**不**同步清理那份索引清单（`alembic/operations/batch.py` 的 `drop_column` 与 `_gather_indexes_from_both_tables`），于是重建新表后照样按旧清单执行 `CREATE INDEX ix_..._user_id ON ...(user_id)`，而新表已经没有 `user_id` 列，直接抛 `sqlite3.OperationalError: no such column: user_id`，整条链在开发机上就断了。因此凡是"要 drop 的列上带索引"的情况，**一律在进入 `batch_alter_table` 之前把索引显式 `DROP INDEX IF EXISTS` 掉**——这是本步两段 `for _idx in (...)` 前置循环的全部原因，也是它们必须放在 `with` 之外的原因。上表里 `finance_sources(user_id)` 与 `transactions(user_id)` 两行就是这么处理的。

**空库可运行**：是。**有数据库可运行**：是，前提是第 2 步已给每个用户建了账本。

关于两条 `delete_and_warn`（`finance_sources` 一条、`transactions` 一条）：

`DELETE FROM finance_sources WHERE ledger_id IS NULL`：**在 Postgres 上同样不会命中任何行**——`finance_sources.user_id` 是 `NOT NULL` 且带指向 `users` 的外键（`backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:45-55`），第 2 步又给每个用户都建了账本，回填的相关子查询必然取到值。它只对**开发用 SQLite 库**有意义：那里 `PRAGMA foreign_keys` 是关的（`../current-design/02-database.md:53`），本地库里可能留着 `user_id` 指向已删用户的账户行，这种行取不到 `ledger_id`，接下来的 `b.alter_column("ledger_id", nullable=False)` 会直接失败。所以必须和 `transactions` 那条对称地兜底，而不是让本地开发者在第 3 步撞一个没头没尾的 NOT NULL 错误。顺序上它排在 `transactions` 的回填之前，因此被它删掉的账户所对应的交易随后也会因为取不到 `ledger_id` 而被下面那条 `delete_and_warn` 一并清掉——两条日志会同时出现，正好说明是同一批脏数据。

`DELETE FROM transactions WHERE ledger_id IS NULL`：**在 Postgres 上它不会命中任何行**——`transactions.source_id` 是 `NOT NULL` 且带外键（`backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:60,67`），指向已删账户的孤儿交易在库层面就不可能存在，回填的相关子查询必然取到值。它只对**开发用 SQLite 库**有意义：SQLite 默认 `PRAGMA foreign_keys = OFF`，现状也没有在连接上打开它（`../current-design/02-database.md` §1.2 第 53 行），所以本地库里确实可能留下指向已删账户的行。为了不把"回填逻辑写错"和"本来就是脏数据"混为一谈，删除前先 `SELECT count(*)` 并打 warning 日志（与 §待决 D-9 对 `amount = 0` 行的处理一致）：如果生产迁移日志里出现这条 warning，说明回填 SQL 本身有问题，应当中止排查而不是接受静默删除。

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
        # §1.6 里的 12 条 CHECK，表达式一字不差地照抄过来；suffix 是去掉
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

`TRANSACTION_CHECKS` 是**写在这个迁移文件顶部的字面量列表**，内容是 §1.6 DDL 里那 12 条 CHECK 的 `(后缀, SQL 表达式)` 二元组（其中 7 条来自决策 §10 的 8 个约束，第 8 个是 `uq_transactions_transfer_pair_role`，由上一行的 `create_unique_constraint` 单独建，见 §1.6.1），照抄字符串、不 import 任何应用代码（§5.0）。这里存的是**后缀**而不是全名——`create_check_constraint` 会经过 naming convention，`ck_transactions_` 前缀由它补上（§5.0），拼出来正好是 §1.7 DDL 里的全名：

```python
TRANSACTION_CHECKS = [
    ("kind",                 "kind IN ('expense','income','transfer','refund')"),   # -> ck_transactions_kind
    ("amount_sign",          "..."),                                                # -> ck_transactions_amount_sign
    ("transfer_role",        "(kind = 'transfer') = (transfer_role IS NOT NULL)"),  # -> ck_transactions_transfer_role
    # ... 共 12 条，表达式一字不差地照抄 §1.6
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
        b.add_column(sa.Column("display_name", sa.String(40), nullable=True))   # 决策 §14.40
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
        b.create_check_constraint("display_name_not_blank",
            "display_name IS NULL OR length(trim(display_name)) > 0")                            # -> ck_users_display_name_not_blank
        # 注意：这个名字只存在于 Alembic 建出的库；create_all 库里这个外键是无名的。
        # 下方"命名分叉"一段给出兜底写法（这里按写法 A：仅 Postgres 分支执行）。
        if op.get_bind().dialect.name == "postgresql":
            b.drop_constraint("fk_users_default_source", type_="foreignkey")  # 由 76227e076393:30-35 建立
        b.drop_column("default_source_id")     # 决策 §14.6
    if op.get_bind().dialect.name == "postgresql":
        op.execute("COMMENT ON COLUMN users.base_currency IS "
                   "'Default base currency for newly created ledgers (see ledgers.base_currency)'")
```

**`drop_constraint("fk_users_default_source", ...)` 的命名分叉**（与 §5.3 的索引命名分叉是同一类问题）：这个外键名只存在于 **Alembic 建出的库**——它是 `76227e076393_add_default_source_to_users.py:30-35` 用 `op.create_foreign_key('fk_users_default_source', ...)` 显式命名建出来的；而 `create_all` 建出的开发库里，模型 backend/app/models/user.py:20 只写了 `ForeignKey("finance_sources.id", ondelete="SET NULL")`，没有名字，落库就是一个**无名外键**（`../current-design/02-database.md:373` 的命名分叉表正是这么记的）。在 SQLite 的 batch 重建路径上按名字找不到约束会直接报错，所以照抄上面那行代码只在 Postgres 上可靠。兜底写法二选一：

```python
# 写法 A（推荐）：SQLite 上跳过 drop_constraint，直接 drop_column
#   —— batch 重建新表时本来就不会带上这一列，它的外键随之消失，不需要按名字删
is_pg = op.get_bind().dialect.name == "postgresql"
with op.batch_alter_table("users") as b:
    ...
    if is_pg:
        b.drop_constraint("fk_users_default_source", type_="foreignkey")
    b.drop_column("default_source_id")

# 写法 B：给 batch 显式描述表结构，不依赖反射到的约束名
users_tbl = sa.Table(
    "users", sa.MetaData(),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("email", sa.String(255), nullable=False),
    sa.Column("password_hash", sa.String(255), nullable=False),
    sa.Column("base_currency", sa.CHAR(3), nullable=False),
    sa.Column("default_source_id", sa.Uuid(), nullable=True),
    sa.Column("created_at", sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint("id", name="pk_users"),
)
with op.batch_alter_table("users", copy_from=users_tbl) as b:
    b.drop_column("default_source_id")     # copy_from 里没写这个外键 = 重建后它就不存在
```

写法 A 更短，代价是分支代码；写法 B 没有分支，代价是要把 `users` 在第 6 步之前的形状抄一遍（抄错会静默丢约束）。本文按写法 A 书写，上面代码块里的 `b.drop_constraint(...)` 应理解为"仅 Postgres 分支"。同一条注意事项适用于任何"删一个由 `op.create_foreign_key` 显式命名、而模型侧无名"的约束。

决策 §13 第 6 步只要求"把 `users.base_currency` 保留为新建账本默认币种"——语义上的保留，schema 上只加一句注释。同一步顺带做完 `users` 的其余收尾：`display_name`（决策 §14.40，全部回填为 NULL——现状没有这个信息，界面在它为空时显示邮箱前缀，所以不需要拿邮箱去填）、`language`（决策 §11 的 `PATCH /me` 要改语言）、`updated_at`，以及删掉 `default_source_id`（决策 §14.6 明确要求；决策 §3 之后账户归账本，这个列已无处安放，默认账户改由前端本地记住上次使用的账户）。删掉它同时消除了 `users ↔ finance_sources` 的外键环（§2）。注意语句顺序：`upper()` 归一化必须在 `create_check_constraint("base_currency_upper", ...)`（落库名 `ck_users_base_currency_upper`）之前执行，否则存量小写币种会让加约束失败。第 3 步与第 4 步在加 `ck_finance_sources_currency_upper` / `ck_transactions_currency_upper` 之前也各跑了一条同样的 `upper()` 语句，三步保持对称。这两列在 API 层其实已被 `CurrencyCode`（`^[A-Z]{3}$`，backend/app/schemas/currency.py:9）挡住、存量值大概率已是大写，而 `users.base_currency` 用的是没有 pattern 的裸 `str`（backend/app/schemas/user.py:12,35）——但迁移不应依赖这种非对称的假设，三条语句在空库上都是 no-op。

**空库可运行**：是。

### 5.7 迁移链总览

| 步 | revision（占位 id）| slug | 关键动作 | 空库可跑 | 有数据可跑 |
|---|---|---|---|---|---|
| 1 | `b1f3c2a10d41` | create_ledger_import_and_event_tables | 建 7 张新表（`ledgers` / `ledger_members` / `ledger_invites` / `import_batches` / `import_rows` / `transaction_events`（决策 §14.51）+ `exchange_rates`（决策 §14.1））+ 索引 | 是 | 是 |
| 2 | `b1f3c2a10d42` | backfill_default_ledgers | 每用户一本"我的账本" + owner 成员 | 是（0 行） | 是 |
| 3 | `b1f3c2a10d43` | scope_sources_and_transactions_to_ledger | `ledger_id` / `created_by` / `updated_by` / `updated_at` / `opening_balance` / `archived_at`（决策 §14.50）；`type` 收敛为四种并回填旧值（决策 §14.48）；删两张表的 `user_id`（batch 前先 `DROP INDEX IF EXISTS` 三个索引名）| 是 | 是 |
| 4 | `b1f3c2a10d44` | transactions_kind_category_refund | `description→note`；kind / 转账 / 分类 / 退款 / 导入列 + 全部 CHECK | 是 | 是（含三条清洗语句） |
| 5 | `b1f3c2a10d45` | drop_transaction_tags | 删 `transaction_tags` | 是 | 是 |
| 6 | `b1f3c2a10d46` | users_base_currency_as_ledger_default | `display_name`（决策 §14.40）/ `language`（决策 §14.6）/ `updated_at`；删 `default_source_id`（决策 §14.6，外键名有分叉，见 §5.6）| 是 | 是 |

每步的 `downgrade()` 策略（**只用于开发环境**；生产回退靠恢复备份）：

| 步 | downgrade 做什么 | 是否无损 |
|---|---|---|
| 1 | 逆序 `op.drop_table(...)` 七张表（`transaction_events` 最先删，`exchange_rates` 无依赖任意位置），索引随表消失 | 无损（表本来就是新建的；缓存表丢了会被下次请求重新拉回来，操作记录丢了只影响时间线展示） |
| 2 | `DELETE FROM ledger_members;` 再 `DELETE FROM ledgers;` | **破坏性**：第 2 步之后用户新建的账本与回填的账本无法区分，会一并删掉 |
| 3 | 加回 `user_id`（从 `created_by` 回填）、删掉新列（含 `archived_at`）与新约束、重建 upgrade 里 drop 掉的全部旧索引（`ix_transactions_occurred_at`、`ix_transactions_account_id`、`ix_accounts_user_id`、`ix_transactions_user_id`；`create_all` 库上对应 `ix_transactions_source_id` / `ix_finance_sources_user_id`） | 有损：被 `delete_and_warn` 删掉的孤儿行（`finance_sources` 与 `transactions` 各一批）不可恢复 |
| 4 | 按 §1.6 的**全名** drop 全部新 CHECK / UNIQUE / FK / 索引与新列（§5.0），`note` 改回 `description`，`op.create_index("idx_transactions_transfer_pair", ...)` | 有损：`amount = 0` 的行与被打散的 `transfer_pair_id` 不可恢复 |
| 5 | `op.create_table("transaction_tags", ...)` 重建空表 | 有损：标签数据不可恢复（这正是决策 §13 允许删表的前提） |
| 6 | 加回 `default_source_id`（值全为 NULL）与外键 `fk_users_default_source`（只在 Postgres 分支上按名字建，与 upgrade 的写法 A 对称），删掉 `display_name` / `language` / `updated_at` 与三条 CHECK | 有损：`default_source_id` 与 `display_name` 的值不可恢复 |

---

## 6. 数据生命周期

所有删除仍是硬删除；唯一的软删除标记是 `finance_sources.archived`（决策 §3）。

### 6.1 注册

`POST /auth/register`（受 `REGISTRATION_OPEN` 控制，决策 §9）→ 一个事务内：`INSERT users` → `INSERT ledgers`（name `"我的账本"`、`base_currency = users.base_currency`）→ `INSERT ledger_members (role='owner')`（决策 §2）。不再自动建账户，也不再有 `default_source_id` 的自动赋值（现状 backend/app/api/finance_sources.py:43-49 的那段逻辑消失）。用户随后必须先建一个资金账户才能记账。

### 6.2 建账本 / 加入 / 退出 / 转让

账本的成员集合只由四个写入点改变：`POST /ledgers` 建账本（同一事务写 `ledgers` 一行 + `ledger_members` 一行 `role='owner'`）；`POST /ledgers/join` 凭邀请码加入（写 `ledger_members` 一行 `role='member'`）；`DELETE /{id}/members/{uid}`（owner 踢人）与 `POST /{id}/leave`（member 自己退出，owner 被拒）各删一行；`POST /{id}/transfer-ownership` 不增减行数，只在同一事务里把旧 owner 降为 member、新 member 升为 owner。`POST /{id}/invites` 只写 `ledger_invites`（10 分钟有效），不改成员表。

加入的写入序列（决策 §2、§14.29），全在一个事务里：

```sql
BEGIN;
  DELETE FROM ledger_invites WHERE expires_at <= :now;          -- 顺手清过期（§6.3）
  SELECT id, ledger_id FROM ledger_invites
   WHERE code = :code AND expires_at > :now
   ORDER BY created_at DESC LIMIT 1;                            -- 找不到 -> 404 invite_invalid
  -- 校验：该用户不是该账本成员、账本人数 < 10（决策 §2）
  INSERT INTO ledger_members (ledger_id, user_id, role, joined_at) VALUES (...);
  DELETE FROM ledger_invites WHERE id = :invite_id;             -- 影响行数必须 = 1，否则回滚
COMMIT;
```

**用掉即删**（决策 §14.29）：一次性不再靠"写上已用人、下次发现非空就拒绝"，而是直接把行删掉——同一个码被两个人同时输入时，两个事务都想删同一行，后到的那个 `DELETE` 影响 0 行，整体回滚并报"邀请码无效或已过期"。这比"更新已用标记"少一个状态，也让表里不会积压历史行。

错码尝试限流不按用户计数（决策 §14.35 推翻了原来的"同一用户 15 分钟 5 次"）：`POST /ledgers/join` **整个端点**全局 1 QPS（令牌桶，突发 3），超出 429 + `Retry-After`，code `invite_rate_limited`。令牌桶在进程内存里，不入库；被限流的请求根本不碰这张表。

### 6.3 邀请码的三种死法

`ledger_invites` 里**永远只有当前有效的码**（决策 §14.29）。一行从生成到消失最长 10 分钟，三条路都是删行，没有任何"历史邀请码"留在库里：

| 死法 | 触发 | SQL |
|---|---|---|
| 用掉 | 有人成功加入（§6.2） | `DELETE FROM ledger_invites WHERE id = :invite_id`（与 `INSERT ledger_members` 同一事务，影响行数必须为 1） |
| 过期 | 下一次生成或校验时顺手清（惰性） | 生成前：`DELETE FROM ledger_invites WHERE ledger_id = :lid AND expires_at <= :now`；校验前：`DELETE FROM ledger_invites WHERE expires_at <= :now` |
| 作废 | owner 在账本设置里点"作废"（`DELETE /ledgers/{id}/invites/{code}`，决策 §14.52 A2） | `DELETE FROM ledger_invites WHERE ledger_id = :lid AND code = :code`（影响 0 行 → 404，返回 204） |

三条都是普通删除，**没有定时任务、没有后台扫描**（决策 §14.29"不做定时清理"）。惰性清理已经够用：生成新码是清理的天然时机，而校验路径每分钟至多被调用 60 次（端点 1 QPS，§6.2）。即使某个账本再也没人生成码、留下一两行过期数据，也不会造成任何影响——`code` 没有唯一索引（§1.5），过期行既挡不住新码，也永远匹配不上校验时的 `expires_at > now()`。

删账本时这张表随 `ON DELETE CASCADE` 清空（§6.7）。

### 6.4 账户归档 / 删除

账户只有两个状态，由 `archived` 布尔列表示：`POST /{lid}/sources` 建出的是 `archived = false, archived_at = NULL`，`PATCH {"archived": true/false}` 在两个状态间双向切换（归档可撤销），**同一次写入必须同步 `archived_at`**（`true` 写 `now()`、`false` 写 `NULL`，否则 `ck_finance_sources_archived_at` 直接拒绝，§1.5）。`DELETE /{lid}/sources/{sid}` 是第三条路径，只在 `COUNT(transactions WHERE source_id = ?) = 0` **且** `COUNT(import_batches WHERE source_id = ?) = 0` 时真的删一行，否则返回 `409 source_has_transactions`。

归档后：不能作为新交易的 `source_id`、不能作为导入目标（决策 §3），历史交易照常显示、账户余额照常算，但**不计入净资产与首页合计**（决策 §14.50，读取时按 `WHERE archived = FALSE` 过滤；归档前界面提示"该账户余额将从净资产中移除"）。归档账户上的历史交易仍然允许修改，只禁止新建（决策 §14.40 的 01-12）。删除只在账户干净时允许（决策 §3）；数据库侧 `transactions.source_id` 是 NO ACTION，会在应用层漏判时报外键错误兜底（§1.6.2）。

### 6.5 交易删除

| 场景 | 动作 | 依据 |
|---|---|---|
| 普通交易（`transfer_pair_id IS NULL`） | `DELETE FROM transactions WHERE id = ? AND ledger_id = ?` | — |
| 有对腿的转账 | 只能 `DELETE /ledgers/{id}/transactions/transfer/{pair_id}`：`DELETE ... WHERE transfer_pair_id = ? AND ledger_id = ?`，一次删两腿；对单腿交易走普通接口 | 决策 §1.2 |
| 被退款引用的原支出 | 原单行删除，指向它的退款行**保留**，`refund_of` 由 `ON DELETE SET NULL` 置空 | 决策 §1.1 |
| 被导入草稿引用的交易 | `import_rows.matched_transaction_id` / `transaction_id` 由 `ON DELETE SET NULL` 置空，草稿行保留 | §1.8 |
| 任何交易被删除 | 它的 `transaction_events` 随 `ON DELETE CASCADE` 一起消失，不留孤儿时间线 | 决策 §14.51 |
| 有对腿的转账被"拆开"而不是删除 | 不删行：两腿的 `transfer_pair_id` 置 NULL 变回单腿，各写一条 `unpaired` 事件（§1.6.3） | 决策 §14.34 |

相比现状（backend/app/api/transactions.py:447-459 按 `transfer_pair_id` 批量删、且服务端对"转账"没有概念），目标态的差别是：删两腿走独立端点，`kind`/`transfer_role` 让服务端真的知道自己在删什么。

### 6.6 导入批次的丢弃与撤销

导入的状态机只有两态（决策 §5、§14.25：校验同步完成，应用不解析账单）：

```
  POST /imports  (multipart CSV 文件，或 JSON 体 {source_id, text} 粘贴的 CSV 文本)
        |
        |  同步校验（秒级）：编码、# version: 行、11 列固定表头、每行列数
        |
        +---- 结构错误 ---->  400 + 按行号的错误清单，**不建批次**（库里什么都没留下）
        |
        v  校验通过（行级问题只打标记，不丢行）
    [ready] ---- POST .../commit ----> [committed]
        |                                   |
        | DELETE = 丢弃                     | DELETE = 撤销（整批删除）
        v                                   v
    (批次与草稿行消失)                  (交易 + 批次 + 草稿行一起消失)
```

没有 `uploaded` / `parsing` / `failed`，因此也没有进度、轮询、重试端点、僵尸批次扫描、服务重启后的收尾（决策 §14.14、§14.15、§14.23、§14.24 全部作废）。

- **丢弃**（`ready`）：`DELETE FROM import_batches WHERE id = ? AND ledger_id = ?`，`import_rows` 随 `ON DELETE CASCADE` 消失。此时还没有任何正式交易。
- **撤销**（`committed`，决策 §14.22"整批删除，不引入 `reverted` 状态、不为追溯保留已撤销批次"）：一个事务内，**先删交易再删批次与草稿行**：

```sql
BEGIN;
  -- dry_run 先给用户看两个数（决策 §14.52 B24），措辞分开：
  SELECT count(*) FROM transactions WHERE import_batch_id = :bid;          -- 将删除 N 笔
  SELECT count(*) FROM transactions t                                      -- orphaned_refunds：
   WHERE t.refund_of IN (SELECT id FROM transactions WHERE import_batch_id = :bid)
     AND (t.import_batch_id IS NULL OR t.import_batch_id <> :bid);
                                                                           -- 批外退款将失去原单
  SELECT count(*) FROM transactions                                        -- refunds_in_batch：
   WHERE import_batch_id = :bid AND kind = 'refund' AND refund_of IS NOT NULL;
                                                                           -- 批内退款删除后原支出恢复可退额度

  -- 必须先把"与批外单腿转账配的对"拆开，再删交易（见下方说明）
  UPDATE transactions SET transfer_pair_id = NULL, updated_at = :now
   WHERE ledger_id = :lid
     AND (import_batch_id IS NULL OR import_batch_id <> :bid)
     AND transfer_pair_id IN (SELECT transfer_pair_id FROM transactions
                               WHERE import_batch_id = :bid AND transfer_pair_id IS NOT NULL);

  DELETE FROM transactions   WHERE import_batch_id = :bid AND ledger_id = :lid;
  DELETE FROM import_batches WHERE id = :bid AND ledger_id = :lid;   -- import_rows 随 CASCADE
COMMIT;
```

删交易那一句会连带触发两条级联：批外退款行的 `refund_of` 被 `ON DELETE SET NULL` 置空（退款行本身保留，决策 §1.1），被删交易的 `transaction_events` 随 `ON DELETE CASCADE` 消失（决策 §14.51）。

顺序选择：**应用层在事务内先删交易再删批次**，`transactions.import_batch_id` 上的 `ON DELETE SET NULL` 只是兜底（万一有人绕过 API 直接删批次，交易不会丢，只是失去归属）。理由：如果反过来依赖 CASCADE 删交易，一次误删批次就会连带删掉用户已经手工编辑过的交易，不可逆；SET NULL 则至少保住数据。撤销时若某条交易是两腿转账的一腿，两腿都带同一个 `import_batch_id`（决策 §5：提交时一个事务里建完，含配对建出的对腿），会被同一条 `DELETE` 一起删掉；而"提交时与一条**已有**的单腿转账配了对"的情况（决策 §14.34）不同：已有的那条腿不属于本批、不会被删，只是它的 `transfer_pair_id` 会指向一条已消失的对腿。所以上面那条 `UPDATE` 要把它打回单腿，而且**必须排在 `DELETE FROM transactions` 之前**——一旦本批的行先被删掉，子查询就再也找不到那个 `transfer_pair_id`，那条腿会永远挂着一个指向虚空的 pair。数据库不会替这件事报错（`transfer_pair_id` 没有外键，决策 §1.2），只有唯一约束还在，所以漏掉这一句的后果是安静的脏数据，不是异常。

- **磁盘侧：什么都不用做**。决策 §14.28 明确不保存上传的账单文件，也不存原始行值——服务端没有上传目录、没有上传卷、没有任何文件系统状态。批次表里的 `filename` / `size_bytes` 只是两个用来显示的标量。上一版在这里写的"删原文件 + 删页面图目录"两条清理随之取消。

**限流**：导入每用户每小时 10 批（决策 §5、§9），计数在进程内存的令牌桶里，不入库。

### 6.7 账本删除

owner 调用 `DELETE /ledgers/{id}`（决策 §2）。数据库侧六条 CASCADE 会自动清理 `ledger_members`、`ledger_invites`、`finance_sources`、`transactions`（进而 `transaction_events`）、`import_batches`（进而 `import_rows`）、以及直接挂在账本上的 `transaction_events`，但应用层仍在同一事务内按依赖顺序显式删除，保证在 SQLite 上（外键默认不生效，见 `../current-design/02-database.md` §1.2）行为一致：

```
transaction_events -> import_rows -> transactions -> import_batches
                   -> finance_sources -> ledger_invites -> ledger_members -> ledgers
```

**磁盘侧：什么都不用做**——服务端没有任何文件系统状态（决策 §14.28）。

删除前要求二次确认：先 `GET /ledgers/{id}` 拿到 counts（交易数、账户数、导入批次数，决策 §14.52 A22），显示"将删除 N 笔交易、M 个账户、K 批导入"，并要求用户**手打账本名**才放行。

### 6.8 汇率缓存（`exchange_rates`）

这张表不属于任何账本、任何用户，生命周期与其它九张表完全独立（决策 §14.1）：

| 事件 | 动作 |
|---|---|
| 需要一个 `(base, symbol, date)` 的汇率而库里没有 | 向 Frankfurter 请求那一天，把返回的行 upsert 进来（**按需写入**，没人预热、没有定时任务） |
| 库里有，但同一 `(base, symbol)` 的最新一行 `fetched_at` 距今 ≥ 1 小时，且要的是"最新汇率" | 重新请求一次并 upsert，刷新 `rate` 与 `fetched_at`（决策 §14.1 的一小时节流） |
| 库里有且在节流窗口内 | 直接用库里的值，不发请求 |
| 历史日期的行 | **永不失效、永不清理**——决策 §8"一经公布不再变" |
| 删账本 / 删账户 / 删用户 / 撤销导入 | 与本表无关，一行都不动（没有任何外键指向它） |
| Frankfurter 不可用 | 不写入；能否降级用库里的旧值由 [`03-backend-api.md`](./03-backend-api.md) 的汇率接口定，本表不做特殊处理 |

容量：每个货币对每个行情日一行。个人记账场景下的货币对个数是个位数，一年 260 个行情日，十年也只有几万行（§7.4），所以没有清理策略、没有分区。

### 6.9 用户删除

**本版本不提供接口**（决策 §11 的"我"分组只有 `GET /me` 与 `PATCH /me` 两个端点，没有 `DELETE /me`）。因此 `created_by` / `updated_by` / `ledgers.created_by` / `transaction_events.actor_id` 上的外键都是 NO ACTION，不会产生悬垂引用。若运维必须删除某个用户，正确顺序是：先把该用户 owner 的账本转让或删除 → 删 `ledger_members` 行 → 最后删 `users`；只要该用户在任何账本里创建过交易或留下过操作记录，最后一步就会因 `fk_transactions_created_by_users` / `fk_transaction_events_actor_id_users` 失败——这是有意的，防止把别人账本里的历史记录删出空洞。成员退出账本时**不删任何历史**、也不匿名化，交易上照旧显示他的 `display_name`（决策 §14.40）。

### 6.10 交易操作记录（`transaction_events`）

只有一种写入方式和一种消失方式（决策 §14.51）：

| 事件 | 动作 |
|---|---|
| 任何改交易的路径（`POST` / `PATCH` / 转账接口 / 配对 / 拆开 / 导入提交 / 退款关联变化） | 与交易写入**同一个事务**里 `INSERT` 一行；两腿一起动的操作（建转账、改转账、配对、拆开）各写一条 |
| 事件写入之后 | 永不 `UPDATE`、永不单独 `DELETE`——这是一张只追加的表 |
| 交易被删除（普通删、删转账两腿、撤销导入、删账本） | 该交易的全部事件随 `ON DELETE CASCADE` 消失 |
| 撤销导入 | 删交易那一句就把事件带走了，不需要另写清理；批次行本身消失后，残留在别的交易上的 `import_batch_id` 由 `ON DELETE SET NULL` 置空 |

不做归档、不做清理、不做保留期：一条交易一生的事件是个位数，一本账几年下来也就是交易数的几倍（§7.4）。

---

## 7. 类型、大小与时间

### 7.1 类型映射

| 用途 | SQLAlchemy | Postgres | SQLite（测试） |
|---|---|---|---|
| 主键 / 外键 | `sa.Uuid()` | `UUID`（16 字节） | `CHAR(32)` 无连字符十六进制 |
| 金额 | `sa.Numeric(18, 4)` | `NUMERIC(18,4)`，精确十进制，最多 14 位整数 | 声明 `NUMERIC(18,4)`，实际按 REAL/INTEGER 亲和性存，读出时 SQLAlchemy 重建为 4 位小数 `Decimal` |
| 汇率 | `sa.Numeric(18, 8)` | `NUMERIC(18,8)` | 同上 |
| 币种 | `sa.CHAR(3)` | `CHAR(3)`（bpchar） | `CHAR(3)`，长度不强制 |
| 枚举 | `sa.String(8/16/32)` + CHECK | `VARCHAR(n)` | 长度不强制，但 CHECK 生效 |
| 日期 | `sa.Date` | `DATE` | 文本 `YYYY-MM-DD` |
| 时间戳 | `sa.DateTime` | `TIMESTAMP WITHOUT TIME ZONE` | 文本 `YYYY-MM-DD HH:MM:SS.ffffff` |
| JSON | `JSON().with_variant(JSONB, "postgresql")` | `JSONB` | `JSON`（TEXT） |
| 复合主键 | `PrimaryKeyConstraint("date", "base", "symbol")` | 复合 `PRIMARY KEY` | 同左（`exchange_rates` 没有自增列，决策 §14.1 去掉了旧表的 `BIGSERIAL id`） |

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

**日期列（`DATE`）与时间戳列是两件事**（决策 §14.32）：`DATE` **没有时区、也没有时刻**，它是一个日历日期，用户从新加坡飞到北京它也不会变。目标 schema 里有三个 `DATE` 列——`transactions.occurred_at`、`import_rows.occurred_at`、`exchange_rates.date`——三者一律：

- 库里存 `DATE`，接口一律用 `YYYY-MM-DD` 字符串传输（决策 §14.32）；
- 服务端用 `datetime.date` 处理，**不要**先转成 `datetime` 再取日期（那一步会引入一个凭空的零点时刻，跨时区序列化时差一天）；
- 前端把它当字符串显示和比较，**不得** `new Date("YYYY-MM-DD")` 再格式化（会按 UTC 零点换算导致差一天）；表单默认"今天"取浏览器本地日期而非 UTC 日期（决策 §14.32）；
- 导入文件里的 `date` 列同样是无时区字符串，落库时原样存进 `import_rows.occurred_at`（§1.8）；
- 汇率按这个日历日期查（`exchange_rates.date`，§1.10），不做任何时区换算。

`transactions.occurred_at` 的取值范围由应用层校验：最晚今天 + 1 天（决策 §14.44 的 03-13），数据库不做（"今天"不是不可变函数，进不了 CHECK）。

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

一本账本预期 10 人以内、每年数千笔交易（决策 §2 软限制）。所有列表接口都带 `ledger_id` 前缀过滤 + offset 分页；`import_rows` 单批 ≤2000 行（决策 §5）。`transaction_events` 是交易数的几倍（一条交易一生的事件是个位数），量级上仍然微不足道，不做归档（§6.10）。`exchange_rates` 每天每个货币对一行，永久保留也只是每年几万行。没有分区、没有归档策略。

---

## 8. 测试如何建表

### 8.1 SQLite 内存库（默认路径）

沿用现状：`backend/tests/conftest.py:10` 在导入任何 `app` 模块前把 `DATABASE_URL` 设成 `sqlite:///:memory:`，`conftest.py:47-50` 建专用引擎，`conftest.py:58-69` 的 session 级 fixture 调 `Base.metadata.create_all` / `drop_all`。目标态对这条路径的要求：

1. **`create_all` 必须能建出全部十张表和全部 CHECK**（十张表含 `transaction_events` 与 `exchange_rates`，模型里必须有它们，否则 §8.2 的 `compare_metadata` 断言会失败）。这就是 §1 里每条 CHECK 都避开 Postgres 专有语法的原因：不用 `~` 正则、不用 `ILIKE`、不用 `::` 转型、不用 `ANY(ARRAY[...])`；`length()`、`trim()`、`upper()`、`replace()`、`IN`、`BETWEEN`、布尔等价比较在两个方言里语义一致（`ck_finance_sources_archived_at` 的 `archived = (archived_at IS NOT NULL)` 与 `ck_transactions_transfer_role` 属于同一类布尔等价写法，两边都成立）。另一个必须绕开的坑是**裸 `LIKE` 的大小写敏感性两边不同**（SQLite 对 ASCII 不敏感、Postgres 敏感），所以 §1 里没有任何一条 CHECK 用裸 `LIKE`；同理 `code` 的"6 位数字"用嵌套 `replace` 而不是字符串区间（§1.5）。JSON 列用 `with_variant`（§1.11）。`exchange_rates` 用复合主键、没有自增列，因此不需要旧表那种 `BigInteger().with_variant(Integer, "sqlite")` 的自增主键写法（决策 §14.1 去掉了旧表的 `BIGSERIAL id`，§1.10）。
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
        # ... §1.6 的 12 条全名
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

fixture 思路（`backend/tests/conftest.py`，三个 fixture；前两个是 Postgres 专用，第三个在默认回路里跑）：

- `postgres_url`（session 级）：读环境变量 `TEST_POSTGRES_URL`，没有就 `pytest.skip`，这样默认的纯 SQLite 回路不受影响。
- `migrated_db`（函数级）：用 `isolation_level="AUTOCOMMIT"` 的管理连接 `CREATE DATABASE wallet_test_<随机 hex>`，把库名替换进 URL；构造一个 `alembic.Config`（`script_location` 指向 `backend/migrations`、`sqlalchemy.url` 指向新库），调 `alembic.command.upgrade(cfg, "head")`，`yield` 新库 URL，`finally` 里 `DROP DATABASE ... WITH (FORCE)`。每个用例一个全新空库，用例之间零耦合；要测"有数据的升级"就先 `command.upgrade(cfg, "8a4f4d66d893")` 灌数据、再 `upgrade("head")`。
- `sqlite_migrated_db`（函数级，**不带** `postgres` marker）：`url = f"sqlite:///{tmp_path}/mig.db"`，同样构造一个 `alembic.Config`（`script_location` 指向 `backend/migrations`、`sqlalchemy.url` 设成这个 URL），调 `command.upgrade(cfg, "head")`，`yield` URL。它存在的唯一理由是：§5 那条迁移链里所有加列 / 加约束的步骤都写成了 `batch_alter_table`，而 batch 重建表的路径只有真的在 SQLite 上跑一遍才会暴露问题（漏掉 `DROP INDEX IF EXISTS ix_transactions_user_id` 时 batch 会报 `no such column: user_id`）。它不需要任何外部服务，所以进默认回路，`pytest -m "not postgres"` 也会跑到。

必须覆盖的用例（全部 `@pytest.mark.postgres`）：

| 用例 | 断言 |
|---|---|
| 空库 `upgrade head` | 六步全部执行，`alembic_version` = 最后一个 revision |
| 空库 `upgrade head` 后再 `downgrade base` | 不报错，表全部消失（验证每个 `downgrade` 都写对了） |
| 有数据的库升级 | 先在 head `8a4f4d66d893` 上灌入：2 个用户、每人 2 个账户（一个归档、一个用旧的账户类型取值）、若干交易（含一对正确的转账、一对同号的错误转账、一条 `amount = 0`、一条 `source_id` 指向已删账户的孤儿行）、若干 `transaction_tags`；升级后断言：每人恰好一本账本且是 owner、`finance_sources.ledger_id` / `transactions.ledger_id` 全部非空且一致、`type` 全在四种之内、归档账户的 `archived_at` 非空而未归档账户为空、`users.display_name` 全为 NULL、`kind` 回填正确、同号 pair 被打散成单腿、零金额行被删、`transaction_tags` 不存在 |
| schema 与模型一致 | 升级后用 `alembic revision --autogenerate` 的比较 API（`compare_metadata`）断言 diff 为空——防止迁移与模型漂移，这是现状最大的隐患（现状模型改过而没有对应迁移，`../current-design/02-database.md` §6）。迁移第 1 步和模型都必须有 `exchange_rates`（决策 §14.1），少一边这条断言就会失败 |
| 约束真的生效 | 逐条插入违反 §1.6.1 八个约束的行，断言 `IntegrityError`；插入合法行断言成功 |
| 账户类型与归档时刻 | 升级后插入 `type` 为四种之外的账户断言 `IntegrityError`；插入 `archived = TRUE, archived_at = NULL` 或 `archived = FALSE, archived_at = <ts>` 都断言 `IntegrityError`（决策 §14.48、§14.50）|
| 旧账户类型被改写 | 在 head `8a4f4d66d893` 上灌入 `type` 为旧的"储蓄"取值与一个自造字符串的账户，升级后断言两行的 `type` 都是 `checking`、且 `ck_finance_sources_type` 加得上（决策 §14.48）|
| 邀请码没有唯一索引 | 升级后往同一账本插入两行 `code` 相同、`expires_at` 不同的邀请码，断言**都能插入成功**（决策 §14.29：唯一性由生成时的重试保证，不由数据库保证）；再断言 `ledger_invites` 上除主键外只有 `ix_ledger_invites_ledger_id` 一个索引 |
| 操作记录随交易级联 | 升级后建一条交易 + 三条 `transaction_events`，删掉交易，断言事件行数归零；插入 `event` 为七种之外的值断言 `IntegrityError`（决策 §14.51）|
| 索引被正确 drop（Postgres） | 在 head `8a4f4d66d893` 上灌数据后升级，断言 `ix_transactions_user_id`、`ix_accounts_user_id`、`ix_transactions_account_id`、`idx_transactions_transfer_pair` 都已不在 `SELECT indexname FROM pg_indexes WHERE tablename IN ('transactions','finance_sources')` 的结果里（对应 §5.3 / §5.4 那几段 `DROP INDEX IF EXISTS`） |
| `exchange_rates` 可用 | 升级后 upsert 同一 `(date, base, symbol)` 两次，断言只有一行且 `rate` / `fetched_at` 被刷新；插入 `rate = 0` 或 `base = symbol` 断言 `IntegrityError`（决策 §14.1、§1.10）|

另有一条**不带** `@pytest.mark.postgres` 的用例，跑在上面的 `sqlite_migrated_db` 上——`pg_indexes` 在 SQLite 上不存在，所以断言换一套写法，但要盯的是同一件事（§5.3 那几段 `DROP INDEX IF EXISTS` 少一条，batch 重建就会失败）：

```python
@pytest.fixture()
def sqlite_migrated_db(tmp_path):
    url = f"sqlite:///{tmp_path}/mig.db"
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))   # backend/migrations
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")        # 光是这一句不抛异常就已经有价值
    yield url


def test_upgrade_head_on_sqlite_drops_legacy_indexes(sqlite_migrated_db):
    engine = create_engine(sqlite_migrated_db)
    with engine.connect() as conn:
        tx_indexes = {row[1] for row in conn.exec_driver_sql(
            "PRAGMA index_list('transactions')")}
        all_indexes = {row[0] for row in conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='index'")}
    assert "ix_transactions_user_id" not in tx_indexes
    # 两个名字都断言：alembic 路径上真正被建出来、需要被 drop 的是
    # ix_accounts_user_id（初始迁移建表时的名字），ix_finance_sources_user_id
    # 只出现在 create_all 建出的开发库里（命名分叉见 §5.3），两个都写才两条路径都盖到
    for name in ("ix_transactions_user_id", "ix_accounts_user_id",
                 "ix_finance_sources_user_id"):
        assert name not in all_indexes
```

（`PRAGMA index_list` 只看单表，`sqlite_master` 兜住"索引跟着 batch 重建换了张表"的情况，两个都查一遍。空库跑 `upgrade head` 覆盖不到回填分支，但覆盖得到本文最想拦的那类回归：batch 重建时撞上一个没被 drop 掉的旧索引。）

CI 里用一个 `postgres:15-alpine` service 提供 `TEST_POSTGRES_URL`；本地开发用 `infra/docker-compose.dev.yml` 已有的 db 容器（它把 5432 发布到宿主机）。没有该环境变量时这些测试自动 skip，`pytest -m "not postgres"` 保持纯 SQLite 的快速回路。

---

## 待决

**本章没有待决项。** 原有的九条在决策记录里全部有了结论，逐条留一行只作记录，不再影响正文——正文按裁定书写，不保留任何"建议默认值"。

| # | 问题 | 结论 |
|---|---|---|
| D-1 | `exchange_rates` 建不建、什么形状 | **已由决策 §14.1 裁定**：新建缓存表 `(date, base, symbol, rate, fetched_at)`，主键 `(date, base, symbol)`，目标币种列名 `symbol`；在迁移第 1 步一并建（§1.10、§5.1） |
| D-2 | `users.default_source_id` 删除后默认账户从哪来 | **已由决策 §14.6 裁定**：删除该列，默认账户由前端本地记住上次使用的账户，不入库、不加 `ledger_members.default_source_id`（§5.6） |
| D-3 | `import_rows` 的日期列叫 `date` 还是 `occurred_at` | **已由决策 §14.41 裁定**：数据库列与交易表一致叫 `occurred_at`（`DATE`），导入文件的固定表头与接口字段仍叫 `date`，映射在服务层（§1.8） |
| D-4 | 模型配置表的密钥列名 | **已由决策 §14.25 作废**：应用不接入 LLM，这张表整个不存在，也就没有密钥列（§0） |
| D-5 | 同一账本内账户是否允许重名 | **已由决策 §14.40 裁定**：允许，不加任何唯一约束，按 id 区分、只在界面提示（§1.5） |
| D-6 | 已用 / 已过期邀请码何时删 | **已由决策 §14.29 裁定**：用掉即删、过期即删（生成或校验时惰性清理）、owner 作废也是删行；不做定时清理，`code` 不建唯一索引（§1.4、§6.3） |
| D-7 | "每人 ≤10 本账、每本 ≤10 人"是否需要数据库约束 | **已由决策 §14.41 裁定**：只在应用层 `COUNT(*)` 校验，不加触发器（§3.2） |
| D-8 | 视觉解析路径的页面缩略图存哪里 | **已由决策 §14.25 作废**：没有解析、没有缩略图、没有上传目录，`import_rows` 的页码列一并删除（§1.8、§6.6） |
| D-9 | 迁移对回填不出 `ledger_id` 的行与 `amount = 0` 的历史行怎么办 | **已由决策 §14.41 裁定**：删除并打 warning 日志、不中止；`delete_and_warn`（§5.0）已写进第 3、4 两步 |

---

## 另见

- [./README.md](./README.md) — 目标设计总览与文档索引
- [./00-decisions.md](./00-decisions.md) — 决策记录（唯一事实来源）
- [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域模型、状态机与端到端流程
- [./03-backend-api.md](./03-backend-api.md) — 后端结构与全部接口定义
- [./04-frontend.md](./04-frontend.md) — 信息架构、页面与 API 客户端
- [./05-import-and-llm.md](./05-import-and-llm.md) — 标准 CSV 格式、导入 skill、校验规则与自动标记
- [./mockups/README.md](./mockups/README.md) — 定稿的 16 张屏幕稿与视觉 token
- [./mockups/REVIEW-2026-09-11.md](./mockups/REVIEW-2026-09-11.md) — 屏幕稿审阅记录（`archived_at`、`transaction_events`、账户类型四种等本轮改动的来处）
- [../current-design/02-database.md](../current-design/02-database.md) — 现状数据库设计（本文所有"现状"引用的出处）
- [../current-design/01-domain-and-flows.md](../current-design/01-domain-and-flows.md) — 现状领域模型
- [../current-design/03-backend-api.md](../current-design/03-backend-api.md) — 现状接口
- [../current-design/06-known-issues.md](../current-design/06-known-issues.md) — 现状已知问题（本文修掉的那些）
