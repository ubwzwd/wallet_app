# 04 — 前端（目标设计：信息架构、页面、API 客户端、i18n 与视觉定稿）

> **本文回答什么问题**：v3.0 的网页端应该长成什么样、由哪些路由和页面组成、每个页面调用哪些接口、状态放在哪里、API 客户端怎么分层、TanStack Query 的 key 和失效怎么定义、409 冲突和统一错误码怎么展示给用户、中英双语怎么落地、视觉定稿的 token 与 17 张屏幕稿怎么落到代码里、测试测什么。读者假定没看过这个仓库：读完应该能直接开工。

本文的每一条设计都可以追溯到 [`00-decisions.md`](./00-decisions.md) 的某一节，标注形如「（决策 §1.2）」。决策记录是唯一事实来源；本文只展开、细化，不改写。凡是决策记录没覆盖、又必须做选择的地方，一律进文末 [`## 待决`](#待决)，正文里不擅自拍板。

描述**现状**时（`path:line` 形式的引用）指的是 [`../current-design/04-frontend.md`](../current-design/04-frontend.md) 所描述的、当前仓库里真实存在的代码；描述**目标**时不假设任何代码已经存在。所有相对路径以仓库根目录为基准。

> **修订说明（2026-09-11，本轮）**：按决策 §14.20–§14.53 做**删旧立新**的同步，不是加注。
>
> - **应用不接入 LLM**（决策 §5、§6、§14.25）：删除 LLM 设置页 `/settings/llm`、`LlmSettings` / `LlmSettingsPut` / `LlmTestResult` 三个类型、`llmApi.*` 全部函数、`User.has_llm_settings`，以及三个与模型调用有关的错误 code。
> - **导入改为同步校验模型**（决策 §5、§14.47）：删除解析进度与轮询、页面缩略图侧栏与它的页号字段、视觉路径标志位、`retry` 端点、置信度列、「已合并」标记，以及后台解析才会有的那三个错误 code；新增**导入指南页**（`GET /import-format`）、粘贴 CSV 入口、结构错误与 `skill_outdated` 两种失败态、批量改行端点。标准格式只有 CSV。
> - **转账配对**（决策 §14.34）：review 表格的 `transfer_candidate` 建议与「关联为一笔转账」勾选框、交易详情的「关联为转账对腿」与「拆开」、`txApi.pair` / `txApi.unpair`。
> - **屏幕稿审阅后的裁定**（决策 §14.47–§14.52）：账户四种类型与资产 / 负债 / 净资产、`archived_at`、币种创建后不可改、交易列表合并转账行 + 按日小计 + `summary`、金额区间按基准币种、`transaction_events` 操作记录时间线、邀请码可作废、外观设置存本机、首页趋势只放支出。
> - **按 §14.53 统一各章打架之处**（决策 §14.53 a–f）：§3.7 的文案表与 03 §4.2 注册表**双向**对齐（`pair_invalid` / `unpair_invalid` / `import_format_invalid` / `currency_locked` / `repayment_target_not_credit` 补齐，`rows_exceed_limit` 是 400，两个前端本地 key 移到表外）；`ImportFileError` 改成 `errors[{line, message}]` + `current_version` / `file_version` / `guide_url`；review 的转账配对**只用 `matched_transaction_id` 一列**（多候选不预填、在 `transfer_candidate` 之外另打 `needs_review`、给「选一条」按钮复用交易列表接口）；没找到对腿时对手账户不预选；配对后两腿子类型由服务端统一；`RefundRef` / `RefundOrigin` / `ImportBatch` / `ImportRow` 与 03 的响应体逐字段对齐。
> - **§6 整章重写**：A/B/C 三个候选方向与 mockup 清单作废（决策 §14.45），改为「已定稿：04 柔和圆润」，token 引用 [`./mockups/tokens.json`](./mockups/tokens.json)，并给出 17 张屏幕稿的索引与「按裁定需改之处」。
> - **待决清空**：D-1 至 D-13 全部已被决策 §14.42、§14.45、§14.46 等裁定，文末只留结论。
---

## 0. 与现状的差异总览

v3.0 前端是一次**结构性重写**，不是增量改造：账本（ledger）这个新维度贯穿路由、状态、查询键和每一个接口（决策 §2），现有的「无路由器 + `useState` 视图机」结构没有办法承载它。但技术栈不换（决策 §12）。

### 0.1 保留

| 保留项 | 现状依据 | 为什么保留 |
|---|---|---|
| Expo 54 + React Native 0.81 + react-native-web 0.21 | `frontend/package.json:21,27,32` | 决策 §12 明确沿用；决策 §0.1 把 Android/iOS 排在网页端之后，保留 RN 栈是为了那一步不用推倒重来 |
| TanStack Query 5 作为服务端状态层 | `frontend/package.json:19`；`frontend/src/utils/queryClient.ts:6-19` | 缓存、失效、轮询、窗口聚焦刷新都靠它；决策 §2「列表在窗口重新聚焦时自动刷新」直接落在它的 `refetchOnWindowFocus` 上 |
| axios 实例 + 拦截器 | `frontend/src/api/client.ts:8-14,19-34,39-79` | 请求拦截器注入 `Authorization`、响应拦截器归一化错误的骨架可用，改的是归一化的**产物**（§3.5） |
| `AuthContext` 的状态机 | `frontend/src/store/AuthContext.tsx:11-19,30-31`；现状文档 §2.4 的状态图 | BOOTSTRAPPING → ANONYMOUS / AUTHENTICATED 三态是对的，只修一处缺陷（§2.1） |
| AsyncStorage 存令牌（Web 上落到 `localStorage`） | `frontend/src/constants/config.ts:10-13` | 跨平台同一套 API；键名不变 |
| PWA：manifest、`workbox generateSW`、`registerSW` 副作用导入 | `frontend/public/manifest.json`；`frontend/workbox-config.cjs:26-34`；`frontend/src/pwa/registerSW.ts:20-32` | 已经能装、能离线开壳；只调整缓存策略（§7） |
| `expo export -p web` → `dist/` → Caddy 静态托管 | `frontend/package.json:10` | 决策 §0.1 部署沿用现状 |

### 0.2 重写

| 重写项 | 现状 | 目标 |
|---|---|---|
| 导航 | 没有路由器；`Navigation` 按登录态二选一（`frontend/src/components/Navigation.tsx:13-19`），`HomeScreen` 用一个 `useState<HomeView>` 切八个视图（`frontend/src/screens/HomeScreen.tsx:12,16`）；URL 永远是 `/` | 真正的 URL 路由，账本 id 在路径里、筛选条件在 query 里（决策 §12）；浏览器前进/后退、刷新、深链接、分享链接全部可用（§1） |
| 布局 | 单一窄栏，`Screen` 固定内边距 16（`frontend/src/components/Screen.tsx:17,64`），没有断点 | 响应式两套骨架：`<1024px` 底部 tab + 中央「记一笔」；`≥1024px` 左侧导航栏 + 顶部账本切换器（决策 §0.6） |
| 页面 | 8 个 `HomeView` 值 | 决策 §12 列出的全部页面，每个一条路由（§4） |
| API 层 | 4 个模块、按用户维度的端点（`frontend/src/api/*.ts`） | 按资源分 12 个模块、全部走 `/ledgers/{id}/...`（决策 §11）；带完整 TypeScript 类型（§3） |
| 样式系统 | 14 个文件里 147 处字面量十六进制、18 种颜色，无主题模块（现状文档 §6.2） | 单一 token 模块 + 组件库，深浅色双主题（§6） |
| 交易表单 | 三种 type（`expense`/`income`/`transfer`），转账靠客户端生成 `pairId` 发两次 `POST` 并手工回滚（`frontend/src/screens/TransactionFormScreen.tsx:161-234`） | 四种 kind（决策 §1），转账走 `POST .../transactions/transfer` 一次成事（决策 §1.2） |
| 平台分支 | 22 处 `Platform.OS`，5 处无守卫的 `<select>` / `<input type="date">`（现状文档 §1.4、§1.5），`Alert.alert` 在 Web 上是空实现导致登录失败无提示（现状文档 §1.6、§2.5） | 统一的跨平台组件（`Select`、`DateField`、`Toast`、`ConfirmDialog`），页面里不再出现 `Platform.OS` 和 `window.alert` |

### 0.3 新增

| 新增项 | 依据 |
|---|---|
| `LedgerContext`：当前账本、成员角色、基准币种（§2.2） | 决策 §2 |
| 账本列表 / 新建 / 加入（6 位邀请码）、账本设置（成员、邀请码、转让、退出、删除） | 决策 §2、§12 |
| 分类：启动时拉 `GET /categories`，按 `version` 永久缓存（§2.3） | 决策 §1.3 |
| 四 kind 的记一笔表单、退款关联原单选择器、单腿/两腿/跨币种转账（§4.6） | 决策 §1、§1.1、§1.2 |
| 首页统计（账户余额 + 本月分类汇总 + 12 月趋势） | 决策 §7 |
| 交易列表筛选栏 + URL 同步 + 分页 | 决策 §4 |
| 导入指南页（三步说明 + skill 文本复制 / 下载 + 示例 CSV，数据来自 `GET /import-format`） | 决策 §6 |
| 导入流程：上传或粘贴 CSV → 同步校验 → review 表格 → 提交 → 历史（§4.10、§4.11） | 决策 §5、§14.47 |
| review 表格的转账配对建议与「关联为一笔转账」勾选框（§4.11.3） | 决策 §14.34、§14.53b |
| 交易详情的「关联为转账对腿」/「拆开」、`refunds[]`、原单摘要、操作记录时间线（§4.7） | 决策 §14.34、§14.46、§14.51、§14.53a |
| 注册页启动读 `GET /config`，关闭时直接显示提示（§4.2） | 决策 §14.46 |
| 个人设置的显示名 `display_name` 与「外观」（跟随系统 / 浅色 / 深色，存本机）（§4.13） | 决策 §14.6、§14.52 |
| i18n（中英双语，默认跟随系统） | 决策 §0.4 |
| 全新视觉体系，token 与 17 张屏幕稿已定稿在 [`./mockups/`](./mockups/README.md)（§6） | 决策 §0.3、§14.45 |
| 409 `stale_update` 的统一处理、`{detail, code}` 错误码到文案的映射 | 决策 §2、§9 |

### 0.4 删除

- 标签输入框、`?tag=` 筛选、`tags` 字段（决策 §1.3）。
- `RegisterScreen` 里硬编码的 5 币种列表（`frontend/src/screens/RegisterScreen.tsx:6-12`）——币种一律来自 `GET /rates/currencies`。
- 四份复制粘贴的币种选择器与目标账户选择器（现状文档 §4.9）——合并成一个 `Picker` 组件。
- `frontend/src/screens/HomeScreen.tsx` 的视图机与所有 `on*Press` 回调 prop。
- 已装未用的 `react-hook-form` / `zod` / `nativewind` / `tailwindcss`（现状文档 §6.3）中，`react-hook-form` + `zod` 留下（§4 的表单校验用它们），其余从 `package.json` 移除。
- **LLM 设置页 `/settings/llm`** 与它的类型、API 函数、语言包、错误文案（决策 §5、§6、§14.25）——应用不接入大模型，没有 API key、没有模型选择、没有「测试连接」。
- **导入的解析进度轮询**（进度字段、阶段文案、超时提示）、**页面缩略图侧栏**（整页图列表、行上的页号、视觉路径标志位、取 blob 的逻辑）、**重试按钮**（`POST .../retry`）、**置信度列**、**「已合并」徽章**——校验是同步的，应用也拿不到原始账单（决策 §5、§14.25、§14.31）。
- **`/auth/me` 的过渡兼容**：`/me` 是唯一入口，`/auth` 下只留 `register` / `login`，不保留任何别名（决策 §14.42）。
- **账户类型 `savings`**：四种类型不含它，现有数据迁移成 `checking`（决策 §14.48）。
- 界面上的**导出 CSV**、**通知**、**头像**、**交易编号**、**每条腿的余后余额**、**分类推荐 chip**、**「报表」/「成员」顶级页**、**邀请码输入即预览**（决策 §14.52 的「不做」清单）。

---

## 1. 信息架构与导航

### 1.1 路由库

**已定** —— 用 **Expo Router v6**（随 Expo SDK 54 提供，决策 §14.46 的 04-D-1）：文件式路由、Web 上直接映射到真实 URL、`useLocalSearchParams` / `useRouter` 一套 API 跨平台、原生端自带深链接配置——决策 §0.1 后面还要做 App，这一点值得。被否掉的备选是 `@react-navigation/native` + 手写 `linking` 配置（这两个包现在就装着，`frontend/package.json:17-18`，只是从未被导入），Web 上的 URL ↔ 状态映射要自己写，成本更高；这两个包从 `package.json` 移除。

下文用「路由表」而不是文件树来表达，因为无论选哪个库，路由表都不变。

### 1.2 路由表

`:ledgerId` 是 UUID。所有 `/l/:ledgerId/*` 路由都要求「已登录 + 是该账本成员」（决策 §2 的鉴权模型）。

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 登录 | 匿名可见 |
| `/register` | 注册 | 匿名可见；启动时读 `GET /config`，`registration_open=false` 时用提示卡替代表单（决策 §0.5、§14.46） |
| `/ledgers` | 账本列表 | 已登录；也是新建/加入的入口 |
| `/ledgers/new` | 新建账本 | 模态或独立页 |
| `/ledgers/join` | 加入账本（输入 6 位码） | 决策 §2 |
| `/l/:ledgerId` | 首页（统计） | 支持 `?month=YYYY-MM` |
| `/l/:ledgerId/transactions` | 交易列表 | 全部筛选走 query（§1.3） |
| `/l/:ledgerId/transactions/new` | 记一笔 | `?kind=expense\|income\|refund\|transfer`，默认 `expense`；可带 `?source_id=`、`?refund_of=` 预填 |
| `/l/:ledgerId/transactions/:txId` | 交易详情 | 单腿交易 |
| `/l/:ledgerId/transactions/:txId/edit` | 编辑单笔 | |
| `/l/:ledgerId/transfers/:pairId` | 两腿转账详情 | 两腿一起显示 |
| `/l/:ledgerId/transfers/:pairId/edit` | 编辑两腿转账 | 走 `PATCH .../transactions/transfer/{pair_id}`（决策 §1.2） |
| `/l/:ledgerId/sources` | 账户列表 | `?include_archived=1` 显示归档 |
| `/l/:ledgerId/sources/new` | 新建账户 | |
| `/l/:ledgerId/sources/:sourceId/edit` | 编辑账户 | |
| `/l/:ledgerId/imports` | 导入历史（批次列表） | 状态只有 `ready` / `committed`（决策 §5） |
| `/l/:ledgerId/imports/guide` | 导入指南 | 三步说明 + skill 文本 + 示例 CSV，内容来自 `GET /import-format`（决策 §6） |
| `/l/:ledgerId/imports/new` | 新建导入 | 选账户 + 上传或粘贴 CSV（决策 §5、§14.47） |
| `/l/:ledgerId/imports/:batchId` | 导入详情 | `ready` → review 表格；`committed` → 结果与撤销（§4.10） |
| `/l/:ledgerId/settings` | 账本设置 | 成员、邀请码、基准币种、转让、退出、删除 |
| `/settings` | 个人设置 | 显示名、默认币种、语言、外观（决策 §14.6、§14.52） |
| `*` | 404 | 提供「回到我的账本」按钮 |

**为什么账本 id 在路径而不是全局状态里**（决策 §12）：一条交易列表的链接必须能发给同账本的另一个人并打开同一个视图；浏览器后退要能在账本之间来回；同一浏览器开两个标签页看两本账不能互相干扰。放在路径里，这三件事自动成立。

### 1.3 筛选条件写在 URL query 里

交易列表的 query 参数名与 `GET /ledgers/{id}/transactions` 的参数名**逐字相同**（决策 §4），省掉一层映射：

```
/l/2f1c.../transactions?kind=expense&kind=refund&source_id=7c3e...&from=2026-08-01&to=2026-08-31&q=%E5%92%96%E5%95%A1&category_l1=food&min_amount=20&max_amount=500&currency=CNY&offset=100
```

| query 参数 | 类型 | 说明 |
|---|---|---|
| `q` | string | 关键词，服务端 ILIKE 匹配 `merchant` / `note` |
| `kind` | 可重复 | `expense` / `income` / `refund` / `transfer` |
| `source_id` | 可重复 | 账户 UUID |
| `category_l1` / `category_l2` | string | 分类 code |
| `from` / `to` | `YYYY-MM-DD` | 发生日范围（闭区间） |
| `currency` | 3 位大写 | |
| `min_amount` / `max_amount` | number | **按账本基准币种折算后的绝对值**（决策 §14.49） |
| `import_batch_id` | UUID | 只看某一批导入建的交易（决策 §14.46 的 04-D-7）；由「查看这批交易」带进来 |
| `offset` | int | 分页游标；`limit` 不进 URL，固定 50 |

约定：**空值不写进 URL**（`?q=` 这样的空参数一律删掉），保证同一筛选状态只有一种 URL 写法，也保证它可以直接当 query key 的一部分（§3.4）。数组参数用重复键（`kind=a&kind=b`）而不是逗号串，和 FastAPI 的 `Query(list)` 语义一致。

首页的 `?month=YYYY-MM`、账户列表的 `?include_archived=1`、导入详情的 `?row=<rowId>`（滚动定位到某一行）与 `?filter=uncategorized`（review 的行内筛选切片，§4.11.6）同理。

### 1.4 布局骨架（决策 §0.6）

断点只有一个：**1024px**。

```
 <1024px（窄）                              ≥1024px（宽）
┌──────────────────────────────┐   ┌───────────┬────────────────────────────────────┐
│ 顶栏: 页面标题 · 账本名(可点) │   │           │ 顶栏: [账本切换器 ▾] ...... [头像▾] │
│                              │   │  侧边栏   ├────────────────────────────────────┤
│                              │   │           │                                    │
│         内容区                │   │ 首页      │            内容区                   │
│                              │   │ 交易      │        (max-width 1200,居中)        │
│                              │   │ 账户      │                                    │
│                              │   │ 导入      │                                    │
├──────────────────────────────┤   │ ─────     │                                    │
│ 首页  交易  ( ✚ )  导入  我的 │   │ 账本设置  │                                    │
└──────────────────────────────┘   │ 个人设置  │                                    │
   底部 tab，中央凸起「记一笔」     └───────────┴────────────────────────────────────┘
```

- 窄屏底部 tab 五项：**首页 / 交易 / 记一笔（中央凸起按钮）/ 导入 / 我的**（决策 §0.6）。中央按钮不是 tab，是直接跳 `/l/:ledgerId/transactions/new?kind=expense`；长按（或右侧小箭头）展开四个 kind 的快捷入口。
- 窄屏顶栏第二行显示当前账本名，点开是账本切换的底部抽屉。
- 宽屏侧边栏常驻，账本切换器放顶栏左上；「记一笔」是侧边栏顶部的主按钮，不再占 tab 位。
- 「我的」tab 聚合个人设置（含外观开关）、账本设置、切换账本、登出。**没有「报表」「成员」两个顶级页**（决策 §14.52 A21）。
- 导入 review 页（§4.11）在宽屏是全宽表格，**内容区不受 1200px 限制**，因为决策 §0.6 要求它在桌面上好用。

### 1.5 跳转规则（路由守卫）

```
                        进入任意路由
                              │
                    ┌─────────▼─────────┐
                    │ auth.status ?     │
                    └───┬────────┬──────┘
        BOOTSTRAPPING   │        │  ANONYMOUS
              ┌─────────┘        └────────────┐
              ▼                               ▼
     渲染全屏骨架屏(不跳转)      目标是 /login|/register ? 渲染 : 跳 /login?next=<原URL>
              │
              ▼  AUTHENTICATED
      ┌───────────────────────────────────────────────┐
      │ 目标路由需要 ledgerId 吗？                      │
      └───┬───────────────────────────────┬───────────┘
        否│                              是│
          ▼                                ▼
    正常渲染                    ┌──────────────────────────────┐
    (/ledgers, /settings...)    │ GET /ledgers 已加载？        │
                                └───┬──────────────────┬───────┘
                                 否 │ 骨架屏           │ 是
                                    ▼                  ▼
                                  等待        ┌────────────────────────┐
                                              │ ledgerId 在我的账本里？ │
                                              └──┬──────────────┬──────┘
                                              是 │              │ 否
                                                 ▼              ▼
                                          渲染页面      账本数 = 0 ? → /ledgers（空态引导新建/加入）
                                                        否 → 提示「账本不存在或你没有权限」
                                                             + [切到 <上次账本>] / [看我的账本]
                                                             不自动静默跳转
```

规则细节：

1. **未登录**：跳 `/login?next=<encodeURIComponent(原 URL)>`；登录成功后回 `next`，`next` 非法（非本站相对路径）时回 `/ledgers`。
2. **登录后落地**：`/` 与 `/login` 在已登录时重定向到「最后使用的账本」（`localStorage` 里的 `wallet:last_ledger_id`，§2.2）；该 id 不在 `GET /ledgers` 结果里就取列表第一本；一本都没有（不可能发生，注册时自动建默认账本，决策 §2，但仍要兜底）就去 `/ledgers`。
3. **账本不存在 / 无权限**：服务端对非成员一律返回 404（不泄漏账本是否存在，决策 §2 的鉴权模型）。前端显示同一个页面：「这个账本不存在，或者你不在它的成员里」，两个按钮回到已知安全的地方。**不自动跳转**——被移出账本的人如果被静默弹回首页会以为是自己点错了。
4. **中途被移出**：后端对「账本不可见」和「账本里的某个子资源不存在」用的是**同一个** 404 `not_found`（[`./03-backend-api.md`](./03-backend-api.md) §3.3、§4.2），所以前端不能凭任意一个 404 就判定「被移出」。判定的锚点是**账本详情本身**：`GET /ledgers/{id}`（query key `l/{id}/detail`）返回 404 `not_found` 时，全局错误处理清掉该账本的所有 query 缓存（`removeQueries(['l', id])`）并跳到第 3 条的页面。其他 `/l/:ledgerId/*` 请求收到 404 时只让该页面显示「这条记录不存在或已被删除」，同时触发一次账本详情的重取来确认是不是被移出了。
5. **401**：拦截器清令牌 → `AuthContext` 转 ANONYMOUS → 守卫把当前路由变成 `/login?next=...`（现状的缺陷是拦截器清了存储却没人通知 `AuthContext`，界面停在原页面，`frontend/src/api/client.ts:58-63`；§2.1 修掉它）。
6. **注册关闭**：`/register` 仍可访问；页面挂载时先取 `GET /config`（匿名可读，决策 §14.46），`registration_open=false` 就用一张提示卡**替代整个表单**，而不是渲染一个禁用的表单让人白填；`config` 还没回来时渲染表单骨架。提交后拿到 403 `registration_closed` 也切到同一状态（服务端始终是权威）。

### 1.6 深链接

- Web：所有路由都是真实 URL，Caddy 已经把未知路径回落到 `index.html`（`infra/Caddyfile:28-32`），但当前 service worker 的 `navigateFallback` 会把非 `/` 的导航统统答成 `offline.html`（现状文档 §7.4）——这是必须改的一点，见 §7.2。
- 原生（未来）：`app.json` 里配 `scheme: "wallet"`，`wallet://l/<id>/transactions` 与 `https://<域名>/l/<id>/transactions` 映射到同一路由表。本版本不实现，但路由表按能直接复用的方式设计。
- 分享一条交易：`/l/:ledgerId/transactions/:txId`；分享一个筛选视图：整条带 query 的列表 URL。

---

## 2. 全局状态

分四层，各管各的，不互相持有引用：

| 层 | 内容 | 存放 |
|---|---|---|
| 认证 | `user`、令牌、登录/登出动作 | `AuthContext`（React state + AsyncStorage） |
| 账本上下文 | 当前 `ledgerId`、`ledger`、`myRole`、`baseCurrency` | `LedgerContext`（派生自 URL + `GET /ledgers`） |
| 服务端数据 | 一切来自接口的数据 | TanStack Query |
| 界面偏好 | 语言、主题、上次账本、列表密度 | `localStorage` / AsyncStorage |

**没有 Redux/Zustand**。除认证与账本上下文外，页面级状态（表单草稿、筛选栏的临时输入、review 表格的选中行）留在组件里；跨页面的一律走 URL 或 Query 缓存。

### 2.1 `AuthContext`（保留 + 一处修复）

状态机沿用现状（`frontend/src/store/AuthContext.tsx:11-19,30-31`，状态图见现状文档 §2.4）：

```
   挂载
     │  getItem('@wallet_app:auth_token')
     ▼
┌─────────────────┐  无 token / GET /me 抛错  ┌──────────────┐
│ BOOTSTRAPPING   │──────────────────────────▶│ ANONYMOUS    │
│ status=loading  │                            │ user=null    │
└────────┬────────┘                            └──┬────────▲──┘
         │ GET /me 200                            │ login/ │
         ▼                                        │register│ 401 或 logout()
┌─────────────────┐                               │ 成功   │
│ AUTHENTICATED   │◀──────────────────────────────┘        │
│ user={...}      │─────────────────────────────────────────┘
└─────────────────┘
```

对现状的三处改动：

1. **`login()` / `register()` 期间不再切 `isLoading`**。现状里它们一进来就 `setIsLoading(true)`（`frontend/src/store/AuthContext.tsx:71,98`），而 `AppContent` 在 `isLoading` 为真时把整棵树换成加载指示器（`frontend/App.tsx:16-23`），于是登录失败时表单被卸载重挂、错误提示打在已卸载的组件上、Web 上什么都看不见（现状文档 §2.5）。目标：`isLoading` 只表示**启动引导**；提交中的状态由页面自己的 mutation `isPending` 表达。
2. **401 要通知 `AuthContext`**。拦截器不再直接动存储，而是调用一个注册进来的 `onUnauthorized()` 回调，由 `AuthContext` 清存储 + `setUser(null)`，路由守卫随即接管（§1.5 第 5 条）。`GET /me` 自身的 401 仍然走启动引导的那条路径。
3. **接口路径**：`GET /me` / `PATCH /me`（决策 §11 的「我」分组），不是现状的 `/auth/me`。`POST /auth/register`、`POST /auth/login` 不变。**`/auth/me` 不再注册，也不保留别名**——应用尚未上线，目标设计里不留任何过渡兼容（决策 §14.42）。

上下文形状：

```ts
type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;                       // status==='authenticated' 时非空
  login(body: LoginRequest): Promise<void>;
  register(body: RegisterRequest): Promise<void>;
  logout(): Promise<void>;                 // 清令牌 + queryClient.clear() + 跳 /login
  refreshUser(): Promise<void>;
}
```

`logout()` 必须调 `queryClient.clear()`：现状没清，缓存里的上一个用户数据会留到下一次登录（也留在 service worker 的 `api-cache` 里，现状文档 §7.4）。

### 2.2 `LedgerContext`（新增）

```ts
interface LedgerContextValue {
  ledgerId: string;            // 来自路由参数，不是内部 state
  ledger: Ledger;              // 来自 GET /ledgers 缓存
  myRole: 'owner' | 'member';
  baseCurrency: string;        // = ledger.base_currency（决策 §2：基准币种属于账本）
  ledgers: Ledger[];           // 切换器用
  switchTo(id: string): void;  // router.replace 到同名路由的对应账本，保留 query
}
```

要点：

- **唯一事实来源是 URL**。`ledgerId` 从路由参数读，Context 不持有自己的 `useState`；浏览器后退天然正确。
- Provider 挂在 `/l/:ledgerId` 布局层，内部不做请求：`ledgers` 来自 `useQuery(['global','ledgers'])`，未命中时渲染骨架屏，命中但 id 不在其中时走 §1.5 第 3 条。
- **持久化上次选择**：`ledgerId` 变化时写 `localStorage['wallet:last_ledger_id']`（原生端 `AsyncStorage`，键 `@wallet_app:last_ledger_id`）。只在 §1.5 第 2 条的落地重定向里读，别处不读——它是便利，不是状态。
- `switchTo(id)` 保留当前路由形态而不是一律回首页：在交易列表切账本仍然停在交易列表，但**丢弃 query 里的 id 类筛选**（`source_id`、`category_*` 之外的 id 都不跨账本通用），保留 `from`/`to`/`kind`/`q`。
- `myRole` 决定账本设置里那些只有 owner 能点的操作（决策 §2）。
- web 上 `localStorage` 的键统一由 `src/utils/prefs.ts` 加 `wallet:` 前缀，原生端沿用 `@wallet_app:` 前缀（同步 2026-09-12）。

### 2.3 分类表：启动拉取，按 `version` 永久缓存（决策 §1.3）

分类是后端代码里的常量，只在发版时变（决策 §1.3），所以：

```ts
// 应用启动即预取（不阻塞首屏），失败可重试
useQuery({
  queryKey: ['global', 'categories'],
  queryFn: categoriesApi.get,
  staleTime: Infinity,
  gcTime: Infinity,
  networkMode: 'offlineFirst',
});
```

- 服务端给 `Cache-Control: immutable` 且响应体带 `version`（决策 §11），HTTP 层已经不会重复请求。
- 额外持久化一份到 `localStorage['wallet:categories']`，形如 `{version, expense, income}`；启动时先用它 `setQueryData` 把界面点亮，再后台请求；**返回的 `version` 与本地不同就整体替换并写回**。这样离线打开也能显示分类名。
- 分类名与一级分类的说明文字**都不进语言包**（§5.3）：接口给 `name_zh` / `name_en` 和 `desc_zh` / `desc_en`，界面按当前语言取（决策 §14.21）。
- 用它派生三个查找表：`byL1: Record<code, Category>`、`l2Of(l1): Category[]`、`kindAllows(kind): Category[]`（`expense`/`refund` → 支出树，`income` → 收入树，`transfer` → 空，决策 §1.3）。

### 2.4 QueryClient 默认值

相对现状（`frontend/src/utils/queryClient.ts:6-19`）的改动只有一处，但很关键：

| 选项 | 现状 | 目标 | 理由 |
|---|---|---|---|
| `queries.retry` | `1` | `(count, err) => count < 2 && !isClientError(err)` | 4xx 不重试（重试一个 409 或 422 没有意义，还会放大限流） |
| `queries.staleTime` | 5 分钟 | 30 秒（默认）；分类 `Infinity`；币种列表 24 小时 | 多人共用一本账（决策 §2），5 分钟太久 |
| `queries.gcTime` | 10 分钟 | 10 分钟 | 不变 |
| **`queries.refetchOnWindowFocus`** | **`false`** | **`true`** | 决策 §2「列表在窗口重新聚焦时自动刷新」。这是不做实时同步之后唯一的兜底手段：另一个成员改了账，你切回标签页就看到 |
| `queries.refetchOnReconnect` | `true` | `true` | 不变 |
| `mutations.retry` | `0` | `0` | 写操作绝不自动重试 |

`refetchOnWindowFocus: true` 的两处例外，在具体 query 上关掉：**导入 review 的草稿行**（正在编辑的表格被后台刷新会打断输入）和**任何正在编辑的表单所依赖的详情**。另外三个 `staleTime: Infinity` 的全局 query（`categories`、`import-format`、`config`）也不需要聚焦刷新。

全局 `QueryCache.onError` 负责三件事：401 → `onUnauthorized()`（§2.1）；账本详情 query（`l/{id}/detail`）拿到 404 `not_found` → §1.5 第 4 条；其余 → 交给页面。`MutationCache.onError` 统一处理 409 `stale_update`（§3.6）与 Toast（§3.7）。

---

## 3. API 客户端层

### 3.1 目录

```
frontend/src/api/
  client.ts          axios 实例、拦截器、错误归一化、上传专用实例
  types.ts           全部 TypeScript 类型（本节 §3.3）
  auth.ts            注册 / 登录
  me.ts              GET/PATCH /me
  config.ts          GET /config（匿名，决策 §14.46）
  categories.ts      GET /categories
  importFormat.ts    GET /import-format（导入指南页的全部内容，决策 §6）
  ledgers.ts         /ledgers*（含成员、邀请与作废、加入、转让、退出）
  sources.ts         /ledgers/{id}/sources*
  transactions.ts    /ledgers/{id}/transactions*（含 transfer 两腿、pair / unpair）
  stats.ts           /ledgers/{id}/stats/*
  imports.ts         /ledgers/{id}/imports*（上传 / 粘贴 / 草稿行 / 批量改 / 提交 / 撤销）
  rates.ts           /rates/currencies
frontend/src/queries/
  keys.ts            query key 工厂（§3.4）
  invalidate.ts      失效矩阵的实现（§3.5）
  useXxx.ts          每个资源一组 hooks
```

`api/` 只管「发请求 + 类型」，不 import TanStack Query；`queries/` 只管缓存语义。页面只 import `queries/`。这条分层让 API 层可以被纯函数测试（§8.2）。

### 3.2 axios 实例

```ts
export const apiClient = axios.create({
  baseURL: API_BASE_URL,            // 生产 '/api/v1'，开发 'http://localhost:8000/api/v1'
  timeout: 15_000,                  // 现状 10s（client.ts:8-14）；统计与导入提交更慢，放宽
  headers: { 'Content-Type': 'application/json' },
});

// 上传单独一个实例：不设 Content-Type（交给 FormData 的 boundary）。
// 校验是同步的（决策 §5），2 MB 的 CSV 走完校验通常 1–3 秒，60s 足够；没有后台解析要等。
export const uploadClient = axios.create({ baseURL: API_BASE_URL, timeout: 60_000 });
```

两个实例共享同一对拦截器：请求拦截器读令牌注入 `Authorization: Bearer <token>`（同 `frontend/src/api/client.ts:19-34`）；响应拦截器做 §3.5 的归一化。

### 3.3 类型定义

字段名与 [`./03-backend-api.md`](./03-backend-api.md) §5 的**实际响应体逐字一致**，底层列名来自决策 §1/§2/§3/§5/§10/§14。`Decimal` 一律走 JSON 字符串（现状就是这样，见现状文档 §4.6 的响应示例），前端只在显示前 `Number()`，绝不用浮点数做累加。

三条贯穿全表的约定：**所有列表端点都返回 `{items, total}` 信封**（[`./03-backend-api.md`](./03-backend-api.md) §4.3），所以列表类函数的返回类型一律是 `Paged<T>`，没有裸数组（交易列表多一个 `summary`，决策 §14.52 A14）；**所有 PATCH 请求体都必须带 `updated_at`**（§4.4 的乐观并发）；**折算三件套统一叫 `amount_base` / `rate_used` / `rate_date`**，取不到汇率时三者同时为 `null`。

**没有任何与大模型有关的类型**（决策 §5、§6、§14.25）：应用不接入大模型，模型设置在服务端就不存在，前端自然也没有承载它的类型，`User` 上也没有与之相关的标志位。导入的类型按同步校验模型重写：没有进度字段、没有整页图列表与页号、没有置信度、没有视觉路径标志位、没有分块错误列，状态只剩 `ready` / `committed`（决策 §5、§14.25）。

```ts
// ---------- 通用 ----------
export type Uuid = string;
export type IsoDate = string;      // 'YYYY-MM-DD'（无时区日历日，决策 §14.32）
export type IsoDateTime = string;  // '2026-09-01T12:00:00.000000Z'（UTC，带 Z，03 §4.5）
export type Money = string;        // Decimal 的 JSON 形态，如 '-42.5000'
export interface Paged<T> { items: T[]; total: number; }
export interface ApiError { detail: string; code: string; }   // 决策 §9

// ---------- 配置（决策 §14.46）----------
// GET /config：匿名可读，注册页启动时就要知道能不能注册
export interface AppConfig { registration_open: boolean; }

// ---------- 我 ----------
// GET /me
export interface User {
  id: Uuid; email: string;
  display_name: string | null;     // ≤40 字；为空时界面显示邮箱 @ 前的部分（决策 §14.6、§14.40）
  base_currency: string;           // 新建账本的默认币种（决策 §2）
  language: 'zh' | 'en' | null;    // null = 跟随系统（决策 §14.6）
  created_at: IsoDateTime;
  ledger_count: number;            // 引导用便利字段
}
// PATCH /me：三个字段都可选；display_name 与 language 允许显式 null（= 清空 / 跟随系统）
export interface UserUpdate {
  display_name?: string | null;
  base_currency?: string;
  language?: 'zh' | 'en' | null;
}
export interface LoginRequest { email: string; password: string; }
// POST /auth/register
export interface RegisterRequest {
  email: string; password: string; base_currency: string; language?: 'zh' | 'en';
}
export interface AuthResponse { access_token: string; token_type: 'bearer'; }

// ---------- 分类（决策 §1.3）----------
// GET /categories：children 永远是数组，没有二级时是空数组
// desc_zh / desc_en 只有一级非空，二级恒为 null（决策 §14.21）
export interface Category {
  code: string; name_zh: string; name_en: string;
  desc_zh: string | null; desc_en: string | null;
  children: Category[];
}
export interface CategoryTree { version: string; expense: Category[]; income: Category[]; }

// ---------- 账本（决策 §2）----------
export interface Ledger {
  id: Uuid; name: string; base_currency: string;
  created_by: Uuid; created_at: IsoDateTime; updated_at: IsoDateTime;
  role: 'owner' | 'member';    // 当前用户在这本账里的角色
  member_count: number;
}
// GET /ledgers/{id} 比列表多一组计数，删除账本的确认框要显示它（决策 §14.52 A22）
export interface LedgerDetail extends Ledger {
  counts: { transactions: number; sources: number; import_batches: number };
}
export interface LedgerCreate { name: string; base_currency?: string; }
export interface LedgerUpdate { name?: string; base_currency?: string; updated_at: IsoDateTime; }
export interface LedgerMember {
  user_id: Uuid; email: string;
  display_name: string | null;                 // 决策 §14.40 的 01-7：显示它，为空回退邮箱前缀
  role: 'owner' | 'member'; joined_at: IsoDateTime;
  is_me: boolean;
}
// POST /ledgers/{id}/invites：code 只在这一次响应里出现；10 分钟后过期，用掉即删（决策 §2、§14.29）
export interface LedgerInvite {
  id: Uuid; code: string; ledger_id: Uuid; ledger_name: string;
  expires_at: IsoDateTime; created_at: IsoDateTime;
}
export interface JoinLedgerRequest { code: string; }
export interface TransferOwnershipRequest { to_user_id: Uuid; }

// ---------- 资金账户（决策 §3、§14.48、§14.50）----------
// 四种类型，没有 savings（新加坡没有这个区分，「储蓄」就是 checking，决策 §14.48）
export type SourceType = 'checking' | 'credit' | 'cash' | 'other';
export interface FinanceSource {
  id: Uuid; ledger_id: Uuid; name: string; type: SourceType;
  default_currency: string;          // 创建后不可改（决策 §14.50）
  opening_balance: Money;            // 信用卡填欠款，存为负数（决策 §14.52 A13）
  archived: boolean;
  archived_at: IsoDateTime | null;   // 决策 §14.50；归档账户不计入净资产
  created_by: Uuid; updated_by: Uuid | null;
  created_at: IsoDateTime; updated_at: IsoDateTime;
  // 余额四件套（口径见决策 §14.2）：
  balance: Money;                    // 以账户 default_currency 计价；异币种交易按发生日汇率折进来
  balance_base: Money | null;        // 按最新汇率折到账本 base_currency
  balance_rate: Money | null;        // 这次用的汇率，8 位小数
  balance_rate_date: IsoDate | null; // 该汇率的行情日
}
export interface FinanceSourceCreate {
  name: string; type: SourceType; default_currency: string; opening_balance?: Money;
}
// default_currency 不在可改字段里（决策 §14.50）
export interface FinanceSourceUpdate {
  name?: string; type?: SourceType; opening_balance?: Money; archived?: boolean;
  updated_at: IsoDateTime;      // 乐观并发（决策 §2）
}

// ---------- 交易（决策 §1、§10）----------
export type TxKind = 'expense' | 'income' | 'refund' | 'transfer';
export type TransferRole = 'out' | 'in';
export type TransferSubtype = 'plain' | 'repayment';

export interface Transaction {
  id: Uuid; ledger_id: Uuid; source_id: Uuid;
  kind: TxKind;
  amount: Money;                 // expense/transfer-out 为负；income/refund/transfer-in 为正
  currency: string; occurred_at: IsoDate;
  note: string | null;           // 现状的 description 改名（决策 §1.4）
  merchant: string | null;       // 转账行恒为 null（决策 §14.52 B16）
  category_l1: string | null;    // transfer 必为 null；其余必填
  category_l2: string | null;
  transfer_role: TransferRole | null;
  transfer_subtype: TransferSubtype | null;
  transfer_pair_id: Uuid | null; // 两腿共用；单腿为 null
  counterparty: string | null;   // 单腿转账的对方文本
  refund_of: Uuid | null;        // kind==='refund' 时可指向原支出
  import_batch_id: Uuid | null;
  created_by: Uuid; updated_by: Uuid | null;
  created_at: IsoDateTime; updated_at: IsoDateTime;
  // 折算三件套：按 occurred_at 当天（或回退后的最近行情日）汇率折到账本基准币种；
  // 取不到汇率时三者同时为 null。详情页把 rate_used / rate_date 显示出来（决策 §14.52 A24）。
  amount_base: Money | null;
  rate_used: Money | null;
  rate_date: IsoDate | null;
  // 只在 kind === 'expense' 的行上出现：
  refunded_total?: Money;        // 指向该行的所有 refund 的 amount 之和（正数）
  refundable?: Money;            // |amount| - refunded_total，可以为负（允许超额退款，决策 §1.1）
  // 只在 GET /transactions/{tid} 上出现的三组扩展（决策 §14.46、§14.51）：
  pair?: TransactionPairRef | null;   // 两腿转账时的对腿引用；非转账 / 单腿为 null
  refunds?: RefundRef[];              // kind==='expense'：指向它的每一笔退款
  refund_of_detail?: RefundOrigin | null; // kind==='refund'：refund_of 展开的原单摘要
  events?: TransactionEvent[];        // 操作记录，按时间倒序（决策 §14.51）
}

// 详情里那个精简的对腿引用：out/in 各只有四个字段，键名是 transaction_id 而不是 id。
// 不要和 §5.33/§5.34 响应的 TransferPair 混用（那个带完整的两条 Transaction）。
export interface TransactionPairRef {
  pair_id: Uuid;
  out: { transaction_id: Uuid; source_id: Uuid; amount: Money; currency: string };
  in:  { transaction_id: Uuid; source_id: Uuid; amount: Money; currency: string };
}
// 一笔退款的摘要；字段逐条对齐 03 §5.27 里 refund_of_detail.other_refunds[] 的元素（决策 §14.53f）
export interface RefundBrief {
  id: Uuid; occurred_at: IsoDate; amount: Money; currency: string; note: string | null;
}
// 支出详情上的退款列表（决策 §14.46 的 04-D-6）；字段逐条对齐 03 §5.27 的 refunds[]（决策 §14.53f）
// 比 RefundBrief 多一个 source_id：03 只在 refunds[] 的元素上给了退回账户
export interface RefundRef extends RefundBrief {
  source_id: Uuid;                     // 退回账户——画这一行时要显示账户名（决策 §14.53f）
}
// 退款详情上的原单摘要（决策 §14.46 的 04-D-6、§14.52 A25），逐字段同 03 §5.27 的 refund_of_detail
export interface RefundOrigin {
  id: Uuid; occurred_at: IsoDate; merchant: string | null;
  amount: Money; currency: string;
  source_id: Uuid;                     // 原单记在哪个账户上（决策 §14.53f）
  category_l1: string | null;          // 原单的分类，登记退款时沿用（决策 §14.53f）
  category_l2: string | null;
  refunded_total: Money; refundable: Money;
  other_refunds: RefundBrief[];        // 指向**同一张原单**的其它退款，不含当前这条，按日期升序
                                       // （决策 §14.52 A25）；只被退过这一次时是空数组。03 §5.27 的这些
                                       // 元素**没有** source_id，所以这里用窄类型，界面上不显示退回账户
}
// 操作记录（决策 §14.51）：只追加不修改，交易删除时级联删除
export type TransactionEventType =
  | 'created' | 'updated' | 'imported' | 'paired' | 'unpaired'
  | 'refund_linked' | 'refund_unlinked';
export interface TransactionEvent {
  id: Uuid; transaction_id: Uuid;
  actor_id: Uuid; at: IsoDateTime;
  event: TransactionEventType;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  import_batch_id: Uuid | null;
  client: string | null;       // 来自请求头 X-Client；本版本恒为 'web'
}

export interface TransactionCreate {
  source_id: Uuid; kind: TxKind;
  amount: Money; currency: string; occurred_at: IsoDate;   // amount 带符号，字符串形态
  note?: string | null; merchant?: string | null;
  category_l1?: string | null; category_l2?: string | null;
  refund_of?: Uuid | null;
  transfer_role?: TransferRole; transfer_subtype?: TransferSubtype; counterparty?: string | null;
}
export interface TransactionUpdate extends Partial<TransactionCreate> {
  updated_at: IsoDateTime;       // 必填：乐观并发
}

// 两腿转账（决策 §1.2）：一次请求建两条。请求体是**扁平**的，不是嵌套的 out/in。
export interface TransferCreate {
  from_source_id: Uuid; to_source_id: Uuid;   // 必须不同，否则 400 same_source
  amount_out: Money;  currency_out: string;   // amount_out 传正数，服务端存成负数
  amount_in: Money;   currency_in: string;    // 不要求等于 amount_out（跨币种）
  occurred_at: IsoDate;
  subtype: TransferSubtype;                   // 字段名是 subtype，不是 transfer_subtype
  note?: string | null;                       // 没有 merchant、没有 counterparty
}
export interface TransferUpdate extends Partial<TransferCreate> {
  updated_at: IsoDateTime;       // 两腿 updated_at 中较大的那个
}
export interface TransferPair {
  pair_id: Uuid;
  occurred_at: IsoDate; subtype: TransferSubtype; note: string | null;
  out: Transaction; in: Transaction;
  updated_at?: IsoDateTime;
}
// 配对 / 拆开（决策 §14.34）
// POST /ledgers/{id}/transactions/{tid}/pair：把两条单腿转账合成一笔
export interface TransactionPairRequest { counterpart_transaction_id: Uuid; }
// 响应是合成后的 TransferPair；unpair 无请求体，响应是拆开后的两条 Transaction
export interface UnpairResult { out: Transaction; in: Transaction; }

export interface TransactionListParams {
  q?: string; kind?: TxKind[]; category_l1?: string; category_l2?: string;
  source_id?: Uuid[]; from?: IsoDate; to?: IsoDate; currency?: string;
  min_amount?: number; max_amount?: number;   // 按基准币种折算后的绝对值比较（决策 §14.49）
  import_batch_id?: Uuid;                     // 决策 §14.46 的 04-D-7
  limit?: number; offset?: number;            // limit 上限 200（决策 §14.44 的 03-14）
}
// 交易列表：信封外多一个 summary（决策 §14.52 A14），底部汇总条与「筛空提示」都用它
// （同步 2026-09-12）字段名与 03 §5.25 的 summary 一致：base_currency / expense / income / net / count / rate_missing_count
export interface TransactionSummary {
  base_currency: string;
  expense: Money;         // 正数
  income: Money;
  net: Money;             // income − expense，**不含转账**
  count: number;          // 给了金额区间时只计能折算的行；没给区间时含全部命中行（与 total 相同）
  rate_missing_count: number;
}
export interface TransactionListResponse extends Paged<Transaction> {
  summary: TransactionSummary;
}

// 退款关联选择器用（决策 §1.1、§14.11：不另设候选接口，复用交易列表）
export interface RefundCandidate extends Transaction {
  refunded_total: Money;
  refundable: Money;
}

// ---------- 统计（决策 §7）----------
export interface StatsCategoryChild {
  code: string | null;           // null = 「有一级没二级」的部分
  name_zh: string; name_en: string;
  amount: Money; count: number;
}
export interface StatsCategoryNode {
  code: string; name_zh: string; name_en: string;
  amount: Money;                 // 正数；退款已冲减，可能为负（决策 §14.44 的 03-10）
  share: number;                 // ∈ [0,1]，4 位小数；total 为 0 时全是 0
  count: number;
  children: StatsCategoryChild[];
}
export interface StatsSummary {
  month: string;                 // 'YYYY-MM'
  base_currency: string;
  expense_total: Money;          // 已按退款冲减
  income_total: Money;
  net: Money;
  expense: StatsCategoryNode[];  // 按 amount 降序，金额为 0 的分类不出现
  income: StatsCategoryNode[];
  refund_total: Money;           // 当月退款总额（正数），用于「其中已冲减退款 ¥82.98」
  rate_missing_count: number;    // 因取不到汇率被跳过的行数，> 0 时提示「部分交易未计入」
}
// 首页趋势**只画支出**（决策 §7、§14.52 B20）：即使响应里还有别的字段也不渲染
export interface StatsTrend {
  base_currency: string;
  months: Array<{ month: string; expense: Money }>;  // 升序，空月补 0
  rate_missing_count: number;
}

// ---------- 导入（决策 §5、§6、§14.47）----------
// GET /import-format（公开）：导入指南页的全部内容都来自它，前端不硬编码 skill 文本与列名
export interface ImportFormat {
  version: string;                 // 分类表版本，日期串如 '2026-09-10'（决策 §14.30）
  headers: string[];               // 固定 11 列，顺序即文件里的顺序
  columns: Array<{ name: string; required: boolean; desc_zh: string; desc_en: string }>;
  sample_csv: string;              // 示例文件的完整文本（含 '# version:' 首行）
  skill_text: string;              // ChatGPT 用的指令文本
  skill_markdown: string;          // Claude 用的 SKILL.md 全文
  instructions_zh: string; instructions_en: string;   // 三步说明
}

// 状态只有两个（决策 §5）：校验通过即 ready；提交后 committed。没有 parsing / failed / reverted。
export type ImportStatus = 'ready' | 'committed';
export type ImportRowStatus = 'pending' | 'edited' | 'skipped';
// 标记只有四种（决策 §5、§14.31、§14.34）：旧的 repayment 改名为 transfer_candidate，「已合并」整条取消
export type ImportFlag = 'duplicate' | 'refund_candidate' | 'transfer_candidate' | 'needs_review';

// 批次的字段名以 [`./02-database.md`](./02-database.md) §1.7 的 DDL 为准，
// 03 §5.38 的响应用的是同一套名字（决策 §14.53e）：source / filename / size_bytes /
// skill_version / row_count / committed_at。
export interface ImportBatch {
  id: Uuid; ledger_id: Uuid; source_id: Uuid; source_name: string;
  source: 'csv' | 'paste';         // 上传文件还是粘贴文本；只有这两个值（决策 §5、§14.47）
  filename: string | null;         // 只记名字与大小，**不保存文件**（决策 §14.28）；粘贴批次为 null
  size_bytes: number;              // 文件或粘贴文本的 UTF-8 字节数
  skill_version: string;           // 文件里那一行 '# version:'
  status: ImportStatus;
  row_count: number;
  net_amount: Money;               // 这批交易金额之和，按账本基准币种（决策 §14.52 A17）
  base_currency: string;           // net_amount 所用的币种 = 账本基准币种
  flags_summary: Record<ImportFlag, number>;
  row_status_summary: Record<ImportRowStatus, number>;
  uncategorized_count: number;     // 还差几行没补一级分类（提交阻断条件，§4.11.8）
  created_by: Uuid;                // 只回 UUID；上传人的名字由前端用成员列表映射（决策 §14.43 的 03-4）
  created_at: IsoDateTime; updated_at: IsoDateTime;
  committed_at: IsoDateTime | null;
}
// 列表项与详情**同形状**（03 §5.38：净额、标记数、目标账户名、上传人在列表里就有，
// 前端不用为列表再查一遍详情）
export type ImportBatchListItem = ImportBatch;
// POST /ledgers/{id}/imports 的成功响应：批次 + 全部草稿行，一次给完（同步校验，决策 §5）
export interface ImportUploadResult { batch: ImportBatch; rows: ImportRow[]; }
// 400 结构错误 / skill_outdated 的响应体：不建批次（决策 §5）。
// 四个扩展字段逐字段照抄 03 §5.37 的响应体（决策 §14.53f），不另起名字。
export interface ImportFileError extends ApiError {
  errors?: Array<{ line: number; message: string }>;   // import_format_invalid 时给；
                                                       // line 是**文件里的物理行号**（1 起：
                                                       // '# version:' 是第 1 行、表头是第 2 行）
  current_version?: string;                            // skill_outdated：应用当前的分类表版本
  file_version?: string | null;                        // skill_outdated：文件首行声明的版本
  guide_url?: string;                                  // skill_outdated：导入指南页链接，渲染成按钮
}

// 草稿行；行号列名是 row_no（决策 §14.5），日期字段在接口上仍叫 date（决策 §14.41 的 02-D-3）
export interface ImportRow {
  id: Uuid; batch_id: Uuid; row_no: number; status: ImportRowStatus;
  date: IsoDate | null; amount: Money | null; currency: string | null;
  kind: TxKind | null; merchant: string | null; note: string | null;
  category_l1: string | null; category_l2: string | null;
  source_ref: string | null;                // skill 写的「原文哪一行」，只读
  flags: ImportFlag[];
  matched_transaction_id: Uuid | null;      // refund_candidate 的原支出 / transfer_candidate 的对腿。
                                            // 转账配对的**唯一载体**（决策 §14.53b）：非空 = 勾上
                                            // 「关联为一笔转账」，取消勾选就 PATCH 成 null。
                                            // 配对状态**只有这一列**：多候选时它是 null，候选列表不落库
  counterpart_source_id: Uuid | null;       // 转账行的对手账户（不合并、按两腿建时用）；
                                            // 服务端不猜，找不到对腿时留空由用户选（决策 §14.53c）
  counterparty: string | null;              // 单腿转账的对手文本；校验阶段恒为 null，
                                            // 只有 review 里 PATCH 才有值（决策 §14.10、§14.16）
  transfer_role: TransferRole | null;
  transfer_subtype: TransferSubtype | null;
  hint: string | null;                      // 服务端给 review 的只读提示，不可改、不进 note
  transaction_id: Uuid | null;              // 提交后回填
}
export interface ImportRowListParams {
  status?: ImportRowStatus[]; flag?: ImportFlag[]; uncategorized?: boolean;
  limit?: number;   // 上限 500（决策 §14.44 的 03-14）
  offset?: number;
}
export type ImportRowPatch = Partial<Pick<ImportRow,
  'status' | 'date' | 'amount' | 'currency' | 'kind' | 'merchant' | 'note' |
  'category_l1' | 'category_l2' | 'matched_transaction_id' |
  'counterpart_source_id' | 'counterparty' | 'transfer_role' | 'transfer_subtype'>>;
// 注意 hint / flags / source_ref / row_no 不在可改字段里
// PATCH .../imports/{bid}/rows（批量，决策 §14.52 A4）。
// **要么全成要么全不成**（03 §5.42）：整批在一个事务里跑，任何一行校验不过就 400 并全部回滚，
// 没有「部分成功」这种响应，因此响应里也没有「被跳过的行」这一项。
export interface ImportRowsBulkPatch { row_ids: Uuid[]; patch: ImportRowPatch; }
export interface ImportRowsBulkResult {
  updated: number;              // 改掉的行数
  rows: ImportRow[];            // 这些行改完之后的完整形态，字段同 ImportRow
}
// POST .../imports/{bid}/commit（无请求体，决策 §14.18）
export interface ImportCommitResult {
  batch_id: Uuid; status: 'committed';
  created_transactions: number;        // 这一批建出来的交易条数
  created_transfer_pairs: number;      // 由 counterpart_source_id 两腿一起建出来的转账对数
  paired_existing_transfers: number;   // 与库里已有的单腿转账配对成功的行数（决策 §14.34）
  linked_refunds: number;              // 写进 refund_of 的退款行数（决策 §14.7）
  skipped_rows: number;
  committed_at: IsoDateTime;
}
// DELETE .../imports/{bid}：带 ?dry_run=true 先问要删多少，再真删（决策 §14.43、§14.52 B24）
export interface ImportDeleteResult {
  batch_id: Uuid;
  mode: 'discard' | 'revert';          // ready = 丢弃草稿；committed = 撤销并删交易
  deleted: boolean;
  would_delete_transactions?: number;  // dry_run=true 时给
  deleted_transactions?: number;       // 真删时给
  orphaned_refunds: number;            // **批外**退款将失去原单（决策 §14.43 的 03-9）
  refunds_in_batch: number;            // **批内**退款被删后，其原支出恢复可退额度（决策 §14.52 B24）
}

// ---------- 汇率 ----------
export interface CurrencyList { currencies: Record<string, string>; }
```

### 3.4 函数清单（与决策 §11 逐条对应）

签名与 [`./03-backend-api.md`](./03-backend-api.md) §5 的每个端点一一对应：凡是后端返回 `{items, total}` 的（`/ledgers`、`/members`、`/sources`、`/transactions`、`/imports`、`/rows`）客户端一律给 `Promise<Paged<T>>`，**不解开信封**——`total` 是分页条和「共 N 条」要用的。

| 决策 §11 端点 | 客户端函数（TypeScript 签名） |
|---|---|
| `POST /auth/register` | `authApi.register(b: RegisterRequest): Promise<AuthResponse>` |
| `POST /auth/login` | `authApi.login(b: LoginRequest): Promise<AuthResponse>` |
| `GET /config` | `configApi.get(): Promise<AppConfig>`（匿名可读，注册页启动时调，决策 §14.46） |
| `GET /me` | `meApi.get(): Promise<User>` |
| `PATCH /me` | `meApi.update(b: UserUpdate): Promise<User>`（`display_name` / `base_currency` / `language`） |
| `GET /categories` | `categoriesApi.get(): Promise<CategoryTree>` |
| `GET /import-format` | `importFormatApi.get(): Promise<ImportFormat>`（公开；导入指南页的全部内容，决策 §6、§11） |
| `GET /ledgers` | `ledgersApi.list(): Promise<Paged<Ledger>>` |
| `POST /ledgers` | `ledgersApi.create(b: LedgerCreate): Promise<Ledger>` |
| `GET /ledgers/{id}` | `ledgersApi.get(id: Uuid): Promise<LedgerDetail>`（带 `counts`，删除确认框用，决策 §14.52 A22） |
| `PATCH /ledgers/{id}` | `ledgersApi.update(id: Uuid, b: LedgerUpdate): Promise<Ledger>` |
| `DELETE /ledgers/{id}` | `ledgersApi.remove(id: Uuid): Promise<void>` |
| `GET /ledgers/{id}/members` | `ledgersApi.members(id: Uuid): Promise<Paged<LedgerMember>>` |
| `DELETE /ledgers/{id}/members/{user_id}` | `ledgersApi.removeMember(id: Uuid, userId: Uuid): Promise<void>` |
| `POST /ledgers/{id}/leave` | `ledgersApi.leave(id: Uuid): Promise<void>` |
| `POST /ledgers/{id}/transfer-ownership` | `ledgersApi.transferOwnership(id: Uuid, b: TransferOwnershipRequest): Promise<Paged<LedgerMember>>`（响应是刷新后的成员列表） |
| `POST /ledgers/{id}/invites` | `ledgersApi.createInvite(id: Uuid): Promise<LedgerInvite>` |
| `DELETE /ledgers/{id}/invites/{code}` | `ledgersApi.revokeInvite(id: Uuid, code: string): Promise<void>`（主动作废未过期的码，决策 §14.52 A2） |
| `POST /ledgers/join` | `ledgersApi.join(b: JoinLedgerRequest): Promise<Ledger>` |
| `GET /ledgers/{id}/sources` | `sourcesApi.list(l: Uuid, p?: { include_archived?: boolean }): Promise<Paged<FinanceSource>>` |
| `POST /ledgers/{id}/sources` | `sourcesApi.create(l: Uuid, b: FinanceSourceCreate): Promise<FinanceSource>` |
| `GET /ledgers/{id}/sources/{sid}` | `sourcesApi.get(l: Uuid, sid: Uuid): Promise<FinanceSource>` |
| `PATCH /ledgers/{id}/sources/{sid}` | `sourcesApi.update(l: Uuid, sid: Uuid, b: FinanceSourceUpdate): Promise<FinanceSource>` |
| `DELETE /ledgers/{id}/sources/{sid}` | `sourcesApi.remove(l: Uuid, sid: Uuid): Promise<void>` |
| `GET /ledgers/{id}/transactions` | `txApi.list(l: Uuid, p: TransactionListParams): Promise<TransactionListResponse>`（信封外带 `summary`，决策 §14.52 A14） |
| `POST /ledgers/{id}/transactions` | `txApi.create(l: Uuid, b: TransactionCreate): Promise<Transaction>` |
| `GET /ledgers/{id}/transactions/{tid}` | `txApi.get(l: Uuid, tid: Uuid): Promise<Transaction>`（详情多出 `pair` / `refunds` / `refund_of_detail` / `events`） |
| `PATCH /ledgers/{id}/transactions/{tid}` | `txApi.update(l: Uuid, tid: Uuid, b: TransactionUpdate): Promise<Transaction>` |
| `DELETE /ledgers/{id}/transactions/{tid}` | `txApi.remove(l: Uuid, tid: Uuid): Promise<void>` |
| `POST /ledgers/{id}/transactions/transfer` | `txApi.createTransfer(l: Uuid, b: TransferCreate): Promise<TransferPair>` |
| `PATCH /ledgers/{id}/transactions/transfer/{pair_id}` | `txApi.updateTransfer(l: Uuid, pairId: Uuid, b: TransferUpdate): Promise<TransferPair>` |
| `DELETE /ledgers/{id}/transactions/transfer/{pair_id}` | `txApi.removeTransfer(l: Uuid, pairId: Uuid): Promise<void>` |
| `POST /ledgers/{id}/transactions/{tid}/pair` | `txApi.pair(l: Uuid, tid: Uuid, b: TransactionPairRequest): Promise<TransferPair>`（把两条单腿转账合成一笔，决策 §14.34） |
| `POST /ledgers/{id}/transactions/transfer/{pair_id}/unpair` | `txApi.unpair(l: Uuid, pairId: Uuid): Promise<UnpairResult>`（拆开，两腿各自变回单腿，决策 §14.34） |
| `GET /ledgers/{id}/stats/summary?month=` | `statsApi.summary(l: Uuid, p: { month: string }): Promise<StatsSummary>` |
| `GET /ledgers/{id}/stats/trend?months=` | `statsApi.trend(l: Uuid, p: { months: number; end?: string }): Promise<StatsTrend>` |
| `POST /ledgers/{id}/imports`（multipart CSV） | `importsApi.upload(l: Uuid, b: { source_id: Uuid; file: File \| Blob }, onProgress?): Promise<ImportUploadResult>`（**同步校验**：201 就直接带回批次与全部草稿行） |
| `POST /ledgers/{id}/imports`（JSON 粘贴） | `importsApi.uploadText(l: Uuid, b: { source_id: Uuid; text: string }): Promise<ImportUploadResult>`（与上传走同一套校验，决策 §5、§14.47） |
| `GET /ledgers/{id}/imports` | `importsApi.list(l: Uuid, p?: { status?: ImportStatus[]; limit?: number; offset?: number }): Promise<Paged<ImportBatchListItem>>` |
| `GET /ledgers/{id}/imports/{bid}` | `importsApi.get(l: Uuid, bid: Uuid): Promise<ImportBatch>` |
| `GET /ledgers/{id}/imports/{bid}/rows` | `importsApi.rows(l: Uuid, bid: Uuid, p?: ImportRowListParams): Promise<Paged<ImportRow>>` |
| `PATCH /ledgers/{id}/imports/{bid}/rows/{rid}` | `importsApi.patchRow(l: Uuid, bid: Uuid, rid: Uuid, b: ImportRowPatch): Promise<ImportRow>` |
| `PATCH /ledgers/{id}/imports/{bid}/rows` | `importsApi.patchRows(l: Uuid, bid: Uuid, b: ImportRowsBulkPatch): Promise<ImportRowsBulkResult>`（批量设分类 / 批量跳过，决策 §14.52 A4） |
| `POST /ledgers/{id}/imports/{bid}/commit` | `importsApi.commit(l: Uuid, bid: Uuid): Promise<ImportCommitResult>`（无请求体，决策 §14.18） |
| `DELETE /ledgers/{id}/imports/{bid}` | `importsApi.remove(l: Uuid, bid: Uuid, p?: { dry_run?: boolean }): Promise<ImportDeleteResult>`（ready = 丢弃；committed = 撤销；先 `dry_run` 拿 `orphaned_refunds` / `refunds_in_batch` 两个数再确认） |
| `GET /rates/currencies` | `ratesApi.currencies(): Promise<CurrencyList>` |

**没有的函数**（决策 §5、§6、§14.25、§14.42）：`/me` 之下任何模型设置端点（整个取消）、`POST .../imports/{bid}/retry`（校验是同步的，失败就没有批次可重试）、任何取整页图的端点（应用拿不到原始账单，没有缩略图）、`/auth/me`（`/me` 是唯一入口，不留过渡别名）。

退款候选选择器复用 `txApi.list`（决策 §14.11 明确**不另设**退款候选接口）：`refunded_total` / `refundable` 是交易列表在 `kind='expense'` 行上默认返回的可选字段，选择器只是把它们当必填用（`RefundCandidate`），因此 `TransactionListParams` 里没有额外的开关参数。

### 3.5 Query key 规范

两个命名空间。**账本作用域的 key 一律以 `['l', ledgerId, ...]` 开头**——这样 `queryClient.removeQueries({ queryKey: ['l', ledgerId] })` 一次就能清干净一个账本（切换账本、被移出账本、登出时用）。

```ts
export const qk = {
  global: {
    me:           () => ['global', 'me'] as const,
    config:       () => ['global', 'config'] as const,          // GET /config（决策 §14.46）
    categories:   () => ['global', 'categories'] as const,
    importFormat: () => ['global', 'import-format'] as const,   // GET /import-format（决策 §6）
    currencies:   () => ['global', 'currencies'] as const,
    ledgers:      () => ['global', 'ledgers'] as const,
  },
  ledger: (l: string) => ({
    root:      () => ['l', l] as const,
    detail:    () => ['l', l, 'detail'] as const,
    members:   () => ['l', l, 'members'] as const,
    sources:   (p?: { include_archived?: boolean }) => ['l', l, 'sources', p ?? {}] as const,
    source:    (sid: string) => ['l', l, 'sources', 'detail', sid] as const,
    txList:    (p: TransactionListParams) => ['l', l, 'tx', 'list', normalize(p)] as const,
    tx:        (tid: string) => ['l', l, 'tx', 'detail', tid] as const,
    transfer:  (pid: string) => ['l', l, 'tx', 'transfer', pid] as const,
    statsSum:  (month: string) => ['l', l, 'stats', 'summary', month] as const,
    statsTrend:(months: number) => ['l', l, 'stats', 'trend', months] as const,
    imports:   () => ['l', l, 'imports', 'list'] as const,
    importB:   (bid: string) => ['l', l, 'imports', 'detail', bid] as const,
    importRows:(bid: string) => ['l', l, 'imports', 'rows', bid] as const,
  }),
};
```

`normalize(p)`：删掉 `undefined` / 空字符串 / 空数组，数组排序，键按字典序——保证「同一筛选状态 = 同一 key」，与 §1.3 的 URL 规范互为镜像。

`global.config`、`global.categories`、`global.importFormat` 三个的 `staleTime` 都是 `Infinity`（前两个按 `version` 换、`config` 只在启动读一次）。

### 3.6 失效矩阵

每一次 mutation 成功后要失效哪些 key。`invalidate` = 标记过期并在活跃时重取；`remove` = 直接从缓存删除。

| Mutation | 失效（invalidate） | 备注 |
|---|---|---|
| `ledgersApi.create` | `global.ledgers` | 成功后跳新账本首页 |
| `ledgersApi.update` | `global.ledgers`、`l/{id}/detail` | 改基准币种时**额外** invalidate `l/{id}` 整棵（统计、余额、折算全变） |
| `ledgersApi.remove` | `global.ledgers`；`removeQueries(['l', id])` | 跳 `/ledgers` |
| `ledgersApi.join` | `global.ledgers` | 跳新账本首页 |
| `ledgersApi.createInvite` / `revokeInvite` | 无（结果直接展示；作废后本地清掉那张码卡） | 邀请码不进缓存 |
| `ledgersApi.removeMember` / `transferOwnership` | `l/{id}/members`、`l/{id}/detail`、`global.ledgers`（`role` 可能变） | |
| `ledgersApi.leave` | `global.ledgers`；`removeQueries(['l', id])` | 跳 `/ledgers` |
| `sourcesApi.create` | `l/{id}/sources`（全部变体） | |
| `sourcesApi.update` | `l/{id}/sources`、`l/{id}/sources/detail/{sid}`；改 `opening_balance` 或 `archived` 时另加 `l/{id}/stats` | 余额与净资产随期初、归档变（决策 §14.50） |
| `sourcesApi.remove` | `l/{id}/sources`、`l/{id}/tx`、`l/{id}/stats` | |
| `txApi.create` / `update` / `remove` | `l/{id}/tx`（整棵，含所有筛选组合）、`l/{id}/sources`（余额）、`l/{id}/stats`（整棵） | 精确到单条 key 的乐观更新不划算：筛选组合是开放集合 |
| `txApi.createTransfer` / `updateTransfer` / `removeTransfer` | 同上，另加 `l/{id}/tx/transfer/{pairId}` | |
| `txApi.pair` | 同上，另加两条腿各自的 `l/{id}/tx/detail/{tid}` | 配对后两腿都多了 `pair` 和一条 `paired` 事件（决策 §14.34、§14.51） |
| `txApi.unpair` | 同上，另加 `l/{id}/tx/transfer/{pairId}`（`removeQueries`） | 拆开后 pair 不复存在，缓存里那条要删掉 |
| `importsApi.upload` / `uploadText` | `l/{id}/imports/list` | 成功即拿到批次与草稿行，直接 `setQueryData` 填进 `importB` / `importRows`，跳 review |
| `importsApi.patchRow` | 只 `setQueryData` 更新 `l/{id}/imports/rows/{bid}` 里那一行 | **不 invalidate**：表格正在编辑，整表重取会打断 |
| `importsApi.patchRows`（批量） | `l/{id}/imports/rows/{bid}`、`l/{id}/imports/detail/{bid}` | 批量操作时用户不在编辑单元格，可以安全整表重取；汇总计数也变了 |
| `importsApi.commit` | `l/{id}/imports/*`、`l/{id}/tx`、`l/{id}/sources`、`l/{id}/stats` | |
| `importsApi.remove`（撤销 committed） | 同 commit，另加 `removeQueries(['l', id, 'imports', 'detail', bid])` | 撤销删掉的是真交易，批次本身也不复存在（决策 §14.22） |
| `meApi.update` | `global.me`；语言变化时切 i18n | `display_name` 变了还要 invalidate 每个已缓存账本的 `members`（记账人显示名，决策 §14.40） |

实现上收敛成几个辅助函数，页面不手写 key 数组：

```ts
export function invalidateTransactions(qc: QueryClient, l: string) {
  qc.invalidateQueries({ queryKey: ['l', l, 'tx'] });
  qc.invalidateQueries({ queryKey: ['l', l, 'sources'] });
  qc.invalidateQueries({ queryKey: ['l', l, 'stats'] });
}
```

### 3.7 错误归一化与 `{detail, code}` → 文案

拦截器把所有失败统一成一个类，**不再像现状那样退化成 `new Error(detail)`**（`frontend/src/api/client.ts:67-77`）——那样做丢掉了状态码，也让 422 的对象数组被字符串化成 `"[object Object]"`（现状文档 §5.3）。

```ts
export class ApiClientError extends Error {
  status: number | 0;          // 0 = 网络层失败
  code: string;                // 决策 §9 的 snake_case code；网络失败用 'network_error'
  detail: string;              // 服务端原文，仅用于日志与「详情」折叠
  fields?: Record<string, string>;  // 422 时按字段拆开，喂给表单
  payload?: unknown;           // 结构化错误体（如 ImportFileError 的 errors[]），页面按 code 取用
}
```

- 422：`detail` 是 [`./03-backend-api.md`](./03-backend-api.md) §4.1 定义的字符串（形如 `"<loc>: <msg>; <loc>: <msg>"`，`loc` 各段用 `.` 连接），前端按 `; ` 拆分成若干条，取每条 `loc` 的最后一段作为字段名归到 `fields`；同时兼容服务端返回数组形态的旧行为。`code` 置 `validation_error`。（同步 2026-09-12）
- 无响应（超时 / 离线 / CORS）：`status=0`、`code='network_error'`。
- 导入的 400（`import_format_invalid` / `skill_outdated`）带结构化字段（`errors[]` / `current_version` / `file_version` / `guide_url`，形状见 §3.3 的 `ImportFileError`），整个响应体挂在 `payload` 上，由 §4.10 步骤 1 的失败态渲染。

**文案映射全部走 i18n**（§5），组件永远不直接显示 `detail`：

```ts
export function errorMessage(t: TFunction, e: ApiClientError): string {
  return t([`errors.${e.code}`, 'errors.unknown'], { detail: e.detail });
}
```

`errors.*` 语言包：`errorMessage()` 查的是 `errors.${e.code}`，所以**每个 key 必须是 [`./03-backend-api.md`](./03-backend-api.md) §4.2 注册表里的 code 原名**（决策 §14.4、§14.53d）。下表按注册表顺序**一条不多一条不少**地列出注册表里的全部 code：注册表有 44 个 code，这张表就有 44 行，两边是**双向**一致的——语言包里既不能缺 key，也不能有注册表之外的 key（由 §8.1 的一个用例把两份清单对拍）。应用不接入大模型，也没有后台解析，所以与之相关的 code 在服务端就不存在（决策 §14.25），这张表里自然也没有对应的行。

先把两个**不是服务端 code** 的 key 单列出来——它们是纯前端的本地状态，不在注册表里，对拍用例把它们放进白名单：

| key | 何时出现 | zh | en |
|---|---|---|---|
| `network_error` | **非服务端 code**：请求没拿到响应（超时 / 离线 / CORS），拦截器置 `status=0` | 网络连接失败，请检查网络后重试 | Can't reach the server. Check your connection. |
| `unknown` | **非服务端 code**：`errorMessage()` 的兜底 key，服务端新增了前端还没翻译的 code 时命中 | 出错了（{{detail}}） | Something went wrong ({{detail}}) |

下面是注册表里的 44 个服务端 code，顺序与 03 §4.2 完全一致：

| code | HTTP | zh | en |
|---|---|---|---|
| `validation_error` | 422 / 400 | 有几项填得不对，请检查标红的字段 | Some fields need fixing |
| `unauthorized` | 401 | 登录已过期，请重新登录 | Your session expired. Please sign in again. |
| `invalid_credentials` | 401 | 邮箱或密码不正确 | Incorrect email or password |
| `not_found` | 404 | 找不到这条记录，它可能已经被删除，或者你不在这个账本里 | Not found — it may have been deleted, or you're not a member of this ledger |
| `forbidden` | 403 | 你没有权限做这个操作 | You don't have permission to do that |
| `not_owner` | 403 | 只有账本创建者（owner）可以做这个操作 | Only the ledger owner can do that |
| `registration_closed` | 403 | 目前未开放注册 | Registration is currently closed |
| `email_exists` | 409 | 这个邮箱已经注册过了 | This email is already registered |
| `stale_update` | 409 | 这条记录刚被别人改过，已为你刷新 | Someone just changed this. We've reloaded it for you. |
| `use_transfer_endpoint` | 409 | 这是一笔两腿转账，请在转账编辑页里一起改 | This is a paired transfer — edit both sides together |
| `ledger_limit_reached` | 409 | 你的账本数已达上限（10 本） | You've reached the limit of 10 ledgers |
| `member_limit_reached` | 409 | 这个账本成员已满（10 人） | This ledger already has 10 members |
| `already_member` | 409 | 你已经在这个账本里了 | You're already in this ledger |
| `owner_must_transfer` | 409 | 你是这个账本的创建者，请先把 owner 转让给别人再退出 | Transfer ownership to someone else before you leave |
| `cannot_remove_owner` | 409 | 不能移除账本创建者 | You can't remove the ledger owner |
| `member_not_found` | 404 | 这个人不在账本成员里 | That person isn't a member of this ledger |
| `invite_invalid` | 400 | 邀请码不对，或者已经失效了 | That invite code isn't valid |
| `invite_expired` | 400 | 邀请码已过期（有效期 10 分钟），请让对方重新生成 | That invite code has expired |
| `invite_rate_limited` | 429 | 现在人太多，请过几秒再试；你的邀请码仍然有效 | Too busy right now — try again in a few seconds. Your code is still valid. |
| `login_rate_limited` | 429 | 登录尝试太频繁，请稍后再试 | Too many sign-in attempts. Try again later. |
| `register_rate_limited` | 429 | 注册尝试太频繁，请稍后再试 | Too many sign-up attempts. Try again later. |
| `import_rate_limited` | 429 | 这一小时的导入次数已用完（10 批），请稍后再试 | You've used up this hour's imports (10). Try again later. |
| `source_archived` | 409 | 这个账户已归档，不能再记账，也不能作为导入目标 | This account is archived |
| `source_has_transactions` | 409 | 这个账户下还有交易，只能归档不能删除 | This account has transactions — archive it instead |
| `currency_locked` | 400 | 账户的币种创建后不能改；要换币种请新建一个账户，把旧的归档 | An account's currency can't be changed — create a new account and archive the old one |
| `same_source` | 400 | 转出和转入不能是同一个账户 | The two sides of a transfer must be different accounts |
| `repayment_target_not_credit` | 400 | 信用卡还款的转入方必须是信用卡账户 | A card repayment must go into a credit card account |
| `category_invalid` | 400 | 分类不可用，请重新选择 | That category isn't valid |
| `category_kind_mismatch` | 400 | 这个分类和收支类型对不上，请重新选择 | That category doesn't match this transaction type |
| `kind_change_not_allowed` | 400 | 转账和其他类型之间不能互改，请删掉这条重新记 | You can't switch between transfer and other types — delete and re-enter |
| `refund_target_invalid` | 400 | 关联的原支出不可用，请重新选择或不关联 | That original expense can't be linked |
| `transfer_pair_incomplete` | 409 | 这笔转账的数据不完整（缺一条腿），请刷新后重试 | This transfer is missing one side. Reload and try again. |
| `pair_invalid` | 400 | 这条不能和它配对：对方要是同一账本里方向相反、仍是单腿的转账，且不能是同一个账户或它自己 | Can't pair these — the other one must be a single-leg transfer in the opposite direction, on a different account in this ledger |
| `unpair_invalid` | 409 | 这笔转账拆不开（它下面不是恰好两条腿），请刷新后重试 | This transfer can't be unpaired — it doesn't have exactly two legs. Reload and try again. |
| `skill_outdated` | 400 | 分类表已经更新，请按导入指南更新 skill 后重新整理这份账单 | The category list changed — follow the import guide to update your skill, then re-generate this file |
| `import_format_invalid` | 400 | 这个文件读不了（编码、`# version:` 行、表头或某行的列数不对），下面按文件行号列出了出问题的行 | We couldn't read this file — its encoding, its `# version:` line, the header or a row's column count is wrong. The problem lines are listed below. |
| `file_too_large` | 413 | 文件超过 2 MB | File is larger than 2 MB |
| `rows_exceed_limit` | 400 | 这份文件超过 2000 行，请按月分批 | This file has more than 2000 rows — split it by month |
| `batch_not_ready` | 409 | 这批账单现在不能改：它可能已经提交过了，或者还有行缺日期 / 金额 / 币种 / 类型 | This batch can't be changed right now — it may already be submitted, or some rows are still missing a date, amount, currency or type |
| `batch_already_committed` | 409 | 这批账单已经提交过了 | This batch has already been submitted |
| `rows_uncategorized` | 409 | 还有行没有选一级分类，补齐后才能提交 | Some rows still need a top-level category |
| `rows_all_skipped` | 409 | 这批账单的所有行都被跳过了，没有可提交的内容 | Every row is skipped — there's nothing to submit |
| `fx_unavailable` | 503 | 暂时拿不到汇率，折算金额可能缺失 | Exchange rates are unavailable right now |
| `internal_error` | 500 | 服务器出错了，请稍后重试 | Something went wrong on the server. Please try again. |

四条注意：

- **`import_format_invalid` 与 `skill_outdated` 的分工**（决策 §14.53d）：**结构**不对（编码读不出、缺 `# version:` 行、表头对不上、某行列数不对）是 `import_format_invalid`；**只有版本行在、但版本对不上**才是 `skill_outdated`。编码读不出的文件先于版本检查判定，所以它永远落在 `import_format_invalid` 上。两句文案的修法完全不同：前者是「让你的 ChatGPT / Claude 重新导出一份」，后者是「去导入指南更新 skill」。
- **`forbidden` 与 `not_owner` 是两个 code**：`forbidden` 是通用权限拒绝，owner-only 的操作用 `not_owner`，所以「只有账本创建者可以…」这句文案必须挂在 `not_owner` 上。
- **`not_found` 是通用的**：账本不可见、交易被别人删了、路径里的 id 打错了都用它，所以文案要写得两边都成立，不能写死成「这个账本不存在」。判定「被移出账本」要看是哪个 query 报的 404，见 §1.5 第 4 条。
- **`invite_rate_limited` 的文案改过**：限流是端点级 1 QPS（决策 §14.35），不是「你输错太多次」，而且**被限流的请求不会消耗邀请码**，所以要明确告诉用户「码仍然有效，过几秒再试」。

新增后端 code 时，缺 key 会落到 `errors.unknown` 并把 `detail` 显示出来——不会出现空白提示。但这只是兜底：注册表加了 code 就要同时加这两行文案，§8.1 的对拍用例会把漏掉的那条报出来。

### 3.8 409 `stale_update` 的统一处理（决策 §2）

所有 `PATCH` 请求体都带客户端看到的 `updated_at`；服务端不一致就返回 409 `stale_update`。前端**一处**处理，页面不写重复逻辑：

```
用户点保存 ──▶ PATCH {..., updated_at: 客户端看到的值}
                       │
              ┌────────┴────────┐
           200│                 │409 stale_update
              ▼                 ▼
        成功 Toast +      MutationCache.onError:
        失效矩阵(§3.6)    1. invalidateQueries(该资源的 detail key) 并 await 重取
                          2. Toast(warning): errors.stale_update
                          3. 表单：把服务端新值合进表单的「原始值」，
                             用户改过的字段保持不变并标记「已改动」
                          4. 若两边同一字段都变了 → 该字段旁显示
                             「服务器上现在是：<新值>」+ [用服务器的]
                          5. 不自动重发。用户看过差异后自己再点保存
```

- 删除操作遇到 409：直接刷新并提示「这条记录刚被改过，请确认后再删」。
- 列表页不会遇到 409（GET 无并发控制），靠 `refetchOnWindowFocus`（§2.4）收敛。
- 两腿转账的 `updated_at` 取两腿中较新的那个（`TransferUpdate.updated_at`）。

### 3.9 Toast 与确认框

统一组件替代现状散落各处的 `window.alert` / `Alert.alert`（现状文档 §4.10 里有整整一张表说明它们在 Web 上无效）：

- `toast.success(msg)` / `toast.error(msg)` / `toast.warning(msg)`：右下（宽屏）/ 底部 tab 之上（窄屏），4 秒自动消失，错误 Toast 常驻直到手动关闭并可展开 `detail`。
- `confirm({title, body, confirmLabel, tone})`：返回 `Promise<boolean>`，两端同一份实现（Modal），不再 `Platform.OS` 分支。危险操作（删账本、撤销导入、删账户）用 `tone: 'danger'` 且要求输入确认词或二次点击。

---

## 4. 页面

决策 §12 列出的每个页面一个小节。每节按「目的 / 端点 / 状态 / 交互 / 校验 / 成功后」组织。表单校验统一用 `react-hook-form` + `zod`（这两个包已在 `frontend/package.json:15,26,35`，现状从未导入），schema 与服务端约束（决策 §10）保持一致。

### 4.1 登录 `/login`

- **目的**：拿令牌。
- **端点**：`POST /auth/login` → 成功后 `GET /me`。
- **状态**：初始（空表单）；提交中（按钮 spinner，输入禁用）；错误（`invalid_credentials` 显示在密码框下方 + Toast）；无空态、无加载态。
- **交互**：邮箱框 `autoComplete="email"`、`keyboardType="email-address"`、`autoCapitalize="none"`（沿用 `frontend/src/screens/LoginScreen.tsx:70-72`）；密码框 `autoComplete="current-password"` + 显隐切换；回车提交。底部「还没有账号？注册」链接到 `/register?next=...`。**删掉现状页脚里写死的 Demo 账号两行**（`frontend/src/screens/LoginScreen.tsx:98-101`）。
- **校验**：邮箱非空且形如 `x@y.z`；密码非空。长度规则不在登录侧做（服务端只判对错）。
- **成功后**：跳 `next`，否则跳最后使用的账本（§1.5 第 2 条）。

### 4.2 注册 `/register`

- **目的**：建账号；服务端同时自动建默认账本（决策 §2）。
- **端点**：`GET /config`（匿名可读，页面挂载即调，决策 §14.46）→ `POST /auth/register` → `GET /me`。币种列表 `GET /rates/currencies`。
- **状态**：
  - `config` 加载中：表单骨架。
  - `registration_open === false`（决策 §0.5、§14.46）：**用一张说明卡替代整个表单**（不是渲染一个禁用的表单）——「目前未开放注册。如果你是被邀请来的，请让对方把邀请码发给你，并用已有账号登录。」下面只有一个 `[去登录]`。
  - 正常：完整表单。
  - 提交后拿到 403 `registration_closed`（服务端在这中间被关掉了）：切到上面那张说明卡，并 `invalidate` `global.config`。
- **屏幕稿**：登录 / 注册两屏已补（屏幕 17 · 登录与注册，含 `registration_open=false` 的注册已关闭态，决策 §14.52 的 B18），见 §6.5.1。
- **交互**：邮箱、密码、确认密码、默认币种（`Picker`，默认按浏览器语言猜：`zh-*` → CNY，其余 → USD）。
- **校验**：邮箱格式；密码 ≥ 8（与服务端 `min_length=8` 对齐，现状前端写的是 6，`frontend/src/screens/LoginScreen.tsx:22-26`，属于不一致）；确认密码相等；币种为 3 位大写且在币种列表里。
- **成功后**：直接进入自动创建的默认账本首页，并在首页顶部显示一次性引导卡：「先去添加一个账户 →」。

### 4.3 账本列表 `/ledgers`、新建 `/ledgers/new`、加入 `/ledgers/join`

- **目的**：看到我参与的所有账本，切换、新建、加入。
- **端点**：`GET /ledgers`；`POST /ledgers`；`POST /ledgers/join`。
- **列表状态**：加载（3 个骨架卡）；**空 = 引导页**（用户一本账都没有时的落地页，决策 §14.40 的 01-8）：一句「你还没有账本」+ 两个并排的大按钮「新建账本」/「加入别人的账本」；错误（重试按钮）。
- **每张卡只显示**：账本名、基准币种、**成员数**、我的角色徽章、最后更新时间。**不显示净资产、不显示交易数**（决策 §14.52 A16——账本卡片算净资产要为每本账拉一遍账户和汇率，代价与价值不成比例）。点击 → `/l/:id`。
- **新建**：账本名（1–100 字，与账户名一致，决策 §14.13）、基准币种（默认取 `user.base_currency`，决策 §2）。软限制每人最多 10 本（决策 §2）：已有 10 本时按钮禁用并说明。成功后跳新账本首页。
- **加入**：一个 6 位数字输入（六个独立格子，自动跳格、支持整段粘贴、只收数字），输入满 6 位自动提交。**输满不预览账本信息**——没有这样的接口，也不打算加（决策 §14.52 B17）。
  - 错误：`invite_invalid` / `invite_expired` / `already_member` 分别显示对应文案（§3.7），格子整体抖动一下并清空。码用掉即删（决策 §14.29），所以「已被用过」和「不存在」对前端是同一个 `invite_invalid`。
  - **限流是端点级 1 QPS，不是按人计次**（决策 §14.35）：429 `invite_rate_limited` 时按 `Retry-After` 头显示一个几秒的倒计时，文案必须写清 **「你的邀请码仍然有效，稍后再试」**——被限流的请求不会碰邀请码。倒计时结束后自动重试一次已输入的码。
  - 成功后跳新账本首页，Toast「已加入《XXX》」。

### 4.4 首页 `/l/:ledgerId?month=YYYY-MM`

- **目的**：一屏看清「我现在有多少钱」「这个月花了多少、花在哪」「最近一年的支出趋势」（决策 §7）。屏幕稿 `mockups/屏幕 01 · 首页.dc.html`。
- **端点**：`GET /ledgers/{id}/sources`（余额）、`GET /ledgers/{id}/stats/summary?month=`、`GET /ledgers/{id}/stats/trend?months=12`。
- **区块**（窄屏纵向堆叠，宽屏两列）：
  1. **资产 / 负债 / 净资产三个数**（决策 §7、§14.50）：三个 `StatTile` 并排，都按账本基准币种（余额用最新汇率，决策 §8）。
     - 资产 = 所有**非信用卡**未归档账户的 `balance_base` 之和；
     - 负债 = 所有**信用卡**未归档账户的 `balance_base` 之和（本身是负数，展示时取绝对值并标「欠」）；
     - 净资产 = 资产 + 负债。
     - **归档账户不计入**（决策 §14.50），三个数下方一行小字「不含 N 个已归档账户」，点它跳账户列表并展开归档。
     - 前端从 `sourcesApi.list` 的结果本地求和即可，不需要额外接口；`balance_base` 为 `null`（拿不到汇率）的账户单独提示「有 N 个账户暂时无法折算」，不静默按 0 算。
  2. **账户余额卡片**：横向可滚的卡片行（宽屏是网格）。每张显示账户名、类型图标、`balance` + 币种；`default_currency !== base_currency` 时第二行小字显示 `balance_base`。点击 → 交易列表并预填 `?source_id=`。归档账户默认不显示。
  3. **本月汇总**：月份切换器（`‹ 2026 年 8 月 ›`，写进 `?month=`，不能越过当前月）。支出 / 收入两个大数（支出已按退款日期冲减，决策 §7）。下面是按一级分类的条形排行（前 8 条 + 「其他 N 项」），点一条展开二级分类。条形颜色取 `chart.series[0..7]`，**不用四个 kind 色**（§6.2 规则 3）。一级分类名带 tooltip（触摸端长按），内容是分类缓存里该 code 的 `categoryDesc()`——统计接口不下发说明文字，按 `byL1[code]` 从 §2.3 的缓存里取（决策 §14.21）。转账不出现（决策 §1）。
  4. **12 个月趋势**：**只画支出**一条线（决策 §7、§14.52 B20——收入不放，一屏放不下两条线还要图例）。X 轴月份，Y 轴基准币种，每个点的数值直接标在线上，不只靠 tooltip。点某个月 → 切到该月汇总。趋势右上保留月均 / 峰值两个小数字（决策 §14.52 A21，2026-09-11 用户确认；同步 2026-09-12）。
- **状态**：三块各自骨架屏，互不阻塞；某块失败只在该块内显示重试；账户为 0 时余额区显示空态「先添加一个账户」+ 按钮；本月无交易时汇总区显示「这个月还没有记账」+「记一笔」按钮；用户一本账都没有时根本到不了这里（路由守卫送去 `/ledgers` 的引导页，§1.5 第 2 条、决策 §14.40 的 01-8）。
- **交互**：下拉刷新（原生）/ 顶部刷新按钮（Web）；`refetchOnWindowFocus` 保证切回标签页即最新（§2.4）。

### 4.5 交易列表 `/l/:ledgerId/transactions`

- **目的**：查、筛、改。屏幕稿 `mockups/屏幕 02 · 交易列表.dc.html`。
- **端点**：`GET /ledgers/{id}/transactions`（决策 §4 的全部参数 + `import_batch_id`）；`GET /ledgers/{id}/sources` 供筛选栏用；分类树来自缓存（§2.3）。
- **筛选栏**（窄屏收进一个「筛选」抽屉，显示已启用条件数的角标；宽屏常驻在列表上方）：

| 控件 | 参数 | 说明 |
|---|---|---|
| 搜索框 | `q` | 输入防抖 300ms 后写 URL；服务端 ILIKE 匹配 `merchant` / `note` |
| kind 多选 | `kind` | 四个 Chip，可多选，全不选 = 全部 |
| 账户多选 | `source_id` | 下拉多选，显示账户名 + 币种 |
| 日期范围 | `from` / `to` | 快捷项：本月 / 上月 / 近 3 个月 / 今年 / 自定义 |
| 分类 | `category_l1` / `category_l2` | 两级级联，随 kind 过滤可选项（决策 §1.3） |
| 金额范围 | `min_amount` / `max_amount` | 两个数字框，**按账本基准币种折算后的绝对值比较**（决策 §14.49）；框旁一行小字「按 <基准币种> 比较，跨币种交易按发生日汇率折算」 |
| 币种 | `currency` | 单选；筛的是交易的**原币**（决策 §14.49 明确保留这一项） |
| 来自导入 | `import_batch_id` | 不在筛选栏里手选，由「查看这批交易」带进来（决策 §14.46 的 04-D-7） |

  已生效的条件在筛选栏下方渲染成一排可点掉的 Chip（圆 pill，§6.2 规则 4），其中 `import_batch_id` 显示成 **「来自导入 #12」**（`#` 后是批次的短号，点 × 去掉即回到全部）。「清空筛选」按钮把 URL 恢复成裸路径。所有变更走 `router.replace`（不污染后退栈），只有进出列表页用 `push`。
- **分页**：`limit=50`（上限 200，决策 §14.44 的 03-14），**窄屏无限滚动**（`useInfiniteQuery`，`offset` 递增，滚动位置在返回时恢复），**宽屏底部分页条**（显示 `total`，`offset` 写进 URL）。两种模式共用同一个 query 家族。
- **两腿转账合并成一行**（决策 §14.52 B15）：接口仍按行返回两条腿，**合并在前端做**。规则：
  - 按 `transfer_pair_id` 分组，同一 pair 的两条渲染成一行，标题显示「招行储蓄卡 → 招行信用卡」，金额显示转出腿的绝对值（跨币种时显示「−¥1,000 → +$140」两个数）。
  - 「共 N 笔」的计数**按合并后算**。
  - 按账户筛选时**任一腿命中就显示整对**（这样从信用卡视角也能看见还款的来源账户）；如果只有一条腿落在当前页（跨页），那一页仍按单条渲染并标「另一半在上/下一页」，不做跨页拼接。
  - 单腿转账不合并，标题显示「招行储蓄卡 → 对方：老婆」（`counterparty`）或只有账户名（决策 §14.52 B16：转账不设商户，标题就是这个）。
- **按日分组 + 每日小计 + 底部汇总**（决策 §14.52 A14）：
  - 按 `occurred_at` 分日，每个日期头右侧显示**当日支出合计与收入合计**（都按基准币种，转账不计）。
  - 列表底部（宽屏是 sticky 汇总条，窄屏是列表末尾的一张卡）显示**全部筛选结果**的汇总：支出、收入、净额，来自响应的 `summary`（不是当前页的加总）。净额 = 收入 − 支出，**不含转账**。`summary.rate_missing_count > 0` 时加一行「N 笔因暂无汇率未计入」。
- **行内容**（一行一交易）：

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [↓] 餐饮 · 午餐        星巴克                              −¥38.00       │
│     和同事                                       08-14 · 招行信用卡      │
└─────────────────────────────────────────────────────────────────────────┘
  ↑kind图标 ↑一级·二级     ↑merchant   ↑note(次行)   ↑金额  ↑日期·账户
```
  - kind 图标 + 颜色：支出 ↓ / 收入 ↑ / 退款 ↩ / 转账 ⇄（四个语义色，§6.2），图标旁有文字标签给读屏用，**不只靠颜色**区分。**转账行的金额用 `fg.primary` 不染色**（`tokens.json` 的 `kindSemantics.transferAmount`，§6.2 规则 2）。
  - `currency !== base_currency` 时金额下方小字显示 `amount_base`（发生日汇率，决策 §8、§14.49；`amount_base` 为 `null` 表示汇率暂不可用，显示「暂无汇率」而不是 0）。
  - `transfer_subtype='repayment'` 加一个「还款」徽章。
  - 退款行显示「退款」徽章；`refund_of` 非空时可点进原支出。
  - `import_batch_id` 非空的行右上角有一个小的「导入」标记，点击跳该批次。
- **状态**：加载（8 行骨架）；空（区分「这个账本还没有交易」和「没有符合筛选条件的交易」两种文案）；错误（整块重试）；加载更多（底部 spinner）。
- **筛空时的挽救提示**（决策 §14.52 A15）：结果为 0 且启用了 ≥2 个条件时，**最多挑 2 个**条件各发一次「去掉它还剩多少」的探测请求（`limit=1` 只要 `total`），显示成「去掉『8 月』会有 42 笔」「去掉『餐饮』会有 17 笔」两个可点的建议，点一下就去掉那个条件。挑哪两个：按「去掉后结果最多」排序，只在两个探测都返回后一起渲染，避免闪烁。**只发 2 个请求**，不做全组合探测。
- **交互**：行点击 → 详情（合并的转账行点进两腿详情 `/l/:id/transfers/:pairId`）；行右滑（窄屏）/ 悬停操作按钮（宽屏）给「编辑」「删除」；删除走 `confirm`，转账（有 `transfer_pair_id`）时文案说明「会同时删除两腿」并调 `DELETE .../transfer/{pair_id}`（决策 §1.2）。
- **不做**：导出 CSV（决策 §14.52 A1）、按成员筛选（决策 §14.46 的 04-D-11）、交易编号（A6）。

### 4.6 记一笔 `/l/:ledgerId/transactions/new?kind=...`

四个 kind 一个页面、四个 tab（决策 §1）。tab 切换写进 URL 的 `kind`，不丢已填字段中语义相同的部分（金额、日期、账户、备注保留；分类在支出↔收入切换时清空，因为分类树不同，决策 §1.3）。

**共同字段**：账户（默认取上次使用的账户，存 `localStorage['wallet:last_source:<ledgerId>']`）、金额（`keyboardType="decimal-pad"` + `inputMode="decimal"`）、币种（默认取所选账户的 `default_currency`）、日期（默认今天，本地时区，**不是** 现状那样的 UTC `toISOString().split('T')[0]`，`frontend/src/screens/TransactionFormScreen.tsx:28`）、商户、备注。

**用户永远不输入正负号**：符号由 kind 决定（决策 §1），提交前由客户端置好符号（`expense` 负，`income`/`refund` 正，转账两腿由服务端定，决策 §1.2）。金额在请求体里是**字符串**（03 §4.5 的 `Decimal` 约定），前端用字符串拼装、不经过浮点数。

**录入辅助**（决策 §14.52 A19，屏幕稿 `mockups/屏幕 04 · 记一笔.dc.html`）——都是本地行为，不加接口：

| 辅助 | 说明 |
|---|---|
| 快捷加数 | 金额框下一排 `+10 / +50 / +100` 与 `×2`，点一下就加到当前值上（补录常见小额时最省事） |
| 计算器 | 金额框支持直接输入 `12.5+8.8*2` 这样的算式，失焦时求值并把算式留在备注旁的一个小灰标里（点掉即弃）；只支持 `+ − × ÷` 与括号，不做 eval，用一个几十行的表达式解析器 |
| 最近商户建议 | 商户框聚焦时下拉最近用过的 8 个商户（本地记录，按所选分类过滤优先） |
| 分类按判据搜索 | `CategoryPicker` 的过滤框同时匹配分类名**和 `categoryDesc()` 的判据文字**——记不住「纸巾算哪类」时搜「用完就没了」也能找到（决策 §14.21） |
| 保存并再记一笔 | 见 §4.6.5 |
| 桌面快捷键 | `⌘/Ctrl + S` 保存、`⌘/Ctrl + Enter` 保存并再记一笔、`Esc` 放弃、`1/2/3/4` 切 kind tab（焦点不在输入框时）、`?` 打开快捷键帮助 |

**统计影响预演**（决策 §14.52 A9）：填完金额与分类后，提交按钮上方一行小字用**本地**的当月汇总做加减——「本月餐饮 ¥1,240 → ¥1,278」。纯前端计算（当月 `statsSummary` 已在缓存里），不发额外请求；缓存缺失时这一行不显示。

#### 4.6.1 支出 tab（`kind=expense`）

- 分类：一级必填、二级可选（决策 §1），从支出树取（§2.3）。选择器是两级面板：左列一级、右列二级；窄屏是「先选一级 → 滑出二级」。最近用过的 6 个分类置顶（本地记录）。
- **只选一级就是完整的选择**（决策 §1.3：`category_l2` 可空）：右列（窄屏是滑出的二级面板）第一项固定是「不细分」，选中一级后默认落在它上面，此时可以直接关闭选择器提交；窄屏的二级面板顶部有「就用一级」按钮。二级只在用户主动点选时才写入，服务端不会因为二级为空而拒绝。
- **一级选项是两行**（决策 §14.21）：第一行是 `categoryName()`，第二行用 `categoryDesc()` 显示归类判据（12.5px、次要色、单行截断）。它就是「生活购物 = 用完就没了 / 消费购物 = 买一次用几年」这类边界的唯一提示位置，所以不要因为窄屏省掉。截断的全文靠长按（触摸）或 hover（指针）弹出显示。二级选项没有说明文字（`desc` 为 `null`），保持单行，不留空行。
- 端点：`POST /ledgers/{id}/transactions`，body：

```json
{
  "source_id": "7c3e1c1e-2a4b-4b6e-9a3e-1f2d3c4b5a69",
  "kind": "expense",
  "amount": "-38.00",
  "currency": "CNY",
  "occurred_at": "2026-08-14",
  "category_l1": "food",
  "category_l2": "lunch",
  "merchant": "星巴克",
  "note": "和同事"
}
```

#### 4.6.2 收入 tab（`kind=income`）

同支出，分类来自收入树（决策 §1.3），金额为正。

#### 4.6.3 退款 tab（`kind=refund`）

- 多一个**「关联原支出」**选择器（可留空，决策 §1.1）。
- 分类：默认沿用所选原单的 `category_l1/l2`，可改（决策 §1.1）。没关联原单时按支出树自己选。
- **关联原支出选择器**（决策 §1.1，复用交易列表的筛选组件）：

```
┌─ 选择原支出 ────────────────────────────────────────────────┐
│ [搜索商户/备注............]  账户:[招行信用卡▾] 近90天 ▾    │
│ kind 固定为「支出」(不可改)                                  │
├─────────────────────────────────────────────────────────────┤
│ 08-02  京东          数码/电子      −¥1,299.00              │
│                                    已退 ¥0 · 可退 ¥1,299    │
│ 07-28  淘宝          服饰/衣服      −¥259.00               │
│                                    已退 ¥100 · 可退 ¥159   │
│ 07-15  苹果          数码/电子      −¥799.00  [已退完]      │
└─────────────────────────────────────────────────────────────┘
```

  - 默认筛选：`kind=expense`、`source_id=` 当前退款所选账户（**预填但可改**）、`from=today-90d`（决策 §1.1）。
  - 每行显示**已退 / 可退**（来自 `RefundCandidate.refunded_total` / `refundable`，03 §5.28）。已退完的行置灰但仍可选（部分退款可能超额）。
  - 选中后回到表单，显示一张「已关联」小卡（原单日期、商户、金额、可退余额），带「取消关联」。
- **快捷额度**（决策 §14.52 A20）：选中原单后金额框上方出现两个 Chip——`[全额退 ¥1,299.00]`（= 原单绝对值）与 `[退可退余额 ¥1,040.00]`（= `refundable`），点一下填进金额框。
- **退回账户默认同原单**（决策 §14.52 A20）：账户选择器预填成原支出的 `source_id`，可改；改成别的账户时给一条中性提示「退到了另一个账户，账户余额会各自变化，统计不受影响」。
- **候选筛选「还有可退余额」**（决策 §14.52 A20）：选择器顶部一个开关，打开后只显示 `refundable > 0` 的行。默认**关闭**——已退完的行仍要能选中（部分退款可能超额，决策 §1.1、§14.52 B10）。
- **「仅支出」是固定条件**（决策 §14.52 B11）：`refund_of` 只能指向 `kind='expense'`（决策 §1.1），所以这个条件在选择器里渲染成一个**不可点掉**的静态标签，不是可关闭的 Chip。
- **超额警告**（决策 §1.1）：本次退款金额 > 可退余额时，金额框下方黄色提示「这笔退款会让累计退款超过原单金额（原单 ¥1,299，已退 ¥1,200，本次 ¥200）」，**允许保存**。
- 端点：`POST .../transactions`，`kind: "refund"`，`amount` 为正，带 `refund_of`。

#### 4.6.4 转账 tab（`kind=transfer`）

一个表单同时覆盖单腿与两腿（决策 §1.2）：

```
┌─ 转账 ──────────────────────────────────────────────────────┐
│ 子类型   ( ● 普通转账 )  ( ○ 信用卡还款 )                    │
│                                                             │
│ 转出账户 [ 招行储蓄卡 (CNY) ▾ ]                              │
│ 转入账户 [ 招行信用卡 (CNY) ▾ ]   ☐ 对方不在这个应用里        │
│                                                             │
│ ── 勾上「不在应用里」后 ──────────────────────────────────── │
│ 转入账户 → 替换成:  对方 [ 老婆____________ ] (counterparty) │
│                                                             │
│ 金额     [ 1,000.00 ]  币种 [ CNY ▾ ]                        │
│ ── 两腿币种不同时展开第二组 ──────────────────────────────── │
│ 转入金额 [   720.00 ]  币种 [ CNY ▾ ]                        │
│ ⓘ 汇率不同或有手续费时两边金额可以不等；手续费请另记一笔支出。 │
│                                                             │
│ 日期 [2026-08-14]  备注 [__________]                        │
└─────────────────────────────────────────────────────────────┘
```

- **单腿 vs 两腿**：「对方不在这个应用里」勾选框决定（决策 §1.2）。
  - 未勾（两腿）：转出 + 转入两个账户都选，`transfer_pair_id` 由服务端生成，走 `POST .../transactions/transfer` 一次建两条。
  - 勾上（单腿）：只有一个账户（方向由「这是转出还是转入」的小切换决定）+ `counterparty` 文本框（如「老婆」「工资卡」）。走普通 `POST .../transactions`，带 `transfer_role` 与 `transfer_subtype`，`transfer_pair_id` 为 null（决策 §1.2、§10）。
  - 单腿转账计入余额但不进收支统计（决策 §1.2），表单底部用一行小字说明这一点。
- **跨币种**（决策 §1.2）：两腿币种默认取各自账户的 `default_currency`。**两边币种相同时只填一次金额**（第二组折叠，值自动同步）；一旦两边币种不同，自动展开第二组要求分别填写，两边金额不要求相等。
- **子类型与账户的联动**（决策 §1.2、§14.52 A11）：`plain` / `repayment`。选「**信用卡还款**」时，**转入账户选择器只列 `type='credit'` 的账户**（还款的定义就是钱进信用卡）；已经选了非信用卡账户再切成还款，就清空转入账户并提示「还款的转入方必须是信用卡账户」。
- **单腿转账的币种 = 账户币种**（决策 §14.52 A11）：勾了「对方不在这个应用里」之后币种框变成只读，跟着所选账户的 `default_currency` 走——只有一条腿，另一边不存在，允许改币种没有任何意义。
- **同币种两腿只填一个金额**（决策 §14.52 A11）：见下条。
- **汇率只读**（决策 §14.52 A10）：跨币种时在两个金额框之间显示一个 chip「1 USD ≈ 7.1694 CNY（08-14）」，**不可编辑**——它只是参考；要让两边对得上就直接改另一腿的金额（两腿本来就不要求相等，决策 §1.2）。
- **不设商户 / 标题**（决策 §14.52 B16）：转账表单里没有商户框；列表与详情的标题由两个账户名（或 `counterparty`）拼出来，「还信用卡」这种说明写进备注。
- **不填分类**：转账没有分类（决策 §1、§10 的 CHECK），表单里根本不显示分类控件。
- **外部转入的引导**（决策 §1.2）：当用户选择「对方不在应用里」+ 方向为「转入」时，在表单顶部显示一条建议：「如果这是别人给你的钱（工资、红包、报销），记成**收入**统计更准 → [改记为收入]」。点了就切到收入 tab 并预填分类 `social_income`。
- 端点（两腿），`POST /ledgers/{id}/transactions/transfer`。请求体是**扁平**的（03 §5.33），字段名是 `subtype` 不是 `transfer_subtype`，金额传正数由服务端定符号：

```json
{
  "from_source_id": "7c3e1c1e-2a4b-4b6e-9a3e-1f2d3c4b5a69",
  "to_source_id": "9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
  "amount_out": "1000.00",
  "currency_out": "CNY",
  "amount_in": "1000.00",
  "currency_in": "CNY",
  "occurred_at": "2026-08-14",
  "subtype": "repayment",
  "note": "还 8 月账单"
}
```

  表单控件到字段的映射：转出账户 → `from_source_id`，转入账户 → `to_source_id`，第一组金额/币种 → `amount_out` / `currency_out`，第二组（币种不同时展开）→ `amount_in` / `currency_in`；两边币种相同时第二组折叠，提交前把 `amount_in` / `currency_in` 填成与转出相同的值。响应是 `TransferPair`（`{pair_id, occurred_at, subtype, note, out, in}`）。

  端点（单腿），`POST /ledgers/{id}/transactions`：

```json
{
  "source_id": "7c3e1c1e-2a4b-4b6e-9a3e-1f2d3c4b5a69",
  "kind": "transfer",
  "transfer_role": "in",
  "transfer_subtype": "plain",
  "counterparty": "老婆",
  "amount": "500.00",
  "currency": "CNY",
  "occurred_at": "2026-08-14",
  "note": "生活费"
}
```

#### 4.6.5 校验、状态与成功后

| 字段 | 规则 |
|---|---|
| `source_id` | 必填；不能是已归档账户（决策 §3） |
| `amount` | 必填、数字、`> 0`、最多 4 位小数（服务端 `NUMERIC(18,4)`） |
| `currency` | 3 位大写且在 `GET /rates/currencies` 列表里 |
| `occurred_at` | 必填、合法日期、不晚于今天 + 1 天（时区容差） |
| `category_l1` | expense/income/refund 必填；transfer 必须为空（决策 §10） |
| `category_l2` | 若填，必须属于所选一级（决策 §1.3） |
| `note` | ≤ 500 字（决策 §1.4） |
| `merchant` | ≤ 200 字（决策 §1.4） |
| `counterparty` | 仅单腿转账可填；两腿必须为空（决策 §10 的 CHECK） |
| 两腿转账 | 转出账户 ≠ 转入账户；两边都必填 |

- **状态**：账户列表加载中时整个表单骨架；账户数为 0 时不显示表单，直接引导去建账户；提交中禁用并显示按钮 spinner；失败 Toast + 字段级错误（来自 `ApiClientError.fields`）。
- **成功后**：默认跳回来的地方（`?next=` 或 `router.back()`）；底部提供「**保存并再记一笔**」（决策 §14.52 A19）——保存后清空金额/商户/备注，保留账户、日期、kind、分类，焦点回到金额框，顶部用一条细 Toast 提示「已保存（第 3 笔）」。这是连续补录时最省力的路径。
- **离开确认**：表单有未保存改动时拦截路由跳转与浏览器关闭（`beforeunload`）。

### 4.7 交易详情 `/l/:ledgerId/transactions/:txId` 与编辑

屏幕稿 `mockups/屏幕 07 · 交易详情 转账.dc.html`、`屏幕 08 · 交易详情 支出与收入.dc.html`。

**详情**（`GET /transactions/{tid}`，比列表多出 `pair` / `refunds` / `refund_of_detail` / `events` 四组，§3.3）：

- **头部**：kind 徽章 + 金额（转账不染语义色）+ 商户 + 日期 + 账户 + 分类。**不显示交易编号**（决策 §14.52 A6）。
- **汇率行**（决策 §14.52 A24）：`currency !== base_currency` 时显示「≈ ¥1,032.40 · 按 2026-08-14 汇率 1 USD = 7.1694 CNY」，数据来自 `amount_base` / `rate_used` / `rate_date`。`rate_date !== occurred_at`（回退到最近行情日，决策 §8）时补一句「该日无行情，用了 08-13 的汇率」。汇率**只读**（决策 §14.52 A10）。
- **支出行**：`refunds[]` 非空时列出每一笔退款（日期、金额、备注，外加 `source_id` 映射出的**退回账户**名，可点进），并给一行「已退 ¥259.00 / 可退 ¥1,040.00」（决策 §14.46 的 04-D-6）。
- **退款行**：把 `refund_of_detail` 渲染成一张原单摘要卡（日期、商户、金额、`source_id` 对应的账户、`category_l1` / `category_l2` 对应的分类名、已退 / 可退，可点进），带「解除关联」；卡片下面把 `refund_of_detail.other_refunds[]` ——**指向同一张原单、不含当前这条的其它退款**——按日期升序列出来（每条只有日期、金额、币种、备注，03 §5.27 的这些元素**不带**退回账户，所以这里不显示账户名；决策 §14.52 A25），免得重复登记；数组为空时这一块整块不渲染。没有 `refund_of` 时显示「未关联原支出」+「去关联」；原单已被删除（`refund_of` 与 `refund_of_detail` 同时为 `null`）时显示「原单已删除」。
- **转账行**：
  - 两腿（`pair` 非空）：两条腿并排显示（账户、金额、币种），跨币种时两边金额各自显示。**不显示「余后」余额**（决策 §14.52 A7）。操作里有 **「拆开」**——`POST .../transfer/{pair_id}/unpair`，确认框说明「拆开后两条各自变成单腿转账，仍计入账户余额，但不再互相关联」（决策 §14.34）。
  - 单腿（`transfer_pair_id === null`）：显示 `counterparty` 或「对方不在应用里」。操作里有 **「关联为转账对腿」**——打开一个选择器，**复用交易列表的筛选组件**，只列**方向相反的单腿转账**（`kind=transfer`、`transfer_role` 取反、`transfer_pair_id` 为空、默认同币种同金额、±3 天，条件可放宽），选中后 `POST .../transactions/{tid}/pair`。配对成功后跳两腿详情，原来两条的 `counterparty` 被清空（决策 §14.34）。
    - **子类型不必相同**（决策 §14.53a）：选择器**不**按 `transfer_subtype` 过滤——储蓄卡账单写「普通转账」、信用卡账单写「还款」的同一笔还款很常见，按子类型硬卡会让配对永远不触发。确认框里写清楚配对后的结果：「**配对后两条的子类型会统一**：任一条是『还款』且**转入方的账户是信用卡**，这一对就记成还款；否则记成普通转账。」服务端在同一个事务里把两腿改成同一个值；**只有值真的变了的那一腿**会多一条 `updated` 事件（`changes` 记 `transfer_subtype` 的 before / after），原值已经等于统一值的那一腿不写事件（决策 §14.53a、§14.51）——最常见的 `plain` + `repayment` 配对只会多出一条 `updated`。
    - 两腿的 `occurred_at` **允许不同**（配对出来的一对各自保留原来的日期，决策 §14.53a）；两腿详情页头部显示的日期、子类型与备注取**转出腿**的值。
    - 选不到合适的对腿时，选择器给一句「没有能配对的转账。对腿必须是本账本里方向相反、仍是单腿的转账，且不在同一个账户上」；硬点了不合规的一条，服务端回 400 `pair_invalid`（§3.7）。
- **两种关联都可以在导入之后改**（决策 §14.34）：退款的 `refund_of` 和转账的配对，在这一页都能改选或解除，review 里的自动建议只是预填。
- **操作记录时间线**（`events[]`，决策 §14.51）：详情页底部一块 `EventTimeline`，按时间倒序：

```
操作记录
  2026-08-20 14:02  我        改动    金额 −38.00 → −42.00、备注 「和同事」→「和同事 AA」
  2026-08-14 09:31  老婆      关联退款  原单 → 08-02 京东 ¥1,299.00
  2026-08-14 09:12  老婆      导入     来自「招行信用卡 8 月.csv」（可点进批次）
  2026-08-14 09:12  老婆      创建
```

  - 人名取 `actor_id` → 成员列表映射出的 `display_name`，为空回退邮箱 `@` 前的部分（决策 §14.40 的 01-7、§14.43 的 03-4）；是自己时显示「我」。成员退出账本后照旧显示，不匿名化。
  - 动作文案：`created` 创建 / `updated` 改动 / `imported` 导入 / `paired` 关联对腿 / `unpaired` 拆开 / `refund_linked` 关联退款 / `refund_unlinked` 解除退款关联。
  - `changes` 里的每个字段渲染成「字段名 旧值 → 新值」，金额与日期按 §5.4 的 formatter 格式化，分类 code 换成分类名。改动超过 3 个字段时折叠成「共 5 处改动，展开」。
  - `import_batch_id` 非空的事件把「来自 <文件名>」做成跳批次的链接；批次被撤销（删除）后链接失效，退化成纯文本。
  - `client` 恒为 `web`，**界面不显示它**（本版本只有网页端，决策 §0.1；屏幕稿里的「客户端 iOS」要去掉）。
  - 事件只追加不修改；交易删除时事件级联删除，所以这块只在详情页有，列表页不显示。
- **快捷操作**（决策 §14.52 A8）：
  - **复制一笔**：跳记一笔并预填同账户、同商户、同分类、同金额，**日期改成今天**，光标落在金额框。
  - **登记退款**（只在 `kind='expense'` 上出现）：跳记一笔的退款 tab，`refund_of` 预填成本条、分类沿用、退回账户默认同原单（决策 §14.52 A20）。
  - **不做「分享」**（决策 §14.52 A8）。

**编辑单笔** `/…/:txId/edit`：复用记一笔表单，预填。

- **改 kind 的限制**（决策 §1、§10 的 CHECK 决定了哪些改动会破坏约束）：
  - `expense ⇄ income`：允许，必须重选分类（分类树不同），符号自动翻转。
  - `expense/income → refund`：允许，符号变正，可选关联原单。
  - `→ transfer` 与 `transfer → 其他`：**不允许**（决策 §14.3；服务端返回 400 `kind_change_not_allowed`）。界面上把「转账」tab 在编辑模式下禁用，提示「要把它改成转账，请删掉这条重新记」——前端先挡是为了少一次往返，服务端仍然是唯一的权威判定。
  - 已有 `refund_of` 的行改成非 `refund`：先要求解除关联（服务端约束 `refund_of IS NULL OR kind='refund'`，决策 §10）。
  - 由导入产生的行（`import_batch_id` 非空）照常可改，但顶部提示「这条来自 <文件名> 的导入」。
  - **归档账户上的历史交易允许修改**，只是不能新建（决策 §14.40 的 01-12）：账户选择器在编辑模式下保留当前这个已归档账户，但不允许改选到别的归档账户。
- **编辑两腿转账** `/l/:ledgerId/transfers/:pairId/edit`（决策 §1.2）：一个表单**同时**编辑两腿——日期、备注、子类型是共享的；两腿各自的账户、金额、币种分别编辑。提交一次 `PATCH .../transactions/transfer/{pair_id}`。绝不允许在这里只改一腿。
- **并发**：两个编辑页都带 `updated_at`（两腿转账取两腿中较新的那个，决策 §14.40 的 01-11），409 走 §3.8。
- **统计影响预演**（决策 §14.52 A9）：改金额 / 分类 / 删除时，在确认区用**本地**月度汇总做加减，显示「本月餐饮 ¥1,240 → ¥1,244」。纯前端计算，不发额外请求；拿不到当月汇总缓存时这一行不显示。

### 4.8 账户列表 `/l/:ledgerId/sources`

屏幕稿 `mockups/屏幕 09 · 账户列表与表单.dc.html`。

- **端点**：`GET /ledgers/{id}/sources`（含余额，决策 §11）。
- **顶部三个数**：资产 / 负债 / 净资产，口径与首页完全一致（决策 §7、§14.50），前端按 `balance_base` 本地求和，**归档账户不计入**。
- **按类型分组，每组给小计**（决策 §14.50）：四种类型，顺序固定 **储蓄卡 `checking` → 信用卡 `credit` → 现金 `cash` → 其他 `other`**（决策 §14.48：**没有 `savings`**）。每组头部右侧是该组按基准币种折算后的小计。
- **每行**：名称、类型图标、币种、`balance`（非基准币种时下方小字给 `balance_base` 与所用汇率日期）。信用卡的余额是负数，显示成「欠 ¥3,204.00」更直白。
- **归档**：归档账户折叠在底部「已归档（N）」里，`?include_archived=1` 展开；每行显示**归档时间**（`archived_at`，决策 §14.50）并置灰，一行小字「余额不计入净资产」。
- **交互**：点击 → 编辑；行操作「归档 / 取消归档」「删除」。
  - **归档确认**（决策 §14.50）：「归档后不能再记账、也不能作为导入目标，历史记录保留。**该账户余额 ¥1,204.00 将从净资产中移除。**」
  - **删除**只在没有交易时可用（决策 §3），否则按钮禁用并提示「这个账户下有交易，只能归档」；服务端也会用 `source_has_transactions` 兜底。
- **状态**：空态「还没有账户，添加一个开始记账」+ 按钮。

### 4.9 账户表单 `/l/:ledgerId/sources/new`、`/…/:sourceId/edit`

| 字段 | 新建 | 编辑 | 规则 |
|---|---|---|---|
| `name` | ✓ | ✓ | 1–100 字，账本内**允许同名**（按 id 区分，只在界面给一条软提示，决策 §14.40 的 01-6） |
| `type` | ✓ | ✓ | `checking` 储蓄卡 / `credit` 信用卡 / `cash` 现金 / `other` 其他——**四种，没有 `savings`**（决策 §14.48） |
| `default_currency` | ✓ | ✗ | 3 位大写；**创建后不可改**（决策 §14.50）。编辑页把它渲染成只读行 + 一句「币种创建后不能改，改了历史交易的含义会乱；如果要换币种，请新建一个账户并把旧的归档」 |
| `opening_balance` | ✓ | ✓ | `NUMERIC(18,4)`，默认 0（决策 §3） |
| `archived` | ✗ | ✓ | 开关；打开时走 §4.8 的归档确认，`archived_at` 由服务端写 |

- **期初余额的说明**随类型变（决策 §14.52 A13、§14.52 B5）：
  - 通用一行：「余额 = 期初余额 + 这个账户下所有交易金额之和。**期初余额记在账户上，不是一笔交易**，它不会出现在交易列表里。」
  - `type='credit'` 时输入框换成「当前欠款」，用户填**正数**（如 `3204`），前端提交前取负存成 `-3204.0000`（决策 §14.52 A13），框下小字「填你现在欠银行多少，会存成负数」。切换类型时自动换算并提示。
- 编辑时修改 `opening_balance` 会立刻影响所有历史余额与净资产，保存前二次确认（并用 §4.7 那套本地预演显示「净资产 ¥52,300 → ¥49,096」）。
- 端点：`POST` / `PATCH /ledgers/{id}/sources[/{sid}]`；`PATCH` 带 `updated_at`。成功后回列表 + Toast。

### 4.10 导入 `/l/:ledgerId/imports*`（决策 §5、§6）

**应用不接入任何大模型**（决策 §0.1、§5、§6）：账单由用户在自己的 ChatGPT / Claude 里用我们提供的 skill 整理成**标准 CSV**，再上传到这里。前端因此没有模型设置、没有解析进度、没有轮询、没有页面缩略图、没有重试——**校验是同步的**，上传完成的那一刻批次和全部草稿行就已经在响应体里了。

```
 /imports/guide            /imports/new                    /imports/:bid              /imports/:bid
┌──────────────────┐     ┌───────────────────┐  POST     ┌────────────────────┐ POST ┌──────────────┐
│ 0 导入指南        │────▶│ 1 选账户 +         │──同步────▶│ 2 review 表格      │commit▶│ 3 已提交      │
│ 三步说明 / skill  │     │   上传或粘贴 CSV   │  201      │ status='ready'     │      │ 'committed'   │
│ 文本 / 示例文件   │     └─────────┬─────────┘           │ （可编辑草稿行）    │      └──────┬───────┘
└──────────────────┘               │                     └────────────────────┘             │
                                    │ 400 import_format_invalid / skill_outdated             │ DELETE = 撤销
                                    ▼                                                        ▼
                          ┌───────────────────────┐                                  ┌──────────────┐
                          │ 校验失败态（不建批次） │                                  │ 整批删除      │
                          │ 按行号列错误 + 复制清单│                                  │ 从历史里消失  │
                          └───────────────────────┘                                  └──────────────┘
```

`ready` 的批次也可以直接丢弃（`DELETE`，`mode='discard'`）。**没有 `reverted` 状态**：撤销就是整批删除，批次从历史列表里消失（决策 §14.22）。

#### 步骤 0 — 导入指南 `/l/:ledgerId/imports/guide`（决策 §6）

新用户第一次点「导入」先到这里；老用户从上传页顶部的「怎么生成这个文件？」链接随时回来。**页面内容全部来自 `GET /import-format`**（公开接口，决策 §11），前端不硬编码任何一句 skill 文本或列名——skill 与分类表同源，改了分类表就要重新生成，硬编码必然漂移。

- **端点**：`GET /import-format` →`ImportFormat`（`version`、`headers[]`、`skill_text`、`skill_markdown`、`sample_csv`、`instructions`）。`staleTime: Infinity`（跟分类表一样按 `version` 缓存，§2.3 同款）。
- **三步说明**（决策 §6）：

  1. **把 skill 装进你的 ChatGPT 或 Claude**——两个 tab：Claude（`SKILL.md`，Claude.ai 项目或 Claude Code 都能装）/ ChatGPT（Custom GPT 或 Project 的指令文本）。每个 tab 下是一个只读代码块 + `[复制]` + `[下载 SKILL.md]`（下载用 `Blob` + `URL.createObjectURL`，不走后端）。
  2. **让它读你的账单**——「把 PDF、图片、Excel、CSV 直接丢给它，说『整理成钱包导入 CSV』。它会输出一个 CSV 文件或代码块。」一行小字说明：账单内容只经过**你自己的**聊天工具，不经过这个应用的服务器。
  3. **把 CSV 传回这里**——`[去上传 →]` 跳步骤 1。
- **标准格式说明**：固定 11 列表头逐列一张表（列名、含义、是否必填、取值），首行 `# version: <version>` 的说明，以及一句「分类 code 拿不准就留空，不要瞎猜——留空的行会在 review 里标成『待归类』让你自己定」（决策 §5、§14.52 A3）。
- **示例文件**：`sample_csv` 渲染成一个可横向滚动的只读表格 + `[复制 CSV]` / `[下载 示例.csv]`。
- **版本**：页面底部一行 `分类表版本：2026-09-10`。**上传页不显示「你的 skill 版本」**（应用无从知道用户装的是哪一版，决策 §14.52 A18 前半），版本只有上传后由服务端校验。

#### 步骤 1 — 选账户并上传或粘贴（`/l/:ledgerId/imports/new`）

- **目标账户**：必选（决策 §5：一份文件对应一个账户，文件里不含账户信息），只列**未归档**账户（决策 §3）；选中后在下方显示该账户的币种，说明「文件里 `currency` 留空的行会按这个币种入账」。
- **两个入口，同一个校验**（决策 §5、§14.47）：

| 入口 | 控件 | 请求 |
|---|---|---|
| 上传文件 | 拖拽区 + 「选择文件」，**只接受 `.csv` / `text/csv`** | `POST /ledgers/{id}/imports`，multipart：`source_id` + `file` |
| 粘贴文本 | 一个等宽多行文本框，占位符是示例的头两行 | `POST /ledgers/{id}/imports`，JSON：`{source_id, text}` |

  两者切换是一个 `SegmentedControl`（「上传文件」/「粘贴 CSV」）。**没有 JSON 入口**：标准格式只有 CSV（决策 §14.47）。
- **客户端预检**（服务端仍会再验，决策 §5、§9）：文件 > 2 MB 直接拒绝；扩展名不是 `.csv` 直接拒绝并提示「请上传 skill 生成的 CSV 文件；PDF、图片、Excel 请先交给你的 ChatGPT / Claude 整理」——这是最容易犯的错，文案要指回步骤 0。这一条只是省一次往返：真把非 CSV 传上去，服务端一律按结构错误回 400 `import_format_invalid`（决策 §14.53d），没有单独的「文件类型不支持」分支。
- **上传用 `uploadClient`**（§3.2），显示上传进度条。**上传完成即校验完成**：响应是 §3.3 的 `ImportUploadResult`（`{batch, rows}`——批次 + 全部草稿行，一次给完），成功后先把 `rows` 灌进 review 表格的 query 缓存，再 `router.replace('/l/:id/imports/:bid')` 直接进 review 表格，**不发第二次请求**。
- **校验失败态**（不产生批次，页面停在原地）：

| 情况 | HTTP / code | 界面 |
|---|---|---|
| 结构错误：编码读不出、缺 `# version:` 首行、表头与 11 列不符、某行列数不对；**传了非 CSV 的文件也落在这里**（决策 §14.53d） | 400 `import_format_invalid` | 红色错误卡：一句主文案 +**按文件行号列出的错误清单**（`error.errors: [{line, message}]`，`line` 是文件里的物理行号，1 起——`# version:` 是第 1 行、表头是第 2 行），每条渲染成「**文件第 {{line}} 行**：{{message}}」，最多显示 20 条、其余折叠成「还有 N 条」；下面是 `[复制错误清单]`（读的是同一个 `errors[]`，拼成「文件第 N 行：…」的纯文本，决策 §14.52 A18），文案「把它贴回你的 ChatGPT / Claude，让它照着改」；再下面 `[重新选择文件]` |
| 版本行在、但与应用当前版本不一致（缺版本行属于上一行的结构错误，决策 §14.53d） | 400 `skill_outdated` | 黄色提示卡：「你的 skill 是 `error.file_version`，应用现在是 `error.current_version`，分类表变了。请更新 skill 后重新整理这份账单。」两个按钮：`[去导入指南更新 skill →]`——**用响应里的 `error.guide_url` 做跳转目标**（决策 §14.53f，前端不硬编码这个路径）——与 `[重新选择文件]`。**没有「忽略并继续」**：版本不一致是硬拒绝（决策 §14.30） |
| 文件超 2 MB | 413 `file_too_large` | 「文件超过 2 MB。一份月账单通常只有几十 KB，请确认传的是 CSV 而不是原始 PDF。」 |
| 超过 2000 行 | 400 `rows_exceed_limit` | 「这份文件有 N 行，超过单批 2000 行上限，请让 skill 按月分批输出。」 |
| 这一小时导入次数用完 | 429 `import_rate_limited` | 「这一小时的导入次数已用完（10 批），请稍后再试。」 |

  行级问题（日期格式、金额非数字、币种不合法、kind 不认识、分类 code 不在表内）**不出现在这里**：它们不丢行，只在 review 里打标记（决策 §5），错误卡的文案要说清这一点，免得用户以为整份文件废了。

#### 步骤 2 — review 表格（`status='ready'`）

见 §4.11。

#### 步骤 3 — 已提交与撤销（`status='committed'`）

- 显示「已导入 `created_transactions` 条交易（其中 `created_transfer_pairs` 对两腿转账一起建、`paired_existing_transfers` 条与已有转账配成一对、`linked_refunds` 条关联到了原支出，跳过 `skipped_rows` 行）」，三个按钮：`[查看这批交易]`（跳 `/l/:id/transactions?import_batch_id=<bid>`，决策 §14.46）、`[再导一批]`、`[撤销这批导入]`。
- **撤销确认**（决策 §14.22、§14.43 的 03-9、§14.52 的 B24）：先带 `?dry_run=true` 调一次 `DELETE`，把返回的**两个计数分开措辞**放进确认框——它们说的不是一回事：

```
┌─ 撤销这批导入？ ────────────────────────────────────────────────┐
│ 这会删除这批导入建立的 128 条交易，并把这条导入记录一并移除，    │
│ 无法恢复。                                                      │
│                                                                 │
│ ⚠︎ 批外有 2 笔退款指向这批里的支出，删除后它们会变成「没有原单」  │
│    的退款（退款本身保留）。          ← orphaned_refunds = 2     │
│ ⚠︎ 这批里有 3 笔退款，删掉后它们原来冲减的支出会恢复可退额度。    │
│                                       ← refunds_in_batch = 3    │
│                                                                 │
│                            [取消]   [确认撤销]（需二次点击）     │
└─────────────────────────────────────────────────────────────────┘
```

  计数为 0 的那一条整行不显示。确认后再调 `DELETE /ledgers/{id}/imports/{bid}`（无 `dry_run`），`tone: 'danger'`。成功后 Toast「已撤销，删除了 128 条交易」，`invalidate` 列表并跳回 `/l/:id/imports`——**这一批已经从历史里消失了**，留在详情页会 404。
- 撤销**不限时**，member 也能做（决策 §2、§14.52 B9）。

#### 历史批次列表 `/l/:ledgerId/imports`

- **端点**：`GET /ledgers/{id}/imports`，分页 20 条一页。
- 每行（决策 §14.52 A17）用的字段名与 03 §5.38 / 02 §1.7 完全一致（决策 §14.53e）：`filename` · `source_name` 目标账户 · `created_at` 上传时间 · **上传人**（`created_by` 经成员列表映射成 `display_name`，没填时显示邮箱 `@` 前的部分，决策 §14.40 的 01-7、§14.43 的 03-4）· `status` 徽章（只有 `ready` / `committed` 两种）· `row_count` 行数 · **净额**（`net_amount`，币种是 `base_currency`）· **标记数**（`⚑ 3` 形式，聚合 `flags_summary` 里非零的项）。
- **粘贴进来的批次没有文件名**（`source === 'paste'` 时 `filename` 为 `null`，由 [`./02-database.md`](./02-database.md) §1.7 的 `ck_import_batches_filename` 绑死）：文件名那一格显示固定占位「粘贴的 CSV 文本」+ 一枚「粘贴」小徽章，不留空白。`source === 'csv'` 的行显示 `filename` 并在旁边给 `size_bytes` 的人类可读形式。
- 按钮：`ready` → `[继续 review]` + `[丢弃]`；`committed` → `[查看这批交易]` + `[撤销]`。
- 顶部常驻 `[导入新账单]` 与 `[导入指南]` 两个入口。
- 空态：「还没有导入过账单」+ 一句「账单交给你的 ChatGPT / Claude 整理成 CSV，再传进来」+ `[看看怎么做 →]`（跳步骤 0）。

### 4.11 导入 review 表格（`status='ready'`，决策 §5）

这是整个产品最重的一屏，桌面优先（决策 §0.6）。屏幕稿见 `mockups/屏幕 03 · 导入 review.dc.html`（按 §6.5.1 的清单修正后使用）。

#### 4.11.1 布局

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ 招行信用卡 8 月.csv → 招行信用卡 · 128 行 · 待归类 6 · ⚑重复 3 · ⚑退款 2 · ⚑转账 1     │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ 筛选:[全部 128|待归类 6|有标记 6|已跳过 2]   [☑ 已选 4] [批量设分类▾][批量跳过][取消跳过]│
├──┬────┬──────┬─────────┬────┬──────┬────────┬──────┬──────┬──────┬────────────┬────────┤
│☐ │行号│ 日期  │ 金额     │币种│ kind │ 商户    │ 备注 │ 一级 │ 二级 │ 关联 / 对手 │ 标记   │
├──┼────┼──────┼─────────┼────┼──────┼────────┼──────┼──────┼──────┼────────────┼────────┤
│☐ │ 1  │08-02 │  −38.00 │CNY │支出▾ │星巴克  │和同事│餐饮▾ │午餐▾ │     —      │        │
│☑ │ 2  │08-03 │−1299.00 │CNY │支出▾ │京东    │      │⚠︎待  │      │     —      │⚑重复   │
│☐ │ 3  │08-05 │ +1000.0 │CNY │转账▾ │  —     │      │  —   │  —   │☑关联为一笔 │⚑转账   │
│  │    │      │         │    │还款  │        │      │      │      │  转账 ▾    │        │
│☐ │ 4  │08-07 │ +259.00 │CNY │退款▾ │淘宝    │      │服饰▾ │衣服▾ │原单:08-02  │⚑退款   │
│  │    │      │         │    │      │        │      │      │      │  淘宝 ¥259▾│        │
│~~5~~ 已跳过 ……………………………………………………………………………………………………………………………………… │
│  ⓘ 本批内有相同的行（第 9 行）                    ← hint 显示在行下方          │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ ⚠︎ 还有 6 行没有一级分类，补齐后才能提交  [跳到第一条]        [提交 122 行]（禁用）      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**没有页面缩略图侧栏**：应用拿不到原始账单（决策 §5、§14.25），表格是全宽的。**没有置信度列**（`confidence` 已从数据模型里删掉）、**没有「确认这行」按钮和「就绪」计数**（行状态只有 `pending` / `edited` / `skipped`，决策 §14.52 B13）。

#### 4.11.2 列清单

| 列 | 可编辑 | 控件 | 说明 |
|---|---|---|---|
| 勾选 | — | Checkbox | 表头全选/反选；Shift 点击选区间 |
| 行号 | 否 | 文本 | `row_no` = CSV 里的行号（决策 §14.5），报错和 `hint` 都按它指路 |
| 日期 | ✓ | 日期框 | `date`；服务端认不出格式时留空并打 `needs_review`，这里红框 |
| 金额 | ✓ | 数字框 | `amount`，显示带符号；符号由 kind 决定，改 kind 时自动翻转 |
| 币种 | ✓ | Picker | `currency`；文件里不合法时服务端已改成目标账户币种并写进 `hint` |
| kind | ✓ | 下拉 | 支出 / 收入 / 退款 / 转账（决策 §1）；改 kind 联动分类树与「关联 / 对手」列 |
| 商户 | ✓ | 文本框 | `merchant`（≤200）。**转账行不设商户**（决策 §14.52 B16），该格显示 `—` 并禁用 |
| 备注 | ✓ | 文本框 | `note`（≤500） |
| 一级分类 | ✓ | `CategoryPicker` | `category_l1`；transfer 行置 `—` 且禁用（决策 §10）。选择器里每个一级选项是**两行**：名称 + `categoryDesc()` 判据（`text.caption`、`fg.muted`、单行截断，长按 / hover 看全文，决策 §14.21）——这一列的错分成本最高，判据必须就在眼前 |
| 二级分类 | ✓ | `CategoryPicker` | `category_l2`；随一级过滤，第一项固定「不细分」。二级没有说明文字（`desc` 恒为 `null`），保持单行 |
| 关联 / 对手 | ✓ | 见 §4.11.3 | 一格三种形态：退款行 = 原单选择器（`matched_transaction_id`）；转账行 = 配对勾选框（同样绑 `matched_transaction_id`，决策 §14.53b）+ 对手账户 / 对手文本；其余 = `—` |
| 标记 | 否 | Badge | `flags`（四种，见下）+ 派生的「待归类」；跳过开关也在这一格 |

**账户列不存在**：一份文件对应一个目标账户（决策 §5），普通行改不了账户（决策 §14.52 A5）；只有转账行能选**对手**账户，那是另一回事。

服务端给的 `hint`（只读，决策 §14.19）显示成该行下方的一条小字提示，不进 `note`、不可改。每一处校验改动都写在里面，例如「币种 XX 无效，已改为账户币种 CNY」「日期 08/02/2026 认不出，请确认」「本批内有相同的行（第 9 行）」（决策 §5、§14.31）。

#### 4.11.3 「关联 / 对手」列的三种形态

**退款行**（`kind='refund'`）——关联原支出（决策 §1.1、§14.7、§14.11）：

- 服务端找到**唯一**候选时已经预填 `matched_transaction_id` 并打 `refund_candidate`，格里显示原单摘要（`08-02 淘宝 ¥259`）+ `▾`；点开是 §4.6.3 那个选择器（复用 `txApi.list`，`kind=expense` 固定不可去掉、同账户预填可改、近 90 天，决策 §14.52 B11），可改选、可清空。
- 提交时的规则：行 `kind='refund'` 且 `matched_transaction_id` 非空就写 `refund_of`，**不需要用户额外确认**（决策 §14.7）。
- 关联之后仍可在交易详情页改或解除（决策 §14.34），review 里的预填只是建议。

**转账行**（`kind='transfer'`）——配对建议 + 对手（决策 §14.34、§14.53a/b/c）：

```
┌ 关联 / 对手（三种状态，同一格随数据切换） ─────────┐
│ ▸ 唯一候选：服务端已预填 matched_transaction_id    │
│ ☑ 找到对方账户的另一半，关联为一笔转账？           │
│   招行储蓄卡 · 08-05 · −¥1,000.00                  │
│   配对后两条会统一成同一个子类型                   │
├────────────────────────────────────────────────────┤
│ ▸ 多候选：不预填，另打 needs_review                │
│   （transfer_candidate 仍在）                      │
│ ☐ 找到 3 条可以配对的转账，请选一条                │
│   [ 选一条 ▾ ] → 打开交易选择器（复用列表接口）    │
├────────────────────────────────────────────────────┤
│ ▸ 没找到对腿：两个控件互斥，都不预选               │
│ 对手账户 [ 请选择 ▾ ]（本账本未归档账户）          │
│ 对方文本 [ 工资卡__________ ]                      │
├────────────────────────────────────────────────────┤
│ 方向 (● 转入 ○ 转出)  子类型 (○ 普通 ● 还款)       │
└────────────────────────────────────────────────────┘
```

- **勾选框绑的就是 `matched_transaction_id`**，没有第二个字段（决策 §14.53b）：非空 = 勾上「关联为一笔转账」，取消勾选就发 `PATCH .../rows/{rid}` `{"matched_transaction_id": null}`。`flags` 里的 `transfer_candidate` 保留——它记的是「当时找到过候选」这个事实，真正决定提交时怎么建的是这个值。勾选状态**只从这一列读、也只往这一列写**，候选列表既不落库也不单独建接口。
- **唯一候选**：服务端按 §5 / §14.34 的规则找**对方账户上 ±3 天、同币种同金额、方向相反、仍是单腿**的转账，只在候选**唯一**时预填 `matched_transaction_id` 并打 `transfer_candidate`，勾选框因此默认是勾上的。文案就是「找到对方账户的另一半，关联为一笔转账？」。
- **多候选**（决策 §14.53b）：服务端**不预填**，在 `transfer_candidate` 之外**另打** `needs_review`（`transfer_candidate` 仍在，见 03 §5.40 / 05 §3.3），`hint` 写「找到 N 条可以配对的转账，请选一条」。这一格把 `hint` 显示出来，勾选框空着，旁边给一个 `[选一条]` 按钮：点开的选择器**复用交易列表接口**（`kind=transfer`、仍是单腿、方向相反、其他账户、±3 天、同币种同金额——与退款候选是同一套做法，决策 §14.11），选中一条即 `PATCH {"matched_transaction_id": "<id>"}`，勾选框随之勾上。
- **配对后子类型由服务端统一**（决策 §14.53a）：两腿的 `transfer_subtype` **不要求相同**（储蓄卡账单写「普通转账」、信用卡账单写「还款」的同一笔还款很常见）。提交时任一腿是「还款」且**转入腿的账户是信用卡**，整对记成还款；否则整对记成普通转账。格里给一句小字「配对后两条会统一成同一个子类型」，免得用户以为自己这一行的选择被吞了。
- **没找到对腿时不猜对手账户**（决策 §14.53c）：`counterpart_source_id` 留空、**不预选任何账户**。这一格给两个**互斥**的控件，由用户显式选一个：
  - **对手账户 Picker**——只列**本账本的未归档账户**（服务端同样校验，不满足就是 404 `not_found`），选了就表示「对方账户在应用里但没有现成的那条腿」，提交时按两腿建；
  - **对方文本框**（`counterparty`，≤100 字，如「老婆」「工资卡」）——对方不在应用里，提交时按单腿建（决策 §14.10、§14.16：这个字段校验阶段恒为空，只有在这里填才有值）。
  - 填了其中一个就把另一个置灰并清空；两个都留空也行，那就是一条没有对手信息的单腿转账。给了 `matched_transaction_id` 时这两个控件整体折叠——已经有现成的对腿，不该再造一条。
- 对方**已经是两腿转账的一半**时服务端不给配对建议，改打 `duplicate`（决策 §14.34），格里显示「对方那笔已经配过对了」。
- 同格里另有 `transfer_role`（转出 / 转入）与 `transfer_subtype`（普通 / 还款）两个小开关，都可改（决策 §5 的 review 要求）；配对成行时子类型按上面那条规则统一，这两个开关改的是**本行**的值。
- 提交时：`matched_transaction_id` 非空的行与它指向的那条共用一个**新的** `transfer_pair_id`，已有行的 `counterparty` 被清空，两腿子类型按上面的规则统一（决策 §14.34、§14.53a）。

**其余行**：显示 `—`，禁用。

#### 4.11.4 标记徽章（决策 §5、§14.31）

标记**只有四种**，服务端在校验通过（`ready`）时一次性打完；没有「已合并」这一种（决策 §14.31 明确批内重复行不合并），也没有置信度标记。

| 徽章 | 来源 | 色 token | 含义与默认操作 |
|---|---|---|---|
| ⚑ 可能重复 | `flags` 含 `duplicate` | `flag.duplicate` | 同账户同日同金额的交易已存在；或这一行要配对的那笔转账已经配过对了。默认**不自动跳过**，但在「有标记」筛选里排最前，提供「跳过这些重复行」的批量操作 |
| ⚑ 疑似退款 | `flags` 含 `refund_candidate` | `status.info.*` | 已把 `kind` 置 `refund` 并预填了唯一候选原单（§4.11.3）。悬停显示原单摘要 |
| ⚑ 可配对转账 | `flags` 含 `transfer_candidate` | `status.info.*` | 在对方账户上找到了可配对的单腿转账。候选**唯一**时服务端预填 `matched_transaction_id`，「关联为一笔转账」因此默认勾上（决策 §14.34）；**找到多条时这个标记仍然打**，只是不预填 `matched_transaction_id`，并**另打** `needs_review`，在 `hint` 里请用户选一条（决策 §14.53b，见 03 §5.40 / 05 §3.3） |
| ⚑ 需核对 | `flags` 含 `needs_review` | `flag.needs_review` | 校验时改过或没认出这一行的某个字段（日期、金额、币种、kind），或本批内有完全相同的行（决策 §5、§14.31）。具体原因在该行的 `hint` 里 |
| ⚠︎ 待归类 | 派生：`category_l1 == null && kind !== 'transfer' && status !== 'skipped'` | `flag.uncategorized` | **提交前必须补齐**（决策 §1.3、§5） |
| 已跳过 | `status === 'skipped'` | `fg.muted` | 整行置灰删除线，不参与提交，不参与「待归类」计数 |
| 已编辑 | `status === 'edited'` | `fg.muted` | 用户改过这一行 |

每个徽章都带**文字标签**，不只靠颜色（§6.2 规则 7）。

#### 4.11.5 行内编辑与保存

- 每个单元格失焦（或选择器关闭）即 `PATCH .../rows/{rid}`，**只发改动的字段**。
- 乐观更新：先 `setQueryData` 改本地行，请求失败时回滚并在该格显示红色感叹号 + 重试。
- 保存状态在行号旁用一个小圆点表示：灰＝已保存、蓝＝保存中、红＝失败。
- 防抖：文本框 500ms，选择器立即。
- 这张表**关闭 `refetchOnWindowFocus`**（§2.4），否则切窗口回来会覆盖正在输入的内容。

#### 4.11.6 行内筛选与批量操作（决策 §14.52 A4）

- **行内筛选切片**（表格上方 `SegmentedControl`）：**全部 / 待归类 / 有标记 / 已跳过**，每片带计数。切片只影响显示，不影响选中集合（切走再切回来选中还在）。默认落在「全部」，但存在待归类行时首次进入自动落在「待归类」。
- **批量端点**：`PATCH /ledgers/{id}/imports/{bid}/rows`，体是 `{row_ids: Uuid[], patch: ImportRowPatch}`——**一次请求改一批**，不是前端并发发几十个单行 `PATCH`（决策 §14.52 A4）。
- **批量设分类**：选中若干行 → 选一个一级（可选二级）→ 一次 `PATCH`。**这一批要么全成要么全不成**（03 §5.42）：混进一行 kind 对不上的（如给收入行设支出分类），服务端在事务里 400 并**全部回滚**，`detail` 指出是哪一行；界面提示「第 12 行是收入行，和这个支出分类对不上，这一批没有改动」并把那一行高亮滚动到位。所以选择器要先按**当前选中行的 kind 取交集**过滤分类，把注定失败的选项挡在点击之前。这里的一级列表同样是两行选项（名称 + `categoryDesc()`，决策 §14.21）：一次改几十行，选错的代价比单条更大。
- **批量跳过 / 取消跳过**：把 `status` 设成 `skipped` / `pending`。
- **批量设 kind**、**批量设币种**：同一个端点，同一套交互。
- 批量请求成功后整表 `invalidate`（这时用户不在编辑单元格，可以安全重取）。

#### 4.11.7 键盘导航

桌面上要能不碰鼠标改完一整批：

| 键 | 动作 |
|---|---|
| `↑` / `↓` | 上/下一行 |
| `←` / `→` 或 `Tab` / `Shift+Tab` | 左/右一格 |
| `Enter` | 进入当前格编辑；编辑中 `Enter` 提交并下移一行同列 |
| `Esc` | 取消当前格编辑，恢复原值 |
| `Space` | 勾选/取消勾选当前行 |
| `Shift + ↑/↓` | 扩展勾选区间 |
| `S` | 跳过/取消跳过当前行 |
| `C` | 打开当前行的分类选择器（选择器内部用输入过滤 + `↑↓` + `Enter`；过滤同时匹配分类名与判据文字，决策 §14.52 A19） |
| `[` / `]` | 跳到上一个/下一个待归类行 |
| `⌘/Ctrl + Enter` | 提交整批（阻断条件满足时才生效） |
| `?` | 显示快捷键帮助浮层 |

焦点单元格用 2px `border.focus` 描边（不是浏览器默认 outline），滚动时始终保持在视口内。

#### 4.11.8 提交与阻断条件

- 提交按钮文案带数量：「提交 122 行」（= 非 `skipped` 的行数）；下方小字「其中 1 对转账会合并成 1 笔」。
- **阻断**（决策 §1.3、§5）：存在待归类行（§4.11.4 的派生定义）时按钮禁用，按钮上方一条常驻提示「还有 N 行没有一级分类」+「跳到第一条」链接。
- 其他阻断：任何未跳过的行 `date` 或 `amount` 为空；有正在保存失败的行。
- 转账行**不**阻断：没勾配对、也没填对手，就按单腿建（决策 §1.2 允许单腿）。
- 提交调 `POST .../commit`（无请求体，决策 §14.18），服务端在一个事务里建全部交易、两腿配对的行与已有行共用 `transfer_pair_id`（决策 §14.34）。期间显示遮罩进度。
- 成功 → 步骤 3；失败（409 `batch_already_committed` / 409 `rows_uncategorized` / 409 `rows_all_skipped` / 某行 400 校验失败）→ Toast + 把服务端指出的 `row_no` 高亮滚动到位。重复提交由 409 `batch_already_committed` 兜底（决策 §14.18）。

#### 4.11.9 手机上的降级方案

宽表在手机上不可用，改成**卡片流**，语义完全等价：

```
┌───────────────────────────────────┐
│ #2  08-03            ⚑重复  ⚠︎待归类│
│ 京东                    −¥1,299.00 │
│ 支出 ▾   [ 选择分类 ]              │
│ ⓘ 本批内有相同的行（第 9 行）      │
│ [编辑详情]              [跳过]     │
└───────────────────────────────────┘
```

- 一行一卡，最常改的两件事（kind、分类）直接在卡上；其余字段进「编辑详情」底部抽屉；转账行的配对勾选框直接放在卡上（唯一候选时它是勾上的，用户要能一眼看见并取消）；多候选那种的 `[选一条]` 按钮也放在卡上，点开是全屏选择器。
- 批量操作放在底部固定条：长按进入多选模式后出现。
- 顶部筛选切片保留，默认落在「待归类」——手机上最合理的用法是「只把待归类的补完，剩下的回电脑上处理」。

### 4.12 账本设置 `/l/:ledgerId/settings`

屏幕稿 `mockups/屏幕 12 · 账本设置.dc.html`。

- **端点**：`GET /ledgers/{id}`（带 `counts`）、`PATCH /ledgers/{id}`、`GET /ledgers/{id}/members`、`POST /ledgers/{id}/invites`、`DELETE /ledgers/{id}/invites/{code}`、`DELETE /ledgers/{id}/members/{user_id}`、`POST /ledgers/{id}/transfer-ownership`、`POST /ledgers/{id}/leave`、`DELETE /ledgers/{id}`。
- **基本信息**：账本名（owner 可改，1–100 字，决策 §14.13）。**基准币种**（owner 可改）——改之前弹警告（文案按决策 §8 的口径，屏幕稿里那句「按今天的汇率、改回来也回不去」是错的，见 §6.5.2 第 7 条）：

  > 改成 EUR 之后，首页统计和所有折算金额都会按 EUR 显示。折算用的是**每笔交易各自发生日的汇率**，原始金额和币种不变，改回 CNY 数字也会回来。将重新折算 1,284 笔交易。

  「将重新折算 N 笔」的 N 取 `ledger.counts.transactions`，**只给条数、不预演金额**（决策 §14.52 A9）。
- **成员列表**：每行显示 `display_name`（为空回退邮箱 `@` 前的部分，决策 §14.40 的 01-7）、邮箱、角色徽章、加入时间。**没有头像**（决策 §14.52 B22）。owner 行不可移除。
  - **权限说明**（按决策 §2，屏幕稿里写错了，见 §6.5.2 第 8 条）：owner 独占的只有「生成 / 作废邀请码、移除成员、改账本名与基准币种、转让 owner、删除账本」；**member 可以记账、改账、管理账户、导入、撤销导入**。
  - `member` 视角：成员列表只读，底部只有「退出这个账本」。
  - `owner` 视角：每行有「移出」（确认框说明「他记的账会保留在账本里」）；「转让创建者」下拉选一个成员 + 二次确认（转让后自己变成 member，界面立刻降权）。
- **邀请码**（决策 §2、§14.29、§14.35）：

```
┌─ 邀请码 ─────────────────────────────────────────┐
│            4 7 2 9 0 3          [复制]           │
│            09:41 后过期                          │
│  把这 6 位码线下告诉对方，让他在「加入账本」里输入。│
│  用掉就失效，一个码只能加入一个人。               │
│                          [作废]  [重新生成]      │
└──────────────────────────────────────────────────┘
```

  - 按钮「生成邀请码」→ 显示 6 位大字码 + **10 分钟倒计时**（由 `expires_at` 驱动，每秒刷新）+ 复制按钮。倒计时归零后码变灰并提示重新生成。
  - **一次性使用**：加入成功时服务端直接删除这行（决策 §14.29），所以「已使用」不是一个状态——下次拉成员列表发现多了人就把码卡换成「已被 <名字> 使用」并隐藏码。
  - **作废**（决策 §14.52 A2）：`DELETE /ledgers/{id}/invites/{code}`，二次确认「作废后这个码立刻失效，对方就用不了了」。作废成功后码卡消失。
  - **软限制**：成员满 10 人时生成按钮禁用并说明（决策 §2、§14.52 B7——屏幕稿写的 8 人是错的）。
- **加入端点的限流**（决策 §14.35）：`POST /ledgers/join` 是端点级 1 QPS，不是按人计数。这一页只需要在文案里说明「码在有效期内可以反复输入，输错不会锁定」；429 的处理在 §4.3。
- **退出**：member 直接退；owner 必须先转让（按钮禁用 + 说明，决策 §2）。
- **删除账本**（仅 owner，决策 §14.52 A22）：`tone: 'danger'` 确认框，**必须手打账本名**才能点确认，正文先把 `counts` 摊开：

  > 这会永久删除《家庭账本》里的 **1,284 条交易**、**7 个账户**、**12 批导入记录**，所有成员都会失去访问，无法恢复。
  > 请输入账本名以确认：`[__________]`

  成功后跳 `/ledgers`。
- **不做**：删账本前导出 CSV（决策 §14.52 A1）。

### 4.13 个人设置 `/settings`

屏幕稿 `mockups/屏幕 14 · 个人设置.dc.html`。**没有 LLM 设置页**（决策 §5、§6、§14.25：应用不接入大模型，`/settings/llm` 整条路由取消）。

- **端点**：`GET /me`、`PATCH /me`（`display_name` / `base_currency` / `language`）；币种列表 `GET /rates/currencies`。
- **只读**：邮箱、注册时间。**没有头像**（决策 §14.52 B22）。
- **显示名 `display_name`**（决策 §14.6、§14.40 的 01-7）：文本框，≤40 字，可留空。下面一行说明「账本成员列表、记账人、操作记录里显示它；留空就显示你邮箱 `@` 前面的部分（`ubwzwd`）」。留空提交的是显式 `null`。
- **默认币种**（`base_currency`）：一行说明「只影响新建账本时的默认值；已有账本的基准币种在各自的账本设置里改」（决策 §2）。
- **语言**：跟随系统 / 中文 / English（决策 §0.4）。切换立即生效（`i18n.changeLanguage`）并 `PATCH /me` 持久化；选「跟随系统」时把 `language` 置为显式 `null`（决策 §14.6）。
- **外观**（决策 §14.52 A23）：跟随系统 / 浅色 / 深色三选一。**只存本机，不上服务器**（`localStorage['wallet:theme']`，原生端 `AsyncStorage` 的 `@wallet_app:theme`）——同一个人在电脑上想要浅色、手机上想要深色是常态，同步反而添乱。三种取值直接喂给 §6 的 `ThemeProvider`；「跟随系统」时监听 `Appearance.addChangeListener`（Web 上是 `prefers-color-scheme` 的 `matchMedia` 监听），跟着实时切。深色的样子见 `mockups/屏幕 16 · 深色模式三屏.dc.html`。
- **入口**：账本设置、切换账本、登出。
- **不做**（决策 §14.52）：通知（B21）、换头像（B22）、导出我的数据 / 导出 CSV（A1）。

---

## 5. i18n

### 5.1 选型

**i18next 25 + react-i18next 16 + expo-localization**（决策 §0.4）。

| 候选 | 取舍 |
|---|---|
| **i18next + react-i18next**（选中） | 复数、插值、命名空间、`t(['a','b'])` 的 key 回退（§3.7 的错误映射直接用得上）、懒加载语言包、生态里有现成的 key 提取与缺失检测工具；跨 Web/原生同一套 API |
| `react-intl` (FormatJS) | ICU 消息格式更强、日期数字格式化一体化；但 API 更重，运行时体积更大，且 key 回退要自己写 |
| 自己写一个 `t()` | 只有两种语言时看着够用，但复数、插值、缺失 key 回退、语言切换重渲染都得重新实现一遍，不划算 |

`expo-localization` 负责读设备语言（`getLocales()[0].languageCode`）。语言决策顺序：`user.language`（服务端持久化，决策 §11 的 `PATCH /me`）→ `localStorage['wallet:lang']` → 设备语言 → `zh`。选了「跟随系统」时把 `user.language` 置为 `null`（`PATCH /me {"language": null}`，决策 §14.6），本地 `localStorage['wallet:lang']` 也一并清掉，并在设备语言变化时跟着变——语言字段没有 `'system'` 这个取值。

Web 上同时把 `<html lang>` 设成当前语言（现状固定 `lang="en"`，`frontend/public/index.html:2`）。

### 5.2 语言包结构与 key 命名

```
frontend/src/i18n/
  index.ts                 初始化、语言决策、changeLanguage、formatters
  locales/
    zh/
      common.json          按钮、通用动作、状态词
      auth.json            登录/注册
      ledger.json          账本、成员、邀请
      transaction.json     交易列表、记一笔、kind 名称
      source.json          账户
      stats.json           首页与统计
      import.json          导入指南、上传 / 粘贴、校验失败、review 表格、历史与撤销
      settings.json        个人设置（显示名、币种、语言、外观）与账本设置
      errors.json          §3.7 的 code → 文案
      validation.json      表单校验消息
    en/  （同上 9 个文件，key 完全一致）
```

命名规范：`<namespace>:<区域>.<元素>[.<变体>]`，全小写 snake_case，动词开头表示动作。

```jsonc
// zh/transaction.json（节选）
{
  "kind": { "expense": "支出", "income": "收入", "refund": "退款", "transfer": "转账" },
  "transfer": {
    "subtype": { "plain": "普通转账", "repayment": "信用卡还款" },
    "counterparty_toggle": "对方不在这个应用里",
    "single_leg_hint": "单腿转账会计入账户余额，但不进收支统计",
    "suggest_income": "如果这是别人给你的钱，记成收入统计更准"
  },
  "list": {
    "empty_no_data": "这个账本还没有交易",
    "empty_filtered": "没有符合筛选条件的交易",
    "clear_filters": "清空筛选",
    "drop_filter_hint": "去掉「{{label}}」会有 {{count}} 笔",
    "day_total": "当日支出 {{expense}} · 收入 {{income}}",
    "summary": "支出 {{expense}} · 收入 {{income}} · 净额 {{net}}",
    "from_batch": "来自导入 #{{batch}}",
    "count": "{{count}} 笔交易"
  },
  "detail": {
    "rate_used": "按 {{date}} 汇率 1 {{from}} = {{rate}} {{to}}",
    "pair_action": "关联为转账对腿",
    "unpair_action": "拆开",
    "duplicate_action": "复制一笔",
    "refund_action": "登记退款",
    "events_title": "操作记录",
    "event": {
      "created": "创建", "updated": "改动", "imported": "导入",
      "paired": "关联对腿", "unpaired": "拆开",
      "refund_linked": "关联退款", "refund_unlinked": "解除退款关联"
    }
  },
  "form": {
    "amount": "金额", "date": "日期", "merchant": "商户", "note": "备注",
    "save_and_next": "保存并记下一笔",
    "refund_over_hint": "这笔退款会让累计退款超过原单金额（原单 {{original}}，已退 {{refunded}}，本次 {{current}}）"
  }
}
```

规则：

- **界面上出现的每一个字都必须来自语言包**，包括 Toast、确认框、空态、校验消息、无障碍标签。代码审查里不允许 JSX 中出现中/英文字面量。
- 复数用 i18next 的 `_one` / `_other` 后缀（英文），中文只有 `_other`。
- 插值变量用具名（`{{amount}}`），不用位置参数。
- 两个语言包的 key 集合必须完全相同，由测试保证（§8.1）。

### 5.3 分类名不进语言包（决策 §1.3）

分类是后端常量，接口 `GET /categories` 同时给 `name_zh` / `name_en` 与一级分类的 `desc_zh` / `desc_en`（决策 §1.3、§11、§14.21）。前端：

```ts
export function categoryName(c: Category, lang: string): string {
  return lang.startsWith('zh') ? c.name_zh : c.name_en;
}

// 一级分类的说明文字（归类判据）；二级恒为 null，调用方据此决定要不要渲染那一行
export function categoryDesc(c: Category, lang: string): string | null {
  return lang.startsWith('zh') ? c.desc_zh : c.desc_en;
}
```

理由：分类表会随后端发版增删（决策 §1.3「想改就改代码发版」），如果名字同时存在于语言包和后端常量，两边必然漂移。同理，**币种全名**也来自 `GET /rates/currencies`（值是 Frankfurter 的英文名，现状文档 §5.4），中文界面只显示币种代码 + 符号，不硬翻币种名。

### 5.4 日期与金额格式化

集中在 `src/i18n/format.ts`，页面不直接调 `toLocaleString`（现状是散落的：`toLocaleDateString('en-US', …)`、`toFixed(2)` 拼币种代码，见现状文档 §10）。

```ts
// 金额：始终 tabular-nums，负号在最前，不用括号
formatMoney('-1299.0000', 'CNY', 'zh')   // '−¥1,299.00'
formatMoney('-1299.0000', 'CNY', 'en')   // '−CN¥1,299.00'
formatMoney('720.0000', 'EUR', 'zh')     // '€720.00'
// 折算金额（次要显示）
formatConverted('-1299.0000','CNY','-165.32','USD','zh')  // '≈ $165.32'

// 日期：列表按「相对 + 绝对」，详情用完整日期
formatDate('2026-08-14', 'zh')       // '8月14日'（今年）/ '2025年8月14日'（往年）
formatDate('2026-08-14', 'en')       // 'Aug 14' / 'Aug 14, 2025'
formatRelativeDay('2026-09-09','zh') // '今天' / '昨天'，否则回落到 formatDate
formatMonth('2026-08', 'zh')         // '2026 年 8 月'
formatMonth('2026-08', 'en')         // 'August 2026'
formatDateTime(iso, lang)            // '2026-08-14 09:12'
```

实现要点：

- 用 `Intl.NumberFormat(locale, {style:'currency', currency, minimumFractionDigits:2})`，但**小数位按币种**：JPY/KRW 用 0 位。JPY 之类零小数币种由 `Intl` 自己处理正确。
- 负号统一用 U+2212（−）而不是连字符，在等宽数字里对齐更好。
- 日期字符串是 `YYYY-MM-DD`（无时区），**必须按本地日期解析**（`new Date('2026-08-14T00:00:00')`），不能 `new Date('2026-08-14')`——后者按 UTC 解析，东八区会显示成前一天。现状 `frontend/src/screens/TransactionsScreen.tsx:82-95` 正是这个坑。
- 「今天」的判定用本地时区的当天，不用 `toISOString()`（现状 `frontend/src/screens/TransactionFormScreen.tsx:28` 的默认日期就是 UTC 的今天）。

---

## 6. 视觉设计（已定稿：04 柔和圆润）

> **视觉方向已经定稿，本节不再提方案**（决策 §14.45）。唯一事实来源是 [`./mockups/`](./mockups/README.md)：token 取 [`./mockups/tokens.json`](./mockups/tokens.json)，界面形态取同目录下的 17 张屏幕稿。本节只做三件事：把定稿的概念讲清楚、把 token 的**结构与使用规则**写下来（色值不在这里复制第二份）、把屏幕稿与本章页面小节对上号。

现状是没有设计的默认外观：14 个文件里 147 处字面量颜色、18 种色值、一个 `#0ea5e9` 蓝当强调色、emoji 当图标、没有深色模式（现状文档 §6.2；`frontend/app.json:8` 的 `userInterfaceStyle: "light"`）。重做的目标不是「更好看」，是**让这个应用一眼看上去不像模板**，并且让密集的数字表格（交易列表、导入 review 表格）真的好读。

### 6.1 概念

「**04 柔和圆润**」：淡鼠尾草绿的纸面底（`bg.canvas` `#F1F6F1`）上浮着近白的卡片，圆角偏大（分组容器 18、按钮与输入框 14），线是极淡的绿灰发丝线而不是灰黑框；文字用 Figtree 的圆润字形，金额与日期切到 IBM Plex Mono 的等宽数字。强调色是一支**森林绿**（`accent.solid` `#2F4A38`，深色下翻亮成 `#6FB98A`），只用在主按钮、焦点环、当前选中态上；四种 kind 各有自己的语义色（支出砖红 / 收入深青 / 退款橄榄金 / 转账板岩蓝），彼此不抢强调色的位置。整体气质是「一本摊开的、纸质偏软的账本」，不是仪表盘也不是 SaaS 后台——这正是决策 §0.3 要的效果（决策 §14.45）。

深色不是把浅色反相，而是另一套独立数值：底 `#111614` 带绿相，层次靠 `bg.surface → bg.raised` 的明度差而不是阴影（`shadow.note`），四种 kind 色整体提亮以保住对比度。

### 6.2 设计 token

**token 的唯一来源是 [`./mockups/tokens.json`](./mockups/tokens.json)**（决策 §14.45）。实现时的路径是：`tokens.json` →（一个生成脚本或一次性手抄）→ `frontend/src/theme/tokens.ts` → `ThemeProvider` 按 `light` / `dark` 提供。**组件只读语义名，任何组件里都不允许出现字面量色值**（这是对现状 147 处硬编码的直接修正）。色值不在本文档里复制第二份——两处都写必然漂移，要查具体值请打开 `tokens.json`。

`tokens.json` 的顶层结构与本章的对应关系：

| `tokens.json` 键 | 内容 | 前端怎么用 |
|---|---|---|
| `color.light` / `color.dark` | 各 43 个语义色（`bg.*` / `fg.*` / `border.*` / `accent.*` / `kind.*` / `status.*` / `flag.*` / `chart.series[0..7]`） | 两份完整的主题对象；组件只写 `theme.color['kind.expense']` 这样的语义名 |
| `font.sans` / `font.mono` | Figtree（含中文回退栈）/ IBM Plex Mono | §6.3 |
| `type.*` | 七档字号（`text.display` 40 … `text.micro` 11），每档带 `size` / `lineHeight` / `weight` | 直接映射成 `Text` 的 variant |
| `space.*` | 4 的倍数刻度，`space.1`=4 … `space.16`=64 | 布局间距只能取这些值 |
| `density` | C2：`listRowHeight` 56、`rowInnerPadding` 14、`containerPadding` 14–16、`cardGap` 12 | §6.3 |
| `radius` | `sm`=8、`md`=14、`lg`=18、`pill`=999 | §6.4 |
| `shadow` | `none` / `raised`（RN elevation 1）/ `overlay`（elevation 8） | 深色下不用阴影，用明度差分层 |
| `controls` | Button / TextField / Badge / Chip 的高度、圆角、变体 | §6.4 的尺寸表就是它 |
| `icons` | 20 网格、1.9 描边、圆头端点 | `react-native-svg` 画，颜色继承文字色 |
| `kindSemantics` | 两条硬规则，见下 | — |

**必须遵守的使用规则**（来自 `tokens.json` 与 [`./mockups/README.md`](./mockups/README.md)）：

1. **强调色不承担语义**。`accent.solid`（森林绿）只表示「这是主操作 / 焦点在这里 / 这一项被选中」。它**不表示收入**、不表示成功、不表示正数。收入用 `kind.income`（深青），成功用 `status.success.*`。
2. **转账金额不染语义色**（`kindSemantics.transferAmount`）：转账两腿的金额一律用 `fg.primary`，`kind.transfer`（板岩蓝）只出现在图标底和「转账」徽章上。理由是转账不改变净资产，把它染成红/绿会误导。
3. **分类圆点取 `chart.series[0..7]`，不取交易色**（`kindSemantics.categoryDots`）：首页分类排行的条形、趋势线、分类圆点都从这 8 个色里循环取，与四个 kind 色是**两套独立色板**，避免「餐饮的颜色看起来像收入」。
4. **Badge 是方 pill、只读**（`controls.badge`，高 26，`radius.sm`=8）；**Chip 是圆 pill、可点掉**（`controls.chip`，高 34，`radius.pill`）。徽章表达「系统给这行打的标记」（review 的四种 flag、还款、导入来源），Chip 表达「用户设的筛选条件，点 × 能去掉」。两者不可混用。
5. **危险操作用 `status.danger.*`，默认描边而不是实心**（`controls.button.notes`）；按下只换底色，不做缩放动画。
6. **数字一律 mono + `tabular-nums` + 真减号 U+2212**（`font.mono.use`、`typeNotes`），与 §5.4 的 `formatMoney` 对齐。
7. **颜色永远不是唯一的信息载体**：四个 kind、review 的四种标记、状态徽章都必须同时有图标或文字标签（无障碍要求）。所有前景/背景组合在浅色与深色两套下各验一遍 WCAG AA（正文 4.5:1，大字与图形 3:1）。

`tokens.json` 里没有、但实现时要补齐的两组（值可自定，不属于视觉定稿）：`z.*`（dropdown 100 / sticky 200 / overlay 300 / toast 400）与 `motion.fast`=120ms / `motion.base`=200ms（`prefers-reduced-motion` 时全部归零）；断点仍只有一个 `breakpoint.md`=1024（决策 §0.6）。

### 6.3 字体、字号与密度

- **正文与 UI**：`Figtree`（400 / 500 / 600 / 700），回退栈 `'Figtree', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif`——**中文走系统字**，不额外打包中文字体（一套思源黑体子集也有几百 KB，网页端不值）。Web 上用 `@font-face` 自托管 Figtree 的 latin 子集，不走第三方字体 CDN。
- **数字**：`IBM Plex Mono`（weight 450），用于**金额、日期、行号、百分比**，始终 `tabular-nums`，负号用 U+2212。字号与所在档位相同，只换字族，所以 mono 与 sans 的行高必须对齐（`type.*` 的 `lineHeight` 对两者通用）。
- **字号七档**（`type.*`）：`display` 40/44/700、`title` 28/34/700、`heading` 20/28/600、`subheading` 16/24/500、`body` 14/20/400、`caption` 12/16/400、`micro` 11/14/500。标题档（display / title）额外加 `letter-spacing: -0.02em`。
- **例外**：Web 上输入框实际渲染 16px（`frontend/public/pwa.css:4-6` 防 iOS 聚焦放大，§7.1），虽然 `text.body` 是 14——屏幕稿里的输入框就是按 16px 画的。
- **密度 C2**（`density`）：列表行高 **56**、行内边距 14、容器内边距 14–16、卡片间距 12。交易列表、账户列表、成员列表、导入历史都按 56 走；导入 review 表格的行更紧（它有自己的表格密度，见 §4.11）。

### 6.4 组件清单

`frontend/src/ui/` 下，每个组件跨 Web/原生同一份实现，**页面里一次都不出现 `Platform.OS`**。尺寸列直接取 `tokens.json` 的 `controls` / `radius` / `density`。

| 组件 | 尺寸（来自 `tokens.json`） | 变体 / 要点 |
|---|---|---|
| `Button` | 高 sm **36** / md **44** / lg **48**，圆角 **14** | `primary` / `secondary` / `ghost` / `danger`；`loading`、`iconOnly`；danger 默认描边；按下只换底色不缩放；最小命中区 44×44（`scripts/verify-touch-targets.mjs` 继续跑） |
| `TextField` | 高 **52**，圆角 **14** | 淡底无描边，聚焦出 1.5px `border.focus` 描边；错误态是淡红底 + 红描边，**不整行染红**；label / hint / error / 前后缀 / 字数上限 |
| `AmountField` | 同 `TextField` | 金额专用：mono + `tabular-nums` + 千分位，符号只读（由 kind 决定，§4.6），币种内嵌下拉 |
| `DateField` | 同 `TextField` | Web `<input type="date">` 封装在组件内部，原生用日期轮；替代现状 5 处裸 `<input>` |
| `Select` / `MultiSelect` | 触发器同 `TextField`，浮层圆角 **18** | 单选/多选下拉带搜索；替代现状 4 份复制的 Modal 选择器 |
| `CategoryPicker` | 选项行高 **56**（一级两行时按内容撑高） | 两级级联；**一级是两行选项**（名称 + `categoryDesc()` 判据，`text.caption`、`fg.muted`、单行截断，长按 / hover 看全文，决策 §14.21）；二级第一项固定是「不细分」；带输入过滤（可按判据文字搜，§14.52 A19）与最近使用置顶 |
| `SourcePicker` | 行高 **56** | 账户名 + 类型图标 + 币种 + 余额，排除归档 |
| `SegmentedControl` | 高 **44**，圆角 **14** | kind tab、转账子类型、review 的行内筛选切片 |
| `Card` | 圆角 **18**，间距 **12** | `flat` / `outlined` / `raised`（raised = `shadow.raised`，深色下换成 `bg.raised` 的明度差） |
| `DataTable` | 表头 sticky，行高 44（比 C2 更紧） | review 表格的底座：列定义、行虚拟化、键盘导航、行内编辑槽位、选中集合 |
| `Badge` | 高 **26**，圆角 **8**（方 pill） | 只读标记：`neutral` / `info` / `warning` / `danger` / `kind-*` / `flag-*`；带图标位 |
| `Chip` | 高 **34**，圆角 **999**（圆 pill） | 可点掉的筛选条件片（交易列表筛选栏、「来自导入 #12」、review 的行内筛选） |
| `BottomTabBar` | 高 56 + 安全区 | 五项 + 中央凸起 FAB（决策 §0.6） |
| `Sidebar` | 宽 240 | 宽屏导航 + 账本切换器；**只有首页 / 交易 / 账户 / 导入 / 账本设置 / 个人设置**，没有「报表」「成员」顶级页（决策 §14.52 A21） |
| `LedgerSwitcher` | 行高 **56** | 下拉：账本列表 + 新建 + 加入 |
| `EmptyState` | — | 图形 + 标题 + 一句话 + 主按钮；每个列表页有专属文案（屏幕 15） |
| `Toast` / `ToastHost` | 圆角 **14** | success / error / warning，错误可展开 detail（§3.9） |
| `ConfirmDialog` | 圆角 **18** | 标题 / 正文 / 危险态 / 需输入确认词（删账本要手打账本名，§4.12） |
| `Skeleton` | — | 行、卡、表格三种骨架 |
| `Sheet` | 顶部圆角 **18** | 窄屏底部抽屉（筛选、行详情、账本切换、快捷记账） |
| `ProgressBar` | 高 4，圆角 **999** | 上传进度、批量操作进度（**没有解析进度**——校验是同步的，§4.10） |
| `StatTile` | — | 首页大数：标题 + `text.display` 大数 + 小字副标（资产 / 负债 / 净资产三块用它） |
| `BarList` / `TrendChart` | — | 分类排行与 12 月**支出**趋势（决策 §14.52 B20）；颜色取 `chart.series`，数值标签直接可读，不只靠 tooltip |
| `EventTimeline` | 行高 44 | 交易详情的操作记录（`events[]`，决策 §14.51）：时间 + 人 + 动作 + 改了哪些字段 |
| `KeyboardHint` | — | review 表格与记一笔的快捷键帮助浮层（决策 §14.52 A19） |

### 6.5 实现前不再另出 mockup，以 `mockups/` 为准

决策 §14.45 已经关闭了「实现前先出 mockup 给用户看」这条流程要求：方向定稿了，17 张屏幕稿也画完了（2026-09-11 按裁定改过两轮并补了登录 / 注册屏，三轮复核结果见 [`./mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md)、[`./mockups/REVIEW-2026-09-11b.md`](./mockups/REVIEW-2026-09-11b.md)、[`./mockups/REVIEW-2026-09-11c.md`](./mockups/REVIEW-2026-09-11c.md)，**第三版复核的结论是屏幕稿可以作为前端实现的依据**），**实现阶段直接照 `mockups/` 做，不再另起一轮 mockup**。有疑问时的优先级是：`00-decisions.md` > `mockups/tokens.json`（token 值）> 屏幕稿（形态与文案）> 本章正文（行为细节）。屏幕稿与决策记录冲突的地方按 §6.5.2 修正，**以决策为准**。

#### 6.5.1 17 张屏幕稿索引（复核 2026-09-11c）

「按裁定需改之处」一列已按**第三版复核**刷新：屏幕稿按 [`./mockups/CLAUDE-DESIGN-CHANGES.md`](./mockups/CLAUDE-DESIGN-CHANGES.md) §4 第二轮提示词再改一次后于 2026-09-11 第三次导出（屏幕 02–12、15、16、17 更新；01、13、14 与 token 未变），逐条对照结果见 [`./mockups/REVIEW-2026-09-11c.md`](./mockups/REVIEW-2026-09-11c.md)：**第二轮的 66 条要求里 56 条已改、9 条部分落地、1 条未改、0 条改错**，上一轮 17 条 major 修掉 16 条，全局规则违反从 10 处降到 6 处，合并去重后仍有 **16 条**要回 Claude Design 改，结论是**屏幕稿可以作为前端实现的依据**。下表「已改（2026-09-11 第三版）」= 屏幕稿本身已经改好，实现时照稿做；其余是**屏幕稿还要改**的地方，本章正文已经按裁定写好了，两边不一致时以本章与决策记录为准。

| 屏幕稿文件 | 覆盖本章的哪些小节 | 按裁定需改之处（复核 2026-09-11c） |
|---|---|---|
| `屏幕 01 · 首页.dc.html` | §4.4 首页（资产 / 负债 / 净资产、账户余额卡、本月分类排行、12 月趋势） | 已改（2026-09-11 第二版；第三版未重新导出）：趋势只有支出（B20）、宽屏侧栏去掉「报表」「成员」并对齐五项导航（A21）。趋势右上的「月均 / 峰值」保留（2026-09-11 用户确认，已写进 §14.52 A21）。本轮无需回改（minor 见 REVIEW-2026-09-11b.md 的 m1–m4（第三版未重新导出，REVIEW-2026-09-11c 仅登记为未复核）：示例数字不自洽、`savings` key 与死图标仍在） |
| `屏幕 02 · 交易列表.dc.html` | §4.5 交易列表（筛选栏、按日分组、合并转账行、底部 summary） | 已改（2026-09-11 第三版）：1440 表头「交易内容」→「商户」（规则 2）、375 底部补「支出 / 收入 / 净额 · 不含转账」汇总条（A14）；第二版已落地的币种筛选、原币 + 折算（§14.49）、两腿合并行（B15）、去掉「导出 CSV」（A1）保持不变。**仍需改**：画板注释里七列描述的后半句仍写「交易内容」列（规则 2 的最后一处） |
| `屏幕 03 · 导入 review.dc.html` | §4.11 review 表格（列、徽章、行内筛选、批量操作） | 已改（2026-09-11 第三版）：1440 表头「商户」、「账户 来自文件」→「本批目标账户 · 整批一致，不可逐行改」、左侧卡片补「目标账户 招行储蓄卡」、示例第 5 行账户与整批一致、恢复 `refund_candidate` / `transfer_candidate` 徽章（§14.31）、转账行「对手账户 / 对方文字」二选一互斥（§14.53c）、单腿行不预填本批账户、窄屏展开面按 kind 分流。**仍需改**：转账行的「商户」单元格仍写「A → B」/「对方：X」，而这一列就是 CSV 的 `merchant` 字段，转账行应留空（规则 1）；375 画板说明仍写「账户只读」，没跟上 kind 分流 |
| `屏幕 04 · 记一笔.dc.html` | §4.6.1 支出 tab、§4.6.2 收入 tab（含分类选择器的两行选项、录入辅助） | **第三版首次复核**：已改分类判据与二级样例按决策 §1.3 的 `desc_zh` / 冻结表（C1–C3）、商户字段叫「商户」（C14）。**仍需改**：账户副标题「储蓄 · CNY」→「储蓄卡 · CNY」（§14.48，规则 4）；分类选择器只有支出的五个一级，切到「收入」不换表（规则 5，收入 6 个一级见 §1.3）；切到「转账」时「商户」输入框仍显示可填（规则 1）。**后两条是本节仅有的功能性缺口**，实现时以 §4.6.1 / §4.6.2（按 kind 切分类表）与 §4.6.4（转账无商户）为准 |
| `屏幕 05 · 记一笔 转账.dc.html` | §4.6.4 转账 tab（单腿 / 两腿 / 跨币种 / 还款） | 已改（2026-09-11 第三版）：画板说明「汇率 chip 夹在中间且可改」→「只读，显示发生日汇率」（A10）；第二版已落地的另一腿金额可手改、转账无商户 / 标题 / 分类（B16）、还款时转入只列信用卡（A11）保持不变。无 major 遗留（minor 见 REVIEW-2026-09-11c m12–m14：措辞不统一、单腿币种 chip、摘要写死「净资产不变」） |
| `屏幕 06 · 记一笔 退款.dc.html` | §4.6.3 退款 tab + 关联原支出选择器 | 已改（2026-09-11 第三版）：1440 选择器表头「商户」、「退回到账户」的「储蓄卡 · CNY」（§14.48）、选择器说明改成「仍可选，选中后提示超过可退金额，允许保存」（B10）。**仍需改**：顶注还剩一句「已全退的行不可选」，与同段前半句、宽屏说明和 JS 的可点逻辑矛盾（M6 两处只修了一处） |
| `屏幕 07 · 交易详情 转账.dc.html` | §4.7 交易详情（两腿转账、拆开、单腿配对） | 已改（2026-09-11 第三版）：两腿详情标题改成「交易 · 09-08 · 招行储蓄卡 → 建行信用卡」（B16）；第二版已落地的去「编号」（A6）与「余后」（A7）、操作记录（§14.51）、两腿「编辑 / 拆开 / 删除」与单腿「关联为转账对腿」保持不变。无 major 遗留（minor 见 REVIEW-2026-09-11c m18 / m19） |
| `屏幕 08 · 交易详情 支出与收入.dc.html` | §4.7 交易详情（`refunds[]`、原单摘要、汇率、操作记录、复制一笔 / 登记退款） | 已改（2026-09-11 第三版）：操作记录去掉「客户端 iOS」（规则 3）、375 右上角的分享图标换成「更多」三点（A8）；第二版已落地的去「编号」（A6）、同原单其它退款（A25）、操作记录含「改了什么」保持不变。无 major 遗留（minor：图标变量名仍叫 `iconShare`；退款分类跨屏对不上，m20 / m21） |
| `屏幕 09 · 账户列表与表单.dc.html` | §4.8 账户列表、§4.9 账户表单 | 已改（2026-09-11 第三版）：1440 画板说明改成「期初余额记在账户上、不生成任何交易」（B5）、资产 37,842.10 / 净资产 34,627.10 三处一起改对（§14.50）；第二版已落地的四种类型（§14.48）、信用卡填欠款存负数（A13）、分组小计 / 归档不计入 / 币种不可改（A12、§14.50）保持不变。无 major 遗留（minor 见 m22–m25：内部 key 仍是 `savings`、侧栏缺「我的」「记一笔」） |
| `屏幕 10 · 导入指南与上传.dc.html` | §4.10 步骤 0 导入指南、步骤 1 上传或粘贴 CSV | 已改（2026-09-11 第三版）：错误样例行改成 `2026-09-07,-128.00,CNY,expense,,,美团外卖,,food,lunch`（负金额 + 分类 code + 故意 10 列）、`skillVersion` / `skillVersionShort` 已删；第二版已落地的只做 CSV（B4 / §14.47）、11 列固定表头（B3）、行级问题进 review（B2）、「复制错误清单」（A18）保持不变。**仍需改**：画板说明仍写「skill 版本号常驻在标题右边」，描述的是已删掉的 badge |
| `屏幕 11 · 导入历史.dc.html` | §4.10 步骤 4 结果与撤销、历史批次列表 | 已改（2026-09-11 第三版）：批内 / 批外退款笔数统一成「批内 1 笔退款；批外 2 笔退款指向本批原单」，与撤销对话框（B24）一致；第二版已落地的两种批次状态（B1）、批次行补上传人（A17）保持不变。无 major 遗留（minor：这段备注在 1440 会被截断、在 375 根本不渲染） |
| `屏幕 12 · 账本设置.dc.html` | §4.12 账本设置（成员、邀请码、基准币种、删除） | 已改（2026-09-11 第三版）：改基准币种的警告只留「将按各自发生日的汇率重新折算全部 328 笔交易」（A9，预演数字与「148 笔」已删）、删账本对话框去掉「导出 CSV」（A1）、设置主页 1440 侧栏去掉「成员」并对齐五项导航（A21）、邀请说明去掉「App」（规则 3）。**仍需改**：画板说明仍在推销被删掉的净资产 / 月支出预演数字（与 A9 矛盾）；删除账本那块 1440 的侧栏仍只有「首页 + 账本设置」两项，没跟着改成五项 |
| `屏幕 13 · 账本列表与加入.dc.html` | §4.3 账本列表 / 新建 / 加入 | 已改（2026-09-11 第二版；第三版未重新导出）：去掉输码即预览（B17）、卡片只留成员数与基准币种（A16）。无 major 遗留（minor 见 REVIEW-2026-09-11b.md 的 m35 / m36（第三版未重新导出）；示例数据里的 `net` / `count` 已无引用，属死值） |
| `屏幕 14 · 个人设置.dc.html` | §4.13 个人设置（display_name、默认币种、语言、外观） | 已改（2026-09-11 第二版；第三版未重新导出）：去掉通知（B21）、换头像（B22）、导出我的数据（A1），加「外观」跟随系统 / 浅色 / 深色且只存本机（A23）。无 major 遗留（minor 见 REVIEW-2026-09-11b.md 的 m37 / m38（第三版未重新导出）；`iconBell` / `changeAvatar` 是死资源） |
| `屏幕 15 · 空状态.dc.html` | 各页空态（§4.3、§4.4、§4.5、§4.8、§4.10）与筛空提示（§4.5） | 已改（2026-09-11 第三版）：1440 空交易表头「商户」（规则 2）、引导页场景改成「退出了最后一本账之后」（§14.40 的 01-8，与决策 §2「注册自动建默认账本」一致）；第二版已落地的「一本账都没有」引导页（B19）、「分类是内置的、不可改」（C12）保持不变。无 major 遗留（minor：页头仍写「空状态 × 3」而实际有四段；m40 侧栏缺「我的」） |
| `屏幕 16 · 深色模式三屏.dc.html` | §6.1 的深色主题、§4.13 的外观开关 | **第三版首次复核**：深色首页已跟着屏幕 01 重出、深色 review 已同步三态 chip / 表头「商户」/ 第 5 行账户、深色记一笔已换成冻结表的判据与一级名。**仍需改**：深色记一笔的账户行仍写「储蓄 · CNY」（规则 4）；深色 review 第 8 行仍预填本批账户且缺 `transfer_candidate` 徽章（§14.53b/c）；「本次导入」卡缺「目标账户」行、对手列缺「二选一」控件、侧栏缺「我的」；二级样例缺「夜宵」、交通判据少一句（§1.3） |
| `屏幕 17 · 登录与注册.dc.html`（2026-09-11 新增） | §4.1 登录 `/login`、§4.2 注册 `/register`（含 `registration_open=false` 的注册已关闭态） | 已改（2026-09-11 第三版）：注册页副标题改成「注册后会自动为你建一本『我的账本』，也可以用邀请码加入别人的」（决策 §2、§14.37 P-17）、补三个错误态（口令错 / 邮箱已注册 / 429 限流，与 §3.7 的 `invalid_credentials` / `email_exists` / `login_rate_limited` 对得上）；第二版已落地的登录页、注册页、注册已关闭态保持不变。**仍需改**：登录错误副文案发明了「连续错 5 次会暂时锁定」（决策只有同 IP 每分钟 10 次限流）；注册表单不收 `base_currency`，而 `POST /auth/register` 必填、且 `display_name` 按 03 §5.1 注册时为 NULL——**注册字段按决策 §14.54 定：邮箱、口令、默认币种，不收显示名**，稿子补币种下拉、去掉显示名字段；§4.2 不改 |

另外两张辅助画板不对应页面，只作实现参考：`Design Tokens v2 · 定稿.dc.html`（token 定稿：颜色表、字体、间距、图标集、各控件状态）与 `04 柔和圆润 · 深化.dc.html`（方向深化过程）。`Ledger Design Tokens v1.dc.html`、`风格样片 · 选项对照.dc.html`、`配色 · 三步走.dc.html` 是探索记录，**不作为实现依据**。

全部屏幕稿的通用修正：分类判据与二级样例按决策 §1.3（第三版里屏幕 04 已改到位，屏幕 16 的二级样例与判据还差两处）；商户字段一律叫「商户」（第三版里 02、03、06、15 的宽屏表头都已改，只剩屏幕 02 的一句画板注释）；去掉「App」「客户端 iOS」字样（第三版里 08、12 的遗留已清，17 张屏幕稿全文 0 命中，探索用辅助画板不作数，本版本只有网页端，决策 §0.1）；账户类型副标题一律写「储蓄卡」（第三版里屏幕 04、16 各剩一处）。屏幕稿的示例数字（月均、分类合计、净资产、退款金额）有多处对不上，实现时**不要照抄画板里的数**，按接口返回值算；画板里的内部 key 同样不作数（账户类型是 `checking`，不是 `savings`），以 [`./02-database.md`](./02-database.md) 与 [`./03-backend-api.md`](./03-backend-api.md) 为准。

#### 6.5.2 与决策的差异（复核 2026-09-11c）

屏幕稿是设计工具里画的，有几处与决策记录不一致。**一律以决策记录为准**，实现时按下表修正；它与 §6.5.1 的表是同一批裁定的两种切法（按主题 / 按屏幕）。「屏幕稿现状」一列按**第三版复核**（[`./mockups/REVIEW-2026-09-11c.md`](./mockups/REVIEW-2026-09-11c.md)）刷新：标「已改」的条目屏幕稿里已经修好，留在表里只为存档；标「仍在」的实现时务必按「以决策为准」那一列做。第 17–19 行是第三版复核新补的差异（屏幕 04、16、17 本轮才首次或再次对照）。

| # | 屏幕稿里是什么 | 以决策为准应该是什么 | 屏幕稿现状（复核 2026-09-11c） | 依据 |
|---|---|---|---|---|
| 1 | 分类选项下的「判据」文字是设计示意，与 §1.3 不一致（买菜、水电、衣物、家电、订阅、旅行的归属都写反了） | **判据文字以决策 §1.3 的 `desc_zh` / `desc_en` 为准**，由 `GET /categories` 下发，前端不硬编码任何一句 | 已改（2026-09-11 第三版）：屏幕 04 本轮首次复核，判据逐字取自 `desc_zh`；屏幕 01 / 02 / 03 的分类样例全部落在冻结表内。**屏幕 16 的交通判据少一句「旅游期间的交通归旅游」** | 决策 §1.3、§14.21；`mockups/README.md` 末尾也这么说 |
| 2 | 二级分类样例里有不在冻结表内的 code | 二级只能出现在 §1.3 冻结表里的 code | 已改（2026-09-11 第三版）：屏幕 04 的二级全部换成冻结表条目。**屏幕 16 的餐饮二级缺「夜宵」** | 决策 §1.3 |
| 3 | 导入历史有第三种状态「已撤销」，撤销后批次留在列表里 | 状态只有 `ready` / `committed`；撤销 = 整批删除，批次从列表里消失 | 已改（2026-09-11 第二版，屏幕 11） | 决策 §5、§14.22 |
| 4 | 校验失败样例把「kind 无法识别 / 缺分类 / 日期格式错」当成整份退回 | 这些是**行级**问题，不丢行只打标记；只有结构错误（缺 `# version:` 行 / 表头不符 / 列数不对）才 400 | 已改（2026-09-11 第二版，屏幕 10）；样例行本身的金额符号与分类 code 第三版也已改对（`-128.00` / `food` / `lunch`） | 决策 §5 |
| 5 | skill 的 CSV 列里有 `counterparty`、`flags` | 固定 **11 列**表头，skill 不输出 `counterparty`，`flags` 是服务端打的 | 已改（2026-09-11 第二版，屏幕 10） | 决策 §5、§14.16 |
| 6 | 账户表单说期初余额会生成一条「建账」交易 | `opening_balance` 是**账户上的一列**，不是交易；不加第五种 kind | 已改（2026-09-11 第三版，屏幕 09）：正文与 1440 画板注释都写「期初余额记在账户上、不生成任何交易」，全文无「建账」 | 决策 §3、§1 |
| 7 | 改基准币种说「按今天的汇率重新折算、改回来也回不去」 | 折算用**发生日**汇率、读取时计算，改回去数字就回来 | 已改（2026-09-11 第三版，屏幕 12）：文案与警告块都只剩「将按各自发生日的汇率重新折算全部 328 笔交易」，预演数字与「148 笔」已删。**只剩一句画板说明还在推销被删掉的预演数字** | 决策 §8、§14.52 A9 |
| 8 | 「撤销导入」标成 owner 独占，权限表漏「管理账户」 | member 可以记账、改账、导入、撤销导入、管理账户 | 已改（2026-09-11 第二版，屏幕 12） | 决策 §2 |
| 9 | 交易详情显示编号 `#0142`、每条腿显示「余后」余额 | 都不做 | 已改（2026-09-11 第二版，屏幕 07 / 08） | 决策 §14.52（A6、A7） |
| 10 | 跨币种转账的汇率 chip 可编辑 | 汇率只读（只作参考），要调只能改另一腿的金额 | 已改（2026-09-11 第三版，屏幕 05）：控件与画板说明都写「只读，显示发生日汇率」 | 决策 §14.52（A10） |
| 11 | 账本卡片显示净资产与交易数；输满 6 位码就地预览账本 | 卡片只显示成员数与基准币种；输码没有预览，只有 `POST /ledgers/join` | 已改（2026-09-11 第二版，屏幕 13） | 决策 §14.52（A16、B17） |
| 12 | 个人设置有通知开关、换头像、导出我的数据 | 都不做 | 已改（2026-09-11 第二版，屏幕 14）；**删账本对话框里的「先去导出 CSV」第三版也已删掉**（屏幕 12，全文无「导出」） | 决策 §14.52（B21、B22、A1） |
| 13 | 出现「App」「客户端 iOS」字样 | 本版本只有网页端；操作记录里的 `client` 显示成 `web` 或留空 | 已改（2026-09-11 第三版）：屏幕 08 的操作记录与屏幕 12 的邀请说明都已改写，14 张稿子全文 grep 0 命中 | 决策 §0.1、§14.51 |
| 14 | 转账行的标题写成商户式的「还信用卡」；导入 review 的账户说「来自文件」 | 转账标题是「A → B」/「对方：X」（不设商户）；导入的账户是上传时手选的**整批目标账户**，CSV 11 列里没有账户列 | 部分已改（2026-09-11 第三版）：屏幕 07 的两腿详情标题、屏幕 03 的「本批目标账户」与第 5 行账户都改好了。**仍在**：屏幕 03（与 16）把「A → B」/「对方：X」写进了 `merchant` 列，屏幕 04 的转账表单仍有「商户」输入框——转账的 `merchant` 必须为空，标题是展示层拼的 | 决策 §1.4、§14.52（B16）、§5、§14.38 P-25 |
| 15 | 导入 review 的示例行没有 `refund_candidate` / `transfer_candidate` 徽章 | 自动标记有 duplicate / refund_candidate / transfer_candidate / needs_review 四种，徽章记录的是「当时找到过候选」这件事，与配对勾选（`matched_transaction_id`）是两码事 | 已改（2026-09-11 第三版，屏幕 03 恢复了第 3 / 4 / 8 行的徽章，见 §4.11.4）。**屏幕 16 的深色 review 第 8 行仍缺 `transfer_candidate` 徽章，且多候选行按 §14.53b 还应另打 `needs_review`** | 决策 §5、§14.31、§14.53b |
| 16 | 屏幕 15 的引导页与屏幕 17 的注册页都假设「注册完一本账都没有」 | 决策 §2 是注册时自动建一本「我的账本」（基准币种 = 用户默认币种），注册后不可能零账本 | 已改（2026-09-11 第三版）：屏幕 17 的副标题改成「注册后会自动为你建一本『我的账本』，也可以用邀请码加入别人的」，屏幕 15 的 D 页场景改成「退出了最后一本账之后」 | 决策 §2、§14.40（01-8） |
| 17 | 屏幕 04 的分类选择器只有支出的五个一级，切到「收入」tab 后列表不变 | 分类表按 kind 分：支出 16 个一级、收入 6 个一级（工资 / 兼职 / 理财 / 报销 / 人情往来 / 其他），随 `GET /categories` 下发；退款沿用支出表（分类默认同原单） | **仍在**（屏幕 04，第三版首次复核）；实现按 §4.6.1 / §4.6.2，不照稿做 | 决策 §1.3、§1（退款是 kind 不是收入分类） |
| 18 | 屏幕 17 的注册表单收「邮箱 / 口令 / 显示名」，不收基准（默认）币种 | `POST /auth/register` 的 `base_currency` 必填（它同时是自动建的「我的账本」的基准币种）；`display_name` 注册时为 NULL，之后在个人设置里填 | **仍在，回 Claude Design 改稿**：按决策 §14.54，稿子补「默认币种」下拉、去掉显示名字段，与 §4.2 对齐（见 [`./mockups/REVIEW-2026-09-11c.md`](./mockups/REVIEW-2026-09-11c.md) 的 N7） | 决策 §2、§14.40；[`./03-backend-api.md`](./03-backend-api.md) 的 `POST /auth/register` |
| 19 | 屏幕 17 的登录错误副文案写「连续错 5 次会暂时锁定」 | 登录侧只有**同 IP 每分钟 10 次的限流**（`login_rate_limited`，429 + `Retry-After`，窗口最多 60 秒），没有任何「连错 N 次锁账号」的机制 | **仍在**（屏幕 17，第三版新引入）；文案按 §3.7 的 `login_rate_limited` 一条写，不要发明锁定策略 | 决策 §9；[`./03-backend-api.md`](./03-backend-api.md) 的错误码注册表 |

---

## 7. PWA 与构建

沿用现状（[`../current-design/04-frontend.md`](../current-design/04-frontend.md) §7、§8）：`frontend/public/` 里的 `manifest.json` / `index.html` / `pwa.css` / `offline.html`、`workbox generateSW` 生成 `dist/sw.js`、`registerSW.ts` 在 Web 上注册、`expo export -p web` 产出 `dist/` 交给 Caddy（决策 §0.1 部署沿用现状）。以下是必须调整的点。

### 7.1 保持不变的

- `pwa.css` 的 `input, select, textarea { font-size: 16px !important; }`（`frontend/public/pwa.css:4-6`）——防 iOS Safari 聚焦放大。设计 token 里 `text.body` 是 14px，但 Web 上输入框实际渲染 16px，这是有意的，mockup 里要按 16px 画输入框。
- `viewport-fit=cover`（`frontend/public/index.html:6`）+ `SafeAreaProvider`（`frontend/App.tsx:38`）。
- 图标生成脚本 `frontend/scripts/generate-icons.mjs`（背景色 `#0ea5e9` 要换成 `tokens.json` 的 `accent.solid` `#2F4A38`）。
- `scripts/verify-pwa.mjs` 与 `scripts/verify-touch-targets.mjs` 的检查项继续跑。

### 7.2 必须调整的

| 项 | 现状 | 目标 | 原因 |
|---|---|---|---|
| `navigateFallback` | `/offline.html`，denylist 只排除 `/api`（`frontend/workbox-config.cjs:33-34`） | `navigateFallback: '/index.html'`，denylist `[/^\/api/]`；离线由应用内的离线条处理 | 现状下任何非 `/` 的导航都会拿到 `offline.html`，**即使在线**（现状文档 §7.4）。v3.0 有真实路由（§1.2），深链接是核心功能，这条必须改，否则刷新 `/l/xxx/transactions` 就白屏 |
| `api-cache` 运行时缓存 | `NetworkFirst`，缓存全部 `/api/` GET，登出不清（现状文档 §7.4） | 只缓存 `GET /api/v1/categories`、`GET /api/v1/import-format`、`GET /api/v1/rates/currencies`（`CacheFirst`，30 天）；其余 API 请求 `NetworkOnly` | 账本数据是多人共享的（决策 §2），从 service worker 缓存里读到别人已经改过的旧数据比报错更糟；另外缓存按 URL 键控，换用户不换 key |
| 登出清缓存 | 无 | `logout()` 里 `caches.delete('api-cache')` + `queryClient.clear()` | 共用设备时不能把上一个用户的数据留在磁盘上 |
| 更新提示 | 无（新 worker 直接 `skipWaiting`，用户下次刷新才拿到新代码，现状文档 §7.5） | 保留 `skipWaiting`，另加：检测到 `controllerchange` 时弹一条 Toast「已更新到新版本，刷新以使用」 | 避免用户在旧 bundle 上遇到已修的 bug |
| `manifest.json` 的 `theme_color` / `background_color` | `#0ea5e9` / `#ffffff` | 取 `tokens.json`：`theme_color` = `accent.solid` `#2F4A38`，`background_color` = 浅色的 `bg.canvas` `#F1F6F1`，与启动屏一致 | 视觉定稿（决策 §14.45） |
| `app.json` 的 `userInterfaceStyle` | `"light"`（`frontend/app.json:8`） | `"automatic"` | §6 是深浅双主题；实际生效的是 §4.13 存在本机的「外观」设置（决策 §14.52 A23），`automatic` 只是它「跟随系统」时的底座 |
| `API_BASE_URL` 的切换方式 | `build:web` 用 `cp config.prod.ts config.ts` 覆盖，失败时会把生产配置留在工作区（`frontend/package.json:10`） | 改成 `app.config.ts` + `EXPO_PUBLIC_API_BASE_URL` 环境变量，`config.prod.ts` / `config.dev.ts` 两个文件删除 | 现状那条命令链是脆的，且三个 config 文件容易漂移 |
| `offline.html` | 保留 | 保留，但只在 precache 缺失时兜底 | 不再作为导航回落 |
| 上传大小与类型 | 无客户端限制 | 客户端先判 **2 MB** 且扩展名必须是 `.csv`（决策 §5、§9、§14.47） | 省一次失败的往返；类型不对时的提示要指回导入指南（§4.10） |

### 7.3 构建

`package.json` 脚本目标形态：

| 脚本 | 命令 |
|---|---|
| `web` | `expo start --web` |
| `build:web` | `EXPO_PUBLIC_API_BASE_URL=/api/v1 expo export -p web && npx workbox generateSW workbox-config.cjs` |
| `test` | `jest` |
| `typecheck` | `tsc --noEmit` |
| `lint` | `eslint . --max-warnings 0`（本阶段未配置 eslint，见 PROGRESS；同步 2026-09-12） |
| `verify` | `npm run typecheck && npm run lint && npm test && npm run build:web && node scripts/verify-pwa.mjs --all && node scripts/verify-touch-targets.mjs` |

`build:web` 不再改动工作区文件，`config.prod.ts` / `config.dev.ts` 一并删除。

---

## 8. 测试

现状的 5 个测试套件全是 `fs.readFileSync` + 字符串断言，没有一个渲染组件（现状文档 §9.2）。这类测试在重写中一条都活不下来，也不该活下来。目标是三层：

### 8.1 单元测试（纯函数，`jest`，无渲染）

| 对象 | 用例 |
|---|---|
| `normalize(params)`（§3.5） | 空值删除、数组排序、键序稳定 → 相同筛选状态产出相同 key |
| URL ↔ 筛选状态互转（§1.3） | 往返一致；数组用重复键；空值不出现在 URL 里；`import_batch_id` 能进能出 |
| `formatMoney` / `formatDate` / `formatMonth`（§5.4） | 负号用 U+2212；JPY 零小数；`'2026-08-14'` 在 UTC+8 下显示 8 月 14 日**不是** 13 日；「今天/昨天」按本地时区 |
| kind → 金额符号 | 四种 kind 各自的符号规则（决策 §1） |
| 分类可用集 | `kindAllows('expense')` 只返回支出树；`'transfer'` 返回空（决策 §1.3） |
| **两腿转账合并**（§4.5，决策 §14.52 B15） | 同 `transfer_pair_id` 的两条合成一行且计数按合并后算；单腿不合并；只有一条腿在本页时不拼接、按单条渲染 |
| **资产 / 负债 / 净资产求和**（§4.4、§4.8，决策 §14.50） | 信用卡进负债、其余进资产；**归档账户不计入**；`balance_base` 为 `null` 的账户不按 0 算而是进「无法折算」计数 |
| 待归类判定（§4.11.4） | `skipped` 行不算；`transfer` 行不算；`category_l1` 为空的 expense 行算 |
| 信用卡期初余额换算（§4.9，决策 §14.52 A13） | 类型为 `credit` 时输入 `3204` 提交成 `-3204.0000`；切换类型时符号正确翻转 |
| `errorMessage` 映射（§3.7） | 已知 code 命中文案；未知 code 落到 `errors.unknown` 且带 detail |
| **`errors.*` 与后端注册表对齐**（§3.7） | 一个用例把 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的 code 清单写成常量数组，**双向**断言：`zh` / `en` 两个语言包里每个 code 都有 key，且语言包里**没有注册表之外的死 key**。唯二的例外是 §3.7 表外那两个前端本地 key（`network_error`、`unknown`），用例把它们写进白名单 |
| 语言包完整性 | `zh` 与 `en` 的 key 集合完全相同；没有空字符串；插值变量名两边一致 |

### 8.2 API 层测试（mock adapter，不打真网络）

用 `axios-mock-adapter` 或 `msw`：

| 用例 | 断言 |
|---|---|
| 请求拦截器 | 有令牌时带 `Authorization`；无令牌时不带；`GET /config` 与 `GET /import-format` 在匿名下也能发 |
| 401 响应 | 触发 `onUnauthorized()` 恰好一次；`GET /me` 的 401 走引导路径不重复触发 |
| 422 响应 | `ApiClientError.fields` 按 `loc` 正确拆分；`code === 'validation_error'`；**不出现** `[object Object]`（这是现状的真实 bug，现状文档 §5.3） |
| 409 `stale_update` | 抛出的 `ApiClientError.code === 'stale_update'`、`status === 409` |
| 400 `import_format_invalid` / `skill_outdated` | 结构化体（`errors[]` / `current_version` / `file_version` / `guide_url`）挂在 `ApiClientError.payload` 上，没有被字符串化 |
| 网络失败 | `status === 0`、`code === 'network_error'` |
| 每个 API 函数 | 请求方法、URL（含 `ledgerId` 拼接）、query 序列化（数组用重复键）、body 形状；上传走 `uploadClient` 且不设 `Content-Type`；粘贴走普通 JSON 实例 |
| 失效矩阵（§3.6） | 每个 mutation 触发后，断言 `queryClient` 上被 invalidate 的 key 集合与矩阵一致；`patchRow` **不** invalidate 整表、`patchRows` **会** |

### 8.3 组件 / 集成测试（`@testing-library/react-native`，已装未用：`frontend/package.json:38`）

跑真实渲染 + 用户事件，`QueryClientProvider` 用每个测试新建的 client（`retry: false`）。

| 范围 | 关键用例 |
|---|---|
| 路由守卫（§1.5） | 未登录访问 `/l/x/transactions` → 落到 `/login?next=…`；登录后回到原 URL；`ledgerId` 不在列表 → 渲染「不存在或无权限」而**不是**自动跳转 |
| `LedgerContext` | 切账本保留路由形态、丢弃 id 类筛选、写 `last_ledger_id` |
| 登录页 | 401 后表单**不被清空**、错误可见（现状的反面，现状文档 §2.5） |
| 注册页（§4.2，决策 §14.46） | `GET /config` 返回 `registration_open:false` → **渲染提示卡而不是表单**；返回 `true` → 渲染表单；提交后 403 `registration_closed` → 切到提示卡 |
| 记一笔 — 四 kind | 支出提交负金额、收入正金额；transfer tab 不渲染分类控件与商户框；退款 tab 关联原单后分类被预填且可改；超额退款只警告不阻断；已退完的原单**仍可选中**（决策 §14.52 B10） |
| 记一笔 — 转账（决策 §14.52 A11） | 两腿同币种时只有一个金额框；改一边币种后第二组金额框出现且汇率 chip **只读**；子类型选「还款」时转入账户只列 `credit` 账户；勾「对方不在应用里」后币种框变只读且提交走普通 `POST`；两腿走 `POST .../transfer` 且只发一次请求，body 是扁平的 |
| 交易列表（§4.5） | 改筛选写进 URL；从 URL 恢复筛选；清空筛选回到裸路径；分页 `offset` 进 URL；两腿转账渲染成**一行**；日期头显示当日小计；底部汇总用 `summary` 而不是当前页加总；`?import_batch_id=` 渲染出「来自导入 #x」Chip 且可点掉；筛空时**最多发 2 个**探测请求 |
| 交易详情（§4.7） | 支出详情列出 `refunds[]` 与已退 / 可退；退款详情显示原单摘要与同原单的其它退款；`events[]` 按时间倒序渲染、人名用 `display_name` 回退邮箱前缀；两腿转账有「拆开」、单腿有「关联为转账对腿」且选择器只列反向单腿；「复制一笔」把日期改成今天 |
| 账户列表 / 表单（§4.8、§4.9） | 按四种类型分组且每组有小计；归档账户不计入三个数并显示归档时间；编辑页 `default_currency` **只读**；`credit` 类型的期初余额输入正数存负数 |
| 编辑 + 409（§3.8） | mock 409 → 提示出现、数据被重取、用户改过的字段保留、**没有自动重发** |
| 账本设置（§4.12） | member 看不到 owner 专属按钮但看得到「导入 / 撤销导入 / 管理账户」的说明；owner 未转让时「退出」禁用；邀请码倒计时归零后失效；「作废」调 `DELETE .../invites/{code}` 后码卡消失；删除账本必须手打账本名且确认框里出现三个 `counts` |
| 个人设置（§4.13） | 「外观」三选一写进 `localStorage['wallet:theme']` 且**不发 `PATCH /me`**；「跟随系统」时改系统主题会跟着变；`display_name` 留空提交显式 `null` |

### 8.4 review 表格的关键用例（§4.11）

这张表最复杂，单独列：

1. **待归类阻断**：3 行缺 `category_l1` → 提交按钮禁用且提示写「还有 3 行没有一级分类」；把其中 1 行标 `skipped` → 变成 2 行；补齐最后一行 → 按钮可用。
2. **transfer 行不算待归类**：`kind='transfer'` 且分类为空，不进阻断计数，分类格与商户格都禁用。
3. **改 kind 联动**：把一行从 `expense` 改成 `transfer` → 分类被清空且禁用、「关联 / 对手」格变可用、金额符号跟着 kind 规则走。
4. **行内编辑落库**：改商户 → 500ms 后恰好发一次 `PATCH`，body 只含 `merchant`；请求失败 → 值回滚且该格出现重试。
5. **不被后台刷新打断**：正在编辑某格时触发窗口聚焦 → 不发生 `refetch`（`refetchOnWindowFocus: false` 生效）。
6. **转账配对建议**（决策 §14.34、§14.53b/c）：`flags` 含 `transfer_candidate`（唯一候选）→ 勾选框**默认勾上**、显示对方账户与金额；取消勾选恰好发一次 `PATCH`，body **只有** `{matched_transaction_id: null}` 这一个键，勾选框随之空掉。多候选的行 → `flags` **同时含** `transfer_candidate` 与 `needs_review`（与 03 §5.40 / 05 §3.3 / 01 §3.15 一致），但 `matched_transaction_id` 为 `null`（勾选框空着），渲染 `hint`「找到 3 条可以配对的转账，请选一条」+ `[选一条]` 按钮；点开选择器发的是**交易列表**请求（带 `kind=transfer` 等筛选），选中一条后 `PATCH` 的 body 是 `{matched_transaction_id: '<id>'}`。没有 `matched_transaction_id` 的转账行 → 对手账户 Picker 与 `counterparty` 文本框都**不预选 / 不预填**，两者互斥（填了一个另一个禁用），Picker 里**不出现已归档账户**。
7. **退款候选**：`refund_candidate` 行显示预填的原单摘要，改选后 `PATCH` 的 body 里是 `matched_transaction_id`，清空后该行提交时不写 `refund_of`。
8. **批内重复行**（决策 §14.31）：两行完全相同 → **两行都在**、都带 `needs_review` 徽章、`hint` 显示「本批内有相同的行（第 N 行）」；**没有「已合并」徽章**。
9. **批量操作**（决策 §14.52 A4）：选 5 行（kind 都能接受这个分类）→ 设支出分类 → 恰好发**一次** `PATCH .../rows`（不是 5 次），响应的 `rows` 回填进表格；选中集合里混进一行收入行时服务端回 400，断言**一行都没被改**（整表重取后 5 行都是原值）且出错行号被高亮；批量跳过后提交计数相应减少。
10. **行内筛选切片**：全部 / 待归类 / 有标记 / 已跳过 四片计数正确；切片不清空选中集合。
11. **徽章渲染**：`flags: ['duplicate','needs_review']` 的行同时渲染两个徽章，且各带**文字标签**（不只颜色）；四种之外的值不会渲染出徽章。
12. **键盘导航**：`↓` 移动焦点行、`Enter` 进入编辑、`Esc` 恢复原值、`S` 切跳过、`[`/`]` 在待归类行之间跳、`⌘/Ctrl+Enter` 在阻断条件下**不触发**提交；`C` 打开分类选择器且输入判据文字能搜到分类。
13. **提交**：`POST .../commit` 恰好一次且**无请求体**；成功后 `l/{id}/tx`、`sources`、`stats` 都被 invalidate（§3.6）；重复点提交时第二次拿到 409 `batch_already_committed` 并只弹一次 Toast。
14. **窄屏降级**：视口 375 宽时渲染卡片流而不是表格，kind、分类与转账配对勾选框仍可直接改。

### 8.5 导入流程的关键用例（§4.10）

1. **导入指南**：`GET /import-format` 的 `skill_markdown` / `sample_csv` 渲染出来，「复制」写进剪贴板，「下载」生成的 Blob 内容与响应一致；页面**不硬编码**任何列名（把 mock 的 `headers` 改掉，界面跟着变）。
2. **上传成功即 review**：`POST /imports` 返回 `{batch, rows}` → **不发第二次请求**就渲染出 review 表格（同步模型，没有轮询）。
3. **粘贴入口**：粘贴 CSV 文本走 JSON 体 `{source_id, text}`，命中与上传同一套渲染。
4. **结构错误态**：400 `import_format_invalid` → 停在上传页、按 `errors[].line` 列出错误、每条渲染成「文件第 N 行：…」，`[复制错误清单]` 写进剪贴板的是同一份 `errors[]` 拼出的纯文本；**不产生批次**（列表 query 没被 invalidate）。缺 `# version:` 行的文件走的也是这一条（决策 §14.53d），断言它命中的是结构错误态而不是版本过期态。
5. **版本过期态**：400 `skill_outdated` → 显示 `current_version` 与 `file_version`、`[去导入指南更新 skill]` 的跳转目标取自响应里的 `guide_url`（把 mock 的 `guide_url` 改掉，按钮跟着变）；**没有「忽略并继续」按钮**（决策 §14.30）。
6. **非 CSV 被前端拦下**：选一个 `.pdf` → 不发请求，提示指回导入指南；绕过预检真传上去时服务端回 400 `import_format_invalid`，走第 4 条那套失败态。
7. **撤销确认的两个方向**（决策 §14.52 B24）：`dry_run` 返回 `orphaned_refunds: 2, refunds_in_batch: 3` → 确认框里出现**两条措辞不同**的提示；某个数为 0 时对应那条不渲染；确认后才发真正的 `DELETE`，成功后跳回历史列表。
8. **历史列表**：每行显示上传人（`created_by` 经成员列表映射成 `display_name`，为空回退邮箱前缀）、净额（`net_amount` + `base_currency`）、标记数；`source === 'paste'`（`filename` 为 `null`）的批次显示「粘贴的 CSV 文本」占位而不是空白；状态只有 `ready` / `committed` 两种徽章，**没有「已撤销」**。

### 8.6 不做的

- 不做端到端浏览器测试（Playwright/Detox）：一个人维护的项目里，维护成本超过收益。§8.3 的集成测试覆盖到路由与表单为止。
- 不做视觉回归测试。定稿的 `mockups/`（§6）与 token 的单一来源代替它。

---

## 待决

**本章没有待决项**。第一轮列出的 D-1 至 D-13 已全部被决策记录裁定或被后续各章回答，结论如下（保留这张表是为了让读过旧版的人知道每条去了哪里，不是为了留问题）：

| # | 原问题 | 裁定 |
|---|---|---|
| D-1 | 路由库选 Expo Router 还是 `@react-navigation/native` + 手写 `linking`？ | **已裁定（决策 §14.46 的 04-D-1）：用 Expo Router**。`@react-navigation/*` 两个包从 `package.json` 移除（§1.1） |
| D-2 | `/auth/me` 与 `/me` 共存还是迁走？ | **已裁定（决策 §14.42）：`/me` 是唯一入口**，`/auth/me` 不注册、不留别名；不做任何向后兼容（§2.1） |
| D-3 | `GET /ledgers` 返不返回角色与成员数？ | 已由 03 章回答：返回 `role`（不是 `my_role`）+ `member_count`，成员列表返回 `email` + `display_name` + `is_me`（§3.3） |
| D-4 | 退款候选的「已退 / 可退」默认返回还是靠开关？ | **已裁定（决策 §14.11）：不另设候选接口**，复用 `GET /transactions`；`refunded_total` / `refundable` 在 `kind='expense'` 行上**默认返回**，`TransactionListParams` 里没有开关（§3.4） |
| D-5 | 前端怎么提前知道 `REGISTRATION_OPEN`？ | **已裁定（决策 §14.46 的 04-D-5）：加匿名可读的 `GET /config`**，返回 `{registration_open}`；注册页挂载即读，关闭时用提示卡替代表单（§4.2） |
| D-6 | 支出详情怎么显示「被退了多少」？ | **已裁定（决策 §14.46 的 04-D-6）**：支出详情带 `refunds[]`（每笔的日期、金额、备注），退款详情把 `refund_of` 展开成原单摘要（日期、商户、金额、已退 / 可退）（§3.3、§4.7） |
| D-7 | 交易列表能否按 `import_batch_id` 筛选？ | **已裁定（决策 §14.46 的 04-D-7）：加 `?import_batch_id=`**，界面上是一枚「来自导入 #x」的 Chip（§1.3、§4.5） |
| D-8 | `GET /categories` 的 `version` 是什么形态？ | **已裁定（决策 §14.30）：日期串**（如 `2026-09-10`），导入时硬校验，不一致就 400 `skill_outdated`（§3.3、§4.10） |
| D-9 | ~~页面缩略图怎么给前端~~ | **整条作废（决策 §14.25、§14.28）**：应用不接入 LLM、拿不到原始账单，没有缩略图、没有整页图字段，后端也不再有任何文件系统状态（上传目录与清理一并取消）。解析进度同样作废——校验是同步的（§4.10、§4.11） |
| D-10 | ~~解析进度怎么表达~~ | **整条作废（决策 §14.25）**：没有后台解析，就没有进度 |
| D-11 | 要不要「按人筛选」？ | **已裁定（决策 §14.46 的 04-D-11）：不做** |
| D-12 | 语言字段 `users.language` | **已裁定（决策 §14.6）**：`VARCHAR(8) NULL`，取值 `zh` / `en`，NULL = 跟随系统；`PATCH /me` 可改（§3.3、§5.1）。同一节还加了 `display_name VARCHAR(40) NULL`（§4.13） |
| D-13 | 视觉方向最终选 A / B / C 哪个？ | **已裁定（决策 §14.45）：都不选**——采用 Claude Design 里定稿的「**04 柔和圆润**」，token 的唯一来源是 [`./mockups/tokens.json`](./mockups/tokens.json)，17 张屏幕稿在同一目录，A/B/C 三方向作废，实现前不再另出 mockup（§6） |

新问题按老规矩处理：**决策记录没覆盖、又必须选**的才进这张表，正文里不擅自拍板。

---

## 另见

* [./README.md](./README.md) — 目标设计的索引与阅读顺序
* [./00-decisions.md](./00-decisions.md) — 决策记录（唯一事实来源），本文每处标注都指向它
* [./mockups/README.md](./mockups/README.md) — 视觉定稿的画板目录说明；[`./mockups/tokens.json`](./mockups/tokens.json) 是 §6 全部 token 的唯一来源，[`./mockups/REVIEW-2026-09-11.md`](./mockups/REVIEW-2026-09-11.md)、[`./mockups/REVIEW-2026-09-11b.md`](./mockups/REVIEW-2026-09-11b.md) 与 [`./mockups/REVIEW-2026-09-11c.md`](./mockups/REVIEW-2026-09-11c.md) 是屏幕稿与决策的三轮比对结果（§6.5 的两张表由它们而来；第三轮的结论是屏幕稿可作为实现依据）
* [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域模型与流程：四种 kind、退款关联、转账单腿/两腿与配对、操作记录的语义
* [./02-database.md](./02-database.md) — 目标 schema：本文 §3.3 的字段名以它为准
* [./03-backend-api.md](./03-backend-api.md) — 全部接口的请求/响应定义、状态码与**唯一错误 code 注册表**（§4.2），本文 §3.4 的函数与 §3.7 的文案表都与它一一对应
* [./05-import-and-llm.md](./05-import-and-llm.md) — 标准 CSV 格式、skill 规范、校验规则与四种自动标记的产生方式，本文 §4.10、§4.11 消费它的输出
* [../current-design/04-frontend.md](../current-design/04-frontend.md) — 前端现状：本文 §0 的差异总览与所有 `path:line` 引用的出处
* [../current-design/03-backend-api.md](../current-design/03-backend-api.md) — 现有接口的完整定义
* [../current-design/05-infra-and-ops.md](../current-design/05-infra-and-ops.md) — Caddy 与 `dist/` 的部署方式（决策 §0.1 沿用）
* [../current-design/06-known-issues.md](../current-design/06-known-issues.md) — 现状的已知问题清单，本文修复的前端问题都能在里面找到条目
