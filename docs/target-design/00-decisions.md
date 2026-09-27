# 目标设计：决策记录（v3.0）

本文件是 `docs/target-design/` 其余各章的**唯一事实来源**。它记录了 2026-09 设计评审中逐条确认的改动决定。各章只能展开、细化这里的决定，不得与之矛盾；发现矛盾以本文件为准并修改各章。现状（as-is）见 [`../current-design/`](../current-design/README.md)，本文件里"现状"二字均指那套文档描述的状态。


> **读法（2026-09-16 补）**：本文是决策记录，不是实现状态。各节里的「现状 / 重写前」指 2026-09-09 评审时的 v2 实现，「目标」就是此后实现的样子；到 2026-09-16 第 1–7 阶段已把 §1–§13 与 §14 全部落地（进度与留档见 [`PROGRESS.md`](./PROGRESS.md)），规范正文以 01–05 章为准，本文只在两处仍然是活的：§0.7 的「不做」清单，与 §14 里标着「待用户追认」的裁定。
## 0. 范围与优先级

1. 顺序：**先把网页端全功能做好（含账单导入、UI 重设计）→ 部署上线 → Android/iOS**。账单的读取交给用户自己的 ChatGPT / Claude（§5、§6），应用不接入 LLM。本目标设计只覆盖第一步，部署沿用 `docs/current-design/05-infra-and-ops.md` 的方案，App 不在本设计范围。
2. 不再使用 GSD 规划工具；`.planning/` 里的 GSD 提示词后续清理，本设计不引用它。
3. UI 做全新视觉重设计；实现前先出 mockup 给用户看，现有 `.planning/research/ui-redesign-v2/spec.md` 只作参考。
4. 界面语言中英双语（i18n，默认跟随系统），分类名、错误信息也双语。
5. 用户范围：开放给亲友注册。需要注册开关（环境变量 `REGISTRATION_OPEN`，默认 `true`）、限流、上传大小限制。
6. 网页布局响应式：窄屏底部 tab + 中央"记一笔"按钮；宽屏（≥1024px）左侧导航栏 + 宽内容区。账单导入的 review 表格必须在桌面上好用。
7. 明确**不做**（本版本）：预算、找回密码/邮箱验证、分类管理、标签、实时协同、移动 App、钱迹的"不计收支"标记、交易时间（`occurred_at` 仍为日期）、应用内调用 LLM（API key、模型设置、服务端解析，2026-09-10 决定）。

## 1. 交易种类（kind）

重写前（v2）：没有种类列，金额正负决定方向。目标：

| kind | 金额符号 | 分类 | 说明 |
|---|---|---|---|
| `expense` | 负 | 必填一级，可选二级 | 支出 |
| `income` | 正 | 必填一级，可选二级 | 收入 |
| `refund` | 正 | 必填一级，可选二级（沿用原支出的） | 退款，统计时按退款日期冲减该分类的支出 |
| `transfer` | 转出腿负、转入腿正 | 无（必须为空） | 本人账户间划转，含信用卡还款 |

规则：**只有统计口径不同的东西才成为 kind**，四种之外不再加。

### 1.1 退款

- 可选字段 `refund_of` 指向原支出交易（同账本、`kind='expense'`）；关联后分类自动沿用原单，可改。
- 部分退款 = 多条 `refund` 行指向同一原单。累计退款超过原单金额时前端警告但允许保存。
- 原单被删除时退款行的 `refund_of` 置空（`ON DELETE SET NULL`），退款行保留。
- 选原单的界面复用交易列表的搜索筛选：默认 `kind=expense`、同账户预填但可改、最近 90 天，每条显示已退/可退金额。

### 1.2 转账

- `transfer_role`：`out` / `in`，转账必填。
- `transfer_subtype`：`plain` / `repayment`（信用卡还款），转账必填，单独一列 `VARCHAR(16)`，非转账为 NULL。
- `transfer_pair_id`：**可空**。对方账户在应用里时两腿共用同一个 `transfer_pair_id`；对方不在应用里（别人给我转、给别人转、用未录入的工资卡还信用卡）时单腿，`transfer_pair_id` 为 NULL，可填 `counterparty` 文本（如"老婆""工资卡"）。
- 单腿转账计入账户余额，**不计入**收入/支出统计。
- 表单和导入的默认逻辑：外部转入默认建议记为 `income`（分类"人情往来"等），用户明确选转账才记转账，避免真正的收入消失在统计之外。
- 两腿转账支持跨币种：两腿各自存自己的 `currency` 和 `amount`（出 100 USD / 入 720 CNY），不要求金额相等。手续费另记一笔 `expense`（分类 其他/手续费）。
- 有 `transfer_pair_id` 的两腿只能通过 `POST /ledgers/{id}/transactions/transfer` 一起创建、`PATCH/DELETE /ledgers/{id}/transactions/transfer/{pair_id}` 一起修改/删除；对单腿用普通交易接口。
- 导入时的转账配对（2026-09-10 用户决定，见 §14.34）：转账行（还款与普通划转都算）在其他账户上找 ±3 天内同币种同金额、方向相反、**仍是单腿**的转账；唯一候选则预填并在 review 里默认勾选"关联为一笔转账"，提交时两条挂同一个 `transfer_pair_id`；对方若已是两腿转账的一半，则本行标 `duplicate`。

### 1.3 分类（固定常量）

- 分类表是后端代码里的一个常量（`backend/app/core/categories.py`），一级、二级都**不可由用户修改**，没有分类管理接口和页面。想改就改代码发版，改含义时写数据迁移重映射。
- `transactions.category_l1`（必填于 expense/income/refund，transfer 为 NULL）、`category_l2`（可空）存分类 code。服务端校验：code 在表内；二级属于该一级；一级的收支种类与 kind 匹配（expense/refund 用支出分类，income 用收入分类）。
- 前端通过公开接口 `GET /api/v1/categories` 取表并永久缓存（带 `version`）；导入用的 LLM 提示词也从同一常量生成。
- 现有 `transaction_tags` 表、`?tag=` 筛选、标签输入框全部移除。
- 导入时 LLM 拿不准的行分类留空，review 表标"待归类"，提交前必须补一级分类。

冻结的分类表（code 唯一；zh / en 显示名都写进常量）：

**支出（16 个一级）**

| code | 一级 zh / en | 二级（code: zh） |
|---|---|---|
| `clothing` | 服饰 / Clothing | `clothes` 衣服、`shoes` 鞋子、`bags` 包、`accessories` 配饰 |
| `food` | 餐饮 / Food & Dining | `breakfast` 早餐、`lunch` 午餐、`dinner` 晚餐、`late_snack` 夜宵、`snacks_drinks` 零食饮料 |
| `housing` | 居住 / Housing | `rent` 房租、`mortgage` 房贷 |
| `transport` | 交通 / Transport | `public_transit` 公交地铁、`taxi` 打车、`fuel` 加油、`parking` 停车、`train` 火车、`flight` 飞机 |
| `health` | 健康 / Health | `medical` 看病、`medicine` 买药、`checkup` 体检、`wellness` 保健、`fitness` 健身 |
| `entertainment` | 娱乐 / Entertainment | `movies` 电影、`games` 游戏、`ktv` KTV、`outing` 出去玩 |
| `groceries` | 生活购物 / Groceries & Household | `fresh_food` 买菜、`toiletries` 洗护清洁、`kitchenware` 厨房用品、`household` 日用杂货（纸巾、垃圾袋、电池、衣架等，原「家居耗材」并入） |
| `shopping` | 消费购物 / Shopping | `electronics` 数码、`appliances` 家电、`furniture` 家具、`other_goods` 其他物件（行李箱、工具、装饰品等不成类的耐用品） |
| `pet` | 宠物 / Pets | `pet_food` 宠物粮、`pet_medical` 宠物医疗、`pet_supplies` 宠物用品 |
| `childcare` | 育儿 / Childcare | `formula_diapers` 奶粉尿布、`toys` 玩具、`education` 教育、`kids_clothes` 衣物、`kids_medical` 医疗 |
| `parents` | 父母 / Parents | `filial` 孝敬、`gifts` 礼物、`parents_medical` 医疗 |
| `bills` | 固定支出 / Bills & Utilities | `water` 水费、`electricity` 电费、`gas` 燃气、`property_fee` 物业、`internet` 宽带、`mobile` 话费 |
| `culture` | 精神文化支出 / Culture & Learning | `books` 书籍、`courses` 课程、`stationery` 文具、`paid_content` 知识付费、`exhibitions` 展览、`subscriptions` 订阅 |
| `travel` | 旅游 / Travel | `flights` 机票、`hotels` 酒店、`tickets` 门票、`local_transport` 当地交通、`travel_food` 旅游餐饮 |
| `social` | 人情往来 / Social & Gifts | `red_packet` 红包礼金、`treat` 请客、`lend` 借出、`transfer_out` 转给他人 |
| `other` | 其他 / Other | `fines` 罚款、`fees` 手续费 |

**收入（6 个一级）**

| code | 一级 zh / en | 二级（code: zh） |
|---|---|---|
| `salary` | 工资 / Salary | `base_salary` 基本工资、`bonus` 奖金、`rsu` RSU |
| `side_income` | 兼职 / Side Income | — |
| `investment` | 理财 / Investment | `interest` 利息、`dividend` 分红、`fund` 基金 |
| `reimbursement` | 报销 / Reimbursement | — |
| `social_income` | 人情往来 / Social & Gifts | `red_packet_in` 红包礼金、`borrow` 借入、`transfer_in` 他人转入 |
| `other_income` | 其他 / Other | — |

边界约定：**生活购物 = 消耗品与家里的日常运转（用完就没了），消费购物 = 耐用品与一次性大件（买一次用几年）**；不按"必需 / 非必需"划分，因为那个判断太主观。LLM 遇到淘宝/京东/Shopee 这类分不清的**留空**不硬猜，不进任何兜底桶。退款不是收入分类（它是 kind）。

**一级分类的说明文字**（2026-09-09 用户提出）：每个一级分类在常量里带 `desc_zh` / `desc_en` 两段说明，写的是归类判据和易混淆的去向。`GET /categories` 随分类表下发（只在一级上有，二级为 `null`）；前端在所有选分类的地方（记一笔表单、导入 review 表格、批量设分类）把说明显示在一级名称下方作辅助文字，统计页的一级分类用它做提示；LLM 提示词的一级分类行也带上中文说明作为判据。说明文字与分类表一起冻结在代码里，改动时 `version` 递增。

| code | desc_zh | desc_en |
|---|---|---|
| `clothing` | 穿在身上的：衣服、鞋、包、配饰。运动装备也算这里；童装归育儿 | What you wear: clothes, shoes, bags, accessories. Sportswear too; kids' clothes go under Childcare |
| `food` | 日常吃喝：堂食、外卖、咖啡奶茶、零食。旅途中的吃喝归旅游 | Everyday eating and drinking, incl. delivery, coffee, snacks. Meals on trips go under Travel |
| `housing` | 住的固定大头：房租、房贷。水电物业归固定支出 | Rent and mortgage. Utilities and property fees go under Bills |
| `transport` | 日常出行：公交地铁、打车、加油、停车、火车飞机。旅游期间的交通归旅游 | Daily getting around. Transport during trips goes under Travel |
| `health` | 自己的看病买药、体检、保健品、健身。宠物和孩子的医疗各归宠物、育儿 | Your own medical care, checkups, supplements, fitness. Pets' and kids' care go to their own categories |
| `entertainment` | 玩乐：电影、游戏、KTV、酒吧、桌游密室。视频音乐订阅归精神文化 | Fun: movies, games, karaoke, bars, board games. Streaming subscriptions go under Culture & Learning |
| `groceries` | 消耗品和家里的日常运转：买菜、洗护清洁、厨房用品、纸巾垃圾袋等日用杂货。判据：用完就没了 | Consumables that keep the household running: groceries, toiletries, kitchen and household supplies. Test: it gets used up |
| `shopping` | 耐用品和一次性大件：数码、家电、家具、行李箱工具等。判据：买一次用几年 | Durable and one-off purchases: electronics, appliances, furniture, luggage, tools. Test: bought once, used for years |
| `pet` | 宠物的吃、用、看病 | Everything for pets: food, supplies, vet |
| `childcare` | 孩子的一切：奶粉尿布、玩具、教育、衣物、医疗 | Everything for the kids: formula, diapers, toys, education, clothes, medical |
| `parents` | 给父母的：孝敬钱、礼物、医疗 | For your parents: allowances, gifts, medical |
| `bills` | 每月固定的账单：水、电、燃气、物业、宽带、话费。房租房贷归居住 | Recurring monthly bills: water, electricity, gas, property fee, internet, mobile. Rent and mortgage go under Housing |
| `culture` | 学习和精神消费：书、课程、文具、知识付费、展览、视频音乐订阅 | Learning and culture: books, courses, stationery, paid content, exhibitions, streaming subscriptions |
| `travel` | 离开常住地的旅程中的一切：机票、酒店、门票、当地交通、旅途餐饮 | Everything on a trip away from home: flights, hotels, tickets, local transport, meals |
| `social` | 花在别人身上的：红包礼金、请客、借出、转给他人。给父母的归父母 | Spent on other people: gifts and red packets, treating, lending, transfers to others. Parents have their own category |
| `other` | 归不进上面任何一类的：罚款、手续费、年费 | Anything that fits nowhere above: fines, fees, annual charges |
| `salary` | 雇主发的钱：基本工资、奖金、RSU | From your employer: base salary, bonus, RSU |
| `side_income` | 主业之外的劳务收入 | Income from work outside your main job |
| `investment` | 钱生的钱：利息、分红、基金赎回收益 | Money earned by money: interest, dividends, fund gains |
| `reimbursement` | 垫付后收回的钱 | Money paid back to you after you covered a cost |
| `social_income` | 别人给的：红包礼金、借入、他人转入 | From other people: red packets and gifts, loans received, transfers in |
| `other_income` | 归不进上面任何一类的收入 | Income that fits nowhere above |

### 1.4 备注与商户

- `transactions.description` 改名为 `note`（≤500 字），语义"这笔账的备注"；手工记账自由填，导入时由 LLM 填（原文摘要清理后 + 外币原值等）。
- `merchant`（≤200 字）保留为独立字段，搜索、退款匹配、去重都靠它。

## 2. 账本与成员

重写前（v2）：一切挂在 `users.id` 下，没有账本概念。目标：

- `ledgers`：id、name、base_currency、created_by、created_at、updated_at。**基准币种属于账本**，用户自己的 `users.base_currency` 只作新建账本的默认值。
- `ledger_members`：(ledger_id, user_id) 主键、role（`owner` / `member`）、joined_at。创建者自动 owner；每本账恰有一个 owner（应用层保证）。
- `ledger_invites`：id、ledger_id、code（6 位数字）、created_by、created_at、expires_at（生成后 10 分钟）。一次性使用：加入成功时**直接删除**这行；过期的行在下次生成或校验时删除。表里永远只有有效的码，没有 `used_by` / `used_at`（2026-09-10 用户决定）。
- 注册时自动建一本"默认账本"（名字"我的账本"，基准币种 = 用户默认币种）。
- 加入流程：owner 在账本设置里生成邀请码 → 线下告诉对方 → 对方在"加入账本"输入 → 服务端校验（存在、未过期、非本人已在成员）→ 同一事务内写入成员、删除邀请码。`POST /ledgers/join` 整个端点全局限 1 QPS（令牌桶，突发 3，超出 429 + `Retry-After`，code `invite_rate_limited`），不按用户计数（2026-09-10 用户决定，P-12）；被限流的请求不触碰邀请码，码只在加入成功时删除或到期后失效。
- 权限：owner 可生成邀请码、移除成员、改账本名/基准币种、转让 owner、删除账本（级联删除账户、交易、导入）；member 可做其余一切（记账、改账、导入、管理账户）。member 可自行退出；owner 必须先转让再退出。
- 归属：`finance_sources`、`transactions`、`import_batches` 都属于账本（`ledger_id`），每行记录 `created_by`，交易和账户另记 `updated_by`。账本内账户完全共享。
- 软限制：每人最多 10 本账，每本最多 10 人。
- 并发：不做实时同步。`transactions`、`finance_sources`、`ledgers` 带 `updated_at`；PATCH 请求体带客户端看到的 `updated_at`，不一致返回 409 `stale_update`，前端提示重新加载。列表在窗口重新聚焦时自动刷新。
- 所有业务接口改为 `/api/v1/ledgers/{ledger_id}/...` 前缀，鉴权 = "当前用户是该账本成员"。

## 3. 资金账户（finance_sources）

- 挂账本；字段：id、ledger_id、name、type（`checking` 储蓄卡 / `credit` 信用卡 / `cash` 现金 / `other` 其他；无 `savings`，2026-09-11 用户决定 §14.48）、default_currency、opening_balance（`NUMERIC(18,4)`，默认 0）、archived、created_by、updated_by、created_at、updated_at。
- 余额 = opening_balance + 该账户所有交易 `amount` 之和（含单腿转账）。
- 归档规则维持：归档后不能再记账、不能作为导入目标，历史保留；有交易的账户不能删除，只能归档。
- 2026-09-11 补充（§14.50）：账户表加 `archived_at`；归档账户**不计入**净资产与首页合计，归档时提示"该账户余额将从净资产中移除"；`default_currency` 创建后不可改；账户列表按类型分组并给小计；净资产 = 资产（非信用卡账户余额折算之和）+ 负债（信用卡账户余额折算之和，为负）。

## 4. 搜索与筛选

`GET /api/v1/ledgers/{id}/transactions` 参数：`q`（ILIKE 匹配 merchant / note）、`kind`（可多个）、`category_l1`、`category_l2`、`source_id`（可多个）、`from` / `to`（日期）、`currency`、`min_amount` / `max_amount`（按账本基准币种折算后的绝对值比较，§14.49）、`limit` / `offset`；返回 `{items, total}`，每行带原币金额与折算金额。ILIKE 足够，不做全文索引。筛选状态放在前端 URL 里。

## 5. 账单导入（2026-09-10 改版：应用不接入 LLM）

- **原则**：应用本身不调用任何大模型。用户在自己的 ChatGPT / Claude（网页或 App，用自己的订阅）里安装我们提供的 skill，把任意账单（PDF、图片、Excel、CSV……交给聊天工具去读）整理成**标准导入文件**，再上传到应用。应用只负责校验、review、入账。
- **标准导入格式**（唯一契约）：**只有 CSV**（2026-09-11 用户决定，§14.47；JSON 不再接受）。固定表头 `date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref`，UTF-8（可带 BOM），首行是 `# version: 2026-09-10`（分类表版本）。字段语义与 §1 完全一致：支出为负、收入与退款为正、转账按 `transfer_role` 定号；`transfer_role` / `transfer_subtype` 只在 `kind='transfer'` 时有值；分类 code 取 §1.3 的表，拿不准留空；`source_ref` 可选，指回账单原文位置；`date` 为 `YYYY-MM-DD`。
  - 上传文件或在应用内文本框直接粘贴 CSV 文本，两者走同一校验。
- **校验**（服务端同步完成，秒级）：结构错误（不是文本 / 编码不可读、缺 `# version:` 行、表头与 11 列固定表头不符、某行列数不对）→ 400，按行号返回错误，不建批次。行级问题不丢行、只打标记：`date` 必须是 `YYYY-MM-DD`，否则 `needs_review`；`amount` 非数字或为 0 → `needs_review`；`currency` 不是三位字母 → 用目标账户币种并 `needs_review`；`kind` 不在四种之内 → 按金额符号推断并 `needs_review`；分类 code 不在表内、二级不属于一级、收支方向与 kind 不符 → 对应字段置空（待归类）；每一处校验改动都写进该行的 `hint`（如"币种 XX 无效，已改为账户币种"），不另存原始值；`version` 缺失或与应用当前分类表版本不一致 → 整批 400 `skill_outdated`，错误里带应用当前版本与"导入指南"链接，用户更新 skill 后重传（2026-09-10 用户决定，不再是警告）。上限：文件 ≤2 MB、单批 ≤2000 行。
- **一份文件对应一个目标账户**，上传时由用户选；文件里不含账户信息。
- **状态机**：`ready → committed`。校验通过即 `ready`（同步返回批次和全部草稿行，没有 parsing / 进度 / 轮询）；`ready` 下可编辑草稿和提交；`committed` 后可整批撤销 = 整批删除（§14.22）。校验不通过不产生批次。
- **两张表**：`import_batches`（账本、目标账户、上传人、来源 `json` / `csv` / `paste`、原文件名与大小（只记名字，**不保存文件**，2026-09-10 用户决定）、`skill_version`、状态、行数、警告、时间戳）与 `import_rows`（批次、`row_no`、状态 `pending` / `edited` / `skipped`、date、amount、currency、kind、transfer_role、transfer_subtype、merchant、note、category_l1、category_l2、source_ref、`hint`、flags、matched_transaction_id、counterpart_source_id、counterparty、提交后的 transaction_id）。不再有 confidence、page_no、chunk_*、raw_response、error_* 列。
- **自动标记**不变：`ready` 时打 `duplicate`（同账户同日同金额已存在）、`refund_candidate`（按 §1.1 规则找到唯一候选原单则预填 `matched_transaction_id`）、`transfer_candidate`（按 §1.2 / §14.34 规则找到可配对的单腿转账则预填 `matched_transaction_id`）；外加上面的 `needs_review`。 同一批内完全相同的行**不合并**：都保留、都打 `needs_review`，`hint` 写"本批内有相同的行（第 N 行）"，由用户在 review 里取舍；标记只有这四种，没有 `merged_duplicates`（2026-09-10 用户决定）。退款候选以金额 + 时间窗 + 同账户为主，商户只作加分，仅在候选唯一时预填。
- **review 表格**不变：每行所有字段可改、可标跳过、可改 kind、可选分类、可关联退款原单、可选对手账户；没一级分类的行显示"待归类"，提交前必须补齐；不再有页面缩略图（应用拿不到原始账单）。
- **提交**：`POST .../imports/{batch_id}/commit`，一个数据库事务内建所有交易（两腿还款一起建），每条交易记 `import_batch_id`；成功后批次 `committed`。
- **限制与限流**：导入每用户每小时 10 批；上传 ≤2 MB。

## 6. 导入 skill（取代原"LLM 设置与接口"）

- 应用**不存任何模型设置**：没有 `user_llm_settings` 表，没有 `/me/llm-settings` 接口，没有 API key，没有"测试连接"。
- **skill 是仓库里的交付物** `skills/wallet-import/`：一份主文本（角色、输入任意账单、输出上面的标准 CSV 文件并提供下载、也可直接输出代码块），两种包装——Claude 的 `SKILL.md`（Claude.ai 项目 / Claude Code 皆可安装）和 ChatGPT 的 Custom GPT / Project 指令文本。规则沿用原提示词：支出为负、收入为正、退款标 `refund` 并尽量注明来源、信用卡还款标 `transfer` + `repayment`、本人账户间划转标 `transfer` + `plain`、外币原值写进 `note`、清理商户名噪音、日期一律 `YYYY-MM-DD`、分不清的分类**留空不猜**、不得自创 code、不输出卡号全号。
- **分类表与版本同源**：skill 文本里的分类清单（code + 中文名 + 一级判据 §1.3）由脚本从 `backend/app/core/categories.py` 生成，`version` 就是 `CATEGORY_VERSION`；改分类表必须重新生成并发布 skill。应用校验 `version` 不一致时拒绝导入并提示用户更新 skill（§5）。
- **应用内"导入指南"页**：三步说明（安装 skill → 在你的 ChatGPT / Claude 里上传账单让它整理 → 把生成的 CSV 上传到这里），附 skill 文本的复制 / 下载按钮，以及标准 CSV 的示例文件。
- 将来若要做"应用内一键导入"，标准格式已是契约，只需加一条可选的服务端调用路径，不改现有设计。

## 7. 统计与首页

- 账户余额（§3），按账本基准币种折算后给合计；首页分别显示资产、负债、净资产，归档账户不计入（§14.50）。
- 按月（可切换月份）支出/收入按一级分类汇总，可下钻二级；退款按退款日期冲减对应分类；转账不计入。
- 最近 12 个月**支出**趋势（首页只放支出，收入不放，屏幕放不下；2026-09-11 用户决定 §14.52）。
- 全部按账本基准币种折算。不做预算。

## 8. 汇率

- **读取时计算**，不落库；统一为一个函数（现状两套公式不一致的问题就此消除）。
- 交易与统计用**发生日**汇率（一经公布不再变）；账户余额用**最新**汇率。
- 无行情日（周末、节假日、当天尚未公布）回退到最近一个已公布的交易日。
- 汇率来源为 Frankfurter。现状**没有**缓存表（迁移 `5ca7fe6e37db` 已删除 `exchange_rates`，每次请求实时调用），目标态重新建一张缓存表，定义见 §14.1。

## 9. 认证与安全

- 邮箱 + 密码 + JWT 不变；不做找回密码、邮箱验证；提供管理员重置密码脚本 `backend/scripts/reset_password.py`。
- 注册开关 `REGISTRATION_OPEN`；登录限流（同 IP 每分钟 10 次）；加入账本端点全局 1 QPS（§2）；导入限流（每用户每小时 10 批）；上传 ≤2 MB（标准导入文件是纯文本）。
- 错误响应统一 `{"detail": "...", "code": "snake_case_code"}`。

## 10. 目标数据库表一览

`users`、`ledgers`、`ledger_members`、`ledger_invites`、`finance_sources`、`transactions`、`import_batches`、`import_rows`、`exchange_rates`（九张；`user_llm_settings` 已随 2026-09-10 的导入改版取消）。删除 `transaction_tags`。枚举一律 `VARCHAR + CHECK`，不用 Postgres ENUM。`transactions` 的关键约束：

- `kind IN ('expense','income','refund','transfer')`
- 符号：expense 为负；income、refund 为正；transfer out 为负、in 为正
- `(kind='transfer') = (transfer_role IS NOT NULL)`，`(kind='transfer') = (transfer_subtype IS NOT NULL)`
- `kind='transfer'` → `category_l1 IS NULL AND category_l2 IS NULL`；其他 kind → `category_l1 IS NOT NULL`
- `refund_of IS NULL OR kind='refund'`
- `UNIQUE (transfer_pair_id, transfer_role)`（NULL 不参与）
- `transfer_pair_id IS NULL OR counterparty IS NULL`（有对腿就不填对方文本）

## 11. API 目录（全部在 `/api/v1`）

| 分组 | 端点 |
|---|---|
| 认证 | 现有 `auth` 接口保留（注册受 `REGISTRATION_OPEN` 控制） |
| 我 | `GET /me`、`PATCH /me`（默认币种、语言） |
| 分类 | `GET /categories`（公开，带 `version`，`Cache-Control: immutable`） |
| 配置 | `GET /config`（公开，`{registration_open}`，供注册页提前判断；§14.46） |
| 账本 | `GET /ledgers`、`POST /ledgers`、`GET/PATCH/DELETE /ledgers/{id}`、`GET /ledgers/{id}/members`、`DELETE /ledgers/{id}/members/{user_id}`、`POST /ledgers/{id}/leave`、`POST /ledgers/{id}/transfer-ownership`、`POST /ledgers/{id}/invites`、`POST /ledgers/join` |
| 账户 | `GET/POST /ledgers/{id}/sources`（GET 含余额）、`GET/PATCH/DELETE /ledgers/{id}/sources/{sid}` |
| 交易 | `GET/POST /ledgers/{id}/transactions`（列表支持 `?import_batch_id=` 筛选；详情：支出行带 `refunds[]`、退款行带 `refund_of` 展开的原单摘要，§14.46）、`GET/PATCH/DELETE /ledgers/{id}/transactions/{tid}`、`POST /ledgers/{id}/transactions/transfer`、`PATCH/DELETE /ledgers/{id}/transactions/transfer/{pair_id}`、`POST /ledgers/{id}/transactions/{tid}/pair`（与另一条单腿转账配对，§14.34）、`POST /ledgers/{id}/transactions/transfer/{pair_id}/unpair`（拆开） |
| 统计 | `GET /ledgers/{id}/stats/summary?month=YYYY-MM`、`GET /ledgers/{id}/stats/trend?months=12` |
| 导入 | `POST /ledgers/{id}/imports`（multipart CSV 文件，或 JSON 体 `{source_id, text}` 粘贴 CSV 文本；同步校验，直接返回批次与草稿行）、`GET /ledgers/{id}/imports`、`GET /ledgers/{id}/imports/{bid}`、`GET .../rows`、`PATCH .../rows/{rid}`、`POST .../commit`、`DELETE /ledgers/{id}/imports/{bid}`（ready = 丢弃；committed = 撤销）；`GET /import-format`（公开：标准格式说明、示例文件、skill 文本，带 version） |
| 汇率 | 现有 `rates` 接口保留 |

## 12. 前端

- 页面：登录/注册、账本列表与切换、首页（统计）、交易列表（含筛选栏）、记一笔（四种 kind 的表单，转账含对手账户可选）、账户列表/表单、导入（导入指南 → 上传或粘贴 → review 表格 → 历史）、账本设置（成员、邀请码、基准币种）、个人设置（默认币种、语言）。
- 当前账本 id 放在 URL 里；筛选条件放在 URL query。
- 技术栈沿用 Expo / react-native-web / TanStack Query / axios；API 客户端按 §11 重写；i18n 引入语言包。
- 视觉重设计的方向在 `04-frontend.md` 里提方案，实现前出 mockup。

## 13. 从现状迁移

一次性 Alembic 迁移链（在 head `8a4f4d66d893` 之后）：

1. 建 `ledgers`、`ledger_members`、`ledger_invites`、`import_batches`、`import_rows`。
2. 每个现有用户建默认账本 + owner 成员，`base_currency` 复制自 `users.base_currency`。
3. `finance_sources`、`transactions` 加 `ledger_id`（回填为该用户默认账本）、`created_by`、`updated_by`、`updated_at`；账户加 `opening_balance`、`type` 增加 `cash`、现有 `savings` 回填为 `checking`（§14.48）。
4. `transactions`：`description` → `note`；加 `kind`（回填：`transfer_pair_id` 非空 → transfer，否则金额 <0 → expense、≥0 → income）、`transfer_role`（按符号）、`transfer_subtype`（回填 `plain`）、`refund_of`、`counterparty`、`category_l1` / `category_l2`（现有 expense/income 行回填 `other` / `other_income`）、`import_batch_id`；加 §10 的 CHECK。
5. 删除 `transaction_tags`。
6. 把 `users.base_currency` 保留为"新建账本默认币种"。

现有数据只有测试数据，迁移允许粗回填，但迁移脚本必须可在空库和有数据的库上都跑通，并有 Postgres 迁移测试。

## 14. 评审后的补充裁定（2026-09-09）

第一轮各章评审暴露出决策记录没覆盖或前提写错的地方，这里统一裁定，效力与前面各节相同；各章与本节冲突时以本节为准。

1. **`exchange_rates` 缓存表**：现状已无此表（见 §8）。目标态新建 `exchange_rates(date DATE, base CHAR(3), symbol CHAR(3), rate NUMERIC(18,8), fetched_at TIMESTAMP NOT NULL, PRIMARY KEY (date, base, symbol))`。换算时缺哪一天就向 Frankfurter 取哪一天并落库；"最新汇率" = 最近一个已公布日的行，同一 (base, symbol) 一小时内不重复请求。 写入按主键 upsert、保留全部历史行、不做整表刷新——历史汇率一经公布不再变，缓存的意义正是让发生日汇率不必反复外网请求（2026-09-10 用户追认并确认）。目标币种列名统一为 `symbol`（与现有 `/rates` 接口的 `symbols` 参数同源），不用 `quote`。
2. **账户余额的币种**：余额以账户 `default_currency` 计价：`余额 = opening_balance + Σ convert(amount, tx.currency → account.default_currency, on = occurred_at)`，同币种交易不换算。`balance_base = convert(余额, account.default_currency → ledger.base_currency, 最新汇率)`。不按币种分桶，接口只返回这两个标量（外加 `balance_rate` / `balance_rate_date`）。（2026-09-10 用户追认：账户余额按账户币种显示，合计按基准币种。）
3. **kind 互改**：`expense` / `income` / `refund` 之间可通过 PATCH 改 `kind`（服务端重新校验分类与金额符号）；`transfer` 与非 `transfer` 之间**禁止互改**，返回 400 `kind_change_not_allowed`，只能删掉重记。
4. **错误 code 注册表**：以 `03-backend-api.md` §4.2 的清单为唯一注册表。01 / 04 / 05 章引用的每个 code 都必须出现在注册表里；缺的加进注册表，不允许各章自造同义名。
5. **`import_rows` 行号列**：名字统一为 `row_no`。（2026-09-10 用户追认。）
6. **users 表三处**：新增 `display_name VARCHAR(40) NULL`（`PATCH /me` 可改，没填时界面显示邮箱 `@` 前的部分；2026-09-10 用户采纳 03-3）；删除现状的 `users.default_source_id`（多账本下语义失效，改为前端本地记住上次使用的账户）；新增 `users.language VARCHAR(8) NULL`（`PATCH /me` 可改，NULL 表示跟随系统）。`user_llm_settings`、`ledger_invites` 各加 `created_at`。（2026-09-10 用户追认；`user_llm_settings` 已随 §14.25 取消，`ledger_invites` 的 `created_at` 仍加。）
7. **导入提交时写 `refund_of` 的条件**：行 `kind = 'refund'` 且 `matched_transaction_id` 非空（不论是服务端预填还是用户改选），提交时写入 `refund_of`；不引入"用户已确认"这类额外状态。（2026-09-10 用户追认。）
8. **篇幅**：各章的行数目标只是参考，不作为验收项。不得为压行数删除被点名要求的内容，也不要把提示词、schema 拆到附录文件。（2026-09-10 用户追认。）
9. **导入分块超长时的图片切分**：图片块被模型截断（`finish_reason = length`）时无条件对半切一次（重叠 6%），子块标记为已切分；已切分的子块再次被截断则整批 `failed`，不再递归。
10. **导入草稿行的对手文本**：`import_rows` 增加 `counterparty VARCHAR(100) NULL`，`PATCH .../rows/{rid}` 可改；提交单腿转账时写入 `transactions.counterparty`。（2026-09-10 用户追认。）
11. **退款候选列表**：不单独建接口。review 界面和记账表单的「关联原单」选择器都复用 `GET /ledgers/{id}/transactions`（expense 行自带 `refunded_total` / `refundable`）。（2026-09-10 用户追认。）
12. **视觉路径的页面缩略图**：解析时把渲染出的页面图存到 `UPLOAD_DIR/{ledger_id}/{batch_id}/pages/{page_no}.png`；批次响应在 `used_vision = true` 时带 `pages: [{page_no, image_url}]`，草稿行带 `page_no`（非视觉路径为 NULL，`import_rows` 增加 `page_no INTEGER NULL`）；图片经鉴权接口 `GET /ledgers/{id}/imports/{bid}/pages/{page_no}` 返回，批次删除时连同删除。
13. **账本名长度**：1–100 字符，与账户名一致。（2026-09-10 用户追认。）
14. **服务重启时的失败 code**：`import_interrupted`（500），登记进 03 §4.2 注册表；`import_batches.error_code` 写同一个名字。
15. **批次错误字段的暴露**：数据库存 `error_code` / `error_message` / `error_chunk` 三列；接口响应只暴露 `error: {code, message}`，`error_chunk` 仅用于服务端日志与重试定位，前端不展示。
16. **`import_rows.counterparty` 的来源**：解析阶段恒为 NULL（LLM 不猜对手账户，输出 schema 里没有这个字段），只有用户在 review 里通过 `PATCH .../rows/{rid}` 填写才有值；skill 不猜对手账户。（2026-09-10 用户追认。）
17. **缩略图 `image_url` 的形态**：相对 API 根的路径（例如 `/ledgers/{id}/imports/{bid}/pages/1`，不含 `/api/v1` 前缀），前端用已配置 baseURL 与鉴权头的 axios 实例直接请求并取 blob；`pages` 数组按磁盘上实际存在的 `{page_no}.png` 升序生成，越界判断也以此为准，不用 `chunk_total`。
18. **`POST .../imports/{bid}/commit` 无请求体**：不做乐观锁校验，重复提交靠 409 `batch_already_committed` 保护。（2026-09-10 用户追认。）
19. **草稿行提示字段名**：统一叫 `hint`（对应 `import_rows.hint`），不再使用 `note_hint`。（2026-09-10 用户追认。）
20. **生活购物 / 消费购物的边界**（2026-09-09 用户决定）：按消耗品 / 耐用品区分，不按必需 / 非必需；「日用杂货」归生活购物并吞并「家居耗材」（code `household`，名「日用杂货」）；消费购物增加 `other_goods` 其他物件；删除 `misc_goods`。§1.3 的表已按此更新。
21. **一级分类带说明文字**（2026-09-09 用户提出）：`desc_zh` / `desc_en` 进常量、随 `GET /categories` 下发、前端选分类处显示、LLM 提示词作判据。全文见 §1.3。
22. **撤销导入整批删除**（2026-09-09 用户决定，README U-1）：不引入 `reverted` 状态，不为追溯保留已撤销批次，避免数据库里留垃圾。
23. **解析进度用小数**（2026-09-09 用户决定，README U-2，推翻校对时的整数对）：`GET /ledgers/{id}/imports/{bid}` 返回 `progress: number | null`，取值 0–1、保留两位（`chunk_done / chunk_total`），切块完成前（总数未知）为 `null`；数据库仍存 `chunk_done` / `chunk_total` 两列，接口不暴露。前端显示百分比，`null` 时显示"正在读取账单…"。**各章已被 §14.25 取代，不再同步**：03 §5.40 响应、04 `ImportBatch` 类型与进度页、05 §10.3 进度计算。
24. **导入只有一条视觉流水线**（2026-09-09 用户决定，取代 U-3 与 §5 原"文字优先、视觉兜底"）：用户必须配置支持图片输入的模型（`vision_model` 字段删除，测试连接验证图片能力）；PDF 每页渲染成图片、图片原样、CSV / XLSX 读成纯文本，都送同一个模型、同一份提示词、同一个 schema；不做本地 PDF 文字抽取。批次表删除 `used_vision`，PDF / 图片批次一律有 `pages` 缩略图；`needs_review` 只按置信度与解析异常打标。**各章已被 §14.25 取代，不再同步**：01 实体字段、02 `import_batches` / `user_llm_settings` 列、03 §5.9–5.10 与 §5.40/§5.46、04 设置页与 `ImportBatch` 类型、05 §2–§3 抽取与分块整章、README。
25. **应用不接入 LLM，导入改为"用户自己的 ChatGPT / Claude + 标准格式文件"**（2026-09-10 用户决定，§5、§6 已整体改写）。由此**作废**的条目：§14.9（图片切分）、§14.12（页面缩略图与 pages 接口）、§14.14（`import_interrupted`，不再有后台解析）、§14.15（批次错误三列，校验错误同步返回）、§14.17（`image_url`）、§14.23（进度小数，校验同步无进度）、§14.24（视觉流水线）；README 的 U-2、U-3 随之作废。§14.10（`counterparty`）、§14.11（退款候选复用列表）、§14.19（`hint`）继续有效。**各章已同步（2026-09-11）**：01 §1 实体与 §3 导入流程、02 删 `user_llm_settings` 并精简 `import_batches` / `import_rows`、03 删 LLM 设置与 pages / retry 端点、导入端点改同步、04 删 LLM 设置页并加导入指南页、05 章重写为"标准导入格式 + skill 规范 + 校验规则 + 自动标记"、README。新增交付物：`skills/wallet-import/` 与生成脚本。
26. **时间戳存不带时区的 UTC**（2026-09-10 用户确认，README U-4）：`created_at` / `updated_at` / `expires_at` 等沿用现状的 naive UTC 列，接口输出一律带 `Z`，前端按浏览器时区显示；不用 `timestamptz`。
27. **导入代码放在 `backend/app/services/importing/` 包**（2026-09-10 用户确认，README U-6）：按读文件 / 校验 / 标记 / 提交撤销分文件；没有抽取器目录。
28. **不保存上传的导入文件，也不存原始行值**（2026-09-10 用户决定，README U-7 作废）：批次只记文件名与大小；校验改动写进行的 `hint`；后端没有文件系统状态，`UPLOAD_DIR`、上传卷、目录清理全部取消（05 待决 8 随之作废）。
29. **邀请码不要求全表唯一，用掉即删、过期即删**（2026-09-10 用户决定，README U-8 改、02 待决 D-6 一并定）：`ledger_invites.code` 不建唯一索引；生成时只保证与当前有效的码不重复，撞上就重新生成；`POST /ledgers/join` 只在未过期的码中查找，加入成功即删除该行；过期的行在下次生成或校验时删除；不做定时清理，表里没有 `used_by` / `used_at`。
30. **分类表版本号：日期串，导入时硬校验**（2026-09-10 用户决定，README U-9、04 待决 D-8 前半）：`CATEGORY_VERSION` 形如 `2026-09-10`，改分类表时手工递增并重新生成 skill；skill 输出带同一版本号；上传时与应用当前版本不一致或缺失 → 400 `skill_outdated`，不允许带警告继续。
31. **批内重复行不合并**（2026-09-10 用户决定，README U-11 改）：完全相同的行全部保留并打 `needs_review` + `hint`，标记维持 `duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review` 四种，删除 `merged_duplicates`。
32. **交易日期是无时区的日历日期**（2026-09-10 用户确认 P-1 并提出）：`occurred_at` 用 Postgres `DATE`，不存时间、不带时区，用户换时区不会变。接口一律用 `YYYY-MM-DD` 字符串传输；前端把它当字符串显示和比较，**不得**用 `new Date("YYYY-MM-DD")` 再格式化（会按 UTC 零点换算导致差一天）；表单默认"今天"取浏览器本地日期而非 UTC 日期；导入文件的 `date` 同样是无时区字符串；汇率按该日历日期查。
33. **P-2 至 P-6 追认**（2026-09-10 用户确认）：不做"不计收支 / 不计预算"标记；注册开关默认开；宽屏 ≥1024px 侧栏、窄屏底部五 tab；退款候选默认最近 90 天；转账手续费另记一笔支出。
34. **两条单腿转账可以配对成一笔转账**（2026-09-10 用户决定，取代 P-7 的"标可能重复"）：导入 review 里对转账行自动找对方账户上 ±3 天、同币种同金额、方向相反、仍为单腿的转账，唯一候选默认勾选"关联为一笔转账"，多候选列出让用户选；提交时新行与已有行共用新的 `transfer_pair_id`，已有行的 `counterparty` 清空。对方已是两腿转账的一半时本行标 `duplicate`。交易详情页提供"关联为转账对腿"（选一条单腿转账配对）和"拆开"（两腿各自变回单腿）两个操作。两种关联（退款 `refund_of`、转账配对）在导入之后都可以在交易页修改或解除，review 里的自动建议只是预填（2026-09-10 用户确认）。标记名 `repayment` 改为 `transfer_candidate`，预填复用 `matched_transaction_id`。**各章已同步（2026-09-11）**：01 流程与状态图、03 导入行 PATCH 字段与 commit 逻辑、新增配对 / 拆开端点、04 review 表格与详情页、05 自动标记算法。
35. **邀请码输错限流改为端点级 1 QPS**（2026-09-10 用户决定，P-12 改）：删除"同一用户 15 分钟 5 次"，改为 `POST /ledgers/join` 全局 1 QPS（突发 3），429 + `Retry-After`，code 沿用 `invite_rate_limited`；6 位、10 分钟、一次性的规格不变。
36. **P-8 至 P-11 追认**（2026-09-10 用户确认）：外部转入默认建议记为收入；分类 code 用英文标识、中英显示名进常量；分类表经公开接口下发并永久缓存；加入账本为 owner 生成码、对方输入。
37. **P-13 至 P-18 追认**（2026-09-10 用户确认）：账本内账户完全共享；每人 10 本、每本 10 人；owner / member 两档、owner 退出前先转让、删账本级联；基准币种归账本；注册自动建"我的账本"；乐观锁 409、聚焦刷新、不做实时同步。
38. **P-19 至 P-23、P-25 追认**（2026-09-10 用户确认）：接口账本前缀与成员鉴权；账户类型含 cash、有交易只能归档、归档不可记账 / 导入；ILIKE 搜索与筛选参数、筛选放 URL；上传时手选目标账户；导入 ≤2 MB / ≤2000 行；三种自动标记的判定规则。
39. **P-27 至 P-32 追认**（2026-09-10 用户确认）：限流数值与错误体格式；VARCHAR + CHECK 与交易表约束；两腿转账只走转账接口；§11 接口目录（已含配对 / 拆开两个端点，不含任何 LLM 设置接口）；前端沿用技术栈；迁移策略。
40. **01 章待决 5 条**（2026-09-10 用户决定）：01-6 同一账本内账户允许同名（按 id 区分，只在界面提示）；01-7 记账人显示 `display_name`，没填时显示邮箱前缀，成员退出后照旧显示、不匿名化；01-8 用户没有任何账本时进"新建 / 加入"引导页；01-11 两腿转账编辑时两条腿的 `updated_at` 都比对；01-12 归档账户上的历史交易允许修改，只禁止新建。02-D-5 与 03-3 随之关闭。
41. **02 章待决 3 条**（2026-09-10 用户决定）：02-D-3 `import_rows` 的日期列与交易表一致叫 `occurred_at`，导入文件与接口字段仍叫 `date`；02-D-7 账本数 / 成员数上限只在应用层 `COUNT(*)` 校验，不加触发器；02-D-9 迁移遇到回填不出 `ledger_id` 的行和 `amount = 0` 的历史行，删除并打 warning 日志，不中止。
42. **不做向后兼容**（2026-09-10 用户决定，通用原则）：应用尚未上线，目标设计里不保留任何为兼容旧版本而存在的接口、字段、别名或过渡期。具体：`/auth/me` 不注册，`/me` 是唯一入口（03-1、04-D-2）；`PATCH /auth/me` 的 `default_source_id` 直接移除（03-2）；其余各章凡写了"保留别名一个版本"之类的过渡措施一律删掉。
43. **03 章待决 4 条**（2026-09-10 用户决定）：03-4 `created_by` / `updated_by` 只回用户 id，前端用成员列表映射；03-6 删除类端点统一 204，撤销导入例外（回撤销条数）；03-8 注册限流同 IP 每小时 5 次，实现为进程内令牌桶（与登录、加入账本共用同一组件，重启清零、单实例）；03-9 撤销导入的 `dry_run` 返回 `orphaned_refunds` 计数。
44. **03 章待决最后 5 条**（2026-09-10 用户决定）：03-10 分类当月支出可为负，照实返回；03-12 汇率回退窗口 `FX_MAX_BACKFILL_DAYS = 10`，超过用最新汇率；03-13 `occurred_at` 最晚今天 + 1 天；03-14 `limit` 上限交易列表 200、草稿行 500；03-15 uvicorn 加 `--proxy-headers`（infra 改动）。
45. **视觉方向定稿**（2026-09-10 用户在 Claude Design 里决定，04-D-13 关闭）：采用「04 柔和圆润」——Figtree + IBM Plex Mono、C2 密度（列表行高 56、圆角 sm 8 / md 14 / lg 18）、淡鼠尾草底、交易四色砖红 / 深青 / 橄榄金 / 板岩蓝、森林绿强调（深色下翻亮为 #6FB98A）。token 的唯一来源是 `docs/target-design/mockups/tokens.json`（从 Claude Design 导出的「Design Tokens v2 · 定稿」提取），16 张屏幕稿在同一目录。04 章 §6 的 A/B/C 三方向作废，改为引用该目录；实现前不再需要另出 mockup。
46. **04 章待决最后 5 条**（2026-09-11 用户决定）：04-D-1 路由用 Expo Router；04-D-5 加匿名可读的 `GET /config` 返回 `{registration_open}`，注册关闭时注册页直接显示提示；04-D-6 支出详情带 `refunds[]`（每笔退款的日期、金额、备注），退款详情把 `refund_of` 展开成原单摘要（日期、商户、金额、已退 / 可退）；04-D-7 交易列表加 `?import_batch_id=` 筛选；04-D-11 不做按成员筛选。至此 README §6 的全部待决项处理完毕。
47. **导入文件只做 CSV**（2026-09-11 用户决定，屏幕稿审阅 B4）：标准导入格式只有 CSV（固定 11 列表头 + `# version:` 首行），不再接受 JSON；粘贴入口粘的也是 CSV 文本。skill 输出 CSV。§5、§6、§11 已同步。
48. **账户类型四种**（2026-09-11 用户决定，屏幕稿审阅 B6）：`checking`（储蓄卡 / Checking）、`credit`（信用卡）、`cash`（现金）、`other`（其他）；不设 `savings`（新加坡没有这个区分，"储蓄"就是 checking）。迁移把现有 `savings` 改为 `checking`。
49. **金额区间筛选按基准币种比较**（2026-09-11 用户决定，屏幕稿审阅 B14）：`min_amount` / `max_amount` 与每笔交易按发生日汇率折算成基准币种后的绝对值比较；服务端先按其他条件过滤，再在结果上做折算与范围过滤（读取时计算，不落库）。列表行显示原币金额 + 折算金额；`currency` 筛选项保留，屏幕 02 的筛选栏补上币种。
50. **账户列表与净资产按屏幕稿**（2026-09-11 用户决定，屏幕稿审阅 A12）：见 §3 补充与 §7——按类型分组小计、资产 / 负债 / 净资产三个数、归档账户不计入并提示、`archived_at` 列、币种创建后不可改。
51. **交易操作记录**（2026-09-11 用户决定，屏幕稿审阅 B23）：新表 `transaction_events`（id、ledger_id、transaction_id、actor_id、at、event：created / updated / imported / paired / unpaired / refund_linked / refund_unlinked、changes JSON（字段 → {before, after}）、import_batch_id 可空、client 可空，来自请求头 `X-Client`）。所有改交易的路径都追加一条（普通 CRUD、转账接口、配对 / 拆开、导入提交、退款关联变化）；`GET /transactions/{tid}` 返回 `events[]`（按时间倒序）；交易删除时级联删除其事件；撤销导入删除交易同样级联。只追加不修改。
52. **屏幕稿审阅的其余裁定**（2026-09-11 用户决定，详见 `mockups/REVIEW-2026-09-11.md`）：
    - 采纳界面、改决策：B15 两腿转账在交易列表合并成一行显示（按 pair 合并，条数按合并后算，按账户筛选任一腿命中即显示整对；接口仍按行返回，合并由前端做）；B20 首页趋势只放支出；A23 个人设置加"外观"：跟随系统 / 浅色 / 深色，存本机不上服务器；A9 统计影响预演在前端用月度汇总本地加减（记一笔 / 退款 / 删除三处），改基准币种只显示"将重新折算 N 笔"不给数字；B24 撤销导入的 `dry_run` 返回两个数并分开措辞：`orphaned_refunds`（批外退款将失去原单）与 `refunds_in_batch`（批内退款删除后其原支出恢复可退额度）。
    - 采纳界面里的低成本细节：A2 邀请码可主动作废（`DELETE /ledgers/{id}/invites/{code}`）；A4 review 内筛选（全部 / 待归类 / 有标记）与批量设分类 / 批量跳过（新增 `PATCH /ledgers/{id}/imports/{bid}/rows` 批量端点，体为行 id 数组 + 同一份改动）；A8 交易详情的"复制一笔"（同商户同分类、日期改今天，预填表单）与"登记退款"（预填退款表单并关联）；A11 转账表单规则：子类型为还款时转入账户限定信用卡，单腿转账币种 = 账户币种，同币种两腿只填一个金额；A13 信用卡期初余额输入欠款、存为负数；A14 交易列表按日分组 + 每日小计 + 全筛选结果的支出 / 收入 / 净额汇总（净额不含转账；服务端在 `{items,total}` 外加 `summary`）；A15 筛空时对最多 2 个条件给出"去掉 X 会有 N 笔"；A17 批次列表显示净额、标记数、目标账户、上传人；A18 导入校验失败态可"复制错误清单"；A19 记一笔的录入辅助（快捷加数、计算器、最近商户建议、分类按判据搜索、保存并再记一笔、桌面快捷键）；A20 退款表单的全额退 / 部分退快捷、退回账户默认同原单、候选筛选"还有可退余额"；A22 删除账本需手打账本名并先显示交易 / 账户 / 批次计数（`GET /ledgers/{id}` 带 counts）；A24 交易详情显示所用汇率与汇率日期；A25 退款详情列出同原单的其它退款。
    - 不做：B17 邀请码预览；B21 通知；A1 导出 CSV（本版本不做）；A3 分类推荐（留空让用户自己定）；A6 交易编号；A7 每条腿的"余后"余额；A10 汇率不可手改（只读参考，另一腿金额可改）；A16 账本卡片不算净资产（只显示成员数与基准币种）；A21 不加"报表""成员"顶级页（首页趋势图右上的「月均 / 峰值」两个数保留，2026-09-11 用户确认）。
    - 维持决策、屏幕稿要改：B1、B2、B3、B5、B7（10 人）、B8、B9（撤销导入 member 可做，成员可管理账户）、B10、B11、B13（无"确认这行"）、B22（无头像）、A5（普通行不能改账户）、A18 前半（上传前不显示"你的 skill 版本"）；B12 补画退款原单 / 转账配对的确认交互；B16 转账行不设商户，列表标题显示"A → B"或"对方：X"；B18、B19 补登录 / 注册与"没有账本"引导页。
53. **章节同步时的取舍**（2026-09-11 Claude 在最终同步的审核中裁定，同日用户确认；决策看板 S14-53）。各章并行改写时出现了几处互相打架的写法，统一如下：
    - a. **配对不要求两腿 `transfer_subtype` 相同**（05 的理由成立：储蓄卡账单写 `plain`、信用卡账单写 `repayment` 的同一笔还款很常见，硬卡会让配对永远不触发）。配对（导入提交或 `POST .../{tid}/pair`）时把两腿统一成一个子类型：任一腿为 `repayment` 且**转入腿账户是 `credit`** → 整对 `repayment`；否则整对 `plain`；两腿在同一事务里改成同一值；值有变化的腿各写一条 `updated` 事件（`changes` 记 `transfer_subtype` 的 before / after），原值已等于统一值的腿不写。两腿 `occurred_at` 允许不同（配对出来的一对保留各自日期）；两腿转账对象的顶层 `occurred_at` / `transfer_subtype` / `note` 取转出腿。`PATCH .../transfer/{pair_id}` 改这三个字段时同写两腿。01 章此前写的「subtype 必须相同 → 400」作废。
    - b. **多候选转账不新增字段**：`matched_transaction_id` 是唯一载体（非空 = 已勾选"关联为一笔转账"；取消勾选 = `PATCH {"matched_transaction_id": null}`）。多候选时不预填、打 `needs_review`、`hint` 写「找到 N 条可以配对的转账，请选一条」；前端"选一条"复用交易列表接口筛选（`kind=transfer`、单腿、方向相反、其他账户、±3 天、同币种同金额），与 §14.11 退款候选同一做法。不做 `pair_confirmed` / `pair_candidates` 字段，候选列表不落库、不单独建接口。
    - c. **没找到对腿时不猜对手账户**：`counterpart_source_id` 留空，由用户在 review 里显式选账户（提交时按两腿建）或填 `counterparty` 文本 / 留空（按单腿建）。`counterpart_source_id` 必须是本账本的未归档账户，否则 404 `not_found`。
    - d. **错误 code 定名**（§14.4 的注册表 03 §4.2 为准）：`pair_invalid`（不用 `pair_target_invalid` / `already_paired`）、`import_format_invalid`（不用 `import_file_invalid` / `unsupported_file`）、`currency_locked`（不用 `currency_immutable`）、`rows_exceed_limit` 用 400。缺 `# version:` 行属**结构错误** → `import_format_invalid`（§5 的定义）；只有版本行存在但与当前版本不一致才是 `skill_outdated`（§14.30）。编码不可读的文件先于版本检查判定。
    - e. **导入批次列名以 02 §1.7 的 DDL 为准**（`filename` / `size_bytes` / `skill_version` / `row_count` / `committed_at` …），03 的响应字段与 05 的描述用同一套名字，不另起 `source_kind` / `original_filename` / `file_size` 之类。
    - f. **04 的类型定义以 03 的响应体为准**：上传失败体是 `errors: [{line, message}]`（`line` 为文件物理行号，1 起）+ `current_version` / `file_version` / `guide_url`；退款原单摘要含 `source_id`、分类与 `other_refunds[]`（A25）；前端文案表只收录注册表里的 code，`llm_*` 一并删除。
54. **注册表单只收邮箱、密码、默认币种**（2026-09-11 Claude 按 §2、§14.40 与 03 §5.1 定，**2026-09-15 用户确认**：「显示名可以注册之后再填」；决策看板 S14-54）：默认币种是下拉（默认 CNY），它同时是注册时自动建的「我的账本」的基准币种；显示名不在注册表单里，注册后在个人设置里填（§14.40）。屏幕 17 的注册页按此改稿，03 §5.1 与 04 §4.2 不变。登录失败只有「邮箱或密码错误」与同 IP 每分钟 10 次的限流提示，没有「连续错 N 次锁定账号」这类机制。
55. **批量改草稿行不接受三个逐行关联字段**（2026-09-15 Claude 在第六阶段收口时裁定；决策看板 S14-55）：`PATCH /ledgers/{id}/imports/{bid}/rows`（批量）的 `patch` 里**不收** `matched_transaction_id` / `counterpart_source_id` / `counterparty`，多带一个即 422；单行 `PATCH …/rows/{rid}` 不变，这三个字段照旧可改。03 §5.42 写「与 §5.41 的可改字段完全相同」，05 §4.1 写「不接受这三个，逐行的关联批量套用没有意义且危险」，两处冲突。按优先级 03 高于 05，但 03 那句是泛指字段集的交叉引用，05 §4.1 是点名这三个字段并给了理由的具体规则；把同一个 `matched_transaction_id` 批量套到多条转账行，第二行起必然在提交时 400 `pair_invalid`，用户还得回 review 一行行拆，对用户是纯粹的伤害。实现上批量单独定义 `ImportRowsBulkRowPatch`，`ImportRowPatch` 继承它再加回这三个字段（单行路径完全兼容）；前端 `src/api/types.ts` 同形收窄。03 §5.42 已同步（2026-09-16）；05 §4.1 本来就是这么写的。

56. **第七阶段逐屏对稿的布局裁定**（2026-09-15 Claude 在第七阶段（视觉对稿）启动时裁定，**2026-09-16 用户逐条追认 a–f**；决策看板 S14-56）：第五、六阶段的页面照 04 章文字写，而 04 章与 17 张屏幕稿不一致，结果每一屏的构图都不是稿上的构图；按 §14.45 以屏幕稿为唯一视觉真源，逐屏重做表现层（布局、分组、层级、字体、间距、颜色），功能、数据流、路由、hooks、API 层不动。屏幕稿之间或稿与 04 章打架的地方统一如下：
    - a. **宽屏侧栏**：顶部账本卡片（字母头像 + 账本名 + 「CNY · 我 + 老婆」，点开切换，右侧箭头进账本设置）→ 导航五项 首页 / 交易 / 账户 / 导入 / 我的（「我的」= 个人设置；「账本设置」不占导航位）→ 「＋ 记一笔」主按钮 → 底部当前用户行。
    - b. **宽屏没有通用顶栏**，页面标题由各页的页头承担（标题 + 内联统计 + 右侧主按钮）；窄屏保留顶栏。
    - c. **导入指南与上传合并**成屏幕稿 10 的「导入」一页（`/imports/new`：三步 + skill 文本 + 上传 / 粘贴）；`/imports/guide` 保留为「标准格式说明」次级页。
    - d. **首页按稿**：净资产大数 + 两张淡底月度卡，资产 / 负债两个数退为小字（不再三张卡）；12 个月趋势是柱状图而非折线；月份切换嵌在「N 月支出 · 按分类」卡标题里；新增「最近」五笔。
    - e. **账户列表改为单张表格** + 页脚合计 + 可折叠的已归档，不再按类型分三组（§14.50 的三个数与归档提示保留）。
    - f. **04 章各页的布局描述同步改成与稿一致**，行为描述不动。
57. **分类选择器不要搜索框**（2026-09-15 用户决定；决策看板 S14-57）：一级十六个、二级每组几个，一拉就全看完，不需要搜索。记一笔 / 编辑表单的分类下拉与 Sheet、导入 review 的单元格与批量分类 Sheet 一律没有搜索框，也没有按判据搜索的逻辑（`searchCategories` 删除，`CategoryPickerPanel` 无 `query`）；每个一级下的判据小字保留（§14.21）。这条取代 §14.52 A19 里「分类按判据搜索」那一项；屏幕稿 04 分类卡右上角的搜索框不再实现，04 章同步。
58. **第七阶段第三轮的三条裁定**（2026-09-16 Claude 在第三轮启动时裁定，**同日用户追认 a–c**；决策看板 S14-58）：
    - a. **卡片底色按屏幕稿源文件**：内容白卡（`Card` 全部变体、`ListCard`、表单卡、侧卡、Popover / Sheet 面板、对话框）用 `bg.raised`（浅 #FFFFFF / 深 #1E2620）；侧栏、底部 tab 这层 chrome 用 `bg.surface`（窄屏顶栏不铺面，直接坐在 `bg.canvas` 上，只有账本药丸是 raised）（浅 #FAFCFA / 深 #171D19）。撤销第二轮「全部卡片 `bg.surface`」的临时裁定——浅色下肉眼无差，深色下卡片必须比 chrome 亮一档。
    - b. **`/ledgers*` 宽屏也走应用壳**（补 §14.56 a）：侧栏顶部是「账本管理 · N 本」卡片，导航只画 首页 / 交易 / 导入 三项（指向最近打开的账本，没有就不画），没有「＋ 记一笔」按钮（屏幕稿 13）；`/settings` 保留账本卡片与五项导航 + 记一笔。
    - c. **导入 review 表格按稿产生的规格修订**（04 §4.11 同步）：「账户 · 对手」列在普通行显示本批次账户、已配对转账显示本行自己的账户（不再是「—」）；转账行的「商户」格宽窄两种布局都显示「A → B」/「对方：X」（稿赢，§14.45），§4.11.2 的「—」删掉。
59. **第七阶段第四轮（收尾）的裁定**（2026-09-16 Claude 裁定，**同日用户追认 a–f，只把 d 里「币种筛选仍单选」改成多选，见 §14.60**；决策看板 S14-59）：
    - a. **金额写法按稿**：账本基准币种的金额在列表行、表格、统计卡、分类行、影响卡、退款进度、汇总行里一律裸写（`1,234.56`，带正负号，不带 ¥）；只有首页净资产大数、详情页与记一笔的大数、以及「≈ ¥24,576.75」这类折算行保留符号。外币按符号表写（SGD `S$`、USD `$`、HKD `HK$`、EUR `€`、GBP `£`、JPY `JP¥`、AUD `A$`、TWD `NT$`、KRW `₩`、CNY `¥`），表里没有的写 `CODE 1,234.56`。
    - b. **屏幕 02 / 04 / 08 按稿补齐**：02 页头统计写「共 N 笔 · 支出 · 收入 · 退款 · 转账」，筛选中写「N 笔命中 · 共 M 笔」；有已选条件时筛选面板折叠成一条 chip 行；375 的汇总是列表末尾一张三格卡（支出 / 收入 / 净额）。04 / 05 的 375 把「账户」「日期」并成一张两行卡（「今天」是行内 chip）。08 详情的账户行用账户类型图标。11 页头补「已入账 N 笔」。操作记录的时间戳去年份（`09-08 07:12`）。
    - c. **不做、维持现状**：侧栏没有页面专属槽位（03 的「本次导入」、10 的「最近导入」放页面里）；账户列表行尾保留 `…` 行菜单；撤销按钮保留红描边（与删除一致）；首页保留刷新按钮；注册字段集由 API 契约决定；窄屏统一用壳的顶栏（§14.56）。
    - d. **邀请码失效态保留数字、六格转红**（稿赢；04 §4.3「抖动并清空」改掉）。币种筛选原裁定为单选——**用户 2026-09-16 改为多选**，前后端一起改（§14.60）。
    - e. **对比度门禁**：`verify-contrast.mjs` 按 WCAG 2.1 门禁正文 4.5 / 大字与徽章 3.0 共 98 对；`border.default` / `border.strong` 画在自带填充色的面上，属装饰性细线，不计入门禁（只打印 note）。**日期一律 ISO**（`2026-09-10` / 放不下年份的列 `09-10`），`formatDate` 不再随语言变。
    - f. **收尾时的补充**（2026-09-16）：详情页「金额」键值行与窄屏账户列表的分组小计按稿保留符号；导入 review / 历史里转账行的金额不带正负号；「已入账 N 笔」与 02 页头的「转账」段暂不显示——接口没有这两个数（`summary` 按 §14.52 A14 排除转账；已提交行数没有账本级合计），留到后端补字段，不在前端扫 200 批去凑；04 §8.3 第 12 条与 §6.4 的搜索框描述按 §14.57 删除（追认授权）；`formatLedgerAmount(amount, currency, baseCurrency, lang, {signDisplay})` 是金额写法的唯一入口。
60. **交易列表的币种筛选多选**（2026-09-16 用户决定，推翻 §14.59 d 的单选）：`GET /ledgers/{id}/transactions` 的 `currency` 改成可重复参数（`?currency=CNY&currency=SGD`，`.upper()` 后作 `IN` 匹配原币种，每个值仍须是三字母码，否则 422 `validation_error`）；前端筛选栏的币种 chip 与种类 chip 同一套多选（不选 = 全部），每个选中值一枚「已选条件」chip，URL 里重复键。03 §5.25、04 §4.5 已同步；§14.49 不变。
61. **「我的」页去掉副标题，保存按钮跟着显示名走**（2026-09-16 用户决定，屏幕稿 14 的两处不照做）：页头不再有「只影响你自己，不影响账本里的其他人」；「保存」从页头右上移到显示名字段正下方，只在显示名改动时可用——因为默认币种 / 语言 / 外观都是即时生效，页头的保存让人以为整页都要保存。04 §4.13 已同步。
62. **账户归人，按账本共享**（2026-09-16 用户决定；推翻 §2 归属段里「`finance_sources` 属于账本」与 §14.37 P-13「账本内账户完全共享」；决策看板 S14-62）。起因：同一张银行卡在主账本和旅行账本里记账应当是同一个账户，余额是这张卡在所有账本里的合计；现在每本账各有一套账户，同一张卡是两条互不相通的记录。新模型：
    - a. **归属**：`finance_sources` 属于用户（`owner_id` → `users`），删除 `ledger_id`；`created_by` / `updated_by` / `updated_at` 与四种类型、`opening_balance`、`archived` / `archived_at`、币种创建后不可改（§14.50）都不变；同一人下允许同名（§14.40 01-6 的规则照旧，界面提示）。每人账户数上限 50。
    - b. **共享到账本**（用户选的 C 方案）：新表 `ledger_sources(ledger_id, source_id, shared_by, shared_at)`，主键 `(ledger_id, source_id)`。账户主人可以把自己的账户共享到自己是成员的任一账本，也可以随时取消共享（unlink）；只有主人能操作。取消共享后，该账本的其他成员不能再用这张卡在这本账里记新账，**已经记下的交易原样保留**，账户名照旧可见。**主人在自己所在的任何账本里都能用自己的账户，不需要共享**；共享的意义是让该账本的**其他成员**也能用这张卡记账、在账本的账户视图里看到它。一本账里「可用的账户」= 调用者自己的全部未归档账户 + 别人共享到本账本的未归档账户。
    - c. **可见性**（用户确认）：余额、折算余额、汇率日期只对账户主人返回；别人共享进来的账户在任何接口里只有 id / 名字 / 类型 / 币种 / 归档状态 / 主人，余额字段为 `null`。交易里引用到的账户名对能看到该交易的人可见（哪怕这张卡没有共享到该账本——主人自己用未共享的卡记的账，别人看得到交易与账户名，但选不到这张卡）。
    - d. **净资产与三个数**（改 §14.50 的口径）：资产 / 负债 / 净资产是**个人**的，按本人全部未归档账户算，不分账本，在首页和账户页显示；账本本身不再有净资产。首页的「账户」卡列本人账户；本月支出 / 收入 / 分类 / 12 个月趋势仍按账本算。
    - e. **记账 / 转账 / 导入**：交易的 `source_id` 必须是当前账本里对调用者「可用」的账户（b 的定义），两腿转账的两个账户各自满足，导入批次的目标账户同规则；不满足回 404 `not_found`（与「不在本账本」同一语义）。退款关联、转账配对仍限同一账本内。归档账户不可记账 / 导入（不变）。
    - f. **余额**：期初 + 这张卡在**所有**账本里的交易（`balance` 与 `balance_base` 的计算跨账本，基准币种按**主人**的默认币种折算——§14.6 的 `users.base_currency`，不再按账本基准币种）。账户有任何账本的交易就只能归档不能删；删除账本只删它的交易 / 批次 / 共享关系，**不删账户**（用户确认）；成员被移出或退出账本时，他共享进来的账户自动取消共享，他记的交易留在账本里（账户名照旧可见）。
    - g. **接口**：账户 CRUD 从 `/ledgers/{id}/sources*` 改为个人的 `/sources*`（列表带余额与「共享到了哪些账本」；`?include_archived=1` 照旧）；新增 `PUT /sources/{sid}/ledgers/{lid}`、`DELETE /sources/{sid}/ledgers/{lid}`（共享 / 取消共享，仅主人且是该账本成员，否则 404）；`GET /ledgers/{id}/sources` 保留但语义改为「本账本里对我可用的账户」（我的带余额，别人的不带）；`GET /ledgers/{id}/stats/balances` 废除，个人的资产 / 负债 / 净资产改为 `GET /me/balances`（或并入 `GET /sources` 的 summary，03 章定）。错误 code 注册表（03 §4.2）新增 `source_limit_reached`（50 个上限）。
    - h. **前端**：侧栏「账户」指向全局 `/accounts`（账户列表与表单不再在 `/l/:id/` 下），列表里每个账户显示「共享到：家庭账本 ✓ 旅行账本 ✗」并可直接切换；从某本账的上下文进入「新建账户」时默认勾选共享到当前账本。记一笔 / 转账 / 导入的账户选择器用 `GET /ledgers/{id}/sources`，分「我的」与「成员共享的」两组；交易列表按账户筛选同一来源；首页净资产与账户卡按 d。
    - i. **迁移**：现有每本账的账户按 `created_by` 归到人名下（一比一，不做合并工具——用户 2026-09-16 定：现在是纯测试阶段，改设计即可），并为每条写一行 `ledger_sources(原 ledger_id, source_id)`，这样迁移前后「账本里人人可用」的行为不变；`balance_base` 改按主人默认币种折算。本机演示数据重灌。
    - j. **章节同步**：01 §1 实体关系与 §3 流程、02 §1.5 与迁移链、03 §5.20–§5.24 与 §5.36 及 §4.2 注册表、04 §1.2 路由表 / §4.4 / §4.6 / §4.8 / §4.9 / §4.10、05 目标账户一节；README §2 总览。
    - k. **新建账本不再要求先建账户；空账本引导按「有没有交易」判断**（2026-09-27 用户补充：账户和账本解耦后，除非我的账号里一个账户都没有，否则新建账本时不需要再建账户；现状是每本账都要重新建）：主人的账户在他所在的任何账本里直接可用（b 已定），所以新账本一开就能记。首页「这本账还是空的」引导改为**本账本交易数为 0** 时显示；其中「建一个账户」这一步与页头「建第一个账户」按钮只在**对我在本账本内可用的账户为 0**（自己没有未归档账户，也没有成员共享进来的）时出现，否则引导只剩「记一笔或导入账单 → 邀请成员」两步，页头主按钮改为「记一笔」；「去建」进 `/accounts/new?ledger=<本账本>`（默认勾选共享到本账本）。净资产与账户卡按 d 显示个人的数，新账本里不再是 0。04 §4.4 同步。
63. **账本列表页要有入口**（2026-09-26 用户手测 ledger-01 时发现：进了账本以后没有任何显眼的地方能到 `/ledgers`，只有「我的」里一行叫「切换账本」的条目；用户同意下面的改法；决策看板 S14-63）：账本切换器（宽屏侧栏账本卡片的弹层、窄屏顶栏账本药丸的 Sheet，同一个组件）在「新建账本 / 加入账本」下面再加一行「账本管理」，点了进 `/ledgers`；「我的」页那一行从「切换账本」改名为「账本管理」，目的地不变。04 §1.4、§4.13、§6 `Sidebar` 行已同步。
64. **导航框架统一：底栏全局，子页一律有返回键**（2026-09-26 用户手测时提出：账本管理页窄屏没有顶栏和底栏，宽窄屏都没有返回键，进去就回不来；用户要「返回键做成全局的」「底下这个条做成全局的」「统一成账本设置的样子」。Claude 按下面的规则落实，取代 §14.56 里 `/ledgers*` 专用侧栏与窄屏不带框架的两条，以及 §14.59 里 `/ledgers/new`、`/ledgers/join` 自画页头的那条——后者只对还有账本的用户失效；决策看板 S14-64）：
    - a. **一套框架**：登录后，除了「一本账都没有」时的引导页（屏幕稿 15）和此时的新建 / 加入账本页、登录注册页，所有页面——账本里的各页、`/ledgers`、`/ledgers/new`、`/ledgers/join`、`/settings`（以及第八阶段的 `/accounts*`）——都套同一个壳：宽屏侧栏，窄屏顶栏 + 底栏。不在账本路由上时，壳指向「最近打开的那本账」（和 `/` 落地的是同一本）。
    - b. **窄屏底栏全局**：五格「首页 / 交易 / ＋记一笔 / 导入 / 我的」出现在 a 里的所有页面，目标都是当前账本（账本外 = 最近那本）。「我的」在 `/settings` 上高亮；在 `/ledgers*` 上五格都不高亮。「我的」Sheet 与账本切换 Sheet 在账本外也能用（切换 = 打开那本账的首页）。一本账都没有时不画底栏。
    - c. **宽屏侧栏全局一样**：`/ledgers*` 不再换成「账本管理 · N 本」卡与三项导航，和 `/settings` 一样显示最近那本账的账本卡片、五项导航、「＋ 记一笔」；到账本管理的路是账本卡片切换器的末行（§14.63）。
    - d. **一级页与子页**：一级页 = 导航能直达的页。宽屏是侧栏五项（首页 / 交易 / 账户 / 导入 / 我的），窄屏是底栏四格（首页 / 交易 / 导入 / 我的）。其余都是子页：窄屏的账户列表（屏幕稿 09 窄屏就是「‹ 账户」）、账本设置、账本管理、新建 / 加入账本、交易与转账的详情 / 编辑 / 记一笔、账户新建 / 编辑、导入上传 / 格式说明 / 批次。
    - e. **返回键的样子**：窄屏子页的顶栏是「圆形 ‹ 返回 + 居中标题」（屏幕稿 07 / 08 / 09 / 12 / 13 窄屏顶栏的构图），取代账本药丸和头像；一级页顶栏照旧（账本药丸 + 头像 + 标题）。宽屏子页在页头上方有圆形返回 + 灰色面包屑（屏幕稿 08 的样子，即 `PageHeader` 的 `back`）；面包屑写「上级页名 · 本页名」。宽屏账户表单是压在列表上的模态，「取消」就是返回，不另加。页面自己画的返回（新建 / 加入账本的页头）在壳已经画了返回的地方不再重复。
    - f. **返回去哪**：有应用内的上一页就退一步；没有（新标签页打开深链、刷新之后）就去这一页的上级：交易 / 转账详情 → 交易列表；交易 / 转账编辑 → 它的详情；记一笔 → 交易列表；账户新建 / 编辑 → 账户列表；账户列表（窄）→ 首页；导入上传 → 导入历史；格式说明 → 导入上传；导入批次 → 导入历史；账本设置 → 首页；账本管理 → 最近那本账的首页；新建 / 加入账本 → 账本管理。一本账都没有时 `/settings` 的返回去账本引导页。表单的离开守卫对返回键同样生效。
    - g. **账本管理页的标题**改成「账本管理」：原来的「我的账本」和新用户的默认账本名撞了，也和入口的名字对不上。
65. **不要账本管理页；切换器末行改「账本设置」；「我的」Sheet 不再有「切换账本」**（2026-09-26 用户手测 §14.64 后决定：切换器已经列出全部账本和新建 / 加入，账本管理页是多余的；「我的」Sheet 里的「切换账本」和左上角账本药丸重复。取代 §14.63 全条、§14.64 里把 `/ledgers` 当子页的部分与 g；决策看板 S14-65。b–h 的细则由 Claude 定）：
    - a. **切换器末行**：账本切换器（宽屏侧栏账本卡片的弹层、窄屏账本药丸的 Sheet，同一个组件）在「新建账本 / 用邀请码加入」下面那一行从「账本管理」改成「账本设置」，进当前账本（账本外 = 最近那本）的 `/l/:id/settings`。
    - b. **「我的」Sheet**：只剩「个人设置 / 账本设置 / 登出」，去掉「切换账本」。「我的」页（个人设置）去掉「账本管理」那一行，「账本设置」一行保留。
    - c. **`/ledgers` 不再是页面**：地址保留，因为零账本引导、删除 / 退出账本之后的落脚点、若干兜底跳转都用它。有账本的用户打开它，直接跳到最近那本账的首页（与 `/` 同一套落地逻辑）；零账本用户照旧看到屏幕稿 15 的全屏引导；读账本列表失败时显示错误 + 重试。屏幕稿 13 的卡片列表（宽屏三列 grid + 虚线新建卡、窄屏卡片列表）删除。
    - d. **新建 / 加入账本**：有账本时是子页，上级 = 最近那本账的首页，宽屏面包屑「首页 · 新建账本」「首页 · 加入账本」（`PageHeader` 的 `back`，和别的子页一样），窄屏由壳顶栏画 ‹。加入账本在宽屏不再是压在账本列表上的对话框，而是普通子页，中间放同一张加入卡片。零账本时两页保持现状（无壳，自带返回 → 引导页）。
    - e. **404 页与「账本不可用」页**：指向账本列表的按钮改成「回到首页」，去 `/`（落到最近那本账；零账本落到引导页）。
    - f. **表单页窄屏不画底栏**：记一笔 / 交易编辑 / 转账编辑 / 账户新建 / 账户编辑在窄屏只有顶栏与底部保存条，不画底栏（屏幕稿 04 / 05 / 06 / 09 表单的窄屏画框都没有底栏）。这是 §14.64 b「底栏全局」的唯一例外。
    - g. **离开守卫覆盖所有出口**：表单有未保存改动时，点侧栏任一项、底栏任一格、账本切换器里的账本、顶栏 ‹、宽屏面包屑、浏览器后退，都先弹确认；取消后留在表单，内容还在。起因：§14.64 验收发现窄屏点底栏别的格会直接离开，不弹确认，内容丢失。
    - h. **表单自己的去向优先**：带 `?next=` 打开的表单，窄屏壳顶栏 ‹ 与宽屏面包屑走同一个出口（先 `next`，再历史，再上级），不再宽窄两样。
66. **地址只写页面，当前账本与浏览状态记在本地**（2026-09-27 用户决定：`/l/<uuid>?month=…` 太老派，URL 要干净，当前账本靠本地记忆；取代 04 §1.2 的 `/l/:ledgerId/*` 路由族、§2.2「账本 id 来自路由参数」、§4.4「月份写进 `?month=`」、§4.5「筛选写进 URL」，以及 §14.64 f 里跨出账本再退回来的恢复逻辑；决策看板 S14-66。b–i 的细则由 Claude 定）：
    - a. **路径表**：`/home`、`/transactions`、`/transactions/new`、`/transactions/:txId`、`/transactions/:txId/edit`、`/transfers/:pairId`、`/transfers/:pairId/edit`、`/imports`、`/imports/new`、`/imports/guide`、`/imports/:batchId`、`/ledger`（账本设置，原 `/l/:id/settings`）、`/settings`（个人设置，不变）、`/accounts`、`/accounts/new`、`/accounts/:sourceId/edit`（不变）、`/ledgers`（零账本引导；有账本时跳 `/home`）、`/ledgers/new`、`/ledgers/join`、`/login`、`/register`。交易 / 转账 / 批次 / 账户的 id 仍在路径里——它们是页面本身，不是浏览状态。
    - b. **当前账本**：每个标签页自己记一份（Web `sessionStorage` `wallet:current_ledger_id`），没有时取 `last_ledger_id`（`localStorage`，现有）；切换账本两处都写。这样刷新回到本标签页的账本，两个标签页可以各开一本账互不干扰。原生端只有 `AsyncStorage` 的 `last_ledger_id`。
    - c. **守卫**：账本页（a 里 `/home` 到 `/ledger`）在登录后的顶层布局里统一过 `RequireLedger`：取当前账本 id，在账本列表里找得到就进；找不到或没有就取列表第一本（并写回本地）；一本都没有 → `/ledgers` 引导；列表读失败 → 错误 + 重试。被移出 / 删除的账本（`GET /ledgers/{id}` 404）→ 换到另一本 + toast「账本不可用，已切到 X」，没有别的账本 → `/ledgers`。
    - d. **切换账本**：留在当前页面（路径不变），换的是上下文；页面里按账本缓存的浏览状态自然切到那本账自己的（见 e）。带资源 id 的页面（详情、编辑、批次）切换后资源不属于新账本，退到它的列表页（`/transactions` 或 `/imports`）。
    - e. **浏览状态出 URL**：首页月份、交易列表的筛选与翻页、导入批次的切片 / 定位行，都不再写进查询串，改为内存里按账本保存的「浏览状态」（`src/store/ViewState`：`useLedgerViewState(key, default)`，以当前账本 id 分桶），应用打开期间在页面间来回不丢，刷新后回到默认（本月、无筛选、第一页）。浏览器后退不再撤销筛选或月份。
    - f. **保留的查询参数**（只在进入页面那一刻有意义，不是状态）：`/transactions/new?kind=&source_id=&refund_of=&copy_of=&next=`、`/accounts/new?ledger=`、`/login?next=`、`/register?next=`。「关联原单」「复制一笔」「登记退款」等入口照旧带参进表单。
    - g. **返回规则**（§14.64 f 的上级表按新路径改）：详情 / 记一笔 → `/transactions`；编辑 → 详情；账户新建 / 编辑 → `/accounts`；账户列表（窄）→ `/home`；导入上传 / 批次 → `/imports`；格式说明 → `/imports/new`；账本设置 → `/home`；新建 / 加入账本 → `/home`（零账本 → `/ledgers`）；`/settings` 零账本 → `/ledgers`。登录后所有页面都是同一个 `Slot` 的直接子路由（`accounts/_layout.tsx` 也删），不再有嵌套导航器，所以 §14.64 的 `ledgerHistory.ts` 与 2026-09-27 的 `nestedEntry.ts` 一并删除。
    - h. **分享 / 深链**：地址不带账本，打开别人发来的 `/transactions/<id>` 时用本地记住的账本去取，不属于它就是 404「不存在或无权限」页（现有），这是用户接受的代价。`/` 落地：有账本 → `/home`，零账本 → `/ledgers`。
    - i. **不变的**：后端接口路径照旧带账本 id；query key `['l', ledgerId, …]` 照旧按上下文里的账本分桶；PWA 的 SPA 回退对新路径同样生效。
    - j. **补充三处**（2026-09-27 04 同步时发现 e / f 没覆盖，Claude 定）：导入历史的「全部 / 待提交 / 已提交」切片并进浏览状态（键 `imports.status`，按账本分桶）；账户列表的 `?include_archived=1` 只作进入参数（首页「不含 N 个已归档账户」带它进来，页面读一次；页内展开 / 折叠已归档是组件状态，不写 URL）；记一笔的种类分段只在进入时读 `?kind=`，切换分段不再写 URL（`copy_of` 进来时种类由表单内部设置）。
