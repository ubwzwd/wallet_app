# wallet_app v3.0 目标设计 — 总览与导读

> 这套文档描述的是 wallet_app **将要变成的样子**（to-be），不是它现在的样子。现状（as-is）由另一套文档 [`../current-design/`](../current-design/README.md) 描述，本套文档凡说"现状"都指那一套。
>
> 读者假设：一位没看过这个仓库的工程师。读完这六个文件应该能直接动手实现，不需要再去猜任何一个字段名、状态码或算法。
>
> 全部内容以 [`00-decisions.md`](./00-decisions.md) 为唯一事实来源；01–05 只能展开它，不能改写它。

---

## 0. 这套文档是什么、怎么读

| 文件 | 是什么 | 什么时候读它 |
|---|---|---|
| [`00-decisions.md`](./00-decisions.md) | **决策记录**。2026-09 设计评审逐条确认的结论，含评审后的补充裁定 §14。唯一事实来源 | 任何时候拿不准"到底定了什么"就回来查；它与 01–05 冲突时以它为准 |
| [`01-domain-and-flows.md`](./01-domain-and-flows.md) | 领域模型、四种 kind 的语义、端到端流程、ASCII 状态机、统计口径的精确定义与算例、不变量清单 | 先读这一章。它回答"这个产品在概念上是什么" |
| [`02-database.md`](./02-database.md) | 十张表的完整 Postgres DDL、ER 图、约束归属（数据库/应用层/无人保证）、索引、六步迁移链、数据生命周期、测试建表方式 | 要写模型或迁移时 |
| [`03-backend-api.md`](./03-backend-api.md) | 后端模块图、配置字段、鉴权、通用约定、**48 个端点逐个说明**、错误 code 唯一注册表、汇率服务、后台任务、限流、测试计划 | 要写接口或对接接口时 |
| [`04-frontend.md`](./04-frontend.md) | 路由与信息架构、全局状态、API 客户端与全部 TypeScript 类型、每个页面的交互、i18n、视觉重设计方向、前端测试 | 要写前端时 |
| [`05-import-and-llm.md`](./05-import-and-llm.md) | 账单导入流水线：上传 → 抽取 → 分块 → LLM → 归一化 → 自动标记 → 提交 / 撤销；含完整提示词、输出 JSON Schema、成本估算、安全与测试 | 要做导入功能时 |

**阅读顺序**：`00 → 01 → 02 → 03 → 04 → 05`。只想知道"改了什么"，读本文第 2 节的改动总览表即可。

**与 `../current-design/` 的关系**：01–05 与 current-design 的同名章节一一对应。凡描述现状的地方都带 `path:line` 引用指向仓库当前代码；凡描述目标的地方一律用 DDL / 伪代码 / 请求响应示例表达——**仓库里目前没有对应实现**。current-design 的 [`06-known-issues.md`](../current-design/06-known-issues.md) 里的问题，大部分在本套设计里被修掉了，各章会点名说明修的是哪一条。

**部署不在本套文档内**：决策 §0.1 明确沿用 [`../current-design/05-infra-and-ops.md`](../current-design/05-infra-and-ops.md) 的方案，本套文档不重写它；只有两处对 infra 的改动请求（上传目录的持久卷、uvicorn 的 `--proxy-headers`）记在各章的 `## 待决` 里。

---

## 1. 产品目标态一页纸

**给谁用**：作者本人 + 亲友。开放注册但可以用环境变量 `REGISTRATION_OPEN` 关掉（决策 §0.5、§9）。规模按"每本账 ≤10 人、每人 ≤10 本账"设计。

**能做什么**：

- 多人共享的**账本**：一本账里的账户、交易、导入记录对所有成员完全共享；owner 生成 6 位邀请码，对方线下拿到码就能加入（决策 §2）。
- 记四种账：**支出 / 收入 / 退款 / 转账**。退款可以关联到原支出并按退款日期冲减那笔支出的分类；转账分两腿（自己账户之间）和单腿（对方不在应用里），信用卡还款是转账的一个子类型（决策 §1）。
- 固定的两级分类表（16 个支出一级 + 6 个收入一级），写死在后端常量里，用户不能改（决策 §1.3）。
- **账单导入**：上传 PDF / CSV / XLSX / 图片 / 扫描件，用**你自己的** LLM API key 在服务端解析成草稿行，在一张 review 表格里逐行核对、补分类、标跳过，确认后一次性入账；整批可撤销（决策 §5、§6）。
- 多币种：每笔交易带自己的币种，统计和余额按**账本基准币种**折算；交易与统计用发生日汇率，账户余额用最新汇率（决策 §8）。
- 统计首页：账户余额与净资产、按月的一级分类收支（可下钻二级）、最近 12 个月趋势（决策 §7）。
- 界面中英双语，跟随系统语言，可手动切换（决策 §0.4）。响应式：窄屏底部 tab + 中央"记一笔"，宽屏侧边导航 + 宽内容区（决策 §0.6）。

**明确不做**（本版本，决策 §0.7）：预算、找回密码 / 邮箱验证、分类管理界面、标签、实时协同、移动 App、"不计收支"标记、交易时间（`occurred_at` 只到天）。

---

## 2. 改动总览

决策 §1–§9 的每一条改动，一句话说清，并给出影响的层与该读哪一节。"层"列：**DB** = [`02`](./02-database.md)，**API** = [`03`](./03-backend-api.md)，**前端** = [`04`](./04-frontend.md)，**导入** = [`05`](./05-import-and-llm.md)。

| 决策 | 改动一句话 | 层 | 去哪读 |
|---|---|---|---|
| §1 | 交易新增 `kind` 列（`expense` / `income` / `refund` / `transfer`），方向由 kind 决定，金额符号只是它的推论；四种之外不再加 | DB · API · 前端 · 导入 | [01 §2 交易的四种 kind](./01-domain-and-flows.md#2-交易的四种-kind) · [02 §1.7 transactions](./02-database.md#17-transactions) · [03 §5.29 POST transactions](./03-backend-api.md#529-post-apiv1ledgersidtransactions) · [04 §4.6 记一笔](./04-frontend.md#46-记一笔-lledgeridtransactionsnewkind) |
| §1.1 | 退款：自引用外键 `refund_of` 指向同账本的一条 `expense`，支持部分 / 超额退款，原单删除时置空 | DB · API · 前端 · 导入 | [01 §1.9 退款关联](./01-domain-and-flows.md#19-退款关联决策-11) · [01 §3.11 记退款](./01-domain-and-flows.md#311-记退款并关联原单决策-11) · [05 §8.2 refund_candidate](./05-import-and-llm.md#82-refund_candidate) |
| §1.2 | 转账：`transfer_role`（out/in）、`transfer_subtype`（plain/repayment）、可空的 `transfer_pair_id`、单腿的 `counterparty` 文本；两腿走独立端点、支持跨币种 | DB · API · 前端 · 导入 | [01 §1.10 转账腿](./01-domain-and-flows.md#110-转账腿决策-12) · [01 §3.12 两腿转账](./01-domain-and-flows.md#312-两腿转账的创建--编辑--删除决策-12) · [03 §5.33 POST transfer](./03-backend-api.md#533-post-apiv1ledgersidtransactionstransfer) · [05 §9.3 两腿转账的建法](./05-import-and-llm.md#93-两腿转账的建法还款是其中最常见的一种) |
| §1.3 | 两级分类冻结成后端常量（`category_l1` / `category_l2` 存 code），公开只读接口 + 前端永久缓存；**删除 `transaction_tags` 表与全部标签功能** | DB · API · 前端 · 导入 | [02 §1.7 transactions](./02-database.md#17-transactions) · [02 §5.5 删除 transaction_tags](./02-database.md#55-第-5-步删除-transaction_tags) · [03 §5.11 GET /categories](./03-backend-api.md#511-get-apiv1categories) · [04 §2.3 分类表缓存](./04-frontend.md#23-分类表启动拉取按-version-永久缓存决策-13) · [05 §5 提示词](./05-import-and-llm.md#5-提示词) |
| §1.4 | `transactions.description` 改名 `note`（≤500）；`merchant`（≤200）保留为独立字段，搜索 / 退款匹配 / 去重都靠它 | DB · API · 前端 | [02 §0.1 列级差异](./02-database.md#01-列级差异) · [02 §5.4 第 4 步](./02-database.md#54-第-4-步交易的-kind分类退款导入列) · [03 §5.29](./03-backend-api.md#529-post-apiv1ledgersidtransactions) |
| §2 | 新增 `ledgers` / `ledger_members` / `ledger_invites` 三张表；owner / member 两种角色；6 位一次性邀请码 10 分钟过期 | DB · API · 前端 | [01 §1.4–§1.6](./01-domain-and-flows.md#14-账本-ledgers决策-2) · [02 §1.3–§1.5](./02-database.md#13-ledgers) · [03 §5.12–§5.22](./03-backend-api.md#512-get-apiv1ledgers) · [04 §4.3 账本列表](./04-frontend.md#43-账本列表-ledgers新建-ledgersnew加入-ledgersjoin) |
| §2 | 账户 / 交易 / 导入全部改挂账本；所有业务接口前缀变成 `/api/v1/ledgers/{ledger_id}/...`，鉴权 = 当前用户是该账本成员 | DB · API · 前端 | [02 §5.3 第 3 步](./02-database.md#53-第-3-步账户与交易归属账本) · [03 §3.2 授权](./03-backend-api.md#32-授权账本成员) · [03 §4.6 账本 id 在路径里](./03-backend-api.md#46-账本-id-在路径里) · [04 §1.2 路由表](./04-frontend.md#12-路由表) |
| §2 | 乐观并发：`transactions` / `finance_sources` / `ledgers` 带 `updated_at`，PATCH 必须回传，不一致返回 409 `stale_update` | DB · API · 前端 | [01 §3.15 并发冲突](./01-domain-and-flows.md#315-乐观并发冲突409-stale_update决策-2) · [02 §7.3 updated_at](./02-database.md#73-updated_at-与乐观并发) · [03 §4.4 乐观并发](./03-backend-api.md#44-乐观并发决策-2) · [04 §3.8 409 的统一处理](./04-frontend.md#38-409-stale_update-的统一处理决策-2) |
| §3 | 账户加 `opening_balance`、`type` 增加 `cash`、加 `created_by`/`updated_by`；余额 = 期初 + 按发生日汇率折进账户币种的交易之和（决策 §14.2） | DB · API · 前端 | [01 §5.4 账户余额](./01-domain-and-flows.md#54-账户余额决策-3142) · [02 §1.6 finance_sources](./02-database.md#16-finance_sources) · [03 §5.23 GET sources](./03-backend-api.md#523-get-apiv1ledgersidsources) · [04 §4.8 账户列表](./04-frontend.md#48-账户列表-lledgeridsources) |
| §4 | 交易列表的筛选参数固定为 `q`/`kind`/`category_l1`/`category_l2`/`source_id`/`from`/`to`/`currency`/`min_amount`/`max_amount`/`limit`/`offset`，统一返回 `{items, total}` | API · 前端 | [03 §4.3 分页](./03-backend-api.md#43-分页) · [03 §5.28 GET transactions](./03-backend-api.md#528-get-apiv1ledgersidtransactions) · [04 §1.3 筛选写进 URL](./04-frontend.md#13-筛选条件写在-url-query-里) · [04 §4.5 交易列表](./04-frontend.md#45-交易列表-lledgeridtransactions) |
| §5 | 账单导入：新增 `import_batches` + `import_rows` 两张表，状态机 `uploaded → parsing → ready → committed`（`parsing → failed` 可重试），后台任务 + 数据库轮询 | DB · API · 前端 · 导入 | [01 §3.16 导入全流程](./01-domain-and-flows.md#316-账单导入全流程决策-5) · [01 §4.2 批次状态机](./01-domain-and-flows.md#42-导入批次决策-5) · [02 §1.8](./02-database.md#18-import_batches) · [03 §7 后台任务模型](./03-backend-api.md#7-后台任务模型) · [05 §0 流水线总览](./05-import-and-llm.md#0-流水线总览) |
| §5 | 服务端在 `ready` 时自动打 `duplicate` / `refund_candidate` / `repayment` 三种标记（外加 `needs_review`）；review 表格逐行可改、可跳过、必须补齐一级分类才能提交 | API · 前端 · 导入 | [05 §8 自动标记算法](./05-import-and-llm.md#8-自动标记算法) · [03 §5.42 GET rows](./03-backend-api.md#542-get-apiv1ledgersidimportsbidrows) · [04 §4.11 review 表格](./04-frontend.md#411-导入-review-表格statusready决策-5) |
| §5 | 提交在一个事务内建完所有交易（两腿一起建）并写 `import_batch_id`；`committed` 后整批可撤销（删这批建的交易，批次一并消失） | DB · API · 导入 | [05 §9 提交与撤销](./05-import-and-llm.md#9-提交commit与撤销) · [02 §6.6 丢弃与撤销](./02-database.md#66-导入批次的丢弃与撤销) · [03 §5.45 DELETE imports](./03-backend-api.md#545-delete-apiv1ledgersidimportsbid) |
| §5 | 限制：文件 ≤10 MB、单批 ≤2000 行、文本约 150 行一块、同一账本同时只允许一个批次在 `parsing` | DB · API · 导入 | [02 §3.1 数据库保证](./02-database.md#31-数据库保证) · [03 §5.38 POST imports](./03-backend-api.md#538-post-apiv1ledgersidimports) · [05 §3 分块](./05-import-and-llm.md#3-分块) |
| §6 | 每用户一份 `user_llm_settings`（base_url / api_key 密文 / model / vision_model），任何 OpenAI 兼容端点都行；设置页可"测试连接"；**没有服务端共享 key** | DB · API · 前端 · 导入 | [02 §1.2 user_llm_settings](./02-database.md#12-user_llm_settings) · [03 §5.7–§5.10](./03-backend-api.md#57-get-apiv1mellm-settings) · [04 §4.13 个人设置](./04-frontend.md#413-个人设置-settings-与-llm-设置-settingsllm) · [05 §4 LLM 调用](./05-import-and-llm.md#4-llm-调用) |
| §7 | 统计：按月一级分类收支（可下钻二级）、退款按退款日期冲减、转账不计入、最近 12 个月趋势，全部折到账本基准币种 | API · 前端 | [01 §5 统计口径](./01-domain-and-flows.md#5-统计口径的精确定义) · [03 §5.36 stats/summary](./03-backend-api.md#536-get-apiv1ledgersidstatssummary) · [04 §4.4 首页](./04-frontend.md#44-首页-lledgeridmonthyyyy-mm) |
| §8 | 汇率收敛成一个函数族（现状两套公式不一致的问题就此消除）：读取时计算、交易与统计用发生日汇率、余额用最新汇率、无行情日回退；重建 `exchange_rates` 缓存表（决策 §14.1） | DB · API | [01 §5.3 折算规则](./01-domain-and-flows.md#53-折算规则决策-8) · [02 §1.10 exchange_rates](./02-database.md#110-exchange_rates) · [03 §6 汇率服务](./03-backend-api.md#6-汇率服务) |
| §9 | 注册开关 `REGISTRATION_OPEN`、登录 / 邀请码 / 导入三处限流（外加"测试连接"与注册两处补充）、上传大小限制、管理员重置密码脚本 | API · 前端 | [03 §2.1 配置字段表](./03-backend-api.md#21-字段表) · [03 §8.2 各限流点](./03-backend-api.md#82-各限流点) · [04 §4.2 注册页](./04-frontend.md#42-注册-register) |
| §9 | 错误响应统一成 `{"detail": "...", "code": "snake_case_code"}`，code 有唯一注册表，前端按 code 查中英文案 | API · 前端 · 导入 | [03 §4.2 全局 code 清单](./03-backend-api.md#42-全局-code-清单) · [04 §3.7 错误归一化与文案](./04-frontend.md#37-错误归一化与-detail-code--文案) |
| §13 | 从现状迁移：一条 Alembic 迁移链接在 head `8a4f4d66d893` 之后，六步走完，空库与有数据的库都要跑通并有 Postgres 迁移测试 | DB | [02 §5 迁移计划](./02-database.md#5-迁移计划) · [02 §5.7 迁移链总览](./02-database.md#57-迁移链总览) · [03 §10.3 汇率与迁移](./03-backend-api.md#103-汇率与迁移) |

---

## 3. 术语表

| 中文 | 英文 / 标识符 | 一句话定义 |
|---|---|---|
| 账本 | ledger（`ledgers`） | 共享记账的容器。账户、交易、导入都属于某一本账；**基准币种属于账本**，不属于用户 |
| 成员 / 拥有者 | member / owner（`ledger_members.role`） | 账本里的人。owner 唯一，能改账本、生成邀请码、踢人、转让、删账本；member 能做其余一切 |
| 邀请码 | invite code（`ledger_invites.code`） | owner 生成的 6 位数字码，10 分钟有效、一次性使用，线下口头告诉对方 |
| 种类 | kind（`transactions.kind`） | 交易的四种统计口径：`expense` / `income` / `refund` / `transfer`。**只有统计口径不同的东西才成为 kind** |
| 退款关联 | refund link（`transactions.refund_of`） | 一条 `refund` 指向它冲减的那条 `expense`；可空，原单删除时自动置空 |
| 转账腿 / 单腿 | transfer leg / single-leg（`transfer_role`、`transfer_pair_id`） | 一次转账在库里是 1 行或 2 行。两腿共用一个 `transfer_pair_id`；对方不在应用里时只有 1 行，`transfer_pair_id` 为空、可填 `counterparty` 文本 |
| 子类型 | subtype（`transfer_subtype`） | 转账的两种：`plain`（普通划转）与 `repayment`（信用卡还款）。转账必填，非转账必须为空 |
| 导入批次 | import batch（`import_batches`） | 一次账单上传 = 一批。记目标账户、文件信息、状态、进度、所用模型、LLM 原始响应 |
| 草稿行 | draft row（`import_rows`） | LLM 解析出的一行，尚未成为正式交易。与 `transactions` 完全隔离，逐行可改、可跳过 |
| 待归类 | uncategorized | 草稿行 `category_l1` 为空且不是转账。review 表格标出来，**提交前必须补齐** |
| 基准币种 | base currency（`ledgers.base_currency`） | 这本账的统计口径。所有合计、趋势、净资产都折算到它 |
| 发生日汇率 | on-date rate | 用交易 `occurred_at` 当天（或往前最近一个已公布行情日）的汇率。交易与统计用它，一经公布不再变 |
| 最新汇率 | latest rate | 最近一个已公布行情日的汇率。账户余额折成基准币种时用它，回答"现在值多少钱" |
| 乐观并发 | optimistic concurrency（`updated_at` + 409 `stale_update`） | PATCH 带上你看到的 `updated_at`，服务端不一致就拒绝，前端提示重新加载。不做实时同步 |
| 自动标记 | flags（`import_rows.flags`） | 服务端在 `ready` 时打的提示：`duplicate` / `refund_candidate` / `repayment` / `needs_review`（外加归一化时的 `merged_duplicates`） |
| 错误 code 注册表 | error code registry | [03 §4.2](./03-backend-api.md#42-全局-code-清单) 的那张表。全仓库唯一，其他章只能引用不能自造 |

---

## 4. 目标目录结构

后端新增 / 重写的部分（完整模块图与函数签名见 [03 §1.1](./03-backend-api.md#11-目标模块图)）：

```text
backend/app/
  core/    deps.py[新] errors.py[新] categories.py[新] crypto.py[新] ratelimit.py[新]
  api/     me.py[新] categories.py[新] ledgers.py[新] stats.py[新] imports.py[新]
           finance_sources.py[重写] transactions.py[重写]
  schemas/ common.py[新] llm.py[新] category.py[新] ledger.py[新] stats.py[新] import_.py[新]
  services/
    fx.py[新]                统一汇率换算，取代现状的两套公式
    rates_client.py[改名]    Frankfurter HTTP 客户端
    llm_client.py[新]        OpenAI 兼容 /chat/completions
    stats.py[新]             汇总、趋势、账户余额
    ledger_service.py[新]    账本 / 成员 / 邀请码
    importing/[新]           账单导入包（见 05 §0.2）：
      pipeline.py  storage.py  chunking.py  normalize.py  flagging.py  commit.py
      extract/{pdf_text,tabular,raster}.py
      llm/{client,prompts,schema}.py
  models/  新增 UserLLMSettings / Ledger / LedgerMember / LedgerInvite /
           ImportBatch / ImportRow / ExchangeRate；删除 TransactionTag
backend/scripts/reset_password.py[新]
backend/tests/importing/[新]
```

前端新增 / 重写的目录（详见 [04 §3.1](./04-frontend.md#31-目录)）：

```text
frontend/src/
  api/       client.ts types.ts auth.ts me.ts llmSettings.ts categories.ts
             ledgers.ts sources.ts transactions.ts stats.ts imports.ts rates.ts
  queries/   keys.ts invalidate.ts useXxx.ts     ← 只管缓存语义，页面只 import 这里
  i18n/      语言包 zh / en（分类名不进语言包，见 04 §5.3）
  pages/     账本列表 / 首页 / 交易列表 / 记一笔 / 账户 / 导入（上传·进度·review·历史）/
             账本设置 / 个人设置
```

---

## 5. 实施顺序建议

只写**依赖关系导致的先后**，不写排期，也不含任何工时估计。

1. **schema 与迁移**：按 [02 §5](./02-database.md#5-迁移计划) 建十张表、跑通六步迁移链（空库 + 有数据的库 + Postgres 迁移测试）。后面所有东西都压在它上面。
2. **分类常量与汇率函数**：`core/categories.py`（[决策 §1.3](./00-decisions.md#13-分类固定常量)）与 `services/fx.py`（[03 §6](./03-backend-api.md#6-汇率服务)）。它们是纯函数，可以先写完并单测，交易接口和导入提示词都依赖它们。
3. **账本 / 成员 / 邀请码接口**：[03 §5.12–§5.22](./03-backend-api.md#512-get-apiv1ledgers)。所有业务路由的鉴权依赖 `get_ledger_member`，必须先有。
4. **交易接口重写**：账户接口（带余额）→ 交易 CRUD → 两腿转账端点（[03 §5.23–§5.35](./03-backend-api.md#523-get-apiv1ledgersidsources)）。
5. **统计接口**：[03 §5.36–§5.37](./03-backend-api.md#536-get-apiv1ledgersidstatssummary)，依赖第 2 步的汇率函数与第 4 步的数据。
6. **前端 API 层与页面**：先 `api/` + `queries/` + 错误文案表（[04 §3](./04-frontend.md#3-api-客户端层)），再登录 / 账本 / 首页 / 交易 / 账户各页。此时导入还不存在，产品已可用。
7. **导入流水线**：上传 → 抽取 → 分块 → 归一化 → 标记 → 提交 / 撤销（[05](./05-import-and-llm.md#0-流水线总览)）。可以先用假 LLM 服务器（[05 §12.3](./05-import-and-llm.md#123-假-llm-服务器)）把除模型调用外的全流程跑通。
8. **LLM 设置与 review 界面**：设置页 + 测试连接（[03 §5.10](./03-backend-api.md#510-post-apiv1mellm-settingstest)）→ 上传页 / 进度页 / review 表格（[04 §4.10–§4.11](./04-frontend.md#410-导入-lledgeridimports决策-5)）。review 表格是整个产品最重的一屏，放在功能稳定之后做。
9. **UI 视觉重设计**：按 [04 §6](./04-frontend.md#6-视觉重设计方向) 出 mockup 给用户看过（决策 §0.3），再统一替换 token 与组件。放最后，因为它改的是外观不是结构。

---

## 6. 待决汇总

各章 `## 待决` 的条目在这里汇总一次，供一次性决定。分三类：**已裁定**（不用再决定，只作记录）、**校对时统一**（本轮为消除跨章矛盾做的选择，请追认或推翻）、**仍需你决定**。

### 6.1 已由决策 §14 裁定（无需再决定）

| 来自 | 问题 | 裁定 |
|---|---|---|
| 01 待决 1 · 02 D-2 | `users.default_source_id` 怎么处置 | §14.6：删除该列，默认账户改由前端本地记住 |
| 01 待决 2 · 04 D-12 | 界面语言存哪 | §14.6：`users.language VARCHAR(8) NULL`，`zh`/`en`，NULL = 跟随系统 |
| 01 待决 3、4 | `user_llm_settings` / `ledger_invites` 要不要 `created_at` | §14.6：都要加 |
| 01 待决 5 · 02 D-1 · 03 待决 11 | `exchange_rates` 建不建、什么形状 | §14.1：新建 `(date, base, symbol, rate, fetched_at)`，主键 `(date, base, symbol)`，目标币种列叫 `symbol` |
| 01 待决 9 | 多币种账户余额怎么展示 | §14.2：不分币种桶，只回 `balance` / `balance_base` / `balance_rate` / `balance_rate_date` |
| 01 待决 10 | 错误 code 谁说了算 | §14.4：[03 §4.2](./03-backend-api.md#42-全局-code-清单) 是唯一注册表 |
| 05 待决 3 | 一行同时命中 `duplicate` 和 `refund_candidate` 时 `matched_transaction_id` 归谁 | §14.7：归退款候选；`refund_of` 只看"`kind='refund'` 且 `matched_transaction_id` 非空" |
| 各章 | `import_rows` 的行号列名 | §14.5：`row_no`（本轮统一为**从 1 起**） |
| 各章 | `kind` 能不能跨 `transfer` 边界互改 | §14.3：不能，400 `kind_change_not_allowed` |
| 各章 | 篇幅 | §14.8：行数只是参考，不作为验收项 |

### 6.2 校对时为消除跨章矛盾做的统一（请追认，或告诉我改回去）

这些问题决策记录没规定，而各章初稿写法互相冲突。本轮各选了一种并把相关章节改齐；每条都注明了代价。

| # | 冲突 | 统一为 | 代价 / 备选 |
|---|---|---|---|
| U-1 | 撤销一批已提交的导入之后，批次是保留成 `reverted` 还是整批删除（05 §9.5 原本保留，03 §5.45 与 02 §6.6 是删除） | **整批删除**：删交易 → 删批次 → 草稿行级联消失 → 删原文件。`status` 仍是决策 §5 的五个值 | 失去"这批当初导了什么、为什么撤销"的追溯能力。想要追溯就得加第六个状态 `reverted` + `reverted_at` 列并放宽 `ck_import_batches_committed_at` |
| U-2 | 解析进度的形态（05 原本是 0–1 的 `progress` 小数，03/04 是 `{done, total}`） | **两个整数列** `chunk_done` / `chunk_total`，接口回 `progress: {done, total}`，`total` 在抽取完成前为 `null` | 无。前端本来就要显示"第 3/12 块" |
| U-3 | 走没走视觉路径怎么记（05 原本提议 `parse_mode`，02/03/04 用 `used_vision`） | **`used_vision BOOLEAN`**，不加 `parse_mode` | 无 |
| U-4 | 时间戳存 naive UTC 还是 `timestamptz`（03 §4.5 原本写 `timestamptz`，02 §7.2 写 naive） | **naive UTC 存储 + API 输出一律带 `Z`** | 将来真要按用户时区展示时刻，得单独出一版迁移改三张表 |
| U-5 | `user_llm_settings` 的密钥列（03 原本写 `api_key_encrypted` + `api_key_last4` 两列，02 写单列 `api_key`） | **单列 `api_key` 存密文**（列名沿用决策 §6），`api_key_last4` 是响应字段，解密后现取 | 每次回显要解密一次（一次 Fernet 解密，可忽略）。02 待决 D-4 仍建议把列名改成 `api_key_encrypted` |
| U-6 | 导入包的模块划分（03 §1.1 原本写 `import_pipeline.py` + `extractors/`，05 §0.2 写 `importing/` 包） | **`services/importing/` 包**，文件划分以 05 §0.2 为准 | 无 |
| U-7 | `UPLOAD_DIR` 的默认值（03 写 `/data/uploads`，05 写 `./uploads`，05 待决 8 又写 `/var/lib/wallet/uploads`） | 字段默认 **`./uploads`**（开发可用），`.env` 模板与生产卷都用 **`/data/uploads`** | 无 |
| U-8 | 邀请码唯一索引的范围（03 §5.22 原本说"只对未使用未过期的行唯一"，02 §1.5 是全表唯一） | **全表唯一** + 定期清理（`now()` 不可变，做不了部分索引谓词） | 码空间 100 万，必须按 02 §6.3 清理，否则生成时冲突率上升 |
| U-9 | `GET /categories` 的 `version` 形态（04 D-8 原本建议内容哈希，03 §5.11 用日期串） | **日期串**（如 `"2026-09-09"`），改分类表时手工递增 | 无 |
| U-10 | 前端轮询导入进度的间隔（03 原写 1.5 s，04/05 写 2 s 起退避） | **2 s 起，逐步退避到 5 s，标签页隐藏时不轮询** | 无 |
| U-11 | 归一化时合并批内重复行要不要一个 `flags` 取值 | 保留 **`merged_duplicates`**，已同步进 02/03/04 | 它是决策 §5 三种标记 + `needs_review` 之外的**第五个**取值。不想要就删掉，改成只在 `note` 末尾写"（原文 N 行相同，已合并）" |

### 6.3 仍需你决定

按章列出，正文已按"建议默认值"书写但未拍板。

**来自 [01](./01-domain-and-flows.md#待决)（领域与流程）**

| # | 问题 | 建议默认值 |
|---|---|---|
| 01-6 | 同一账本内账户是否允许重名（与 02 D-5 是同一件事） | 允许，只在前端提示；不加唯一约束 |
| 01-7 | 成员退出 / 被移除后，他 `created_by` 的历史数据怎么显示 | 保留指向该用户，界面显示邮箱前缀，不做匿名化 |
| 01-8 | 用户退到 0 本账本时的落地页 | 进"新建账本 / 输入邀请码"引导页，而不是空首页 |
| 01-11 | 两腿转账 PATCH 用哪条腿的 `updated_at` 做并发比较 | 用两腿中较新的那个，服务端两腿一起比对 |
| 01-12 | 归档账户上的历史交易是否允许 PATCH | 允许（只禁止新建），否则记错的旧账无法更正 |

**来自 [02](./02-database.md#待决)（数据库）**

| # | 问题 | 建议默认值 |
|---|---|---|
| 02-D-3 | `import_rows` 的日期列叫 `date` 还是 `occurred_at`（决策 §5 的字段清单写 `date`，交易表用 `occurred_at`） | DB 列改叫 `occurred_at`，LLM 输出与 API 字段保持 `date`。**注意本轮各章正文一律按 `date` 写**，改名要一起改 02/03/04/05 |
| 02-D-4 | 密钥列名 `api_key` 还是 `api_key_encrypted`（见 U-5） | 改叫 `api_key_encrypted` 更不容易被误读为明文 |
| 02-D-6 | 已用 / 已过期邀请码何时删 | 生成新码前惰性清理本账本的 + 每日一次全表清理 |
| 02-D-7 | "每人 ≤10 本、每本 ≤10 人"要不要数据库约束 | 只做应用层 `COUNT(*)`；数据库侧要触发器，代价不值 |
| 02-D-9 | 迁移里回填不出 `ledger_id` 的行、以及 `amount = 0` 的历史行是删还是中止 | 删除并打 warning（现状只有测试数据）；不能容忍静默删除就改成 `raise` 中止迁移 |

**来自 [03](./03-backend-api.md#待决)（后端与接口）**

| # | 问题 | 建议默认值 |
|---|---|---|
| 03-1 | `/auth/me` 与 `/me` 并存多久 | `/auth/me` 作为 `/me` 的别名保留一个版本后删除；若前端不需要过渡期就直接不注册 |
| 03-2 | `PATCH /auth/me` 里的 `default_source_id` 字段 | 移除（该列已按 §14.6 删掉） |
| 03-3 | 成员的显示名（`users` 只有 email） | 加可空 `display_name`（≤40），`PATCH /me` 可改，不填时显示邮箱 `@` 前的部分 |
| 03-4 | `created_by` / `updated_by` 要不要在列表里展开成用户信息 | 只回 UUID，前端拿成员列表映射（最多 10 人） |
| 03-6 | 删除类端点的返回 | 统一 204 无体（`DELETE /imports/{bid}` 例外，要回撤销条数） |
| 03-7 | `GET /imports/{bid}` 要不要返回 `raw_response` | 只在 `DEBUG=true` 时返回；生产永远不返回 |
| 03-8 | 补充的两个限流点（"测试连接" 6 次/分钟、注册 5 次/小时） | 采纳；不采纳就把注册表里对应的两行 code 一起删 |
| 03-9 | 撤销导入产生的孤儿退款要不要在 `dry_run` 里报数 | 加一个 `orphaned_refunds` 计数让用户知情 |
| 03-10 | 退款把某分类的当月支出冲成负数时怎么办 | 照实返回负数，由前端决定怎么显示 |
| 03-12 | 汇率回退窗口 `FX_MAX_BACKFILL_DAYS` | 10 天（覆盖春节等长假），超过就落到 `/latest` 分支 |
| 03-13 | `occurred_at` 允许的最大未来日期 | 今天 + 1 天（容忍时区差），更远直接 422 |
| 03-14 | `limit` 上限（交易列表 200、导入草稿行 500） | 采纳 |
| 03-15 | uvicorn 要不要加 `--proxy-headers`（限流按真实 IP 计数需要） | 要加；属 infra 改动，本套文档不改 |
| 03-16 | `CATEGORY_VERSION` 的格式 | 日期串（见 U-9） |

**来自 [04](./04-frontend.md#待决)（前端）**

| # | 问题 | 建议默认值 |
|---|---|---|
| 04-D-1 | 路由库选 Expo Router v6 还是 `@react-navigation/native` + 手写 linking | Expo Router v6（Web 上是真实 URL，将来做 App 深链接零成本） |
| 04-D-2 | `/auth/me` 还是 `/me`（与 03-1 是同一件事） | 迁到 `/me`，`/auth` 下只留 register / login |
| 04-D-4 | 退款关联选择器要的"已退/可退"金额从哪来 | 给 `GET .../transactions` 加 `?with_refund_totals=1`，复用同一套筛选 |
| 04-D-5 | 前端怎么提前知道 `REGISTRATION_OPEN` | 加匿名可读的 `GET /api/v1/config` 回 `{registration_open}`；在此之前只按提交后的 403 处理 |
| 04-D-6 | 交易详情要显示"这笔支出被退了多少" | 详情响应里带 `refunds: RefundSummary[]`，或复用 D-4 |
| 04-D-7 | 交易列表能否按 `import_batch_id` 筛选 | 加 `?import_batch_id=` 参数 |
| 04-D-9 · 05-7 | 视觉路径的页面缩略图怎么给前端。**两章建议不同**：04 建议批次响应给 `pages: [{page_no, image_url}]` + `GET .../imports/{bid}/pages/{n}.png`；05 建议 `GET .../imports/{bid}/rows/{rid}/thumbnail` 现渲染 | 需要择一。缩略图本身不落库（02 D-8 已定），只是传输形态未定 |
| 04-D-11 | 要不要"按人筛选"（只看某成员记的账） | 本版本不做 |
| 04-D-13 | 视觉方向最终选 A / B / C 哪个 | 推荐 A「账本纸张」；以四张 mockup 确认为准 |

**来自 [05](./05-import-and-llm.md#待决)（导入与 LLM）**

| # | 问题 | 建议默认值 |
|---|---|---|
| 05-4 | 欧陆数字格式 `1.234,56` 是否支持 | 本版本不支持；命中启发式时整批打 `needs_review` 并提示 |
| 05-8 | `UPLOAD_DIR` 的生产卷 | `infra/docker-compose.prod.yml` 的 `api` 服务加 `wallet_uploads:/data/uploads`（属 infra 改动） |
| 05-9 | 一次导入是否允许多文件 | 不允许，一批一文件；多张截图分多批 |
| 05-10 | 2000 行上限是否含被合并、被跳过的行 | 含，以归一化后的行数计 |
| 05-11 | 不带 BOM 的 UTF-16 CSV | 不支持，提示用户另存为 UTF-8 |
| 05-12 | 提示词里要不要注入账本已有商户名以提高准确率 | 不注入（显著涨 token，且容易让模型对齐到错误的历史数据） |
| 05-13 | `merged_duplicates` 要不要在 review 表格里单独筛选（另见 U-11） | 要，和 `duplicate` / `needs_review` 一样是筛选器的一个选项 |
| 05-14 | `import_rows.status` 要不要第四个值 `committed` | 不要。"提交过没有"看 `transaction_id IS NOT NULL`，加了会丢掉 `edited` 标记 |

---

## 7. 文档规模

| 文件 | 行数 |
|---|---|
| [`00-decisions.md`](./00-decisions.md) | 220 |
| [`01-domain-and-flows.md`](./01-domain-and-flows.md) | 1270 |
| [`02-database.md`](./02-database.md) | 1447 |
| [`03-backend-api.md`](./03-backend-api.md) | 2978 |
| [`04-frontend.md`](./04-frontend.md) | 1784 |
| [`05-import-and-llm.md`](./05-import-and-llm.md) | 2387 |
| 本文 `README.md` | 336 |

各章都超出了最初给写作者的行数参考区间。这是**有意的**：决策 §14.8 明确"各章的行数目标只是参考，**不作为验收项**"，并且不得为压行数删掉被点名要求的内容，也不要把提示词、schema 拆到附录文件。十张表的完整 DDL、48 个端点的请求响应、完整的 system prompt 与输出 schema 必须一次给全，读者才能照着实现。行数只在这里作为一个规模参考，不代表质量。

---

## 8. 文档索引

- [`00-decisions.md`](./00-decisions.md) — 决策记录（唯一事实来源，含 §14 评审后的补充裁定）
- [`01-domain-and-flows.md`](./01-domain-and-flows.md) — 领域模型、流程、状态机、统计口径、不变量
- [`02-database.md`](./02-database.md) — 十张表的 DDL、ER 图、约束、索引、迁移链、生命周期
- [`03-backend-api.md`](./03-backend-api.md) — 模块图、配置、鉴权、48 个端点、错误 code 注册表、汇率、后台任务、限流、测试
- [`04-frontend.md`](./04-frontend.md) — 路由、状态、API 客户端与类型、页面、i18n、视觉方向、测试
- [`05-import-and-llm.md`](./05-import-and-llm.md) — 抽取、分块、提示词、输出 schema、归一化、自动标记、提交与撤销、成本、安全、测试

---

## 9. 校对记录

本轮（第二轮）除新增本文外，还以 [`00-decisions.md`](./00-decisions.md)（含 §14）为准，逐项核对并修改了 01–05。实际改动如下——**没有改 `00-decisions.md`，也没有改 `../current-design/`、`backend/`、`frontend/`、`infra/`、`.planning/`**。

**错误 code（决策 §14.4）**

- 03 §4.2 注册表新增 `rows_all_skipped`（409，commit 时所有行都被跳过），注册表从 44 条变 45 条；04 §3.7 的中英文案表同步新增一行，"覆盖全部 44 个 code"改成 45。
- 05 不再自造 code：`rows_all_skipped` 改成直接引用注册表；`batch_not_committed` 随 U-1 取消（撤销后批次不存在，重复调用是 404 `not_found`）。
- 全量比对：01/02/04/05 引用的每一个 code 都能在 03 §4.2 找到，零例外。

**列名与表结构**

- 02 §1.8 `import_batches` 补 `error_chunk`、`chunk_done`、`chunk_total`、`committed_transaction_count` 四列与 `ck_import_batches_chunks`；§1.9 `import_rows` 补 `transfer_role`（带 CHECK）与 `hint`；ER 图与 §3.1 的约束表同步更新。这几列此前只在 05 的正文与待决里出现，02 的 DDL 没有。
- 01 §1.11 的 `import_batches` 字段表按 02 改齐：`error` → `error_code` + `error_message` + `error_chunk`，`llm_raw_response` → `raw_response`，`model` 宽度 128 → 200，补 `used_vision` / 进度列 / `parsed_at` / `committed_at`；§1.12 补 `transfer_role` / `hint` / 时间戳，`source_ref` 宽度 64 → 200。
- 03 把 `llm_raw_response` 三处改成 `raw_response`，`import_batches.error` 改成 `error_message`。
- `api_key`：03 的 `api_key_encrypted` + `api_key_last4` 两列改成决策 §6 的单列 `api_key`（密文），last4 改为解密后现取（U-5）。
- `row_no`：02 的 CHECK 是 `row_no >= 1`，03 §5.42/§5.43 的示例原本从 0 开始，已改成 1、2；03 §5.42 的排序说明补上"从 1 起"。

**跨章矛盾（详见 §6.2 的 U-1 … U-11）**

- 撤销语义、进度形态、`used_vision`、时间戳存储、密钥列、导入包模块划分、`UPLOAD_DIR`、邀请码唯一索引、`version` 形态、轮询间隔、`merged_duplicates` 共 11 处，逐一统一并把相关章节全部改齐；05 的待决 1 / 2 / 5 / 6 / 6b / 15 / 16 / 17 相应标为"已落地"或"已统一"。
- 03 §7.1 的后台任务命名改成 `run_import_task`（async 薄包装）→ `importing.pipeline.run_import`，消除同名递归；§7.5 时序图同步。

**已核对无误、未作改动的项**

- 端点路径：01/03/04/05 出现的全部 `/api/v1/...` 路径与决策 §11 一致（03 里的 `/finance-sources`、`/transactions` 只出现在"现状 → 目标"的对照列）。
- 状态名 `uploaded`/`parsing`/`ready`/`committed`/`failed` 与行状态 `pending`/`edited`/`skipped`：各章一致（`reverted` 已按 U-1 移除）。
- 标记名 `duplicate`/`refund_candidate`/`repayment`/`needs_review`：一致；第五个 `merged_duplicates` 已按 U-11 同步。
- 分类 code：02/03/04/05 出现的每个 `category_l1` / `category_l2` 取值都在决策 §1.3 冻结的表内。
- 限制数值：10 MB、2000 行、150 行/块、6 位码、10 分钟、15 分钟 5 次、每小时 10 批、每分钟 10 次登录、10 本 / 10 人，各章一致。
- 余额口径（§14.2）、kind 互改规则（§14.3）、`exchange_rates` 的 `symbol` 列（§14.1）：01/02/03/04 均已按裁定写，本轮未发现残留。
- 每章 `## 另见` 都已链接 README、`00-decisions.md`、其余各章与相关的 `../current-design/` 章节。

---

## 另见

- [`00-decisions.md`](./00-decisions.md) — 决策记录，本文每一行都可以追溯到它的某一节
- [`../current-design/README.md`](../current-design/README.md) — 现状总览与产品范围
- [`../current-design/01-domain-and-flows.md`](../current-design/01-domain-and-flows.md) — 现状的记账模型与用户流程
- [`../current-design/02-database.md`](../current-design/02-database.md) — 现状的四张表与迁移历史
- [`../current-design/03-backend-api.md`](../current-design/03-backend-api.md) — 现状的接口清单
- [`../current-design/04-frontend.md`](../current-design/04-frontend.md) — 现状的前端结构
- [`../current-design/05-infra-and-ops.md`](../current-design/05-infra-and-ops.md) — 部署形态（决策 §0.1 沿用）
- [`../current-design/06-known-issues.md`](../current-design/06-known-issues.md) — 现状已知问题，本套设计修掉的那些都在里面能找到条目
