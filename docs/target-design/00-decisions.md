# 目标设计：决策记录（v3.0）

本文件是 `docs/target-design/` 其余各章的**唯一事实来源**。它记录了 2026-09 设计评审中逐条确认的改动决定。各章只能展开、细化这里的决定，不得与之矛盾；发现矛盾以本文件为准并修改各章。现状（as-is）见 [`../current-design/`](../current-design/README.md)，本文件里"现状"二字均指那套文档描述的状态。

## 0. 范围与优先级

1. 顺序：**先把网页端全功能做好（含账单导入、UI 重设计）→ 部署上线 → Android/iOS**。账单的读取交给用户自己的 ChatGPT / Claude（§5、§6），应用不接入 LLM。本目标设计只覆盖第一步，部署沿用 `docs/current-design/05-infra-and-ops.md` 的方案，App 不在本设计范围。
2. 不再使用 GSD 规划工具；`.planning/` 里的 GSD 提示词后续清理，本设计不引用它。
3. UI 做全新视觉重设计；实现前先出 mockup 给用户看，现有 `.planning/research/ui-redesign-v2/spec.md` 只作参考。
4. 界面语言中英双语（i18n，默认跟随系统），分类名、错误信息也双语。
5. 用户范围：开放给亲友注册。需要注册开关（环境变量 `REGISTRATION_OPEN`，默认 `true`）、限流、上传大小限制。
6. 网页布局响应式：窄屏底部 tab + 中央"记一笔"按钮；宽屏（≥1024px）左侧导航栏 + 宽内容区。账单导入的 review 表格必须在桌面上好用。
7. 明确**不做**（本版本）：预算、找回密码/邮箱验证、分类管理、标签、实时协同、移动 App、钱迹的"不计收支"标记、交易时间（`occurred_at` 仍为日期）、应用内调用 LLM（API key、模型设置、服务端解析，2026-09-10 决定）。

## 1. 交易种类（kind）

现状：没有种类列，金额正负决定方向。目标：

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

现状：一切挂在 `users.id` 下，没有账本概念。目标：

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

- 挂账本；字段：id、ledger_id、name、type（`checking` / `savings` / `credit` / `cash` / `other`）、default_currency、opening_balance（`NUMERIC(18,4)`，默认 0）、archived、created_by、updated_by、created_at、updated_at。
- 余额 = opening_balance + 该账户所有交易 `amount` 之和（含单腿转账）。
- 归档规则维持：归档后不能再记账、不能作为导入目标，历史保留；有交易的账户不能删除，只能归档。

## 4. 搜索与筛选

`GET /api/v1/ledgers/{id}/transactions` 参数：`q`（ILIKE 匹配 merchant / note）、`kind`（可多个）、`category_l1`、`category_l2`、`source_id`（可多个）、`from` / `to`（日期）、`currency`、`min_amount` / `max_amount`（绝对值）、`limit` / `offset`；返回 `{items, total}`。ILIKE 足够，不做全文索引。筛选状态放在前端 URL 里。

## 5. 账单导入（2026-09-10 改版：应用不接入 LLM）

- **原则**：应用本身不调用任何大模型。用户在自己的 ChatGPT / Claude（网页或 App，用自己的订阅）里安装我们提供的 skill，把任意账单（PDF、图片、Excel、CSV……交给聊天工具去读）整理成**标准导入文件**，再上传到应用。应用只负责校验、review、入账。
- **标准导入格式**（唯一契约，"只要结构符合都可以"）：
  - JSON（首选）：`{"version": "2026-09-10", "rows": [{"date": "2026-08-03", "amount": -45.00, "currency": "CNY", "kind": "expense", "transfer_role": null, "transfer_subtype": null, "merchant": "瑞幸咖啡", "note": "美团外卖-订单尾号8821", "category_l1": "food", "category_l2": "snacks_drinks", "source_ref": "L17"}]}`。字段语义与 §1 完全一致：支出为负、收入与退款为正、转账按 `transfer_role` 定号；`transfer_role` / `transfer_subtype` 只在 `kind='transfer'` 时有值；分类 code 取 §1.3 的表，拿不准留 `null`；`source_ref` 可选，指回账单原文位置。
  - CSV：固定表头 `date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref`，UTF-8（可带 BOM），首行可以是 `# version: 2026-09-10`。
  - 粘贴：应用内也提供一个文本框，直接粘贴 JSON 或 CSV 文本。
- **校验**（服务端同步完成，秒级）：结构错误（JSON 不可解析、CSV 表头不符、`rows` 不是数组）→ 400，按行号返回错误，不建批次。行级问题不丢行、只打标记：`date` 必须是 `YYYY-MM-DD`，否则 `needs_review`；`amount` 非数字或为 0 → `needs_review`；`currency` 不是三位字母 → 用目标账户币种并 `needs_review`；`kind` 不在四种之内 → 按金额符号推断并 `needs_review`；分类 code 不在表内、二级不属于一级、收支方向与 kind 不符 → 对应字段置空（待归类）；每一处校验改动都写进该行的 `hint`（如"币种 XX 无效，已改为账户币种"），不另存原始值；`version` 缺失或与应用当前分类表版本不一致 → 整批 400 `skill_outdated`，错误里带应用当前版本与"导入指南"链接，用户更新 skill 后重传（2026-09-10 用户决定，不再是警告）。上限：文件 ≤2 MB、单批 ≤2000 行。
- **一份文件对应一个目标账户**，上传时由用户选；文件里不含账户信息。
- **状态机**：`ready → committed`。校验通过即 `ready`（同步返回批次和全部草稿行，没有 parsing / 进度 / 轮询）；`ready` 下可编辑草稿和提交；`committed` 后可整批撤销 = 整批删除（§14.22）。校验不通过不产生批次。
- **两张表**：`import_batches`（账本、目标账户、上传人、来源 `json` / `csv` / `paste`、原文件名与大小（只记名字，**不保存文件**，2026-09-10 用户决定）、`skill_version`、状态、行数、警告、时间戳）与 `import_rows`（批次、`row_no`、状态 `pending` / `edited` / `skipped`、date、amount、currency、kind、transfer_role、transfer_subtype、merchant、note、category_l1、category_l2、source_ref、`hint`、flags、matched_transaction_id、counterpart_source_id、counterparty、提交后的 transaction_id）。不再有 confidence、page_no、chunk_*、raw_response、error_* 列。
- **自动标记**不变：`ready` 时打 `duplicate`（同账户同日同金额已存在）、`refund_candidate`（按 §1.1 规则找到唯一候选原单则预填 `matched_transaction_id`）、`transfer_candidate`（按 §1.2 / §14.34 规则找到可配对的单腿转账则预填 `matched_transaction_id`）；外加上面的 `needs_review`。 同一批内完全相同的行**不合并**：都保留、都打 `needs_review`，`hint` 写"本批内有相同的行（第 N 行）"，由用户在 review 里取舍；标记只有这四种，没有 `merged_duplicates`（2026-09-10 用户决定）。退款候选以金额 + 时间窗 + 同账户为主，商户只作加分，仅在候选唯一时预填。
- **review 表格**不变：每行所有字段可改、可标跳过、可改 kind、可选分类、可关联退款原单、可选对手账户；没一级分类的行显示"待归类"，提交前必须补齐；不再有页面缩略图（应用拿不到原始账单）。
- **提交**：`POST .../imports/{batch_id}/commit`，一个数据库事务内建所有交易（两腿还款一起建），每条交易记 `import_batch_id`；成功后批次 `committed`。
- **限制与限流**：导入每用户每小时 10 批；上传 ≤2 MB。

## 6. 导入 skill（取代原"LLM 设置与接口"）

- 应用**不存任何模型设置**：没有 `user_llm_settings` 表，没有 `/me/llm-settings` 接口，没有 API key，没有"测试连接"。
- **skill 是仓库里的交付物** `skills/wallet-import/`：一份主文本（角色、输入任意账单、输出上面的标准 JSON 文件并提供下载、也可直接输出代码块），两种包装——Claude 的 `SKILL.md`（Claude.ai 项目 / Claude Code 皆可安装）和 ChatGPT 的 Custom GPT / Project 指令文本。规则沿用原提示词：支出为负、收入为正、退款标 `refund` 并尽量注明来源、信用卡还款标 `transfer` + `repayment`、本人账户间划转标 `transfer` + `plain`、外币原值写进 `note`、清理商户名噪音、日期一律 `YYYY-MM-DD`、分不清的分类**留空不猜**、不得自创 code、不输出卡号全号。
- **分类表与版本同源**：skill 文本里的分类清单（code + 中文名 + 一级判据 §1.3）由脚本从 `backend/app/core/categories.py` 生成，`version` 就是 `CATEGORY_VERSION`；改分类表必须重新生成并发布 skill。应用校验 `version` 不一致时拒绝导入并提示用户更新 skill（§5）。
- **应用内"导入指南"页**：三步说明（安装 skill → 在你的 ChatGPT / Claude 里上传账单让它整理 → 把生成的文件上传到这里），附 skill 文本的复制 / 下载按钮，以及标准格式的示例文件。
- 将来若要做"应用内一键导入"，标准格式已是契约，只需加一条可选的服务端调用路径，不改现有设计。

## 7. 统计与首页

- 账户余额（§3），按账本基准币种折算后给合计。
- 按月（可切换月份）支出/收入按一级分类汇总，可下钻二级；退款按退款日期冲减对应分类；转账不计入。
- 最近 12 个月支出/收入趋势。
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
| 账本 | `GET /ledgers`、`POST /ledgers`、`GET/PATCH/DELETE /ledgers/{id}`、`GET /ledgers/{id}/members`、`DELETE /ledgers/{id}/members/{user_id}`、`POST /ledgers/{id}/leave`、`POST /ledgers/{id}/transfer-ownership`、`POST /ledgers/{id}/invites`、`POST /ledgers/join` |
| 账户 | `GET/POST /ledgers/{id}/sources`（GET 含余额）、`GET/PATCH/DELETE /ledgers/{id}/sources/{sid}` |
| 交易 | `GET/POST /ledgers/{id}/transactions`、`GET/PATCH/DELETE /ledgers/{id}/transactions/{tid}`、`POST /ledgers/{id}/transactions/transfer`、`PATCH/DELETE /ledgers/{id}/transactions/transfer/{pair_id}` |
| 统计 | `GET /ledgers/{id}/stats/summary?month=YYYY-MM`、`GET /ledgers/{id}/stats/trend?months=12` |
| 导入 | `POST /ledgers/{id}/imports`（multipart 文件，或 JSON 体 `{source_id, text}` 粘贴；同步校验，直接返回批次与草稿行）、`GET /ledgers/{id}/imports`、`GET /ledgers/{id}/imports/{bid}`、`GET .../rows`、`PATCH .../rows/{rid}`、`POST .../commit`、`DELETE /ledgers/{id}/imports/{bid}`（ready = 丢弃；committed = 撤销）；`GET /import-format`（公开：标准格式说明、示例文件、skill 文本，带 version） |
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
3. `finance_sources`、`transactions` 加 `ledger_id`（回填为该用户默认账本）、`created_by`、`updated_by`、`updated_at`；账户加 `opening_balance`、`type` 增加 `cash`。
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
6. **users 表两处**：删除现状的 `users.default_source_id`（多账本下语义失效，改为前端本地记住上次使用的账户）；新增 `users.language VARCHAR(8) NULL`（`PATCH /me` 可改，NULL 表示跟随系统）。`user_llm_settings`、`ledger_invites` 各加 `created_at`。（2026-09-10 用户追认；`user_llm_settings` 已随 §14.25 取消，`ledger_invites` 的 `created_at` 仍加。）
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
23. **解析进度用小数**（2026-09-09 用户决定，README U-2，推翻校对时的整数对）：`GET /ledgers/{id}/imports/{bid}` 返回 `progress: number | null`，取值 0–1、保留两位（`chunk_done / chunk_total`），切块完成前（总数未知）为 `null`；数据库仍存 `chunk_done` / `chunk_total` 两列，接口不暴露。前端显示百分比，`null` 时显示"正在读取账单…"。**各章待同步**：03 §5.40 响应、04 `ImportBatch` 类型与进度页、05 §10.3 进度计算。
24. **导入只有一条视觉流水线**（2026-09-09 用户决定，取代 U-3 与 §5 原"文字优先、视觉兜底"）：用户必须配置支持图片输入的模型（`vision_model` 字段删除，测试连接验证图片能力）；PDF 每页渲染成图片、图片原样、CSV / XLSX 读成纯文本，都送同一个模型、同一份提示词、同一个 schema；不做本地 PDF 文字抽取。批次表删除 `used_vision`，PDF / 图片批次一律有 `pages` 缩略图；`needs_review` 只按置信度与解析异常打标。**各章待同步**：01 实体字段、02 `import_batches` / `user_llm_settings` 列、03 §5.9–5.10 与 §5.40/§5.46、04 设置页与 `ImportBatch` 类型、05 §2–§3 抽取与分块整章、README。
25. **应用不接入 LLM，导入改为"用户自己的 ChatGPT / Claude + 标准格式文件"**（2026-09-10 用户决定，§5、§6 已整体改写）。由此**作废**的条目：§14.9（图片切分）、§14.12（页面缩略图与 pages 接口）、§14.14（`import_interrupted`，不再有后台解析）、§14.15（批次错误三列，校验错误同步返回）、§14.17（`image_url`）、§14.23（进度小数，校验同步无进度）、§14.24（视觉流水线）；README 的 U-2、U-3 随之作废。§14.10（`counterparty`）、§14.11（退款候选复用列表）、§14.19（`hint`）继续有效。**各章待同步**：01 §1 实体与 §3 导入流程、02 删 `user_llm_settings` 并精简 `import_batches` / `import_rows`、03 删 LLM 设置与 pages / retry 端点、导入端点改同步、04 删 LLM 设置页并加导入指南页、05 章重写为"标准导入格式 + skill 规范 + 校验规则 + 自动标记"、README。新增交付物：`skills/wallet-import/` 与生成脚本。
26. **时间戳存不带时区的 UTC**（2026-09-10 用户确认，README U-4）：`created_at` / `updated_at` / `expires_at` 等沿用现状的 naive UTC 列，接口输出一律带 `Z`，前端按浏览器时区显示；不用 `timestamptz`。
27. **导入代码放在 `backend/app/services/importing/` 包**（2026-09-10 用户确认，README U-6）：按读文件 / 校验 / 标记 / 提交撤销分文件；没有抽取器目录。
28. **不保存上传的导入文件，也不存原始行值**（2026-09-10 用户决定，README U-7 作废）：批次只记文件名与大小；校验改动写进行的 `hint`；后端没有文件系统状态，`UPLOAD_DIR`、上传卷、目录清理全部取消（05 待决 8 随之作废）。
29. **邀请码不要求全表唯一，用掉即删、过期即删**（2026-09-10 用户决定，README U-8 改、02 待决 D-6 一并定）：`ledger_invites.code` 不建唯一索引；生成时只保证与当前有效的码不重复，撞上就重新生成；`POST /ledgers/join` 只在未过期的码中查找，加入成功即删除该行；过期的行在下次生成或校验时删除；不做定时清理，表里没有 `used_by` / `used_at`。
30. **分类表版本号：日期串，导入时硬校验**（2026-09-10 用户决定，README U-9、04 待决 D-8 前半）：`CATEGORY_VERSION` 形如 `2026-09-10`，改分类表时手工递增并重新生成 skill；skill 输出带同一版本号；上传时与应用当前版本不一致或缺失 → 400 `skill_outdated`，不允许带警告继续。
31. **批内重复行不合并**（2026-09-10 用户决定，README U-11 改）：完全相同的行全部保留并打 `needs_review` + `hint`，标记维持 `duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review` 四种，删除 `merged_duplicates`。
32. **交易日期是无时区的日历日期**（2026-09-10 用户确认 P-1 并提出）：`occurred_at` 用 Postgres `DATE`，不存时间、不带时区，用户换时区不会变。接口一律用 `YYYY-MM-DD` 字符串传输；前端把它当字符串显示和比较，**不得**用 `new Date("YYYY-MM-DD")` 再格式化（会按 UTC 零点换算导致差一天）；表单默认"今天"取浏览器本地日期而非 UTC 日期；导入文件的 `date` 同样是无时区字符串；汇率按该日历日期查。
33. **P-2 至 P-6 追认**（2026-09-10 用户确认）：不做"不计收支 / 不计预算"标记；注册开关默认开；宽屏 ≥1024px 侧栏、窄屏底部五 tab；退款候选默认最近 90 天；转账手续费另记一笔支出。
34. **两条单腿转账可以配对成一笔转账**（2026-09-10 用户决定，取代 P-7 的"标可能重复"）：导入 review 里对转账行自动找对方账户上 ±3 天、同币种同金额、方向相反、仍为单腿的转账，唯一候选默认勾选"关联为一笔转账"，多候选列出让用户选；提交时新行与已有行共用新的 `transfer_pair_id`，已有行的 `counterparty` 清空。对方已是两腿转账的一半时本行标 `duplicate`。交易详情页提供"关联为转账对腿"（选一条单腿转账配对）和"拆开"（两腿各自变回单腿）两个操作。两种关联（退款 `refund_of`、转账配对）在导入之后都可以在交易页修改或解除，review 里的自动建议只是预填（2026-09-10 用户确认）。标记名 `repayment` 改为 `transfer_candidate`，预填复用 `matched_transaction_id`。**各章待同步**：01 流程与状态图、03 导入行 PATCH 字段与 commit 逻辑、新增配对 / 拆开端点、04 review 表格与详情页、05 自动标记算法。
35. **邀请码输错限流改为端点级 1 QPS**（2026-09-10 用户决定，P-12 改）：删除"同一用户 15 分钟 5 次"，改为 `POST /ledgers/join` 全局 1 QPS（突发 3），429 + `Retry-After`，code 沿用 `invite_rate_limited`；6 位、10 分钟、一次性的规格不变。
36. **P-8 至 P-11 追认**（2026-09-10 用户确认）：外部转入默认建议记为收入；分类 code 用英文标识、中英显示名进常量；分类表经公开接口下发并永久缓存；加入账本为 owner 生成码、对方输入。
37. **P-13 至 P-18 追认**（2026-09-10 用户确认）：账本内账户完全共享；每人 10 本、每本 10 人；owner / member 两档、owner 退出前先转让、删账本级联；基准币种归账本；注册自动建"我的账本"；乐观锁 409、聚焦刷新、不做实时同步。
