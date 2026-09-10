# wallet_app v3.0 目标设计 — 总览与导读

> 这套文档描述的是 wallet_app **将要变成的样子**（to-be），不是它现在的样子。现状（as-is）由另一套文档 [`../current-design/`](../current-design/README.md) 描述，本套文档凡说"现状"都指那一套。
>
> 读者假设：一位没看过这个仓库的工程师。读完这几个文件应该能直接动手实现，不需要再去猜任何一个字段名、状态码或算法。
>
> 全部内容以 [`00-decisions.md`](./00-decisions.md) 为唯一事实来源；01–05 只能展开它，不能改写它。视觉部分以 [`mockups/`](./mockups/README.md) 为唯一事实来源（决策 §14.45）。

---

## 0. 这套文档是什么、怎么读

**正文六件**（读完这六个就能动手）：

| 文件 | 是什么 | 什么时候读它 |
|---|---|---|
| [`00-decisions.md`](./00-decisions.md) | **决策记录**。2026-09 设计评审逐条确认的结论，含评审后的补充裁定 §14.1–§14.53。唯一事实来源 | 任何时候拿不准"到底定了什么"就回来查；它与 01–05 冲突时以它为准 |
| [`01-domain-and-flows.md`](./01-domain-and-flows.md) | 领域模型、四种 kind 的语义、端到端流程、ASCII 状态机、统计口径的精确定义与算例、不变量清单 | 先读这一章。它回答"这个产品在概念上是什么" |
| [`02-database.md`](./02-database.md) | 十张表的完整 Postgres DDL、ER 图、约束归属（数据库 / 应用层 / 无人保证）、索引、六步迁移链、数据生命周期、测试建表方式 | 要写模型或迁移时 |
| [`03-backend-api.md`](./03-backend-api.md) | 后端模块图、配置字段、鉴权、通用约定、**47 个端点逐个说明**、错误 code 唯一注册表、汇率服务、交易操作记录、限流、测试计划 | 要写接口或对接接口时 |
| [`04-frontend.md`](./04-frontend.md) | 路由与信息架构、全局状态、API 客户端与全部 TypeScript 类型、每个页面的交互、i18n、视觉实现规则、前端测试 | 要写前端时 |
| [`05-import-and-llm.md`](./05-import-and-llm.md) | 账单导入：标准 CSV 格式契约 → 同步校验 → 四种自动标记 → review 与提交 / 撤销；含 skill 全文、生成脚本、安全与测试 | 要做导入功能时 |

**视觉四件**（要动 UI 就得看）：

| 文件 | 是什么 | 什么时候读它 |
|---|---|---|
| [`mockups/README.md`](./mockups/README.md) | 设计稿目录说明：选定方向「04 柔和圆润」、16 张屏幕稿与两版 token 画板各是什么 | 打开 `mockups/` 之前先读它 |
| [`mockups/tokens.json`](./mockups/tokens.json) | **设计 token 的唯一来源**（决策 §14.45）：浅色 / 深色各 43 个语义色、七档字号、间距、圆角、阴影、控件尺寸、图标规格 | 写 `frontend/src/theme/tokens.ts` 或任何组件样式时；色值**只在这里**有一份 |
| [`mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md) | 16 张屏幕稿与决策记录的逐条比对（B = 与决策矛盾、A = 界面有而决策没有、C = 文案问题），每条附用户裁定 | 想知道某个界面细节"为什么是这样"时；结论已写进决策 §14.47–§14.52 |
| [`design-brief.md`](./design-brief.md) | 当初发给 Claude Design 的设计提示词（背景、逐屏要求、token 输出结构） | 要补画新屏幕、或要理解 token 命名从哪来时 |

**阅读顺序**：`00 → 01 → 02 → 03 → 04 → 05`，动 UI 之前再读 `mockups/README.md` + `tokens.json`。只想知道"改了什么"，读本文第 2 节的改动总览表即可。

**与 `../current-design/` 的关系**：01–05 与 current-design 的同名章节一一对应。凡描述现状的地方都带 `path:line` 引用指向仓库当前代码；凡描述目标的地方一律用 DDL / 伪代码 / 请求响应示例表达——**仓库里目前没有对应实现**。current-design 的 [`06-known-issues.md`](../current-design/06-known-issues.md) 里的问题，大部分在本套设计里被修掉了，各章会点名说明修的是哪一条。

**部署不在本套文档内**：决策 §0.1 明确沿用 [`../current-design/05-infra-and-ops.md`](../current-design/05-infra-and-ops.md) 的方案，本套文档不重写它。对 infra 只有一处改动请求：uvicorn 加 `--proxy-headers --forwarded-allow-ips=*`（限流要按真实 IP 计数，决策 §14.44 的 03-15，见 [03 §8.2](./03-backend-api.md#82-各限流点)）。后端没有任何文件系统状态，不需要持久卷（决策 §14.28）。

---

## 1. 产品目标态一页纸

**给谁用**：作者本人 + 亲友。开放注册但可以用环境变量 `REGISTRATION_OPEN` 关掉（决策 §0.5、§9）。规模按"每本账 ≤10 人、每人 ≤10 本账"设计。

**能做什么**：

- 多人共享的**账本**：一本账里的账户、交易、导入记录对所有成员完全共享；owner 生成 6 位邀请码（10 分钟有效、一次性、可主动作废），对方线下拿到码就能加入（决策 §2、§14.29、§14.52 A2）。
- 记四种账：**支出 / 收入 / 退款 / 转账**。退款可以关联到原支出并按退款日期冲减那笔支出的分类；转账分两腿（自己账户之间）和单腿（对方不在应用里），信用卡还款是转账的一个子类型；两条单腿转账事后可以**配对**成一笔，也可以**拆开**（决策 §1、§14.34）。
- 固定的两级分类表（16 个支出一级 + 6 个收入一级），写死在后端常量里，用户不能改；每个一级带一句归类判据说明（决策 §1.3、§14.20、§14.21）。
- **账单导入：应用不接入任何大模型**（决策 §5、§6、§14.25）。用户在**自己的 ChatGPT / Claude**（用自己的订阅）里装上我们提供的 **skill**，把任意账单（PDF、图片、Excel……）交给聊天工具整理成一份**标准导入文件**（固定 11 列的 CSV，首行带分类表版本号），再上传或粘贴到应用；应用只做**同步校验**（秒级）、打自动标记、进 review 表格逐行核对，确认后一次性入账，整批可撤销（决策 §14.47）。
- **交易操作记录**：每笔交易的创建 / 修改 / 导入 / 配对 / 拆开 / 退款关联变化都追加一条不可改的事件，交易详情页能看到"谁在什么时候改了什么"（决策 §14.51）。
- 多币种：每笔交易带自己的币种，统计和余额按**账本基准币种**折算；交易与统计用发生日汇率，账户余额用最新汇率（决策 §8、§14.1、§14.2）。
- 统计首页：账户余额与资产 / 负债 / 净资产三个数（归档账户不计入）、按月的一级分类支出与收入（可下钻二级）、最近 12 个月**支出**趋势（决策 §7、§14.50、§14.52 B20）。
- 界面中英双语，跟随系统语言，可手动切换；外观（跟随系统 / 浅色 / 深色）存本机、不上服务器（决策 §0.4、§14.52 A23）。响应式：窄屏底部 tab + 中央"记一笔"，宽屏（≥1024px）侧边导航 + 宽内容区（决策 §0.6）。

**明确不做**（本版本，决策 §0.7、§14.52 的"不做"清单）：预算、找回密码 / 邮箱验证、分类管理界面、标签、实时协同、移动 App、"不计收支"标记、交易时间（`occurred_at` 只到天）、**应用内调用大模型**（API key、模型设置、服务端解析）、导出 CSV、通知、按成员筛选。

---

## 2. 改动总览

决策 [`00-decisions.md`](./00-decisions.md) §1–§14 的每一条改动，一句话说清，并给出影响的层与该读哪一节。"层"列：**DB** = [`02`](./02-database.md)，**API** = [`03`](./03-backend-api.md)，**前端** = [`04`](./04-frontend.md)，**导入** = [`05`](./05-import-and-llm.md)。

### 2.1 §1–§13 的主体改动

| 决策 | 改动一句话 | 层 | 去哪读 |
|---|---|---|---|
| §1 | 交易新增 `kind` 列（`expense` / `income` / `refund` / `transfer`），方向由 kind 决定，金额符号只是它的推论；四种之外不再加 | DB · API · 前端 · 导入 | [01 §2 交易的四种 kind](./01-domain-and-flows.md#2-交易的四种-kind) · [02 §1.6 transactions](./02-database.md#16-transactions) · [03 §5.26 POST transactions](./03-backend-api.md#526-post-apiv1ledgersidtransactions) · [04 §4.6 记一笔](./04-frontend.md#46-记一笔-lledgeridtransactionsnewkind) |
| §1.1 | 退款：自引用外键 `refund_of` 指向同账本的一条 `expense`，支持部分 / 超额退款（超额只警告不拦），原单删除时置空 | DB · API · 前端 · 导入 | [01 §1.8 退款关联](./01-domain-and-flows.md#18-退款关联决策-11) · [01 §3.12 记退款](./01-domain-and-flows.md#312-记退款并关联原单决策-111452-a20) · [03 §5.27 交易详情](./03-backend-api.md#527-get-apiv1ledgersidtransactionstid) · [05 §3.2 refund_candidate](./05-import-and-llm.md#32-refund_candidate) |
| §1.2 | 转账：`transfer_role`（out/in）、`transfer_subtype`（plain/repayment）、可空的 `transfer_pair_id`、单腿的 `counterparty` 文本；两腿走独立端点、支持跨币种、金额不要求相等 | DB · API · 前端 · 导入 | [01 §1.9 转账腿](./01-domain-and-flows.md#19-转账腿决策-121434) · [01 §3.13 两腿转账](./01-domain-and-flows.md#313-两腿转账的创建--编辑--删除决策-121452-a11) · [03 §5.30 POST transfer](./03-backend-api.md#530-post-apiv1ledgersidtransactionstransfer) · [05 §4.5 转账的三种落地方式](./05-import-and-llm.md#45-转账的三种落地方式) |
| §1.3 | 两级分类冻结成后端常量（`category_l1` / `category_l2` 存 code），公开只读接口 + 前端永久缓存；一级带 `desc_zh` / `desc_en` 判据文字；**删除 `transaction_tags` 表与全部标签功能** | DB · API · 前端 · 导入 | [01 §2.3 分类的边界与说明文字](./01-domain-and-flows.md#23-分类的边界与说明文字决策-1314201421) · [02 §5.5 删除 transaction_tags](./02-database.md#55-第-5-步删除-transaction_tags) · [03 §5.5 GET /categories](./03-backend-api.md#55-get-apiv1categories) · [04 §2.3 分类表缓存](./04-frontend.md#23-分类表启动拉取按-version-永久缓存决策-13) |
| §1.4 | `transactions.description` 改名 `note`（≤500）；`merchant`（≤200）保留为独立字段，搜索 / 退款匹配 / 去重都靠它；转账行不设 `merchant` | DB · API · 前端 | [02 §0.1 列级差异](./02-database.md#01-列级差异) · [02 §5.4 第 4 步](./02-database.md#54-第-4-步交易的-kind分类退款导入列) · [03 §5.26](./03-backend-api.md#526-post-apiv1ledgersidtransactions) |
| §2 | 新增 `ledgers` / `ledger_members` / `ledger_invites` 三张表；owner / member 两种角色；6 位一次性邀请码 10 分钟过期，用掉即删、过期即删、可主动作废 | DB · API · 前端 | [01 §1.3–§1.5](./01-domain-and-flows.md#13-账本-ledgers决策-2) · [02 §1.2–§1.4](./02-database.md#12-ledgers) · [03 §5.8–§5.19](./03-backend-api.md#58-get-apiv1ledgers) · [04 §4.3 账本列表](./04-frontend.md#43-账本列表-ledgers新建-ledgersnew加入-ledgersjoin) |
| §2 | 账户 / 交易 / 导入全部改挂账本；所有业务接口前缀变成 `/api/v1/ledgers/{ledger_id}/...`，鉴权 = 当前用户是该账本成员 | DB · API · 前端 | [02 §5.3 第 3 步](./02-database.md#53-第-3-步账户与交易归属账本) · [03 §3.2 授权](./03-backend-api.md#32-授权账本成员) · [03 §4.6 账本 id 在路径里](./03-backend-api.md#46-账本-id-在路径里) · [04 §1.2 路由表](./04-frontend.md#12-路由表) |
| §2 | 乐观并发：`transactions` / `finance_sources` / `ledgers` 带 `updated_at`，PATCH 必须回传，不一致返回 409 `stale_update`（两腿转账两条腿都比对，§14.40） | DB · API · 前端 | [01 §3.16 并发冲突](./01-domain-and-flows.md#316-乐观并发冲突409-stale_update决策-2) · [02 §7.3 updated_at](./02-database.md#73-updated_at-与乐观并发) · [03 §4.4 乐观并发](./03-backend-api.md#44-乐观并发决策-2) · [04 §3.8 409 的统一处理](./04-frontend.md#38-409-stale_update-的统一处理决策-2) |
| §3 | 账户加 `opening_balance`、`archived_at`；`type` **四选一** `checking` / `credit` / `cash` / `other`；`default_currency` 创建后不可改；余额 = 期初 + 按发生日汇率折进账户币种的交易之和 | DB · API · 前端 | [01 §5.4 账户余额](./01-domain-and-flows.md#54-账户余额决策-3142) · [02 §1.5 finance_sources](./02-database.md#15-finance_sources) · [03 §5.20 GET sources](./03-backend-api.md#520-get-apiv1ledgersidsources) · [04 §4.8 账户列表](./04-frontend.md#48-账户列表-lledgeridsources) |
| §4 | 交易列表的筛选参数固定为 `q`/`kind`/`category_l1`/`category_l2`/`source_id`/`from`/`to`/`currency`/`min_amount`/`max_amount`/`import_batch_id`/`limit`/`offset`，返回 `{items, total, summary}` | API · 前端 | [03 §4.3 分页](./03-backend-api.md#43-分页) · [03 §5.25 GET transactions](./03-backend-api.md#525-get-apiv1ledgersidtransactions) · [04 §1.3 筛选写进 URL](./04-frontend.md#13-筛选条件写在-url-query-里) · [04 §4.5 交易列表](./04-frontend.md#45-交易列表-lledgeridtransactions) |
| §5 | **账单导入整体改写**：标准 CSV 是唯一契约，服务端**同步校验**（无后台任务、无进度、无轮询），状态机只有 `ready → committed`，撤销 = 整批删除；新增 `import_batches` + `import_rows` 两张表 | DB · API · 前端 · 导入 | [01 §3.17 导入全流程](./01-domain-and-flows.md#317-账单导入全流程决策-5614251447) · [01 §4.3 批次状态机](./01-domain-and-flows.md#43-导入批次决策-514221425) · [02 §1.7 import_batches](./02-database.md#17-import_batches) · [03 §5.37 POST imports](./03-backend-api.md#537-post-apiv1ledgersidimports) · [05 §1 标准导入格式](./05-import-and-llm.md#1-标准导入格式唯一契约) |
| §5 | 校验分三层，顺序是**解码 → 结构 → 版本 → 行级**：结构错 400 `import_format_invalid`（按物理行号列出，不建批次）；版本行在但对不上 400 `skill_outdated`；行级问题不丢行、只改值并写 `hint` | API · 前端 · 导入 | [05 §2 校验](./05-import-and-llm.md#2-校验服务端同步完成) · [05 §2.8 规则速查表](./05-import-and-llm.md#28-规则速查表) · [04 §4.10 导入](./04-frontend.md#410-导入-lledgeridimports决策-56) |
| §5 | 服务端在 `ready` 时自动打 **四种**标记：`duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review`；批内完全相同的行都保留、都打 `needs_review`，不合并 | API · 前端 · 导入 | [05 §3 自动标记](./05-import-and-llm.md#3-自动标记) · [05 §2.7 批内重复行不合并](./05-import-and-llm.md#27-批内重复行不合并决策-1431) · [04 §4.11 review 表格](./04-frontend.md#411-导入-review-表格statusready决策-5) |
| §5 | 提交在一个事务内建完所有交易（两腿一起建）并写 `import_batch_id`；`committed` 后整批可撤销（删这批建的交易，批次一并消失，`dry_run` 先给两个计数） | DB · API · 导入 | [05 §4.7 事务边界](./05-import-and-llm.md#47-事务边界) · [05 §4.8 撤销与 dry_run](./05-import-and-llm.md#48-撤销与-dry_run) · [02 §6.6 丢弃与撤销](./02-database.md#66-导入批次的丢弃与撤销) · [03 §5.44 DELETE imports](./03-backend-api.md#544-delete-apiv1ledgersidimportsbid) |
| §5 | 限制：文件 / 粘贴文本 ≤**2 MB**、单批 ≤**2000 行**、每用户每小时 10 批；**不保存上传的文件**，只记文件名与大小 | DB · API · 导入 | [02 §1.7 import_batches](./02-database.md#17-import_batches) · [03 §8.2 各限流点](./03-backend-api.md#82-各限流点) · [05 §2.6 上限](./05-import-and-llm.md#26-上限) · [05 §4.11 不保存文件](./05-import-and-llm.md#411-不保存文件决策-1428) |
| §6 | **"LLM 设置与接口"整节改写为"导入 skill"**：应用不存任何模型设置、没有 API key、没有"测试连接"；skill 是仓库交付物 `skills/wallet-import/`，由脚本从分类表常量生成，应用内有"导入指南"页与公开的 `GET /import-format` | API · 前端 · 导入 | [05 §5 skill 规范](./05-import-and-llm.md#5-skill-规范) · [05 §5.4 生成脚本](./05-import-and-llm.md#54-生成脚本-scriptsgen_import_skillpy) · [05 §5.5 导入指南页](./05-import-and-llm.md#55-应用内导入指南页与-get-import-format) · [03 §5.7 GET /import-format](./03-backend-api.md#57-get-apiv1import-format) |
| §7 | 统计：按月一级分类收支（可下钻二级）、退款按退款日期冲减、转账不计入、最近 12 个月**只放支出**趋势，全部折到账本基准币种；首页给资产 / 负债 / 净资产三个数 | API · 前端 | [01 §5 统计口径](./01-domain-and-flows.md#5-统计口径的精确定义) · [01 §5.5 净资产](./01-domain-and-flows.md#55-资产负债与净资产决策-71450) · [03 §5.35 stats/summary](./03-backend-api.md#535-get-apiv1ledgersidstatssummary) · [04 §4.4 首页](./04-frontend.md#44-首页-lledgeridmonthyyyy-mm) |
| §8 | 汇率收敛成一个函数族（现状两套公式不一致的问题就此消除）：读取时计算、交易与统计用发生日汇率、余额用最新汇率、无行情日回退（窗口 10 天）；重建 `exchange_rates` 缓存表 | DB · API | [01 §5.3 折算规则](./01-domain-and-flows.md#53-折算规则与日期规则决策-81432) · [02 §1.10 exchange_rates](./02-database.md#110-exchange_rates) · [03 §6 汇率服务](./03-backend-api.md#6-汇率服务) |
| §9 | 注册开关 `REGISTRATION_OPEN`、四处限流（登录同 IP 10 次/分钟、注册同 IP 5 次/小时、加入账本端点全局 1 QPS、导入每用户 10 批/小时）、上传 ≤2 MB、管理员重置密码脚本 | API · 前端 | [03 §2.1 配置字段表](./03-backend-api.md#21-字段表) · [03 §8.2 各限流点](./03-backend-api.md#82-各限流点) · [04 §4.2 注册页](./04-frontend.md#42-注册-register) |
| §9 | 错误响应统一成 `{"detail": "...", "code": "snake_case_code"}`，code 有**唯一注册表**（44 条），前端按 code 查中英文案，两份清单双向对拍 | API · 前端 · 导入 | [03 §4.2 全局 code 清单](./03-backend-api.md#42-全局-code-清单) · [04 §3.7 错误归一化与文案](./04-frontend.md#37-错误归一化与-detail-code--文案) |
| §10 | 目标 schema **十张表**（§10 的九张 + §14.51 的 `transaction_events`），枚举一律 `VARCHAR + CHECK`；`transactions` 的七条关键约束逐条落进 DDL | DB | [02 §0 目标表清单](./02-database.md#0-总览目标表清单与对现状的差异) · [02 §3.1 数据库保证](./02-database.md#31-数据库保证) · [01 §6.1 数据库保证](./01-domain-and-flows.md#61-数据库保证check--unique--外键决策-10) |
| §11 | API 目录定为 **47 条业务路由**（5 条沿用现状路径 + 9 条改前缀 + 33 条新增），含 `/config`、`/import-format`、pair / unpair、邀请码作废、草稿行批量 PATCH | API · 前端 | [03 §0 差异总览](./03-backend-api.md#0-与现状的差异总览) · [03 §5 接口逐个说明](./03-backend-api.md#5-接口逐个说明) · [04 §3.4 函数清单](./04-frontend.md#34-函数清单与决策-11-逐条对应) |
| §12 | 前端页面与路由定型（登录 / 注册 / 账本 / 首页 / 交易 / 记一笔 / 账户 / 导入 / 账本设置 / 个人设置），当前账本 id 与筛选条件都写进 URL；技术栈沿用 Expo / react-native-web / TanStack Query / axios | 前端 | [04 §1 信息架构](./04-frontend.md#1-信息架构与导航) · [04 §1.2 路由表](./04-frontend.md#12-路由表) · [04 §3 API 客户端层](./04-frontend.md#3-api-客户端层) |
| §13 | 从现状迁移：一条 Alembic 迁移链接在 head `8a4f4d66d893` 之后，六步走完，空库与有数据的库都要跑通并有 Postgres 迁移测试 | DB | [02 §5 迁移计划](./02-database.md#5-迁移计划) · [02 §5.7 迁移链总览](./02-database.md#57-迁移链总览) · [02 §8.2 Postgres 迁移测试](./02-database.md#82-postgres-迁移测试postgres-marker) |

### 2.2 §14.1–§14.19：第一轮评审后的补充裁定

这一批多数已被后来的改版吸收或作废，仍然有效的写在这里（作废的见 §6.2）。

| 决策 | 改动一句话 | 层 | 去哪读 |
|---|---|---|---|
| §14.1 | `exchange_rates` 用**新形状**重建：`(date, base, symbol, rate, fetched_at)`，主键 `(date, base, symbol)`；目标币种列叫 `symbol` 不叫 `quote`；upsert 保留全部历史行，不整表刷新 | DB · API | [02 §1.10 exchange_rates](./02-database.md#110-exchange_rates) · [02 §6.8 汇率缓存](./02-database.md#68-汇率缓存exchange_rates) · [03 §6.1 与现状的关系](./03-backend-api.md#61-与现状的关系) |
| §14.2 | 账户余额以账户 `default_currency` 计价，另给 `balance_base` / `balance_rate` / `balance_rate_date`；**不按币种分桶** | API · 前端 | [01 §5.4 账户余额](./01-domain-and-flows.md#54-账户余额决策-3142) · [03 §5.20 GET sources](./03-backend-api.md#520-get-apiv1ledgersidsources) |
| §14.3 | `expense` / `income` / `refund` 之间可 PATCH 改 `kind`；`transfer` 与非 `transfer` 之间**禁止互改**，400 `kind_change_not_allowed` | API · 前端 | [01 §2.4 允许的编辑](./01-domain-and-flows.md#24-允许的编辑) · [01 §4.1 交易状态图](./01-domain-and-flows.md#41-交易按-kind-的允许迁移) · [03 §5.28 PATCH transactions](./03-backend-api.md#528-patch-apiv1ledgersidtransactionstid) |
| §14.4 | 错误 code 的**唯一注册表**是 03 §4.2；01 / 02 / 04 / 05 只能引用，不许自造同义名 | API · 前端 · 导入 | [03 §4.2 全局 code 清单](./03-backend-api.md#42-全局-code-清单) · [04 §3.7 文案表](./04-frontend.md#37-错误归一化与-detail-code--文案) |
| §14.5 · §14.41 | `import_rows` 的行号列叫 `row_no`（从 1 起）；日期列与交易表一致叫 `occurred_at`，**导入文件与接口字段仍叫 `date`**，映射在服务层 | DB · API · 导入 | [02 §1.8 import_rows](./02-database.md#18-import_rows) · [05 §1.2 列定义](./05-import-and-llm.md#12-列定义) · [05 §4.4 字段映射](./05-import-and-llm.md#44-字段映射) |
| §14.6 · §14.40 | `users` 加 `display_name VARCHAR(40) NULL` 与 `language VARCHAR(8) NULL`（NULL = 跟随系统），删 `default_source_id`；`ledger_invites` 加 `created_at` | DB · API · 前端 | [02 §1.1 users](./02-database.md#11-users) · [03 §5.4 PATCH /me](./03-backend-api.md#54-patch-apiv1me) · [04 §4.13 个人设置](./04-frontend.md#413-个人设置-settings) |
| §14.7 | 一行同时命中 `duplicate` 与 `refund_candidate` 时 `matched_transaction_id` 归退款候选；提交时写 `refund_of` 的条件只有"`kind='refund'` 且 `matched_transaction_id` 非空" | 导入 | [05 §3.5 四种标记对照](./05-import-and-llm.md#35-四种标记对照) · [05 §4.4 字段映射](./05-import-and-llm.md#44-字段映射) |
| §14.8 | 各章行数只是参考，**不作为验收项**；不得为压行数删掉被点名要求的内容，也不要把 skill 全文、DDL 拆到附录文件 | — | 本文 §7 |
| §14.10 | `import_rows` 加 `counterparty VARCHAR(100) NULL`，`PATCH .../rows/{rid}` 可改，提交单腿转账时写进 `transactions.counterparty` | DB · API · 导入 | [02 §1.8 import_rows](./02-database.md#18-import_rows) · [03 §5.41 PATCH rows](./03-backend-api.md#541-patch-apiv1ledgersidimportsbidrowsrid) · [05 §4.5 转账的三种落地方式](./05-import-and-llm.md#45-转账的三种落地方式) |
| §14.11 | 退款候选**不单独建接口**：记账表单与 review 的「关联原单」选择器都复用 `GET /transactions`（expense 行自带 `refunded_total` / `refundable`） | API · 前端 · 导入 | [03 §5.25 GET transactions](./03-backend-api.md#525-get-apiv1ledgersidtransactions) · [04 §4.6 记一笔](./04-frontend.md#46-记一笔-lledgeridtransactionsnewkind) · [05 §3.2 refund_candidate](./05-import-and-llm.md#32-refund_candidate) |
| §14.13 | 账本名 1–100 字符，与账户名一致 | API · 前端 | [01 §3.2 创建账本](./01-domain-and-flows.md#32-创建账本决策-2) · [03 §5.9 POST /ledgers](./03-backend-api.md#59-post-apiv1ledgers) |
| §14.16 | skill **不输出对手账户**：`import_rows.counterparty` 在校验阶段恒为 NULL，只有用户在 review 里 PATCH 才有值 | API · 导入 | [03 §5.41 PATCH rows](./03-backend-api.md#541-patch-apiv1ledgersidimportsbidrowsrid) · [05 §1.2 列定义](./05-import-and-llm.md#12-列定义) |
| §14.18 | `POST .../commit` 无请求体、不做乐观锁校验，重复提交靠 409 `batch_already_committed` 保护 | API · 导入 | [03 §5.43 POST commit](./03-backend-api.md#543-post-apiv1ledgersidimportsbidcommit) · [05 §4.3 提交前置校验](./05-import-and-llm.md#43-提交前置校验) |
| §14.19 | 草稿行的提示字段统一叫 `hint`（对应 `import_rows.hint`），每一处校验改动都追加进去 | DB · API · 前端 · 导入 | [02 §1.8 import_rows](./02-database.md#18-import_rows) · [05 §2.5 hint 的写法](./05-import-and-llm.md#25-hint-的写法) |

### 2.3 §14.20–§14.46：分类边界、导入改版与前后端收尾

§14.33、§14.36–§14.39 是对 §0–§13 中 P-2…P-32 各条的逐条追认，没有引入新改动，因此不单列行；它们对应的改动已经写在 §2.1 里。

| 决策 | 改动一句话 | 层 | 去哪读 |
|---|---|---|---|
| §14.20 · §14.21 | 生活购物 / 消费购物按**消耗品 / 耐用品**划分（不按必需 / 非必需）；每个一级分类带 `desc_zh` / `desc_en` 判据文字，随 `GET /categories` 下发、选分类处显示、skill 提示词里作判据 | API · 前端 · 导入 | [01 §2.3 分类的边界与说明文字](./01-domain-and-flows.md#23-分类的边界与说明文字决策-1314201421) · [03 §5.5 GET /categories](./03-backend-api.md#55-get-apiv1categories) · [04 §5.3 分类名不进语言包](./04-frontend.md#53-分类名不进语言包决策-13) · [05 §5.2 SKILL.md 全文](./05-import-and-llm.md#52-skillmd-全文) |
| §14.22 | 撤销一批已提交的导入 = **整批删除**：不引入"已撤销"状态、不为追溯保留批次 | DB · API · 前端 · 导入 | [02 §6.6 丢弃与撤销](./02-database.md#66-导入批次的丢弃与撤销) · [03 §5.44 DELETE imports](./03-backend-api.md#544-delete-apiv1ledgersidimportsbid) · [05 §4.8 撤销与 dry_run](./05-import-and-llm.md#48-撤销与-dry_run) |
| §14.25 | **应用不接入大模型**，导入改为"用户自己的 ChatGPT / Claude + 标准格式文件"；模型设置表、模型设置接口、后台解析、进度轮询、重试端点、页面缩略图、上传目录整套取消（§5、§6 已整体改写） | DB · API · 前端 · 导入 | [00 §5](./00-decisions.md#5-账单导入2026-09-10-改版应用不接入-llm) · [00 §6](./00-decisions.md#6-导入-skill取代原llm-设置与接口) · [02 §0 目标表清单](./02-database.md#0-总览目标表清单与对现状的差异) · [03 §1.1 目标模块图](./03-backend-api.md#11-目标模块图) · [04 §0.4 删除](./04-frontend.md#04-删除) |
| §14.26 | 时间戳存**不带时区的 UTC**（naive），接口输出一律带 `Z`，前端按浏览器时区显示；不用 `timestamptz` | DB · API | [02 §7.2 时间](./02-database.md#72-时间) · [03 §4.5 序列化格式](./03-backend-api.md#45-序列化格式) |
| §14.27 | 导入代码放 `backend/app/services/importing/`，按读文件 / 校验 / 标记 / 提交撤销分四个模块，**没有抽取器目录** | API · 导入 | [03 §1.1 目标模块图](./03-backend-api.md#11-目标模块图) · [05 §0.3 四个模块](./05-import-and-llm.md#03-servicesimporting-四个模块) |
| §14.28 | **不保存上传的导入文件，也不存原始行值**：批次只记文件名与大小，校验改动写进行的 `hint`；后端没有任何文件系统状态 | DB · API · 导入 | [02 §1.7 import_batches](./02-database.md#17-import_batches) · [03 §9.3 上传内容的处理](./03-backend-api.md#93-上传内容的处理) · [05 §4.11 不保存文件](./05-import-and-llm.md#411-不保存文件决策-1428) |
| §14.29 | 邀请码不要求全表唯一：生成时只与当前有效码比对，用掉即删、过期即删；表里永远只有有效码，没有使用者 / 使用时间两列，也没有定时清理 | DB · API | [01 §4.5 邀请码生命周期](./01-domain-and-flows.md#45-邀请码生命周期决策-214291435) · [02 §1.4 ledger_invites](./02-database.md#14-ledger_invites) · [02 §6.3 邀请码的三种死法](./02-database.md#63-邀请码的三种死法) |
| §14.30 | `CATEGORY_VERSION` 是日期串（如 `2026-09-10`）；导入文件的版本行**存在但不一致** → 400 `skill_outdated`，不允许带警告继续 | API · 前端 · 导入 | [03 §5.5 GET /categories](./03-backend-api.md#55-get-apiv1categories) · [05 §2.3 版本检查](./05-import-and-llm.md#23-版本检查--400-skill_outdated) |
| §14.31 | 批内完全相同的行**不合并**：全部保留、都打 `needs_review` + `hint`，由用户在 review 里取舍；标记只有四种 | API · 前端 · 导入 | [05 §2.7 批内重复行不合并](./05-import-and-llm.md#27-批内重复行不合并决策-1431) · [05 §3.5 四种标记对照](./05-import-and-llm.md#35-四种标记对照) |
| §14.32 | `occurred_at` 是**无时区的日历日期**（Postgres `DATE`），接口用 `YYYY-MM-DD` 字符串传输；前端当字符串比较显示，**不得** `new Date("YYYY-MM-DD")` 再格式化 | DB · API · 前端 · 导入 | [01 §5.3 折算规则与日期规则](./01-domain-and-flows.md#53-折算规则与日期规则决策-81432) · [02 §7.1 类型映射](./02-database.md#71-类型映射) · [04 §5.4 日期与金额格式化](./04-frontend.md#54-日期与金额格式化) |
| §14.34 | 两条单腿转账可以**配对**成一笔，也可以**拆开**：导入 review 自动找 ±3 天同币种同额反方向的单腿，唯一候选默认勾选；新增 `POST .../{tid}/pair` 与 `POST .../transfer/{pair_id}/unpair` 两个端点；标记名叫 `transfer_candidate` | DB · API · 前端 · 导入 | [01 §3.15 转账配对与拆开](./01-domain-and-flows.md#315-转账配对与拆开决策-1434) · [01 §4.2 单腿 ⇄ 两腿](./01-domain-and-flows.md#42-转账形态单腿--两腿决策-1434) · [03 §5.33 pair](./03-backend-api.md#533-post-apiv1ledgersidtransactionstidpair) · [05 §3.3 transfer_candidate](./05-import-and-llm.md#33-transfer_candidate决策-1434) |
| §14.35 | 邀请码限流改为**端点级全局 1 QPS**（令牌桶，突发 3，429 + `Retry-After`，code `invite_rate_limited`），删掉"同一用户 15 分钟 5 次" | API | [01 §3.5 加入账本](./01-domain-and-flows.md#35-加入账本决策-2914291435) · [03 §8.2 各限流点](./03-backend-api.md#82-各限流点) |
| §14.42 | **不做向后兼容**：`/me` 是唯一入口（auth 下不注册别名），`default_source_id` 直接移除，各章不保留任何过渡期措施 | DB · API · 前端 | [02 §5.6 第 6 步 users 收尾](./02-database.md#56-第-6-步users-收尾) · [03 §5.3 GET /me](./03-backend-api.md#53-get-apiv1me) · [04 §2.1 AuthContext](./04-frontend.md#21-authcontext保留--一处修复) |
| §14.43 · §14.44 | 后端一批数值与形态定死：`created_by` / `updated_by` 只回 id；删除类端点统一 204（撤销导入回条数）；注册限流同 IP 5 次/小时；撤销 `dry_run` 报数；分类当月支出可为负；`FX_MAX_BACKFILL_DAYS = 10`；`occurred_at` 最晚今天 + 1 天；`limit` 上限 200 / 500 | API | [03 §4.3 分页](./03-backend-api.md#43-分页) · [03 §6.2 回退算法](./03-backend-api.md#62-函数签名与回退算法) · [03 §8.2 各限流点](./03-backend-api.md#82-各限流点) · [03 §5.44 DELETE imports](./03-backend-api.md#544-delete-apiv1ledgersidimportsbid) |
| §14.45 | 视觉方向定稿「**04 柔和圆润**」：Figtree + IBM Plex Mono、C2 密度、淡鼠尾草底、交易四色、森林绿强调；token 的唯一来源是 [`mockups/tokens.json`](./mockups/tokens.json)，16 张屏幕稿在同一目录；04 章原 A/B/C 三方向作废，实现前**不再另出 mockup** | 前端 | [mockups/README.md](./mockups/README.md) · [04 §6 视觉设计](./04-frontend.md#6-视觉设计已定稿04-柔和圆润) · [04 §6.2 设计 token](./04-frontend.md#62-设计-token) |
| §14.46 | 前端五条收尾：路由用 Expo Router；加匿名可读的 `GET /config`；支出详情带 `refunds[]`、退款详情展开原单摘要；交易列表加 `?import_batch_id=`；不做按成员筛选 | API · 前端 | [03 §5.6 GET /config](./03-backend-api.md#56-get-apiv1config) · [03 §5.27 交易详情](./03-backend-api.md#527-get-apiv1ledgersidtransactionstid) · [04 §1.1 路由库](./04-frontend.md#11-路由库) · [04 §4.7 交易详情](./04-frontend.md#47-交易详情-lledgeridtransactionstxid-与编辑) |

### 2.4 §14.47–§14.53：屏幕稿审阅与最终同步的裁定

| 决策 | 改动一句话 | 层 | 去哪读 |
|---|---|---|---|
| §14.47 | 标准导入格式**只有 CSV**（固定 11 列表头 + `# version:` 首行），JSON 不再接受；粘贴入口粘的也是 CSV 文本，skill 输出 CSV | DB · API · 前端 · 导入 | [05 §1.1 文件形态](./05-import-and-llm.md#11-文件形态) · [02 §1.7 import_batches](./02-database.md#17-import_batches) · [03 §5.37 POST imports](./03-backend-api.md#537-post-apiv1ledgersidimports) |
| §14.48 | 账户类型**四种**：`checking`（储蓄卡）/ `credit` / `cash` / `other`，**不设 `savings`**；迁移把现有 `savings` 改成 `checking` | DB · API · 前端 | [01 §1.6 finance_sources](./01-domain-and-flows.md#16-资金账户-finance_sources决策-314481450) · [02 §5.3 第 3 步](./02-database.md#53-第-3-步账户与交易归属账本) · [03 §5.21 POST sources](./03-backend-api.md#521-post-apiv1ledgersidsources) · [04 §4.9 账户表单](./04-frontend.md#49-账户表单-lledgeridsourcesnewsourceidedit) |
| §14.49 | `min_amount` / `max_amount` 与每笔交易**按发生日汇率折成基准币种后的绝对值**比较；服务端先按其他条件过滤，再在结果上折算与范围过滤；列表行同时显示原币与折算金额 | API · 前端 | [01 §5.6 金额区间筛选](./01-domain-and-flows.md#56-金额区间筛选的比较口径决策-1449) · [03 §5.25 GET transactions](./03-backend-api.md#525-get-apiv1ledgersidtransactions) · [04 §4.5 交易列表](./04-frontend.md#45-交易列表-lledgeridtransactions) |
| §14.50 | 账户加 `archived_at`；`default_currency` 创建后不可改（400 `currency_locked`）；账户列表按类型分组给小计；净资产 = 资产 + 负债（信用卡为负），**归档账户不计入**并在归档时提示 | DB · API · 前端 | [01 §5.5 资产、负债与净资产](./01-domain-and-flows.md#55-资产负债与净资产决策-71450) · [02 §1.5 finance_sources](./02-database.md#15-finance_sources) · [03 §5.20 GET sources](./03-backend-api.md#520-get-apiv1ledgersidsources) · [04 §4.8 账户列表](./04-frontend.md#48-账户列表-lledgeridsources) |
| §14.51 | 新表 `transaction_events`：所有改交易的路径都追加一条（`created` / `updated` / `imported` / `paired` / `unpaired` / `refund_linked` / `refund_unlinked`），`changes` 记字段的前后值，客户端来自请求头 `X-Client`；交易删除时级联删除，只追加不修改 | DB · API · 前端 · 导入 | [01 §1.10 交易操作记录](./01-domain-and-flows.md#110-交易操作记录-transaction_events决策-1451) · [02 §1.9 transaction_events](./02-database.md#19-transaction_events) · [03 §7 交易操作记录](./03-backend-api.md#7-交易操作记录transaction_events) · [05 §4.6 transaction_events](./05-import-and-llm.md#46-transaction_events决策-1451) |
| §14.52 | 屏幕稿审阅的其余裁定：两腿转账在列表**合并成一行**、首页趋势只放支出、个人设置加"外观"、撤销 `dry_run` 给两个计数；低成本细节（邀请码作废、review 内筛选与批量操作、复制一笔 / 登记退款、按日分组与汇总、账本删除前计数、交易详情显示所用汇率、退款详情列出其它退款等）逐条落地；"不做"清单同时定死 | DB · API · 前端 · 导入 | [mockups/REVIEW-2026-09-11.md](./mockups/REVIEW-2026-09-11.md) · [01 §5.2 月度合计与列表汇总](./01-domain-and-flows.md#52-月度合计趋势与列表汇总) · [03 §5.18 作废邀请码](./03-backend-api.md#518-delete-apiv1ledgersidinvitescode) · [03 §5.42 批量改草稿行](./03-backend-api.md#542-patch-apiv1ledgersidimportsbidrows) · [04 §4.5 交易列表](./04-frontend.md#45-交易列表-lledgeridtransactions) |
| §14.53a | 配对**不要求**两腿 `transfer_subtype` 原本相同，改为**配对时统一**：任一腿是 `repayment` 且转入腿账户是 `credit` → 整对 `repayment`，否则整对 `plain`；两腿同一事务改成同值并**各写一条 `updated` 事件**。两腿 `occurred_at` 允许不同；转账对象顶层的 `occurred_at` / `transfer_subtype` / `note` 取转出腿，`PATCH .../transfer/{pair_id}` 改这三个字段时同写两腿 | API · 前端 · 导入 | [01 §1.9 转账腿](./01-domain-and-flows.md#19-转账腿决策-121434) · [01 §3.15 转账配对与拆开](./01-domain-and-flows.md#315-转账配对与拆开决策-1434) · [01 §6.2 应用层保证](./01-domain-and-flows.md#62-应用层保证决策-1914) · [03 §5.33 pair](./03-backend-api.md#533-post-apiv1ledgersidtransactionstidpair) · [05 §4.5 转账的三种落地方式](./05-import-and-llm.md#45-转账的三种落地方式) |
| §14.53b | 多候选转账**不新增字段**：`matched_transaction_id` 是唯一载体；多候选时不预填、打 `needs_review`、`hint` 写"找到 N 条可以配对的转账，请选一条"，前端"选一条"复用交易列表接口筛选。候选列表不落库、不单独建接口 | API · 前端 · 导入 | [01 §3.15 转账配对与拆开](./01-domain-and-flows.md#315-转账配对与拆开决策-1434) · [03 §5.41 PATCH rows](./03-backend-api.md#541-patch-apiv1ledgersidimportsbidrowsrid) · [05 §3.3 transfer_candidate](./05-import-and-llm.md#33-transfer_candidate决策-1434) |
| §14.53c | 没找到对腿时**不猜对手账户**：`counterpart_source_id` 留空，由用户在 review 里显式选；它必须是本账本的**未归档**账户，否则 404 `not_found` | API · 前端 · 导入 | [01 §1.12 导入草稿行](./01-domain-and-flows.md#112-导入草稿行-import_rows决策-51441) · [03 §5.41 PATCH rows](./03-backend-api.md#541-patch-apiv1ledgersidimportsbidrowsrid) · [05 §3.3 transfer_candidate](./05-import-and-llm.md#33-transfer_candidate决策-1434) |
| §14.53d | 错误 code 定名以 03 §4.2 注册表为准：`pair_invalid`、`import_format_invalid`、`currency_locked`、`rows_exceed_limit`（400）。**缺 `# version:` 行属结构错误** → `import_format_invalid`；只有版本行存在但不一致才是 `skill_outdated`；编码不可读先于版本检查 | API · 前端 · 导入 | [03 §4.2 全局 code 清单](./03-backend-api.md#42-全局-code-清单) · [05 §2.1 校验顺序](./05-import-and-llm.md#21-校验顺序) · [04 §3.7 文案表](./04-frontend.md#37-错误归一化与-detail-code--文案) |
| §14.53e | 导入批次的列名以 02 §1.7 的 DDL 为准（`filename` / `size_bytes` / `skill_version` / `row_count` / `committed_at` …），03 的响应字段与 05 的描述用同一套名字，不另起别名 | DB · API · 前端 · 导入 | [02 §1.7 import_batches](./02-database.md#17-import_batches) · [03 §5.37 POST imports](./03-backend-api.md#537-post-apiv1ledgersidimports) · [04 §3.3 类型定义](./04-frontend.md#33-类型定义) · [05 §4.9 批次列表与详情](./05-import-and-llm.md#49-批次列表与详情) |
| §14.53f | 04 的类型定义以 03 的响应体为准：上传失败体是 `errors: [{line, message}]` + `current_version` / `file_version` / `guide_url`；退款原单摘要含 `source_id`、分类与 `other_refunds[]`；前端文案表**只收注册表里的 code** | API · 前端 | [03 §5.37 POST imports](./03-backend-api.md#537-post-apiv1ledgersidimports) · [03 §5.27 交易详情](./03-backend-api.md#527-get-apiv1ledgersidtransactionstid) · [04 §3.3 类型定义](./04-frontend.md#33-类型定义) · [04 §3.7 文案表](./04-frontend.md#37-错误归一化与-detail-code--文案) |

---

## 3. 术语表

| 中文 | 英文 / 标识符 | 一句话定义 |
|---|---|---|
| 账本 | ledger（`ledgers`） | 共享记账的容器。账户、交易、导入都属于某一本账；**基准币种属于账本**，不属于用户 |
| 成员 / 拥有者 | member / owner（`ledger_members.role`） | 账本里的人。owner 唯一，能改账本、生成与作废邀请码、踢人、转让、删账本；member 能做其余一切（含记账、改账、导入、撤销导入、管理账户） |
| 邀请码 | invite code（`ledger_invites.code`） | owner 生成的 6 位数字码，10 分钟有效、一次性使用，线下口头告诉对方；用掉即删、过期即删、可主动作废 |
| 种类 | kind（`transactions.kind`） | 交易的四种统计口径：`expense` / `income` / `refund` / `transfer`。**只有统计口径不同的东西才成为 kind** |
| 退款关联 | refund link（`transactions.refund_of`） | 一条 `refund` 指向它冲减的那条 `expense`；可空，原单删除时自动置空 |
| 转账腿 / 单腿 | transfer leg / single-leg（`transfer_role`、`transfer_pair_id`） | 一次转账在库里是 1 行或 2 行。两腿共用一个 `transfer_pair_id`；对方不在应用里时只有 1 行，`transfer_pair_id` 为空、可填 `counterparty` 文本 |
| 子类型 | subtype（`transfer_subtype`） | 转账的两种：`plain`（普通划转）与 `repayment`（信用卡还款）。转账必填，非转账必须为空 |
| 配对 / 拆开 | pair / unpair（`POST .../{tid}/pair`、`POST .../transfer/{pair_id}/unpair`） | 把两条**仍是单腿**、方向相反、不同账户的转账合成一笔（共用新的 `transfer_pair_id`、清空两条的 `counterparty`、按决策 §14.53a **统一两腿的子类型**），或把一对拆回两条单腿。子类型**不作为配对的前置条件**（决策 §14.34、§14.53a） |
| 操作记录 | transaction event（`transaction_events`） | 一笔交易身上的只追加事件流：`created` / `updated` / `imported` / `paired` / `unpaired` / `refund_linked` / `refund_unlinked`，`changes` 记字段的前后值，`client` 来自请求头 `X-Client`；交易删除时级联删除（决策 §14.51） |
| 标准导入文件 | standard import file | 导入的**唯一契约**：一份 UTF-8（可带 BOM）CSV，首行 `# version: <分类表版本>`，第二行是固定 11 列表头 `date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref`。上传文件与粘贴文本走同一套校验（决策 §5、§14.47） |
| skill | import skill（`skills/wallet-import/`） | 交付给用户装进**他自己的** ChatGPT / Claude 的一份指令文本，负责把任意账单整理成标准导入文件。仓库里的交付物，由 `scripts/gen_import_skill.py` 从分类表常量生成，`version` 就是 `CATEGORY_VERSION`（决策 §6、§14.30） |
| 导入指南 | import guide（`GET /import-format`） | 应用内的一页三步说明（装 skill → 在你的 ChatGPT / Claude 里整理账单 → 把 CSV 传回来），附 skill 文本的复制 / 下载与示例 CSV；内容由公开端点 `GET /import-format` 下发，带同一个 `version`（决策 §6） |
| 导入批次 | import batch（`import_batches`） | 一次标准 CSV 导入 = 一批。记目标账户、来源（`csv` / `paste`）、文件名与大小、`skill_version`、状态、行数、整批级 `warnings`、时间戳；**不保存文件**（决策 §5、§14.28、§14.53e） |
| 草稿行 | draft row（`import_rows`） | 校验后落库的一行，尚未成为正式交易。与 `transactions` 完全隔离，逐行可改、可跳过；行号叫 `row_no`（从 1 起），日期列叫 `occurred_at` |
| 分类说明 | category desc（`desc_zh` / `desc_en`） | 一级分类的一句话归类判据（如"生活购物 = 用完就没了"）。只有一级有，二级恒为 `null`；与分类表一起冻结在后端常量里，三处共用：`GET /categories` → 前端选分类处的两行选项 → skill 文本里的一级行（决策 §14.21） |
| 待归类 | uncategorized | 草稿行 `category_l1` 为空且不是转账。review 表格标出来，**提交前必须补齐** |
| 基准币种 | base currency（`ledgers.base_currency`） | 这本账的统计口径。所有合计、趋势、净资产、金额区间筛选都折算到它 |
| 发生日汇率 | on-date rate | 用交易 `occurred_at` 当天（或往前最近一个已公布行情日，窗口 10 天）的汇率。交易与统计用它，一经公布不再变 |
| 最新汇率 | latest rate | 最近一个已公布行情日的汇率。账户余额折成基准币种时用它，回答"现在值多少钱" |
| 乐观并发 | optimistic concurrency（`updated_at` + 409 `stale_update`） | PATCH 带上你看到的 `updated_at`，服务端不一致就拒绝，前端提示重新加载。不做实时同步 |
| 自动标记 | flags（`import_rows.flags`） | 服务端在 `ready` 时打的提示，**只有四种**：`duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review`（决策 §5、§14.31、§14.34） |
| 错误 code 注册表 | error code registry | [03 §4.2](./03-backend-api.md#42-全局-code-清单) 的那张表，44 条。全仓库唯一，其他章只能引用不能自造；前端文案表与它双向对拍（决策 §14.4、§14.53d、§14.53f） |
| 设计 token | design token（[`mockups/tokens.json`](./mockups/tokens.json)） | 颜色 / 字号 / 间距 / 圆角 / 阴影 / 控件尺寸的唯一来源。组件只读语义名，任何组件里都不允许出现字面量色值（决策 §14.45） |

---

## 4. 目标目录结构

后端新增 / 重写的部分（完整模块图与函数签名见 [03 §1.1](./03-backend-api.md#11-目标模块图)）：

```text
backend/app/
  core/    deps.py[新] errors.py[新] categories.py[新] ratelimit.py[新]
  api/     me.py[新] categories.py[新] config.py[新] ledgers.py[新] stats.py[新] imports.py[新]
           finance_sources.py[重写] transactions.py[重写]
  schemas/ common.py[新] category.py[新] ledger.py[新] stats.py[新] import_.py[新]
           transaction.py[重写]
  services/
    fx.py[新]                统一汇率换算，取代现状的两套公式
    rates_client.py[改名]    Frankfurter HTTP 客户端
    events.py[新]            transaction_events 的追加与查询（决策 §14.51）
    stats.py[新]             汇总、趋势、账户余额、资产 / 负债 / 净资产
    ledger_service.py[新]    账本 / 成员 / 邀请码
    importing/[新]           账单导入包，四个模块（决策 §14.27，见 05 §0.3）：
      reader.py      读文件 / 读粘贴文本、解码、拆 CSV
      validate.py    结构校验 + 行级校验与 hint
      flagging.py    duplicate / refund_candidate / transfer_candidate / needs_review
      commit.py      提交建交易、撤销整批删除
  models/  新增 Ledger / LedgerMember / LedgerInvite / TransactionEvent /
           ImportBatch / ImportRow / ExchangeRate；删除 TransactionTag
backend/scripts/
  reset_password.py[新]      管理员重置密码（决策 §9）
  gen_import_skill.py[新]    从 core/categories.py 生成 skill 文本与示例 CSV（决策 §6）
backend/tests/importing/[新]

skills/
  wallet-import/[新]         交付给用户装进自己 ChatGPT / Claude 的 skill（决策 §6、§14.47）：
    SKILL.md                 Claude 版主文本
    chatgpt-instructions.md  ChatGPT 版指令文本
    example.csv              标准 CSV 示例
    README.md                安装步骤
```

**没有的东西**：模型客户端、密钥加密模块、提示词与模型 schema、抽取器 / 分块器、上传落盘目录、后台任务与线程池、启动恢复钩子。应用不调任何大模型，也**没有任何文件系统状态**（决策 §14.25、§14.27、§14.28）。

前端新增 / 重写的目录（详见 [04 §3.1](./04-frontend.md#31-目录)）：

```text
frontend/src/
  api/       client.ts types.ts auth.ts me.ts config.ts categories.ts importFormat.ts
             ledgers.ts sources.ts transactions.ts stats.ts imports.ts rates.ts
  queries/   keys.ts invalidate.ts useXxx.ts     ← 只管缓存语义，页面只 import 这里
  theme/     tokens.ts                            ← 由 mockups/tokens.json 生成，唯一色值来源
  i18n/      语言包 zh / en（分类名与说明文字不进语言包，见 04 §5.3）
  pages/     登录 / 注册 / 账本列表 / 首页 / 交易列表 / 交易详情 / 记一笔 / 账户 /
             导入（指南·上传或粘贴·review·历史）/ 账本设置 / 个人设置
```

---

## 5. 实施顺序建议

只写**依赖关系导致的先后**，不写排期，也不含任何工时估计。

1. **schema 与迁移**：按 [02 §5](./02-database.md#5-迁移计划) 建十张表、跑通六步迁移链（空库 + 有数据的库 + Postgres 迁移测试）。后面所有东西都压在它上面。
2. **分类常量与汇率函数**：`core/categories.py`（[决策 §1.3](./00-decisions.md#13-分类固定常量)）与 `services/fx.py`（[03 §6](./03-backend-api.md#6-汇率服务)）。它们是纯函数，可以先写完并单测；交易接口、统计、skill 生成脚本都依赖它们。
3. **账本 / 成员 / 邀请码接口**：[03 §5.8–§5.19](./03-backend-api.md#58-get-apiv1ledgers)。所有业务路由的鉴权依赖 `get_ledger_member`，必须先有。
4. **交易接口与配对**：账户接口（带余额与三个合计）→ 交易 CRUD → 两腿转账端点 → 配对 / 拆开 → `transaction_events` 一起接上（[03 §5.20–§5.34](./03-backend-api.md#520-get-apiv1ledgersidsources)、[03 §7](./03-backend-api.md#7-交易操作记录transaction_events)）。事件是所有写交易路径的横切关注点，越早接越省事。
5. **统计接口**：[03 §5.35–§5.36](./03-backend-api.md#535-get-apiv1ledgersidstatssummary)，依赖第 2 步的汇率函数与第 4 步的数据。
6. **前端 API 层与页面**：先 `api/` + `queries/` + 错误文案表（[04 §3](./04-frontend.md#3-api-客户端层)），再登录 / 账本 / 首页 / 交易 / 记一笔 / 账户各页。此时导入还不存在，产品已可用。
7. **导入校验与 skill**：`services/importing/` 四个模块 + 导入端点（[05 §2](./05-import-and-llm.md#2-校验服务端同步完成)、[05 §3](./05-import-and-llm.md#3-自动标记)、[05 §4](./05-import-and-llm.md#4-review-与提交)）→ `scripts/gen_import_skill.py` 与 `skills/wallet-import/`（[05 §5](./05-import-and-llm.md#5-skill-规范)）→ 前端的导入指南 / 上传 / review 表格 / 历史（[04 §4.10–§4.11](./04-frontend.md#410-导入-lledgeridimports决策-56)）。校验是纯函数，可以先用 [05 §7.1](./05-import-and-llm.md#71-fixture-清单) 的 fixture 把全流程跑通再接界面；review 表格是整个产品最重的一屏，放在功能稳定之后做。
8. **视觉实现**：按 [`mockups/tokens.json`](./mockups/tokens.json) 生成 `frontend/src/theme/tokens.ts`，再按 [04 §6](./04-frontend.md#6-视觉设计已定稿04-柔和圆润) 的规则把组件里的字面量色值全部换成语义名，浅色 / 深色各验一遍 WCAG AA。**不再另出 mockup**（决策 §14.45）。放最后，因为它改的是外观不是结构。

---

## 6. 决策状态：全部关闭

各章的 `## 待决` 一节现在**都是零条未决**，只留一张追溯表说明每条去了哪里。本节把这些映射汇总一次。

### 6.1 各章原待决 → 决策 §14.x

| 来自 | 原问题 | 归到哪条裁定 |
|---|---|---|
| 01-1 · 02-D-2 · 03-2 · 04-D-2 | `users.default_source_id` 怎么处置 | §14.6 + §14.42：删除该列，默认账户改由前端本地记住 |
| 01-2 · 04-D-12 | 界面语言存哪 | §14.6：`users.language VARCHAR(8) NULL`，NULL = 跟随系统；外观另存本机（§14.52 A23） |
| 01-3 | 模型设置表要不要 `created_at` | §14.25 作废：这张表整个不存在 |
| 01-4 | `ledger_invites` 要不要 `created_at` | §14.6：要加；同时按 §14.29 去掉使用者 / 使用时间两列 |
| 01-5 · 02-D-1 · 03-11 | `exchange_rates` 建不建、什么形状 | §14.1：新建 `(date, base, symbol, rate, fetched_at)`，主键 `(date, base, symbol)` |
| 01-6 · 02-D-5 | 同一账本内账户能否重名 | §14.40：允许，按 id 区分，只在界面提示 |
| 01-7 · 03-3 | 成员退出后他 `created_by` 的历史数据怎么显示 | §14.40：显示 `display_name`，没填时显示邮箱前缀，**不匿名化** |
| 01-8 | 用户退到 0 本账本时的落地页 | §14.40：进"新建 / 加入"引导页（屏幕稿按 §14.52 B19 补画） |
| 01-9 | 多币种账户余额怎么展示 | §14.2：不分币种桶，只回 `balance` / `balance_base` / `balance_rate` / `balance_rate_date` |
| 01-10 | 错误 code 谁说了算 | §14.4 + §14.53d：[03 §4.2](./03-backend-api.md#42-全局-code-清单) 是唯一注册表 |
| 01-11 | 两腿转账 PATCH 用哪条腿的 `updated_at` | §14.40：两条腿都比对 |
| 01-12 | 归档账户上的历史交易能否 PATCH | §14.40：允许，只禁止新建 |
| 02-D-3 | `import_rows` 的日期列叫什么 | §14.41：库里叫 `occurred_at`，文件与接口字段仍叫 `date` |
| 02-D-4 | 模型配置表的密钥列名 | §14.25 作废：没有这张表，也就没有密钥列 |
| 02-D-6 | 已用 / 已过期邀请码何时删 | §14.29：用掉即删、过期即删、作废即删，无定时清理 |
| 02-D-7 | "每人 ≤10 本、每本 ≤10 人"要不要数据库约束 | §14.41：只在应用层 `COUNT(*)` 校验，不加触发器 |
| 02-D-8 · 04-D-9 · 05-7 | 视觉解析路径的页面缩略图存哪里 | §14.25 作废：没有解析、没有缩略图、没有上传目录 |
| 02-D-9 | 迁移遇到回填不出 `ledger_id` 的行、`amount = 0` 的历史行 | §14.41：删除并打 warning 日志，不中止 |
| 03-1 · 04-D-2 | `/auth/me` 与 `/me` 并存多久 | §14.42：不做兼容，别名不注册 |
| 03-4 | `created_by` / `updated_by` 要不要展开 | §14.43：只回用户 id，前端用成员列表映射 |
| 03-5 | 时间戳带不带时区 | §14.26：naive UTC 存储 + 输出带 `Z` |
| 03-6 | 删除类端点的返回 | §14.43：统一 204，撤销导入例外（回撤销条数） |
| 03-7 | 批次要不要返回模型原始响应 | §14.25 作废：应用不调大模型 |
| 03-8 | 补充的两个限流点 | 一半作废（"测试连接"随 §14.25 消失）一半裁定（§14.43：注册同 IP 5 次/小时） |
| 03-9 | 撤销导入的孤儿退款要不要报数 | §14.43 + §14.52 B24：`dry_run` 回 `orphaned_refunds` 与 `refunds_in_batch` 两个数 |
| 03-10 | 分类当月支出被冲成负数怎么办 | §14.44：照实返回负数 |
| 03-12 · 03-13 · 03-14 · 03-15 | 汇率回退窗口 / `occurred_at` 上限 / `limit` 上限 / `--proxy-headers` | §14.44：10 天 / 今天 + 1 天 / 200 与 500 / 加上 |
| 03-16 · 04-D-8 · 05-9 | `CATEGORY_VERSION` 与 `GET /categories` 的 `version` 形态 | §14.30：日期串，导入时硬校验；结构（嵌套 `children[]` + 一级带 `desc_*`）由 03 §5.5 定死 |
| 04-D-1 | 路由库选哪个 | §14.46：Expo Router |
| 04-D-3 | `GET /ledgers` 返不返回角色与成员数 | 由 03 §5.8 回答：返回 `role` + `member_count` |
| 04-D-4 | 退款候选"已退 / 可退"怎么给 | §14.11：不另设接口，复用交易列表，两个字段默认返回、无开关 |
| 04-D-5 · 04-D-6 · 04-D-7 · 04-D-11 | `REGISTRATION_OPEN` 前置读取 / 退款金额展示 / 按批次筛选 / 按人筛选 | §14.46：加 `GET /config` / 带 `refunds[]` 与展开原单 / 加 `?import_batch_id=` / 不做 |
| 04-D-10 | 解析进度怎么表达 | §14.25 作废：校验是同步的，没有进度 |
| 04-D-13 | 视觉方向选 A / B / C 哪个 | §14.45：都不选，采用「04 柔和圆润」，token 与屏幕稿在 [`mockups/`](./mockups/README.md) |
| 05-3 | 一行同时命中两种标记时 `matched_transaction_id` 归谁 | §14.7：归退款候选 |
| 05-4 · 05-8 · 05-13 | 欧陆数字格式 / 上传目录的生产卷 / "已合并"标记的筛选 | 全部随 §14.25 / §14.28 / §14.31 作废 |
| 05-15 · 05-16 · 05-17 | 单腿转账对手文本怎么存 / 重启中断的失败 code / 提示字段名 | §14.10 加 `counterparty`；重启中断随 §14.25 作废（没有后台解析）；§14.19 统一叫 `hint` |
| 各章 | 篇幅 | §14.8：行数只是参考，不作为验收项 |

### 6.2 上一轮"校对时统一"的十一条（U-1 … U-11）

它们是各章初稿互相冲突、由校对临时选定的写法。**现在全部被决策记录收编，不再是"待追认"**：

| # | 原冲突 | 现在的归属 |
|---|---|---|
| U-1 | 撤销已提交的导入是保留状态还是整批删除 | 决策 §14.22：整批删除 |
| U-2 · U-3 · U-10 | 解析进度的形态 / 解析路径怎么记 / 前端轮询间隔 | 决策 §14.25 作废：同步校验，没有解析、没有进度、没有轮询 |
| U-4 | 时间戳存 naive UTC 还是带时区 | 决策 §14.26：naive UTC + 输出带 `Z` |
| U-5 | 模型配置表的密钥列 | 决策 §14.25 作废：没有这张表 |
| U-6 | 导入包的模块划分 | 决策 §14.27：`services/importing/`，四个模块 |
| U-7 | 上传目录的默认值 | 决策 §14.28 作废：不保存上传文件，后端没有文件系统状态 |
| U-8 | 邀请码唯一索引的范围 | 决策 §14.29：不建唯一索引，只在有效码中查重 |
| U-9 | `GET /categories` 的 `version` 形态 | 决策 §14.30：日期串，导入时硬校验 |
| U-11 | 批内重复行要不要合并、要不要第五个标记 | 决策 §14.31：不合并，标记只有四种 |

### 6.3 唯一由 Claude 裁定的一条：决策 §14.53（已在看板 S14-53 确认，供最终追认）

**§14.53（章节同步时的取舍，a–f 六条）是这套文档里唯一一条由 Claude 裁定、再写进决策记录的**——它不来自设计评审，而是各章并行改写完之后，终审发现六处互相打架、由 Claude 按"哪种写法能让功能真的跑起来"裁定的。已在决策看板 S14-53 上记录并由你确认；这里再列一次，方便你最终追认或推翻（除此之外没有任何未决项）。逐条改的是什么、代价在哪：

| 条 | 裁定 | 为什么这样选 | 推翻的话要改什么 |
|---|---|---|---|
| a | 配对**不要求**两腿子类型原本相同，改为配对时统一（任一腿 `repayment` 且转入腿账户是 `credit` → 整对 `repayment`，否则整对 `plain`），值有变化的腿各写一条 `updated` 事件；两腿 `occurred_at` 允许不同，转账对象顶层三字段取转出腿 | 同一笔还款，储蓄卡账单常写 `plain`、信用卡账单写 `repayment`。硬卡"必须相同"会让这类配对**永远触发不了**，而它恰恰是配对最常见的用途 | 01 §1.9 / §3.15 / §6.2、03 §5.31 / §5.33、05 §4.5：改回"子类型不同 → 400 `pair_invalid`"，并接受还款配对基本不可用 |
| b | 多候选转账**不新增字段**：不预填、在 `transfer_candidate` 之外另打 `needs_review`、`hint` 写"找到 N 条…请选一条"，前端复用交易列表接口挑一条写回 `matched_transaction_id` | 与 §14.11 对退款候选的处理完全同一做法；候选列表落库或单开接口都要多一份筛选逻辑去维护，而它本质上就是一次普通的交易查询 | 03 §5.41、05 §3.3、04 §4.11：要新增一个专门装候选列表的字段或端点，02 的 `import_rows` 也要跟着加列 |
| c | 没找到对腿时 `counterpart_source_id` **留空、不猜**；它必须是本账本的未归档账户，否则 404 `not_found` | 猜错的代价是凭空建出一条别人账户上的交易，比留空让用户选贵得多；"账本里只有一个候选账户"也不猜 | 05 §3.3 的算法要加一条"唯一候选就填"的分支，01 §1.12 / 03 §5.41 同步 |
| d | code 定名一律取注册表里的名字：`pair_invalid`、`import_format_invalid`、`currency_locked`、`rows_exceed_limit`（400）；**缺 `# version:` 行是结构错误**，不是版本问题；编码不可读先于版本检查 | 注册表是唯一契约（§14.4），同义名会让前端文案表对不上；缺版本行和版本过期两种情况给用户的修法完全不同（重新导出 vs 重装 skill），所以必须分到两个 code 上 | 03 §4.2 注册表 + 04 §3.7 文案表 + 01/05 的引用，一起改名 |
| e | 导入批次的列名以 02 §1.7 的 DDL 为准，03 的响应与 05 的描述不另起别名 | 三章各起一套名字是这轮最容易出的错；把 DDL 定为准，接口响应逐列对应，读者不用做名字翻译 | 03 §5.37–§5.39 的响应字段与 04 §3.3 的类型一起改名 |
| f | 04 的类型定义以 03 的响应体为准（上传失败体、退款原单摘要、文案表只收注册表里的 code） | 前端类型与后端响应体是同一份契约的两面，只能有一个来源；由服务端定，前端跟 | 03 §5.27 / §5.37 的响应体改成 04 的形状 |

---

## 7. 文档规模

| 文件 | 行数 |
|---|---|
| [`00-decisions.md`](./00-decisions.md) | 303 |
| [`01-domain-and-flows.md`](./01-domain-and-flows.md) | 1693 |
| [`02-database.md`](./02-database.md) | 1805 |
| [`03-backend-api.md`](./03-backend-api.md) | 3621 |
| [`04-frontend.md`](./04-frontend.md) | 2144 |
| [`05-import-and-llm.md`](./05-import-and-llm.md) | 1951 |
| 本文 `README.md` | 456 |
| [`design-brief.md`](./design-brief.md) | 95 |
| [`mockups/README.md`](./mockups/README.md) | 16 |
| [`mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md) | 93 |

各章都超出了最初给写作者的行数参考区间。这是**有意的**：决策 §14.8 明确"各章的行数目标只是参考，**不作为验收项**"，并且不得为压行数删掉被点名要求的内容，也不要把 skill 全文、DDL 拆到附录文件。十张表的完整 DDL、47 个端点的请求响应、skill 的完整文本必须一次给全，读者才能照着实现。行数只在这里作为一个规模参考，不代表质量。

---

## 8. 文档索引

- [`00-decisions.md`](./00-decisions.md) — 决策记录（唯一事实来源，含 §14.1–§14.53 的补充裁定）
- [`01-domain-and-flows.md`](./01-domain-and-flows.md) — 领域模型、流程、状态机、统计口径、不变量
- [`02-database.md`](./02-database.md) — 十张表的 DDL、ER 图、约束、索引、六步迁移链、生命周期
- [`03-backend-api.md`](./03-backend-api.md) — 模块图、配置、鉴权、47 个端点、错误 code 注册表、汇率、操作记录、限流、测试
- [`04-frontend.md`](./04-frontend.md) — 路由、状态、API 客户端与类型、页面、i18n、视觉实现规则、测试
- [`05-import-and-llm.md`](./05-import-and-llm.md) — 标准 CSV 格式、同步校验、四种自动标记、review 与提交撤销、skill 全文与生成脚本、安全、测试
- [`design-brief.md`](./design-brief.md) — 发给 Claude Design 的设计提示词（背景、逐屏要求、token 输出结构）
- [`mockups/README.md`](./mockups/README.md) — 设计稿目录说明与选定方向
- [`mockups/tokens.json`](./mockups/tokens.json) — **设计 token 的唯一来源**（决策 §14.45）
- [`mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md) — 16 张屏幕稿与决策记录的逐条比对，结论进了 §14.47–§14.52

---

## 9. 校对记录

这套文档写完后做过多轮跨章校对。每一轮都**没有改 [`00-decisions.md`](./00-decisions.md)，也没有改 [`mockups/`](./mockups/README.md)、[`design-brief.md`](./design-brief.md)、`../current-design/`、`backend/`、`frontend/`、`infra/`、`.planning/`**。

### 9.1 前五轮（摘要）

| 轮次 | 做了什么 |
|---|---|
| 第一轮 | 01–05 初稿成文 |
| 第二轮 | 新增本文；以决策记录为准逐项核对 01–05，统一错误 code、列名与表结构，并把十一处跨章矛盾（U-1 … U-11，见 §6.2）各选一种改齐 |
| 第三轮 | 终审点名的局部修正与全套终校；补齐当时的 §14.10–§14.15 裁定在各章的落地 |
| 第四轮 | 按终审清单与 §14.16–§14.19 做局部修正：草稿行提示字段统一叫 `hint`、批次错误只暴露 `{code, message}`、commit 无请求体、端点分桶与 §0 对照表逐行对齐 |
| 第五轮 | 分类边界改为消耗品 / 耐用品，一级分类加 `desc_zh` / `desc_en`（§14.20–§14.21），同步进 03 / 04 / 05 与本文 |

### 9.2 第六轮（2026-09-11，最终同步）

决策记录一次补进 §14.47–§14.52（屏幕稿审阅的裁定），01–05 **五章全部按新决策重写相关小节**：只收 CSV、账户类型四种、`transaction_events` 新表、`archived_at` 与净资产、交易列表 `summary`、草稿行批量端点、邀请码作废、撤销 `dry_run` 两计数、外观设置。改写过程中六处互相打架，由终审裁定并写进决策 §14.53（见 §6.3）。

### 9.3 第七轮（2026-09-11，终稿校对）

本轮做三件事：把 §14.53 的六条落到各章残留处、重写本文、对全套做机器校对。

**本文重写**（对照上一版）：

| # | 节 | 改动 |
|---|---|---|
| 1 | §0 | 导读表拆成"正文六件 + 视觉四件"，加入 [`mockups/README.md`](./mockups/README.md)、[`mockups/tokens.json`](./mockups/tokens.json)、[`mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md)、[`design-brief.md`](./design-brief.md)；端点数改成 47；infra 改动只剩 `--proxy-headers` 一处 |
| 2 | §1 | 产品目标态按"应用不接入大模型、导入靠 skill + 标准 CSV"重写；补配对 / 拆开、操作记录、资产 / 负债 / 净资产、外观设置；"不做"清单补齐 §14.52 的那批 |
| 3 | §2 | 改动总览按决策 §1–§14 全面重排，拆成 §2.1（§1–§13 主体）/ §2.2（§14.1–§14.19）/ §2.3（§14.20–§14.46）/ §2.4（§14.47–§14.53）四张表；§5 / §6 两行按改写后的内容重写，全部链接的小节号按各章现状重新核对 |
| 4 | §3 | 术语表新增「标准导入文件」「skill」「导入指南」「配对 / 拆开」「操作记录」「设计 token」六条；与大模型有关的条目删除；「自动标记」改成四种 |
| 5 | §4 | 目标目录结构删掉模型客户端 / 密钥模块 / 抽取器 / 分块器与上传目录，`services/importing/` 改成四个模块，补 `skills/wallet-import/`、`scripts/gen_import_skill.py`、`frontend/src/theme/tokens.ts` |
| 6 | §5 | 实施顺序改成八步：schema → 分类与汇率 → 账本 → 交易与配对 → 统计 → 前端 → 导入校验与 skill → 视觉实现 |
| 7 | §6 | 「待决汇总」改写成「决策状态：全部关闭」：§6.1 是各章原编号 → §14.x 的映射，§6.2 记 U-1 … U-11 的归属，§6.3 只剩决策 §14.53 一条（含每条的理由与推翻代价） |
| 8 | §7 | 行数表按 `wc -l` 重填，并补上 `design-brief.md` 与两份 mockups 文档 |
| 9 | §8 | 文档索引补入设计稿四件 |
| 10 | §9 | 校对记录压缩前五轮为一张摘要表，补第六、第七轮 |

**对 01–05 的残留修正**（本轮只改了这五处，均以 [`00-decisions.md`](./00-decisions.md) 为准）：

| # | 位置 | 改动 | 依据 |
|---|---|---|---|
| 1 | [01 §1.12](./01-domain-and-flows.md#112-导入草稿行-import_rows决策-51441) · [01 §3.17](./01-domain-and-flows.md#317-账单导入全流程决策-5614251447) | `counterpart_source_id` 指向已归档账户时原写 409 `source_archived`，改成与 03 / 05 一致的 **404 `not_found`**（不存在、不属于本账本、已归档三种情形对外不作区分） | §14.53c |
| 2 | [03 §5.41](./03-backend-api.md#541-patch-apiv1ledgersidimportsbidrowsrid) | `counterpart_source_id` 等于批次目标账户时原归在通用的 `validation_error` 下，改成注册表里更专属的 **400 `same_source`**（错误表拆成两行） | 03 §4.2 的规矩：有专属 code 就不用 `validation_error` |
| 3 | [05 §3.3](./05-import-and-llm.md#33-transfer_candidate决策-1434) | 修掉一个指向不存在文件的链接（`01-domain-model.md` → [`01-domain-and-flows.md`](./01-domain-and-flows.md)），并把"由 README 校对收口"的注记改成已对齐的结论 | 链接检查 |
| 4 | [05 §4.9](./05-import-and-llm.md#49-批次列表与详情) · [02 §1.7](./02-database.md#17-import_batches) | 两处"留给 README 跨章比对"的注记落地：`warnings` 列在 03 §5.37 / §5.38 / §5.39 的批次对象里都有；`ck_import_batches_filename` 反向约束的两处（03 粘贴分支回 `filename: null`、04 历史列表显示占位文案）都已写定 | §14.53e |
| 5 | [04 §3.3](./04-frontend.md#33-类型定义) | 类型定义引言里点名已删除的模型设置类型的那句，改成正面说法（服务端没有模型设置，前端自然没有承载它的类型） | §14.25 |

**机器校对的结果**（脚本见下，全部通过）：

| 检查 | 方法 | 结果 |
|---|---|---|
| 错误 code 集合比对 | 从 03 §4.2 抽出注册表，再从 01 / 02 / 04 / 05 / README 里抽出"被当作错误 code 用"的标识符（紧邻 HTTP 状态码、或写在 `code` 字段位置上的反引号标识符），求差 | 注册表 44 条；引用方**零例外**。落在表外的只有三个名字，且都不是服务端 code：04 §3.7 明确标注为「非服务端 code」的 `network_error`（请求根本没发出去）与兜底 key `unknown`，以及错误体示例里的占位串 `snake_case_code` |
| 前端文案表双向对拍 | 03 §4.2 的 code 序列 vs 04 §3.7 文案表的 code 序列 | 44 vs 44，集合相同、**顺序也相同**，既不缺 key 也没有多余 key |
| 残留关键词 | 对六个文件 grep 一份黑名单：上一版留下的字段名、端点、状态，以及被 §14.53d 定名替换掉的那些同义 code | 全部为零。唯一保留的一处否定式提及是 03 §4.2 的"本版删除的 code"清单——注册表**必须**说明哪些名字被删掉了，这是契约的一部分；其余各章连否定式都不写旧名字（用"非 CSV 一律 `import_format_invalid`"这样的正面说法） |
| 端点目录 | 03 §5 的小节路径集合 vs 决策 §11 的目录 | 47 条逐条对上，含 `/config`、`/import-format`、pair、unpair、邀请码 DELETE、草稿行批量 PATCH、交易列表的 `?import_batch_id=` |
| 状态名与标记名 | grep 全套 | 批次只有 `ready` / `committed`，行只有 `pending` / `edited` / `skipped`，标记只有 `duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review` |
| 列名 | grep 全套 | 草稿行日期列在库里叫 `occurred_at`、在文件与接口里叫 `date`；行号叫 `row_no`；批次列名（`filename` / `size_bytes` / `skill_version` / `row_count` / `committed_at` / `warnings`）三章一套（§14.53e） |
| 限制数值 | grep 全套 | 2 MB、2000 行、6 位码、10 分钟、加入账本 1 QPS、每人 10 本 / 每本 10 人、导入 10 批/小时、登录 10 次/分钟、注册 5 次/小时、`FX_MAX_BACKFILL_DAYS = 10`、`limit` 上限 200 / 500 —— 各章一致 |
| 链接与锚点 | 脚本按 GitHub 的锚点规则（小写、去标点、空格换连字符，**连续的连字符不合并**）算出每个标题的锚点，再校验全部 Markdown 链接的文件与 `#fragment` | 六个文件 + 设计稿目录的全部链接都指向存在的文件与存在的小节，零失效（本轮第一版的脚本误把连续连字符合并了，漏掉本文 9 处失效锚点，已在 §9.4 修好并用正确规则复跑） |
| tokens 引用 | grep `tokens.json` | 04 §6.2、mockups/README.md 与本文都指向同一份 [`mockups/tokens.json`](./mockups/tokens.json)，色值只有那一份 |

**核对无误、未作改动的项**：§14.47–§14.53 的裁定在各章的落地（只收 CSV、四种账户类型、`transaction_events`、`archived_at` 与净资产、列表 `summary`、批量端点、邀请码作废、`dry_run` 两计数、外观设置、配对统一子类型、不猜对手账户、code 定名、批次列名、04 类型对 03）逐条都能在各章找到实处（**§14.53b 多候选行的 `flags` 是个例外，本轮漏检，见 §9.4**）；跨章小节引用（03→02、03→05、04→03、05→02/03、01→各章）逐个核对无误；每章 `## 另见` 都链接了本文、[`00-decisions.md`](./00-decisions.md)、其余各章与相关的 `../current-design/` 章节；五章的 `## 待决` 都是零条未决。


### 9.4 第八轮（2026-09-11，终审回修）

终审在第七轮的成果上挑出两处硬伤，本轮只修这两处 + 两处记录问题：

| # | 位置 | 问题 | 改动 |
|---|---|---|---|
| 1 | 本文 §2.1 / §2.3 / §2.4 / §5 的 9 处链接（6 个不同标题） | 标题里 ` / `、`→`、`⇄`、`+` 这类符号被 GitHub 去掉后，**两侧的空格各生成一个连字符**，锚点里应当是**双**连字符；第七轮把它们写成了单连字符。第七轮自查的锚点脚本错误地合并了连续连字符，所以没报出来 | 6 个锚点改成双连字符（如 `#313-两腿转账的创建--编辑--删除决策-121452-a11`、`#37-错误归一化与-detail-code--文案`），锚点脚本改成不合并连字符后复跑为零 |
| 2 | [04 §8.4 用例 6](./04-frontend.md#84-review-表格的关键用例411) · [04 §4.11](./04-frontend.md#411-导入-review-表格statusready决策-5) | 多候选转账行的 `flags`：04 写「**没有** `transfer_candidate`」，而 [03 §5.40](./03-backend-api.md#540-get-apiv1ledgersidimportsbidrows) 、[05 §3.3](./05-import-and-llm.md#33-transfer_candidate决策-1434) 、[01 §3.15](./01-domain-and-flows.md#315-转账配对与拆开决策-1434) 都是「`transfer_candidate` **与** `needs_review` 同时打」；04 同章 §4.11 又写着「`transfer_candidate` 保留」，自相矛盾 | 以 [`00-decisions.md`](./00-decisions.md) §14.53b 与 03 / 05 / 01 为准：04 §8.4 用例 6 改成「`flags` **同时含** 两者、`matched_transaction_id` 为 `null`」，§4.11 的正文与 ASCII 示意把「改打 `needs_review`」改成「**另打** `needs_review`（`transfer_candidate` 仍在）」 |
| 3 | 本文 §2.3 | 表里没有 §14.33、§14.36–§14.39 五行，也没有像 §2.2 那样说明为什么 | 表前补一句：这五条是对 §0–§13 中 P-2…P-32 的逐条追认，不引入新改动，故不单列行 |
| 4 | 本文 §6.3 | 标题写「仍需你确认」，正文写「已由你确认」，口径打架 | 标题改成「唯一由 Claude 裁定的一条：决策 §14.53（已在看板 S14-53 确认，供最终追认）」 |

第七轮报告里「锚点零失效」与「§14.53 逐条落地无误」两句因此是不准确的，已在 §9.3 就地更正。

---

## 另见

- [`00-decisions.md`](./00-decisions.md) — 决策记录，本文每一行都可以追溯到它的某一节
- [`mockups/README.md`](./mockups/README.md) — 设计稿目录，视觉部分的唯一事实来源
- [`../current-design/README.md`](../current-design/README.md) — 现状总览与产品范围
- [`../current-design/01-domain-and-flows.md`](../current-design/01-domain-and-flows.md) — 现状的记账模型与用户流程
- [`../current-design/02-database.md`](../current-design/02-database.md) — 现状的四张表与迁移历史
- [`../current-design/03-backend-api.md`](../current-design/03-backend-api.md) — 现状的接口清单
- [`../current-design/04-frontend.md`](../current-design/04-frontend.md) — 现状的前端结构
- [`../current-design/05-infra-and-ops.md`](../current-design/05-infra-and-ops.md) — 部署形态（决策 §0.1 沿用）
- [`../current-design/06-known-issues.md`](../current-design/06-known-issues.md) — 现状已知问题，本套设计修掉的那些都在里面能找到条目
