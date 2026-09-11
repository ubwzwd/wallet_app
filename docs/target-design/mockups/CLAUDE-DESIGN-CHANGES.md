# 屏幕稿修改：拿回 Claude Design 用的提示词

审阅 [`REVIEW-2026-09-11.md`](./REVIEW-2026-09-11.md) 末尾列了「回 Claude Design 要改的清单」。本文把它整理成可以直接粘贴给 Claude Design 的提示词。

## 0. 怎么做

- **不用 design-sync。** 那个工具是把一套"组件库代码仓库"上传成 Claude Design 的设计系统，让它用你的真实组件画图；它不改屏幕稿，而且需要在终端里 `/design-login`，这个 IDE 会话做不了。
- 屏幕稿仍在你 claude.ai/design 的普通项目「设计方案反馈」里。改法就是**在那个项目里继续对话**：先发 §1 的背景消息，再按 §2 一屏一条发。
- 改完按 §3 重新导出 zip 给我，我重新导入 `mockups/`、再跑一遍对照审阅。
- 纯文案级的小改（去掉某个字、改一句说明）我也可以直接改本目录里的 `.dc.html`，但这样 Claude Design 那边就和仓库不同步了；只要之后还打算在 Claude Design 里迭代，就都在那边改。

## 1. 第一条消息（整段粘贴）

我们按这套稿子过了一遍产品决策，有一批要改的地方。规则：沿用已确认的 token（Design Tokens v2 · 定稿）和组件，示例数据不变，只改下面点名的内容；没点名的一律保持原样。每改一屏给 375 和 1440 两个版本。

先记住几条全局规则，后面每屏都适用：

1. 交易只有四种：支出、收入、退款、转账。转账没有商户、没有分类；列表和详情里转账的标题是「A → B」（两腿）或「对方：X」（单腿）。
2. 商户字段一律叫「商户」。
3. 界面上不要出现「App」「客户端 iOS」之类字样，这是响应式网页。
4. 账户类型只有四种：储蓄卡（checking）、信用卡、现金、其他。没有「储蓄」「Savings」。
5. 一级分类的判据文字和二级样例以我下面贴的分类表为准（附在这条消息末尾），不要自己编。
6. 导入只收 CSV 文件，固定 11 列表头：`date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref`，文件首行是 `# version: 2026-09-10`。

分类表：

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

## 2. 逐屏提示词（一屏一条）

每条开头都加一句：「沿用已确认的 token 和组件，示例数据不变，只改以下几点。」

**屏幕 01 首页**
趋势图保持只有支出，不加收入。宽屏左侧导航去掉「报表」「成员」两个顶级页，只留：首页、交易、记一笔、导入、我的（和窄屏底部五个 tab 一致）。

**屏幕 02 交易列表**
筛选栏补一个「币种」多选。行上的金额显示原币金额，外币行在下面小字显示折算成基准币种的金额（例：`−S$12.40` 下面 `≈ ¥66.20`）。两腿转账合并成一行的做法保留。去掉「导出 CSV」按钮。列表按日分组、每日小计、底部的支出 / 收入 / 净额汇总保留。

**屏幕 03 导入 review 表格**
去掉每行的「确认这行」操作和顶部的「就绪」计数，行只有三种状态：待处理、已改、已跳过。普通行（支出 / 收入 / 退款）不能改账户，账户列只读；只有转账行可以改「对手账户」，或者填「对方」文字，两者互斥。去掉分类列的「建议」chip，分类留空就显示「待归类」。补画两个交互：
- 退款行：「关联原单」——默认勾选服务端预填的原支出（显示日期、商户、金额、可退余额），可取消，可点「改选」打开原单选择器；
- 转账行：「关联为一笔转账」——唯一候选时默认勾选并显示对方账户与日期；多候选时不勾选，显示「找到 N 条可以配对的转账」和一个「选一条」按钮，打开选择器（只列反向的单腿转账）。
批量操作栏保留：批量设分类、批量跳过、提交。

**屏幕 05 记一笔 · 转账**
汇率 chip 改成只读（显示汇率与日期，不可点开编辑）；另一腿的金额仍可手改。转账表单没有「商户」和「标题」字段。子类型选「信用卡还款」时，转入账户下拉只列信用卡账户。

**屏幕 06 记一笔 · 退款（原单选择器）**
已经退完的原支出仍然可选，但选中后表单显示黄色警告「超过可退金额」，允许保存。选择器筛选条里「仅支出」这个条件固定显示、不能移除。

**屏幕 07 / 08 交易详情**
去掉「编号」和每条腿的「余后」余额。操作记录时间线保留（事件：创建、修改、导入、配对、拆开、关联退款、解除退款；显示时间、操作人、改了什么）。退款详情列出同原单的其它退款（已有，保留）。两腿转账的操作：编辑、拆开、删除；单腿转账多一个「关联为转账对腿」。

**屏幕 09 账户**
表单里期初余额的说明改为「记在账户上，不是一笔交易」。类型四种：储蓄卡、信用卡、现金、其他。信用卡的期初余额输入「当前欠款」，显示为负数。其余保留：按类型分组小计、资产 / 负债 / 净资产三个数、归档账户折叠在底部并标「不计入净资产」和归档时间、币种字段创建后置灰不可改。

**屏幕 10 导入 · 指南与上传**
只做 CSV：文案和示例都改成 CSV，列名改为 11 列固定表头（见第一条消息第 6 条）。校验失败态的样例改成结构错误：「第 1 行：缺少 `# version:` 行」「第 2 行：表头与固定 11 列不符」「第 17 行：列数为 10，应为 11」；行级问题（日期格式、金额不是数字、分类不认识）不在这里报错，而是进 review 表格打标记。去掉上传前显示「你的 skill 版本」的那块。版本过期态保留：「你的 skill 版本是 2026-08-01，当前 2026-09-10，请更新后重传」，带一个去导入指南的按钮。「复制错误清单」按钮保留。

**屏幕 11 导入历史**
批次只有两种状态：待提交、已提交；去掉「已撤销」状态和撤销原因。批次行补「上传人」。撤销确认对话框分开写两句：「有 2 笔批外退款将失去原单」和「批内 1 笔退款删除后，其原支出恢复可退额度」。

**屏幕 12 账本设置**
成员上限 10 人。改基准币种的警告文案改为「历史交易将按各自发生日的汇率重新折算，结果可复现」。权限说明改为：成员可以记账、管理账户、导入和撤销导入；只有 owner 能生成邀请码、移除成员、改账本名和基准币种、转让、删除账本。邀请码的「作废」按钮保留。

**屏幕 13 账本列表 / 加入账本**
加入账本只有一个 6 位码输入框和「加入」按钮，去掉输码即预览账本信息的那块。账本卡片只显示名称、成员数、基准币种，去掉净资产和交易数。

**屏幕 14 个人设置**
去掉通知、换头像、导出我的数据。加一项「外观」：跟随系统 / 浅色 / 深色，三选一 Segmented。保留：显示名、默认币种、语言、退出登录。

**屏幕 15 空状态**
补一张「用户一本账都没有」的引导页：两个入口「新建账本」「用邀请码加入」。已有的三个空状态里，「默认分类」的措辞改为「分类是内置的、不可改」。

**新增：登录 / 注册**
一张登录页（邮箱、口令、登录，下方「注册」链接），一张注册页（邮箱、口令、显示名），以及注册页的「注册已关闭」态：表单换成一段提示「本站暂不开放注册，请向账本 owner 索取邀请」。

## 3. 改完怎么交回来

1. 在项目里让 Claude Design 重新整理交付物（同 [`../design-brief.md`](../design-brief.md) §3）：更新后的 `tokens.json`（如果 token 没动可以不导）、各屏的设计文件。
2. 用项目菜单「导出」整个项目成 zip，放到本机任意位置。
3. 告诉 Claude Code 路径，它会重新导入到本目录、重跑对照审阅、更新 04 章 §6 的屏幕稿索引。
