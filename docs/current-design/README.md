# Wallet App 现状设计文档 — 项目总览

> **本文回答什么问题：** 这个仓库里的产品到底是什么、不是什么，解决谁的什么问题；代码里反复出现的术语（用户、基准币种、资金账户、默认账户、交易、带符号金额、转账对、标签、汇率换算）各自是什么意思、定义在哪个文件；仓库目录长什么样、哪些是生成物或遗留物；每个依赖的精确版本；后端、Web 前端、Android 手机（Expo Go）、Docker 生产栈分别怎么在本机跑起来、现有 README 哪些地方已经和代码对不上；项目从 2025-10 到现在走过哪几步、停在哪里；以及 `docs/current-design/` 里其余六份文档各自讲什么。
>
> 本文只描述**代码现在的样子**，不描述 README 或 `SPEC.md` 说它应该是什么样子。凡是不能一眼看出的陈述都附带 `(文件路径:行号)` 引用，行号已在本快照的工作树上逐条核实。

**快照信息：** 仓库 `/home/ubwzwd/Code/wallet_app`，分支 `docs/current-design`（从 `main` 分出，与 `main` 同处 HEAD `56881b2`，2026-09-03，"Merge branch 'gsd/phase-06-provision-oracle-vm-domain-caddy-https' into main"），共 238 个提交；tag `v1.0`（附注标签对象 `aaf88e0`）指向 `7d07c54`（2026-04-21）。下文所有路径都相对于仓库根目录。

---

## 1. 产品是什么 / 不是什么

### 1.1 一句话

Wallet App 是一个**个人多币种记账本（personal multi-currency bookkeeping ledger）**：登录后的用户把收入和支出记到自己的"资金账户（finance source）"（银行账户、信用卡、现金等）上，金额的币种由前端从 Frankfurter（ECB 数据）拉取的 30 种货币中选择（2026-09-03 线上探测；`backend/app/api/rates.py:25` docstring 里的 31 已过时），服务端本身只校验币种是三个大写字母、不对照该列表；API 返回每笔交易时会**实时**把它换算成用户选定的"基准币种（base currency）"一并返回 (`.planning/PROJECT.md:5-9`; `SPEC.md:10-21`; `backend/app/api/rates.py:25`)。它是一个 monorepo：`backend/` 是 FastAPI + SQLAlchemy + PostgreSQL 服务，`frontend/` 是 Expo / React Native 应用——目前唯一真正交付的形态是**导出为静态站点并以 PWA 方式提供的 Web 版**，`infra/` 是 Docker Compose + Caddy 的生产部署形态 (`.planning/codebase/ARCHITECTURE.md:8-51`)。

### 1.2 它是什么

| 性质 | 现状描述 | 证据 |
|---|---|---|
| 多用户，JWT 鉴权 | 每个用户一条 `users` 记录（email + bcrypt 密码哈希）。所有受保护路由通过 `HTTPBearer` 取出 JWT（HS256，`sub` = 用户 id，默认 30 分钟过期），再用 `user_id == current_user.id` 限定每条查询。访问别人的数据得到 `404` 而不是 `403`。 | `backend/app/models/user.py:16-21`; `backend/app/core/security.py:22, 40-60, 83-144`; `backend/app/core/config.py:15-17`; `backend/app/api/transactions.py:172, 289-298`; `backend/app/api/finance_sources.py:65, 85-94` |
| 无状态 API：没有刷新令牌，也没有 logout 端点 | 登出纯粹是客户端行为：清掉 AsyncStorage 里的令牌与用户数据。`frontend/src/api/auth.ts` 的 `logout` 函数体是空的。 | `frontend/src/api/auth.ts:46-52`; `frontend/src/api/client.ts:91-94`; `frontend/src/store/AuthContext.tsx:123-133` |
| Web 优先的 PWA | `App.tsx` 以副作用方式引入 service worker 注册模块，该模块在非 web 平台是空操作；`public/` 里带 manifest、iOS meta 标签、maskable 图标和离线页；`npm run build:web` 先 `expo export -p web` 再用 Workbox `generateSW` 生成 `dist/sw.js`。 | `frontend/App.tsx:8`; `frontend/src/pwa/registerSW.ts:20-32`; `frontend/public/manifest.json:1-30`; `frontend/public/index.html:6-14`; `frontend/package.json:10`; `frontend/workbox-config.cjs:25-77` |
| 同源部署 | 生产环境由 Caddy 在 `/` 提供静态导出，并把 `/api/*`、`/health`、`/docs*`、`/openapi.json` 反向代理到 `api:8000`；生产 bundle 使用相对地址 `/api/v1` 作为 API base URL。 | `infra/Caddyfile:12-32`; `frontend/src/constants/config.prod.ts:5` |
| 汇率实时取、不落库 | 每次请求都向 Frankfurter（ECB 数据）拉汇率；最初的 `exchange_rates` 表在迁移 `5ca7fe6e37db` 中被删除。换算字段在读取时计算，币种相同或 Frankfurter 不可达时为 `null`。 | `backend/app/services/rates.py:18-99`; `backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25`; `backend/app/api/transactions.py:20-46, 217-255` |
| 转账 = 两条普通交易 | 两个账户间的转账是两条共享同一个客户端生成的 `transfer_pair_id` 的普通交易；删除任意一条会把整对删掉。 | `backend/app/models/transaction.py:24`; `backend/app/api/transactions.py:446-459`; `frontend/src/screens/TransactionFormScreen.tsx:161-234` |
| 单人开发，用 GSD 流程管理 | 所有规划产物都在 `.planning/`，由"GSD"工作流生成（phase、plan、verification）；`commit_docs` 为 `true`，所以这些文件都提交进了仓库。 | `.planning/config.json:1-48`; `.planning/STATE.md:1-14` |

### 1.3 它不是什么

| 目前不是 | 现状描述 | 证据 |
|---|---|---|
| 不是已发布的原生 App | `app.json` 有 iOS/Android 配置，开发时可以在 Expo Go 里跑，但没有 `eas.json`、没有原生构建流水线；"Native EAS builds" 被明确推迟到未来里程碑 M2（Android）/ M6（iOS）。早先的 Android 分支 `feat/m2-android-mobile-support`（2025-11）已被删除，只有它的指南被归档保留。 | `frontend/app.json:15-25`; `ls frontend/eas.json` 不存在; `.planning/REQUIREMENTS.md:74`; `.planning/PROJECT.md:81`; `.planning/research/m2-android-prior-art.md:1-12` |
| 还没有公网部署 | Oracle VM 的 runbook 已写好，但由操作者手动执行的计划 06-05 / 06-06 / 06-07（开 VM、切到 Let's Encrypt 正式证书、UptimeRobot）没有执行；这三份只有 `PLAN.md` 没有 `SUMMARY.md`；`infra/runbook-evidence/` 只有 `.gitkeep`。 | `.planning/STATE.md:43-48, 97-101`; `.planning/phases/06-provision-oracle-vm-domain-caddy-https/`（`06-05-PLAN.md`、`06-06-PLAN.md`、`06-07-PLAN.md` 无对应 SUMMARY）; `infra/runbook-evidence/.gitkeep` |
| 没有预算、图表分析、周期性交易、共享钱包、推送、OAuth、银行聚合、OCR/LLM 识别 | 这些都列在"out of scope"或"later milestones"。 | `.planning/PROJECT.md:83-90`; `SPEC.md:23-27`; `README.md:47` |
| 没有 CI/CD、备份、限流、审计日志、监控 | Phase 7（CI/CD + 备份）未开始；没有 Sentry 等错误追踪；限流"not yet implemented"。 | `.planning/STATE.md:37`; `.planning/codebase/INTEGRATIONS.md:64-95`; `SPEC.md:422` |
| 没有服务端原子转账 | 转账两条腿是客户端连续发的两个 `POST /transactions`，第二个失败时客户端尽力 `DELETE` 第一条；若回滚也失败，提示用户手动清理。 | `frontend/src/screens/TransactionFormScreen.tsx:178-233` |
| Web 端没有 URL 路由 | 导航就是组件状态（`Navigation` → `HomeScreen` → `HomeView` 联合类型）；浏览器刷新一律回到 `'main'` 视图。 | `frontend/src/components/Navigation.tsx:13-19`; `frontend/src/screens/HomeScreen.tsx:12-16` |

### 1.4 解决的用户问题

按 spec 的目标（`SPEC.md:16-21`）和里程碑的"core value"（`.planning/PROJECT.md:9`）：一个在多个账户、多种货币间消费的人（persona 是"frequent traveler"，`SPEC.md:31`）希望几秒钟记下一笔交易，**原始金额和币种保持不变**，同时所有东西都能**按一种基准币种看**，而不用自己维护汇率表。更改基准币种只影响展示——已存储的数值不变 (`SPEC.md:70`; `backend/app/api/auth.py:124-129`)。

### 1.5 已实现功能清单

**HTTP 接口**（四个 router 全部挂在 `/api/v1` 前缀下，`backend/app/main.py:27-30`；`/health` 与 `/` 不带前缀，`backend/app/main.py:33-51`）：

| 方法 + 路径 | 需鉴权 | 处理函数 |
|---|---|---|
| `POST /api/v1/auth/register` → 201 `Token` | 否 | `backend/app/api/auth.py:20-62` |
| `POST /api/v1/auth/login` → 200 `Token` | 否 | `backend/app/api/auth.py:65-88` |
| `GET /api/v1/auth/me` → `UserResponse` | 是 | `backend/app/api/auth.py:91-98` |
| `PATCH /api/v1/auth/me` → `UserResponse` | 是 | `backend/app/api/auth.py:101-138` |
| `POST /api/v1/finance-sources` → 201 | 是 | `backend/app/api/finance_sources.py:17-51` |
| `GET /api/v1/finance-sources?include_archived=false` | 是 | `backend/app/api/finance_sources.py:54-71` |
| `GET /api/v1/finance-sources/{source_id}` | 是 | `backend/app/api/finance_sources.py:74-96` |
| `PATCH /api/v1/finance-sources/{source_id}`（只接受 `name`、`archived`） | 是 | `backend/app/api/finance_sources.py:99-135`; `backend/app/schemas/finance_source.py:34-48` |
| （资金账户没有 DELETE 端点） | — | `backend/app/api/finance_sources.py` 全文只有 post / get / get-by-id / patch |
| `POST /api/v1/transactions` → 201 | 是 | `backend/app/api/transactions.py:52-141` |
| `GET /api/v1/transactions?source_id&from_date&to_date&tag&limit=50&offset=0`（`limit` 超过 100 会被截到 100） | 是 | `backend/app/api/transactions.py:144-275`（截断在 168-169） |
| `GET /api/v1/transactions/{transaction_id}` | 是 | `backend/app/api/transactions.py:278-324` |
| `PATCH /api/v1/transactions/{transaction_id}` | 是 | `backend/app/api/transactions.py:327-413` |
| `DELETE /api/v1/transactions/{transaction_id}` → `{deleted_count, message}` | 是 | `backend/app/api/transactions.py:416-468` |
| `GET /api/v1/rates/currencies` | **否** | `backend/app/api/rates.py:20-29` |
| `GET /api/v1/rates/latest?base=USD&symbols=EUR,GBP,CNY` | **否** | `backend/app/api/rates.py:32-61` |
| `POST /api/v1/rates/convert` | **否** | `backend/app/api/rates.py:64-105` |
| `GET /health` → `{"status":"healthy","environment":"<ENVIRONMENT>","version":"0.1.0"}` | 否 | `backend/app/main.py:33-40` |
| `GET /` → `{"message":"Wallet App API","version":"0.1.0","docs":"/docs","health":"/health"}` | 否 | `backend/app/main.py:43-51` |

**屏幕**（全部在 `frontend/src/screens/`，由 `HomeScreen` 的视图状态切换；`HomeView` 的取值为 `'main'`、`'finance-sources'`、`'add-source'`、`'edit-source'`、`'transactions'`、`'add-transaction'`、`'edit-transaction'`、`'profile'` 八种，`frontend/src/screens/HomeScreen.tsx:12`）：`LoginScreen`（151 行）、`RegisterScreen`（220）、`HomeScreen`（253）、`FinanceSourcesScreen`（302）、`FinanceSourceFormScreen`（394）、`TransactionsScreen`（414）、`TransactionFormScreen`（1034，含两步转账向导）、`ProfileScreen`（363）（行数来自 `wc -l frontend/src/screens/*.tsx`）。

**整体拓扑**：

```text
                    +-------------------------------+
   浏览器 / PWA      |  Expo web 导出 (dist/)          |     Expo Go（仅开发）
   ---------------->|  React Native Web + axios      |<--------------------
                    +---------------+---------------+
                                    | /api/v1/* (JWT bearer)
                    +---------------v---------------+
   生产: Caddy :443  |  file_server /  + reverse_proxy| 开发: 直连 http://localhost:8000
                    +---------------+---------------+
                                    |
                    +---------------v---------------+        +--------------------+
                    |  FastAPI  app.main:app  :8000  |------->| api.frankfurter.*  |
                    |  auth | finance-sources |      | httpx  | (ECB 汇率, 无需 key)|
                    |  transactions | rates | health |        +--------------------+
                    +---------------+---------------+
                                    | SQLAlchemy 2 (psycopg2 / sqlite)
                    +---------------v---------------+
                    |  PostgreSQL 15 (生产、开发)      |
                    |  或 SQLite wallet_dev.db (开发) |
                    |  users, finance_sources,       |
                    |  transactions, transaction_tags|
                    +-------------------------------+
```

（依据：`infra/Caddyfile:12-32`; `backend/app/main.py:26-30`; `backend/app/services/rates.py:41, 80`; `backend/app/core/database.py:19-33`; `backend/app/models/__init__.py:6-9`。）

---

## 2. 术语表（按代码中的用法）

| 术语 | 在本代码库中的含义 | 定义位置 |
|---|---|---|
| 用户（user） | `users` 表的一行：`id`（UUID，由 Python 端 `uuid.uuid4` 生成）、`email`（唯一，有索引）、`password_hash`（bcrypt，每个密码独立 salt）、`base_currency`（`String(3)`，默认 `"USD"`）、`default_source_id`（可空外键 → `finance_sources.id`，`ON DELETE SET NULL`）、`created_at`（naive 的 `datetime.utcnow`）。关系：`finance_sources` 与 `transactions`（两者都是 `cascade="all, delete-orphan"`）、`default_source`（按 `default_source_id` 关联的单个对象）。 | `backend/app/models/user.py:11-26`; 哈希 `backend/app/core/security.py:33-37`; 请求/响应 schema `backend/app/schemas/user.py:8-50` |
| 基准币种（base currency） | `users.base_currency`。注册时由 `UserCreate.base_currency` 传入（恰好 3 个字符，大小写不限），写入前 `.upper()`；可通过 `PATCH /auth/me` 修改（同样转大写）。它是所有换算的**目标币种**：交易的 `currency` 与它相同时换算字段全为 `null`。注意它**没有**用资金账户/交易所用的 `CurrencyCode` 模式（`^[A-Z]{3}$`）校验，只校验长度。 | `backend/app/models/user.py:19`; `backend/app/schemas/user.py:12, 35-40`; `backend/app/api/auth.py:45, 124-126`; 使用处 `backend/app/api/transactions.py:35, 218-222, 244-247` |
| 货币代码（currency code） | `CurrencyCode = Annotated[str, Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]`——大写 ISO-4217，在 `finance_sources.default_currency` 和 `transactions.currency` 的校验阶段强制执行（所以传小写会得到 `422`，尽管处理函数随后还会再 `.upper()` 一次）。前端选择器展示的集合是 Frankfurter `/currencies` 返回的内容（首次拉取后在进程内缓存）；服务端**不**对照这个集合校验，任何 `^[A-Z]{3}$` 都会被接受，只是换算时拿不到汇率会得到 `null` 换算字段。 | `backend/app/schemas/currency.py:9`; `backend/app/schemas/finance_source.py:27`; `backend/app/schemas/transaction.py:24`; `backend/app/services/rates.py:15, 24-53` |
| 资金账户（finance source） | `finance_sources` 表的一行——钱存放或流经的地方：`name`（1–100 字符）、`type`（`String(32)`，Pydantic 正则只允许 `checking`、`savings`、`credit`、`other` 四个值）、`default_currency`（`CurrencyCode`，写入前转大写）、`archived`（bool，默认 false——这是唯一的"删除"手段）、`user_id`。列表默认只返回未归档的，按创建时间倒序。**现状缺陷：** 前端选择器提供 `['checking', 'savings', 'credit', 'cash', 'investment', 'other']`（`frontend/src/screens/FinanceSourceFormScreen.tsx:16`），其中 `cash` 与 `investment` 会被后端以 `422` 拒绝。 | `backend/app/models/finance_source.py:11-26`; `backend/app/schemas/finance_source.py:11-63`（type 正则在 21-26）; `backend/app/api/finance_sources.py:17-71` |
| 默认账户（default source） | `users.default_source_id`。用户创建**第一个**资金账户时由服务端自动赋值（插入后 `count == 1`，PROF-03 / D-09）；可通过 `PATCH /auth/me` 改为调用者自己拥有的账户（否则 `404`）；`POST /transactions` 省略 `source_id` 时用它兜底（两者都没有 → `400`）。Web 表单**不读**这个字段——它预选非归档列表的 `sources[0]`（即最新创建的那个）。 | `backend/app/models/user.py:20, 25`; `backend/app/api/finance_sources.py:43-49`; `backend/app/api/auth.py:113-120`; `backend/app/api/transactions.py:69-76`; `frontend/src/screens/TransactionFormScreen.tsx:68-73` |
| 交易（transaction） | `transactions` 表的一行：`id`、`user_id`、`source_id`（都是外键、有索引、NOT NULL）、`amount`（`Numeric(18,4)`）、`currency`（`String(3)`）、`occurred_at`（`Date`，有索引——没有时间部分）、`description`（可空，API 层限制 ≤500 字符）、`merchant`（可空，≤200）、`transfer_pair_id`（可空 UUID，有索引，**不是**外键）、`created_at`。响应额外附带 `tags: string[]` 与三个计算出的换算字段。Decimal 字段被序列化为 **JSON 字符串**（Pydantic v2），前端类型也相应声明为 `string`。 | `backend/app/models/transaction.py:11-30`; `backend/app/schemas/transaction.py:12-124`; `frontend/src/types/api.ts:59-74` |
| 带符号金额（signed amount） | `transactions.amount` 的符号**就是**交易类型：`> 0` 收入，`< 0` 支出。服务端只约束 `decimal_places=4`——没有符号检查、没有非零检查（`0` 会被接受）。符号由客户端决定：提交时 `type === 'income' ? numAmount : -numAmount`（前置校验要求 `> 0`），编辑时按 `amt >= 0` 反推类型，列表里 `>= 0` 显示绿色 `+`、`< 0` 显示红色 `-`。 | `backend/app/schemas/transaction.py:19-23`; `frontend/src/screens/TransactionFormScreen.tsx:76-87, 140-143, 313-314`; `frontend/src/screens/TransactionsScreen.tsx:70-79` |
| 转账对（transfer pair） | 共享同一个 `transfer_pair_id`（客户端用 `crypto.randomUUID()` 生成）的两条交易：FROM 腿以 `amount = -abs` 提交，TO 腿以 `+abs` 提交，`currency`、`occurred_at`、`description`、`merchant`、`tags` 完全相同。服务端没有任何配对检查，只是存下这个 id；`DELETE` 任一带 pair id 的行时会删除该用户下所有同 id 的行（返回 `deleted_count`）。第二个 POST 失败时客户端尝试 `DELETE` 第一条腿；若也失败，提示用户手动清理。编辑转账时先从 query 缓存 `[transactions]` 里找同 `transfer_pair_id` 的另一条腿，缓存为空则回退请求一次 `GET /transactions`（默认 `limit=50`）再找；找到就以同样的 `amount` 绝对值（按各自原符号）、`occurred_at`、`description`、`merchant`、`tags` 各 PATCH 一次，找不到则只 PATCH 当前腿、不报错（`frontend/src/screens/TransactionFormScreen.tsx:236-294`）。索引：ORM 命名 `ix_transactions_transfer_pair_id`（本机 SQLite 与 `create_all` 库），Alembic 迁移 `8a4f4d66d893` 建出的 Postgres 库中叫 `idx_transactions_transfer_pair`（见 02 §5）。注意：`SPEC.md:60` 说会自动打一个保留标签 `transfer`——`backend/app` 与 `frontend/src` 中都不存在这样的标签。 | `backend/app/models/transaction.py:24`; `backend/migrations/versions/8a4f4d66d893_add_transfer_pair_id_to_transactions.py:24-34`; `backend/app/api/transactions.py:99, 446-459`; `frontend/src/screens/TransactionFormScreen.tsx:164-201, 211-233, 236-294` |
| 标签（tag） | `transaction_tags` 表的一行，复合主键 `(transaction_id, tag)`，`tag` 为 `String(64)`，外键 `ON DELETE CASCADE`。自由文本；创建和更新时每个标签都做 `strip().lower()`；`PATCH` 带 `tags` 时先删光已有行再全部重插（整体替换）。`GET /transactions?tag=` 会转小写（但不 strip）后按等值 join。客户端从逗号分隔的文本框拆出标签。 | `backend/app/models/transaction_tag.py:8-23`; `backend/app/api/transactions.py:105-112, 210-212, 373-384`; `frontend/src/screens/TransactionFormScreen.tsx:166, 315-318` |
| 汇率 / 换算（exchange rate / conversion） | `services/rates.py` 封装 Frankfurter：`get_supported_currencies()`（模块级缓存）、`fetch_latest_rates(base, symbols)` 返回 `{code: Decimal}`（查询参数 `from` / `to`）、`convert_amount(amount, from, to)`（`amount * rate`，量化到 4 位小数）。两个拉取函数都套着 tenacity 的 `@retry(stop_after_attempt(3), wait_exponential, retry_if_exception_type(httpx.HTTPError), reraise=True)`，但函数体内已经把 `httpx.HTTPError` 捕获并改抛 `HTTPException(503)`，装饰器看不到 `httpx.HTTPError`，所以**实际不会重试**：第一次网络/HTTP 错误就直接抛 `HTTPException(503)`（`backend/app/services/rates.py:18-23, 49-53, 56-61, 95-99`；docstring 里的 "Retries up to 3 times" 与实际行为不符）。交易响应带 `converted_amount`、`conversion_rate`、`conversion_date`：**单条路径**（`POST`、`GET /{id}`、`PATCH`）由 `_build_conversion_fields` 发两次请求（先 convert 再取 rate，方向 交易币种→基准币种，rate 不量化）；**列表路径**只发一次批量请求 `base → [交易中出现的币种]`，然后 `converted = amount / rate`（4 位小数）、`conversion_rate = 1 / rate`（6 位小数）。两条路径的 `conversion_date` 都是**服务器的 `date.today()`**，不是 ECB 的汇率日期；任何 `HTTPException` 都会被吞成 `null, null, null`（不会向外抛 503）。代码默认值与开发模板 `backend/env.example:18` 都是 `https://api.frankfurter.app`（已 301 跳转），只有生产模板 `infra/.env.example:28` 和本机 gitignored 的 `backend/.env:9` 用 `https://api.frankfurter.dev/v1`。 | `backend/app/services/rates.py:15-139`; `backend/app/api/transactions.py:20-46, 217-255`; `backend/app/core/config.py:28`; `infra/.env.example:28`; `backend/.env:9`（gitignored） |
| 访问令牌（access token）/ JWT | 注册和登录都返回 `Token {access_token, token_type: "bearer"}`。声明：`sub`（用户 id 字符串）、`iat`、`exp`（now + `ACCESS_TOKEN_EXPIRE_MINUTES`，默认 30）。由 `get_current_user` 校验，过程中打 `DIAG_*` 日志，失败抛 `401 "Could not validate credentials"` 并带 `WWW-Authenticate: Bearer`。客户端把它存在 AsyncStorage 的 `@wallet_app:auth_token` 键下，每个请求都附 `Authorization: Bearer`；收到 `401` 时清空存储——**除非**失败的是 `GET /auth/me`。 | `backend/app/schemas/user.py:47-50`; `backend/app/api/auth.py:60-62, 86-88`; `backend/app/core/security.py:40-60, 83-144`; `frontend/src/constants/config.ts:10-13`; `frontend/src/api/client.ts:19-34, 48-64` |

**资金账户的生命周期**（唯一带显式状态位的实体）：

```text
   POST /finance-sources
          |
          v
   +-------------+   PATCH {archived:true}    +-------------+
   |  archived=  | -------------------------> |  archived=  |
   |   false     | <------------------------- |   true      |
   +-------------+   PATCH {archived:false}   +-------------+
     默认列表可见                                只在 ?include_archived=true 时列出
     （没有 DELETE 端点；已归档账户下的交易照旧指向它）
```

（`backend/app/api/finance_sources.py:36, 67-68, 126-133`。）

**`TransactionResponse` 的真实形状**（Decimal → 字符串，UUID → 字符串，`date` → `YYYY-MM-DD`，naive `datetime` → 不带时区的 ISO 串；数值仅为示意；来自 `backend/app/schemas/transaction.py:89-124` 与 `backend/app/api/transactions.py:124-139`）：

```json
{
  "id": "5f0c4c5e-1a2b-4c3d-9e8f-0a1b2c3d4e5f",
  "user_id": "0b7d2e6a-9c1f-4d0e-8a2b-3c4d5e6f7a8b",
  "source_id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
  "amount": "-42.5000",
  "currency": "EUR",
  "occurred_at": "2026-05-20",
  "description": "Groceries",
  "merchant": "Lidl",
  "transfer_pair_id": null,
  "created_at": "2026-05-20T09:12:33.481210",
  "converted_amount": "-46.1300",
  "conversion_rate": "1.0854",
  "conversion_date": "2026-05-25",
  "tags": ["food", "groceries"]
}
```

上例是单条路径（`POST` / `GET /{id}` / `PATCH`）的形状，`conversion_rate` 是 Frankfurter 原样返回的值；列表路径的 `conversion_rate` 会量化为 6 位小数（如 `"1.085400"`）(`backend/app/api/transactions.py:41-43, 252-254`)。

`DELETE /transactions/{id}` 返回 `{"deleted_count": 1, "message": "Transaction deleted successfully"}`；若该行属于转账对，返回 `{"deleted_count": 2, "message": "Transfer deleted successfully (2 transactions)"}` (`backend/app/api/transactions.py:456-468`)。

---

## 3. 仓库目录结构

只列前两层。标记含义：`[ignored]` = 被某个 `.gitignore` 忽略（根 `.gitignore:1-26`、`backend/.gitignore`、`frontend/.gitignore`）；`[generated]` = 工具生成、可安全删除；`[legacy]` = 保留但已被取代。

```text
wallet_app/
├── README.md                      根目录总览（部分过时，见 §5.5；最后修改 2026-05-11）
├── SPEC.md                        最初的产品 + 工程 spec，"v1.0, living document"（最后修改 2026-05-23）
├── .gitignore, .markdownlint.json
├── .claude/                       [ignored] 本地 agent 设置；worktrees/ 目录为空
├── .planning/                     GSD 规划语料（已提交，commit_docs=true）
│   ├── PROJECT.md, MILESTONES.md, STATE.md, ROADMAP.md, REQUIREMENTS.md, BACKLOG.md, config.json
│   ├── v1-MILESTONE-AUDIT.md      v1.0 收尾审计（2026-04-21）
│   ├── codebase/                  [generated 2026-05-24] ARCHITECTURE / STACK / STRUCTURE / CONVENTIONS / INTEGRATIONS / TESTING / CONCERNS
│   ├── milestones/                [legacy] 归档的 1.0-REQUIREMENTS.md、1.0-ROADMAP.md
│   ├── phases/                    01..06 — 每个 phase 的 PLAN / SUMMARY / CONTEXT / RESEARCH / VERIFICATION
│   └── research/                  v2.0 调研（STACK、FEATURES、ARCHITECTURE、PITFALLS），
│                                  ui-redesign-v2/（未实现的设计提案），m2-android-prior-art.md [legacy]
├── backend/                       Python 3.11 FastAPI 服务（Poetry）
│   ├── app/                       main.py, api/（4 个 router）, core/（config, database, security）,
│   │                              models/（4 个 ORM 类）, schemas/（Pydantic）, services/rates.py
│   ├── migrations/                Alembic env.py + versions/（6 个 revision，线性链）
│   ├── tests/                     pytest：conftest.py + 6 个测试模块（36 个测试函数）
│   ├── pyproject.toml, poetry.lock, alembic.ini, env.example, README.md, .dockerignore
│   ├── .env                       [ignored] 本地配置——本检出里指向 SQLite
│   ├── wallet_dev.db              [ignored][generated] SQLite 开发库（4 张表，无 alembic_version）
│   └── .pytest_cache/, **/__pycache__/   [ignored][generated]（字节码标记为 cpython-312 / pytest-9.0.2）
├── frontend/                      Expo SDK 54 应用（npm）
│   ├── App.tsx, index.ts, app.json, package.json, package-lock.json
│   ├── src/                       api/, components/, constants/, pwa/, screens/, store/, types/, utils/
│   ├── public/                    原样复制进导出目录的 PWA 静态文件：index.html, manifest.json,
│   │                              192/512/512-maskable/apple-touch-icon PNG, favicon.ico, pwa.css, offline.html
│   ├── scripts/                   generate-icons.mjs, verify-pwa.mjs, verify-touch-targets.mjs, w3c-manifest-schema.json
│   ├── __tests__/                 Jest 静态分析测试（5 个文件，64 个 it 块）
│   ├── assets/                    Expo 的 icon.png, adaptive-icon.png, splash-icon.png, favicon.png
│   ├── babel.config.js, jest.config.js, jest.setup.js, tsconfig.json, tailwind.config.js, workbox-config.cjs, app.d.ts
│   ├── README.md, START.md        [legacy] 最后修改 2025-10-29（中文），见 §5.5
│   ├── dist/                      [ignored][generated] `npm run build:web` 的输出（含 sw.js, workbox-*.js）
│   ├── node_modules/              [ignored][generated]
│   └── .expo/                     [ignored][generated] `expo start` 缓存
└── infra/                         Docker / Caddy / 运维
    ├── docker-compose.dev.yml     只有 Postgres（`db` 服务）
    ├── docker-compose.prod.yml    db + migrate + api + caddy，命名卷
    ├── Dockerfile.api             多阶段后端镜像（Poetry export → uv → python:3.11-slim，非 root）
    ├── Caddyfile                  同源网关，HSTS，ACME 端点来自环境变量
    ├── .env.example               已提交的模板，带 CHANGE_ME_* 哨兵；.env [ignored]（本检出中存在）
    ├── RUNBOOK.md                 1013 行的 Oracle A1.Flex 开机手册（Phase 6）
    ├── scripts/                   smoke.sh（Phase 4 门禁）, env-coverage.sh, verify-phase6.sh
    └── runbook-evidence/          只有 .gitkeep；*.png 被忽略
```

（依据：工作树的 `find` 列表；根 `.gitignore:11-26`；`frontend/.gitignore:1-35`；`backend/.gitignore:1-60`；`.planning/codebase/STRUCTURE.md:425-455`；`git log -1 -- README.md` 等。）

关于目录树的补充说明：

- `wallet-ui-design.zip` 被根 `.gitignore:22` 和 `.planning/codebase/STRUCTURE.md:154` 提到，但**本检出中不存在**；其解压内容放在 `.planning/research/ui-redesign-v2/` (`.planning/research/ui-redesign-v2/README.md:3-6`)。
- `backend/Dockerfile` 与 `backend/docker-compose.yml` 分别在提交 `bc97cde`（04-01，2026-05-11）和 `32a0f9e`（04-02，2026-05-11）中删除；`SPEC.md:126-128` 与 `SPEC.md:645` 仍然引用它们。
- 没有 `infra/README.md`；`infra/RUNBOOK.md` 是唯一的 infra 文档（`.planning/codebase/STRUCTURE.md:132` 写的是 "if exists"）。
- `.planning/codebase/` 下七份文档的 "Analysis Date" 都是 2026-05-24，晚于它们描述的大部分代码，但其中若干陈述已与代码不符（见 §5.5 末尾几行）。

---

## 4. 技术栈与精确版本

"声明"是清单文件里的约束；"锁定"是 `backend/poetry.lock`（`lock-version = "2.1"`，`poetry.lock:1904`）或 `frontend/package-lock.json`（`lockfileVersion: 3`，`package-lock.json:4`）里解析出的实际版本。

### 4.1 后端（`backend/pyproject.toml`、`backend/poetry.lock`）

| 组件 | 声明 | 锁定 | 用在哪里 |
|---|---|---|---|
| Python | `^3.11`（`pyproject.toml:10`）；镜像 `python:3.11-slim`（`infra/Dockerfile.api:22, 54`） | — | 本机 `__pycache__` 字节码标记为 `cpython-312`，即测试实际在 Python 3.12 下跑过（本机 `python3 --version` = 3.12.3）。本检出没有 `backend/.venv`，`poetry` 也不在 `PATH` 上。 |
| FastAPI | `^0.109.0` | **0.109.2**（Starlette 0.36.3） | `backend/app/main.py:4-15` |
| Uvicorn[standard] | `^0.27.0` | **0.27.1** | `infra/Dockerfile.api:78` |
| SQLAlchemy | `^2.0.25` | **2.0.44** | `backend/app/core/database.py:5-43` |
| Alembic | `^1.13.0` | **1.17.0** | `backend/alembic.ini:8`; `backend/migrations/env.py` |
| Pydantic | `^2.5.0` | **2.12.3**（pydantic-core 2.41.4） | `backend/app/schemas/*` |
| pydantic-settings | `^2.1.0` | **2.11.0** | `backend/app/core/config.py:5-38` |
| python-jose[cryptography] | `^3.3.0` | **3.5.0**（cryptography 46.0.3） | `backend/app/core/security.py:10, 59, 77` |
| bcrypt | `^5.0.0` | **5.0.0** | `backend/app/core/security.py:9, 27-37` |
| passlib[bcrypt] | `^1.7.4` | 1.7.4 | **只声明、未导入**（`backend/app` 中 0 处引用） |
| httpx | `^0.26.0` | **0.26.0** | `backend/app/services/rates.py:7, 42, 86` |
| tenacity | `^9.1.2` | **9.1.2** | `backend/app/services/rates.py:9, 18-23, 56-61` |
| psycopg2-binary | `^2.9.9` | **2.9.11** | Postgres 驱动（`DATABASE_URL=postgresql://…`） |
| email-validator | `^2.3.0` | **2.3.0** | `EmailStr`，`backend/app/schemas/user.py:10, 17` |
| python-multipart | `^0.0.6` | 0.0.6 | 只声明；代码中没有 `Form` / `UploadFile` 用法 |
| pytest / pytest-asyncio | `^7.4.0` / `^0.23.0` | 7.4.4 / 0.23.8 | `pyproject.toml:47-52`；本机缓存显示实际用的是 **pytest 9.0.2** |
| black / ruff / mypy | `^24.0.0` / `^0.1.0` / `^1.8.0` | 24.10.0 / 0.1.15 / 1.18.2 | `pyproject.toml:37-45`（line-length 100，ruff 规则 `E,F,I`） |
| PostgreSQL | — | 镜像 `postgres:15-alpine` | `infra/docker-compose.dev.yml:3`; `infra/docker-compose.prod.yml:7` |
| SQLite | — | 标准库 | `DATABASE_URL` 以 `sqlite` 开头时的开发兜底（`backend/app/core/database.py:19-30`） |
| Poetry（仅构建期） | — | `poetry==1.8.5` + `poetry-plugin-export>=1.8` | `infra/Dockerfile.api:34`（只用于导出 requirements；进入运行时阶段前卸载，48-49 行） |
| uv（仅构建期） | — | `ghcr.io/astral-sh/uv:latest` | `infra/Dockerfile.api:27, 41` |

### 4.2 前端（`frontend/package.json`、`frontend/package-lock.json`）

| 组件 | 声明 | 锁定 | 用在哪里 |
|---|---|---|---|
| Node.js | *没有 `engines` 字段* | — | `react-native@0.81.5` 与 `metro@0.83.2` 都声明 `engines.node >= 20.19.4`，`workbox-cli@7.4.1` 要求 `>=20.0.0`；本机 node v24.14.1、npm 11.11.0。`README.md:83` 写的是 "Node.js 18+"。 |
| expo | `~54.0.20` | **54.0.20** | `frontend/index.ts:1-8`; `app.json` |
| react-native | `0.81.5` | **0.81.5** | 所有 screen / component |
| react / react-dom | `19.1.0` | **19.1.0** | — |
| react-native-web | `^0.21.0` | **0.21.2** | `expo export -p web` 的 web 目标 |
| @tanstack/react-query | `^5.90.5` | **5.90.5** | `frontend/src/utils/queryClient.ts:6-19`；每个 screen |
| axios | `^1.13.0` | **1.13.0** | `frontend/src/api/client.ts:8-14` |
| @react-native-async-storage/async-storage | `^2.2.0` | **2.2.0** | 令牌 / 用户数据持久化（`client.ts:22, 60-61`; `AuthContext.tsx:46, 54`） |
| react-native-safe-area-context | `^5.6.1` | **5.6.1** | `App.tsx:3, 38`; `components/Screen.tsx:9` |
| expo-status-bar | `~3.0.8` | **3.0.8** | `App.tsx:1, 28` |
| typescript | `~5.9.2` | **5.9.3** | `tsconfig.json`（strict，`@/*` → `src/*`） |
| babel-preset-expo / babel-plugin-module-resolver | `^54.0.6` / `^5.0.2` | 54.0.6 / 5.0.2 | `babel.config.js:16-37` |
| jest / jest-expo | `^30.3.0` / `^55.0.13` | **30.3.0** / **55.0.13** | `jest.config.js`（testEnvironment `node`；没有引用 jest-expo 的 preset） |
| @testing-library/react-native | `^13.3.3` | 13.3.3 | 只声明；测试是基于 `fs.readFileSync` 的静态检查（`.planning/codebase/TESTING.md:100-104`） |
| workbox-cli（→ workbox-build） | `^7.4.1` | **7.4.1** | `package.json:10`; `workbox-config.cjs` |
| sharp | `^0.33.5` | 0.33.5 | `scripts/generate-icons.mjs` |
| ajv | `^8.20.0` | 8.20.0 | `scripts/verify-pwa.mjs` 的 manifest 校验 |
| @types/react / @types/jest | `~19.1.0` / `^30.0.0` | 19.1.17 / 30.0.0 | — |

**声明了但应用代码里没用到**（`frontend/src` + `App.tsx` 中 0 处 import，grep 核实）：`nativewind` 4.2.1 与 `tailwindcss` 3.4.18（没有任何 `className`；`tailwind.config.js` 和 `app.d.ts` 的 `nativewind/types` 引用仍在）、`@react-navigation/native` 7.1.19、`@react-navigation/native-stack` 7.6.1、`react-native-screens` 4.16.0、`react-hook-form` 7.65.0、`@hookform/resolvers` 5.2.2、`zod` 3.25.76、`react-native-reanimated` 4.1.3、`react-native-gesture-handler` 2.28.0、`react-native-worklets` 0.8.1（reanimated 的 Babel 插件只在 `react-native-worklets/plugin` 能解析且非测试模式时才加入，`babel.config.js:6-14, 27-29`）。`SPEC.md:449-461, 543-579` 记录了这种"迁移了一半"的状态。

### 4.3 基础设施

| 组件 | 版本 / 镜像 | 位置 |
|---|---|---|
| Docker Compose | v2 插件语法（`docker compose`）；本机 Docker 28.5.1、Compose v2.40.2 | 两个 compose 文件的头部注释；`infra/RUNBOOK.md:57-59` |
| Caddy | `caddy:alpine`（未固定版本） | `infra/docker-compose.prod.yml:62` |
| Postgres 调优 | `shared_buffers=3GB`、`effective_cache_size=8GB`、`max_connections=50`、`shm_size: 1g` | `infra/docker-compose.prod.yml:15-23` |
| 目标 VM（计划中） | Oracle Cloud Always Free `VM.Standard.A1.Flex`，2 OCPU / 12 GB，Ubuntu 24.04，ARM64；镜像只构建 arm64 | `.planning/ROADMAP.md:13-15`; `infra/scripts/smoke.sh:65-68` |
| TLS | `tls {$CADDY_TLS_MODE:internal}`（默认自签）；ACME CA 来自 `CADDY_ACME_CA`（默认 Let's Encrypt 正式端点） | `infra/Caddyfile:1-6`; `infra/.env.example:34-44` |
| 外部 API | Frankfurter（代码默认与 `backend/env.example` 为 `api.frankfurter.app`；`infra/.env.example` 为 `api.frankfurter.dev/v1`） | `backend/app/core/config.py:28`; `infra/.env.example:28` |

---

## 5. 本地运行——严格按脚本定义

### 5.1 后端

配置由 `pydantic-settings` 从环境变量和**当前工作目录**下的 `.env` 文件读取（`backend/app/core/config.py:33-38`），所以后端命令都在 `backend/` 目录下执行。什么都不设时的默认值：`DATABASE_URL=postgresql://wallet_user:wallet_password@localhost:5432/wallet_db`、`SECRET_KEY="your-secret-key-change-this-in-production"`、`DEBUG=False`、`ENVIRONMENT=development`、`ALLOWED_ORIGINS=http://localhost:8081,http://localhost:19006,http://localhost:3000`（`config.py:12-31`）。Postgres 默认值与 dev compose 的凭据一致（`infra/docker-compose.dev.yml:7-9`）。

按 `backend/README.md` 与根 `README.md` 记载的步骤：

```bash
# 1. Postgres（在仓库任何位置执行都行）
docker compose -f infra/docker-compose.dev.yml up -d db          # README.md:96 ; backend/README.md:51
#    -> 容器 wallet_db，端口 5432:5432，卷 postgres_data，healthcheck 用 pg_isready
#       (infra/docker-compose.dev.yml:2-18)

# 2. 依赖
cd backend
poetry install                                                    # backend/README.md:28
cp env.example .env   # 然后改 SECRET_KEY 等                       # backend/README.md:39-40 ; backend/env.example

# 3. 建表
poetry run alembic upgrade head                                   # backend/README.md:61
#    env.py 用 settings.DATABASE_URL 覆盖 sqlalchemy.url (backend/migrations/env.py:11-22)
#    revision 链: e533c88884b7 -> d671e51094c8 -> 5ca7fe6e37db -> 026ee0aecb66 -> 76227e076393 -> 8a4f4d66d893

# 4. 启动
poetry run uvicorn app.main:app --reload                          # backend/README.md:67  （绑定 127.0.0.1）
#  或
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000          # README.md:100        （绑定所有网卡）
#    -> http://localhost:8000 ，Swagger 在 /docs，ReDoc 在 /redoc，GET /health
```

SQLite 替代方案：设置 `DATABASE_URL=sqlite:///./wallet_dev.db`，引擎会去掉连接池参数并加上 `check_same_thread=False`（`backend/app/core/database.py:19-30`）。本检出里（gitignored 的）`backend/.env` 正是这样配置的，另外还有 `DEBUG=True`、`ENVIRONMENT=development`、`EXCHANGE_RATE_API_URL=https://api.frankfurter.dev/v1`，以及比默认值多出的两个 CORS 来源（`:8080`、`:19000`）（`backend/.env:1-10`）。磁盘上的 `backend/wallet_dev.db` 包含 `users`、`finance_sources`、`transactions`、`transaction_tags` 四张表，但**没有 `alembic_version` 表**，因此它不是 `alembic upgrade head` 产生的（用 `sqlite3` 读取 `sqlite_master` 核实）。迁移脚本本身是对着 Postgres 自动生成的：`76227e076393_add_default_source_to_users.py:12` 与 `8a4f4d66d893_add_transfer_pair_id_to_transactions.py:12` 都 `from sqlalchemy.dialects.postgresql import UUID`，`5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:40` 使用了 `postgresql_include` / `postgresql_nulls_not_distinct` 参数。

测试：`poetry run pytest`（`backend/README.md:152`；`pyproject.toml:47-52` 设定 `testpaths=["tests"]`、`asyncio_mode="auto"`）。`tests/conftest.py:10-11` 在导入应用之前用 `os.environ.setdefault` 强制 `DATABASE_URL=sqlite:///:memory:` 和测试用 `SECRET_KEY`，每个 session 建一次表，每个测试包在一个最终回滚的事务里并覆盖 `get_db`（`conftest.py:45-104`）。36 个测试函数分布在 `test_auto_default_source.py`（2）、`test_config.py`（4）、`test_conversion.py`（13）、`test_profile_structure.py`（8）、`test_session_persistence.py`（3）、`test_transactions_structure.py`（6）。一个与本检出相关的注意点：`tests/test_config.py:8, 14` 直接构造 `Settings()` 而不覆盖 `DEBUG`，而 `Settings` 会读取**当前工作目录**下的 `.env`（`config.py:33-38`）；本检出的 `backend/.env:7` 设了 `DEBUG=True`，因此若在 `backend/` 目录下带着这份 `.env` 运行 `pytest`，`test_debug_defaults_to_false` 与 `test_sql_echo_off_by_default` 会读到 `DEBUG=True`（`conftest.py:10-11` 只用 `setdefault` 强制了 `DATABASE_URL` 和 `SECRET_KEY`）。`backend/.pytest_cache/v/cache/lastfailed` 目前为空 `{}`，未记录任何失败。

### 5.2 前端——Web

```bash
cd frontend
npm install                                                       # README.md:106 ; frontend/README.md:9
npm run web        # = expo start --web                           # frontend/package.json:9 ; README.md:107
#    -> Metro 开发服务器，浏览器打开 http://localhost:8081            (frontend/START.md:10 ; README.md:111)
```

运行时 bundle 使用 `API_BASE_URL = 'http://localhost:8000/api/v1'`（`frontend/src/constants/config.ts:7`，与 `config.dev.ts` 逐字节相同，`cmp` 核实），所以 §5.1 的后端必须在 8000 端口跑着，且 `:8081` 必须在 `ALLOWED_ORIGINS` 里（默认就在，`config.py:25`；CORS 中间件 `main.py:17-24`）。启动时 `AuthProvider` 读取 `@wallet_app:auth_token`：没有令牌就直接进入未登录状态；有令牌则调用 `GET /auth/me`，成功即视为已登录，失败（进入 `catch`）才清空 `@wallet_app:auth_token` / `@wallet_app:user_data` 并回到未登录状态；未登录时显示 Login / Register 选项卡界面（`frontend/src/store/AuthContext.tsx:43-64`; `frontend/src/components/Navigation.tsx:13-47`）。Query 默认值：`retry 1`、`staleTime 5 分钟`、`gcTime 10 分钟`、`refetchOnWindowFocus false`、`refetchOnReconnect true`、mutation `retry 0`（`frontend/src/utils/queryClient.ts:6-19`）。

生产 Web 构建（Caddy 提供的就是它）：

```bash
npm run build:web
# = rm -rf dist
#   && cp src/constants/config.prod.ts src/constants/config.ts     # API_BASE_URL='/api/v1'
#   && expo export -p web                                          # -> dist/（public/* 被复制进去，Expo 注入 script 标签）
#   && npx workbox generateSW workbox-config.cjs                    # -> dist/sw.js（+ workbox-*.js）
#   && cp src/constants/config.dev.ts src/constants/config.ts      # 恢复开发配置
#                                                                  (frontend/package.json:10)
```

校验脚本：`npm test`（= `jest`，对源码字符串做静态测试，`package.json:12`、`jest.config.js:5`）；`npm run verify:phase5`（= build + `node scripts/verify-pwa.mjs --all` + `node scripts/verify-touch-targets.mjs` + `npm test`，`package.json:11`）。图标用 `node scripts/generate-icons.mjs` 从 `assets/adaptive-icon.png` 重新生成（`frontend/scripts/generate-icons.mjs:1-18`）。

### 5.3 前端——Android 手机（Expo Go）

脚本提供的命令：

```bash
cd frontend
npm start            # = expo start  -> 二维码 + exp://<lan-ip>:8081   (frontend/package.json:6 ; frontend/README.md:22)
npm run android      # = expo start --android（需要模拟器 / adb）        (frontend/package.json:7)
```

用同一 Wi-Fi 下手机上的 Expo Go 扫码（`frontend/README.md:22`）。`app.json` 启用了 new architecture 和 Android edge-to-edge（`frontend/app.json:9, 23`）。

代码对 API 地址的处理：`config.dev.ts` 把 `http://localhost:8000/api/v1` 写死，文件头注释说保留绝对地址是为了 "iOS simulator / Android emulator"（`frontend/src/constants/config.dev.ts:1-7`）。`frontend/src` 里**没有**任何环境变量或基于 `Platform` 的主机名覆盖（整个 `src/` 与 `App.tsx` 中 `process.env` / `EXPO_PUBLIC` 出现 0 次）。因此在真机上 `localhost` 会解析到手机自己，每个请求都会以拦截器的 `"Network error. Please check your connection."` 失败（`frontend/src/api/client.ts:71-73`）——除非开发者 (a) 手工把 `src/constants/config.ts` 改成笔记本的局域网 IP，并且 (b) 像 `README.md:100` 那样用 `--host 0.0.0.0` 启动 Uvicorn（`backend/README.md:67` 的写法只绑回环地址）。这一手工步骤在现有 README 里都没有写；唯一描述局域网 IP 工作流的是已删除 Android 分支归档下来的指南，而它引用的 `EXPO_PUBLIC_API_HOST` 机制在当前代码里**并不存在**（`.planning/research/m2-android-prior-art.md:26-46`）。原生构建（`eas build`）未配置（没有 `eas.json`）。

### 5.4 笔记本上的 Docker "生产形态"栈

栈的顺序是 `db` → `migrate`（一次性 `alembic upgrade head`，必须以 0 退出）→ `api`（healthcheck：Python `urllib` 每 15 秒 GET `http://localhost:8000/health`）→ `caddy`（`infra/docker-compose.prod.yml:33-79`，依赖条件在 42-44、51-53、77-79 行）。Caddy 把 `../frontend/dist:/srv:ro` 只读挂进容器，所以 Web 导出必须先存在（`docker-compose.prod.yml:74`; `infra/scripts/smoke.sh:49-51`）。

```bash
# 0. 从模板生成真实的 .env (infra/.env.example:3-6)
cp infra/.env.example infra/.env
#    把每个 CHANGE_ME_* 换掉（POSTGRES_USER/PASSWORD/DB，SECRET_KEY 用 `openssl rand -hex 32`，ALLOWED_ORIGINS，CADDY_DOMAIN）；
#    笔记本默认保持 CADDY_DOMAIN=localhost, CADDY_TLS_MODE=internal (infra/.env.example:36-37)；
#    但 CADDY_ACME_CA 必须填一个非空目录 URL（例如 .env.example:43 注释里的 staging URL）——按模板保持 CADDY_ACME_CA= 为空时 caddy 无法解析 Caddyfile 而反复重启（见 05 §4.3 / 06 H-09）
chmod 600 infra/.env

# 1. Web 导出（见 §5.2）
( cd frontend && npm install && npm run build:web )

# 2. 启动——两处写法不同，原样照录：
docker compose -f infra/docker-compose.prod.yml up -d --wait            # infra/docker-compose.prod.yml:2（仓库根目录执行；不加 --build 时复用已有的本地 tag wallet-app/api:local；tag 不存在时 Compose 先为带 build: 的 migrate 服务（34-36 行）构建该镜像，api（只有 image:，47 行）随后复用同一 tag（依据 Compose v2 的镜像准备顺序，本文档未实测））
( cd infra && docker compose -f docker-compose.prod.yml up -d --build --wait )   # infra/RUNBOOK.md:540（RUNBOOK 假定在 infra/ 目录下，且强制重新构建）
#    镜像标签 wallet-app/api:local，构建上下文 ../backend，Dockerfile 为 ../infra/Dockerfile.api（33-37 行）

# 3. 检查
curl -sIk https://localhost            # Caddy 返回 HTTP/2 200（tls internal，浏览器会警告）
curl -sk https://localhost/health        # 代理到 FastAPI；注意 smoke.sh:108-109 探测的 /api/v1/health 并不存在（返回 404，见 05 §6.2 / 06 M-09）
docker compose -f infra/docker-compose.prod.yml ps

# 4. 拆除（仅限笔记本——RUNBOOK 附录 C 禁止在 VM 上执行 `down -v`, RUNBOOK.md:959-968）
docker compose -f infra/docker-compose.prod.yml down -v        # infra/docker-compose.prod.yml:3
```

补充说明：`Dockerfile.api` 不固定平台（`infra/Dockerfile.api:11-14`；写死的 `--platform=linux/arm64` 在 `a5512f8`（2026-05-23）中移除），但 Phase 4 门禁 `bash infra/scripts/smoke.sh full` 会用 `--platform linux/arm64` 构建并断言 `Architecture == arm64` 且容器以 `uid 1000` 运行（`infra/scripts/smoke.sh:65-71`），所以宿主机必须能构建 arm64 镜像。`smoke.sh` 还会调用 `infra/scripts/env-coverage.sh`，后者在 `Settings` 的任一字段（`API_V1_PREFIX`、`PROJECT_NAME` 除外）缺席于 `.env.example` 时失败（`env-coverage.sh:17-34`）。HSTS（`max-age=31536000; includeSubDomains`）无条件输出，包括 `localhost`（`infra/Caddyfile:8`）。Phase 6 的静态检查：`bash infra/scripts/verify-phase6.sh quick`（`verify-phase6.sh:42-74`）。

### 5.5 现有 README 与代码不一致之处

只指出，不修改。

| 文档 | 说的是 | 代码 / 仓库实际 | 证据 |
|---|---|---|---|
| `README.md:5, 72-77` | "Status: M1 Core Complete"、"M2 (NEXT): Android mobile app"、M3–M6 路线图 | 里程碑 v1.0 已于 2026-04-21 发布；当前里程碑是 v2.0（Phase 4–7：容器化、PWA、Oracle VM、CI/CD）；Android 不是下一步 | `.planning/MILESTONES.md:3-30`; `.planning/ROADMAP.md:25-28` |
| `README.md:66-68`; `SPEC.md:658-676`; `.planning/BACKLOG.md:32-39` | AWS（ECS Fargate、RDS、S3 + CloudFront） | Oracle Cloud Always Free ARM VM + Docker Compose + Caddy；Cloudflare Registrar / DNS | `.planning/ROADMAP.md:11-16`; `infra/docker-compose.prod.yml`; `infra/RUNBOOK.md:1-7` |
| `README.md:83` | "Node.js 18+" | `react-native@0.81.5` 与 `metro@0.83.2` 要求 `node >= 20.19.4`（各自 `package.json` 的 `engines`） | `frontend/node_modules/react-native/package.json`、`…/metro/package.json` |
| `README.md:99` | `poetry install` 之后直接 `alembic upgrade head` | 只在激活了 Poetry 虚拟环境时有效；`backend/README.md:61` 用的是 `poetry run alembic upgrade head` | `backend/README.md:61` |
| `README.md:112-116`; `frontend/src/screens/LoginScreen.tsx:99-100` | 演示账号 `user@test.com / password123` | 仓库里没有任何 seed 脚本或 fixture 创建它（对 `*.py, *.ts, *.tsx, *.sh, *.sql, *.md` grep）；只有有人注册过它才存在 | grep 结果 |
| `README.md:23, 30` | "6 supported currencies" | 选择器通过 `GET /rates/currencies` 拉取 Frankfurter 的完整列表（线上实测 30 种）；6 项列表只是加载期间的兜底 | `frontend/src/screens/TransactionFormScreen.tsx:48-58` |
| `README.md:17, 44` | 资金账户支持 "cash"、"investments" | 后端 `type` 正则只接受 checking / savings / credit / other；前端选择器里的 `cash`、`investment` 会得到 `422` | `backend/app/schemas/finance_source.py:21-26`; `frontend/src/screens/FinanceSourceFormScreen.tsx:16` |
| `backend/README.md:56-62` | "Run Database Migrations (Will be added in Phase 1.2)" | 六个迁移早在 2025-10-28 就存在 | `backend/migrations/versions/` |
| `backend/README.md:182, 219` | "See PLAN.md" | 仓库根没有 `PLAN.md` | `ls PLAN.md` 不存在 |
| `backend/README.md:215-219` | Next steps："Complete Phase 1.2 / 1.3" | 2025-10 已完成 | git 历史 |
| `frontend/README.md:3, 50, 65-79` | NativeWind / Tailwind 的 `className` 是样式约定 | 0 处 `className`；所有样式都是 `StyleSheet.create` + 十六进制颜色 | grep; `SPEC.md:563-579` |
| `frontend/README.md:51` | React Navigation 负责路由 | 0 处 `@react-navigation/*` import；路由是 `Navigation.tsx` / `HomeScreen.tsx` 里的 `useState` | grep; `frontend/src/screens/HomeScreen.tsx:12-16` |
| `frontend/README.md:53` | React Hook Form + Zod 做表单 | 0 处 import；手写 `useState` 校验（例如 `LoginScreen.tsx:24` 要求密码 `< 6` 报错，而后端在 `schemas/user.py:11` 要求 ≥ 8） | grep |
| `frontend/README.md:35` | 有 `src/hooks/` 目录 | 不存在 | `ls frontend/src/hooks` 不存在 |
| `frontend/README.md:61` | 生产环境 API 地址 `https://api.yourapp.com/api/v1` | 生产用相对路径 `/api/v1`（通过 `build:web` 的配置文件替换） | `frontend/src/constants/config.prod.ts:5`; `package.json:10` |
| `frontend/README.md:87-95` | 示例用 `fetch('/api/v1/transactions')` | 所有调用都走带 JWT 拦截器的 axios `apiClient` | `frontend/src/api/client.ts:8-79` |
| `frontend/README.md:100-104` | `npx expo export:web` → `web-build/` | `npm run build:web`（`expo export -p web` + Workbox）→ `dist/`；没有 `web-build/` | `frontend/package.json:10`; `frontend/.gitignore:7-8` |
| `frontend/README.md:106-108` | `npx eas build --platform android` | 没有 `eas.json`；EAS 被推迟 | `.planning/REQUIREMENTS.md:74` |
| `frontend/START.md:6, 15` | 路径 `/home/ubwzwd/Coding/side_projects/wallet_app/frontend` | 仓库在 `/home/ubwzwd/Code/wallet_app` | 运行环境 |
| `frontend/START.md:53` | 第一屏是蓝色 "🎉 Wallet App" 卡片 | 第一屏是 Login / Register 选项卡 | `frontend/src/components/Navigation.tsx:21-47` |
| `SPEC.md:126-128, 645` | `backend/Dockerfile`、`backend/docker-compose.yml`、`cd backend && docker compose up -d` | 两个文件已删除（`bc97cde`、`32a0f9e`）；compose 文件在 `infra/` | git log |
| `SPEC.md:60` | 转账腿自动打保留标签 `transfer` | 代码里不存在这样的标签 | grep |
| `SPEC.md:494, 621` | base URL 为 `__DEV__ ? localhost : https://api.yourapp.com/api/v1` | dev/prod 配置文件替换；生产 URL 是相对的 `/api/v1` | `frontend/src/constants/config.prod.ts:5`; `package.json:10` |
| `SPEC.md:3-6` | "Version 1.0, Date 2026-04-27" | `SPEC.md` 最后一次提交是 `9a5668c`（2026-05-23）；文档只描述 v1.0 状态 | git log |
| `SPEC.md:541, 620` | `TransactionFormScreen` 为 1019 行 | 现为 1034 行 | `wc -l` |
| `.planning/codebase/ARCHITECTURE.md:145, 217` | `Transaction.owner_id`、`FinanceSource.owner_id` | 列名是 `user_id` | `backend/app/models/transaction.py:17`; `finance_source.py:17` |
| `.planning/codebase/ARCHITECTURE.md:168-172` | `rates.service.fetch_rate`，列表路径 `converted_amount = amount * rate` | 函数是 `convert_amount` / `fetch_latest_rates`；列表路径是**除以**批量汇率 | `backend/app/services/rates.py:62, 102`; `backend/app/api/transactions.py:252` |
| `.planning/codebase/CONCERNS.md:503` | "Transaction creation validates amount > 0 (line 141)" | `create_transaction`（`transactions.py:52-141`）和 schema 里都没有符号 / 零值检查 | `backend/app/schemas/transaction.py:19-23` |
| `.planning/codebase/INTEGRATIONS.md:26` | 表包括 "Account" | 只有四个模型：`User, FinanceSource, Transaction, TransactionTag` | `backend/app/models/__init__.py:6-9` |
| `.planning/codebase/STRUCTURE.md:96-100` | 四个前端测试文件 | 五个（Phase 5 新增 `Button.test.ts`） | `frontend/__tests__/` |

---

## 6. 项目历史

1. **2025-10-27 — 起步。** 首个提交加入了带 AWS 部署架构的 `SPEC.md`（`30d6ff9`）；2025-10-28 搭出 `backend/app`（`8ee3f61`，当时还带 `backend/Dockerfile` + `backend/docker-compose.yml`），六个 Alembic revision 同一天写完（`backend/migrations/versions/*.py` 的 `Create Date` 从 `2025-10-28 17:08` 到 `20:22`）；Expo 前端在 2025-10-29 初始化（`a922f72`，"with Expo and NativeWind"）。2025-10 共 46 个提交，之后五个月没有活动（`git log --date=format:%Y-%m` 统计）。
2. **2025-11 — Android 侧分支。** `feat/m2-android-mobile-support`（3 个提交，Expo Go + 局域网 IP 指南，末次提交 `1f45cc3` 于 2025-11-23）从未合并；2026-05-24 归档其指南到 `.planning/research/m2-android-prior-art.md:1-12` 后删除。
3. **2026-04-05 → 04-21 — v1.0 "Finish What's Started"。** GSD 规划从 2026-04-05 开始（`.planning/milestones/1.0-ROADMAP.md:131`）。Phase 1 把换算字段接入全部四个交易端点、用实时列表替换写死的 6 币种选择器、删除重复的 `delete_transaction` 处理函数、把 `DEBUG=False` 设为默认；Phase 2（2026-04-17 完成）做了带 `transfer_pair_id` 和客户端回滚的两步转账向导；Phase 3（2026-04-19 完成，`1.0-ROADMAP.md:11`）加了 `PATCH /auth/me`、`ProfileScreen` 和 `default_source_id` 自动赋值。审计 16/16 需求通过，13 项人工验证项被推迟（`.planning/v1-MILESTONE-AUDIT.md:62-81`）；2026-04-21 打 tag `v1.0`（`7d07c54`）（`.planning/MILESTONES.md:3-30`）。2026-04 共 75 个提交。
4. **2026-05-02 — 定义 v2.0 "Single-VPS Deployment + Mobile-Web Access"**：29 条需求分到 Phase 4–7，平台锁定为 Oracle A1.Flex ARM64（`.planning/ROADMAP.md:1-28`; `.planning/REQUIREMENTS.md:1-16`）。
5. **2026-05-11 → 05-22 — Phase 4 容器化**（6 个 plan）：`infra/Dockerfile.api`（Poetry export → uv → slim 运行时，非 root）、dev compose 迁到 `infra/`、`build:web` 里的 `config.dev.ts` / `config.prod.ts` 替换、`infra/.env.example` + `env-coverage.sh`、`docker-compose.prod.yml` + `Caddyfile`、`smoke.sh`（`.planning/STATE.md:57-64`；验证 5/5 自动项通过、2 项人工，`.planning/phases/04-containerize-and-compose-locally/04-VERIFICATION.md:1-6`）。
6. **2026-05-23 → 05-25 — Phase 5 PWA + 移动端打磨**（7 个 plan）：`public/` 的 manifest、图标、iOS meta、`pwa.css`、`offline.html`；Workbox service worker；通过 `Button.tsx` 实现 44×44 触控目标；`SafeAreaProvider`；`inputMode="decimal"`。验证 9/9，其中 MOBUI-05（真机安装）推迟到 Phase 6（`.planning/phases/05-pwa-ify-frontend-mobile-polish/05-VERIFICATION.md:4-12`）。2026-05 共 116 个提交。
7. **2026-05-25 → 05-26 — Phase 6 部分执行**：06-01（Caddyfile 加 `acme_ca` + HSTS，`CADDY_ACME_CA` 透传）、06-02（`verify-phase6.sh`）、06-03（SSH 端口 23333 修订）、06-04（`infra/RUNBOOK.md`）已完成；**06-05 / 06-06 / 06-07——真正的开 VM、切 Let's Encrypt 正式证书、UptimeRobot 演练——没有开始**（`.planning/STATE.md:43-48, 97-101`）。2026-05-24 收下了一份 UI 重设计提案但未实现（`.planning/research/ui-redesign-v2/README.md:1-31`）。
8. **Phase 7（CI/CD、R2 备份、零停机部署）未开始**（`.planning/STATE.md:37`; `.planning/ROADMAP.md:93-102`）。
9. **2026-09-03 — 最近一次活动**只是把 Phase 6 分支合进 `main` 的一个 merge 提交（`56881b2`）；自 2026-05-26（`e5f133b`，RUNBOOK 追加）以来 `backend/app`、`frontend/src`、`infra` 都没有改动。项目现在停在这里：本机与笔记本 compose 栈都能完整跑起来、已经 PWA 化，但还没有部署到公网主机。

---

## 7. 文档索引

- [`./01-domain-and-flows.md`](./01-domain-and-flows.md) — 上面这些实体的深入描述，以及每个用户可见流程按"客户端动作 → HTTP 请求 → 服务端逐项检查 → 数据库写入 → 响应 → 客户端状态变化"的编号步骤（注册 / 登录 / 会话、账户创建 / 归档、交易创建 / 编辑 / 删除、转账创建 / 编辑 / 删除、资料修改、换算），配状态图。
- [`./02-database.md`](./02-database.md) — 四张表逐列说明、索引、外键与级联、六个 Alembic revision 各改了什么，以及 Postgres 与 SQLite 之间会产生影响的差异。
- [`./03-backend-api.md`](./03-backend-api.md) — 每个端点的精确请求 / 响应 JSON、按代码顺序排列的校验规则与错误码、JWT 依赖、Frankfurter 服务与两条换算路径、settings / 环境变量契约。
- [`./04-frontend.md`](./04-frontend.md) — Provider 树、手写导航、`AuthContext` 生命周期、axios 拦截器、各屏幕的 TanStack Query 用法、每个屏幕的状态与校验、PWA / service worker 流水线、`build:web` 的配置替换。
- [`./05-infra-and-ops.md`](./05-infra-and-ops.md) — `Dockerfile.api` 逐阶段说明、两个 compose 文件、Caddyfile 的路由 / TLS / HSTS、`.env.example` 的键、`smoke.sh` / `env-coverage.sh` / `verify-phase6.sh`，以及 `RUNBOOK.md` 为 Oracle VM 规定的步骤。
- [`./06-known-issues.md`](./06-known-issues.md) — 汇总的缺陷与漂移清单（前端账户类型被后端拒绝、服务端无金额校验、非原子转账、README / SPEC / codebase 文档过时、未使用的依赖、env URL 不一致、没有 `alembic_version` 的 SQLite 开发库等），只写现象、证据和影响。
