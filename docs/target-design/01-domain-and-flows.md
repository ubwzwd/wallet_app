# 01 — 领域模型、流程与状态机（目标设计 v3.0）

> **本文回答什么问题**：v3.0 的钱包应用里"一笔账"到底是什么——有哪些实体、每个实体有哪些字段、四种交易种类（kind）各自的符号与统计口径、从注册到撤销一次导入的全部用户流程、每个流程服务端按什么顺序校验、失败时怎么办、以及统计数字精确到公式的算法。
>
> **事实来源**：本文的每一个决定都来自 [`./00-decisions.md`](./00-decisions.md)，正文用 `（决策 §x.y）` 标注出处。本文只展开决策，不改写决策；决策没覆盖的问题集中列在文末 `## 待决`。
>
> **对照基准**：凡说"现状"，指 [`../current-design/01-domain-and-flows.md`](../current-design/01-domain-and-flows.md) 描述的、仓库 `main` 提交 `56881b2` 的代码状态；引用现状代码用 `path:line`。凡说"目标"，是尚未实现的设计，不要当成已有代码去读。
>
> **与其他章的分工**：本章写"是什么"和"什么规则"；建表 DDL、索引、迁移在 [`./02-database.md`](./02-database.md)；每个接口的参数、状态码、响应体在 [`./03-backend-api.md`](./03-backend-api.md)；界面在 [`./04-frontend.md`](./04-frontend.md)；标准导入 CSV 格式、skill 文本、校验与自动标记算法在 [`./05-import-and-llm.md`](./05-import-and-llm.md)。本章只写导入的**状态与业务规则**。
>
> **修订说明**：**本版按 2026-09-11 全部决策同步**。相对上一版的主要变化，全部来自 [`./00-decisions.md`](./00-decisions.md) §14.20–§14.53：
>
> - **应用不接入任何大模型**（决策 §14.25、§5、§6）：删除"模型设置"实体、后台解析、解析进度、页面缩略图、视觉流水线、重试端点的全部内容。导入改成"用户在自己的 ChatGPT / Claude 里用我们的 skill 把账单整理成标准 CSV → 上传或粘贴到应用 → 服务端同步校验 → review → 提交"。
> - **导入只做 CSV**（决策 §14.47）：标准格式只有固定 11 列表头 + `# version:` 首行的 CSV，不再接受 JSON。
> - **导入批次两态**（决策 §5、§14.22）：`ready → committed`，没有 `uploaded` / `parsing` / `failed`；撤销 = 整批删除，不留"已撤销"状态。分类表版本不符整批 400 `skill_outdated`（决策 §14.30）。
> - **两条单腿转账可以配对成一笔转账，也可以拆开**（决策 §14.34）：导入 review 自动建议 `transfer_candidate`，交易详情页提供"关联为转账对腿" / "拆开"。上一版写的"单腿 ⇄ 两腿不能互转"作废。
> - **邀请码新规则**（决策 §14.29、§14.35、§14.52 A2）：用掉即删、过期即删，表里没有使用者 / 使用时间两列，`code` 不建唯一索引；`POST /ledgers/join` 端点级 1 QPS；owner 可主动作废一个码。
> - **账户与净资产**（决策 §14.48、§14.50）：类型四种（`checking` / `credit` / `cash` / `other`，没有 `savings`）；加 `archived_at`；`default_currency` 创建后不可改；归档账户不计入净资产；首页给资产 / 负债 / 净资产三个数。
> - **交易操作记录**（决策 §14.51）：新增 `transaction_events` 表，每条改交易的路径都追加一条事件，只追加不修改。
> - **分类说明文字**（决策 §14.20、§14.21）：一级分类带 `desc_zh` / `desc_en` 判据，随 `GET /categories` 下发。
> - **金额区间筛选按账本基准币种折算后比较**（决策 §14.49）；交易列表在 `{items, total}` 之外多返回一个 `summary`（决策 §14.52 A14）。
> - **用户资料**：加 `display_name`（决策 §14.6、§14.40）与 `language`，删除现状的默认账户列。
> - **本轮按决策 §14.53（2026-09-11）统一各章打架之处**：配对**不要求**两腿 `transfer_subtype` 原本相同，改为**配对时统一子类型**（§1.9、§3.15、§4.2、§6.2），统一时**两腿各写一条 `updated` 事件**（§1.10 路径表同步）；多候选转账不新增字段，只打 `needs_review` + `hint`，由用户在 review 里自己挑一条（§3.15 A）；没找到对腿时 `counterpart_source_id` **留空、不猜**（§3.17）；错误 code 一律取 [`./03-backend-api.md`](./03-backend-api.md) §4.2 注册表里的名字（`pair_invalid` / `import_format_invalid` / `currency_locked`）；导入校验的顺序是**解码 → 结构（含缺 `# version:` 行）→ 版本**（§3.17）。
>
> 本章篇幅不作为验收项（决策 §14.8）：被作废的内容是**删掉**，不是留旧文加一句"已作废"。

---

## 0. 本章范围与对照现状的总体差异

本章覆盖：领域模型（§1）、四种 kind（§2）、全部用户流程（§3）、状态机（§4）、统计口径与算例（§5）、不变量（§6）。

本章**不覆盖**：预算、找回密码/邮箱验证、分类管理、标签、实时协同、移动 App、"不计收支"标记、交易时刻（`occurred_at` 仍然只到天）、**应用内调用大模型**（API key、模型设置、服务端解析）——这些在本版本明确不做（决策 §0.7）。部署与运维沿用现状（决策 §0.1）。导出 CSV、通知、邀请码预览、分类推荐、交易编号、每条腿的"余后"余额本版本也不做（决策 §14.52）。

### 0.1 现状 → 目标 逐项差异

| # | 主题 | 现状 | 目标 | 决策 |
|---|---|---|---|---|
| 1 | 数据归属 | 一切挂在 `users.id` 下，没有账本概念 (backend/app/models/transaction.py:17) | 引入 `ledgers` / `ledger_members` / `ledger_invites`；账户、交易、导入都挂 `ledger_id`，鉴权 = "调用者是该账本成员" | §2 |
| 2 | 交易种类 | 没有 `kind` 列，方向完全由 `amount` 的符号承载 (backend/app/models/transaction.py:19)，前端编辑时按符号反推类型 (frontend/src/screens/TransactionFormScreen.tsx:76-87) | 显式 `kind ∈ {expense, income, refund, transfer}`，符号由数据库 CHECK 保证 | §1、§10 |
| 3 | 退款 | 不存在退款概念，只能记成一条正金额交易（会被算成收入） | 独立 kind `refund`，可关联原支出 `refund_of`，统计时按退款日期冲减该分类的支出 | §1.1 |
| 4 | 转账 | 两行共享 `transfer_pair_id`，后端零校验，单腿也被接受 (backend/app/api/transactions.py:91-100)，删除时按 pair 批量删 (backend/app/api/transactions.py:447-459) | `transfer_role` / `transfer_subtype` 必填；`transfer_pair_id` **可空**（对手账户不在应用里就是单腿，可填 `counterparty` 文本）；两腿走专用接口原子创建/修改/删除；两腿允许跨币种、金额可不等；两条单腿可以**配对**成两腿，两腿也可以**拆开** | §1.2、§14.34 |
| 5 | 分类 | 自由标签表 `transaction_tags` (backend/app/models/transaction_tag.py:11-20)，规范化只有 `strip().lower()`，重复标签会 500 | 后端常量里的固定两级分类表，一级带中英**说明文字**（归类判据），`category_l1` / `category_l2` 存 code，服务端校验；**删除** `transaction_tags`、`?tag=` 筛选和标签输入框 | §1.3、§14.20、§14.21 |
| 6 | 备注字段 | `transactions.description` (backend/app/models/transaction.py:22) | 改名 `note`（≤500 字），语义"这笔账的备注"；`merchant`（≤200 字）保留为独立字段 | §1.4 |
| 7 | 资金账户 | 无期初余额、无 `cash` 类型（API 正则只认 checking/savings/credit/other，backend/app/schemas/finance_source.py:21-26）、无删除接口 | 类型四种 `checking` / `credit` / `cash` / `other`（**没有** `savings`）；加 `opening_balance`、`archived_at`；`default_currency` 创建后不可改；有交易的账户不能删只能归档；归档账户真正禁止记账，且不计入净资产 | §3、§14.48、§14.50 |
| 8 | 余额 | 没有余额概念 | 余额以账户 `default_currency` 计价 = `opening_balance` + Σ 该账户交易折算到账户币种（异币种按发生日汇率），含单腿转账；首页给资产 / 负债 / 净资产三个数 | §3、§7、§14.2、§14.50 |
| 9 | 汇率换算 | 两套公式：单行路径 `amount × rate` (backend/app/api/transactions.py:20-46；backend/app/services/rates.py:135-139)，列表路径 `amount / rate` (backend/app/api/transactions.py:244-255)，且 `conversion_date` 永远是服务器当天 | 统一为一个函数：交易与统计用**发生日**汇率，账户余额用**最新**汇率，无行情日回退到最近一个已公布交易日 | §8 |
| 10 | 汇率缓存 | 无缓存表（`exchange_rates` 已被迁移删除，backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25），每次响应现拉 Frankfurter | **新建** `exchange_rates(date, base, symbol, rate, fetched_at)` 缓存表，按主键 upsert、保留全部历史行、不做整表刷新 | §8、§10、§14.1 |
| 11 | 账单导入 | 完全没有 | 用户在自己的 ChatGPT / Claude 里用我们的 skill 把账单整理成**标准 CSV**，上传或粘贴到应用；服务端**同步**校验（秒级）→ `ready` → review → commit → 整批撤销。`import_batches` + `import_rows` 两张表、**两态**状态机 | §5、§6、§14.47 |
| 12 | 大模型 | 完全没有 | **应用本身不调用任何大模型**：没有模型设置实体、没有 API key、没有服务端解析、没有解析进度、没有页面缩略图。交付物是仓库里的 `skills/wallet-import/` | §5、§6、§14.25 |
| 13 | 并发 | 无任何保护，两个客户端后写覆盖先写 | `transactions` / `finance_sources` / `ledgers` 带 `updated_at`，PATCH 必须回传，不一致返回 409 `stale_update` | §2 |
| 14 | 统计 | 没有统计接口 | 月度分类汇总（可下钻二级）+ 最近 12 个月**支出**趋势（首页不放收入趋势），全部折算到**账本**基准币种 | §7、§14.52 |
| 15 | 基准币种 | 属于用户 `users.base_currency` (backend/app/models/user.py:19) | 属于**账本** `ledgers.base_currency`；`users.base_currency` 降级为"新建账本时的默认值" | §2 |
| 16 | 错误响应 | `{"detail": "..."}`，422 时 `detail` 是数组 | 统一 `{"detail": "...", "code": "snake_case_code"}`；`code` 取值只能来自 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的唯一注册表 | §9、§14.4 |
| 17 | 界面语言 | 只有英文硬编码 | 中英双语 i18n（`users.language`，NULL 跟随系统），分类名、说明文字和错误信息都双语 | §0.4、§14.6 |
| 18 | 用户资料 | 只有邮箱、密码、基准币种、默认账户 | 加 `display_name`（没填时界面显示邮箱 `@` 前的部分）、`language`；**删除**默认账户列 | §14.6、§14.40 |
| 19 | 操作记录 | 完全没有 | 新表 `transaction_events`：每条改交易的路径都追加一条事件（创建 / 修改 / 导入 / 配对 / 拆开 / 退款关联变化），交易详情倒序展示 | §14.51 |

---

## 1. 领域模型

### 1.1 实体关系总览

```
                 +--------+
                 | users  |
                 +--------+
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
   source_id |        | source_id (导入的目标账户)      |
             |        |                                 |
        +--------------+  N ----------------------------+
        | transactions |
        +--------------+
          ^  |     ^  ^
 refund_of|  |     |  | transaction_id   +---------------------+
   (自引用)|  |     |  +-----------------| transaction_events  |
          +--+     |                     +---------------------+
                   | import_batch_id
                   |
                   |     +----------------+  N ------> ledgers
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

目标表共 **10 张**：`users`、`ledgers`、`ledger_members`、`ledger_invites`、`finance_sources`、`transactions`、`transaction_events`、`import_batches`、`import_rows`、`exchange_rates`。除 `transaction_events` 外都是决策 §10 列的表（模型设置表已随决策 §14.25 的导入改版取消）；`transaction_events` 是决策 §14.51 新增的一张。`transaction_tags` 删除（决策 §10）。枚举一律 `VARCHAR + CHECK`，不用 Postgres ENUM（决策 §10）。

时间戳一律是**不带时区的 UTC**（`created_at` / `updated_at` / `expires_at` / `at`），接口输出带 `Z`，前端按浏览器时区显示（决策 §14.26）。唯一的例外是日历日期字段 `occurred_at`，它是 Postgres `DATE`，不带时刻也不带时区（决策 §14.32）。

下面每张表的字段清单里，"必填"指数据库 `NOT NULL`。

### 1.2 用户 `users`

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `email` | VARCHAR | 登录邮箱，唯一 | 是 |
| `password_hash` | VARCHAR | bcrypt 哈希 | 是 |
| `display_name` | VARCHAR(40) | 显示名；**可空**，没填时界面显示邮箱 `@` 前的部分；`PATCH /me` 可改（决策 §14.6） | 否 |
| `base_currency` | CHAR(3) | **新建账本时的默认基准币种**，不再直接参与任何换算（决策 §2、§13.6） | 是 |
| `language` | VARCHAR(8) | 界面语言，`zh` / `en`；**可空，NULL 表示跟随系统**；`PATCH /me` 可改（决策 §14.6） | 否 |
| `created_at` | TIMESTAMP | 注册时间 | 是 |
| `updated_at` | TIMESTAMP | 最后修改时间（审计用；`PATCH /me` 不做乐观并发） | 是 |

- **没有头像**（决策 §14.6、§14.52 B22）：界面用 `display_name` 的首字母做圆形色块。
- **记账人怎么显示**（决策 §14.40，01-7）：交易上的 `created_by` / `updated_by` 只回用户 id（决策 §14.43，03-4），前端拿成员列表映射成 `display_name`，没填就显示邮箱前缀；成员退出或被移除后**照旧显示**，不做匿名化。
- **外观（浅色 / 深色 / 跟随系统）存本机**，不上服务器（决策 §14.52 A23）——它不是 `users` 的列。
- 现状的 `users.default_source_id` (backend/app/models/user.py:20) 在多账本模型里语义不再成立（账户属于账本，一个用户可能在 10 本账里各有账户），**决策 §14.6 已裁定删除该列**：记账表单改用前端本地记住的"该账本内上次使用的账户"。`PATCH /me` 也不再接受这个字段（决策 §14.42，03-2），不留兼容别名。

### 1.3 账本 `ledgers`（决策 §2）

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `name` | VARCHAR(100) | 账本名，如"我的账本""家庭账本" | 是 |
| `base_currency` | CHAR(3) | **基准币种属于账本**：余额合计、统计汇总都折算到它 | 是 |
| `created_by` | UUID | 创建者 `users.id` | 是 |
| `created_at` | TIMESTAMP | 创建时间 | 是 |
| `updated_at` | TIMESTAMP | 乐观并发用（决策 §2） | 是 |

软限制：每人最多 10 本账（决策 §2），只在应用层 `COUNT(*)` 校验，不加触发器（决策 §14.41，02-D-7）。

`GET /ledgers/{id}` 额外返回 `counts: {transactions, sources, import_batches}`，供删除账本前的二次确认展示（决策 §14.52 A22）。账本列表卡片**不算净资产**，只显示成员数与基准币种（决策 §14.52 A16）。

### 1.4 成员 `ledger_members`（决策 §2）

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `ledger_id` | UUID | 复合主键之一，外键 `ledgers.id` | 是 |
| `user_id` | UUID | 复合主键之一，外键 `users.id` | 是 |
| `role` | VARCHAR(16) | `owner` / `member` | 是 |
| `joined_at` | TIMESTAMP | 加入时间；创建者取账本创建时间 | 是 |

- 创建者自动成为 `owner`；**每本账恰有一个 owner**，由应用层保证（决策 §2）。
- 权限矩阵（决策 §2；屏幕稿里"撤销导入 owner 独占""成员不能管账户"的写法与决策矛盾，按决策 §14.52 B9 以本表为准）：

| 操作 | owner | member |
|---|---|---|
| 记账、改账、删账 | ✓ | ✓ |
| 管理账户（增 / 改 / 归档 / 删空账户） | ✓ | ✓ |
| 账单导入、review、提交、**撤销** | ✓ | ✓ |
| 交易配对 / 拆开 | ✓ | ✓ |
| 查看成员列表 | ✓ | ✓ |
| 生成 / 作废邀请码 | ✓ | ✗ |
| 移除成员 | ✓ | ✗ |
| 改账本名 / 基准币种 | ✓ | ✗ |
| 转让 owner | ✓ | ✗ |
| 删除账本 | ✓ | ✗ |
| 自行退出 | 必须先转让 | ✓ |

软限制：每本账最多 10 人（决策 §2、§14.52 B7），同样只在应用层校验。

### 1.5 邀请码 `ledger_invites`（决策 §2、§14.29）

**表里永远只有有效的码**：加入成功时那一行**直接删除**，过期的行在下次生成或校验时删除；因此没有"使用者""使用时间"两列，也没有"已作废"状态列（决策 §14.29）。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 外键 `ledgers.id`，`ON DELETE CASCADE` | 是 |
| `code` | CHAR(6) | 6 位数字，线下口头告诉对方；**不建唯一索引**（决策 §14.29） | 是 |
| `created_by` | UUID | 生成者（必为当时的 owner） | 是 |
| `created_at` | TIMESTAMP | 生成时间（决策 §14.6） | 是 |
| `expires_at` | TIMESTAMP | 生成后 10 分钟 | 是 |

- 生成时只保证**与当前有效的码不重复**（`SELECT ... WHERE expires_at > now()`），撞上就重新摇一个；全表不要求唯一，因为过期行会被清掉、历史码没有保留价值（决策 §14.29）。
- **不做定时清理任务**：清理搭在"生成"和"校验"两个动作上（决策 §14.29）。
- owner 可以主动**作废**一个还没用掉的码：`DELETE /ledgers/{id}/invites/{code}` 直接删除该行（决策 §14.52 A2）。
- 输码时**不做就地预览**（决策 §14.52 B17）：没有"输满 6 位就返回账本名"的接口，唯一入口是 `POST /ledgers/join`。

### 1.6 资金账户 `finance_sources`（决策 §3、§14.48、§14.50）

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 所属账本；账本内账户完全共享（决策 §2） | 是 |
| `name` | VARCHAR(100) | 账户名，如"招行储蓄卡""招行信用卡" | 是 |
| `type` | VARCHAR(32) | **四种**：`checking`（储蓄卡 / Checking）、`credit`（信用卡）、`cash`（现金）、`other`（其他）。**没有 `savings`**（决策 §14.48） | 是 |
| `default_currency` | CHAR(3) | 记账时的默认币种（单笔交易可以是别的币种）；**创建后不可改**（决策 §14.50） | 是 |
| `opening_balance` | NUMERIC(18,4) | 期初余额，默认 `0`。信用卡在表单里填"欠款"，服务端**存为负数**（决策 §14.52 A13） | 是 |
| `archived` | BOOLEAN | 归档标志，默认 `false` | 是 |
| `archived_at` | TIMESTAMP | 归档时刻；`archived=false` 时为 NULL（决策 §14.50） | 否 |
| `created_by` | UUID | 创建者 | 是 |
| `updated_by` | UUID | 最后修改者 | 是 |
| `created_at` | TIMESTAMP | | 是 |
| `updated_at` | TIMESTAMP | 乐观并发用 | 是 |

**余额是算出来的，不落库**：`balance = opening_balance + Σ convert(t.amount, t.currency → default_currency, 按 t.occurred_at 当日汇率)`——该账户的所有交易（含单腿转账、含两腿转账的每一条腿），同币种不换算（决策 §3、§14.2）。精确定义与算例见 §5.4。

**期初余额不是一笔交易**（决策 §14.52 B5）：它是账户上的一列，不生成任何 `transactions` 行，界面文案要写成"记在账户上，不是一笔交易"。

**归档账户不计入净资产**（决策 §14.50）：账户列表按 `type` 分组并给每组小计，归档账户单列一组、其余额既不进分组小计也不进资产 / 负债 / 净资产；归档时前端提示"该账户余额将从净资产中移除"。定义见 §5.5。

与现状的差别：现状没有 `opening_balance`、没有 `archived_at`、没有 `cash` 类型且多了一个 `savings` (backend/app/schemas/finance_source.py:21-26)、也没有删除接口（`backend/app/api/finance_sources.py` 只注册了 post / get / get / patch 四个路由）。迁移时现有 `savings` 行回填成 `checking`（决策 §13.3、§14.48）。

### 1.7 交易 `transactions`（决策 §1、§10）

一笔交易 = 在**恰好一个**资金账户上、**恰好一种**币种、**某一天**发生的一次带符号的资金变动。这一条继承自现状，不变。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 所属账本 | 是 |
| `source_id` | UUID | 资金账户，外键 `finance_sources.id` | 是 |
| `kind` | VARCHAR(16) | `expense` / `income` / `refund` / `transfer` | 是 |
| `amount` | NUMERIC(18,4) | **带符号**金额，符号由 `kind`（转账再看 `transfer_role`）决定 | 是 |
| `currency` | CHAR(3) | ISO 4217，大写 | 是 |
| `occurred_at` | DATE | 发生日，**无时区的日历日期**，只到天（决策 §0.7、§14.32） | 是 |
| `note` | VARCHAR(500) | 备注（现状叫 `description`，决策 §1.4 改名） | 否 |
| `merchant` | VARCHAR(200) | 商户；搜索、退款匹配、导入去重都靠它。**转账不填商户**（决策 §14.52 B16） | 否 |
| `category_l1` | VARCHAR(32) | 一级分类 code；`transfer` 必须为 NULL，其余 kind 必填 | 条件 |
| `category_l2` | VARCHAR(32) | 二级分类 code；必须属于 `category_l1` | 否 |
| `refund_of` | UUID | 仅 `refund` 可填，指向同账本一条 `kind='expense'`，`ON DELETE SET NULL` | 否 |
| `transfer_role` | VARCHAR(8) | `out` / `in`；`kind='transfer'` 时必填，其余 kind 必须为 NULL | 条件 |
| `transfer_subtype` | VARCHAR(16) | `plain` / `repayment`；`kind='transfer'` 时必填，其余 kind 必须为 NULL | 条件 |
| `transfer_pair_id` | UUID | 两腿共用；**可空**（单腿转账为 NULL），可由配对 / 拆开改变（决策 §14.34） | 否 |
| `counterparty` | VARCHAR(100) | 对方文本（"老婆""工资卡"），只在单腿转账填 | 否 |
| `import_batch_id` | UUID | 由哪一批导入创建；手工记账为 NULL | 否 |
| `created_by` | UUID | 记账人 | 是 |
| `updated_by` | UUID | 最后修改人 | 是 |
| `created_at` | TIMESTAMP | | 是 |
| `updated_at` | TIMESTAMP | 乐观并发用 | 是 |

交易上**没有**对外可见的顺序编号，也不返回"这条之后账户余额是多少"（决策 §14.52 A6、A7）。

### 1.8 退款关联（决策 §1.1）

退款不是一张表，是 `transactions` 上的一个自引用外键 `refund_of`：

- 只有 `kind='refund'` 的行可以有 `refund_of`（CHECK：`refund_of IS NULL OR kind='refund'`，决策 §10）。
- 被指向的行必须在**同一账本**、且 `kind='expense'`（应用层校验）。
- 关联成功后，退款行的 `category_l1` / `category_l2` **自动沿用原支出**，用户可改。
- **部分退款** = 多条 `refund` 行指向同一条原支出。
- **超额退款**：累计退款金额超过原单金额时，前端警告但**允许保存**；服务端不拦（决策 §1.1）。已退完的原单在选择器里**仍然可选**，只是带超额警告，不置灰（决策 §14.52 B10）。
- **原单被删除**：`refund_of` 置空（`ON DELETE SET NULL`），退款行本身保留、分类不动，仍按自己的分类和日期参与统计冲减。
- 退款行也可以完全不关联原单（`refund_of` 为 NULL），此时它就是"某分类的一笔负向支出"。
- **选原单的界面不单独建接口**（决策 §14.11）：复用 `GET /ledgers/{id}/transactions`，固定条件 `kind=expense`（这一条**不可移除**，决策 §14.52 B11）、退回账户默认取原单账户、时间范围最近 90 天（决策 §14.33），每条显示 `refunded_total` / `refundable`，并可勾选"只看还有可退余额的"（决策 §14.52 A20）。
- 退款关联**在导入之后仍可修改或解除**（决策 §14.34）：`PATCH /transactions/{tid}` 传新的 `refund_of` 或 `null` 即可，每次变化都追加一条 `refund_linked` / `refund_unlinked` 事件（§1.10）。
- 退款详情页列出**同一原单的其它退款**（决策 §14.52 A25），数据来自原单展开的 `refunds[]`（决策 §14.46，04-D-6）。

### 1.9 转账腿（决策 §1.2、§14.34）

一次转账在数据库里是 **1 行或 2 行**：

| 形态 | 行数 | `transfer_pair_id` | `counterparty` | 典型场景 |
|---|---|---|---|---|
| 两腿 | 2 | 两行同一个 UUID | 必须为 NULL | 自己的储蓄卡 → 自己的信用卡还款；储蓄卡 → 现金 |
| 单腿 | 1 | NULL | 可填文本 | 老婆给我转账、我给别人转账、用没录入应用的工资卡还信用卡 |

规则：

- `transfer_role`：转出腿 `out`（`amount` 负），转入腿 `in`（`amount` 正）。
- `transfer_subtype`：`plain`（普通划转）或 `repayment`（信用卡还款）。**配对不要求两腿原本相同，而是在配对时统一**（决策 §14.53a）：
  - `POST .../transfer` 一次建两行时两腿天然同值；
  - 两条单腿**配对**时（导入提交或 `POST .../{tid}/pair`），服务端算出一个子类型写到两腿上——**任一腿是 `repayment` 且转入腿所在账户 `type = 'credit'` → 整对 `repayment`；否则整对 `plain`**；两腿在**同一个事务**里改成这个值，**两腿各追加一条 `updated` 事件**（`changes` 记 `transfer_subtype` 的前后值；值未变的那腿 before == after）（§1.10）。
  - 之所以不硬卡「两腿必须相同」：储蓄卡账单常把同一笔还款写成 `plain`、信用卡账单写成 `repayment`，硬卡会让这类配对永远触发不了（决策 §14.53a）。
  - **配对之后**两腿始终一致（§6.2 不变量 8）；此后 `PATCH .../transfer/{pair_id}` 改 `subtype` 也同写两腿。
- `occurred_at`：`POST .../transfer` 建的两腿必然同日；**配对出来的一对允许两腿日期不同**（对账日期差，§3.15 B 不校验日期）。因此**两腿转账对象顶层的 `occurred_at` / `subtype` / `note` 一律取 `out` 腿的值**，`PATCH .../transfer/{pair_id}` 传这三个字段时**同时写到两腿**（§3.13）。
- `UNIQUE (transfer_pair_id, transfer_role)`，NULL 不参与——保证同一个 pair 最多一条 out、一条 in（决策 §10）。
- `transfer_pair_id IS NULL OR counterparty IS NULL`——有对腿就不填对方文本（决策 §10）。
- **两腿支持跨币种**：两腿各存自己的 `currency` 和 `amount`，**不要求金额相等**（出 100 USD / 入 720 CNY）。汇兑差价不单独记账，手续费另记一笔 `expense`，分类 `other` / `fees`（决策 §1.2）。跨币种时界面显示的汇率 chip 是**只读参考**，不能手改；要调就改另一腿的金额（决策 §14.52 A10）。
- **单腿计入账户余额，不计入收入/支出统计**（决策 §1.2）；两腿同样不计入统计。
- 表单和导入的默认建议：外部转入默认建议记为 `income`（分类 `social_income` 等），用户明确选"转账"才记 `transfer`——避免真正的收入消失在统计之外（决策 §1.2）。
- **转账不设商户 / 标题**（决策 §14.52 B16）：交易列表里两腿显示"A → B"，单腿显示"对方：X"（`counterparty` 为空时显示"转账"）。
- **两腿在交易列表里合并成一行显示**（决策 §14.52 B15）：这只是**前端展示**——接口仍按行返回两条，合并、按 pair 计数、"按账户筛选时任一腿命中即显示整对"都由前端做。数据库里永远是两行。
- **单腿 ⇄ 两腿可以互转**（决策 §14.34，取代上一版的"不能互转，只能删了重记"）：
  - **配对**：`POST /ledgers/{id}/transactions/{tid}/pair`，把两条**方向相反、仍为单腿**的转账挂到同一个新的 `transfer_pair_id` 上，两条的 `counterparty` 一起清空。
  - **拆开**：`POST /ledgers/{id}/transactions/transfer/{pair_id}/unpair`，两腿的 `transfer_pair_id` 置 NULL，各自变回单腿（`counterparty` 保持 NULL，用户可再填）。
  - 两个动作各追加一条 `paired` / `unpaired` 事件（§1.10）。流程与失败分支见 §3.15，状态图见 §4.2。

### 1.10 交易操作记录 `transaction_events`（决策 §14.51）

**每一条改动交易的路径都追加一条事件**，只追加、不修改、不软删；交易被删除时它的事件级联删除（撤销导入删交易同理）。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 所属账本（便于按账本级联与鉴权） | 是 |
| `transaction_id` | UUID | 外键 `transactions.id`，`ON DELETE CASCADE` | 是 |
| `actor_id` | UUID | 操作人 `users.id` | 是 |
| `at` | TIMESTAMP | 发生时刻（naive UTC，决策 §14.26） | 是 |
| `event` | VARCHAR(32) | `created` / `updated` / `imported` / `paired` / `unpaired` / `refund_linked` / `refund_unlinked` | 是 |
| `changes` | JSON | `{字段: {before, after}}`；`created` / `imported` 可为空对象 | 否 |
| `import_batch_id` | UUID | 事件由哪一批导入产生；手工操作为 NULL | 否 |
| `client` | VARCHAR(64) | 来自请求头 `X-Client`（如 `web`）；没带就是 NULL | 否 |

产生事件的路径一览：

| 路径 | 事件 | `changes` 内容 |
|---|---|---|
| `POST /transactions` | `created` | 空 |
| `PATCH /transactions/{tid}` | `updated` | 本次实际变化的字段 |
| `POST /transactions/transfer` | 两腿各一条 `created` | 空 |
| `PATCH /transactions/transfer/{pair_id}` | 两腿各一条 `updated` | 各自变化的字段 |
| `POST /imports/{bid}/commit` | 每条新交易一条 `imported` | 空，带 `import_batch_id` |
| `POST /transactions/{tid}/pair` | 两条各一条 `paired`；配对时统一 `transfer_subtype`，两腿再各一条 `updated` | `paired`：`transfer_pair_id`、`counterparty` 的前后值；`updated`：`transfer_subtype` 的前后值（值未变的那腿 before == after，决策 §14.53a） |
| `POST /imports/{bid}/commit` 里发生配对 | 新旧两条各一条 `paired` + 各一条 `updated` | 同上一行（决策 §14.53a、§14.51） |
| `POST /transactions/transfer/{pair_id}/unpair` | 两条各一条 `unpaired` | `transfer_pair_id` 的前后值 |
| `PATCH /transactions/{tid}` 令 `refund_of` 由空变非空 | `refund_linked`（在 `updated` 之外额外一条） | `refund_of` 的前后值 |
| `PATCH /transactions/{tid}` 令 `refund_of` 由非空变空 | `refund_unlinked`（额外一条） | `refund_of` 的前后值 |

`GET /ledgers/{id}/transactions/{tid}` 在响应里带 `events[]`，**按 `at` 倒序**（决策 §14.51）。事件里不写"客户端 iOS"这类本版本不存在的东西——`client` 只记请求头里的实际值（屏幕稿审阅 [`mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md) C8 / C9，由决策 §14.52 一并采纳）。

**不产生事件**的情况：原单被删除导致退款行 `refund_of` 被 `ON DELETE SET NULL` 置空——那是数据库级联，不经过任何应用路径；界面上退款详情直接显示"原单已删除"。

### 1.11 导入批次 `import_batches`（决策 §5、§14.47）

一次上传或粘贴 = 一批。一份文件对应**一个**目标账户，上传时由用户选，文件里不含账户信息。

**批次不保存上传的文件**，也不保存原始行值：只记文件名与大小（决策 §14.28）。后端没有文件系统状态，没有上传目录、没有目录清理。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `ledger_id` | UUID | 所属账本 | 是 |
| `source_id` | UUID | 目标资金账户（不能是已归档账户） | 是 |
| `created_by` | UUID | 上传人 | 是 |
| `source` | VARCHAR(16) | 来源：`csv`（上传文件） / `paste`（在应用内粘贴 CSV 文本）。**没有 `json`**（决策 §14.47） | 是 |
| `filename` | VARCHAR(255) | 原始文件名；`paste` 时为 NULL | 否 |
| `size_bytes` | INTEGER | 文本字节数，≤ 2 MB（决策 §5、§9） | 是 |
| `skill_version` | VARCHAR(32) | CSV 首行 `# version:` 里的分类表版本，校验通过后原样记下（决策 §14.30） | 是 |
| `status` | VARCHAR(16) | **只有两个值**：`ready` / `committed`（决策 §5、§14.22；撤销 = 整批删除，不是第三个状态） | 是 |
| `row_count` | INTEGER | 校验出的草稿行数 | 是 |
| `warnings` | JSON | 批次级提示文本数组（如"本批有 3 行没有分类"）。**行级问题不在这里**，在 `import_rows.hint` | 否 |
| `committed_transaction_count` | INTEGER | 提交时建出的交易数；未提交为 NULL | 否 |
| `created_at` | TIMESTAMP | | 是 |
| `updated_at` | TIMESTAMP | 状态最后变化时间 | 是 |
| `committed_at` | TIMESTAMP | 提交完成的时刻；未提交为 NULL | 否 |

**没有**下面这些列（随决策 §14.25 的导入改版一并删除）：模型 id、原始响应、解析进度两列、错误三列、是否走视觉路径、页面缩略图相关的一切。校验错误是**同步**返回给调用方的 400，压根不会产生批次行。

批次列表每行展示：目标账户、上传人、时间、行数、**净额**、**标记数**、状态（决策 §14.52 A17）。

完整 DDL 见 [`./02-database.md`](./02-database.md)。

### 1.12 导入草稿行 `import_rows`（决策 §5、§14.41）

草稿单独一张表，不污染正式交易表；也不用 JSON 单列（多人 review 时会互相覆盖，且没法建外键）。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `id` | UUID | 主键 | 是 |
| `batch_id` | UUID | 外键 `import_batches.id`，`ON DELETE CASCADE` | 是 |
| `row_no` | INTEGER | 批内序号（**从 1 起**，决策 §14.5），决定 review 表格顺序，也是错误提示里引用的行号 | 是 |
| `status` | VARCHAR(16) | `pending` / `edited` / `skipped`。**没有"已确认"**（决策 §14.7、§14.52 B13） | 是 |
| `occurred_at` | DATE | 发生日。**列名与交易表一致**；导入文件里的列和接口字段仍叫 `date`（决策 §14.41，02-D-3） | 否 |
| `amount` | NUMERIC(18,4) | 带符号金额 | 否 |
| `currency` | CHAR(3) | 币种；无效时改成目标账户的 `default_currency` 并打 `needs_review` | 否 |
| `kind` | VARCHAR(16) | `expense` / `income` / `refund` / `transfer` | 否 |
| `transfer_role` | VARCHAR(8) | `out` / `in`；review 里可改，提交时原样落到交易上 | 否 |
| `transfer_subtype` | VARCHAR(16) | `plain` / `repayment` | 否 |
| `merchant` | VARCHAR(200) | 商户 | 否 |
| `note` | VARCHAR(500) | 备注（原文摘要清理后 + 外币原值等） | 否 |
| `category_l1` | VARCHAR(32) | 一级分类 code；拿不准就留空，review 表显示"待归类" | 否 |
| `category_l2` | VARCHAR(32) | 二级分类 code | 否 |
| `source_ref` | VARCHAR(200) | 指回账单原文位置的可选字符串 | 否 |
| `hint` | VARCHAR(200) | 服务端给 review 界面的一句提示（如"币种 XX 无效，已改为账户币种"），**只读、不进** `transactions.note`（决策 §14.19） | 否 |
| `flags` | 字符串数组 | 服务端标记，**只有四种**：`duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review`（决策 §5、§14.31、§14.34） | 否 |
| `matched_transaction_id` | UUID | `refund_candidate` 的原单、或 `transfer_candidate` 的对腿（唯一候选时预填） | 否 |
| `counterpart_source_id` | UUID | 转账 / 还款行的对手账户：找到唯一对腿时预填成它所在的账户，**没找到就留空、不猜**（决策 §14.53c）；用户在 review 里填时必须是**本账本的未归档账户**——不存在或不属于本账本 → 404 `not_found`，已归档 → 409 `source_archived`（决策 §14.53c） | 否 |
| `counterparty` | VARCHAR(100) | 对方文本；**校验阶段恒为 NULL**（skill 不猜对手账户，CSV 里没有这一列），只有用户在 review 里填才有值，提交单腿转账时写入 `transactions.counterparty`（决策 §14.10、§14.16） | 否 |
| `transaction_id` | UUID | 提交后建出来的交易 id | 否 |
| `created_at` / `updated_at` | TIMESTAMP | | 是 |

**没有**下面这些列：置信度、页码、分块相关列、原始值副本。校验时对某个字段做的每一处改动都写进 `hint`，不另存原始值（决策 §14.28）。

限制：单批 ≤ 2000 行、文本 ≤ 2 MB（决策 §5）。草稿行列表 `limit` 上限 500（决策 §14.44，03-14）。完整 DDL 见 [`./02-database.md`](./02-database.md)；标准 CSV 格式、校验规则与自动标记算法见 [`./05-import-and-llm.md`](./05-import-and-llm.md)。

### 1.13 汇率 `exchange_rates`（决策 §8、§10、§14.1）

来源 Frankfurter，**换算读取时计算、不落到交易行上**；这张表只是行情缓存。

| 字段 | 类型 | 含义 | 必填 |
|---|---|---|---|
| `date` | DATE | 行情日（Frankfurter 返回的 `date`，不是服务器当天） | 是 |
| `base` | CHAR(3) | 基准币种 | 是 |
| `symbol` | CHAR(3) | 目标币种；列名与现有 `/rates/latest?symbols=` 参数同源（决策 §14.1） | 是 |
| `rate` | NUMERIC(18,8) | `1 base = rate symbol` | 是 |
| `fetched_at` | TIMESTAMP | 抓取时间 | 是 |

主键 `(date, base, symbol)`。写入按主键 **upsert**、**保留全部历史行、不做整表刷新**——历史汇率一经公布不再变，缓存的意义正是让发生日汇率不必反复外网请求；同一 `(base, symbol)` 一小时内不重复请求（决策 §14.1）。"最新汇率" = 最近一个已公布日的行。

**现状没有这张表，必须新建**：迁移 backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25 把它删掉了，现状每次响应都现拉 Frankfurter。DDL 见 [`./02-database.md`](./02-database.md)，读写算法见 [`./03-backend-api.md`](./03-backend-api.md) §6。

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

**`refund`（退款）** —— 金额为正，但它不是收入，它是"某笔支出退回来了"。统计上按**退款行自己的 `occurred_at`** 决定落在哪个月、按**退款行自己的 `category_l1`** 决定属于哪个分类，去冲减那个月那个分类的支出（决策 §1）。所以 3 月的支出在 4 月退款，会让 3 月的分类支出不变、4 月的该分类支出减少（算例见 §5.7.1）。

**`transfer`（转账）** —— 本人账户之间的资金划转，包括信用卡还款。它只搬钱、不产生损益，所以完全不进收支统计，只进账户余额。`transfer_subtype='repayment'` 用来把信用卡还款和普通划转区分开（导入配对、界面文案要用），但**统计口径上两者相同**——所以 `repayment` 是 subtype 而不是第五种 kind。

### 2.3 分类的边界与说明文字（决策 §1.3、§14.20、§14.21）

分类表是后端代码里的**固定常量**（`backend/app/core/categories.py`）：一级、二级都不可由用户修改，没有分类管理接口和页面；`GET /api/v1/categories` 公开下发并带 `version`，前端永久缓存（决策 §1.3）。界面上不能出现"默认分类"这种暗示可配置的措辞——正确说法是"分类是内置的、不可改"（屏幕稿审阅 [`mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md) C12、屏幕 15，由决策 §14.52 一并采纳）。

两条最容易搞混的一级分类，边界由决策 §14.20 钉死：

| 一级分类 | 判据 | 归它 | 不归它 |
|---|---|---|---|
| `groceries` 生活购物 | **消耗品与家里的日常运转——用完就没了** | 买菜、洗护清洁、厨房用品、纸巾垃圾袋电池衣架等日用杂货（`household`，原"家居耗材"已并入） | 家电、家具 |
| `shopping` 消费购物 | **耐用品与一次性大件——买一次用几年** | 数码、家电、家具、行李箱工具装饰品等其他物件（`other_goods`） | 买菜、洗护用品 |

**不按"必需 / 非必需"划分**，那个判断太主观（决策 §14.20）。原来的 `misc_goods` 已删除。淘宝 / 京东 / Shopee 这类看不出买了什么的行，skill **留空不硬猜**，也不进任何兜底桶（决策 §1.3）。

**每个一级分类带一段说明文字**（决策 §14.21）：常量里有 `desc_zh` / `desc_en` 两段，写的是**归类判据和易混淆项的去向**（例如 `food`："日常吃喝：堂食、外卖、咖啡奶茶、零食。旅途中的吃喝归旅游"）。它们随 `GET /categories` 一起下发，**只在一级上有，二级为 `null`**；说明文字与分类表一起冻结在代码里，改动时 `version` 递增。用到它的地方：

| 用处 | 说明 |
|---|---|
| 记一笔表单的分类选择器 | 一级名称下方的辅助文字；分类搜索框**按判据文字也能搜到**（决策 §14.52 A19） |
| 导入 review 表格的分类选择器、批量设分类 | 同上 |
| 统计页的一级分类 | 作为提示 |
| skill 的提示词 | 一级分类行带上中文说明作为判据（决策 §6、§14.21） |

分类 code 用英文标识、中英显示名与说明文字都进常量（决策 §14.36，P-9）。**服务端校验三件事**（决策 §1.3）：code 在表内；二级属于该一级；一级的收支侧与 kind 匹配（`expense` / `refund` 用支出分类，`income` 用收入分类）。二级可以不选，统计里归到该一级下的"未细分"桶（决策 §14.52 A19 的"不细分"选项）。

### 2.4 允许的编辑

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

**接口边界**（决策 §1.2、§11、§14.34）：

| 交易形态 | 创建 | 修改 | 删除 | 形态变化 |
|---|---|---|---|---|
| `expense` / `income` / `refund` | `POST /ledgers/{id}/transactions` | `PATCH /ledgers/{id}/transactions/{tid}` | `DELETE /ledgers/{id}/transactions/{tid}` | — |
| **单腿** transfer（`transfer_pair_id IS NULL`） | `POST /ledgers/{id}/transactions` | `PATCH /ledgers/{id}/transactions/{tid}` | `DELETE /ledgers/{id}/transactions/{tid}` | `POST .../transactions/{tid}/pair` 变两腿 |
| **两腿** transfer（`transfer_pair_id` 非空） | `POST /ledgers/{id}/transactions/transfer` | `PATCH /ledgers/{id}/transactions/transfer/{pair_id}` | `DELETE /ledgers/{id}/transactions/transfer/{pair_id}` | `POST .../transactions/transfer/{pair_id}/unpair` 变两条单腿 |

**两腿转账的任一腿不能单独 PATCH 或 DELETE**：对一条 `transfer_pair_id` 非空的行调用 `PATCH /transactions/{tid}` 或 `DELETE /transactions/{tid}`，一律返回 **409 `use_transfer_endpoint`**，`detail` 指出应改用 `.../transfer/{pair_id}`。这条把现状最大的一个坑堵死了：现状允许单独 PATCH 一条腿导致两腿漂移，创建和编辑都靠客户端顺序发两个请求 (frontend/src/screens/TransactionFormScreen.tsx:161-234 创建、:236-294 编辑)，只有删除是服务端按 pair 批量删 (backend/app/api/transactions.py:447-459)。

**单腿 ⇄ 两腿现在可以互转**（决策 §14.34）：走 `pair` / `unpair` 两个专用端点，不需要删了重记；`kind` 始终是 `transfer`，所以不触碰 `kind_change_not_allowed` 那条规则。流程见 §3.15。

CHECK 约束把符号、分类、角色的一致性钉死在数据库里，完整清单见 §6.1 和 [`./02-database.md`](./02-database.md)。

---

## 3. 流程

约定：所有业务接口都在 `/api/v1/ledgers/{ledger_id}/...` 下（决策 §2、§11）；每个请求先过两道通用前置，下文不再重复：

1. **鉴权**：`Authorization: Bearer <JWT>`，无效 / 过期 → 401 `unauthorized`。
2. **账本成员校验**：`ledger_members` 里存在 `(ledger_id, current_user.id)` 才继续；否则 **404 `not_found`**（不区分"不存在"和"没权限"，避免探测账本 id）。需要 owner 的操作再查 `role='owner'`，否则 **403 `not_owner`**。

错误响应统一 `{"detail": "...", "code": "snake_case_code"}`（决策 §9）。**下文出现的每一个 `code` 与状态码都取自 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的唯一注册表**（决策 §14.4），本章不自造同义名；注册表里没有专属 code 的校验失败一律是 `validation_error`。

所有写交易的路径都会按 §1.10 追加一条 `transaction_events`，下文只在事件类型不是显而易见时才点名。

### 3.1 注册并自动建默认账本（决策 §2、§9、§14.40）

- **触发者**：匿名访客。
- **前置**：`REGISTRATION_OPEN=true`（环境变量，默认 `true`，决策 §14.33）。前端在渲染注册页之前先请求匿名可读的 `GET /api/v1/config`，拿到 `{"registration_open": false}` 就直接显示"注册已关闭"，不给表单（决策 §14.46，04-D-5）。
- **步骤**：
  1. `POST /api/v1/auth/register`，体 `{"email", "password", "base_currency", "language", "display_name"}`（后两个可选）。
  2. 服务端在**一个事务**内：建 `users` 行 → 建 `ledgers` 行（`name="我的账本"`（语言为 en 时 `"My Ledger"`）、`base_currency` = 用户提交的默认币种、`created_by` = 新用户）→ 建 `ledger_members` 行（`role='owner'`）。
  3. 返回 JWT。
- **服务端校验**：注册开关关闭 → 403 `registration_closed`；邮箱已存在 → 409 `email_exists`；密码 < 8 位 → 422；`base_currency` 不匹配 `^[A-Z]{3}$` → 422；`display_name` ≤ 40 字；同 IP 每小时注册 > 5 次 → 429 `register_rate_limited`（进程内令牌桶，与登录、加入账本共用同一组件，重启清零、单实例，决策 §14.43，03-8）。
- **状态变化**：0 个用户 → 1 个用户 + 1 本账本 + 1 条 owner 成员记录。
- **失败分支**：任一步失败整个事务回滚，不会留下"有用户没账本"的状态。这一点和现状不同：现状注册只建 `users` 行 (backend/app/api/auth.py:42-51)。

**用户一本账都没有时**（退光了、或被全部移除）进"新建账本 / 输入邀请码"引导页，而不是空首页（决策 §14.40，01-8；屏幕稿按 §14.52 B19 补画）。

### 3.2 创建账本（决策 §2）

- **触发者**：任何已登录用户。
- **前置**：该用户当前拥有（作为成员参与的）账本数 < 10。
- **步骤**：`POST /api/v1/ledgers`，体 `{"name", "base_currency"}`（`base_currency` 缺省取 `users.base_currency`）→ 事务内建 `ledgers` + `ledger_members(role='owner')` → 201 返回账本。
- **服务端校验**：`name` 长度 1–100（决策 §14.13，与账户名一致）；`base_currency` 3 位大写字母；账本数已达 10 → 409 `ledger_limit_reached`。
- **状态变化**：新账本进入 `GET /ledgers` 列表；前端把当前账本 id 切到新账本（放在 URL 里，决策 §12）。
- **失败分支**：校验失败无副作用。

### 3.3 生成邀请码（决策 §2、§9、§14.29）

- **触发者**：账本 owner。
- **前置**：当前成员数 < 10。
- **步骤**：`POST /api/v1/ledgers/{id}/invites`（空体）→ 服务端在一个事务里：
  1. **先删掉该账本所有 `expires_at <= now()` 的行**（过期即删，决策 §14.29）；
  2. 摇一个 6 位数字 code，与该账本**当前仍有效的**码比对，撞上就重摇（不要求全表唯一，`code` 上没有唯一索引）；
  3. 写入 `ledger_invites`，`expires_at = now + 10 分钟`；
  4. 201 返回 `{"id": "...", "code": "418302", "ledger_id": "...", "ledger_name": "我的账本", "expires_at": "...", "created_at": "..."}`（[`./03-backend-api.md`](./03-backend-api.md) §5.21）。
- **服务端校验**：非 owner → 403 `not_owner`；成员数已达 10 → 409 `member_limit_reached`。
- **状态变化**：新增一条有效邀请码。owner 可以反复生成，旧码不会自动作废（各自到点过期，或被 owner 手动作废）。
- **失败分支**：无副作用。界面上码只显示一次窗口，过期后要重新生成。

### 3.4 作废邀请码（决策 §14.52 A2）

- **触发者**：账本 owner。
- **步骤**：`DELETE /api/v1/ledgers/{id}/invites/{code}` → 删除该账本下这个 code 的行 → 204。
- **服务端校验**：非 owner → 403 `not_owner`；该账本下没有这个 code（已用掉、已过期被清、或压根不存在）→ 404 `not_found`。
- **状态变化**：这个码立刻失效；owner 可以马上再生成一个新的。
- **说明**：因为"表里永远只有有效的码"，作废就是**物理删除**，不需要 `revoked` 状态列（决策 §14.29）。

### 3.5 加入账本（决策 §2、§9、§14.29、§14.35）

- **触发者**：任何已登录用户（被邀请方）。
- **前置**：拿到 6 位码；该用户账本数 < 10。**输码过程中不做任何预览**（决策 §14.52 B17）。
- **步骤**：
  1. `POST /api/v1/ledgers/join`，体 `{"code": "418302"}`。
  2. 服务端**先过端点级限流**：整个端点**全局 1 QPS**（令牌桶，突发 3），不按用户计数；超出 → 429 `invite_rate_limited` + `Retry-After`（决策 §14.35）。**被限流的请求不触碰邀请码**。
  3. 事务内先删掉所有 `expires_at <= now()` 的行（过期即删，决策 §14.29）。
  4. 在**未过期**的码里按 code 查：查不到 → 400 `invite_invalid`（"不存在""已用掉""已过期"对调用方是同一个结果——因为用掉和过期的行都已经不在表里了）。
  5. 调用者已是该账本成员 → 409 `already_member`（**不消耗**邀请码）。
  6. 目标账本成员数已达 10 → 409 `member_limit_reached`（不消耗邀请码）。
  7. 调用者账本数已达 10 → 409 `ledger_limit_reached`（不消耗邀请码）。
  8. 同一事务内：插入 `ledger_members(role='member')` + **删除**这行 `ledger_invites` → 200 返回账本。
- **状态变化**：邀请码这一行消失；用户成为 member；该账本的全部账户、交易、导入对他立即可见可改。
- **失败分支**：5/6/7 是"码没问题、条件不满足"，**不消耗码**，用户解决问题后可以用同一个码再试（只要还没过期）。限流只看端点整体速率，输错码本身不再有"同一用户 15 分钟 5 次"这类计数（决策 §14.35 已删除该规则）。

### 3.6 转让 owner（决策 §2）

- **触发者**：当前 owner。
- **前置**：目标用户已经是该账本 member。
- **步骤**：`POST /api/v1/ledgers/{id}/transfer-ownership`，体 `{"to_user_id": "..."}` → 事务内把目标成员 `role` 改 `owner`、把自己改 `member` → 200。
- **服务端校验**：非 owner → 403 `not_owner`；目标不是成员 → 404 `member_not_found`；目标就是自己 → 400 `validation_error`。
- **状态变化**：owner 身份原子转移，**任何瞬间都只有一个 owner**。
- **失败分支**：事务回滚，角色不变。

### 3.7 退出账本（决策 §2）

- **触发者**：member。
- **前置**：调用者角色是 `member`；不是自己唯一的账本也没关系（允许退到 0 本账，界面进 §3.1 的引导页）。
- **步骤**：`POST /api/v1/ledgers/{id}/leave`（空体）→ 删除自己的 `ledger_members` 行 → 204（无响应体，见 [`./03-backend-api.md`](./03-backend-api.md) §5.19）。
- **服务端校验**：调用者是 owner → 409 `owner_must_transfer`（决策 §2："owner 必须先转让再退出"）。
- **状态变化**：该账本从他的 `GET /ledgers` 里消失；他此前创建的账户、交易和操作记录**留在账本里**（`created_by` / `actor_id` 仍指向他，界面照旧显示他的 `display_name`，决策 §14.40）。
- **失败分支**：owner 直接退出被拒；界面提示先转让。

### 3.8 移除成员（决策 §2）

- **触发者**：owner。
- **前置**：目标是该账本的 `member`。
- **步骤**：`DELETE /api/v1/ledgers/{id}/members/{user_id}` → 删除对应 `ledger_members` 行 → 204。
- **服务端校验**：非 owner → 403 `not_owner`；目标不存在 → 404 `member_not_found`；目标是自己（即 owner）→ 409 `cannot_remove_owner`。
- **状态变化**：同 §3.7，被移除者的数据留在账本里。
- **失败分支**：无副作用。

### 3.9 删除账本（决策 §2、§14.52 A22）

- **触发者**：owner。
- **前置**：**二次确认要用户手打一遍账本名**，并在确认框里先显示 `GET /ledgers/{id}` 回的 `counts`：将删除多少条交易、多少个账户、多少批导入（决策 §14.52 A22）。
- **步骤**：`DELETE /api/v1/ledgers/{id}` → 一个事务内级联删除 → 204。
- **级联范围**（决策 §2："删除账本（级联删除账户、交易、导入）"）：

| 被删对象 | 说明 |
|---|---|
| `ledger_members` | 该账本所有成员关系 |
| `ledger_invites` | 该账本所有邀请码（含未过期的） |
| `transactions` | 该账本所有交易，含两腿转账两条腿 |
| `transaction_events` | 随交易级联删除（决策 §14.51） |
| `finance_sources` | 该账本所有账户，含已归档的 |
| `import_batches` / `import_rows` | 该账本所有导入批次与草稿行 |
| `ledgers` | 账本本身 |
| **不删** `users` / `exchange_rates` | 它们不属于账本 |

- **服务端校验**：非 owner → 403 `not_owner`；确认串与账本名不一致由前端拦（服务端不接收这个串）。
- **状态变化**：账本及其全部下属数据消失，不可恢复，没有回收站，也没有"导出后再删"（本版本不做导出，决策 §14.52 A1）。
- **失败分支**：事务回滚，什么都不删。

### 3.10 账户的创建 / 编辑 / 归档 / 删除（决策 §3、§14.48、§14.50）

**创建**

- **触发者**：任何成员。
- **步骤**：`POST /ledgers/{id}/sources`，体 `{"name", "type", "default_currency", "opening_balance"}` → 201。
- **校验**：
  - `type ∈ {checking, credit, cash, other}`——**四种，没有 `savings`**（决策 §14.48），否则 422 `validation_error`；
  - `default_currency` 3 位大写；
  - `opening_balance` ≤ 4 位小数。**信用卡的表单填的是"当前欠款"（正数），服务端存成负数**（决策 §14.52 A13）；其余类型按填写的正负原样存。界面文案："期初余额记在账户上，不是一笔交易"（决策 §14.52 B5）。
  - 同账本内 `name` 重复**允许**（决策 §14.40，01-6）：夫妻各有一张"招行储蓄卡"是常态，按 id 区分，只在界面上提示"已有同名账户"，不加唯一约束、不拦保存。
- **状态变化**：账户 `archived=false`、`archived_at=NULL`，`created_by = updated_by =` 调用者。

**编辑**

- **步骤**：`PATCH /ledgers/{id}/sources/{sid}`，体带要改的字段 + **必须带 `updated_at`**（乐观并发，见 §3.16）。
- **可改字段**：`name`、`type`、`opening_balance`、`archived`。
- **`default_currency` 创建后不可改**（决策 §14.50）：传了一个与现值不同的币种 → 400 `currency_locked`，`detail` 提示"账户币种创建后不可更改，请新建账户"。传一个与现值相同的值视为无操作。理由是账户余额、历史折算都以它为计价基准，改它会让所有历史余额无声变脸。
- **注意**：改 `opening_balance` 会立刻改变余额与净资产（§5.4、§5.5）。
- **状态变化**：`updated_by` / `updated_at` 刷新。

**归档 / 取消归档**

- **步骤**：`PATCH .../sources/{sid}` 带 `{"archived": true|false, "updated_at": "..."}`；服务端同时写 `archived_at = now()`（归档）或置 NULL（取消归档）。
- **归档前的提示**（决策 §14.50）：前端在确认框里写明"该账户余额将从净资产中移除"，并显示它当前的余额。
- **归档后的效果**（决策 §3，比现状严格）：
  - 不能再在该账户上创建交易 → `POST /transactions` 返回 409 `source_archived`；
  - 不能作为导入目标账户 → `POST /imports` 返回 409 `source_archived`；
  - 不能作为两腿转账的任一腿、也不能作为配对的对腿 → 409 `source_archived`；
  - 历史交易全部保留，仍参与该账户自己的余额；
  - **但不计入资产 / 负债 / 净资产与首页合计**（决策 §14.50，§5.5）；
  - 账户列表默认不返回，`?include_archived=true` 才返回，界面单列一组并显示 `archived_at`；
  - **归档账户上的历史交易允许 PATCH**（决策 §14.40，01-12）——只禁止新建，否则记错的旧账无法更正。
- 现状对比：现状归档只是软隐藏，归档账户仍可通过 API 记账 (backend/app/api/transactions.py:69-88 没有 `archived` 检查)。

**删除**

- **步骤**：`DELETE /ledgers/{id}/sources/{sid}` → 204。
- **校验**：该账户上存在任何交易（含已归档期间的、含导入产生的）→ **409 `source_has_transactions`**，提示"有交易的账户不能删除，只能归档"（决策 §3）；该账户被任何 `import_batches.source_id` 引用 → 同样拒绝（先删导入批次）。
- **状态变化**：空账户被物理删除。
- 现状对比：现状**根本没有** DELETE 接口。

### 3.11 记一笔支出 / 收入（决策 §1、§1.3）

- **触发者**：任何成员。
- **前置**：账本内至少有一个未归档账户。
- **步骤**：
  1. 前端选 kind（expense / income）、账户、金额（**用户输入正数绝对值**）、币种、日期、一级分类（必选）、二级分类（可选，可选"不细分"）、商户、备注。表单的录入辅助（决策 §14.52 A19）：金额输入框旁的快捷加数与小计算器、最近用过的商户建议、分类按名称**和判据文字**搜索、"保存并再记一笔"、桌面快捷键。
  2. 日期默认"今天"，取**浏览器本地日期**而不是 UTC 日期（决策 §14.32）；`occurred_at` 最晚只能到今天 + 1 天（决策 §14.44，03-13）。
  3. `POST /ledgers/{id}/transactions`，请求体示例（支出）：

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

  4. 201 响应（字段名与 [`./03-backend-api.md`](./03-backend-api.md) §5.28 的交易对象逐字一致：折算三件套叫 `amount_base` / `rate_used` / `rate_date`，退款统计叫 `refunded_total` / `refundable`）：

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
  6. `category_l1` 的收支侧与 kind 匹配（expense 用支出分类，income 用收入分类）→ 否则 400 `category_kind_mismatch`；
  7. `category_l2` 若非空必须属于该一级 → 否则 400 `category_invalid`；
  8. `transfer_role` / `transfer_subtype` / `counterparty` / `refund_of` 必须为空 → 否则 400 `validation_error`；
  9. `currency` 匹配 `^[A-Z]{3}$`；`amount` ≤ 4 位小数；`occurred_at` ≤ 今天 + 1 天。
- **状态变化**：交易入库；追加一条 `created` 事件；该账户余额变化；当月统计变化。前端在保存前用本地月度汇总做一次**统计影响预演**（"本月餐饮 1,240 → 1,282"），纯前端加减，不请求服务端（决策 §14.52 A9）。
- **失败分支**：任一校验失败返回对应错误，无副作用。金额 0 被明确拒绝——现状是接受的 (backend/app/schemas/transaction.py:19-23 没有 `gt` 约束)。

**编辑**：`PATCH /ledgers/{id}/transactions/{tid}`，请求体是部分更新 + `updated_at`。改 `kind` 按 §2.4 的矩阵重新校验。**改 `source_id` 是允许的**（现状 UI 做不到）；每次成功 PATCH 追加一条 `updated` 事件，`changes` 记本次真正变了的字段。

**删除**：`DELETE /ledgers/{id}/transactions/{tid}` → 204。如果这条被别的 `refund` 行指向，那些行的 `refund_of` 被置空（§1.8）；这条交易自己的 `transaction_events` 随之级联删除。

**复制一笔 / 登记退款**（决策 §14.52 A8）：交易详情提供两个快捷入口，都只是**预填表单**，不是新接口——"复制一笔"用同商户同分类、日期改今天打开记一笔表单；"登记退款"打开退款表单并预填 `refund_of` 与原单账户、分类。没有"分享"。

### 3.12 记退款并关联原单（决策 §1.1、§14.52 A20）

- **触发者**：任何成员。
- **前置**：想关联时，账本里存在对应的原支出。
- **步骤**：
  1. 记一笔 kind = `refund`，金额输正数。**退回账户默认与原单同账户**（可改），日期默认今天。
  2. 点"关联原单"→ 打开原单选择器：复用 `GET /ledgers/{id}/transactions`（决策 §14.11，不另建接口），`kind=expense` 是**固定不可移除**的条件（决策 §14.52 B11），同账户预填但可改，时间范围最近 90 天；每条候选显示 `原单金额 / 已退 / 可退`，可勾选"只看还有可退余额的"过滤（决策 §14.52 A20）。**已退完的原单不置灰**，仍可选，只是选中后给超额警告（决策 §14.52 B10）。
  3. 选中后前端把 `refund_of` 填上，并**自动把 `category_l1` / `category_l2` 设为原单的分类**，用户可改；表单给"全额退" / "部分退"两个快捷按钮（决策 §14.52 A20），全额退把金额填成原单的可退余额。
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
  1. 通用校验同 §3.11（符号必须 > 0；`category_l1` 必须是**支出侧**分类）；
  2. `refund_of` 非空时：目标存在、属于同账本、`kind='expense'` → 否则 400 `refund_target_invalid`；
  3. **不校验**金额是否超过原单剩余可退额。
- **部分退款**：同一原单可以被多条 refund 指向，没有条数上限。原单剩余可退额 = `|原单 amount| − Σ 指向它的 refund.amount`（按发生币种各自计算；跨币种时按 §5.3 折算到账本基准币种后比较，仅用于界面提示）。
- **超额退款**：`Σ refund > |原单|` 时，前端在保存前弹一次警告"退款累计已超过原单金额，仍要保存吗？"，用户确认即保存（决策 §1.1）。服务端不拦、不报错。
- **原单被删除后**：退款行的 `refund_of` 自动置空，界面上原来显示的原单链接变成"原单已删除"，退款行本身、它的分类和统计冲减效果都不变。
- **导入之后仍可改**：`PATCH /transactions/{tid}` 改 `refund_of`（含置 `null` 解除），各追加一条 `refund_linked` / `refund_unlinked` 事件（决策 §14.34、§14.51）。
- **状态变化**：退款月份该分类的支出减少（§5.1）；账户余额增加；追加 `created` + `refund_linked` 两条事件。
- **失败分支**：关联失败（原单被别人同时删了）→ 400 `refund_target_invalid`，前端提示重新选择或不关联直接保存。

### 3.13 两腿转账的创建 / 编辑 / 删除（决策 §1.2、§14.52 A11）

**创建**

- **触发者**：任何成员。
- **前置**：账本内至少两个未归档账户。
- **表单三条规则**（决策 §14.52 A11）：
  1. `subtype='repayment'`（信用卡还款）时，**转入账户只能选 `type='credit'` 的账户**（服务端把关：否则 400 `repayment_target_not_credit`）；
  2. 单腿转账的币种**固定等于该账户的 `default_currency`**，不给币种选择器；
  3. 两腿币种相同时**只填一个金额**，前端把它同时作为 `amount_out` 和 `amount_in`；币种不同时才出现两个金额框和一个只读汇率 chip（决策 §14.52 A10）。
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

  201 响应返回共用的 `pair_id` 和两条完整交易；**顶层的 `occurred_at` / `subtype` / `note` 取 `out` 腿的值**（这个接口建的两腿本来就一致，配对出来的一对则可能两腿日期不同，见 §1.9、§3.15 B）：

```json
{
  "pair_id": "77c1e0a2-9d3b-4f55-8a10-0b1c2d3e4f50",
  "occurred_at": "2026-05-08",
  "subtype": "plain",
  "note": "把美元换成人民币",
  "out": {"id": "…", "kind": "transfer", "transfer_role": "out", "transfer_subtype": "plain",
          "source_id": "aaaa1111-0000-4000-8000-000000000001", "amount": "-100.0000", "currency": "USD",
          "occurred_at": "2026-05-08", "category_l1": null, "category_l2": null, "counterparty": null,
          "merchant": null, "transfer_pair_id": "77c1e0a2-9d3b-4f55-8a10-0b1c2d3e4f50"},
  "in":  {"id": "…", "kind": "transfer", "transfer_role": "in", "transfer_subtype": "plain",
          "source_id": "bbbb2222-0000-4000-8000-000000000002", "amount": "715.0000", "currency": "CNY",
          "occurred_at": "2026-05-08", "category_l1": null, "category_l2": null, "counterparty": null,
          "merchant": null, "transfer_pair_id": "77c1e0a2-9d3b-4f55-8a10-0b1c2d3e4f50"}
}
```

- **服务端校验**：
  1. `from_source_id` / `to_source_id` 都存在、属于本账本、都未归档 → 否则 404 `not_found` / 409 `source_archived`；
  2. 两个账户**必须不同** → 否则 400 `same_source`；
  3. `amount_out` / `amount_in` 都 > 0（服务端把转出腿存成负数）→ 否则 400 `validation_error`；
  4. `subtype ∈ {plain, repayment}`；`subtype='repayment'` 时转入账户 `type` 必须是 `credit` → 否则 400 `repayment_target_not_credit`（决策 §14.52 A11）；
  5. 请求体里不允许出现 `category_l1` / `category_l2` / `counterparty` / `merchant` → 400 `validation_error`；
  6. **不要求**两腿金额相等，也**不要求**币种相同（跨币种转账，决策 §1.2）。
- **状态变化**：两行同时入库、共享 pair id，各追加一条 `created` 事件；两个账户余额同时变化；统计不变（转账不计入）。
- **失败分支**：整个事务回滚，绝不会留下"半条转账"。这正是现状的 HALF-CREATED / ORPHAN LEG 状态在 v3.0 被消灭的地方。
- **手续费**：不塞进转账，另记一笔 `expense`，分类 `other` / `fees`（决策 §1.2、§14.33）。

**编辑**

- `PATCH /ledgers/{id}/transactions/transfer/{pair_id}`，体是创建体的部分更新（同样扁平）：`from_source_id`、`to_source_id`、`amount_out`、`currency_out`、`amount_in`、`currency_in`、`occurred_at`、`subtype`、`note` 都可选，外加必填的 `updated_at`（取两腿中较新的那个）。`pair_id` 本身、`kind`、`transfer_role` 都不可改（[`./03-backend-api.md`](./03-backend-api.md) §5.34）。
- `occurred_at` / `subtype` / `note` 是**两腿共有**的字段：传了就**同时写到两腿**（写完两腿必然一致，决策 §14.53a）；`from_source_id` / `amount_out` / `currency_out` 只落在 out 腿，`to_source_id` / `amount_in` / `currency_in` 只落在 in 腿。
- **两腿的 `updated_at` 都要比对**（决策 §14.40，01-11）：服务端 `SELECT ... FOR UPDATE` 取两条腿，任一条的 `updated_at` 比请求里带的更新 → 409 `stale_update`。
- 校验同创建；两腿在一个事务里一起改，两腿的 `updated_at` 一起刷新，各追加一条 `updated` 事件。
- 对单条腿调 `PATCH /transactions/{tid}` → 409 `use_transfer_endpoint`。

**删除**

- `DELETE /ledgers/{id}/transactions/transfer/{pair_id}` → 204，一条语句删掉该 pair 的**全部**行，事件随之级联删除。
- 对单条腿调 `DELETE /transactions/{tid}` → 409 `use_transfer_endpoint`。

### 3.14 单腿转账（决策 §1.2）

- **触发者**：任何成员。
- **场景**：对手账户不在应用里——老婆给我转账、我给别人转账、用没录入的工资卡还信用卡。
- **前置**：目标账户未归档。
- **步骤**：走**普通交易接口** `POST /ledgers/{id}/transactions`；币种不给选，固定等于账户的 `default_currency`（决策 §14.52 A11）：

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
  2. `transfer_subtype` 必填；**`transfer_role='in'` 且 `transfer_subtype='repayment'` 时该账户 `type` 必须是 `credit`**（收到还款的那一端是自己的信用卡）→ 否则 400 `repayment_target_not_credit`；**`transfer_role='out'` 的 repayment 腿不限账户类型**——用应用里的储蓄卡去还一张没录进应用的信用卡，出账腿就落在 `checking` 上，这正是单腿转账要覆盖的场景（决策 §14.52 A11 只约束转入账户；§3.15 A 的自动配对、§3.15 C 拆开两腿后留下的 out 腿都依赖这一点，见 §5.7.3 的算例）；
  3. `category_l1` / `category_l2` / `merchant` 必须为空 → 否则 400 `validation_error`；
  4. `transfer_pair_id` 不接受客户端传入（服务端只在两腿接口和配对接口里生成）→ 传了就 400 `validation_error`；
  5. `counterparty` 可空、≤100 字。
- **状态变化**：账户余额变化；**收支统计不变**（决策 §1.2："单腿转账计入账户余额，不计入收入/支出统计"）；追加 `created` 事件。
- **失败分支**：无副作用。
- **重要的默认逻辑**：别人转钱进来时，表单和导入都**默认建议 `income`**（`social_income` / `transfer_in`），只有用户主动切到"转账"才记单腿 transfer——否则真正的收入会悄悄从统计里消失（决策 §1.2、§14.36）。界面要在切换时明确提示这一点。

### 3.15 转账配对与拆开（决策 §14.34）

两条方向相反的单腿转账，其实是同一笔钱的两端——例如从储蓄卡导入了一条 `out`、又从信用卡导入了一条 `in`。**它们可以被配对成一笔两腿转账，也可以随时拆回两条单腿**。这取代了上一版的"单腿 ⇄ 两腿不能互转，只能删了重记"。

配对有两个入口，规则完全一致：

| 入口 | 时机 | 谁挑的对腿 |
|---|---|---|
| 导入 review 的 `transfer_candidate` | 提交批次时（§3.17） | 服务端自动找到唯一候选并**默认勾选**，用户可改选或取消 |
| 交易详情页的"关联为转账对腿" | 任何时候 | 用户自己从候选列表里选一条 |

**A. 自动建议（导入 review 阶段）**

服务端在校验通过、写完草稿行之后，为每一条 `kind='transfer'` 的行（`plain` 和 `repayment` 都算）在**其他账户**上找符合下面全部条件的交易：

1. 同账本、`kind='transfer'`；
2. `occurred_at` 在该行日期的 **±3 天**内；
3. **同币种、同金额绝对值**；
4. `transfer_role` **相反**；
5. **仍是单腿**（`transfer_pair_id IS NULL`）；
6. 所在账户未归档。

**`transfer_subtype` 不是筛选条件**（决策 §14.53a）：同一笔还款在储蓄卡账单里常写成 `plain`、在信用卡账单里写成 `repayment`，按子类型筛会让这类配对永远触发不了。两腿的子类型在**配对时统一**（§1.9），不在这里卡。

结果处理（决策 §14.34）：

| 候选数 | 处理 |
|---|---|
| 恰好 1 条 | 该行打 `transfer_candidate`，`matched_transaction_id` 预填这条，`counterpart_source_id` 预填它所在的账户；review 表格里"关联为一笔转账"**默认勾选** |
| 多条 | 打 `transfer_candidate` + `needs_review`，**不预填**（`matched_transaction_id` / `counterpart_source_id` 都留空），`hint` 写"找到 N 条可以配对的转账，请选一条"；用户在 review 里点"选一条"，界面**复用交易列表接口**筛出候选（`kind=transfer`、单腿、方向相反、其他账户、±3 天、同币种同金额）挑一条写回 `matched_transaction_id`。**候选列表不落库、不单独建接口，也不新增任何字段**——`matched_transaction_id` 是唯一载体（决策 §14.53b） |
| 0 条，且对方账户上已存在一条**已经是两腿一半**的同额反向转账 | 该行打 `duplicate`，提示"这笔可能已经从对方账户那边记过了"，默认建议跳过 |
| 其它 0 条情形 | 不打标记；**不猜对手账户**——`counterpart_source_id` 留空（决策 §14.53c）。用户在 review 里有三条路：填 `counterparty` 文本或什么都不填（提交时按**单腿**建）、或显式选一个对手账户填进 `counterpart_source_id`（提交时按**两腿**建，对手账户必须是本账本的未归档账户） |

提交批次时（§3.17 第 7 步），凡是勾选了配对的行：服务端生成一个**新的** `transfer_pair_id`，把**新建的这条**和 `matched_transaction_id` 指向的**已有那条**一起挂上去，把已有那条的 `counterparty` **清空**（CHECK 要求有对腿就不能有对方文本），并按 §1.9 **统一两腿的 `transfer_subtype`**（决策 §14.53a）。两条各追加一条 `paired` 事件，**两腿再各追加一条 `updated` 事件**（`changes` 记 `transfer_subtype` 的前后值；值未变的那腿 before == after，决策 §14.53a）。

**B. 详情页手动配对**

- **步骤**：`POST /ledgers/{id}/transactions/{tid}/pair`，体 `{"counterpart_transaction_id": "...", "updated_at": "..."}`（`updated_at` 是本行的，用于乐观并发）。
- **服务端校验**（顺序）：
  1. 两条都存在、属于本账本 → 否则 404 `not_found`；
  2. 两条 `kind` 都是 `transfer` → 否则 400 `pair_invalid`；
  3. 两条都**仍是单腿**（都没有 `transfer_pair_id`）→ 已有 `transfer_pair_id` 的那条要先拆开再配，否则 400 `pair_invalid`；
  4. 两条 `transfer_role` 相反 → 否则 400 `pair_invalid`；
  5. 两条在**不同账户**上 → 否则 400 `same_source`；
  6. 两个账户都未归档 → 否则 409 `source_archived`；
  7. 本行 `updated_at` 匹配 → 否则 409 `stale_update`。
- **不校验**的：金额是否相等、币种是否相同、**日期是否相同或接近**、**两腿的 `transfer_subtype` 是否相同**。跨币种、金额不等本来就是合法的两腿转账（决策 §1.2）；±3 天同额只是**自动建议**的筛选条件，不是配对的硬约束——用户手动挑的就按用户的来；子类型不同不拦，配对时由服务端统一（决策 §14.53a）。
- **两腿日期允许不同**（配对路径独有的情形）：两腿转账对象顶层的 `occurred_at` / `subtype` / `note` **取 `out` 腿的值**——`GET`、`PATCH`、列表合并显示都按这条渲染（§1.9、§3.13）；`PATCH .../transfer/{pair_id}` 传 `occurred_at` / `subtype` / `note` 时**同时写到两腿**。`subtype` 在配对的那个事务里已经被统一（决策 §14.53a），所以配对之后两腿任何时刻都相同。
- **服务端动作**（一个事务）：生成新的 `transfer_pair_id` 写到两条上；**统一 `transfer_subtype`**——任一腿是 `repayment` 且 `transfer_role='in'` 的那条所在账户 `type = 'credit'` → 两腿都写 `repayment`，否则两腿都写 `plain`（决策 §14.53a）；两条的 `counterparty` 都置 NULL；两条 `updated_at` / `updated_by` 刷新；各追加一条 `paired` 事件，`changes` 记 `transfer_pair_id` 和 `counterparty` 的前后值；**两腿再各追加一条 `updated` 事件**，`changes` 记 `transfer_subtype` 的前后值（值未变的那腿 before == after，决策 §14.53a）。
- **失败分支**：任一校验失败整个事务回滚，两条都不动。`pair_invalid` 的 `detail` 说明是哪一条没过，界面把它翻成人话："这笔已经和另一笔配对了""两笔方向相同，配不成一进一出""不能和同一个账户上的转账配对"。
- **候选列表怎么来**：复用 `GET /ledgers/{id}/transactions`，筛 `kind=transfer`、排除本账户、由前端过滤掉已配对的行——**不另建接口、候选列表不落库**（决策 §14.53b，与 §14.11 对退款候选的处理同一做法）。导入 review 里"多候选"让用户挑一条走的是同一套筛选（§3.15 A）。

**C. 拆开**

- **步骤**：`POST /ledgers/{id}/transactions/transfer/{pair_id}/unpair`，体 `{"updated_at": "..."}`（两腿中较新的那个）。
- **服务端校验**：pair 存在且属于本账本 → 否则 404 `not_found`；两腿 `updated_at` 都要比对 → 否则 409 `stale_update`。对一条**单腿**转账调这个端点没有 `pair_id` 可传，路径本身就匹配不到 → 404 `not_found`。
- **服务端动作**（一个事务）：两腿 `transfer_pair_id` 置 NULL，各自变回单腿；`counterparty` 保持 NULL（用户可以随后各自填上"老婆""工资卡"）；两腿 `updated_at` / `updated_by` 刷新；各追加一条 `unpaired` 事件。
- **状态变化**：交易条数不变（还是两条），余额不变，统计不变——变的只是这两条之间的关系。
- **失败分支**：事务回滚，两腿仍是一对。

**两种关联都可以反复改**：退款的 `refund_of` 和转账的 `transfer_pair_id`，在导入之后都能在交易页修改或解除，review 里的自动建议**只是预填**（决策 §14.34）。

### 3.16 乐观并发冲突（409 `stale_update`）（决策 §2）

- **触发者**：任意成员，多人同时改同一条记录时发生。
- **适用对象**：`transactions`、`finance_sources`、`ledgers` 的 PATCH（三张表都带 `updated_at`），以及 §3.15 的 pair / unpair。
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
- **两腿转账**：PATCH 和 unpair 都**同时比对两条腿的 `updated_at`**（决策 §14.40，01-11），任一条更新过就 409。
- **状态变化**：冲突时数据库完全不动。
- **失败分支 / 前端处理**：收到 409 就 invalidate 该资源的查询缓存、重新拉取、提示用户"这条已被 XX 改过，已刷新为最新版本，请确认后重试"。列表在窗口重新聚焦时也会自动刷新（决策 §2）。
- **不做**：实时同步、WebSocket、操作合并（决策 §14.37）。
- **`POST .../imports/{bid}/commit` 不做乐观锁**（决策 §14.18）：它没有请求体，重复提交靠 409 `batch_already_committed` 保护。

### 3.17 账单导入全流程（决策 §5、§6、§14.25、§14.47）

本节只写**状态与业务规则**；标准 CSV 的列定义、skill 文本、逐条校验规则与自动标记算法见 [`./05-import-and-llm.md`](./05-import-and-llm.md)。

**这条流水线里没有任何大模型调用**（决策 §14.25）。读账单这一步发生在**用户自己的 ChatGPT / Claude 里**：用户安装我们发布的 skill（`skills/wallet-import/`），把 PDF / 图片 / Excel / CSV 账单丢给聊天工具，让它输出一份**标准导入 CSV**；应用只负责校验、review、入账。

**前置**：目标账户未归档；该用户本小时导入次数 < 10（决策 §9）。**没有**"要先配好模型"这一条，也**没有**"同账本同时只能有一个批次在解析"这一条——校验是同步的，秒级完成。

**步骤**

1. **导入指南页**（决策 §6）：三步说明（安装 skill → 在你的 ChatGPT / Claude 里上传账单让它整理 → 把生成的 CSV 上传到这里），附 skill 文本的复制 / 下载按钮和标准 CSV 示例文件，数据来自公开接口 `GET /api/v1/import-format`（带 `version`）。**上传前不显示"你的 skill 版本"**（应用无从知道用户装的是哪一版，决策 §14.52 A18）。

2. **上传或粘贴**：`POST /ledgers/{id}/imports`，两种形态走**同一套校验**（决策 §5）：
   - multipart：`file`（CSV 文件） + `source_id`；
   - JSON 体：`{"source_id": "...", "text": "date,amount,..."}`（在应用内的文本框里粘贴 CSV 文本）。

   请求级校验：文本 ≤ 2 MB → 否则 413 `file_too_large`；上传的必须是**纯文本 CSV**——判定不看扩展名也不看 `Content-Type`，而是按 UTF-8（可带 BOM）解码，解不开（PDF、图片、xlsx 这类二进制）一律 400 `import_format_invalid`（**只接受 CSV**，决策 §14.47、§14.53d）；`source_id` 存在且未归档 → 404 `not_found` / 409 `source_archived`；超过每小时 10 批 → 429 `import_rate_limited`。

3. **同步校验**（服务端当场做完，秒级，决策 §5）。分三层，**顺序是解码 → 结构 → 版本 → 行级**，前一层不过就不进下一层（决策 §14.53d）：

   **第一层：解码与结构**。先按 **UTF-8（可带 BOM）解码**：解不开就是 400 `import_format_invalid`，**到此为止、不再做版本检查**——连字符串都拿不到，无从判断有没有版本行（决策 §14.53d）。解得开再看结构，下面三种都是**结构错误** → **400 `import_format_invalid`**，按**文件物理行号**返回全部错误，**不建批次**（决策 §5、§14.52 B2、§14.53d）：

   - **缺 `# version:` 行**（首行不是 `# version: ` 开头）——这是结构错，不是版本错；
   - 表头（第 2 行）与 11 列固定表头不符；
   - 某一行列数不对。

   数据行超过 2000 → 400 `rows_exceed_limit`（决策 §5、§14.53d）。界面在失败态提供"复制错误清单"按钮（决策 §14.52 A18）。

   ```json
   {
     "detail": "文件结构有问题，共 2 处",
     "code": "import_format_invalid",
     "errors": [
       {"line": 2, "message": "表头应为 date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref，实际缺少 source_ref"},
       {"line": 38, "message": "这一行有 10 列，应为 11 列"}
     ]
   }
   ```

   `line` 是文件里的物理行号（1 起：`# version:` 行是第 1 行、表头是第 2 行），响应体形状以 [`./03-backend-api.md`](./03-backend-api.md) §5.37 为准（决策 §14.53f）。

   **第二层：版本**。走到这一层，`# version: YYYY-MM-DD` 行一定**存在**（缺行已在第一层被判成结构错）。它与应用当前 `CATEGORY_VERSION` **不一致** → 整批 **400 `skill_outdated`**，错误体里带应用当前版本和"导入指南"链接，提示用户更新 skill 后重传（决策 §14.30、§14.53d；这是硬校验，不允许带警告继续）。**不建批次。**

   ```json
   {
     "detail": "你的导入 skill 是 2026-08-01 版，应用当前分类表是 2026-09-10 版，请更新 skill 后重新生成文件",
     "code": "skill_outdated",
     "current_version": "2026-09-10",
     "file_version": "2026-08-01",
     "guide_url": "/import/guide"
   }
   ```

   两者的修法完全不同，所以必须分开：结构错（含缺版本行）是"让你的 ChatGPT / Claude 按格式重新导出一份"，`skill_outdated` 是"去导入指南页把 skill 重装一次"（决策 §14.53d）。

   **第三层：行级**。**不丢行、只打标记**（决策 §5、§14.52 B2）——kind 认不出、分类不对、日期格式错都属于这一层，绝不整份退回：

   | 情况 | 处理 | 标记 |
   |---|---|---|
   | `date` 不是 `YYYY-MM-DD` | 置 NULL | `needs_review` |
   | `amount` 非数字或为 0 | 置 NULL | `needs_review` |
   | `currency` 不是三位字母 | 改成目标账户的 `default_currency` | `needs_review` |
   | `kind` 不在四种之内 | 按金额符号推断（负 → `expense`，正 → `income`） | `needs_review` |
   | 分类 code 不在表内 / 二级不属于一级 / 收支侧与 kind 不符 | 对应字段置空（待归类） | **无标记**——review 的"待归类"筛选按 `category_l1` 为空捞它，提交时缺一级分类会被 409 `rows_uncategorized` 挡住 |

   每一处改动都写进该行的 `hint`（如"币种 XX 无效，已改为账户币种"），**不另存原始值**（决策 §5、§14.28）。

4. **建批次并同步返回**：校验通过 → 建 `import_batches`（`status='ready'`、`skill_version` 记下文件版本、`source` 记 `csv` / `paste`）+ 全部 `import_rows`，**同一个响应里直接返回批次和全部草稿行**（201）。没有 202、没有轮询、没有进度、没有后台任务。行数 0 也算成功，review 表显示"没解析出任何行"。

5. **自动标记**（决策 §5、§14.31、§14.34）：写完草稿行后，服务端打**四种、且只有四种**标记：

   | 标记 | 判定 |
   |---|---|
   | `duplicate` | 同账户、同日、同金额的交易已存在；或转账行的对腿已经是别的两腿转账的一半（§3.15 A） |
   | `refund_candidate` | 按 §1.8 规则（金额 + 时间窗 + 同账户为主，商户只作加分）找到**唯一**候选原单，预填 `matched_transaction_id` |
   | `transfer_candidate` | 按 §3.15 A 找到可配对的单腿转账：唯一候选预填 `matched_transaction_id` + `counterpart_source_id`；多候选**不预填**，另打 `needs_review` 并把"找到 N 条可以配对的转账，请选一条"写进 `hint`（决策 §14.53b）；没找到对腿不猜对手账户（决策 §14.53c） |
   | `needs_review` | 第三层校验改过这一行的 `date` / `amount` / `currency` / `kind` 之一；或**同一批内有完全相同的行**。**分类被置空不打这个标记**（它由"待归类"筛选和提交前置校验兜底） |

   **同一批内完全相同的行不合并**（决策 §14.31）：都保留、都打 `needs_review`，`hint` 写"本批内有相同的行（第 N 行）"，由用户在 review 里取舍。没有第五种"已合并"标记。

6. **Review**：只有 `ready` 才能读写草稿行。
   - `GET .../rows` 列出草稿行（`limit` 上限 500）。
   - `PATCH .../rows/{rid}` 改单行，可改：`date`、`amount`、`currency`、`kind`、`merchant`、`note`、`category_l1`、`category_l2`、`transfer_role`、`transfer_subtype`、`counterparty`、`matched_transaction_id`（退款原单 / 转账对腿，也可置 `null` 取消建议）、`counterpart_source_id`（转账对手账户，**必须是本账本的未归档账户**——不存在或不属于本账本 → 404 `not_found`，已归档 → 409 `source_archived`，决策 §14.53c），以及把 `status` 改成 `skipped`。**普通行不能改账户**——整批只有一个目标账户（决策 §14.52 A5）；只有转账行能改对手账户。
   - `PATCH .../imports/{bid}/rows` **批量**改：体是行 id 数组 + 同一份改动，用于"批量设分类""批量跳过"（决策 §14.52 A4）。
   - review 表格内置筛选：**全部 / 待归类 / 有标记**（决策 §14.52 A4）。"待归类"= 非 transfer 行且 `category_l1` 为空；"有标记"= `flags` 非空。两者**互不排斥**，同一行可能同时出现在两个筛选里。
   - 任何一次 PATCH 把该行 `status` 从 `pending` 变成 `edited`（除非用户显式设成 `skipped`）。**没有"确认这行"动作，也没有"就绪"计数**（决策 §14.7、§14.52 B13）。
   - 非 `ready` 状态下 PATCH → 409 `batch_not_ready`。

7. **提交**：`POST .../imports/{bid}/commit`，**无请求体**（决策 §14.18）。
   - **提交前置校验**：所有 `status != 'skipped'` 的行都必须有合法的 `occurred_at`、`amount`、`kind`，并且非 transfer 行必须有 `category_l1` → 缺日期 / 金额 / kind 的返回 409 `batch_not_ready`，缺一级分类的返回 **409 `rows_uncategorized`**，`detail` 里带出问题的 `row_no` 列表（决策 §5）。
   - **一个数据库事务内**建所有交易：每条 `import_batch_id = batch_id`、`created_by = updated_by =` 提交人、`source_id` = 批次的目标账户；每条 `import_rows.transaction_id` 回填；每条新交易追加一条 `imported` 事件（决策 §14.51）。
   - **退款**：行 `kind='refund'` 且 `matched_transaction_id` 非空（不论是服务端预填还是用户改选）→ 写入 `refund_of`；不引入"用户已确认"这类额外状态（决策 §14.7）。
   - **转账配对**：`matched_transaction_id` 非空的转账行按 §3.15 A 处理——生成新 `transfer_pair_id` 挂上新旧两条、清空已有那条的 `counterparty`、按 §1.9 **统一两腿的 `transfer_subtype`**（决策 §14.53a）、各追加 `paired` 事件（**两腿再各追加一条 `updated` 事件**，`changes` 记 `transfer_subtype` 的前后值；值未变的那腿 before == after）。`matched_transaction_id` 为空但 `counterpart_source_id` 非空的行**一次建两腿**（对手账户上那腿金额取反）。两个都为空的行按**单腿**建，`counterparty` 取草稿行上的值。
   - 成功 → 批次 `status='committed'`，`committed_at` / `committed_transaction_count` 写入，返回建了多少条。
   - 任一行建失败 → 整批回滚，批次留在 `ready`，返回 400 + 出错行号。
   - 非 `ready` 状态提交 → 409 `batch_not_ready`；已经是 `committed` 的批次重复提交 → 409 `batch_already_committed`（幂等保护，决策 §14.18）。

8. **丢弃 / 撤销**：`DELETE /ledgers/{id}/imports/{bid}`，行为取决于状态（决策 §11、§14.22）：
   - `ready` → **丢弃**：删批次和草稿行，不影响任何交易。
   - `committed` → **撤销**：删除 `transactions` 里所有 `import_batch_id = bid` 的行（含配对时一起建的腿），交易的 `transaction_events` 随之级联删除，再删批次和草稿行。**不限时限。**
   - **删除就是删除**：不保留已撤销的批次，没有 `reverted` 状态、没有"撤销原因"（决策 §14.22、§14.52 B1）。
   - 撤销**返回删除条数**（其余删除类端点统一 204，这一个是例外，决策 §14.43，03-6）。
   - 撤销时如果某条被导入的交易已被别的 `refund` 行指向，那些 refund 行的 `refund_of` 按 §1.8 置空。
   - **成员也能撤销**，不是 owner 独占（决策 §14.52 B9）。

   **撤销前的 `dry_run`**（决策 §14.43 03-9、§14.52 B24）：`DELETE .../imports/{bid}?dry_run=true` 不删任何东西，返回将要删除的交易数**和两个方向分开措辞的退款计数**：

   | 字段 | 含义 | 界面措辞 |
   |---|---|---|
   | `orphaned_refunds` | **批外**的退款行指向了本批的支出，撤销后它们会失去原单 | "有 N 笔（本批之外的）退款将失去原单" |
   | `refunds_in_batch` | **批内**的退款行，删掉后它们指向的原支出恢复可退额度 | "本批含 N 笔退款，删除后对应支出的可退额度将恢复" |

**没有的东西**（随决策 §14.25 一并删除）：`uploaded` / `parsing` / `failed` 三个状态、进度百分比、轮询、`POST .../retry` 重试端点、页面缩略图与取图接口、服务重启时把批次标失败的启动钩子、上传目录。校验错误是同步 400，用户改完文件重传即可。

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
      |     |                          |     |          | 形态可互转      |
      |     v                          |     v          | （见 §4.2）     |
      |  +----------------------------------+           |                 |
      +--|            REFUND                |           |                 |
         |          amount>0                |           |                 |
         |          支出分类                |           |                 |
         |   refund_of -> 某条 EXPENSE(可空)|           |                 |
         +----------------------------------+           |                 |
                                                        |                 |
   PATCH /transactions/{tid}                            |                 |   （两腿）PATCH/DELETE /transactions/{tid}
   （改金额/日期/账户/分类/备注/kind）                  |                 |   -> 409 use_transfer_endpoint
   每次成功追加一条 updated 事件                        |                 |
                                                        |                 |   只能走
   ==========  非 transfer <-/-> transfer  ==========   |                 |   PATCH/DELETE .../transfer/{pair_id}
   任何方向都 400 kind_change_not_allowed               |                 |   （两腿一起，事务内）
   （要改只能删了重记）                                 |                 |
                                                        |                 |
        |                                               |                 |
        | DELETE /transactions/{tid}                    | DELETE（同左）  | DELETE .../transfer/{pair_id}
        v                                               v                 v
   +---------------------------------------------------------------------------+
   |                                 DELETED                                   |
   |  指向它的 refund 行 refund_of -> NULL（ON DELETE SET NULL）               |
   |  它自己的 transaction_events 随之级联删除                                 |
   |  之后 GET / PATCH / DELETE 一律 404 not_found                             |
   +---------------------------------------------------------------------------+
```

### 4.2 转账形态：单腿 ⇄ 两腿（决策 §14.34）

`kind` 全程都是 `transfer`，变的只是 `transfer_pair_id` 有没有值。

```
      POST /ledgers/{id}/transactions            POST /ledgers/{id}/transactions/transfer
      （kind=transfer，单条）                    （一个请求建两行，事务内生成 pair_id）
                  |                                              |
                  v                                              v
      +-------------------------+                    +---------------------------+
      |      单腿 transfer      |                    |       两腿 transfer       |
      |  transfer_pair_id NULL  |                    |  transfer_pair_id 非空    |
      |  counterparty 可填文本  |                    |  counterparty 必须 NULL   |
      |  余额计入、统计不计入   |                    |  余额各自计入、统计不计入 |
      +-------------------------+                    +---------------------------+
             |         ^                                    |          ^
             |         |                                    |          |
             |         | POST .../transfer/{pair_id}/unpair |          |
             |         +------------------------------------+          |
             |             两腿 pair_id 置 NULL                        |
             |             各追加一条 unpaired 事件                    |
             |                                                         |
             |  POST .../transactions/{tid}/pair                       |
             |  body: {counterpart_transaction_id, updated_at}         |
             +---------------------------------------------------------+
                两条方向相反、仍为单腿、不同账户、账户未归档（子类型不作要求）
                -> 生成新 pair_id 写到两条上，counterparty 一起清空
                -> 统一 transfer_subtype：任一腿 repayment 且转入腿账户是 credit
                   -> 整对 repayment，否则整对 plain（决策 §14.53a）
                -> 各追加一条 paired 事件；两腿再各追加一条 updated 事件
                   （changes 记 transfer_subtype 前后值，值未变的那腿 before == after）

   配对的失败分支（事务回滚，两条都不动）：
     对方或本行已有 transfer_pair_id        -> 400 pair_invalid
     对方不是转账 / 方向相同                -> 400 pair_invalid
     两条在同一个账户上                     -> 400 same_source
     任一账户已归档                         -> 409 source_archived
     updated_at 对不上                      -> 409 stale_update
     对方不在本账本 / 不存在                -> 404 not_found

   导入 review 里的自动建议（transfer_candidate）只是"预填 + 默认勾选"，
   提交时才真正生成 pair_id；不勾就按单腿建。多候选不预填，只打
   needs_review + hint，由用户在 review 里挑一条（决策 §14.53b）。

   注意：配对**不要求**两腿金额相等、币种相同或 transfer_subtype 相同
        （跨币种转账是设计特性；子类型在配对时由服务端统一，§1.9 / §3.15 B）；
        ±3 天 / 同额 / 同币种只是自动建议的筛选条件，手动配对不受此限。
```

### 4.3 导入批次（决策 §5、§14.22、§14.25）

**只有两个状态**。校验是同步的：不通过就 400，压根不建批次。

```
   POST /ledgers/{id}/imports   （multipart CSV 文件，或 JSON 体 {source_id, text}）
              |
              |  同步校验（秒级，无后台任务、无进度、无轮询）
              |
      +-------+------------------------------------------------------------+
      |                                                                    |
      | 编码不可读 / 表头不符 / 列数不对     -> 400 import_format_invalid  |
      | 缺 # version: 行（属结构错）         -> 400 import_format_invalid  |
      | 版本行存在但与当前版本不一致         -> 400 skill_outdated         |
      | 数据行 > 2000                        -> 400 rows_exceed_limit      |
      | 文本 > 2 MB                          -> 413 file_too_large         |
      | 目标账户已归档                       -> 409 source_archived        |
      | 每小时 > 10 批                       -> 429 import_rate_limited    |
      |                                                                    |
      | 以上任何一种：**不建批次**，没有任何行落库                         |
      +--------------------------------------------------------------------+
              |
              | 校验通过（行级问题只打标记，不丢行）
              v
      +---------------------------+                +-------------------+
      |          ready            | POST .../commit|    committed      |
      |  201 同步返回批次 + 全部  |--------------->|  交易已建，带     |
      |  草稿行；可读写、可提交   |                |  import_batch_id  |
      +---------------------------+                +-------------------+
          |    ^                                   |
          |    | PATCH .../rows/{rid}              |
          |    | PATCH .../rows（批量设分类/跳过） |
          |    +------------------------------+    |
          |    （自环：pending -> edited/skipped） |
          |                                        |
          | DELETE（丢弃：删批次和草稿行，         | DELETE（撤销：删掉这批建的
          |          不碰任何交易）                |          所有交易 + 事件，
          v                                        v          不限时限，返回条数）
      +--------------------------------------------------------------------+
      |                              GONE                                  |
      | import_rows 随 batch 级联删除；不保留已撤销的批次、无撤销原因      |
      +--------------------------------------------------------------------+

   commit 前置未过（缺日期/金额/kind）       -> 409 batch_not_ready，留在 ready
   commit 前置未过（有行没有一级分类）       -> 409 rows_uncategorized，留在 ready
   已 committed 再 commit                    -> 409 batch_already_committed
   已 committed 再 PATCH 草稿行              -> 409 batch_not_ready
   DELETE ?dry_run=true                      -> 不删，返回交易数 +
                                                orphaned_refunds / refunds_in_batch 两个计数
```

### 4.4 账本成员关系（决策 §2）

```
                          +------------------+
                          |   非成员         |
                          | （看不到该账本） |
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
      | 唯一，1 本 1 个|<-------------------------------| 记账/改账/导入 |
      | 全部权限       |   （原 owner 降为 member，     | 撤销导入/管账户|
      +----------------+     同一事务内原子完成）       | 可自行退出     |
              |                                        +----------------+
              | POST .../leave -> 409 owner_must_transfer      |
              |                                                |
              | DELETE /ledgers/{id}（owner 删账本，先手打账本名确认）
              v                                                v
      +-----------------------------------------------------------------+
      |  账本 GONE：成员关系、邀请码、账户、交易、操作记录、导入批次     |
      |  全部级联删除，不可恢复                                          |
      +-----------------------------------------------------------------+
```

### 4.5 邀请码生命周期（决策 §2、§14.29、§14.35）

**表里永远只有有效的码**：用掉即删、过期即删、作废即删。没有 USED / EXPIRED / REVOKED 这些留在表里的状态。

```
   POST /ledgers/{id}/invites   （owner；成员数 < 10）
              |
              |  同一事务：先删该账本所有 expires_at <= now() 的行，
              |            再摇一个与"当前有效的码"不重复的 6 位数字
              v
      +-------------------------------+
      |            有效               |  表里存在这一行，且 now < expires_at
      |  code = 6 位数字（无唯一索引）|  同一账本可以同时有多个有效码
      |  expires_at = now + 10 min    |
      +-------------------------------+
          |                |                     |
          |                |                     | DELETE /ledgers/{id}/invites/{code}
          |                | 时间到              | （owner 主动作废）
          |                | now >= expires_at   |
          |                |                     |
          | POST /ledgers/join 且校验全过        |
          | （事务内：写 ledger_members          |
          |   + 删除这一行）                      |
          v                v                     v
   +--------------------------------------------------------------+
   |                            GONE                              |
   |  行已从 ledger_invites 删除；同一个码再提交 -> 400 invite_invalid |
   |  过期的行在下次"生成"或"校验"时被顺手删掉，不做定时清理       |
   +--------------------------------------------------------------+

   码不存在 / 已用掉 / 已过期        -> 400 invite_invalid（对调用方是同一个结果）
   已是该账本成员                    -> 409 already_member（不消耗码）
   成员数已满 / 账本数已满           -> 409 member_limit_reached / ledger_limit_reached（不消耗码）
   端点整体超过 1 QPS（突发 3）      -> 429 invite_rate_limited + Retry-After（不触碰邀请码）
   账本被删除                        -> 邀请码随账本级联删除
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
- **月度分类支出可以是负数**（某月只有退款没有支出），界面照实显示负值，不要截断到 0（决策 §14.44，03-10）。

### 5.2 月度合计、趋势与列表汇总

```
月度总支出(M) = Σ 月度分类支出(c, M)   对所有支出一级分类 c
月度总收入(M) = Σ 月度分类收入(c, M)   对所有收入一级分类 c
月度净值(M)   = 月度总收入(M) − 月度总支出(M)
```

**最近 12 个月趋势只画支出**（决策 §14.52 B20，屏幕放不下收入曲线）：对 `M ∈ {当月, 当月-1, …, 当月-11}` 各算一遍 `月度总支出`，`GET /ledgers/{id}/stats/trend?months=12` 只回支出序列。趋势卡上**不加**月均 / 峰值之类的派生指标，宽屏侧栏也不加"报表""成员"顶级页（决策 §14.52 A21）。

**交易列表的汇总**（决策 §14.52 A14）：`GET /ledgers/{id}/transactions` 在 `{items, total}` 之外多返回一个 `summary`，统计的是**当前筛选条件下的全部结果**（不是当前这一页）：

```
summary.expense = Σ |conv(t)|        对结果里 kind='expense' 的行
summary.income  = Σ conv(t)          对结果里 kind='income' 的行
summary.refund  = Σ conv(t)          对结果里 kind='refund' 的行
summary.net     = summary.income + summary.refund − summary.expense
```

**口径提醒**：`summary.expense` 是**原始支出合计、不冲减退款**（退款单列在 `summary.refund` 里），与 §5.1 的「月度总支出（已冲减退款）」**不是同一个口径**；同一份筛选结果里，统计页的支出数和列表汇总的支出数会不相等。界面上这两处标签必须区分开（例如列表汇总写「支出合计」、统计页写「总支出（已减退款）」），不要用同一个中文标签展示两个数（04 章据此取名）。

**净额不含转账**（`kind='transfer'` 的行不进这四个数）。列表界面按日分组、每组给当日小计，同样只算非转账行（决策 §14.52 A14）。

**筛空时的补救提示**（决策 §14.52 A15）：结果为 0 条时，前端对**最多 2 个**当前筛选条件各发一次去掉该条件的计数查询，提示"去掉'商户包含 X'会有 N 笔"。这只是多几次普通列表查询，不是新接口。

### 5.3 折算规则与日期规则（决策 §8、§14.32）

统一为**一个**函数（现状两套公式不一致的问题就此消除：单行路径 `amount × rate` (backend/app/api/transactions.py:20-46)，列表路径 `amount / rate` (backend/app/api/transactions.py:244-255)）：

```
convert(amount, from_ccy, to_ccy, on_date):
    if from_ccy == to_ccy:        return amount
    d = 最近一个 <= on_date 且已公布行情的交易日   # 周末/节假日/当天未公布 -> 向前回退
    r = rate(d, from_ccy, to_ccy)                # 1 from_ccy = r to_ccy
    return round(amount * r, 4)                  # 四舍五入到 4 位小数
```

- **交易与统计**用 `on_date = t.occurred_at`（发生日汇率，一经公布不再变，所以历史统计稳定）。**改账本基准币种也不会让历史数字变得不可复现**——每笔仍按各自发生日的汇率重新折算（决策 §14.52 B8）；界面在改币种时只提示"将重新折算 N 笔"，不预告具体数字（决策 §14.52 A9）。
- **账户余额**用 `on_date = today`（最新汇率），因为余额是"现在值多少钱"。
- 向前回退有上限：`FX_MAX_BACKFILL_DAYS = 10`，超过这个窗口还找不到行情就退而用最新汇率（决策 §14.44，03-12）。
- 行情从 `exchange_rates` 缓存表读，缺就去 Frankfurter 拉一次再按主键 upsert 写缓存（决策 §14.1）。
- 拉不到行情时，该项折算返回 `null`，界面显示原币种金额并标注"暂无汇率"——**统计接口不因汇率源故障而 5xx**（沿用现状 backend/app/api/transactions.py:44-46 的容错策略）。
- **交易详情显示所用汇率与汇率日期**（决策 §14.52 A24）：响应里的 `rate_used` / `rate_date` 直接展示，用户能看出这笔是按哪天的行情折的。

**日期规则**（决策 §14.32）：`occurred_at` 是 Postgres `DATE`——**不存时间、不带时区，用户换时区它也不会变**。接口一律用 `YYYY-MM-DD` 字符串传输；前端**把它当字符串显示和比较**，不得用 `new Date("YYYY-MM-DD")` 再格式化（那会按 UTC 零点换算，导致东八区少一天）；表单默认"今天"取**浏览器本地日期**而非 UTC 日期；导入文件里的 `date` 同样是无时区字符串；汇率按这个日历日期查。月份归属 `month(t.occurred_at)` 也直接取字符串前 7 位，不经过任何时区换算。

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
```

两条日期规则要分清（决策 §8）：**账户内部把交易归到账户币种，用的是交易发生日的汇率**（一笔账发生时值多少就是多少，历史不再变）；**把账户余额折到账本基准币种，用的是最新汇率**（余额回答的是"现在值多少钱"）。这也是 `default_currency` 创建后不可改的原因（决策 §14.50）——改了它，所有历史折算的基准都会无声变脸。

微算例：账户 `招行储蓄卡`（`default_currency=CNY`，`opening_balance=0`），账本基准币种 CNY。上面记了两笔——2026-05-08 一笔 `−200.0000 CNY` 的支出，和同一天一笔用这张卡付的 `−10.0000 USD` 的支出（发生日汇率 1 USD = 7.2000 CNY）：

```
账户余额 = 0 + (−200.0000) + convert(−10.0000, USD, CNY, 2026-05-08)
         = 0 + (−200.0000) + (−72.0000)
         = −272.0000 CNY                    ← balance，账户币种
balance_base = convert(−272.0000, CNY, CNY, 最新) = −272.0000 CNY，balance_rate = 1.00000000
```

注意那笔外币支出即使明天汇率变到 7.1000，`balance` 仍然是 −272.0000 CNY——它在发生那天就已经折定了。

接口形态见 [`./03-backend-api.md`](./03-backend-api.md) §5.23：`GET /ledgers/{id}/sources` 每行回 `balance`、`balance_base`、`balance_rate`、`balance_rate_date` 四个标量，没有按币种拆开的明细。

### 5.5 资产、负债与净资产（决策 §7、§14.50）

首页和账户页给**三个数**，全部按账本基准币种、用最新汇率折算，**归档账户一律不计入**（决策 §14.50）：

```
未归档账户集合 A(L) = { a ∈ 账本 L 的账户 : a.archived = false }

资产(L)   = Σ 账户余额折算(a)      a ∈ A(L)，a.type ≠ 'credit'
负债(L)   = Σ 账户余额折算(a)      a ∈ A(L)，a.type = 'credit'      ← 通常是负数
净资产(L) = 资产(L) + 负债(L)
```

- **负债是负数**，所以净资产用**加**不用减：信用卡欠 688 元时它的 `balance` 就是 `−688`，直接加进去。信用卡余额为正（多还了钱）也照实计入。
- **归档账户既不进资产、也不进负债、也不进任何分组小计**；账户列表里把它们单列一组、显示 `archived_at`，并在组标题上写明"不计入净资产"。归档操作前的确认框提示"该账户余额将从净资产中移除"（决策 §14.50）。
- 账户列表**按 `type` 分组并给每组小计**（储蓄卡 / 信用卡 / 现金 / 其他，决策 §14.48、§14.50）。
- **账本列表卡片不显示净资产**，只显示成员数与基准币种（决策 §14.52 A16）。

### 5.6 金额区间筛选的比较口径（决策 §14.49）

`GET /ledgers/{id}/transactions` 的 `min_amount` / `max_amount` **按账本基准币种折算后的绝对值比较**，不是按原币比较：

```
命中(t) ⟺ min_amount ≤ |conv(t)| ≤ max_amount        ← conv 用发生日汇率（§5.3）
```

- 服务端**先按其他条件过滤**（`q` / `kind` / 分类 / 账户 / 日期 / `currency`），**再在结果上做折算与范围过滤**——折算是读取时计算，不落库（决策 §8、§14.49）。
- `currency` 筛选项**保留**：它筛的是交易的**原币种**，和金额区间是两件事（筛选栏上两者都有，决策 §14.49）。
- 列表每行**同时显示原币金额和折算金额**（决策 §14.49），用户才看得懂为什么一笔 10 USD 会落在"50–100 CNY"的区间里。
- 拉不到汇率的行 `conv(t)` 为 `null`：金额区间条件**对它不生效**，它**始终保留在结果里**并标"暂无汇率"，也不计入 `summary` 的折算合计。

筛选状态放在前端 URL 的 query 里（决策 §4、§12）。搜索用 ILIKE 匹配 `merchant` / `note`，不做全文索引（决策 §4）。

### 5.7 算例

以下三个算例的账本 L 基准币种都是 **CNY**。汇率用到两个值：

| 行情日 | 汇率 |
|---|---|
| 2026-05-08 | 1 USD = 7.2000 CNY |
| 最新（2026-09-08） | 1 USD = 7.1000 CNY |

#### 5.7.1 部分退款跨月

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

原单剩余可退额 = `|−899.00| − 300.00 = 599.00 CNY`；再退一笔 700.00 就是超额退款，前端警告但允许保存（§3.12），保存后 4 月服饰 = `−1000.00 CNY`。

#### 5.7.2 跨币种两腿转账 + 手续费

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

T3 和 T4 一分钱都没进统计——这就是"转账不计入"。交易列表里这两行会被前端**合并成一行**显示为"美元支票 → 招行储蓄卡"（决策 §14.52 B15、B16），但接口返回的仍是两条、`summary` 也不把它们算进净额。

**余额与净资产**（§5.4、§5.5 的口径；两个账户上的交易币种都等于各自的 `default_currency`，所以第一步一次换算都不发生；第二步折到账本基准币种 CNY 用最新汇率 7.1000）：

```
美元支票   balance      = 0 + (−100.0000) + (−5.0000) = −105.0000 USD   ← 账户币种 USD
           balance_base = −105.0000 × 7.1000          = −745.5000 CNY
招行储蓄卡 balance      = 0 + 715.0000                =  715.0000 CNY   ← 账户币种 CNY
           balance_base = 715.0000 × 1                =  715.0000 CNY

资产   = 715.00 + (−745.50) = −30.50 CNY    ← 两个都不是 credit，都算资产
负债   = 0.00 CNY                            ← 没有信用卡账户
净资产 = −30.50 CNY
```

这 −30.50 CNY 的来源可以对上账：手续费 `−5 USD × 7.1 = −35.50 CNY`，加上换汇时 100 USD 换到 715 CNY 而按最新汇率只值 710 CNY 的 `+5.00 CNY` 差价，合计 `−30.50 CNY`。汇兑差价不单独记账，它自然体现在余额里（决策 §1.2）。

如果之后把 `美元支票` 归档，它的 −745.50 就**从资产里消失**，净资产变成 `+715.00 CNY`——归档前界面必须提示这一点（决策 §14.50）。

#### 5.7.3 用从未录入应用的银行卡还信用卡（单腿），随后配对

账户：`招行信用卡`（type=`credit`，`default_currency=CNY`，`opening_balance=−2000.0000` —— 期初已欠 2,000 元；表单里填的是"欠款 2000"，服务端存成负数，决策 §14.52 A13）。

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

如果这笔 1,500 被误记成 `income`，6 月净值会变成 `+1312.00 CNY`，凭空多出一笔收入——这正是"信用卡还款必须是 transfer"的原因。反过来，如果一笔**真的**是别人给我的钱被误记成单腿 transfer，收入就凭空消失了——所以外部转入的**默认建议是 `income`**（决策 §1.2、§3.14）。

**余额与净资产**（账户币种 CNY，两笔交易也都是 CNY，无换算；账本基准币种也是 CNY，`balance_rate = 1.00000000`）：

```
招行信用卡 balance      = −2000.0000 + (−188.0000) + 1500.0000 = −688.0000 CNY
           balance_base = −688.0000 × 1                        = −688.0000 CNY

资产   = 0.00 CNY        ← 假设账本里只有这一个账户
负债   = −688.00 CNY     ← type='credit'
净资产 = −688.00 CNY     （仍欠 688 元）
```

期初余额必须计入，否则余额会算成 `+1312.00`，方向都反了（决策 §3）。

**后来把工资卡也录进了应用**：用户新建账户 `工资卡`（`checking`，CNY），并在 2026-06-20 补记一条 `transfer(out, repayment) −1500.0000 CNY` 的单腿转账（T8）。现在 T7 和 T8 是同一笔钱的两端，可以配对（§3.15 B）：

```
POST /ledgers/{id}/transactions/{T7}/pair
{"counterpart_transaction_id": "{T8}", "updated_at": "..."}

校验：都是 transfer ✓ / 都还是单腿 ✓ / role 一进一出 ✓ / 不同账户 ✓ / 都未归档 ✓
      （transfer_subtype 不参与校验，决策 §14.53a）
动作：生成新的 transfer_pair_id 写到 T7、T8；T7 的 counterparty "工资卡" 清空；
      统一 transfer_subtype：转入腿 T7 在信用卡账户上且是 repayment -> 整对 repayment
      （本例两腿本来就都是 repayment，统一后值不变，仍按 §14.53a 各写一条 updated 事件）；
      各追加一条 paired 事件
```

配对**不改变任何金额**，所以余额、统计、净资产**一个数都不变**——变的只是这两条从"两笔各自的单腿"变成"一笔转账的两条腿"，列表里合并成一行显示"工资卡 → 招行信用卡"。想反悔就 `POST .../transfer/{pair_id}/unpair` 拆回去（`counterparty` 需要重新填）。

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
| 12 | **有对腿就不填对方文本**：`transfer_pair_id IS NULL OR counterparty IS NULL`——配对时必须清 `counterparty`，拆开后才能重新填 | CHECK（决策 §10、§14.34） |
| 13 | `transfer_role IN ('out','in')`、`transfer_subtype IN ('plain','repayment')` | CHECK |
| 14 | `finance_sources.type IN ('checking','credit','cash','other')`——**四种，没有 `savings`** | CHECK（决策 §14.48） |
| 15 | **`(finance_sources.archived_at IS NOT NULL) = (finance_sources.archived = true)`**——归档必写 `archived_at`、取消归档必置 NULL，一一对应 | CHECK（决策 §14.50；两侧写入由 §3.10 的应用层保证，02 章落 DDL 时不要只实现「未归档不许有 `archived_at`」这半条） |
| 16 | `ledger_members.role IN ('owner','member')` | CHECK |
| 17 | **`import_batches.status IN ('ready','committed')`——只有两态** | CHECK（决策 §5、§14.22） |
| 18 | `import_batches.source IN ('csv','paste')`——没有 `json` | CHECK（决策 §14.47） |
| 19 | `import_rows.status IN ('pending','edited','skipped')` | CHECK |
| 20 | `transaction_events.event IN ('created','updated','imported','paired','unpaired','refund_linked','refund_unlinked')` | CHECK（决策 §14.51） |
| 21 | 一个用户在一本账里最多一条成员记录 | `PRIMARY KEY (ledger_id, user_id)` |
| 22 | 原支出被删除时退款行保留、`refund_of` 置空 | 外键 `ON DELETE SET NULL` |
| 23 | 批次删除时草稿行随之删除 | 外键 `ON DELETE CASCADE` |
| 24 | 交易删除时它的操作记录随之删除 | `transaction_events.transaction_id` 外键 `ON DELETE CASCADE`（决策 §14.51） |
| 25 | 账本删除时邀请码随之删除 | `ledger_invites.ledger_id` 外键 `ON DELETE CASCADE` |
| 26 | 交易必须引用存在的账户和账本 | 外键 `source_id` / `ledger_id` |
| 27 | 邮箱唯一 | `UNIQUE (email)` |
| 28 | 同一天同一对币种只缓存一条行情 | `PRIMARY KEY (date, base, symbol)`（决策 §14.1） |

注意：

- CHECK 里**不含** `amount <> 0`——它被 #2/#3/#4 隐含覆盖（`< 0` 和 `> 0` 都排除了 0）。
- **`ledger_invites.code` 上没有唯一索引**（决策 §14.29）：只保证与该账本当前有效的码不重复，由生成逻辑在应用层保证；过期与用掉的行都已从表里删除，历史码不需要唯一性。
- 不再有"每用户最多一份模型设置"这条——那张表已随决策 §14.25 取消。

### 6.2 应用层保证（决策 §1–§9、§14）

| # | 不变量 | 落点 |
|---|---|---|
| 1 | 每本账**恰有一个** owner | 建账本时写入；转让 owner 在一个事务内同时降级原 owner；owner 不能退出、不能被移除 |
| 2 | 每次读写都限定在"调用者是成员的账本"内 | 每个业务路由的成员依赖；越权一律 404 `not_found` |
| 3 | 注册必定同时产出一本默认账本和一条 owner 记录 | 注册在一个事务里完成（§3.1） |
| 4 | `category_l1` 在常量表里，且收支侧与 kind 匹配 | 创建/更新/导入提交时校验（决策 §1.3） |
| 5 | `category_l2` 属于 `category_l1` | 同上 |
| 6 | 分类表与说明文字只能改代码发版，用户改不了 | 没有分类管理接口；`GET /categories` 只读，带 `version`（决策 §1.3、§14.21） |
| 7 | `refund_of` 指向同账本的 `kind='expense'` | 创建/更新时校验（决策 §1.1） |
| 8 | 两腿转账原子创建、原子修改、原子删除；**配对后两腿 `transfer_subtype` 始终一致**（配对时按决策 §14.53a 统一：任一腿是 `repayment` 且转入腿账户 `type='credit'` → 整对 `repayment`，否则整对 `plain`）；`occurred_at` 只在 `transfer` 接口建 / 改时同写两腿，配对出来的一对允许两腿日期不同 | 专用 transfer 接口，单请求单事务；`POST .../{tid}/pair` 与导入提交在同一个事务里把两腿写成同一子类型并**给两腿各写一条 `updated` 事件**（值未变的那腿 before == after）；`PATCH .../transfer/{pair_id}` 的 `occurred_at` / `subtype` / `note` 同写两腿（决策 §1.2、§14.34、§14.53a） |
| 9 | 两腿转账的两个账户不同 | `POST .../transfer` 与 `POST .../{tid}/pair` 都校验 `same_source` |
| 10 | 两腿转账的任一腿不能被单独 PATCH / DELETE | 普通交易接口检测 `transfer_pair_id` 非空 → 409 `use_transfer_endpoint` |
| 11 | `transfer_pair_id` 永远由服务端生成，客户端不能自带 | `POST /transactions` 拒绝该字段；只有两腿接口和 `pair` 端点会生成 |
| 12 | **配对只能发生在两条仍为单腿、方向相反、不同账户、账户未归档的转账之间**——**子类型不作要求**（配对时统一，决策 §14.53a）；配对成功时两条的 `counterparty` 一起清空 | `POST .../{tid}/pair` 的七步校验（§3.15 B），一个事务（决策 §14.34、§14.53a） |
| 13 | 拆开只把 `transfer_pair_id` 置 NULL，不动金额、账户、日期 | `POST .../transfer/{pair_id}/unpair`（决策 §14.34） |
| 14 | `transaction_events` **只追加**：没有任何路径会 UPDATE 或单独 DELETE 一条事件，唯一的消失方式是随交易级联删除 | 事件写入只有 INSERT；表上不暴露改 / 删接口（决策 §14.51） |
| 15 | **每一条改交易的路径都追加一条事件**（普通 CRUD、转账接口、配对 / 拆开、导入提交、退款关联变化） | §1.10 的路径表；服务层统一在事务内写入（决策 §14.51） |
| 16 | 归档账户不能新建交易、不能作为导入目标、不能作为转账腿或配对对腿 | 四处入口各自校验（决策 §3、§14.34） |
| 17 | **归档账户不计入资产 / 负债 / 净资产与首页合计** | 统计与账户列表按 `archived = false` 过滤（决策 §14.50，§5.5） |
| 18 | 账户 `default_currency` 创建后不可改 | `PATCH .../sources/{sid}` 校验 → 400 `currency_locked`（决策 §14.50） |
| 19 | 有交易的账户不能删除 | `DELETE .../sources/{sid}` 校验（决策 §3） |
| 20 | 同一账本内账户**允许重名** | 不加唯一约束，只在界面提示（决策 §14.40，01-6） |
| 21 | `transactions` / `finance_sources` / `ledgers` 的 PATCH 必须带匹配的 `updated_at`，否则 409 `stale_update`；两腿转账**两条腿都比对** | 决策 §2、§14.40（01-11） |
| 22 | 邀请码一次性、10 分钟过期；**用掉即删、过期即删、作废即删**，表里只有有效的码 | 生成 / 加入 / 作废三个动作各自清理（决策 §14.29） |
| 23 | `POST /ledgers/join` 端点级 1 QPS（突发 3），被限流的请求**不触碰邀请码** | 令牌桶中间件 → 429 `invite_rate_limited`（决策 §14.35） |
| 24 | 每人 ≤ 10 本账、每本 ≤ 10 人 | 建账本 / 生成邀请码 / 加入时应用层 `COUNT(*)` 校验，不加触发器（决策 §2、§14.41） |
| 25 | 导入文件**只接受 CSV**，且首行版本必须与应用当前分类表版本一致 | 上传时按**解码 → 结构 → 版本**的顺序校验：解码失败（非 CSV 的二进制文件在这一步被挡下）、缺 `# version:` 行、表头或列数不对 → 400 `import_format_invalid`；版本行存在但不一致 → 400 `skill_outdated`（决策 §14.30、§14.47、§14.53d） |
| 26 | 结构错误不产生批次；行级问题不丢行、只打标记并写 `hint` | 同步校验的三层（§3.17 第 3 步，决策 §5、§14.52 B2） |
| 27 | 自动标记**只有四种**：`duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review`；批内重复行不合并 | 标记算法（决策 §14.31、§14.34） |
| 28 | 提交导入时所有未跳过的行都有日期 / 金额 / kind，非 transfer 行有 `category_l1` | commit 前置校验 → 409 `batch_not_ready` / 409 `rows_uncategorized`（决策 §5） |
| 29 | 导入提交是一个事务：要么整批建成，要么一条都不建 | commit 实现（决策 §5） |
| 30 | 撤销一批导入 = 删掉且仅删掉 `import_batch_id = bid` 的交易（及其事件）；不保留已撤销的批次 | `DELETE .../imports/{bid}`（决策 §5、§14.22） |
| 31 | 折算只有一个函数、一个方向：交易/统计用发生日汇率，余额用最新汇率，无行情日向前回退（上限 10 天） | 决策 §8、§14.44 |
| 32 | 金额区间筛选按基准币种折算后的绝对值比较，且在其他条件过滤之后进行 | 列表查询实现（决策 §14.49，§5.6） |
| 33 | 汇率缓存按主键 upsert、保留全部历史行、不做整表刷新；同一 `(base, symbol)` 一小时内不重复外网请求 | 决策 §14.1 |
| 34 | 汇率源故障不会让任何业务接口 5xx，只让折算字段变 `null` | 决策 §8；沿用现状容错 (backend/app/api/transactions.py:44-46) |
| 35 | 上传 ≤ 2 MB、单批 ≤ 2000 行、每用户每小时 ≤ 10 批、登录同 IP 每分钟 ≤ 10 次、注册同 IP 每小时 ≤ 5 次 | 决策 §5、§9、§14.43 |
| 36 | 交易列表 `limit` ≤ 200、草稿行 `limit` ≤ 500；`occurred_at` 最晚今天 + 1 天 | 决策 §14.44 |
| 37 | 所有错误响应形如 `{"detail", "code"}`，`code` 是 snake_case 且登记在 03 §4.2 注册表里 | 决策 §9、§14.4 |
| 38 | `currency` / `base_currency` / `default_currency` 一律存大写 3 位 | 沿用现状的 `CurrencyCode` 正则 (backend/app/schemas/currency.py:9) |
| 39 | **应用不向任何大模型发一次请求**，也不保存上传的账单文件 | 决策 §14.25、§14.28：没有模型客户端、没有 API key、没有上传目录 |
| 40 | 不保留任何为兼容旧版本存在的接口、字段、别名（`/auth/me` 不注册、`PATCH /me` 不接受默认账户字段） | 决策 §14.42 |

### 6.3 明确**不**保证的

| 不保证 | 原因 |
|---|---|
| 两腿转账两条腿的金额相等或币种相同 | 跨币种转账是设计特性（决策 §1.2）；手动配对也不做这个校验（§3.15 B） |
| 配对出来的两条腿日期相同 | ±3 天只是自动建议的筛选条件，手动配对不校验日期；两腿转账对象顶层的 `occurred_at` 取 `out` 腿的值（§1.9、§3.15 B） |
| 配对**之前**两条单腿的 `transfer_subtype` 相同 | 同一笔还款在储蓄卡账单里常写成 `plain`、在信用卡账单里写成 `repayment`，硬卡会让配对永远触发不了；子类型在配对时由服务端统一，**配对之后**才保证一致（决策 §14.53a、§6.2 不变量 8） |
| 累计退款不超过原单金额 | 前端警告、允许保存；已退完的原单仍可选（决策 §1.1、§14.52 B10） |
| 退款行一定有 `refund_of` | 可以不关联；原单删除后也会置空（决策 §1.1） |
| 单腿转账的对手账户存在于应用中 | 单腿的定义就是对手不在应用里（决策 §1.2） |
| 多人同时编辑时的自动合并 | 只做乐观并发检测，冲突让用户重来（决策 §2） |
| 实时协同 / 推送 / 通知 | 明确不做（决策 §0.7、§2、§14.52 B21） |
| 分类表可由用户扩展 | 分类是后端常量，改要发版（决策 §1.3） |
| 导入 CSV 内容的正确性 | 内容由**用户自己的** ChatGPT / Claude 生成，应用只做格式与取值校验；`needs_review` + review 表格兜底（决策 §5、§14.25） |
| 账本删除可恢复 | 硬删除，无回收站，本版本也不做导出（决策 §14.52 A1） |
| 撤销过的导入批次可追溯 | 撤销 = 整批删除，不留痕（决策 §14.22、§14.52 B1） |

---

## 待决

[`./00-decisions.md`](./00-decisions.md) 的 §14 已经把本章此前列出的 12 条待决**全部裁定**，正文已按裁定改写。下表保留下来只是为了让读者能追溯来龙去脉；**本章目前没有未决问题**。

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 现状的 `users.default_source_id` 在多账本模型下如何处置 | **已由决策 §14.6 裁定**：删除该列。记账表单改用"该账本内上次使用的账户"作为前端本地偏好（`localStorage`），不落库；`PATCH /me` 也不再接受它（§14.42） |
| 2 | 界面语言存在哪 | **已由决策 §14.6 裁定**：`users.language VARCHAR(8) NULL`，取值 `zh` / `en`，**NULL 表示跟随系统**；`PATCH /me` 可改。外观（浅色 / 深色）另存本机、不上服务器（§14.52 A23） |
| 3 | 模型设置表是否需要 `created_at` | **已由决策 §14.25 作废**：应用不接入大模型，这张表整个不存在 |
| 4 | `ledger_invites` 是否需要 `created_at` | **已由决策 §14.6 裁定**：加。同时按 §14.29，表里不再有使用者 / 使用时间两列，`code` 也不建唯一索引 |
| 5 | `exchange_rates` 的确切列 | **已由决策 §14.1 裁定**：新建 `(date, base, symbol, rate, fetched_at)`，主键 `(date, base, symbol)`，目标币种列叫 `symbol` 不叫 `quote`；upsert 保留历史、不整表刷新 |
| 6 | 账本内账户重名是否允许 | **已由决策 §14.40 裁定**（01-6）：允许，按 id 区分，只在界面提示，不加唯一约束 |
| 7 | 成员退出 / 被移除后，他 `created_by` 的历史数据怎么显示 | **已由决策 §14.40 裁定**（01-7）：显示 `display_name`，没填时显示邮箱 `@` 前的部分；退出后照旧显示，**不匿名化** |
| 8 | 一个用户退到 0 本账本时的落地页 | **已由决策 §14.40 裁定**（01-8）：进"新建账本 / 输入邀请码"引导页，不是空首页（屏幕稿按 §14.52 B19 补画） |
| 9 | 多币种账户余额的展示形态 | **已由决策 §14.2 裁定**：不分币种桶。余额以账户 `default_currency` 计价，另给 `balance_base` / `balance_rate` / `balance_rate_date`（§5.4） |
| 10 | 本章用到的错误 `code` 命名 | **已由决策 §14.4 裁定**：[`./03-backend-api.md`](./03-backend-api.md) §4.2 是唯一注册表，本章全部 code 与状态码按它取名，不自造同义名 |
| 11 | 两腿转账 PATCH 时用哪条腿的 `updated_at` 做乐观并发比较 | **已由决策 §14.40 裁定**（01-11）：**两条腿都比对**，任一条更新过就 409 `stale_update`；`unpair` 同理（§3.16） |
| 12 | 归档账户上的历史交易是否允许 PATCH | **已由决策 §14.40 裁定**（01-12）：允许，只禁止新建（§3.10） |

本章引用的错误 code **全部**取自 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的唯一注册表，本章不自造同义名（决策 §14.4、§14.53d）。其中与本章流程关系最紧的几个：`skill_outdated`（400，版本行存在但与当前分类表版本不一致，决策 §14.30）、`import_format_invalid`（400，结构错误——编码不可读、缺 `# version:` 行、表头或列数不对；只接受 CSV，别的文件都在解码这一步落到这个 code 上）、`rows_exceed_limit`（400，数据行超过 2000）、`currency_locked`（400，账户币种创建后不可改，决策 §14.50）、`pair_invalid`（400，配对校验任一条不过，决策 §14.34、§14.53a）。同时**作废**的 code：解析失败、解析中断、批次未失败不可重试这三类随两态状态机一并消失。

---

## 另见

- [./README.md](./README.md) — 目标设计文档索引与阅读顺序
- [./00-decisions.md](./00-decisions.md) — **唯一事实来源**：本章每个决定的出处
- [./02-database.md](./02-database.md) — 目标 schema、约束、索引与迁移链
- [./03-backend-api.md](./03-backend-api.md) — 每个接口的参数、状态码、错误 code 与响应体
- [./04-frontend.md](./04-frontend.md) — 信息架构、页面、API 客户端、i18n 与视觉定稿
- [./05-import-and-llm.md](./05-import-and-llm.md) — 标准导入 CSV 格式、skill 文本、校验规则、自动标记算法与测试
- [./mockups/README.md](./mockups/README.md) — 视觉定稿与 16 张屏幕稿（决策 §14.45）
- [../current-design/01-domain-and-flows.md](../current-design/01-domain-and-flows.md) — 现状的记账模型与 20 条用户流程
- [../current-design/02-database.md](../current-design/02-database.md) — 现状的四张表与迁移历史
- [../current-design/03-backend-api.md](../current-design/03-backend-api.md) — 现状的接口清单
- [../current-design/06-known-issues.md](../current-design/06-known-issues.md) — 现状的已知问题（本章多处"堵死的坑"出自这里）
