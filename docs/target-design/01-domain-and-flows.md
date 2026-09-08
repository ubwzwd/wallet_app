# 01 — 领域模型、流程与状态机（目标设计 v3.0）

> **本文回答什么问题**：v3.0 的钱包应用里"一笔账"到底是什么——有哪些实体、每个实体有哪些字段、四种交易种类（kind）各自的符号与统计口径、从注册到撤销一次导入的全部用户流程、每个流程服务端按什么顺序校验、失败时怎么办、以及统计数字精确到公式的算法。
>
> **事实来源**：本文的每一个决定都来自 [`./00-decisions.md`](./00-decisions.md)，正文用 `（决策 §x.y）` 标注出处。本文只展开决策，不改写决策；决策没覆盖的问题集中列在文末 `## 待决`。
>
> **对照基准**：凡说"现状"，指 [`../current-design/01-domain-and-flows.md`](../current-design/01-domain-and-flows.md) 描述的、仓库 `main` 提交 `56881b2` 的代码状态；引用现状代码用 `path:line`。凡说"目标"，是尚未实现的设计，不要当成已有代码去读。
>
> **与其他章的分工**：本章写"是什么"和"什么规则"；建表 DDL、索引、迁移在 [`./02-database.md`](./02-database.md)；每个接口的参数、状态码、响应体在 [`./03-backend-api.md`](./03-backend-api.md)；界面在 [`./04-frontend.md`](./04-frontend.md)；账单解析的实现细节、提示词、schema 在 [`./05-import-and-llm.md`](./05-import-and-llm.md)。本章只写导入的**状态与业务规则**。
>
> **修订说明**：本版按终审意见与决策 §14「评审后的补充裁定」修订。主要变化：全文的错误 `code` 一律改用 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的**唯一注册表**里的名字与状态码（决策 §14.4），本章不再自造同义名；`exchange_rates` 的目标币种列由 `quote` 改为 `symbol`（决策 §14.1）；`kind` 在 `transfer` 与非 `transfer` 之间禁止互改（决策 §14.3）；账户余额口径改为"以账户币种计价、异币种交易按发生日汇率折算"（决策 §14.2，§5.4）；`import_rows` 行号列为 `row_no`（决策 §14.5）。本章篇幅超过最初的行数目标，按决策 §14.8 行数不作为验收项，内容不因压行而删减。

---

## 0. 本章范围与对照现状的总体差异

本章覆盖：领域模型（§1）、四种 kind（§2）、全部用户流程（§3）、状态机（§4）、统计口径与算例（§5）、不变量（§6）。

本章**不覆盖**：预算、找回密码/邮箱验证、分类管理、标签、实时协同、移动 App、"不计收支"标记、交易时刻（`occurred_at` 仍然只到天）——这些在本版本明确不做（决策 §0.7）。部署与运维沿用现状（决策 §0.1）。

### 0.1 现状 → 目标 逐项差异

| # | 主题 | 现状 | 目标 | 决策 |
|---|---|---|---|---|
| 1 | 数据归属 | 一切挂在 `users.id` 下，没有账本概念 (backend/app/models/transaction.py:17) | 引入 `ledgers` / `ledger_members` / `ledger_invites`；账户、交易、导入都挂 `ledger_id`，鉴权 = "调用者是该账本成员" | §2 |
| 2 | 交易种类 | 没有 `kind` 列，方向完全由 `amount` 的符号承载 (backend/app/models/transaction.py:19)，前端编辑时按符号反推类型 (frontend/src/screens/TransactionFormScreen.tsx:76-87) | 显式 `kind ∈ {expense, income, refund, transfer}`，符号由数据库 CHECK 保证 | §1、§10 |
| 3 | 退款 | 不存在退款概念，只能记成一条正金额交易（会被算成收入） | 独立 kind `refund`，可关联原支出 `refund_of`，统计时按退款日期冲减该分类的支出 | §1.1 |
| 4 | 转账 | 两行共享 `transfer_pair_id`，后端零校验，单腿也被接受 (backend/app/api/transactions.py:91-100)，删除时按 pair 批量删 (backend/app/api/transactions.py:447-459) | `transfer_role` / `transfer_subtype` 必填；`transfer_pair_id` **可空**（对手账户不在应用里就是单腿，可填 `counterparty` 文本）；两腿走专用接口原子创建/修改/删除；两腿允许跨币种、金额可不等 | §1.2 |
| 5 | 分类 | 自由标签表 `transaction_tags` (backend/app/models/transaction_tag.py:11-20)，规范化只有 `strip().lower()`，重复标签会 500 | 后端常量里的固定两级分类表，`category_l1` / `category_l2` 存 code，服务端校验；**删除** `transaction_tags`、`?tag=` 筛选和标签输入框 | §1.3、§10 |
| 6 | 备注字段 | `transactions.description` (backend/app/models/transaction.py:22) | 改名 `note`（≤500 字），语义"这笔账的备注"；`merchant`（≤200 字）保留为独立字段 | §1.4 |
| 7 | 资金账户 | 无期初余额、无 `cash` 类型（API 正则只认 checking/savings/credit/other，backend/app/schemas/finance_source.py:21-26）、无删除接口 | 加 `opening_balance`、`cash` 类型；有交易的账户不能删只能归档；归档账户真正禁止记账 | §3 |
| 8 | 余额 | 没有余额概念 | 余额以账户 `default_currency` 计价 = `opening_balance` + Σ 该账户交易折算到账户币种（异币种按发生日汇率），含单腿转账 | §3、§7、§14.2 |
| 9 | 汇率换算 | 两套公式：单行路径 `amount × rate` (backend/app/api/transactions.py:20-46；backend/app/services/rates.py:135-139)，列表路径 `amount / rate` (backend/app/api/transactions.py:244-255)，且 `conversion_date` 永远是服务器当天 | 统一为一个函数：交易与统计用**发生日**汇率，账户余额用**最新**汇率，无行情日回退到最近一个已公布交易日 | §8 |
| 10 | 汇率缓存 | 无缓存表（`exchange_rates` 已被迁移删除，backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25），每次响应现拉 Frankfurter | **新建** `exchange_rates(date, base, symbol, rate, fetched_at)` 缓存表，来源仍是 Frankfurter | §8、§10、§14.1 |
| 11 | 账单导入 | 完全没有 | `import_batches` + `import_rows` 两张表、五态状态机、LLM 解析、review 表格、整批撤销 | §5、§6 |
| 12 | LLM | 完全没有 | 每用户一份 `user_llm_settings`（OpenAI 兼容端点 + 自己的 key，服务端 Fernet 加密存） | §6 |
| 13 | 并发 | 无任何保护，两个客户端后写覆盖先写 | `transactions` / `finance_sources` / `ledgers` 带 `updated_at`，PATCH 必须回传，不一致返回 409 `stale_update` | §2 |
| 14 | 统计 | 没有统计接口 | 月度分类汇总（可下钻二级）+ 最近 12 个月趋势，全部折算到**账本**基准币种 | §7 |
| 15 | 基准币种 | 属于用户 `users.base_currency` (backend/app/models/user.py:19) | 属于**账本** `ledgers.base_currency`；`users.base_currency` 降级为"新建账本时的默认值" | §2 |
| 16 | 错误响应 | `{"detail": "..."}`，422 时 `detail` 是数组 | 统一 `{"detail": "...", "code": "snake_case_code"}`；`code` 取值只能来自 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的唯一注册表 | §9、§14.4 |
| 17 | 界面语言 | 只有英文硬编码 | 中英双语 i18n（默认跟随系统），分类名和错误信息都双语 | §0.4 |

---

## 1. 领域模型

### 1.1 实体关系总览

```
                 +--------+  1        0..1  +--------------------+
                 | users  |--------------->| user_llm_settings  |
                 +--------+                +--------------------+
                   |    ^
      created_by / |    | user_id
      updated_by   |    |
                   v    |
               +-----------------+  N        1  +---------+
               | ledger_members  |------------->| ledgers |
               +-----------------+              +---------+
                                                  ^  ^  ^
                                     ledger_id    |  |  |
        +-----------------+  N -------------------+  |  |
        | ledger_invites  |                          |  |
        +-----------------+                          |  |
                                                     |  |
        +------------------+  N ---------------------+  |
        | finance_sources  |                            |
        +------------------+                            |
             ^        ^                                 |
   source_id |        | source_id (导入的目标账户)       |
             |        |                                 |
        +--------------+  N ----------------------------+
        | transactions |
        +--------------+
          ^  |      ^
 refund_of|  |      | import_batch_id
   (自引用)|  |      |
          +--+      |     +----------------+  N ------> ledgers
                    +-----| import_batches |
                          +----------------+
                                  ^ batch_id
                                  |
                          +----------------+
                          |  import_rows   |-- matched_transaction_id --> transactions
                          +----------------+-- counterpart_source_id ---> finance_sources

        +----------------+
        | exchange_rates |   全局行情缓存，不属于任何账本
        +----------------+
```

目标表共 10 张：`users`、`user_llm_settings`、`ledgers`、`ledger_members`、`ledger_invites`、`finance_sources`、`transactions`、`import_batches`、`import_rows`、`exchange_rates`；`transaction_tags` 删除（决策 §10）。枚举一律 `VARCHAR + CHECK`，不用 Postgres ENUM（决策 §10）。

下面每张表的字段清单里，"必填"指数据库 `NOT NULL`。第一轮评审后标 ★ 的三个补充字段（`users.language`、`user_llm_settings.created_at`、`ledger_invites.created_at`）已由决策 §14.6 正式裁定，不再是待决项。

### 1.2 用户 `users`

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `email` | VARCHAR | 登录邮箱，唯一 | 是 |
| `password_hash` | VARCHAR | bcrypt 哈希 | 是 |
| `base_currency` | CHAR(3) | **新建账本时的默认基准币种**，不再直接参与任何换算（决策 §2、§13.6） | 是 |
| `language` | VARCHAR(8) | 界面语言，`zh` / `en`；**可空，NULL 表示跟随系统**；`PATCH /me` 可改（决策 §14.6） | 否 |
| `created_at` | TIMESTAMP | 注册时间 | 是 |

现状的 `users.default_source_id` (backend/app/models/user.py:20) 在多账本模型里语义不再成立（账户属于账本，一个用户可能在 10 本账里各有账户），**决策 §14.6 已裁定删除该列**：记账表单改用前端本地记住的"该账本内上次使用的账户"。

### 1.3 LLM 设置 `user_llm_settings`（决策 §6）

每用户 0 或 1 行；不属于任何账本，接口是 `/api/v1/me/llm-settings`（决策 §2、§11）。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `user_id` | UUID | 主键，外键 `users.id` | 是 |
| `base_url` | VARCHAR | OpenAI 兼容端点，默认 `https://openrouter.ai/api/v1` | 是 |
| `api_key` | TEXT | 服务端 Fernet 加密存储；接口只回显尾 4 位 | 是 |
| `model` | VARCHAR | 文本解析用模型 id | 是 |
| `vision_model` | VARCHAR | 图片解析用模型 id；为空时用 `model` | 否 |
| `created_at` | TIMESTAMP | 创建时间（决策 §14.6 已裁定要加这一列） | 是 |
| `updated_at` | TIMESTAMP | 最后修改时间 | 是 |

**没有服务端共享 key**：没配 key 的用户进入导入页时直接被引导去设置页（决策 §6）。LLM 调用发生在服务端，但用的是操作者自己的 key。

### 1.4 账本 `ledgers`（决策 §2）

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `name` | VARCHAR(100) | 账本名，如"我的账本""家庭账本" | 是 |
| `base_currency` | CHAR(3) | **基准币种属于账本**：余额合计、统计汇总都折算到它 | 是 |
| `created_by` | UUID | 创建者 `users.id` | 是 |
| `created_at` | TIMESTAMP | 创建时间 | 是 |
| `updated_at` | TIMESTAMP | 乐观并发用（决策 §2） | 是 |

软限制：每人最多 10 本账（决策 §2）。

### 1.5 成员 `ledger_members`（决策 §2）

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `ledger_id` | UUID | 复合主键之一，外键 `ledgers.id` | 是 |
| `user_id` | UUID | 复合主键之一，外键 `users.id` | 是 |
| `role` | VARCHAR(16) | `owner` / `member` | 是 |
| `joined_at` | TIMESTAMP | 加入时间；创建者取账本创建时间 | 是 |

- 创建者自动成为 `owner`；**每本账恰有一个 owner**，由应用层保证（决策 §2）。
- 权限矩阵：

| 操作 | owner | member |
|---|---|---|
| 记账、改账、删账 | ✓ | ✓ |
| 管理账户（增 / 改 / 归档 / 删空账户） | ✓ | ✓ |
| 账单导入、review、提交、撤销 | ✓ | ✓ |
| 查看成员列表 | ✓ | ✓ |
| 生成邀请码 | ✓ | ✗ |
| 移除成员 | ✓ | ✗ |
| 改账本名 / 基准币种 | ✓ | ✗ |
| 转让 owner | ✓ | ✗ |
| 删除账本 | ✓ | ✗ |
| 自行退出 | 必须先转让 | ✓ |

软限制：每本账最多 10 人（决策 §2）。

### 1.6 邀请码 `ledger_invites`（决策 §2）

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 外键 `ledgers.id` | 是 |
| `code` | CHAR(6) | 6 位数字，线下口头告诉对方 | 是 |
| `created_by` | UUID | 生成者（必为当时的 owner） | 是 |
| `created_at` | TIMESTAMP | 生成时间（决策 §14.6 已裁定要加这一列） | 是 |
| `expires_at` | TIMESTAMP | 生成后 10 分钟 | 是 |
| `used_by` | UUID | 使用者 `users.id`；未使用为 NULL | 否 |
| `used_at` | TIMESTAMP | 使用时间；未使用为 NULL | 否 |

一次性使用：`used_by` 一旦写入，该码立即作废。

### 1.7 资金账户 `finance_sources`（决策 §3）

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 所属账本；账本内账户完全共享（决策 §2） | 是 |
| `name` | VARCHAR(100) | 账户名，如"招行储蓄卡""招行信用卡" | 是 |
| `type` | VARCHAR(32) | `checking` / `savings` / `credit` / `cash` / `other` | 是 |
| `default_currency` | CHAR(3) | 记账时的默认币种（单笔交易可以是别的币种） | 是 |
| `opening_balance` | NUMERIC(18,4) | 期初余额，默认 `0`；信用卡的期初欠款是负数 | 是 |
| `archived` | BOOLEAN | 归档标志，默认 `false` | 是 |
| `created_by` | UUID | 创建者 | 是 |
| `updated_by` | UUID | 最后修改者 | 是 |
| `created_at` | TIMESTAMP | | 是 |
| `updated_at` | TIMESTAMP | 乐观并发用 | 是 |

**余额是算出来的，不落库**：`balance = opening_balance + Σ amount`（该账户所有交易，含单腿转账，决策 §3）。精确定义见 §5.4。

与现状的差别：现状没有 `opening_balance`、没有 `cash` 类型 (backend/app/schemas/finance_source.py:21-26)、也没有删除接口（`backend/app/api/finance_sources.py` 只注册了 post / get / get / patch 四个路由）。

### 1.8 交易 `transactions`（决策 §1、§10）

一笔交易 = 在**恰好一个**资金账户上、**恰好一种**币种、**某一天**发生的一次带符号的资金变动。这一条继承自现状，不变。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 所属账本 | 是 |
| `source_id` | UUID | 资金账户，外键 `finance_sources.id` | 是 |
| `kind` | VARCHAR(16) | `expense` / `income` / `refund` / `transfer` | 是 |
| `amount` | NUMERIC(18,4) | **带符号**金额，符号由 `kind`（转账再看 `transfer_role`）决定 | 是 |
| `currency` | CHAR(3) | ISO 4217，大写 | 是 |
| `occurred_at` | DATE | 发生日，只到天（决策 §0.7 明确不做时刻） | 是 |
| `note` | VARCHAR(500) | 备注（现状叫 `description`，决策 §1.4 改名） | 否 |
| `merchant` | VARCHAR(200) | 商户；搜索、退款匹配、导入去重都靠它 | 否 |
| `category_l1` | VARCHAR(32) | 一级分类 code；`transfer` 必须为 NULL，其余 kind 必填 | 条件 |
| `category_l2` | VARCHAR(32) | 二级分类 code；必须属于 `category_l1` | 否 |
| `refund_of` | UUID | 仅 `refund` 可填，指向同账本一条 `kind='expense'`，`ON DELETE SET NULL` | 否 |
| `transfer_role` | VARCHAR(8) | `out` / `in`；`kind='transfer'` 时必填，其余 kind 必须为 NULL | 条件 |
| `transfer_subtype` | VARCHAR(16) | `plain` / `repayment`；`kind='transfer'` 时必填，其余 kind 必须为 NULL | 条件 |
| `transfer_pair_id` | UUID | 两腿共用；**可空**（单腿转账为 NULL） | 否 |
| `counterparty` | VARCHAR(100) | 对方文本（"老婆""工资卡"），只在单腿转账填 | 否 |
| `import_batch_id` | UUID | 由哪一批导入创建；手工记账为 NULL | 否 |
| `created_by` | UUID | 记账人 | 是 |
| `updated_by` | UUID | 最后修改人 | 是 |
| `created_at` | TIMESTAMP | | 是 |
| `updated_at` | TIMESTAMP | 乐观并发用 | 是 |

### 1.9 退款关联（决策 §1.1）

退款不是一张表，是 `transactions` 上的一个自引用外键 `refund_of`：

- 只有 `kind='refund'` 的行可以有 `refund_of`（CHECK：`refund_of IS NULL OR kind='refund'`，决策 §10）。
- 被指向的行必须在**同一账本**、且 `kind='expense'`（应用层校验）。
- 关联成功后，退款行的 `category_l1` / `category_l2` **自动沿用原支出**，用户可改。
- **部分退款** = 多条 `refund` 行指向同一条原支出。
- **超额退款**：累计退款金额超过原单金额时，前端警告但**允许保存**；服务端不拦（决策 §1.1）。
- **原单被删除**：`refund_of` 置空（`ON DELETE SET NULL`），退款行本身保留、分类不动，仍按自己的分类和日期参与统计冲减。
- 退款行也可以完全不关联原单（`refund_of` 为 NULL），此时它就是"某分类的一笔负向支出"。
- 选原单的界面复用交易列表的搜索筛选：默认 `kind=expense`、同账户预填但可改、最近 90 天，每条显示已退 / 可退金额（决策 §1.1）。

### 1.10 转账腿（决策 §1.2）

一次转账在数据库里是 **1 行或 2 行**：

| 形态 | 行数 | `transfer_pair_id` | `counterparty` | 典型场景 |
|---|---|---|---|---|
| 两腿 | 2 | 两行同一个 UUID | 必须为 NULL | 自己的储蓄卡 → 自己的信用卡还款；储蓄卡 → 现金 |
| 单腿 | 1 | NULL | 可填文本 | 老婆给我转账、我给别人转账、用没录入应用的工资卡还信用卡 |

规则：

- `transfer_role`：转出腿 `out`（`amount` 负），转入腿 `in`（`amount` 正）。
- `transfer_subtype`：`plain`（普通划转）或 `repayment`（信用卡还款）。两腿必须一致。
- `UNIQUE (transfer_pair_id, transfer_role)`，NULL 不参与——保证同一个 pair 最多一条 out、一条 in（决策 §10）。
- `transfer_pair_id IS NULL OR counterparty IS NULL`——有对腿就不填对方文本（决策 §10）。
- **两腿支持跨币种**：两腿各存自己的 `currency` 和 `amount`，**不要求金额相等**（出 100 USD / 入 720 CNY）。汇兑差价不单独记账，手续费另记一笔 `expense`，分类 `other` / `fees`（决策 §1.2）。
- **单腿计入账户余额，不计入收入/支出统计**（决策 §1.2）；两腿同样不计入统计。
- 表单和导入的默认建议：外部转入默认建议记为 `income`（分类 `social_income` 等），用户明确选"转账"才记 `transfer`——避免真正的收入消失在统计之外（决策 §1.2）。

### 1.11 导入批次 `import_batches`（决策 §5）

一次上传 = 一批。一份账单对应**一个**目标账户，上传时由用户选，不让 LLM 猜。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 所属账本 | 是 |
| `source_id` | UUID | 目标资金账户（不能是已归档账户） | 是 |
| `created_by` | UUID | 上传人 | 是 |
| `filename` | VARCHAR(255) | 原始文件名 | 是 |
| `mime_type` | VARCHAR(128) | 上传时的 MIME | 是 |
| `size_bytes` | INTEGER | 文件大小，≤ 10 MB | 是 |
| `status` | VARCHAR(16) | `uploaded` / `parsing` / `ready` / `committed` / `failed` | 是 |
| `error` | TEXT | 失败原因（`failed` 时非空） | 否 |
| `model` | VARCHAR(128) | 本次实际使用的模型 id（文本或视觉） | 否 |
| `llm_raw_response` | TEXT | LLM 原始响应，排障用 | 否 |
| `row_count` | INTEGER | 解析出的草稿行数 | 否 |
| `created_at` | TIMESTAMP | | 是 |
| `updated_at` | TIMESTAMP | 状态最后变化时间 | 是 |

### 1.12 导入草稿行 `import_rows`（决策 §5）

草稿单独一张表，不污染正式交易表；也不用 JSON 单列（多人 review 时会互相覆盖，且没法建外键）。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `batch_id` | UUID | 外键 `import_batches.id`，`ON DELETE CASCADE` | 是 |
| `row_no` | INTEGER | 批内序号，决定 review 表格顺序 | 是 |
| `status` | VARCHAR(16) | `pending` / `edited` / `skipped` | 是 |
| `date` | DATE | 解析出的发生日；解析失败为 NULL 并打 `needs_review` | 否 |
| `amount` | NUMERIC(18,4) | 带符号金额；解析失败为 NULL 并打 `needs_review` | 否 |
| `currency` | CHAR(3) | 币种，缺省取目标账户的 `default_currency` | 否 |
| `kind` | VARCHAR(16) | LLM 给出的 kind | 否 |
| `merchant` | VARCHAR(200) | 商户 | 否 |
| `note` | VARCHAR(500) | 备注（原文摘要清理后 + 外币原值等） | 否 |
| `category_l1` | VARCHAR(32) | 一级分类 code；LLM 拿不准就留空，review 表显示"待归类" | 否 |
| `category_l2` | VARCHAR(32) | 二级分类 code | 否 |
| `confidence` | NUMERIC(3,2) | LLM 自评置信度 0.00–1.00 | 否 |
| `source_ref` | VARCHAR(64) | 指回原文的行号，或"页码+行序" | 否 |
| `flags` | 字符串数组 | 服务端标记：`duplicate` / `refund_candidate` / `repayment` / `needs_review` | 否 |
| `matched_transaction_id` | UUID | 退款候选原单（唯一候选时预填） | 否 |
| `counterpart_source_id` | UUID | 还款行的对手账户（找到时预填） | 否 |
| `transfer_subtype` | VARCHAR(16) | `plain` / `repayment` | 否 |
| `transaction_id` | UUID | 提交后建出来的交易 id | 否 |

限制：单批 ≤ 2000 行（决策 §5）。解析流水线、分块、提示词、输出 schema、标记算法见 [`./05-import-and-llm.md`](./05-import-and-llm.md)。

### 1.13 汇率 `exchange_rates`（决策 §8、§10）

来源 Frankfurter，**换算读取时计算、不落到交易行上**；这张表只是行情缓存。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `date` | DATE | 行情日（Frankfurter 返回的 `date`，不是服务器当天） | 是 |
| `base` | CHAR(3) | 基准币种 | 是 |
| `symbol` | CHAR(3) | 目标币种；列名与现有 `/rates/latest?symbols=` 参数同源（决策 §14.1） | 是 |
| `rate` | NUMERIC(18,8) | `1 base = rate symbol` | 是 |
| `fetched_at` | TIMESTAMP | 抓取时间 | 是 |

主键 `(date, base, symbol)`（决策 §14.1）。**现状没有这张表，必须新建**：迁移 backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25 把它删掉了，现状每次响应都现拉 Frankfurter。v3.0 重新引入，DDL 见 [`./02-database.md`](./02-database.md)，读写算法见 [`./03-backend-api.md`](./03-backend-api.md) §6。

---

## 2. 交易的四种 kind

**只有统计口径不同的东西才成为 kind，四种之外不再加**（决策 §1）。

### 2.1 一览

| kind | 金额符号 | `category_l1` | `category_l2` | `transfer_role` / `transfer_subtype` | 统计口径 | 计入账户余额 |
|---|---|---|---|---|---|---|
| `expense` | 负（`amount < 0`） | 必填，必须是**支出**一级分类 | 可选，必须属于该一级 | 都必须 NULL | 计入该分类的月度支出，取绝对值 | 是 |
| `income` | 正（`amount > 0`） | 必填，必须是**收入**一级分类 | 可选，必须属于该一级 | 都必须 NULL | 计入该分类的月度收入 | 是 |
| `refund` | 正（`amount > 0`） | 必填，必须是**支出**一级分类（关联原单时自动沿用） | 可选 | 都必须 NULL | **按退款自己的 `occurred_at` 冲减该分类的支出**，不算收入 | 是 |
| `transfer` | `out` 腿负、`in` 腿正 | 必须 NULL | 必须 NULL | 两者都必填 | **完全不计入**收入/支出统计（两腿、单腿都一样） | 是 |

### 2.2 逐种说明

**`expense`（支出）** —— 最常见的一笔账。分类用支出侧的 16 个一级分类（决策 §1.3）。金额存负数，展示时取绝对值。可以被 `refund` 行通过 `refund_of` 指向。

**`income`（收入）** —— 分类用收入侧的 6 个一级分类。注意"退款不是收入分类"——退回来的钱记 `refund` 而不是 `income`（决策 §1.3 边界约定）。别人转给我的钱**默认建议记 `income`**（`social_income` / `transfer_in`），只有用户明确选"转账"才记 `transfer`（决策 §1.2）。

**`refund`（退款）** —— 金额为正，但它不是收入，它是"某笔支出退回来了"。统计上按**退款行自己的 `occurred_at`** 决定落在哪个月、按**退款行自己的 `category_l1`** 决定属于哪个分类，去冲减那个月那个分类的支出（决策 §1）。所以 3 月的支出在 4 月退款，会让 3 月的分类支出不变、4 月的该分类支出减少（算例见 §5.5.1）。

**`transfer`（转账）** —— 本人账户之间的资金划转，包括信用卡还款。它只搬钱、不产生损益，所以完全不进收支统计，只进账户余额。`transfer_subtype='repayment'` 用来把信用卡还款和普通划转区分开（导入去重、界面文案要用），但**统计口径上两者相同**——所以 `repayment` 是 subtype 而不是第五种 kind。

### 2.3 允许的编辑

| 从 → 到 | 允许？ | 说明 |
|---|---|---|
| `expense` → `income` | ✓ | `PATCH /transactions/{tid}` 带 `kind`；服务端翻转金额符号并**重新校验分类**：原支出分类不再合法，必须同时传新的 `category_l1`，否则 400 `category_kind_mismatch` |
| `expense` → `refund` | ✓ | 符号从负翻正；分类仍在支出侧，可以不变；可同时设 `refund_of` |
| `income` → `expense` | ✓ | 符号翻负；分类必须换成支出侧 |
| `income` → `refund` | ✓ | 符号都是正，但分类必须从收入侧换成支出侧 |
| `refund` → `expense` | ✓ | 符号翻负；`refund_of` 必须清空（CHECK 要求非 refund 不得有 `refund_of`） |
| `refund` → `income` | ✓ | 分类必须换成收入侧；`refund_of` 必须清空 |
| 非 transfer → `transfer` | ✗ | 400 `kind_change_not_allowed`（决策 §14.3）。转账涉及对腿、pair、subtype，改 kind 语义不清——**只能删了重记**。注意：服务端必须**单独判这一条**，不能只靠"改完之后的整行"过 CHECK——一条单腿转账只要同时清掉 `transfer_role` / `transfer_subtype`、补上分类、把金额改成负数，§6.1 的每条 CHECK 都满足（见 [`./03-backend-api.md`](./03-backend-api.md) §5.31） |
| `transfer` → 非 transfer | ✗ | 同上，400 `kind_change_not_allowed`（决策 §14.3） |
| `transfer` → `transfer` | ✓ | 允许改 `transfer_subtype`（plain ⇄ repayment）、金额、日期、账户、备注，但必须走对应接口（见下表） |

**接口边界**（决策 §1.2、§11）：

| 交易形态 | 创建 | 修改 | 删除 |
|---|---|---|---|
| `expense` / `income` / `refund` | `POST /ledgers/{id}/transactions` | `PATCH /ledgers/{id}/transactions/{tid}` | `DELETE /ledgers/{id}/transactions/{tid}` |
| **单腿** transfer（`transfer_pair_id IS NULL`） | `POST /ledgers/{id}/transactions` | `PATCH /ledgers/{id}/transactions/{tid}` | `DELETE /ledgers/{id}/transactions/{tid}` |
| **两腿** transfer（`transfer_pair_id` 非空） | `POST /ledgers/{id}/transactions/transfer` | `PATCH /ledgers/{id}/transactions/transfer/{pair_id}` | `DELETE /ledgers/{id}/transactions/transfer/{pair_id}` |

**两腿转账的任一腿不能单独 PATCH 或 DELETE**：对一条 `transfer_pair_id` 非空的行调用 `PATCH /transactions/{tid}` 或 `DELETE /transactions/{tid}`，一律返回 **409 `use_transfer_endpoint`**，`detail` 指出应改用 `.../transfer/{pair_id}`。这条把现状最大的一个坑堵死了：现状允许单独 PATCH 一条腿导致两腿漂移，创建和编辑都靠客户端顺序发两个请求 (frontend/src/screens/TransactionFormScreen.tsx:161-234 创建、:236-294 编辑)，只有删除是服务端按 pair 批量删 (backend/app/api/transactions.py:447-459)。

**单腿 ⇄ 两腿不能互转**：给一条单腿转账补对腿、或把两腿拆成单腿，都不支持——删了重记。

CHECK 约束把符号、分类、角色的一致性钉死在数据库里，完整清单见 §6.1 和 [`./02-database.md`](./02-database.md)。

---

## 3. 流程

约定：所有业务接口都在 `/api/v1/ledgers/{ledger_id}/...` 下（决策 §2、§11）；每个请求先过两道通用前置，下文不再重复：

1. **鉴权**：`Authorization: Bearer <JWT>`，无效 / 过期 → 401 `unauthorized`。
2. **账本成员校验**：`ledger_members` 里存在 `(ledger_id, current_user.id)` 才继续；否则 **404 `not_found`**（不区分"不存在"和"没权限"，避免探测账本 id）。需要 owner 的操作再查 `role='owner'`，否则 **403 `not_owner`**。

错误响应统一 `{"detail": "...", "code": "snake_case_code"}`（决策 §9）。**下文出现的每一个 `code` 与状态码都取自 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的唯一注册表**（决策 §14.4），本章不自造同义名；注册表里没有专属 code 的校验失败一律是 `validation_error`。

### 3.1 注册并自动建默认账本（决策 §2、§9）

- **触发者**：匿名访客。
- **前置**：`REGISTRATION_OPEN=true`（环境变量，默认 `true`）。
- **步骤**：
  1. `POST /api/v1/auth/register`，体 `{"email", "password", "base_currency", "language"}`。
  2. 服务端在**一个事务**内：建 `users` 行 → 建 `ledgers` 行（`name="我的账本"`（语言为 en 时 `"My Ledger"`）、`base_currency` = 用户提交的默认币种、`created_by` = 新用户）→ 建 `ledger_members` 行（`role='owner'`）。
  3. 返回 JWT。
- **服务端校验**：注册开关关闭 → 403 `registration_closed`；邮箱已存在 → 409 `email_exists`；密码 < 8 位 → 422；`base_currency` 不匹配 `^[A-Z]{3}$` → 422。
- **状态变化**：0 个用户 → 1 个用户 + 1 本账本 + 1 条 owner 成员记录。
- **失败分支**：任一步失败整个事务回滚，不会留下"有用户没账本"的状态。这一点和现状不同：现状注册只建 `users` 行 (backend/app/api/auth.py:42-51)。

### 3.2 创建账本（决策 §2）

- **触发者**：任何已登录用户。
- **前置**：该用户当前拥有（作为成员参与的）账本数 < 10。
- **步骤**：`POST /api/v1/ledgers`，体 `{"name", "base_currency"}`（`base_currency` 缺省取 `users.base_currency`）→ 事务内建 `ledgers` + `ledger_members(role='owner')` → 201 返回账本。
- **服务端校验**：`name` 长度 1–100；`base_currency` 3 位大写字母；账本数已达 10 → 409 `ledger_limit_reached`。
- **状态变化**：新账本进入 `GET /ledgers` 列表；前端把当前账本 id 切到新账本（放在 URL 里，决策 §12）。
- **失败分支**：校验失败无副作用。

### 3.3 生成邀请码（决策 §2、§9）

- **触发者**：账本 owner。
- **前置**：当前成员数 < 10。
- **步骤**：`POST /api/v1/ledgers/{id}/invites`（空体）→ 服务端生成 6 位数字 code（保证同一账本未过期未使用的 code 不重复）→ 写 `ledger_invites`，`expires_at = now + 10 分钟` → 201 返回 `{"id": "...", "code": "418302", "ledger_id": "...", "ledger_name": "我的账本", "expires_at": "...", "created_at": "..."}`（[`./03-backend-api.md`](./03-backend-api.md) §5.21）。
- **服务端校验**：非 owner → 403 `not_owner`；成员数已达 10 → 409 `member_limit_reached`。
- **状态变化**：新增一条 ACTIVE 邀请码。owner 可以反复生成，旧码不会自动作废（各自到点过期）。
- **失败分支**：无副作用。界面上码只显示一次窗口，过期后要重新生成。

### 3.4 加入账本（决策 §2、§9）

- **触发者**：任何已登录用户（被邀请方）。
- **前置**：拿到 6 位码；该用户账本数 < 10。
- **步骤**：
  1. `POST /api/v1/ledgers/join`，体 `{"code": "418302"}`。
  2. 服务端**先查限流**：同一用户 15 分钟内失败尝试次数 ≥ 5 → 429 `invite_rate_limited`（决策 §2、§9）。
  3. 按 code 查 `ledger_invites`：不存在 → 400 `invite_invalid`（计入失败次数）。
  4. `used_by IS NOT NULL` → 400 `invite_used`。
  5. `expires_at < now` → 400 `invite_expired`。
  6. 调用者已是该账本成员 → 409 `already_member`（**不消耗**邀请码）。
  7. 目标账本成员数已达 10 → 409 `member_limit_reached`（不消耗邀请码）。
  8. 调用者账本数已达 10 → 409 `ledger_limit_reached`（不消耗邀请码）。
  9. 事务内：插入 `ledger_members(role='member')` + 更新 `ledger_invites` 的 `used_by` / `used_at` → 200 返回账本。
- **状态变化**：邀请码 ACTIVE → USED；用户成为 member；该账本的全部账户、交易、导入对他立即可见可改。
- **失败分支**：3/4/5 三种错误都计入 15 分钟限流窗口；6/7/8 是"码没问题、条件不满足"，不计入限流也不消耗码。

### 3.5 转让 owner（决策 §2）

- **触发者**：当前 owner。
- **前置**：目标用户已经是该账本 member。
- **步骤**：`POST /api/v1/ledgers/{id}/transfer-ownership`，体 `{"to_user_id": "..."}` → 事务内把目标成员 `role` 改 `owner`、把自己改 `member` → 200。
- **服务端校验**：非 owner → 403 `not_owner`；目标不是成员 → 404 `member_not_found`；目标就是自己 → 400 `validation_error`。
- **状态变化**：owner 身份原子转移，**任何瞬间都只有一个 owner**。
- **失败分支**：事务回滚，角色不变。

### 3.6 退出账本（决策 §2）

- **触发者**：member。
- **前置**：调用者角色是 `member`；不是自己唯一的账本也没关系（允许退到 0 本账，界面引导新建）。
- **步骤**：`POST /api/v1/ledgers/{id}/leave`（空体）→ 删除自己的 `ledger_members` 行 → 200。
- **服务端校验**：调用者是 owner → 409 `owner_must_transfer`（决策 §2："owner 必须先转让再退出"）。
- **状态变化**：该账本从他的 `GET /ledgers` 里消失；他此前创建的账户和交易**留在账本里**（`created_by` 仍指向他，用于显示"谁记的"）。
- **失败分支**：owner 直接退出被拒；界面提示先转让。

### 3.7 移除成员（决策 §2）

- **触发者**：owner。
- **前置**：目标是该账本的 `member`。
- **步骤**：`DELETE /api/v1/ledgers/{id}/members/{user_id}` → 删除对应 `ledger_members` 行 → 204。
- **服务端校验**：非 owner → 403 `not_owner`；目标不存在 → 404 `member_not_found`；目标是自己（即 owner）→ 409 `cannot_remove_owner`。
- **状态变化**：同 §3.6，被移除者的数据留在账本里。
- **失败分支**：无副作用。

### 3.8 删除账本（决策 §2）

- **触发者**：owner。
- **前置**：二次确认（界面显示将删除的交易条数、账户数）。
- **步骤**：`DELETE /api/v1/ledgers/{id}` → 一个事务内级联删除。
- **级联范围**（决策 §2："删除账本（级联删除账户、交易、导入）"）：

| 被删对象 | 说明 |
|---|---|
| `ledger_members` | 该账本所有成员关系 |
| `ledger_invites` | 该账本所有邀请码（含未过期的） |
| `transactions` | 该账本所有交易，含两腿转账两条腿 |
| `finance_sources` | 该账本所有账户，含已归档的 |
| `import_batches` / `import_rows` | 该账本所有导入批次与草稿行 |
| `ledgers` | 账本本身 |
| **不删** `users` / `user_llm_settings` / `exchange_rates` | 它们不属于账本 |

- **服务端校验**：非 owner → 403 `not_owner`。
- **状态变化**：账本及其全部下属数据消失，不可恢复。
- **失败分支**：事务回滚，什么都不删。

### 3.9 账户的创建 / 编辑 / 归档 / 删除（决策 §3）

**创建**

- **触发者**：任何成员。
- **步骤**：`POST /ledgers/{id}/sources`，体 `{"name", "type", "default_currency", "opening_balance"}` → 201。
- **校验**：`type ∈ {checking, savings, credit, cash, other}`，否则 422 `validation_error`；`default_currency` 3 位大写；`opening_balance` ≤ 4 位小数；同账本内 `name` 重复只警告不拦。
- **状态变化**：账户 `archived=false`，`created_by = updated_by =` 调用者。

**编辑**

- **步骤**：`PATCH /ledgers/{id}/sources/{sid}`，体带要改的字段 + **必须带 `updated_at`**（乐观并发，见 §3.15）。
- **可改字段**：`name`、`type`、`default_currency`、`opening_balance`、`archived`。与现状不同——现状只能改 `name` 和 `archived` (backend/app/schemas/finance_source.py:34-49)。
- **注意**：改 `default_currency` **不会**改动已有交易的 `currency`；改 `opening_balance` 会立刻改变余额（§5.4）。
- **状态变化**：`updated_by` / `updated_at` 刷新。

**归档 / 取消归档**

- **步骤**：`PATCH .../sources/{sid}` 带 `{"archived": true|false, "updated_at": "..."}`。
- **归档后的效果**（决策 §3，比现状严格）：
  - 不能再在该账户上创建交易 → `POST /transactions` 返回 409 `source_archived`；
  - 不能作为导入目标账户 → `POST /imports` 返回 409 `source_archived`；
  - 不能作为两腿转账的任一腿 → 409 `source_archived`；
  - 历史交易全部保留，仍参与统计和余额；
  - 账户列表默认不返回，`?include_archived=true` 才返回。
  - 对已有交易的 PATCH 不受影响（可以修改归档账户上的旧账）。
- 现状对比：现状归档只是软隐藏，归档账户仍可通过 API 记账 (backend/app/api/transactions.py:69-88 没有 `archived` 检查)。

**删除**

- **步骤**：`DELETE /ledgers/{id}/sources/{sid}` → 204。
- **校验**：该账户上存在任何交易（含已归档期间的、含导入产生的）→ **409 `source_has_transactions`**，提示"有交易的账户不能删除，只能归档"（决策 §3）；该账户被任何 `import_batches.source_id` 引用 → 同样拒绝（先删导入批次）。
- **状态变化**：空账户被物理删除。
- 现状对比：现状**根本没有** DELETE 接口。

### 3.10 记一笔支出 / 收入（决策 §1、§1.3）

- **触发者**：任何成员。
- **前置**：账本内至少有一个未归档账户。
- **步骤**：
  1. 前端选 kind（expense / income）、账户、金额（**用户输入正数绝对值**）、币种、日期、一级分类（必选）、二级分类（可选）、商户、备注。
  2. `POST /ledgers/{id}/transactions`，请求体示例（支出）：

```json
{
  "kind": "expense",
  "source_id": "3c1b6a4e-2f0d-4a1b-9e77-9c8f0a2d5b31",
  "amount": "-42.5000",
  "currency": "CNY",
  "occurred_at": "2026-06-05",
  "category_l1": "food",
  "category_l2": "dinner",
  "merchant": "海底捞",
  "note": "和同事聚餐"
}
```

  3. 201 响应（字段名与 [`./03-backend-api.md`](./03-backend-api.md) §5.28 的交易对象逐字一致：折算三件套叫 `amount_base` / `rate_used` / `rate_date`，退款统计叫 `refunded_total` / `refundable`）：

```json
{
  "id": "9a2f7d10-55c3-4a9e-8c21-1f2b3c4d5e6f",
  "ledger_id": "1d0e5b2a-77aa-4b6c-9f11-aabbccddeeff",
  "source_id": "3c1b6a4e-2f0d-4a1b-9e77-9c8f0a2d5b31",
  "kind": "expense",
  "amount": "-42.5000",
  "currency": "CNY",
  "occurred_at": "2026-06-05",
  "category_l1": "food",
  "category_l2": "dinner",
  "merchant": "海底捞",
  "note": "和同事聚餐",
  "refund_of": null,
  "transfer_role": null,
  "transfer_subtype": null,
  "transfer_pair_id": null,
  "counterparty": null,
  "import_batch_id": null,
  "created_by": "0f5e...",
  "updated_by": "0f5e...",
  "created_at": "2026-06-05T09:12:44.000000Z",
  "updated_at": "2026-06-05T09:12:44.000000Z",
  "refunded_total": "0.0000",
  "refundable": "42.5000",
  "amount_base": "-42.5000",
  "rate_used": "1.00000000",
  "rate_date": "2026-06-05"
}
```

- **服务端校验顺序**：
  1. `source_id` 存在且属于本账本 → 否则 404 `not_found`；
  2. 账户未归档 → 否则 409 `source_archived`；
  3. `kind` 合法；
  4. 符号与 kind 匹配（expense 必须 < 0，income 必须 > 0；`amount = 0` 一律 400 `validation_error`）；
  5. `category_l1` 非空且在常量表里 → 否则 400 `category_invalid`；
  6. `category_l1` 的收支侧与 kind 匹配（expense 用支出分类，income 用收入分类）→ 否则 422 `category_kind_mismatch`；
  7. `category_l2` 若非空必须属于该一级 → 否则 400 `category_invalid`；
  8. `transfer_role` / `transfer_subtype` / `counterparty` / `refund_of` 必须为空 → 否则 400 `validation_error`；
  9. `currency` 匹配 `^[A-Z]{3}$`；`amount` ≤ 4 位小数。
- **状态变化**：交易入库；该账户余额变化；当月统计变化。
- **失败分支**：任一校验失败返回对应错误，无副作用。金额 0 被明确拒绝——现状是接受的 (backend/app/schemas/transaction.py:19-23 没有 `gt` 约束)。

**编辑**：`PATCH /ledgers/{id}/transactions/{tid}`，请求体是部分更新 + `updated_at`。改 `kind` 按 §2.3 的矩阵重新校验。**改 `source_id` 是允许的**（现状 UI 做不到）。

**删除**：`DELETE /ledgers/{id}/transactions/{tid}` → 204。如果这条被别的 `refund` 行指向，那些行的 `refund_of` 被置空（§1.9）。

### 3.11 记退款并关联原单（决策 §1.1）

- **触发者**：任何成员。
- **前置**：想关联时，账本里存在对应的原支出。
- **步骤**：
  1. 记一笔 kind = `refund`，金额输正数，选账户、日期。
  2. 点"关联原单"→ 打开原单选择器：复用交易列表的搜索筛选，默认 `kind=expense`、同账户预填但可改、时间范围最近 90 天；每条候选显示 `原单金额 / 已退 / 可退`。
  3. 选中后前端把 `refund_of` 填上，并**自动把 `category_l1` / `category_l2` 设为原单的分类**，用户可改。
  4. `POST /ledgers/{id}/transactions`：

```json
{
  "kind": "refund",
  "source_id": "3c1b6a4e-2f0d-4a1b-9e77-9c8f0a2d5b31",
  "amount": "300.0000",
  "currency": "CNY",
  "occurred_at": "2026-04-02",
  "category_l1": "clothing",
  "category_l2": "clothes",
  "merchant": "优衣库",
  "note": "退了一件外套",
  "refund_of": "5b7c9d2e-11aa-4bcd-8e90-abcdef012345"
}
```

- **服务端校验**：
  1. 通用校验同 §3.10（符号必须 > 0；`category_l1` 必须是**支出侧**分类）；
  2. `refund_of` 非空时：目标存在、属于同账本、`kind='expense'` → 否则 400 `refund_target_invalid`；
  3. **不校验**金额是否超过原单剩余可退额。
- **部分退款**：同一原单可以被多条 refund 指向，没有条数上限。原单剩余可退额 = `|原单 amount| − Σ 指向它的 refund.amount`（按发生币种各自计算；跨币种时按 §5.3 折算到账本基准币种后比较，仅用于界面提示）。
- **超额退款**：`Σ refund > |原单|` 时，前端在保存前弹一次警告"退款累计已超过原单金额，仍要保存吗？"，用户确认即保存（决策 §1.1）。服务端不拦、不报错。
- **原单被删除后**：退款行的 `refund_of` 自动置空，界面上原来显示的原单链接变成"原单已删除"，退款行本身、它的分类和统计冲减效果都不变。
- **状态变化**：退款月份该分类的支出减少（§5.2）；账户余额增加。
- **失败分支**：关联失败（原单被别人同时删了）→ 400 `refund_target_invalid`，前端提示重新选择或不关联直接保存。

### 3.12 两腿转账的创建 / 编辑 / 删除（决策 §1.2）

**创建**

- **触发者**：任何成员。
- **前置**：账本内至少两个未归档账户。
- **步骤**：`POST /ledgers/{id}/transactions/transfer`，**一个请求建两行，服务端在一个事务里生成 `transfer_pair_id`**（不再像现状那样由前端 `crypto.randomUUID()` 生成后发两次 POST，frontend/src/screens/TransactionFormScreen.tsx:164,167-201）。请求体是**扁平**的（形状以 [`./03-backend-api.md`](./03-backend-api.md) §5.33 为准；金额传正数、符号由服务端定；子类型字段叫 `subtype`）：

```json
{
  "from_source_id": "aaaa1111-0000-4000-8000-000000000001",
  "to_source_id": "bbbb2222-0000-4000-8000-000000000002",
  "amount_out": "100.0000",
  "currency_out": "USD",
  "amount_in": "715.0000",
  "currency_in": "CNY",
  "occurred_at": "2026-05-08",
  "subtype": "plain",
  "note": "把美元换成人民币"
}
```

  201 响应返回共用的 `pair_id` 和两条完整交易：

```json
{
  "pair_id": "77c1e0a2-9d3b-4f55-8a10-0b1c2d3e4f50",
  "occurred_at": "2026-05-08",
  "subtype": "plain",
  "note": "把美元换成人民币",
  "out": {"id": "…", "kind": "transfer", "transfer_role": "out", "transfer_subtype": "plain",
          "source_id": "aaaa1111-0000-4000-8000-000000000001", "amount": "-100.0000", "currency": "USD",
          "occurred_at": "2026-05-08", "category_l1": null, "category_l2": null, "counterparty": null,
          "transfer_pair_id": "77c1e0a2-9d3b-4f55-8a10-0b1c2d3e4f50"},
  "in":  {"id": "…", "kind": "transfer", "transfer_role": "in", "transfer_subtype": "plain",
          "source_id": "bbbb2222-0000-4000-8000-000000000002", "amount": "715.0000", "currency": "CNY",
          "occurred_at": "2026-05-08", "category_l1": null, "category_l2": null, "counterparty": null,
          "transfer_pair_id": "77c1e0a2-9d3b-4f55-8a10-0b1c2d3e4f50"}
}
```

- **服务端校验**：
  1. `from_source_id` / `to_source_id` 都存在、属于本账本、都未归档 → 否则 404 `not_found` / 409 `source_archived`；
  2. 两个账户**必须不同** → 否则 400 `same_source`；
  3. `amount_out` / `amount_in` 都 > 0（服务端把转出腿存成负数）→ 否则 400 `validation_error`；
  4. `subtype ∈ {plain, repayment}`；
  5. 请求体里不允许出现 `category_l1` / `category_l2` / `counterparty` → 400 `validation_error`；
  6. **不要求**两腿金额相等，也**不要求**币种相同（跨币种转账，决策 §1.2）。
- **状态变化**：两行同时入库、共享 pair id；两个账户余额同时变化；统计不变（转账不计入）。
- **失败分支**：整个事务回滚，绝不会留下"半条转账"。这正是现状的 HALF-CREATED / ORPHAN LEG 状态在 v3.0 被消灭的地方。
- **手续费**：不塞进转账，另记一笔 `expense`，分类 `other` / `fees`（决策 §1.2）。

**编辑**

- `PATCH /ledgers/{id}/transactions/transfer/{pair_id}`，体是创建体的部分更新（同样扁平）：`from_source_id`、`to_source_id`、`amount_out`、`currency_out`、`amount_in`、`currency_in`、`occurred_at`、`subtype`、`note` 都可选，外加必填的 `updated_at`（取两腿中较新的那个）。`pair_id` 本身、`kind`、`transfer_role` 都不可改（[`./03-backend-api.md`](./03-backend-api.md) §5.34）。
- 校验同创建；两腿在一个事务里一起改，两腿的 `updated_at` 一起刷新。
- 对单条腿调 `PATCH /transactions/{tid}` → 409 `use_transfer_endpoint`。

**删除**

- `DELETE /ledgers/{id}/transactions/transfer/{pair_id}` → 204，一条语句删掉该 pair 的**全部**行。
- 对单条腿调 `DELETE /transactions/{tid}` → 409 `use_transfer_endpoint`。

### 3.13 单腿转账（决策 §1.2）

- **触发者**：任何成员。
- **场景**：对手账户不在应用里——老婆给我转账、我给别人转账、用没录入的工资卡还信用卡。
- **前置**：目标账户未归档。
- **步骤**：走**普通交易接口** `POST /ledgers/{id}/transactions`：

```json
{
  "kind": "transfer",
  "source_id": "cccc3333-0000-4000-8000-000000000003",
  "amount": "1500.0000",
  "currency": "CNY",
  "occurred_at": "2026-06-20",
  "transfer_role": "in",
  "transfer_subtype": "repayment",
  "counterparty": "工资卡",
  "note": "工资卡还信用卡"
}
```

- **服务端校验**：
  1. `transfer_role` 与符号一致（`in` → `amount > 0`，`out` → `amount < 0`）→ 否则 400 `validation_error`；
  2. `transfer_subtype` 必填；
  3. `category_l1` / `category_l2` 必须为空 → 否则 400 `validation_error`；
  4. `transfer_pair_id` 不接受客户端传入（服务端只在两腿接口里生成）→ 传了就 400 `validation_error`；
  5. `counterparty` 可空、≤100 字。
- **状态变化**：账户余额变化；**收支统计不变**（决策 §1.2："单腿转账计入账户余额，不计入收入/支出统计"）。
- **失败分支**：无副作用。
- **重要的默认逻辑**：别人转钱进来时，表单和导入都**默认建议 `income`**（`social_income` / `transfer_in`），只有用户主动切到"转账"才记单腿 transfer——否则真正的收入会悄悄从统计里消失（决策 §1.2）。界面要在切换时明确提示这一点。

### 3.14 信用卡还款（决策 §1.2、§5）

信用卡还款是 `kind='transfer'` + `transfer_subtype='repayment'`，分两种形态：

| 情形 | 记法 | 例子 |
|---|---|---|
| 还款来源账户**在**应用里 | **两腿**，`POST .../transactions/transfer`，`subtype='repayment'`，out = 储蓄卡（负）、in = 信用卡（正） | 招行储蓄卡 → 招行信用卡 3,000 CNY |
| 还款来源账户**不在**应用里 | **单腿**，`POST .../transactions`，`kind='transfer'`、`transfer_role='in'`、`transfer_subtype='repayment'`、`counterparty='工资卡'` | 用未录入的工资卡还招行信用卡 1,500 CNY |

- **状态变化**：信用卡账户余额向 0 靠拢（负债减少）；储蓄卡余额减少；**收支统计完全不动**——还款不是支出。
- **导入时的去重**（决策 §1.2）：从信用卡账单导入时，如果某行被识别为还款（`flags` 含 `repayment`），服务端去对手账户找 **±3 天内、同金额、`transfer_subtype='repayment'` 的反向腿**；找到就把这行标 `duplicate`，review 表提示"这笔可能已经从储蓄卡那边记过了"，默认建议跳过。
- **失败分支**：找不到对手账户就不预填 `counterpart_source_id`，用户在 review 里手选，或者留成单腿。

### 3.15 乐观并发冲突（409 `stale_update`）（决策 §2）

- **触发者**：任意成员，多人同时改同一条记录时发生。
- **适用对象**：`transactions`、`finance_sources`、`ledgers` 的 PATCH（三张表都带 `updated_at`）。
- **步骤**：
  1. 客户端 GET 到对象，记住响应里的 `updated_at`。
  2. PATCH 时请求体里**必须**带这个 `updated_at`：

```json
{"amount": "-52.0000", "updated_at": "2026-06-05T09:12:44.512Z"}
```

  3. 服务端 `SELECT ... FOR UPDATE` 取当前行，比较 `updated_at`：
     - 相等 → 应用改动，把 `updated_at` 刷成 `now()`、`updated_by` 刷成调用者，返回 200 + 新对象；
     - 不相等 → **409**：

```json
{"detail": "这条记录已被他人修改，请重新加载后再试", "code": "stale_update"}
```

  4. 请求体缺 `updated_at` → 422 `validation_error`。
- **状态变化**：冲突时数据库完全不动。
- **失败分支 / 前端处理**：收到 409 就 invalidate 该资源的查询缓存、重新拉取、提示用户"这条已被 XX 改过，已刷新为最新版本，请确认后重试"。列表在窗口重新聚焦时也会自动刷新（决策 §2）。
- **不做**：实时同步、WebSocket、操作合并。两腿转账的 PATCH 用两腿中较新的 `updated_at` 做比较。

### 3.16 账单导入全流程（决策 §5）

本节只写**状态与业务规则**；文件解析、分块、提示词、LLM schema、标记算法的实现细节见 [`./05-import-and-llm.md`](./05-import-and-llm.md)。

**前置**：调用者已配好 `user_llm_settings`（否则前端直接引导去设置页，决策 §6）；目标账户未归档；该用户本小时导入次数 < 10（决策 §9）；该账本当前没有别的批次处于 `parsing`（决策 §5）。

**步骤**

1. **上传**：`POST /ledgers/{id}/imports`（multipart：`file` + `source_id`）。
   - 校验：文件 ≤ 10 MB → 否则 413 `file_too_large`；MIME 在白名单（PDF / CSV / XLSX / JPG / PNG）→ 否则 415 `unsupported_file`；`source_id` 存在且未归档；本账本已有 `parsing` 批次 → 409 `import_in_progress`；超过每小时 10 批 → 429 `import_rate_limited`。
   - 建 `import_batches` 行，`status='uploaded'`，返回 202 + `batch_id`。
2. **解析**：FastAPI 后台任务立即把 `status` 改成 `parsing`，抽文本或渲染图片、分块调 LLM（约 150 行一块）、写 `import_rows`。
   - 解析成功 → `status='ready'`，`row_count` 写入，服务端在这一步自动打三种标记（`duplicate` / `refund_candidate` / `repayment`，决策 §5）以及 `needs_review`（视觉路径的行、日期或金额解析失败的行）。
   - 解析失败（LLM 401 / 超时 / 文件损坏 / 行数 > 2000）→ `status='failed'`，`error` 写原因。
   - 行数 0 也算成功，进 `ready`，review 表显示"没解析出任何行"。
3. **轮询**：前端 `GET /ledgers/{id}/imports/{bid}` 轮询状态（不引入队列，决策 §5）。
4. **重试**：`failed` 状态下 `POST /ledgers/{id}/imports/{bid}/retry` → 清空该批已有 `import_rows`、`error` 置空、`status` 回到 `parsing` 重新解析。只有 `failed` 能重试，其他状态 → 409 `batch_not_failed`。
5. **Review**：只有 `ready` 才能读写草稿行（决策 §5）。
   - `GET .../rows` 列出草稿行；`PATCH .../rows/{rid}` 改单行，任何字段可改：`date`、`amount`、`currency`、`kind`、`merchant`、`note`、`category_l1`、`category_l2`、`matched_transaction_id`（关联退款原单）、`counterpart_source_id`（选还款对手账户）、`transfer_subtype`，以及把 `status` 改成 `skipped`（跳过这行）。
   - 任何一次 PATCH 把该行 `status` 从 `pending` 变成 `edited`（除非用户显式设成 `skipped`）。
   - 非 `ready` 状态下 PATCH → 409 `batch_not_ready`。
6. **提交**：`POST .../imports/{bid}/commit`。
   - **提交前置校验**：所有 `status != 'skipped'` 的行都必须有合法的 `date`、`amount`、`kind`，并且非 transfer 行必须有 `category_l1` → 缺 `date` / `amount` / `kind` 的返回 409 `batch_not_ready`，缺一级分类的返回 **409 `rows_uncategorized`**，`detail` 里带出问题的 `row_no` 列表（决策 §5："没一级分类的行显示'待归类'，提交前必须补齐"）。
   - **一个数据库事务内**建所有交易：每条交易 `import_batch_id = batch_id`、`created_by = updated_by =` 提交人、`source_id` = 批次的目标账户（还款行的两腿一起建，out 腿落在 `counterpart_source_id` 上）。每条 `import_rows.transaction_id` 回填。
   - 成功 → 批次 `status='committed'`，返回建了多少条。
   - 任一行建失败 → 整批回滚，批次留在 `ready`，返回 400 + 出错行号。
   - 非 `ready` 状态提交 → 409 `batch_not_ready`（已经是 `committed` 的批次重复提交 → 409 `batch_already_committed`，幂等保护）。
7. **撤销**：`DELETE /ledgers/{id}/imports/{bid}`，行为取决于状态（决策 §11）：
   - `ready` / `failed` / `uploaded` → **丢弃**：删批次和草稿行，不影响任何交易。
   - `committed` → **撤销**：删除 `transactions` 里所有 `import_batch_id = bid` 的行（含两腿还款的两条腿），再删批次和草稿行。**不限时限**；界面撤销前确认并显示将删除多少条（决策 §5）。
   - `parsing` → 409 `import_in_progress`（等它结束或失败）。
   - 撤销时如果某条被导入的交易已被别的 `refund` 行指向，那些 refund 行的 `refund_of` 按 §1.9 置空。

**服务重启**：启动时把所有仍为 `parsing` 的批次标 `failed`、`error='服务重启导致解析中断'`，用户可以重试（决策 §5）。

---

## 4. ASCII 状态图

### 4.1 交易（按 kind 的允许迁移）

```
                       POST /ledgers/{id}/transactions
                                    |
        +---------------------------+---------------------------+
        |                                                       |
        v                                                       v
   非 transfer 三种（可互相 PATCH 改 kind）             kind='transfer'
                                                                |
  +-----------+  PATCH kind=income   +----------+     +---------+---------+
  |  EXPENSE  |--------------------->|  INCOME  |     |                   |
  | amount<0  |<---------------------| amount>0 |     v                   v
  | 支出分类  |  PATCH kind=expense  | 收入分类 |  单腿 transfer      两腿 transfer
  +-----------+                      +----------+  pair_id=NULL      pair_id 非空
      ^     |                          ^     |     counterparty?     两行成对
      |     | PATCH kind=refund        |     |          |                 |
      |     |                          |     |          |                 |
      |     v                          |     v          |                 |
      |  +----------------------------------+           |                 |
      +--|            REFUND                |           |                 |
         |          amount>0                |           |                 |
         |          支出分类                |           |                 |
         |   refund_of -> 某条 EXPENSE(可空) |          |                 |
         +----------------------------------+           |                 |
                                                        |                 |
   PATCH /transactions/{tid}                            |    PATCH/DELETE /transactions/{tid}
   （改金额/日期/账户/分类/备注/kind）                   |    -> 409 use_transfer_endpoint
                                                        |                 |
   ==========  非 transfer <-/-> transfer  ==========    |    只能走
   任何方向都 400 kind_change_not_allowed                |    PATCH/DELETE .../transfer/{pair_id}
   （要改只能删了重记）                                   |    （两腿一起，事务内）
                                                        |                 |
        |                                               |                 |
        | DELETE /transactions/{tid}                    | DELETE          | DELETE .../transfer/{pair_id}
        v                                               v /transactions/  v
   +---------------------------------------------------------------------------+
   |                                 DELETED                                    |
   |  指向它的 refund 行 refund_of -> NULL（ON DELETE SET NULL）                |
   |  之后 GET / PATCH / DELETE 一律 404 not_found                  |
   +---------------------------------------------------------------------------+
```

### 4.2 导入批次（决策 §5）

```
   POST /ledgers/{id}/imports  (202)
              |
              v
      +--------------+
      |   uploaded   |  行已建，后台任务尚未开跑
      +--------------+
              | 后台任务启动
              v
      +--------------+  解析成功（含 0 行）   +-----------+
      |   parsing    |----------------------->|   ready   |
      | 同账本同时   |                        | 可读写草稿 |
      | 只允许 1 个  |                        | 可提交     |
      +--------------+                        +-----------+
         |       ^                              |   ^  |
         |       |                              |   |  | PATCH .../rows/{rid}
  解析失败/      | POST .../retry               |   +--+ （自环：pending -> edited/skipped）
  行数>2000/     | （仅 failed 可重试）          |
  服务重启       |                              | POST .../commit
         |       |                              | （所有未跳过行必须有 date/amount/kind
         v       |                              |   且非 transfer 行必须有 category_l1，
      +--------------+                          |   否则 409 rows_uncategorized，留在 ready）
      |    failed    |                          v
      | error 非空   |                    +-------------+
      +--------------+                    |  committed  |  交易已建，带 import_batch_id
              |                           +-------------+
              |                                  |
              | DELETE（丢弃）                    | DELETE（撤销：删掉这批建的所有交易，
              |                                  |         不限时限，确认后执行）
              v                                  v
      +-----------------------------------------------------+
      |                       GONE                          |
      |  import_rows 随 batch 级联删除                       |
      +-----------------------------------------------------+
              ^
              | DELETE（丢弃）来自 uploaded / ready
              |
   parsing 状态下 DELETE -> 409 import_in_progress；commit / PATCH rows -> 409 batch_not_ready；retry -> 409 batch_not_failed
```

### 4.3 账本成员关系（决策 §2）

```
                          +------------------+
                          |   非成员          |
                          | （看不到该账本）  |
                          +------------------+
                            |            ^
        POST /ledgers       |            | POST /ledgers/{id}/leave（member 自行退出）
        （创建者）           |            | DELETE /ledgers/{id}/members/{uid}（owner 移除）
                            |            |
                            |     POST /ledgers/join（邀请码有效）
                            |            |
              +-------------+------------+-------------+
              |                                        |
              v                                        v
      +----------------+   POST .../transfer-ownership  +----------------+
      |     OWNER      |------------------------------->|     MEMBER     |
      | 唯一，1 本 1 个 |<-------------------------------| 记账/改账/导入 |
      | 全部权限       |   （原 owner 降为 member，       | 可自行退出     |
      +----------------+     同一事务内原子完成）        +----------------+
              |                                                |
              | POST .../leave -> 409 owner_must_transfer|
              |                                                |
              | DELETE /ledgers/{id}（owner 删账本）            |
              v                                                v
      +-----------------------------------------------------------------+
      |  账本 GONE：成员关系、邀请码、账户、交易、导入批次全部级联删除    |
      +-----------------------------------------------------------------+
```

### 4.4 邀请码生命周期（决策 §2）

```
   POST /ledgers/{id}/invites   （owner；成员数 < 10）
              |
              v
      +------------------------+
      |        ACTIVE          |  used_by = NULL 且 now < expires_at
      |  code = 6 位数字        |  同一账本可以同时有多个 ACTIVE
      |  expires_at = now+10min |
      +------------------------+
         |                  |
         | POST /ledgers/join  正确 & 未过期 & 调用者非成员
         |                  |
         |                  | 时间到（now >= expires_at）
         v                  v
   +------------+     +------------+
   |   USED     |     |  EXPIRED   |
   | used_by /  |     | 仍留在表里 |
   | used_at    |     | 不可用     |
   | 已写入     |     |            |
   +------------+     +------------+
         |                  |
         | 再次提交         | 提交
         v                  v
   400 invite_used         400 invite_expired
        （计入 15 分钟 5 次限流窗口）

   不存在的 code           -> 400 invite_invalid（计入限流）
   已是该账本成员           -> 409 already_member（不计限流、不消耗码）
   成员数已满 / 账本数已满  -> 409 member_limit_reached / ledger_limit_reached（不消耗码）
   15 分钟内失败 >= 5 次    -> 429 invite_rate_limited
   账本被删除               -> 邀请码随账本级联删除（GONE）
```

---

## 5. 统计口径的精确定义

全部按**账本基准币种** `ledgers.base_currency` 折算（决策 §7）。折算规则见 §5.3（决策 §8）。

记号：设账本 L，基准币种 `B = L.base_currency`，月份 `M`（`YYYY-MM`）。对任意交易 `t`，记 `conv(t) = convert(t.amount, t.currency, B, t.occurred_at)`，即**按发生日汇率**折算后的带符号金额；`convB(x, ccy) = convert(x, ccy, B, today)`，即按**最新**汇率折算。

`T(L)` = 账本 L 的全部交易。

### 5.1 月度分类收支

```
月度分类支出(c, M) = Σ |conv(t)|                      ← t.kind='expense'
                        t ∈ T(L)
                        t.category_l1 = c
                        month(t.occurred_at) = M

                   − Σ conv(r)                        ← r.kind='refund'
                        r ∈ T(L)
                        r.category_l1 = c             ← 按退款行自己的分类
                        month(r.occurred_at) = M      ← 按退款行自己的日期

月度分类收入(c, M) = Σ conv(t)                        ← t.kind='income'
                        t.category_l1 = c
                        month(t.occurred_at) = M
```

要点：

- **退款按退款日期冲减**，不回溯到原支出所在的月份（决策 §1、§1.1）。
- **退款按退款行自己的 `category_l1` 归类**。关联原单时它默认就等于原单分类，但用户改过之后以退款行为准。
- **`kind='transfer'` 的行完全不参与**——两腿、单腿一律不计入（决策 §1.2、§7）。
- 二级分类下钻用同样的公式，把 `category_l1 = c` 换成 `category_l2 = c2`；`category_l2` 为空的行归到该一级下的"未细分"桶。
- **月度分类支出可以是负数**（某月只有退款没有支出），界面照实显示负值，不要截断到 0。

### 5.2 月度合计与净值

```
月度总支出(M) = Σ 月度分类支出(c, M)   对所有支出一级分类 c
月度总收入(M) = Σ 月度分类收入(c, M)   对所有收入一级分类 c
月度净值(M)   = 月度总收入(M) − 月度总支出(M)
```

最近 12 个月趋势（决策 §7）= 对 `M ∈ {当月, 当月-1, …, 当月-11}` 各算一遍 `月度总支出` / `月度总收入`。

### 5.3 折算规则（决策 §8）

统一为**一个**函数（现状两套公式不一致的问题就此消除：单行路径 `amount × rate` (backend/app/api/transactions.py:20-46)，列表路径 `amount / rate` (backend/app/api/transactions.py:244-255)）：

```
convert(amount, from_ccy, to_ccy, on_date):
    if from_ccy == to_ccy:        return amount
    d = 最近一个 <= on_date 且已公布行情的交易日   # 周末/节假日/当天未公布 -> 向前回退
    r = rate(d, from_ccy, to_ccy)                # 1 from_ccy = r to_ccy
    return round(amount * r, 4)                  # 四舍五入到 4 位小数
```

- **交易与统计**用 `on_date = t.occurred_at`（发生日汇率，一经公布不再变，所以历史统计稳定）。
- **账户余额**用 `on_date = today`（最新汇率），因为余额是"现在值多少钱"。
- 行情从 `exchange_rates` 缓存表读，缺就去 Frankfurter 拉一次再写缓存。
- 拉不到行情时，该项折算返回 `null`，界面显示原币种金额并标注"暂无汇率"——**统计接口不因汇率源故障而 5xx**（沿用现状 backend/app/api/transactions.py:44-46 的容错策略）。

### 5.4 账户余额（决策 §3、§14.2）

**余额以账户自己的 `default_currency` 计价**，不分币种桶、不返回按币种拆开的明细（决策 §14.2）。`opening_balance` 本来就是账户币种；每条交易按**它自己的发生日汇率**折算到账户币种后累加（同币种不换算，这是绝大多数情况）：

```
账户余额(a) = a.opening_balance
            + Σ convert(t.amount, t.currency, a.default_currency, t.occurred_at)
                t ∈ T(L)
                t.source_id = a.id
                （所有 kind：expense / income / refund / transfer，
                  含单腿转账、含两腿转账的每一条腿）

账户余额(a) 的计价币种 = a.default_currency

账户余额折算(a) = convB(账户余额(a), a.default_currency)    ← 用最新汇率折到账本基准币种 B
                  （接口字段 balance_base，配套回 balance_rate / balance_rate_date）

账本总余额(L) = Σ 账户余额折算(a)                            ← 含已归档账户
                 a ∈ 账本 L 的全部账户
```

两条日期规则要分清（决策 §8）：**账户内部把交易归到账户币种，用的是交易发生日的汇率**（一笔账发生时值多少就是多少，历史不再变）；**把账户余额折到账本基准币种，用的是最新汇率**（余额回答的是"现在值多少钱"）。

微算例：账户 `招行储蓄卡`（`default_currency=CNY`，`opening_balance=0`），账本基准币种 CNY。上面记了两笔——2026-05-08 一笔 `−200.0000 CNY` 的支出，和同一天一笔用这张卡付的 `−10.0000 USD` 的支出（发生日汇率 1 USD = 7.2000 CNY）：

```
账户余额 = 0 + (−200.0000) + convert(−10.0000, USD, CNY, 2026-05-08)
         = 0 + (−200.0000) + (−72.0000)
         = −272.0000 CNY                    ← balance，账户币种
balance_base = convert(−272.0000, CNY, CNY, 最新) = −272.0000 CNY，balance_rate = 1.00000000
```

注意那笔外币支出即使明天汇率变到 7.1000，`balance` 仍然是 −272.0000 CNY——它在发生那天就已经折定了。

接口形态见 [`./03-backend-api.md`](./03-backend-api.md) §5.23：`GET /ledgers/{id}/sources` 每行回 `balance`、`balance_base`、`balance_rate`、`balance_rate_date` 四个标量，没有 `balance_by_currency`。

### 5.5 算例

以下三个算例的账本 L 基准币种都是 **CNY**。汇率用到两个值：

| 行情日 | 汇率 |
|---|---|
| 2026-05-08 | 1 USD = 7.2000 CNY |
| 最新（2026-09-08） | 1 USD = 7.1000 CNY |

#### 5.5.1 部分退款跨月

数据：

| # | kind | occurred_at | source | amount | currency | category_l1 / l2 | refund_of |
|---|---|---|---|---|---|---|---|
| T1 | expense | 2026-03-14 | 招行储蓄卡 | −899.0000 | CNY | `clothing` / `clothes` | — |
| T2 | refund | 2026-04-02 | 招行储蓄卡 | +300.0000 | CNY | `clothing` / `clothes` | T1 |

计算：

```
月度分类支出(clothing, 2026-03) = |−899.00| − 0        = 899.00 CNY
月度分类支出(clothing, 2026-04) = 0        − 300.00     = −300.00 CNY
两月合计                        = 899.00 + (−300.00)   = 599.00 CNY   ← 等于净支出
```

注意 3 月的数字**不因为 4 月退款而改变**——历史月份的统计一旦出账就不再变（决策 §1"退款按退款日期冲减该分类的支出"）。4 月的服饰支出是负数，如实显示。

原单剩余可退额 = `|−899.00| − 300.00 = 599.00 CNY`；再退一笔 700.00 就是超额退款，前端警告但允许保存（§3.11），保存后 4 月服饰 = `−1000.00 CNY`。

#### 5.5.2 跨币种两腿转账 + 手续费

账户：`美元支票`（type=`checking`，`default_currency=USD`，`opening_balance=0`）、`招行储蓄卡`（`CNY`，`opening_balance=0`）。

数据：

| # | kind | occurred_at | source | amount | currency | 说明 |
|---|---|---|---|---|---|---|
| T3 | transfer(out, plain) | 2026-05-08 | 美元支票 | −100.0000 | USD | pair `77c1…f50` |
| T4 | transfer(in, plain) | 2026-05-08 | 招行储蓄卡 | +715.0000 | CNY | 同 pair，**金额与 T3 不等，币种也不同** |
| T5 | expense | 2026-05-08 | 美元支票 | −5.0000 | USD | `other` / `fees` 电汇手续费 |

**5 月统计**（转账不计入）：

```
月度分类支出(other, 2026-05) = |conv(T5)| = |−5.0000 × 7.2000| = 36.00 CNY   ← 发生日汇率
月度总支出(2026-05)          = 36.00 CNY
月度总收入(2026-05)          = 0.00 CNY
月度净值(2026-05)            = 0 − 36.00 = −36.00 CNY
```

T3 和 T4 一分钱都没进统计——这就是"转账不计入"。

**余额**（§5.4 的口径；两个账户上的交易币种都等于各自的 `default_currency`，所以第一步一次换算都不发生；第二步折到账本基准币种 CNY 用最新汇率 7.1000）：

```
美元支票   balance      = 0 + (−100.0000) + (−5.0000) = −105.0000 USD   ← 账户币种 USD
           balance_base = −105.0000 × 7.1000          = −745.5000 CNY
招行储蓄卡 balance      = 0 + 715.0000                =  715.0000 CNY   ← 账户币种 CNY
           balance_base = 715.0000 × 1                =  715.0000 CNY
账本总余额              = 715.00 + (−745.50)          =  −30.50 CNY
```

这 −30.50 CNY 的来源可以对上账：手续费 `−5 USD × 7.1 = −35.50 CNY`，加上换汇时 100 USD 换到 715 CNY 而按最新汇率只值 710 CNY 的 `+5.00 CNY` 差价，合计 `−30.50 CNY`。汇兑差价不单独记账，它自然体现在余额里（决策 §1.2）。

#### 5.5.3 用从未录入应用的银行卡还信用卡（单腿）

账户：`招行信用卡`（type=`credit`，`default_currency=CNY`，`opening_balance=−2000.0000` —— 期初已欠 2,000 元）。

数据：

| # | kind | occurred_at | source | amount | currency | 说明 |
|---|---|---|---|---|---|---|
| T6 | expense | 2026-06-05 | 招行信用卡 | −188.0000 | CNY | `food` / `dinner` |
| T7 | transfer(in, repayment) | 2026-06-20 | 招行信用卡 | +1500.0000 | CNY | `transfer_pair_id = NULL`，`counterparty = "工资卡"` |

**6 月统计**：

```
月度分类支出(food, 2026-06) = |−188.00| − 0 = 188.00 CNY
月度总支出(2026-06)          = 188.00 CNY
月度总收入(2026-06)          = 0.00 CNY      ← T7 是单腿转账，不算收入
月度净值(2026-06)            = −188.00 CNY
```

如果这笔 1,500 被误记成 `income`，6 月净值会变成 `+1312.00 CNY`，凭空多出一笔收入——这正是"信用卡还款必须是 transfer"的原因。反过来，如果一笔**真的**是别人给我的钱被误记成单腿 transfer，收入就凭空消失了——所以外部转入的**默认建议是 `income`**（决策 §1.2、§3.13）。

**余额**（账户币种 CNY，两笔交易也都是 CNY，无换算；账本基准币种也是 CNY，`balance_rate = 1.00000000`）：

```
招行信用卡 balance      = −2000.0000 + (−188.0000) + 1500.0000 = −688.0000 CNY
           balance_base = −688.0000 × 1                        = −688.0000 CNY
账本总余额              = −688.00 CNY   （仍欠 688 元）
```

期初余额必须计入，否则余额会算成 `+1312.00`，方向都反了（决策 §3）。

---

## 6. 不变量清单

### 6.1 数据库保证（CHECK / UNIQUE / 外键，决策 §10）

| # | 不变量 | 手段 |
|---|---|---|
| 1 | `kind IN ('expense','income','refund','transfer')` | CHECK |
| 2 | `kind='expense'` → `amount < 0` | CHECK |
| 3 | `kind IN ('income','refund')` → `amount > 0` | CHECK |
| 4 | `kind='transfer' AND transfer_role='out'` → `amount < 0`；`transfer_role='in'` → `amount > 0` | CHECK |
| 5 | `(kind='transfer') = (transfer_role IS NOT NULL)` | CHECK |
| 6 | `(kind='transfer') = (transfer_subtype IS NOT NULL)` | CHECK |
| 7 | `kind='transfer'` → `category_l1 IS NULL AND category_l2 IS NULL` | CHECK |
| 8 | `kind <> 'transfer'` → `category_l1 IS NOT NULL` | CHECK |
| 9 | `category_l2 IS NULL OR category_l1 IS NOT NULL` | CHECK |
| 10 | `refund_of IS NULL OR kind='refund'` | CHECK |
| 11 | 同一个 pair 最多一条 out、一条 in | `UNIQUE (transfer_pair_id, transfer_role)`（NULL 不参与） |
| 12 | 有对腿就不填对方文本：`transfer_pair_id IS NULL OR counterparty IS NULL` | CHECK |
| 13 | `transfer_role IN ('out','in')`、`transfer_subtype IN ('plain','repayment')` | CHECK |
| 14 | `finance_sources.type IN ('checking','savings','credit','cash','other')` | CHECK |
| 15 | `ledger_members.role IN ('owner','member')` | CHECK |
| 16 | `import_batches.status IN ('uploaded','parsing','ready','committed','failed')` | CHECK |
| 17 | `import_rows.status IN ('pending','edited','skipped')` | CHECK |
| 18 | 一个用户在一本账里最多一条成员记录 | `PRIMARY KEY (ledger_id, user_id)` |
| 19 | 原支出被删除时退款行保留、`refund_of` 置空 | 外键 `ON DELETE SET NULL` |
| 20 | 批次删除时草稿行随之删除 | 外键 `ON DELETE CASCADE` |
| 21 | 交易必须引用存在的账户和账本 | 外键 `source_id` / `ledger_id` |
| 22 | 邮箱唯一 | `UNIQUE (email)` |
| 23 | 每用户最多一份 LLM 设置 | `user_llm_settings.user_id` 为主键 |
| 24 | 同一天同一对币种只缓存一条行情 | `PRIMARY KEY (date, base, symbol)`（决策 §14.1） |

注意 CHECK 里**不含** `amount <> 0`——它被 #2/#3/#4 隐含覆盖（`< 0` 和 `> 0` 都排除了 0）。

### 6.2 应用层保证（决策 §1–§9）

| # | 不变量 | 落点 |
|---|---|---|
| 1 | 每本账**恰有一个** owner | 建账本时写入；转让 owner 在一个事务内同时降级原 owner；owner 不能退出、不能被移除 |
| 2 | 每次读写都限定在"调用者是成员的账本"内 | 每个业务路由的成员依赖；越权一律 404 `not_found` |
| 3 | 注册必定同时产出一本默认账本和一条 owner 记录 | 注册在一个事务里完成（§3.1） |
| 4 | `category_l1` 在常量表里，且收支侧与 kind 匹配 | 创建/更新/导入提交时校验（决策 §1.3） |
| 5 | `category_l2` 属于 `category_l1` | 同上 |
| 6 | `refund_of` 指向同账本的 `kind='expense'` | 创建/更新时校验（决策 §1.1） |
| 7 | 两腿转账原子创建、原子修改、原子删除；两腿 `transfer_subtype` 与 `occurred_at` 一致 | 专用 transfer 接口，单请求单事务（决策 §1.2） |
| 8 | 两腿转账的两个账户不同 | `POST .../transfer` 校验 `same_source` |
| 9 | 两腿转账的任一腿不能被单独 PATCH / DELETE | 普通交易接口检测 `transfer_pair_id` 非空 → 409 `use_transfer_endpoint` |
| 10 | 单腿转账的 `transfer_pair_id` 永远由服务端置 NULL，客户端不能自带 | `POST /transactions` 拒绝 `transfer_pair_id` 字段 |
| 11 | 归档账户不能新建交易、不能作为导入目标、不能作为转账腿 | 三处入口各自校验（决策 §3） |
| 12 | 有交易的账户不能删除 | `DELETE .../sources/{sid}` 校验（决策 §3） |
| 13 | `transactions` / `finance_sources` / `ledgers` 的 PATCH 必须带匹配的 `updated_at`，否则 409 `stale_update` | 决策 §2 |
| 14 | 邀请码一次性、10 分钟过期、错码 15 分钟 5 次限流 | 加入流程（决策 §2、§9） |
| 15 | 每人 ≤ 10 本账、每本 ≤ 10 人 | 建账本 / 生成邀请码 / 加入时校验（决策 §2） |
| 16 | 同一账本同时只有一个批次处于 `parsing` | 上传时校验 → 409 `import_in_progress`（决策 §5） |
| 17 | 服务重启后不会有批次卡在 `parsing` | 启动钩子把它们标 `failed`（决策 §5） |
| 18 | 提交导入时所有未跳过的行都有 `date` / `amount` / `kind`，非 transfer 行有 `category_l1` | commit 前置校验 → 409 `batch_not_ready` / 409 `rows_uncategorized`（决策 §5） |
| 19 | 导入提交是一个事务：要么整批建成，要么一条都不建 | commit 实现（决策 §5） |
| 20 | 撤销一批导入 = 删掉且仅删掉 `import_batch_id = bid` 的交易 | `DELETE .../imports/{bid}`（决策 §5） |
| 21 | 折算只有一个函数、一个方向：交易/统计用发生日汇率，余额用最新汇率，无行情日向前回退 | 决策 §8 |
| 22 | 汇率源故障不会让任何业务接口 5xx，只让折算字段变 `null` | 决策 §8；沿用现状容错 (backend/app/api/transactions.py:44-46) |
| 23 | LLM api_key 只以 Fernet 密文存储，接口只回显尾 4 位 | 决策 §6 |
| 24 | 上传 ≤ 10 MB、单批 ≤ 2000 行、每用户每小时 ≤ 10 批、登录同 IP 每分钟 ≤ 10 次 | 决策 §5、§9 |
| 25 | 所有错误响应形如 `{"detail", "code"}`，`code` 是 snake_case | 决策 §9 |
| 26 | `currency` / `base_currency` / `default_currency` 一律存大写 3 位 | 沿用现状的 `CurrencyCode` 正则 (backend/app/schemas/currency.py:9) |

### 6.3 明确**不**保证的

| 不保证 | 原因 |
|---|---|
| 两腿转账两条腿的金额相等或币种相同 | 跨币种转账是设计特性（决策 §1.2） |
| 累计退款不超过原单金额 | 前端警告、允许保存（决策 §1.1） |
| 退款行一定有 `refund_of` | 可以不关联；原单删除后也会置空（决策 §1.1） |
| 单腿转账的对手账户存在于应用中 | 单腿的定义就是对手不在应用里（决策 §1.2） |
| 多人同时编辑时的自动合并 | 只做乐观并发检测，冲突让用户重来（决策 §2） |
| 实时协同 / 推送 | 明确不做（决策 §0.7、§2） |
| 分类表可由用户扩展 | 分类是后端常量，改要发版（决策 §1.3） |
| 导入解析结果的准确率 | LLM 尽力而为，`needs_review` + review 表格兜底（决策 §5） |
| 账本删除可恢复 | 硬删除，无回收站 |

---

## 待决

以下问题 [`./00-decisions.md`](./00-decisions.md) 没有覆盖，本章按"给建议默认值、不擅自定稿"处理。第一轮评审后，其中 6 条已由决策 §14 正式裁定（下表标注"**已由决策 §14.x 裁定**"），正文已按裁定改写，保留在表里只是为了让读者能追溯来龙去脉。

| # | 问题 | 本章的建议默认值 |
|---|---|---|
| 1 | `users.default_source_id`（现状字段，backend/app/models/user.py:20）在多账本模型下如何处置 | **已由决策 §14.6 裁定**：删除该列。记账表单改用"该账本内上次使用的账户"作为前端本地偏好（`localStorage`），不落库 |
| 2 | 界面语言存在哪 | **已由决策 §14.6 裁定**：`users.language VARCHAR(8) NULL`，取值 `zh` / `en`，**NULL 表示跟随系统**；`PATCH /me` 可改。DDL 见 [`./02-database.md`](./02-database.md)，前端用法见 [`./04-frontend.md`](./04-frontend.md) 待决 D-12 |
| 3 | `user_llm_settings` 是否需要 `created_at` | **已由决策 §14.6 裁定**：加 |
| 4 | `ledger_invites` 是否需要 `created_at` | **已由决策 §14.6 裁定**：加 |
| 5 | `exchange_rates` 的确切列 | **已由决策 §14.1 裁定**：新建 `(date, base, symbol, rate, fetched_at)`，主键 `(date, base, symbol)`，目标币种列叫 `symbol` 不叫 `quote`。DDL 见 [`./02-database.md`](./02-database.md)，读写算法见 [`./03-backend-api.md`](./03-backend-api.md) §6 |
| 6 | 账本内账户重名是否允许 | 建议允许（只前端提示），不加唯一约束——夫妻各有一张"招行储蓄卡"是常态 |
| 7 | 成员退出/被移除后，他 `created_by` 的历史数据怎么显示 | 建议保留 `created_by` 指向该用户，界面显示其邮箱前缀；不做匿名化 |
| 8 | 一个用户退到 0 本账本时的落地页 | 建议进"新建账本 / 输入邀请码"引导页，而不是空首页 |
| 9 | 多币种账户余额的展示形态 | **已由决策 §14.2 裁定**：不分币种桶。余额以账户 `default_currency` 计价（异币种交易按发生日汇率折进来），另给一个按最新汇率折到账本基准币种的 `balance_base`；接口只回这两个标量 + `balance_rate` / `balance_rate_date`（§5.4、[`./03-backend-api.md`](./03-backend-api.md) §5.23） |
| 10 | 本章用到的错误 `code` 命名 | **已由决策 §14.4 裁定**：[`./03-backend-api.md`](./03-backend-api.md) §4.2 是唯一注册表，本章全部 code 与状态码已按它改齐，不再自造同义名 |
| 11 | 两腿转账 PATCH 时用哪条腿的 `updated_at` 做乐观并发比较 | 建议用两腿中较新的那个，服务端两腿一起比对 |
| 12 | 归档账户上的历史交易是否允许 PATCH | 建议允许（只禁止新建），否则记错的旧账无法更正 |

---

## 另见

- [./README.md](./README.md) — 目标设计文档索引与阅读顺序
- [./00-decisions.md](./00-decisions.md) — **唯一事实来源**：本章每个决定的出处
- [./02-database.md](./02-database.md) — 目标 schema、约束、索引与迁移链
- [./03-backend-api.md](./03-backend-api.md) — 每个接口的参数、状态码、错误 code 与响应体
- [./04-frontend.md](./04-frontend.md) — 信息架构、页面、API 客户端、i18n 与视觉重设计
- [./05-import-and-llm.md](./05-import-and-llm.md) — 解析流水线、提示词、输出 schema、标记算法与测试
- [../current-design/01-domain-and-flows.md](../current-design/01-domain-and-flows.md) — 现状的记账模型与 20 条用户流程
- [../current-design/02-database.md](../current-design/02-database.md) — 现状的四张表与迁移历史
- [../current-design/03-backend-api.md](../current-design/03-backend-api.md) — 现状的接口清单
- [../current-design/06-known-issues.md](../current-design/06-known-issues.md) — 现状的已知问题（本章多处"堵死的坑"出自这里）
