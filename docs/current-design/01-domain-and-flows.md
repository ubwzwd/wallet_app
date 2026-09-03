# 01 — 记账模型与全部用户流程（现状）

> **本文回答什么问题**：这个钱包应用"现在"是怎么记账的——一笔交易（transaction）在数据库、接口、界面三层分别长什么样；收入/支出/转账是怎么区分的；标签、资金账户、基准币种和汇率换算各自怎么落地；以及从注册到删除转账的 20 条用户流程，每条流程客户端发了什么请求、服务端按什么顺序检查、失败时返回什么、成功后客户端状态怎么变。全文只描述代码现状，不做设计建议。
>
> 事实基准：仓库 `main` 分支提交 `56881b2`（2026-09-03）。后端是 `backend/app` 下的 FastAPI + SQLAlchemy，前端是 `frontend/src` 下的 Expo / React Native Web。凡标注"（进程内核实）"的陈述，是在 2026-09-03 用真实路由 + SQLite 内存库跑出来的结果；标注"（线上探测）"的是同日对真实 Frankfurter 服务的请求结果。

## 0. 影响行为的版本

后端依赖以 `backend/poetry.lock` 为准，`infra/Dockerfile.api` 用 `poetry export` 导出后再安装 (infra/Dockerfile.api:40-41)：

| 库 | 版本 | 出处 |
|---|---|---|
| FastAPI | 0.109.2 | backend/poetry.lock:449-450 |
| httpx | 0.26.0 | backend/poetry.lock:625-626 |
| tenacity | 9.1.2 | backend/poetry.lock:1569-1570 |
| python-jose | 3.5.0 | backend/poetry.lock:1267-1268 |
| bcrypt | 5.0.0 | backend/poetry.lock:56-57 |
| pydantic | 2.12.3 | backend/poetry.lock:1036-1037 |

前端：`react-native-web ^0.21.0`、`@tanstack/react-query ^5.90.5`、`axios ^1.13.0` (frontend/package.json:19-20,32)。

---

## A. 现有领域模型

### A.1 表与列

共四张表。UUID 主键由 ORM 在客户端生成（`uuid.uuid4`），时间戳是不带时区的 `datetime.utcnow()`，序列化后没有时区后缀，例如 `"2026-09-03T05:52:53.241499"` (backend/app/models/user.py:16,21；进程内核实)。

| 表 | 列 | 类型 / 约束 | 出处 |
|---|---|---|---|
| `users` | `id` | UUID 主键 | backend/app/models/user.py:16 |
| | `email` | String，UNIQUE，有索引，NOT NULL | backend/app/models/user.py:17；唯一索引 `ix_users_email` 见 backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:44 |
| | `password_hash` | String NOT NULL（bcrypt） | backend/app/models/user.py:18 |
| | `base_currency` | String(3) NOT NULL，ORM 默认 `"USD"` | backend/app/models/user.py:19 |
| | `default_source_id` | UUID 可空，外键 `finance_sources.id`，ON DELETE SET NULL | backend/app/models/user.py:20；backend/migrations/versions/76227e076393_add_default_source_to_users.py:25-35 |
| | `created_at` | DateTime NOT NULL | backend/app/models/user.py:21 |
| `finance_sources` | `id` | UUID 主键 | backend/app/models/finance_source.py:16 |
| | `user_id` | UUID 外键 `users.id`，有索引，NOT NULL | backend/app/models/finance_source.py:17 |
| | `name` | String NOT NULL | backend/app/models/finance_source.py:18 |
| | `type` | String(32) NOT NULL；API 层限定为 checking / savings / credit / other 四种 | backend/app/models/finance_source.py:19；backend/app/schemas/finance_source.py:21-26 |
| | `default_currency` | String(3) NOT NULL | backend/app/models/finance_source.py:20 |
| | `archived` | Boolean NOT NULL，默认 `False` | backend/app/models/finance_source.py:21 |
| | `created_at` | DateTime NOT NULL | backend/app/models/finance_source.py:22 |
| `transactions` | `id` | UUID 主键 | backend/app/models/transaction.py:16 |
| | `user_id` | UUID 外键 `users.id`，有索引，NOT NULL | backend/app/models/transaction.py:17 |
| | `source_id` | UUID 外键 `finance_sources.id`，有索引，NOT NULL | backend/app/models/transaction.py:18 |
| | `amount` | Numeric(18, 4) NOT NULL，**带符号** | backend/app/models/transaction.py:19 |
| | `currency` | String(3) NOT NULL | backend/app/models/transaction.py:20 |
| | `occurred_at` | Date（只到天），有索引，NOT NULL | backend/app/models/transaction.py:21 |
| | `description` | String 可空（API 层上限 500） | backend/app/models/transaction.py:22；backend/app/schemas/transaction.py:34-39 |
| | `merchant` | String 可空（API 层上限 200） | backend/app/models/transaction.py:23；backend/app/schemas/transaction.py:40-45 |
| | `transfer_pair_id` | UUID 可空，有索引，**不是外键** | backend/app/models/transaction.py:24；backend/migrations/versions/8a4f4d66d893_add_transfer_pair_id_to_transactions.py:25-34 |
| | `created_at` | DateTime NOT NULL | backend/app/models/transaction.py:25 |
| `transaction_tags` | `transaction_id` | UUID 外键 `transactions.id`，ON DELETE CASCADE | backend/app/models/transaction_tag.py:13 |
| | `tag` | String(64) NOT NULL | backend/app/models/transaction_tag.py:14 |
| | 主键 | 复合主键 `(transaction_id, tag)` | backend/app/models/transaction_tag.py:17-20 |

`transactions` 表没有 `kind` / `type` 列；没有 `exchange_rates` 表（迁移 backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25 已删除）；没有任何持久化的换算结果列。

ORM 级联：`Transaction.tags` 是 `cascade="all, delete-orphan"` (backend/app/models/transaction.py:30)；`FinanceSource.transactions`、`User.finance_sources`、`User.transactions` 同样 (backend/app/models/finance_source.py:26；backend/app/models/user.py:24,26)。这些级联只在 ORM 的 `session.delete()` 时生效；转账删除用的批量删除会绕过它们（见流程 15）。

### A.2 交易（transaction）是什么

- 一笔交易 = 在**恰好一个**资金账户（finance source）上、**恰好一种**币种、**某一天**发生的一次带符号的资金变动。
- **符号语义**：`amount > 0` 是收入（钱进来），`amount < 0` 是支出（钱出去）。这只是 schema 描述和路由 docstring 里写明的约定 (backend/app/schemas/transaction.py:19-23；backend/app/api/transactions.py:62；SPEC.md:236)；后端没有任何代码检查符号。
- **API 允许 0**：`TransactionCreate.amount` 只有 `decimal_places=4`，没有 `gt` / `ne` 约束 (backend/app/schemas/transaction.py:19-23)。`"amount": 0` 的 POST 返回 201，存为 `"0.0000"`（进程内核实）。前端在提交前拒绝 `<= 0` (frontend/src/screens/TransactionFormScreen.tsx:140-143)，所以 0 金额的行只能通过直接调 API 产生。
- **精度**：最多 4 位小数，超出返回 422，`msg` 为 `"Decimal input should have no more than 4 decimal places"`（进程内核实）；存为 `Numeric(18,4)`；响应里以 **JSON 字符串**返回，固定 4 位小数，例如 `"-12.5000"`（Pydantic v2 把 `Decimal` 序列化为字符串；进程内核实）。前端类型也如此声明：`amount: string` (frontend/src/types/api.ts:63)。
- **每行一个币种**：`currency` 由 `CurrencyCode = ^[A-Z]{3}$` 校验 (backend/app/schemas/currency.py:9)，所以小写输入在路由里的 `.upper()` (backend/app/api/transactions.py:95) 执行之前就被 422 拒绝，`msg` 为 `"String should match pattern '^[A-Z]{3}$'"`（进程内核实）。任意三个大写字母都能通过，包括 Frankfurter 不认识的代码（`"XYZ"` 返回 201，进程内核实）。交易币种**不要求**等于账户的 `default_currency`——`backend/app/api/transactions.py` 里没有这种检查。
- **日期粒度**：`occurred_at` 是 SQL `Date` (backend/app/models/transaction.py:21)，接收 `YYYY-MM-DD` (backend/app/schemas/transaction.py:29-33)，没有时间部分。前端表单默认值是 `new Date().toISOString().split('T')[0]`，即 **UTC** 日历日而非本地日 (frontend/src/screens/TransactionFormScreen.tsx:28)。
- `created_at` 由服务端设置，只用作列表排序的次级键 (backend/app/api/transactions.py:215)。

### A.3 收入 / 支出的方向如何判定

没有列。方向完全由 `amount` 的符号承载。

**前端，新建时** (frontend/src/screens/TransactionFormScreen.tsx)：
1. 用户点类型按钮 `expense` / `income` / `transfer` (:17, :24, :366-387)。
2. `validate()` 要求金额是数字且 `> 0` (:140-143)。
3. `handleSubmit` 加符号：`signedAmount = type === 'income' ? numAmount : -numAmount` (:313-314)。用的是 `Number(amount)`，所以 `"1e3"`（1000）和 `"0x10"`（16）这种输入也能通过表单（用 Node 核实）。

**前端，编辑时**：类型按钮隐藏 (:362)，类型从已加载的行推导：`transfer_pair_id` 非空 → `transfer`；否则 `parseFloat(amount) >= 0` → `income`（所以 0 金额的行按收入编辑）；否则 `expense` (:76-87)。推导出的类型再套回新的绝对值 (:313-314)。因此**通过 UI 无法翻转方向**。

**前端，展示时** (frontend/src/screens/TransactionsScreen.tsx:70-80)：`numAmount >= 0` 渲染为 `+CCY 12.50` 绿色（`#10b981`），否则 `-CCY 12.50` 红色（`#ef4444`）。

**后端**：从不读符号。收到什么存什么 (backend/app/api/transactions.py:94)；换算时直接对带符号的值做乘除，所以换算后的金额保持符号 (backend/app/services/rates.py:136；backend/app/api/transactions.py:252)。

### A.4 转账（transfer）

一笔转账 = **两行普通交易共享同一个 `transfer_pair_id`**。除此之外没有任何区别。

- **谁生成配对 id**：前端，`crypto.randomUUID()` (frontend/src/screens/TransactionFormScreen.tsx:164)。`frontend/src` 里没有引入任何 `crypto` polyfill（grep 只命中这一处），所以依赖运行时提供全局 `crypto`。后端原样存储收到的 UUID (backend/app/api/transactions.py:99；backend/app/schemas/transaction.py:51-54)。
- **两腿如何构造** (frontend/src/screens/TransactionFormScreen.tsx:167-201)：腿 1 = `source_id = from`，`amount = -abs`；腿 2 = `source_id = to`，`amount = +abs`；两腿共享 `currency`、`occurred_at`、`description`、`merchant`、`tags`、`transfer_pair_id`。第 2 步选的**单一**币种同时套给两腿，与两个账户各自的 `default_currency` 无关。
- **后端对转账校验了什么：什么都没有。** 不检查配对 id 是否已被使用、是否恰好两行共享、符号是否相反、金额是否相等、账户是否不同、id 是否由同一用户签发。只带 `transfer_pair_id` 的单独一行也被接受（进程内核实：只发腿 1，返回 201）。服务端唯一"知道配对"的逻辑是删除：删除调用者名下所有同 `transfer_pair_id` 的行 (backend/app/api/transactions.py:447-459)。
- **保留标签 `transfer`**：`SPEC.md:60` 说会自动打上。实际没有：转账请求只带用户手输的标签 (frontend/src/screens/TransactionFormScreen.tsx:166,172)，后端也不追加 (backend/app/api/transactions.py:106-112)。
- `transfer_pair_id` 创建后无法修改：`TransactionUpdate` 没有这个字段 (backend/app/schemas/transaction.py:57-86)，请求体里多余的字段被静默忽略（进程内核实：PATCH 带 `source_id` 与 `transfer_pair_id`，响应中两者不变）。

### A.5 标签（tag）

- 自由字符串，一笔交易可有多个，每个在 `transaction_tags` 占一行。
- **规范化**：服务端在创建和更新时做 `tag.strip().lower()` (backend/app/api/transactions.py:110, :382)。前端按逗号拆分、trim、去掉空串，但不转小写、不去重 (frontend/src/screens/TransactionFormScreen.tsx:315-318, :166, :243)。
- **唯一性**：只靠复合主键 `(transaction_id, tag)` (backend/app/models/transaction_tag.py:17-20)。两个规范化后相同的输入（如 `["Food", "food "]`）在 `db.commit()` 时违反主键，请求以 **500** 失败（进程内核实）。因为失败发生在 commit，且 `get_db` 会关闭 session (backend/app/core/database.py:46-57)，交易行本身也不会落库（进程内核实：查库为 0 行）。
- **长度限制**：列是 `String(64)` (backend/app/models/transaction_tag.py:14)；Pydantic 没有长度校验，所以更长的标签在 PostgreSQL 上是数据库错误（500），在 SQLite 上被静默接受。标签数量没有上限。
- **更新时整体替换**：只要 PATCH 请求体里出现 `tags` 键（哪怕是 `[]`），就删除该交易所有标签行、插入新的 (backend/app/api/transactions.py:374-384)。不带 `tags` 键则标签不动 (:359, :362)（进程内核实）。
- **筛选**：`GET /transactions?tag=x` 与 `transaction_tags` 内连接并比较 `tag == x.lower()`（小写后精确匹配，backend/app/api/transactions.py:210-212；`?tag=A` 匹配存储的 `a`，进程内核实）。
- **响应**：`tags: string[]`，由 relationship 构造，没有 `order_by`，顺序未定义 (backend/app/api/transactions.py:135,268,318,407；backend/app/models/transaction.py:30)。

### A.6 资金账户（finance source）

- **API 接受的类型**：`checking`、`savings`、`credit`、`other`（正则，backend/app/schemas/finance_source.py:21-26）。前端提供六个按钮 `checking, savings, credit, cash, investment, other` (frontend/src/screens/FinanceSourceFormScreen.tsx:16)；选 `cash` 或 `investment` 会得到服务端 422，`msg` 为 `"String should match pattern '^(checking|savings|credit|other)$'"`（进程内核实）。
- `default_currency` 由 `CurrencyCode`（只允许大写）校验，之后再 `.upper()` 一次 (backend/app/schemas/finance_source.py:27-31；backend/app/api/finance_sources.py:35)。它只是信息性字段：在选择器里显示 (frontend/src/screens/TransactionFormScreen.tsx:411,432,714)，服务端逻辑里没有任何地方使用。
- **创建后可改的字段**：只有 `name` 和 `archived` (backend/app/schemas/finance_source.py:34-49)；PATCH 带 `type` 或 `default_currency` 会被接受但这两个字段被忽略（进程内核实）。编辑表单只发 `{ name }` (frontend/src/screens/FinanceSourceFormScreen.tsx:86-90)，并显示 "Type and currency cannot be changed after creation" (:231-237)。
- **归档标志**是软隐藏：列表接口默认不返回归档行，除非 `include_archived=true` (backend/app/api/finance_sources.py:56,67-68)；交易表单只加载未归档账户 (frontend/src/screens/TransactionFormScreen.tsx:43-46)。归档账户仍然可以通过 API 记账、仍然可以是用户默认账户（均进程内核实；backend/app/api/transactions.py:69-88 与 backend/app/api/auth.py:113-120 都没有 `archived` 检查）。**没有删除账户的接口**（`backend/app/api/finance_sources.py` 里没有 `@router.delete`）。
- **默认账户**（`users.default_source_id`）：创建账户后若该用户账户总数恰好为 1 则自动设置 (backend/app/api/finance_sources.py:43-49)，或通过 `PATCH /auth/me` 显式设置 (backend/app/api/auth.py:113-120)。只在 `POST /transactions` 省略 `source_id` 时作为回退 (backend/app/api/transactions.py:70)。前端从不发送 `default_source_id`（`ProfileScreen` 只改 `base_currency`，frontend/src/screens/ProfileScreen.tsx:51-87），也从不依赖这个回退——交易表单总是发送 `source_id`，默认选 `sources[0]`（列表按 `created_at DESC` 排序，所以是最新创建的未归档账户），而不是用户的默认账户 (frontend/src/screens/TransactionFormScreen.tsx:68-73；backend/app/api/finance_sources.py:70)。

### A.7 基准币种（base currency）与换算

- `users.base_currency` 在注册时设置 (backend/app/api/auth.py:45)，通过 `PATCH /auth/me` 修改 (backend/app/api/auth.py:124-126)。两条路径都 `.upper()`；校验只有长度 3，没有正则 (backend/app/schemas/user.py:12, :35-40)，所以 `"usd"` → `"USD"`、`"ab1"` → `"AB1"` 都被接受（均进程内核实），`"EURO"` 返回 422。
- **换算在读取时计算，从不存储**（SPEC.md:692 决策 D-01；也没有对应的列）。每个 `TransactionResponse` 都带 `converted_amount`、`conversion_rate`、`conversion_date` 三个可空字段 (backend/app/schemas/transaction.py:104-115)。当 `tx.currency == base_currency`（不区分大小写）或汇率源失败时为 `null`。
- **单行路径**（`POST`、`GET /{id}`、`PATCH`）：`_build_conversion_fields` (backend/app/api/transactions.py:20-46) 发起**两次**上游调用：先 `convert_amount(amount, tx_ccy, base)`（内部拉 `from=tx_ccy&to=base`，backend/app/services/rates.py:127），再 `fetch_latest_rates(tx_ccy, [base])` 取汇率 (backend/app/api/transactions.py:39-42)。`converted = amount × rate`，`Decimal.quantize` 到 4 位小数（银行家舍入）(backend/app/services/rates.py:135-139)；`conversion_rate` = Frankfurter 返回的 `tx→base` 汇率原值；`conversion_date = date.today()`（服务器当天）——Frankfurter 自己的 `date` 字段被丢弃 (backend/app/services/rates.py:89-93；backend/app/api/transactions.py:43)。
- **列表路径**（`GET /transactions`）：一次调用 `fetch_latest_rates(base, [本页所有不等于 base 的币种])` (backend/app/api/transactions.py:217-233)。Frankfurter 返回 `1 base = r tx_ccy`，于是 `converted = amount / r`（4 位小数），`conversion_rate = 1 / r`（6 位小数）(:248-255)。因为两条路径向 Frankfurter 询问的方向相反、舍入位数也不同，同一行在列表里和在创建/更新响应里的 `conversion_rate` 可能略有差异。
- **汇率源**：`GET {EXCHANGE_RATE_API_URL}/latest?from=<BASE>&to=<A,B,C>`，10 秒超时，不跟随重定向（httpx 默认），汇率不缓存 (backend/app/services/rates.py:79-93)。任何非 2xx（含 3xx，httpx 0.26 的 `raise_for_status` 对重定向也抛错）或传输错误都变成 `HTTPException(503)` (:95-99)。后端默认 URL `https://api.frankfurter.app` (backend/app/core/config.py:28；backend/env.example:18) 现在对每个请求都回 **301 → https://api.frankfurter.dev/v1**（线上探测，2/2），所以默认配置下每个换算都是 `null`；生产环境模板用 `https://api.frankfurter.dev/v1` (infra/.env.example:28)，返回 200（线上探测）。Frankfurter v1 会静默丢掉未知的目标币种（线上探测：`to=EUR,XYZ` 只返回 `{"EUR": 0.86371}`），所以列表路径里一个不支持的币种只会让它自己的行为 `null`；而不支持的**基准币种**会让整个调用失败（线上探测：`from=XYZ` 返回 404），整页 `null`。
- **重试**：`fetch_latest_rates` 和 `get_supported_currencies` 都带 tenacity 装饰器，条件是 `retry_if_exception_type(httpx.HTTPError)` (backend/app/services/rates.py:18-23, :56-61)，但函数体自己捕获了 `httpx.HTTPError` 并改抛 `HTTPException` (:49-53, :95-99)，与重试条件不匹配——所以**只尝试一次**（进程内核实：把 `httpx.get` 换成抛 `ConnectError` 的桩，调用计数为 1）。超时因此最多 10 秒后浮出，而不是 10 秒 × 3。
- **支持的币种列表**：`GET /rates/currencies` 代理 Frankfurter 的 `/currencies`，结果缓存在模块级全局变量里，进程存活期间不刷新 (backend/app/services/rates.py:15,34-38,46)。线上当前是 30 个代码（探测：AUD … ZAR）；`SPEC.md:118` 与 `backend/app/api/rates.py:25-26` 的接口 docstring 写的都是 31。前端用 `staleTime: Infinity` 缓存，加载中回退到硬编码的六个 `USD, EUR, GBP, CNY, SGD, HKD` (frontend/src/screens/TransactionFormScreen.tsx:49-58；frontend/src/screens/FinanceSourceFormScreen.tsx:29-37；frontend/src/screens/ProfileScreen.tsx:33-41)。`RegisterScreen` 用自己固定的五个 (frontend/src/screens/RegisterScreen.tsx:6-12)。
- `/rates/*` 路由没有鉴权依赖 (backend/app/api/rates.py:20-105)，并且与交易路由不同，会把 503 直接抛出（`/rates/latest`、`/rates/convert`，进程内核实），配对缺失时抛 400 (backend/app/services/rates.py:129-133)。前端只调用 `/rates/currencies` (frontend/src/api/rates.ts:13-16；`frontend/src` 里没有 `/rates/latest` 或 `/rates/convert` 的调用）。

### A.8 概念 → 数据库 / 接口 / UI 落点

| 概念 | 数据库 | 接口 | UI |
|---|---|---|---|
| 方向（收入/支出） | `transactions.amount` 的符号 (backend/app/models/transaction.py:19) | `TransactionCreate` / `TransactionUpdate` / `TransactionResponse` 里 `amount` 的符号 (backend/app/schemas/transaction.py:19-23,60-64,95) | 类型按钮 + 提交时加符号 (frontend/src/screens/TransactionFormScreen.tsx:314)；渲染时的颜色和正负号 (frontend/src/screens/TransactionsScreen.tsx:70-80) |
| 转账 | 共享的 `transactions.transfer_pair_id` (backend/app/models/transaction.py:24) | 创建/响应里的 `transfer_pair_id`；按配对整体删除 (backend/app/api/transactions.py:447-459) | 两步向导 + 两次顺序 POST (frontend/src/screens/TransactionFormScreen.tsx:161-234)；"Transfer" 徽标 (frontend/src/screens/TransactionsScreen.tsx:117-121) |
| 标签 | `transaction_tags` 行 (backend/app/models/transaction_tag.py) | 创建/更新/响应里的 `tags: string[]`；`?tag=` 筛选 | 逗号分隔输入框 (frontend/src/screens/TransactionFormScreen.tsx:783-789)；标签芯片 (frontend/src/screens/TransactionsScreen.tsx:123-131) |
| 资金账户 | `finance_sources` | `/finance-sources` 的增、列表、单条读取、改（无删）(backend/app/api/finance_sources.py:17-135) | `FinanceSourcesScreen`、`FinanceSourceFormScreen` |
| 归档 | `finance_sources.archived` | `PATCH {archived}`；`?include_archived` | Archive / Unarchive 按钮、"Show Archived" 开关 (frontend/src/screens/FinanceSourcesScreen.tsx:46-73,145-151) |
| 默认账户 | `users.default_source_id` | 首个账户自动设置；`PATCH /auth/me {default_source_id}`；`POST /transactions` 的回退 | 无（UI 从不读也不写） |
| 基准币种 | `users.base_currency` | `POST /auth/register`、`PATCH /auth/me`；驱动换算字段 | RegisterScreen 按钮；ProfileScreen 选择器；HomeScreen 信息卡 (frontend/src/screens/HomeScreen.tsx:155-158) |
| 换算 | 不存储 | 每次响应现算 (backend/app/api/transactions.py:20-46,217-255) | "In <BASE>" 行 + 汇率 (frontend/src/screens/TransactionsScreen.tsx:100-103,140-151) |
| 会话 | 无（无状态 JWT） | 每个受保护路由的 `Authorization: Bearer` (backend/app/core/security.py:22,83-144) | `AuthContext` + AsyncStorage 键 `@wallet_app:auth_token` (frontend/src/constants/config.ts:10-13) |

### A.9 真实报文示例

以下均为进程内核实的真实请求/响应（id 与时间戳会变化）。

`POST /api/v1/auth/register` 请求与 201 响应：

```json
{"email": "Doc.User@Example.COM", "password": "12345678", "base_currency": "usd"}
```
```json
{"access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.<payload>.<signature>", "token_type": "bearer"}
```
解码后的 JWT payload：`{"sub": "f8cd622f-fe26-41cf-a002-173c5a343c10", "exp": 1788416573, "iat": 1788414773}`，`exp − iat = 1800` 秒 (backend/app/core/security.py:53-58；backend/app/core/config.py:17)。

`GET /api/v1/auth/me` 200：

```json
{"id": "f8cd622f-fe26-41cf-a002-173c5a343c10", "email": "Doc.User@example.com", "base_currency": "USD", "default_source_id": null, "created_at": "2026-09-03T05:52:53.241499"}
```
注意域名部分被 `EmailStr` 转成了小写，本地部分保持原样 (backend/app/schemas/user.py:10；进程内核实)。

`POST /api/v1/finance-sources` 请求 / 201：

```json
{"name": "Chase", "type": "checking", "default_currency": "USD"}
```
```json
{"id": "ef1c1c9c-6add-4c61-bfe7-fbf5e425e8e9", "user_id": "f8cd622f-fe26-41cf-a002-173c5a343c10", "name": "Chase", "type": "checking", "default_currency": "USD", "archived": false, "created_at": "2026-09-03T05:52:53.917313"}
```

`POST /api/v1/transactions`，前端记一笔支出时发出的形状 (frontend/src/screens/TransactionFormScreen.tsx:333-341；`description` / `merchant` 为空时因为值是 `undefined` 而被 JSON 序列化丢掉)：

```json
{"source_id": "ef1c1c9c-6add-4c61-bfe7-fbf5e425e8e9", "amount": -12.5, "currency": "USD", "occurred_at": "2025-01-02", "merchant": "X", "tags": [" Food ", "Cafe"]}
```
201 响应（用户基准币种与交易币种相同，所以换算字段为 null；标签顺序未定义）：

```json
{"id": "545c2c50-b789-4f28-ac61-44489111db57", "user_id": "f8cd622f-fe26-41cf-a002-173c5a343c10", "source_id": "ef1c1c9c-6add-4c61-bfe7-fbf5e425e8e9", "amount": "-12.5000", "currency": "USD", "occurred_at": "2025-01-02", "description": null, "merchant": "X", "transfer_pair_id": null, "created_at": "2026-09-03T05:52:54.013877", "converted_amount": null, "conversion_rate": null, "conversion_date": null, "tags": ["food", "cafe"]}
```

**列表路径**里一行跨币种交易（USD 基准用户，线上汇率 `1 USD = 0.86371 EUR`）：`converted_amount = 100 / 0.86371 → "115.7791"`，`conversion_rate = 1 / 0.86371 → "1.157791"`，`conversion_date = "<服务器当天>"` (backend/app/api/transactions.py:252-255)：

```json
{"amount": "100.0000", "currency": "EUR", "converted_amount": "115.7791", "conversion_rate": "1.157791", "conversion_date": "2026-09-03", "...": "..."}
```

`DELETE /api/v1/transactions/{id}` 的两种 200 响应体 (backend/app/api/transactions.py:456-459,465-468)：

```json
{"deleted_count": 2, "message": "Transfer deleted successfully (2 transactions)"}
```
```json
{"deleted_count": 1, "message": "Transaction deleted successfully"}
```
只有一腿时的转账分支响应是 `{"deleted_count": 1, "message": "Transfer deleted successfully (1 transactions)"}`（进程内核实）。

`GET /api/v1/rates/latest?base=USD&symbols=EUR` 200（`date` 是服务器当天而不是 Frankfurter 的汇率日期，backend/app/api/rates.py:55-61）：

```json
{"base": "USD", "date": "2026-09-03", "rates": {"EUR": "0.86371"}}
```

错误形状：`HTTPException` → `{"detail": "<字符串>"}`；校验错误 → 422，形如 `{"detail": [{"type": "string_too_short", "loc": ["body", "password"], "msg": "String should have at least 8 characters", "input": "1234567", "ctx": {"min_length": 8}}]}`（进程内核实）。axios 拦截器把 `detail` 包成 `new Error(detail)`；对 422 的数组 `detail`，`Error.message` 是 `"[object Object]"` (frontend/src/api/client.ts:67-70；用 Node 核实)。

---

## B. 流程

**约定**："客户端"指 `frontend/src`；所有路径都在 `/api/v1` 下 (backend/app/main.py:27-30)；基础 URL 在开发时是 `http://localhost:8000/api/v1`，Web 构建里是同源的 `/api/v1` (frontend/src/constants/config.ts:7；frontend/src/constants/config.prod.ts:5)，由 Caddy 的 `handle /api/* → api:8000` 反代 (infra/Caddyfile:12-14)。所有请求经过同一个 axios 实例（10 秒超时），其请求拦截器从 AsyncStorage 读取访问令牌（access token，JWT），存在则加 `Authorization: Bearer …` (frontend/src/api/client.ts:8-14,19-34)。在 Web 上 AsyncStorage 就是 `window.localStorage` (frontend/node_modules/@react-native-async-storage/async-storage/lib/module/AsyncStorage.js:58-71)。

**受保护路由前置**（所有标"需鉴权"的步骤都适用）：`HTTPBearer` (backend/app/core/security.py:22) 在锁定的 FastAPI 0.109.2 里，对缺少头或非 `Bearer` scheme 的请求返回 **403**——缺头时 `{"detail": "Not authenticated"}`，scheme 不对时 `{"detail": "Invalid authentication credentials"}`（fastapi 0.109.2 的 `fastapi/security/http.py` `HTTPBearer.__call__`，从 PyPI 下载的 wheel 核实；较新的 FastAPI 对同样情况返回 401）。然后 `get_current_user` (backend/app/core/security.py:83-144)：用 `SECRET_KEY` / HS256 解码，签名错误或过期抛 `JWTError` → **401 `Could not validate credentials`**，带 `WWW-Authenticate: Bearer` (:105-117)；缺 `sub` → 401 (:119-124)；用户行不存在 → 401 (:140-142)。进程内核实：乱码令牌与过期令牌都得到 401 `Could not validate credentials`。

**跨平台前置**：`react-native` 的 `Alert.alert` 在 Web 上解析到 react-native-web 的 `class Alert { static alert() {} }`——空操作 (frontend/node_modules/react-native-web/dist/exports/Alert/index.js:10-12，由 dist/index.js:10 导出)。按 `Platform.OS === 'web'` 分支的界面改用 `window.alert` / `window.confirm`；没有分支的界面在 Web 上什么都不显示。`SPEC.md:608` 说 RNW 会回退到浏览器 confirm，安装的库并非如此。

### 流程 1 — 注册

客户端前置状态：`AuthContext.user = null`，`isAuthenticated = false`；`Navigation` 显示 Login / Register 两个 tab (frontend/src/components/Navigation.tsx:13-19)。

1. 用户填写 `RegisterScreen`：邮箱、密码、确认密码、基准币种（从 `USD/EUR/GBP/CNY/SGD` 里选）(frontend/src/screens/RegisterScreen.tsx:6-12)。
2. 客户端校验 (:27-57)：邮箱正则 `\S+@\S+\.\S+`；密码非空且 **≥ 6** 位；确认密码一致。错误显示在字段下方。
3. `AuthContext.register` (frontend/src/store/AuthContext.tsx:96-118) → `POST /auth/register`，请求体 `{email, password, base_currency}` (frontend/src/api/auth.ts:17-20)。
4. 服务端按顺序检查：
   - Pydantic `UserCreate`：`EmailStr`、`password` 最少 8 位、`base_currency` 长度 3 → 422 (backend/app/schemas/user.py:8-12)。6–7 位密码能过客户端、在这里失败。
   - `SELECT users WHERE email = ?`——对 `EmailStr` 规范化后的值精确匹配（域名小写，本地部分原样）→ 400 `Email already registered` (backend/app/api/auth.py:32-37)。`Doc.User@example.com` 与 `doc.user@example.com` 是两个不同用户（进程内核实）。
   - bcrypt 加盐哈希 (backend/app/core/security.py:33-37)；插入 `User(email, password_hash, base_currency.upper())` (backend/app/api/auth.py:40-51)；唯一索引触发 `IntegrityError` → 回滚，400 `Email already registered` (:52-57)。
5. 数据库写入：一行 `users`（`default_source_id = NULL`）。
6. 响应 201 `{access_token, token_type: "bearer"}` (:60-62)。
7. 客户端：`setAuthToken` 把 JWT 存到 `@wallet_app:auth_token` (frontend/src/api/client.ts:84-86)；`GET /auth/me`（需鉴权）→ `setUser(userData)`；用户 JSON 也写入 `@wallet_app:user_data` (frontend/src/store/AuthContext.tsx:104-111)。第二个键在四处写入、**从不读取**（grep：只有 `setItem` / `removeItem`）。整个序列前后 `isLoading` 先 true 后 false (:98,116)，所以 `AppContent` 显示加载动画 (frontend/App.tsx:13-23)。
8. `RegisterScreen` 调 `Alert.alert('Success', …)`（仅原生生效，:73）。`Navigation` 因为 `isAuthenticated = !!user` 重新渲染为 `HomeScreen` (frontend/src/store/AuthContext.tsx:152；frontend/src/components/Navigation.tsx:17-19)。

失败：任何拒绝 → `Alert.alert('Registration Failed', msg)`（仅原生），并且只有当 `msg` 含 "email" 时才在邮箱字段下显示行内错误 (frontend/src/screens/RegisterScreen.tsx:75-82)。对 400 重复邮箱，Web 上会出现行内错误；对 422，消息是 `"[object Object]"`，Web 上没有任何可见反馈。

另一种失败：`POST /auth/register` 已返回 201、令牌已写入存储，但随后的 `GET /auth/me` 失败（网络错误，或 401）。`register` 的 `catch` 只重新抛出，不清令牌 (frontend/src/store/AuthContext.tsx:112-114)；响应拦截器对 `GET /auth/me` 的 401 和网络错误也都不清 (frontend/src/api/client.ts:53-58,71-73)。结果：界面显示 "Registration Failed"，`user` 仍为 `null`，停留在登录/注册页，但令牌留在存储里；下次刷新/重启时 `loadUser` 会用它直接进入已登录状态（如果那时 `GET /auth/me` 成功）。登录（流程 2）同理 (frontend/src/store/AuthContext.tsx:85-87)。

客户端后置状态：`user` 已填充，`isAuthenticated = true`，令牌在存储里；视图为 `HomeScreen` 的 `'main'`。

### 流程 2 — 登录

1. `LoginScreen` 校验：邮箱正则、密码 ≥ 6 位 (frontend/src/screens/LoginScreen.tsx:13-30)。
2. `AuthContext.login` → `POST /auth/login {email, password}` (frontend/src/store/AuthContext.tsx:69-91；frontend/src/api/auth.ts:25-28)。
3. 服务端：`UserLogin`（`EmailStr`，密码任意长度；格式错 → 422）(backend/app/schemas/user.py:15-18)；`authenticate_user` 按邮箱查找并 `bcrypt.checkpw` (backend/app/core/security.py:147-167)；失败 → 401 `Incorrect email or password` + `WWW-Authenticate: Bearer` (backend/app/api/auth.py:76-83)。没有锁定，没有限流。
4. 响应 200 `{access_token, token_type}`——一个新的 30 分钟令牌 (:86-88)。
5. 客户端：同注册的第 7–8 步。失败时 `LoginScreen` 弹 `Alert`（原生）**并且**设置 `errors.password = message`，这在 Web 上可见 (frontend/src/screens/LoginScreen.tsx:43-47)。页脚写着 `user@test.com / password123` (:98-101)；`backend/` 里没有任何代码创建这个账号（grep），它只出现在 `README.md:112-116`。

### 流程 3 — 令牌存储、启动加载、过期

**存储**：单个 JWT 字符串，AsyncStorage 键 `@wallet_app:auth_token` (frontend/src/constants/config.ts:10-13)；Web 上是 localStorage，设备上是原生 AsyncStorage。没有刷新令牌（`SPEC.md:418`）。服务端不保存任何会话状态。

**启动加载** (frontend/src/store/AuthContext.tsx:36-64)：挂载时 `loadUser()` 置 `isLoading = true`，读取令牌；有则 `GET /auth/me`；成功 → `setUser`，重写 `user_data`。任何异常——过期/无效令牌的 401，**或普通网络错误**——都进同一个 `catch`，调用 `clearAuthToken()`（删掉两个键）并置 `user = null` (:56-60)。所以带着有效令牌离线启动应用会被登出。`finally` 清 `isLoading`；`frontend/App.tsx:16-23` 之后才渲染 `Navigation`。

**会话中途过期**（令牌自签发起 30 分钟，backend/app/core/config.py:17；没有任何东西续期——每个请求都复用存储的令牌，frontend/src/api/client.ts:20-25）：

1. 下一个受保护请求返回 401 `Could not validate credentials`。
2. 响应拦截器 (frontend/src/api/client.ts:43-79)：如果失败的调用**不是** `GET …/auth/me`，删除两个存储键 (:56-63)。它**不**碰 `AuthContext`。Promise 以 `Error("Could not validate credentials")` 拒绝。
3. React Query 对查询默认重试一次 (frontend/src/utils/queryClient.ts:9)。但第一次 401 时响应拦截器已经（`await`）删掉了令牌 (frontend/src/api/client.ts:58-63)，约 1 秒后的重试由请求拦截器读不到令牌，于是不带 `Authorization` 头 (:22-25)，服务端 `HTTPBearer` 返回 **403 `Not authenticated`**。所以一个 `useQuery` 看到的是一次 401 加一次 403，最终抛给界面的错误消息是 `"Not authenticated"`；变更（mutation）不重试 (:16)，看到的只是那一次 401 `Could not validate credentials`。
4. 发起调用的界面走自己的错误路径（比如 Web 上 mutation 的 `window.alert`）；列表界面只是继续显示缓存数据或空列表（`frontend/src/screens/TransactionsScreen.tsx:22-25` 没有错误 UI）。
5. `user` 仍然非空，所以应用**停留在已登录的 `HomeScreen`**。之后的每个请求都**不带** `Authorization` 头（令牌已删），以 403 `Not authenticated` 失败，拦截器对 403 没有特殊处理。
6. 恢复方式：刷新页面 / 重启应用 → `loadUser` 找不到令牌 → 登录页。原生上 Logout 按钮也可用；Web 上 Logout 按钮是空操作（流程 4）。
7. 如果失败的调用是 `GET /auth/me`（例如保存资料后的 `refreshUser`），令牌被有意保留 (frontend/src/api/client.ts:53-58)，只有 `loadUser` 自己的 `catch` 会清掉它。

### 流程 4 — 登出（Web 与原生差异）

`AuthContext.logout` (frontend/src/store/AuthContext.tsx:123-133)：`clearAuthToken()`（删 `auth_token` 与 `user_data`，frontend/src/api/client.ts:91-94），然后 `setUser(null)`。没有服务端调用（`frontend/src/api/auth.ts:49-52` 是空函数，而且根本没被调用）。React Query 缓存**不会**被清（`frontend/src` 里没有任何 `queryClient.clear()` / `removeQueries`，grep），所以另一个用户在同一设备上、`gcTime`（10 分钟，frontend/src/utils/queryClient.ts:11）内登录，会看到前一个用户缓存的列表，直到过期（5 分钟，:10）后重新拉取。

- **原生**：`HomeScreen.handleLogout` 弹 `Alert.alert('Logout', 'Are you sure…', [Cancel, Logout])`；destructive 按钮调用 `logout()` (frontend/src/screens/HomeScreen.tsx:20-39)。`Navigation` 切回 Login / Register tab。
- **Web**：同一个 `Alert.alert` 是 RNW 的空操作，所以按 "Logout" (frontend/src/screens/HomeScreen.tsx:185-190) 什么都不发生。`HomeScreen` 里没有 `Platform.OS` 分支。Web 用户只能手动清 localStorage，或等令牌过期后触发一次请求（流程 3）再刷新页面。

### 流程 5 — 新建资金账户

客户端前置：视图 `add-source` (frontend/src/screens/HomeScreen.tsx:66-73)，表单状态 `name=''`、`type='checking'`、`currency='USD'` (frontend/src/screens/FinanceSourceFormScreen.tsx:22-24)。

1. 客户端校验 (:66-79)：`name.trim()` 非空；随后的 2–100 字符检查用的是**未 trim** 的 `name.length`，所以 `" a"` 能通过（长度 2），实际发送的是 trim 后的 `"a"`（服务端最小长度 1，接受）。类型从六个按钮里选 (:137-146)；币种来自 Frankfurter 列表（Web：横向按钮行 :156-171；原生：模态列表 :172-226）。
2. `POST /finance-sources {name: name.trim(), type, default_currency}` (:92-96；frontend/src/api/financeSources.ts:33-36)。
3. 服务端（需鉴权）：`FinanceSourceCreate`——name 1–100、type 正则、currency `^[A-Z]{3}$` → 422 (backend/app/schemas/finance_source.py:11-31)。以 `archived=False` 和 `default_currency.upper()` 插入；commit；refresh (backend/app/api/finance_sources.py:31-41)。然后数一下该用户的账户数；恰好为 1 时设置 `current_user.default_source_id = new_source.id` 并再次 commit (:43-49)。计数包含归档账户，所以把所有账户归档后再新建一个，并不会让它成为默认账户。
4. 响应 201 `FinanceSourceResponse`。
5. 客户端：`invalidateQueries(['finance_sources'])`——前缀匹配，所以 `[…, false]` 与 `[…, true]` 两个列表变体都会重新拉取 (:42-43)；`Alert.alert('Success', …)`（仅原生）；`onSuccess` → 视图 `finance-sources` (frontend/src/screens/HomeScreen.tsx:69)。`AuthContext.user.default_source_id` **不会**被刷新，保持陈旧（这里没有 `refreshUser` 调用；唯一的调用者是 frontend/src/screens/ProfileScreen.tsx:55）。

失败：`Alert.alert('Error', …)`（仅原生，:47-49）——Web 上选 `cash` / `investment` 得到的 422 没有任何可见反馈。

### 流程 6 — 编辑 / 归档账户

编辑（视图 `edit-source`，frontend/src/screens/HomeScreen.tsx:76-90）：表单只显示名称字段和信息框 (frontend/src/screens/FinanceSourceFormScreen.tsx:132,152,231-237)，发送 `PATCH /finance-sources/{id} {name}` (:86-90)。服务端（需鉴权）：按所有者范围查找 → 404 `Finance source {id} not found` (backend/app/api/finance_sources.py:115-124)；`model_dump(exclude_unset=True)` 后只对 `name` / `archived` 做 `setattr` (:127-130)；commit。空名称 → 422 `String should have at least 1 character`（进程内核实）。客户端使 `['finance_sources']` 失效，原生弹窗，回到列表。

归档 / 取消归档 (frontend/src/screens/FinanceSourcesScreen.tsx:46-73)：
1. Web：`window.confirm("Archive Finance Source\n\nAre you sure you want to archive \"Chase\"?")`；原生：带 Cancel / Archive 的 `Alert.alert`。
2. `PATCH /finance-sources/{id} {archived: !source.archived}` (:26-28)。
3. 服务端：同样的所有者检查；设置标志；没有其他副作用——用户的 `default_source_id` 仍指向归档账户，已有交易仍引用它。
4. 客户端：`invalidateQueries({queryKey: ['finance_sources'], refetchType: 'all'})` (:29-35)；该行从未归档列表里消失（服务端按 `archived == False` 过滤，backend/app/api/finance_sources.py:67-68），或在 "Show Archived" 打开时显示 "Archived" 徽标 (:85-89, :145-151，查询键 `[…, includeArchived]` :20-23)。错误：Web `window.alert`，原生 `Alert.alert` (:36-44)。

读取单个账户：`GET /finance-sources/{id}`（需鉴权）按所有者范围查找 → 404 `Finance source {id} not found`，否则返回 `FinanceSourceResponse`；归档账户同样返回，没有 `archived` 过滤 (backend/app/api/finance_sources.py:74-96)。前端定义了 `getFinanceSource` (frontend/src/api/financeSources.ts:25-28) 但从不调用（grep 只命中定义处）；列表与编辑界面都直接用内存里的列表项。

### 流程 7 — 设默认账户

没有任何界面做这件事。这个值只有两种变化途径：

- 自动：用户第一次 `POST /finance-sources` 时（流程 5 第 3 步）。
- 显式：`PATCH /auth/me {"default_source_id": "<uuid>"}` (backend/app/api/auth.py:101-138)：服务端检查账户存在**且**属于调用者 → 404 `Finance source not found` (:113-120)；`null` 被接受并清空默认账户（:114 的检查被跳过，:122-129 直接赋值；进程内核实）；归档账户也被接受（进程内核实）。响应是更新后的 `UserResponse`。

这个值只被省略 `source_id` 的 `POST /transactions` 消费 (backend/app/api/transactions.py:70)。数据库的 `ON DELETE SET NULL` 永远不会触发，因为账户永远不会被删除。

### 流程 8 — 改基准币种

1. `ProfileScreen`（视图 `profile`）：带搜索的模态选择器，数据来自线上币种列表 (frontend/src/screens/ProfileScreen.tsx:28-49,152-210)。"Save Changes" 在没改动时直接 `onBack()` (:81-87)。
2. `PATCH /auth/me {base_currency}` (:51-52；frontend/src/api/auth.ts:41-44)。
3. 服务端（需鉴权）：`UserUpdate.base_currency` 长度 3 → 422 (backend/app/schemas/user.py:35-40)；`.upper()` (backend/app/api/auth.py:124-126)；`setattr`；commit；refresh；然后在 session 关闭前触碰所有字段以避免延迟加载错误 (:134-136)。
4. 数据库写入：`users.base_currency`。其他什么都不变——已存交易的金额/币种不动（`SPEC.md:70`）。
5. 响应：带新代码的 `UserResponse`。
6. 客户端 `onSuccess` (frontend/src/screens/ProfileScreen.tsx:53-70)：`refreshUser()` → `GET /auth/me` → `setUser`（这里失败只记日志并忽略，:56-61）；`window.alert` / `Alert.alert` 成功提示；`onBack()` → 视图 `main`，信息卡显示新币种 (frontend/src/screens/HomeScreen.tsx:155-158)。`onError` 读的是 `err?.response?.data?.detail` (:72)，但拦截器抛出的是普通 `Error`（没有 `response`，frontend/src/api/client.ts:70），所以永远显示回退文案 `Failed to update profile. Please try again.`。
7. `['transactions']` 查询**不会**失效。在它过期（5 分钟）或列表重新拉取之前，`TransactionsScreen` 用**新的**基准币种比较 `item.currency !== user.base_currency`，却渲染着按**旧**基准算出的 `converted_amount` (frontend/src/screens/TransactionsScreen.tsx:100-103)。

### 流程 9 — 记支出

客户端前置：视图 `add-transaction`；`type='expense'`，`sourceId` = 第一个未归档账户 (frontend/src/screens/TransactionFormScreen.tsx:24-25,68-73)，`currency='USD'`（硬编码默认值，不是账户的币种，:27），`date` = UTC 当天 (:28)。表单无条件渲染原生 DOM 的 `<select>` 和 `<input type="date">` (:707-717, :752-760，另见 :404-414, :558-566, :640-648)；只有转账的目标账户选择器有原生分支 (:422-488)，所以这个界面实际上只在 Web 可用。

1. 用户输入金额、币种（可搜索的模态框 :814-872）、日期，可选的描述 / 商户 / 标签。
2. `validate()` (:134-158)：`sourceId` 必填；`Number(amount)` 必须是有限数且 `> 0`；日期必填。
3. 请求体 (:333-341)：`{source_id, amount: -numAmount, currency: currency.toUpperCase(), occurred_at, description: trimmed || undefined, merchant: trimmed || undefined, tags: [...]}`（`tags` 可能是 `[]`）。
4. `POST /transactions`（需鉴权）。服务端按顺序 (backend/app/api/transactions.py:52-141)：
   - `TransactionCreate` 校验 → 422（超过 4 位小数、小写币种、日期格式错、description > 500、merchant > 200）。
   - `source_id = body.source_id or user.default_source_id`；都没有 → 400 `No finance source specified and user has no default source. Please create a finance source first.` (:70-76)。
   - 账户存在且 `user_id == 调用者` → 否则 404 `Finance source {id} not found or does not belong to you` (:79-88)。不检查归档。
   - 插入行，`flush()` 取 id，按 `tag.strip().lower()` 为每个标签插入一行 `transaction_tags` (:91-112)，`commit()`。规范化后重复的标签 → 500，什么都不落库（A.5）。
   - 计算换算字段（两次 Frankfurter 调用，或全 null）(:118-122)。
5. 响应 201 `TransactionResponse`（A.9）。
6. 客户端 `createMutation.onSuccess` (:98-106)：`invalidateQueries(['transactions'])`；`window.alert('Success…')`（Web）；`onSuccess` → 视图 `transactions`，其查询重新拉取。错误：仅 Web 上 `window.alert('Error\n\n' + message)` (:107-112)。

### 流程 10 — 记收入

与流程 9 相同，只是 "Income" 按钮把 `type='income'`，金额以正数发送 (frontend/src/screens/TransactionFormScreen.tsx:314)。服务端路径逐字节相同。

### 流程 11 — 记转账（两腿）

前置条件：未加载到 ≥ 2 个未归档账户时 Transfer 按钮禁用 (frontend/src/screens/TransactionFormScreen.tsx:386-391)。

1. **第 1 步** (:396-522)：选 From（未归档账户的 `<select>`）和 To（Web `<select>` / 原生模态框，都排除 From 账户，:430, :464）。"Next" 校验 From 已选、To 已选、To ≠ From (:500-517)，然后 `step = 2`。
2. **第 2 步** (:525-615)：金额、一个币种、日期、描述、商户、标签；"Create Transfer" → `handleSubmit` → `handleTransferSubmit` (:296-301)。
3. `handleTransferSubmit` (:161-234)：`validate()`（也复查目标账户）；`pairId = crypto.randomUUID()`；`absAmount`；`commonFields = {currency, occurred_at, description|undefined, merchant|undefined, tags|undefined, transfer_pair_id: pairId}`；`isSubmitting = true`（两个按钮都禁用，:345, :603-611）。
4. **腿 1**：`POST /transactions {source_id: from, amount: -absAmount, ...commonFields}`。服务端同流程 9（不校验配对）。失败 → 错误弹窗，`isSubmitting=false`，返回；什么都没创建 (:178-194)。
5. **腿 2**：`POST /transactions {source_id: to, amount: +absAmount, ...commonFields}` (:196-201)。
6. 腿 2 成功：使 `['transactions']` 和 `['finance_sources', false]` 失效；成功提示（Web `window.alert`，原生 `Alert.alert`）；`onSuccess` → `transactions` 视图 (:202-210)。
7. **腿 2 失败** (:211-233)：`DELETE /transactions/{leg1.id}`。因为腿 1 带 `transfer_pair_id`，服务端走转账分支，删除该用户所有同配对 id 的行——也就只有腿 1——返回 `deleted_count: 1` (backend/app/api/transactions.py:447-459)。然后显示腿 2 的错误。如果这个 DELETE 本身也失败，提示文案是 `Transfer partially created. One transaction may exist in your account — please check your transactions and delete manually if needed.`，腿 1 作为一个孤零零的、带 "Transfer" 徽标的行留下来。
8. 第 4 步和第 5 步之间有一个时间窗，其他客户端（或一次列表刷新）只能看到腿 1。没有任何服务端事务跨越两腿。

成功后的数据库状态：两行 `transactions`，符号相反、币种相同、`transfer_pair_id` 相同，标签行按腿各复制一份。

### 流程 12 — 编辑交易（支出 / 收入）

客户端前置：视图 `edit-transaction`，`selectedTransaction` = 列表项对象 (frontend/src/screens/HomeScreen.tsx:97-100,117-131)。表单状态从它填充：`amount = |amount|` 文本、`currency`、`occurred_at`、`description`、`merchant`、`tags.join(', ')` (frontend/src/screens/TransactionFormScreen.tsx:25-31)；类型按 A.3 推导。

1. 类型按钮和账户选择器隐藏 (:362, :703)；币种、金额、日期、描述、商户、标签可编辑。
2. `validate()` 同流程 9；请求体 (:320-331)：`{amount: 按推导类型加符号, currency: upper, occurred_at, description: trimmed || undefined, merchant: trimmed || undefined, tags}`。因为空白变成 `undefined` 并被 JSON 丢弃，**通过 UI 无法清空 description 或 merchant**——服务端根本看不到这个键，旧值保留（`exclude_unset`）。
3. `PATCH /transactions/{id}`（需鉴权）。服务端 (backend/app/api/transactions.py:327-413)：
   - `TransactionUpdate` 校验 → 422（规则同创建；`source_id` / `transfer_pair_id` 不是字段，发了也被忽略——进程内核实）。
   - 按所有者范围查找 → 404 `Transaction {id} not found`。
   - `update_data = model_dump(exclude_unset=True)`；`tags` 被 pop 出来；其余字段里，显式 `null` 对 `amount` / `currency` / `occurred_at` 跳过（进程内核实：`"amount": null` 金额不变），但对 `description` / `merchant` 生效（置 NULL，进程内核实）；`currency` 转大写 (:359-371)。
   - 如果有 `tags`：删除该交易全部标签行，插入规范化后的新标签 (:374-384)；commit；refresh。
   - 重新计算换算字段（单行路径）。
4. 响应 200 `TransactionResponse`。
5. 客户端 `updateMutation.onSuccess`：使 `['transactions']` 失效，Web 弹窗，回到列表 (:116-125)。

### 流程 13 — 编辑转账的一条腿

客户端：同一个表单，但 `type === 'transfer' && isEditing` 时渲染精简表单（金额、日期、描述、商户、标签；提示 "Source and currency cannot be changed on an existing transfer."，frontend/src/screens/TransactionFormScreen.tsx:618-697），并路由到 `handleTransferUpdate` (:303-307, :236-294)：

1. `validate()`；`signedAmount = 当前腿已存金额的符号 × |新金额|` (:241-242)。
2. `PATCH /transactions/{当前腿}`，请求体 `{amount, occurred_at, description|undefined, merchant|undefined, tags}`——没有 `currency` (:249-255)。服务端同流程 12。
3. 找配对腿：`queryClient.getQueryData(['transactions'])`——正是 `TransactionsScreen` 用的键，它最多只持有最近 50 行 (frontend/src/screens/TransactionsScreen.tsx:19-25)；缓存为空时 `GET /transactions`，用服务端默认 `limit=50` (:258-261)。匹配条件：同 `transfer_pair_id`、不同 `id` (:262-264)。
4. 找到了：用相同字段 `PATCH` 它，金额按**它自己**已存的符号 (:266-275)。没找到（配对腿比最近 50 行更老）：只更新了一腿，但仍显示成功提示。
5. 第二个 PATCH 失败：第一个已经提交——没有回滚——显示错误弹窗 (:285-293)。
6. 使 `['transactions']` 失效，成功提示，回到列表 (:277-284)。

后端参与的只是两个独立的 `PATCH`；服务端没有"编辑转账"的概念。

### 流程 14 — 删除交易

1. `TransactionsScreen.handleDelete` (frontend/src/screens/TransactionsScreen.tsx:44-68)：Web `window.confirm("Delete Transaction\n\nAre you sure you want to delete this transaction?")`；原生 `Alert.alert`，按钮 "Keep Transaction" / "Delete Transaction"（destructive）。
2. `DELETE /transactions/{id}`（需鉴权）(frontend/src/api/transactions.ts:59-61，响应体被忽略)。
3. 服务端 (backend/app/api/transactions.py:416-468)：按所有者范围查找 → 404 `Transaction {id} not found`（删两次第二次得 404，进程内核实）。`transfer_pair_id` 为 NULL 时：`db.delete(transaction)` → ORM 级联删除标签行 (backend/app/models/transaction.py:30；进程内核实标签行为 0)；commit；`{"deleted_count": 1, "message": "Transaction deleted successfully"}`。
4. 客户端 `deleteMutation.onSuccess`：`invalidateQueries({queryKey: ['transactions'], refetchType: 'all'})` (:28-35)；等待期间列表里**每一个** Delete 按钮都显示加载动画，因为它们都读 `deleteMutation.isPending` (:170)。错误：仅 Web 弹窗 (:36-41)。

### 流程 15 — 删除转账的一条腿

同一入口；`transfer_pair_id` 非空时确认文案变为 "Delete Transfer\n\nThis will delete BOTH sides of the transfer. Continue?" (frontend/src/screens/TransactionsScreen.tsx:45-51)。服务端走转账分支 (backend/app/api/transactions.py:447-459)：以批量 `Query.delete()` 执行 `DELETE FROM transactions WHERE transfer_pair_id = ? AND user_id = ?`，commit，返回 `{"deleted_count": 2, "message": "Transfer deleted successfully (2 transactions)"}`（进程内核实；之后另一腿 `GET` 得 404）。因为这是批量语句，ORM 级联不会执行，标签清理依赖数据库层的 `ON DELETE CASCADE` (backend/app/models/transaction_tag.py:13；backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:77)——PostgreSQL 上有效；SQLite 上 `backend/app/core/database.py:18-30` 没有开启外键约束，标签孤儿行会留下（进程内核实：删除后 `t1` 标签仍有 2 行）。`deleted_count` 是共享该 id 的行数（单独一腿为 1，通过 API 复用配对 id 时可能 3 行以上）。

### 流程 16 — 列表 / 筛选

**UI 做的事**：`GET /transactions?limit=50`——没有筛选、没有 offset、没有翻页控件 (frontend/src/screens/TransactionsScreen.tsx:19-25，查询键 `['transactions']`)。下拉刷新调用 `refetch` (:233-239)。头部的 "N transactions" 是已加载行数，不是总数 (:192-201)。

**服务端** (backend/app/api/transactions.py:144-275)，参数 `source_id`、`from_date`、`to_date`、`tag`、`limit=50`、`offset=0`：
1. `limit > 100` 被截到 100 (:168-169)；没有下限检查，也不检查 offset（进程内核实：SQLite 上 `limit=-1` 与 `offset=-1` 都返回 200；`limit=abc` 返回 422 `int_parsing`）。
2. 基础查询 `user_id == 调用者` (:172)。
3. `source_id`：必须存在且属于调用者 → 404 `Finance source {id} not found` (:175-186)；归档账户允许。
4. `from_date` / `to_date`：用 `strptime('%Y-%m-%d')` 解析 → 400 `Invalid from_date format. Use YYYY-MM-DD` / `Invalid to_date format. Use YYYY-MM-DD` (:188-208)；对 `occurred_at` 的闭区间。
5. `tag`：与 `transaction_tags` 内连接，`tag == tag.lower()` (:210-212)。
6. `ORDER BY occurred_at DESC, created_at DESC`，然后 `OFFSET/LIMIT` (:215)。
7. 批量换算：本页所有不等于基准币种的币种去重 → 一次 `fetch_latest_rates(base, [...])`；遇到 `HTTPException` 时本页所有换算字段为 null；否则逐行 `amount / rate`（4 位小数）和 `1 / rate`（6 位小数），`date.today()` (:217-255)。
8. 响应：`TransactionResponse` 的 JSON 数组，可能为空。

**客户端渲染** (frontend/src/screens/TransactionsScreen.tsx:97-175)：描述或 "No description"；商户；日期标签由 `new Date(occurred_at)` 与今天/昨天比较，否则 `MMM d` (:82-95)——`new Date('2025-01-02')` 是 UTC 零点，在负时区会渲染成前一天（用 Node 核实：`America/New_York` → "Jan 1"，`Asia/Shanghai` → "Jan 2"）；"Transfer" 徽标；标签芯片；带符号和颜色的原始金额；当 `item.currency !== user.base_currency` 且 `converted_amount` 为真值时，再显示一行 "In <BASE>" 和 `@ <rate 4dp> BASE/CCY` (:100-103,140-151)。

### 流程 17 — 读取单条

`GET /transactions/{id}`（需鉴权）：按所有者范围查找 → 404；换算走单行路径（两次 Frankfurter 调用）(backend/app/api/transactions.py:278-324)。前端定义了 `getTransaction` (frontend/src/api/transactions.ts:32-35) 但从不调用（grep 只命中定义处）；编辑界面直接用内存里的列表项。

### 流程 18 — 标签在新建 / 更新时的处理

新建：客户端 `tagsInput.split(',').map(trim).filter(非空)` → 数组 (frontend/src/screens/TransactionFormScreen.tsx:315-318；转账时为空则发 `undefined`，:166,172)。服务端：`if transaction_data.tags:` 后，每个条目一个 `TransactionTag(transaction_id, tag.strip().lower())` (backend/app/api/transactions.py:106-112)；`null` 和 `[]` 都表示"没有标签" (backend/app/schemas/transaction.py:46-50)。

更新：客户端总是发送完整的 `tags` 数组，包括 `[]` (:329, :254, :273)。服务端：只要键存在就触发"全删 + 重插" (backend/app/api/transactions.py:362,374-384)。

失败模式：规范化后重复 → 500（主键）；超过 64 字符 → PostgreSQL 上 500。两者在 UI 上都表现为 `window.alert("Error\n\nAn error occurred")` 一类的提示，因为 500 响应体没有 `detail` (frontend/src/api/client.ts:67-70)。

### 流程 19 — 汇率查询与换算

1. 使用的端点：`GET {EXCHANGE_RATE_API_URL}/latest?from=<BASE>&to=<C1,C2,...>`，通过 `httpx.get(..., timeout=10.0)` (backend/app/services/rates.py:79-87)。参数转大写；`to` 列表用逗号连接 (:81-84)。
2. 响应处理：`raise_for_status()`；`data["rates"]` 的值转成 `Decimal(str(rate))`；汇率源的 `date` 和 `amount` 字段被忽略 (:87-93)。
3. 失败：任何 `httpx.HTTPError`（传输错误、超时，或非 2xx——包括默认主机现在返回的 301）→ `HTTPException(503, "Failed to fetch exchange rates: …")` (:95-99)。tenacity 重试永远不会触发（A.7）。
4. 调用方：`backend/app/api/transactions.py` 吞掉 503 并返回 null (:44-46, :234-235)；`backend/app/api/rates.py` 原样抛出 (:52, :83-94；进程内核实：`/rates/latest` 与 `/rates/currencies` 在汇率源不可达时都返回 503)。
5. 缓存：服务端没有汇率缓存（每次列表/创建/更新都调 Frankfurter）；只有 `/currencies` 有进程生命周期的缓存 (:15,34-38,46)。前端没有单独的汇率缓存：`['currencies']` 用 `staleTime: Infinity`；换算字段（`converted_amount` / `conversion_rate` / `conversion_date`）随 `['transactions']` 查询按默认 5 分钟 `staleTime` 一起缓存 (frontend/src/utils/queryClient.ts:10-11)，改基准币种后的陈旧显示见流程 8 第 7 步。
6. `convert_amount` 在回复里缺少目标币种时额外抛 400 `Exchange rate not available for X to Y` (:129-133)，交易路由同样把它吞成 null (backend/app/api/transactions.py:44)。
7. `/rates/latest` 的 `base` 参数限定长度 3，`symbols` 默认 `"EUR,GBP,CNY"` (backend/app/api/rates.py:34-35)；`/rates/convert` 的 `amount` 要求 `gt=0` (backend/app/schemas/currency.py:38)，同币种时直接返回 `rate: 1.0`（进程内核实）。
8. 单行路径与列表路径的具体算式见 A.7。

### 流程 20 — 归档账户上新建交易

- UI：交易表单的账户 `<select>` 和两个转账选择器都由 `getFinanceSources(false)` 喂数据 (frontend/src/screens/TransactionFormScreen.tsx:43-46)，所以归档账户选不到；默认选中的是最新的**未归档**账户 (:68-73)。编辑已有交易时根本不显示账户 (:703)。
- API：`POST /transactions` 接受归档的 `source_id`（进程内核实 201），并且当 `default_source_id` 指向归档账户时也会回退到它；`backend/app/api/transactions.py:69-88` 没有 `archived` 检查。
- 列表：归档账户上的交易总是包含在内（`backend/app/api/transactions.py:172-215` 没有对 `archived` 的连接），`?source_id=<归档账户>` 也被接受 (:175-186；进程内核实 200)。

---

## C. ASCII 状态图

### C.1 登录会话（客户端侧；服务端无状态）

```
                    应用启动
                        |
                        v
              +-------------------+
              | LOADING           |  isLoading=true (frontend/App.tsx:16-23)
              | loadUser()        |  frontend/src/store/AuthContext.tsx:43-64
              +-------------------+
                 |             |
   无令牌 /    |             |  有令牌且 GET /auth/me 200
   /auth/me 失败 |             |
   (令牌被清)  |             v
                 |      +---------------------+
                 v      | AUTHENTICATED       |  user != null，令牌在存储里
      +----------------+| 显示 HomeScreen     |<-------------------+
      | ANONYMOUS      |+---------------------+                    |
      | Login/Register |    |          |                           |
      | tabs           |    |          | 受保护调用 -> 401         | register/login
      +----------------+    |          | (client.ts:48-63)         | 201/200 + /auth/me 200
            ^   ^           |          v                           | (AuthContext.tsx:69-118)
            |   |           |   +-----------------------------+    |
            |   |           |   | EXPIRED-BUT-DISPLAYED       |----+-- (无状态迁移：
            |   |           |   | 令牌已从存储删除，          |        user 仍然非空)
            |   |           |   | user 仍 != null，           |
            |   |           |   | 之后每个调用 -> 403         |
            |   |           |   +-----------------------------+
            |   |           |          |
            |   |           |          | 刷新/重启 -> loadUser -> 无令牌
            |   +-----------+----------+
            |               |
            |               | logout() 仅原生生效（Web 上 Alert.alert 是空操作）
            +---------------+   AuthContext.tsx:123-133，HomeScreen.tsx:20-39
```

### C.2 资金账户

```
   POST /finance-sources (201)
             |
             v
      +-------------+   PATCH {archived:true}    +-------------+
      | ACTIVE      | -------------------------> | ARCHIVED    |
      | archived=F  | <------------------------- | archived=T  |
      +-------------+   PATCH {archived:false}   +-------------+
        |     |                                     |     |
        |     +-- PATCH {name}（自环）              |     +-- PATCH {name}（自环）
        |                                           |
        +-- 默认列出                                +-- 仅 ?include_archived=true 时列出
        +-- UI 选择器可选                           +-- UI 选择器隐藏
        +-- 接受 POST /transactions                 +-- 仍接受 POST /transactions（API）
        +-- 可以是 users.default_source_id          +-- 仍可以是 users.default_source_id

   没有 DELETE 接口：两个状态都不是终态 (backend/app/api/finance_sources.py:17-135)。
   用户的第一个账户额外会设置 users.default_source_id (backend/app/api/finance_sources.py:43-49)。
```

### C.3 交易（单行）

```
      POST /transactions (201)
               |
               v
        +-------------+  PATCH /transactions/{id} (200)  — amount, currency,
        | EXISTS      | <------------------------------    occurred_at, description,
        |             | ------------------------------>    merchant, tags；永远不能改
        +-------------+                                    source_id / transfer_pair_id
               |
               | DELETE /transactions/{id} (200, deleted_count=1)
               v
        +-------------+
        | DELETED     |  标签行由 ORM 级联删除；之后的 GET/PATCH/DELETE -> 404
        +-------------+
```

### C.4 转账对（两行共享 transfer_pair_id）

```
   客户端: pairId = crypto.randomUUID()
        |
        | POST 腿1 (from, -abs)          失败 -> 什么都没创建
        v
   +---------------------+
   | HALF-CREATED        |  一行带 transfer_pair_id（时间窗内列表可见）
   +---------------------+
        |                                  \
        | POST 腿2 (to, +abs) 201           \ 腿2 失败 -> DELETE 腿1
        v                                    \   成功 -> 什么都没创建
   +---------------------+                    \  失败 -> ORPHAN LEG（带 "Transfer" 徽标，
   | PAIRED              |                       之后删除它只会删掉它自己）
   | 2 行，同一 id       |
   +---------------------+
        |            |
        |            | PATCH 任一腿（流程 13）：两腿各自独立更新；
        |            | 第二个 PATCH 失败或配对腿不在 50 行缓存里时，两腿会漂移
        |
        | DELETE 任一腿 -> DELETE ... WHERE transfer_pair_id=? AND user_id=?
        v
   +---------------------+
   | BOTH DELETED        |  deleted_count = 共享该 id 的行数
   +---------------------+
```

`HomeScreen` 的视图状态机（`main → finance-sources → add-source/edit-source`、`main → transactions → add-transaction/edit-transaction`、`main → profile`）见前端文档；本文只引用其位置 (frontend/src/screens/HomeScreen.tsx:12,52-136)。

---

## D. 不变量

### D.1 系统保证什么

| 保证 | 证据 |
|---|---|
| 账户和交易的每次读写都限定在调用者的 `user_id` 范围内；别人的或不存在的 id 都返回 404，绝不返回别人的数据。 | backend/app/api/transactions.py:79-88,172,289-298,347-356,435-444,449-452；backend/app/api/finance_sources.py:65,85-94,115-124；backend/app/api/auth.py:113-120 |
| 交易在创建时总是引用一个存在的、属于同一用户的账户。 | backend/app/api/transactions.py:70-88 |
| `transactions.currency`、`finance_sources.default_currency`、`users.base_currency` 存储为大写。 | 正则 backend/app/schemas/currency.py:9；`.upper()` 见 backend/app/api/transactions.py:95,369-370、backend/app/api/finance_sources.py:35、backend/app/api/auth.py:45,124-126 |
| 标签存储时已 trim 并小写，且在同一交易内唯一。 | backend/app/api/transactions.py:110,382；主键 backend/app/models/transaction_tag.py:17-20 |
| 原始金额与币种永远不会被换算改写；换算按响应现算。 | `backend/app/models/transaction.py` 没有换算列；backend/app/api/transactions.py:20-46,217-255 |
| 金额最多 4 位小数，以字符串返回。 | backend/app/schemas/transaction.py:19-23；`Numeric(18,4)` backend/app/models/transaction.py:19；进程内核实序列化 |
| 邮箱按存储值唯一（经 `EmailStr` 域名小写化之后）。 | backend/app/models/user.py:17；backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:44；backend/app/api/auth.py:32-37,52-57 |
| 密码用 bcrypt 逐个加盐哈希；注册要求 ≥ 8 位。 | backend/app/core/security.py:33-37；backend/app/schemas/user.py:11 |
| 令牌自签发起 30 分钟过期，用 `SECRET_KEY` / HS256 签名。 | backend/app/core/security.py:40-60；backend/app/core/config.py:15-17 |
| 删除任何带 `transfer_pair_id` 的行，会在一条语句里删掉调用者所有同 id 的行。 | backend/app/api/transactions.py:447-459 |
| 用户创建的第一个账户成为其默认账户。 | backend/app/api/finance_sources.py:43-49 |
| 交易路由永远不会因为汇率源而失败；换算字段退化为 `null`。 | backend/app/api/transactions.py:44-46,234-235；backend/tests/test_conversion.py:126-170 |
| 列表按 `occurred_at` 最新在前、再按 `created_at` 最新在前；每页 ≤ 100。 | backend/app/api/transactions.py:168-169,215 |
| `PATCH` 请求体是部分更新：三个 PATCH 接口都用 `model_dump(exclude_unset=True)`，未设置的字段不动。只有 `PATCH /transactions/{id}` 会跳过对 `amount` / `currency` / `occurred_at` 的显式 `null`；`PATCH /finance-sources/{id}` 与 `PATCH /auth/me` 没有这种跳过，显式 `null` 会被原样 `setattr` 到 NOT NULL 列（`name`、`archived`、`base_currency`）上，在 `commit()` 时以未捕获的数据库错误（500）失败。 | backend/app/api/transactions.py:365-371；backend/app/api/auth.py:122-131；backend/app/api/finance_sources.py:127-132；列约束 backend/app/models/finance_source.py:18,21、backend/app/models/user.py:19 |

### D.2 系统不保证什么

| 不保证 | 证据 |
|---|---|
| 转账恰好两腿、符号相反、金额相等、账户不同、配对 id 是新的——这些都不校验。 | backend/app/api/transactions.py:91-100 原样存储 `transfer_pair_id`；单腿被接受（进程内核实） |
| 转账的原子创建或更新；两腿是两个独立 HTTP 请求，只有创建时有客户端尽力而为的回滚。 | frontend/src/screens/TransactionFormScreen.tsx:178-233,247-293 |
| 转账腿上存在 `transfer` 标签（与 `SPEC.md:60` 相反）。 | frontend/src/screens/TransactionFormScreen.tsx:166,172；backend/app/api/transactions.py:106-112 |
| API 层的非零金额。 | backend/app/schemas/transaction.py:19-23；0 被接受（进程内核实） |
| 交易币种与账户 `default_currency` 一致，或账户在使用/设为默认时未归档。 | backend/app/api/transactions.py:69-88 与 backend/app/api/auth.py:113-120 没有此类检查；归档账户被接受（进程内核实） |
| 换算值稳定、有历史性、或在不同端点间一致：汇率是读取时的"最新值"，`conversion_date` 是服务器当天，列表与单行路径舍入方式不同。 | backend/app/api/transactions.py:43,252-255；backend/app/services/rates.py:89-93,135-139；SPEC.md:66-67 |
| 默认配置下换算可用（`api.frankfurter.app` 现在重定向而 httpx 不跟随）。 | backend/app/core/config.py:28；backend/app/services/rates.py:86-87,95-99；线上探测 301 ×2 |
| 汇率查询的重试——装饰器的条件永远匹配不到实际抛出的异常类型。 | backend/app/services/rates.py:18-23,49-53,56-61,95-99；进程内核实 1 次尝试 |
| 标签长度（64）或重复标签的校验——两者都表现为 500。 | backend/app/models/transaction_tag.py:14,17-20；进程内核实 500 |
| 响应里标签的顺序。 | relationship 没有 `order_by`，backend/app/models/transaction.py:30 |
| 邮箱不区分大小写的唯一性（本地部分保留大小写）。 | backend/app/schemas/user.py:10；创建出两个账号（进程内核实） |
| 服务端会话吊销、登出或续期；被盗的令牌在 `exp` 之前一直有效。 | frontend/src/api/auth.ts:49-52；`backend/app/api/auth.py` 没有这类路由 |
| 客户端察觉令牌过期：UI 停留在已登录界面直到刷新；Web 上没有可用的登出按钮。 | frontend/src/api/client.ts:48-63；`AuthContext.tsx` 从不响应拦截器的清除；RNW `Alert.alert` 空操作；frontend/src/screens/HomeScreen.tsx:20-39 |
| 登出后同一设备上用户之间的缓存隔离。 | `frontend/src` 里没有 `queryClient.clear()`（grep）；frontend/src/utils/queryClient.ts:10-11 |
| 创建第一个账户后 `AuthContext.user.default_source_id` 的新鲜度，或改基准币种后缓存换算值的新鲜度。 | frontend/src/screens/FinanceSourceFormScreen.tsx:42-46（无 `refreshUser`）；frontend/src/screens/ProfileScreen.tsx:53-70（不使 `['transactions']` 失效） |
| 编辑转账时另一腿一定被更新（当它不在最近 50 行里时）。 | frontend/src/screens/TransactionFormScreen.tsx:258-275；frontend/src/screens/TransactionsScreen.tsx:19-25 |
| 通过 UI 清空 `description` / `merchant`、改交易账户、翻转方向、改账户类型/币种。 | frontend/src/screens/TransactionFormScreen.tsx:327-328,362,703；backend/app/schemas/transaction.py:57-86；backend/app/schemas/finance_source.py:34-49 |
| 删除账户（无接口），或从 UI 翻页/筛选（固定 `limit=50`）。 | `backend/app/api/finance_sources.py` 没有 `@router.delete`；frontend/src/screens/TransactionsScreen.tsx:19-25 |
| 日期的本地时间正确性：默认 `occurred_at` 是 UTC 日，列表标签在负时区会偏一天。 | frontend/src/screens/TransactionFormScreen.tsx:28；frontend/src/screens/TransactionsScreen.tsx:82-95（Node 核实） |
| SQLite 上转账删除后 `transaction_tags` 无孤儿行（批量删除依赖数据库外键级联，SQLite 未开启 pragma 时不执行）。 | backend/app/api/transactions.py:449-452；backend/app/core/database.py:18-30；进程内核实孤儿行残留 |
| `limit` / `offset` 的下限；负值直接交给数据库。 | backend/app/api/transactions.py:168-169,215；SQLite 上 `limit=-1` 返回 200（进程内核实） |

---

## 另见

- [./README.md](./README.md) — 本组文档的索引与阅读顺序
- [./02-database.md](./02-database.md) — 表结构、迁移与索引的完整说明
- [./03-backend-api.md](./03-backend-api.md) — 每个接口的参数、状态码与响应 schema
- [./04-frontend.md](./04-frontend.md) — 界面结构、`HomeScreen` 视图状态机、查询缓存
- [./05-infra-and-ops.md](./05-infra-and-ops.md) — 部署、环境变量（含 `EXCHANGE_RATE_API_URL`）、Caddy 反代
- [./06-known-issues.md](./06-known-issues.md) — 已知问题清单
