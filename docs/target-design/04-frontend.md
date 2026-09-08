# 04 — 前端（目标设计：信息架构、页面、API 客户端、i18n 与视觉方向）

> **本文回答什么问题**：v3.0 的网页端应该长成什么样、由哪些路由和页面组成、每个页面调用哪些接口、状态放在哪里、API 客户端怎么分层、TanStack Query 的 key 和失效怎么定义、409 冲突和统一错误码怎么展示给用户、中英双语怎么落地、视觉上往哪个方向重做、mockup 要出哪些张、测试测什么。读者假定没看过这个仓库：读完应该能直接开工。

本文的每一条设计都可以追溯到 [`00-decisions.md`](./00-decisions.md) 的某一节，标注形如「（决策 §1.2）」。决策记录是唯一事实来源；本文只展开、细化，不改写。凡是决策记录没覆盖、又必须做选择的地方，一律进文末 [`## 待决`](#待决)，正文里不擅自拍板。

描述**现状**时（`path:line` 形式的引用）指的是 [`../current-design/04-frontend.md`](../current-design/04-frontend.md) 所描述的、当前仓库里真实存在的代码；描述**目标**时不假设任何代码已经存在。所有相对路径以仓库根目录为基准。

> **修订说明**：本版按终审意见与决策 §14「评审后的补充裁定」修订。主要变化：§3.3 的 TypeScript 类型与 §3.4 的函数签名**逐字段对齐** [`./03-backend-api.md`](./03-backend-api.md) §5 的真实请求 / 响应形状（列表信封 `{items,total}`、折算字段 `amount_base` / `rate_used` / `rate_date`、退款字段 `refunded_total` / `refundable`、账本角色 `role`、扁平的 `TransferCreate`、统计的 `expense[]` / `income[]` 双数组等）；§3.7 的 `errors.*` 语言包改成与 [`./03-backend-api.md`](./03-backend-api.md) §4.2 **唯一错误 code 注册表**一一对应的完整表（决策 §14.4，之前有 10 个 key 与后端实际发出的 code 对不上，运行时会 100% 落到 `errors.unknown`）；待决 D-3 / D-9 / D-10 已被 03 章回答，D-12 已由决策 §14.6 裁定。

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
| 账单导入四步流程与 review 表格（§4.10、§4.11） | 决策 §5 |
| 个人设置里的 LLM 配置与「测试连接」 | 决策 §6 |
| i18n（中英双语，默认跟随系统） | 决策 §0.4 |
| 全新视觉体系，实现前先出 mockup 给用户确认 | 决策 §0.3 |
| 409 `stale_update` 的统一处理、`{detail, code}` 错误码到文案的映射 | 决策 §2、§9 |

### 0.4 删除

- 标签输入框、`?tag=` 筛选、`tags` 字段（决策 §1.3）。
- `RegisterScreen` 里硬编码的 5 币种列表（`frontend/src/screens/RegisterScreen.tsx:6-12`）——币种一律来自 `GET /rates/currencies`。
- 四份复制粘贴的币种选择器与目标账户选择器（现状文档 §4.9）——合并成一个 `Picker` 组件。
- `frontend/src/screens/HomeScreen.tsx` 的视图机与所有 `on*Press` 回调 prop。
- 已装未用的 `react-hook-form` / `zod` / `nativewind` / `tailwindcss`（现状文档 §6.3）中，`react-hook-form` + `zod` 留下（§4 的表单校验用它们），其余从 `package.json` 移除。

---

## 1. 信息架构与导航

### 1.1 路由库

选 **Expo Router v6**（随 Expo SDK 54 提供）：文件式路由、Web 上直接映射到真实 URL、`useLocalSearchParams` / `useRouter` 一套 API 跨平台、原生端自带深链接配置——决策 §0.1 后面还要做 App，这一点值得。备选是 `@react-navigation/native` + 手写 `linking` 配置（这两个包现在就装着，`frontend/package.json:17-18`，只是从未被导入），但 Web 上的 URL ↔ 状态映射要自己写，成本更高。最终确认见 [待决 D-1](#待决)。

下文用「路由表」而不是文件树来表达，因为无论选哪个库，路由表都不变。

### 1.2 路由表

`:ledgerId` 是 UUID。所有 `/l/:ledgerId/*` 路由都要求「已登录 + 是该账本成员」（决策 §2 的鉴权模型）。

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 登录 | 匿名可见 |
| `/register` | 注册 | 匿名可见；`REGISTRATION_OPEN=false` 时显示关闭提示（决策 §0.5） |
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
| `/l/:ledgerId/imports` | 导入历史（批次列表） | |
| `/l/:ledgerId/imports/new` | 新建导入（选账户 + 上传） | |
| `/l/:ledgerId/imports/:batchId` | 导入详情 | 按批次 `status` 渲染进度 / review / 结果（§4.10） |
| `/l/:ledgerId/settings` | 账本设置 | 成员、邀请码、基准币种、转让、退出、删除 |
| `/settings` | 个人设置 | 默认币种、语言 |
| `/settings/llm` | LLM 设置 | 决策 §6 |
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
| `min_amount` / `max_amount` | number | 绝对值 |
| `offset` | int | 分页游标；`limit` 不进 URL，固定 50 |

约定：**空值不写进 URL**（`?q=` 这样的空参数一律删掉），保证同一筛选状态只有一种 URL 写法，也保证它可以直接当 query key 的一部分（§3.4）。数组参数用重复键（`kind=a&kind=b`）而不是逗号串，和 FastAPI 的 `Query(list)` 语义一致。

首页的 `?month=YYYY-MM`、账户列表的 `?include_archived=1`、导入详情的 `?row=<rowId>`（滚动定位到某一行）同理。

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
- 「我的」tab 聚合个人设置、LLM 设置、账本设置、切换账本、登出。
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
6. **注册关闭**：`/register` 仍可访问，页面顶部显示关闭说明并禁用提交（决策 §0.5）。

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
3. **接口路径**：`GET /me` / `PATCH /me`（决策 §11 的「我」分组），不是现状的 `/auth/me`。`POST /auth/register`、`POST /auth/login` 不变（决策 §11「现有 auth 接口保留」）。两者共存的确认见 [待决 D-2](#待决)。

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
- 分类名**不进语言包**（§5.3）：接口给 `name_zh` / `name_en`，界面按当前语言取。
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

`refetchOnWindowFocus: true` 的两处例外，在具体 query 上关掉：**导入 review 的草稿行**（正在编辑的表格被后台刷新会打断输入）和**任何正在编辑的表单所依赖的详情**。

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
  llmSettings.ts     /me/llm-settings*
  categories.ts      GET /categories
  ledgers.ts         /ledgers*（含成员、邀请、加入、转让、退出）
  sources.ts         /ledgers/{id}/sources*
  transactions.ts    /ledgers/{id}/transactions*（含 transfer 两腿）
  stats.ts           /ledgers/{id}/stats/*
  imports.ts         /ledgers/{id}/imports*
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

// 上传单独一个实例：不设 Content-Type（交给 FormData 的 boundary），超时 120s
export const uploadClient = axios.create({ baseURL: API_BASE_URL, timeout: 120_000 });
```

两个实例共享同一对拦截器：请求拦截器读令牌注入 `Authorization: Bearer <token>`（同 `frontend/src/api/client.ts:19-34`）；响应拦截器做 §3.5 的归一化。

### 3.3 类型定义

字段名与 [`./03-backend-api.md`](./03-backend-api.md) §5 的**实际响应体逐字一致**（每个类型后面标了对应的小节号），底层列名来自决策 §1/§2/§3/§5/§6/§10。`Decimal` 一律走 JSON 字符串（现状就是这样，见现状文档 §4.6 的响应示例），前端只在显示前 `Number()`，绝不用浮点数做累加。

三条贯穿全表的约定：**所有列表端点都返回 `{items, total}` 信封**（[`./03-backend-api.md`](./03-backend-api.md) §4.3），所以列表类函数的返回类型一律是 `Paged<T>`，没有裸数组；**所有 PATCH 请求体都必须带 `updated_at`**（§4.4 的乐观并发）；**折算三件套统一叫 `amount_base` / `rate_used` / `rate_date`**，取不到汇率时三者同时为 `null`。

```ts
// ---------- 通用 ----------
export type Uuid = string;
export type IsoDate = string;      // 'YYYY-MM-DD'
export type IsoDateTime = string;  // '2026-09-01T12:00:00.000000'
export type Money = string;        // Decimal 的 JSON 形态，如 '-42.5000'
export interface Paged<T> { items: T[]; total: number; }
export interface ApiError { detail: string; code: string; }   // 决策 §9

// ---------- 我 ----------
// GET /me（03 §5.5）
export interface User {
  id: Uuid; email: string;
  base_currency: string;           // 新建账本的默认币种（决策 §2）
  language: 'zh' | 'en' | null;    // null = 跟随系统（决策 §14.6）
  created_at: IsoDateTime;
  ledger_count: number;            // 引导用便利字段（03 §5.5）
  has_llm_settings: boolean;
}
// PATCH /me（03 §5.6）：两个字段都可选，显式 null 会被服务端拒成 422
export interface UserUpdate { base_currency?: string; language?: 'zh' | 'en'; }
export interface LoginRequest { email: string; password: string; }
// POST /auth/register（03 §5.1）
export interface RegisterRequest {
  email: string; password: string; base_currency: string; language?: 'zh' | 'en';
}
export interface AuthResponse { access_token: string; token_type: 'bearer'; }

// ---------- 分类（决策 §1.3）----------
// GET /categories（03 §5.11）：children 永远是数组，没有二级时是空数组
export interface Category { code: string; name_zh: string; name_en: string; children: Category[]; }
export interface CategoryTree { version: string; expense: Category[]; income: Category[]; }

// ---------- 账本（决策 §2）----------
// GET /ledgers、GET/POST/PATCH /ledgers/{id}（03 §5.12–§5.15）
export interface Ledger {
  id: Uuid; name: string; base_currency: string;
  created_by: Uuid; created_at: IsoDateTime; updated_at: IsoDateTime;
  role: 'owner' | 'member';    // 当前用户在这本账里的角色（03 §5.12，字段名就叫 role）
  member_count: number;
}
export interface LedgerCreate { name: string; base_currency?: string; }
export interface LedgerUpdate { name?: string; base_currency?: string; updated_at: IsoDateTime; }
// GET /ledgers/{id}/members（03 §5.17）
export interface LedgerMember {
  user_id: Uuid; email: string;
  role: 'owner' | 'member'; joined_at: IsoDateTime;
  is_me: boolean;
}
// POST /ledgers/{id}/invites（03 §5.21）：code 只在这一次响应里出现
export interface LedgerInvite {
  id: Uuid; code: string; ledger_id: Uuid; ledger_name: string;
  expires_at: IsoDateTime; created_at: IsoDateTime;
}
export interface JoinLedgerRequest { code: string; }
// POST /ledgers/{id}/transfer-ownership（03 §5.20）：字段名是 to_user_id
export interface TransferOwnershipRequest { to_user_id: Uuid; }

// ---------- 资金账户（决策 §3）----------
export type SourceType = 'checking' | 'savings' | 'credit' | 'cash' | 'other';
// GET/POST/PATCH /ledgers/{id}/sources（03 §5.23–§5.26）
export interface FinanceSource {
  id: Uuid; ledger_id: Uuid; name: string; type: SourceType;
  default_currency: string; opening_balance: Money; archived: boolean;
  created_by: Uuid; updated_by: Uuid | null;
  created_at: IsoDateTime; updated_at: IsoDateTime;
  // 余额四件套（03 §5.23，口径见决策 §14.2）：
  balance: Money;                    // 以账户 default_currency 计价；异币种交易按发生日汇率折进来
  balance_base: Money | null;        // 按最新汇率折到账本 base_currency
  balance_rate: Money | null;        // 这次用的汇率，8 位小数
  balance_rate_date: IsoDate | null; // 该汇率的行情日
}
export interface FinanceSourceCreate {
  name: string; type: SourceType; default_currency: string; opening_balance?: Money;
}
export interface FinanceSourceUpdate {
  name?: string; type?: SourceType; default_currency?: string;
  opening_balance?: Money; archived?: boolean;
  updated_at: IsoDateTime;      // 乐观并发（决策 §2）
}

// ---------- 交易（决策 §1、§10）----------
export type TxKind = 'expense' | 'income' | 'refund' | 'transfer';
export type TransferRole = 'out' | 'in';
export type TransferSubtype = 'plain' | 'repayment';

// GET/POST /ledgers/{id}/transactions（03 §5.28、§5.29）
export interface Transaction {
  id: Uuid; ledger_id: Uuid; source_id: Uuid;
  kind: TxKind;
  amount: Money;                 // expense/transfer-out 为负；income/refund/transfer-in 为正
  currency: string; occurred_at: IsoDate;
  note: string | null;           // 现状的 description 改名（决策 §1.4）
  merchant: string | null;
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
  // 折算三件套（03 §5.28）：按 occurred_at 当天（或回退后的最近行情日）汇率折到账本基准币种；
  // 取不到汇率时三者同时为 null。字段名不是 converted_amount/conversion_rate/conversion_date。
  amount_base: Money | null;
  rate_used: Money | null;
  rate_date: IsoDate | null;
  // 只在 kind === 'expense' 的行上出现（03 §5.28）：
  refunded_total?: Money;        // 指向该行的所有 refund 的 amount 之和（正数）
  refundable?: Money;            // |amount| - refunded_total，可以为负（允许超额退款，决策 §1.1）
  // 只在 GET /transactions/{tid} 且该行是两腿转账的一腿时出现（03 §5.30）：
  pair?: TransferPair | null;
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
  updated_at: IsoDateTime;       // 必填：乐观并发（03 §5.31）
}

// 两腿转账（决策 §1.2）：一次请求建两条。请求体是**扁平**的（03 §5.33），不是嵌套的 out/in。
export interface TransferCreate {
  from_source_id: Uuid; to_source_id: Uuid;   // 必须不同，否则 400 same_source
  amount_out: Money;  currency_out: string;   // amount_out 传正数，服务端存成负数
  amount_in: Money;   currency_in: string;    // 不要求等于 amount_out（跨币种）
  occurred_at: IsoDate;
  subtype: TransferSubtype;                   // 字段名是 subtype，不是 transfer_subtype
  note?: string | null;                       // 没有 merchant、没有 counterparty
}
export interface TransferUpdate extends Partial<TransferCreate> {
  updated_at: IsoDateTime;       // 两腿 updated_at 中较大的那个（03 §5.34）
}
// POST/PATCH .../transactions/transfer 的响应（03 §5.33、§5.34）
export interface TransferPair {
  pair_id: Uuid;
  occurred_at: IsoDate; subtype: TransferSubtype; note: string | null;
  out: Transaction; in: Transaction;
  updated_at?: IsoDateTime;      // PATCH 响应里带；POST 响应里两腿各自带自己的
}

export interface TransactionListParams {
  q?: string; kind?: TxKind[]; category_l1?: string; category_l2?: string;
  source_id?: Uuid[]; from?: IsoDate; to?: IsoDate; currency?: string;
  min_amount?: number; max_amount?: number; limit?: number; offset?: number;
  with_refund_totals?: boolean;   // 退款候选选择器用，见待决 D-4
}

// 退款关联选择器用（决策 §1.1：每条显示已退/可退）。字段就是 Transaction 上
// kind==='expense' 时出现的那两个（03 §5.28），这里只是把它们收紧成必填。
export interface RefundCandidate extends Transaction {
  refunded_total: Money;
  refundable: Money;
}

// ---------- 统计（决策 §7）----------
// GET /ledgers/{id}/stats/summary（03 §5.36）：支出与收入是**两个数组**，不是一个带 kind 的数组
export interface StatsCategoryChild {
  code: string | null;           // null = 「有一级没二级」的部分
  name_zh: string; name_en: string;
  amount: Money; count: number;
}
export interface StatsCategoryNode {
  code: string; name_zh: string; name_en: string;
  amount: Money;                 // 正数；退款已冲减，可能为负
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
  rate_missing_count: number;    // 因取不到汇率被跳过的行数，> 0 时要提示「部分交易未计入」
}
// GET /ledgers/{id}/stats/trend（03 §5.37）：数组叫 months，每项多一个 net
export interface StatsTrend {
  base_currency: string;
  months: Array<{ month: string; expense: Money; income: Money; net: Money }>;  // 升序，空月补 0
  rate_missing_count: number;
}

// ---------- LLM 设置（决策 §6）----------
// GET/PUT /me/llm-settings（03 §5.7、§5.8）：没配过也返回 200，用 configured 区分
export interface LlmSettings {
  configured: boolean;
  base_url: string; api_key_last4: string | null;
  model: string | null; vision_model: string | null; updated_at: IsoDateTime | null;
}
export interface LlmSettingsPut {
  base_url: string; api_key?: string;   // 不传 = 保留原 key（首次写入必填）
  model: string; vision_model?: string | null;
}
// POST /me/llm-settings/test（03 §5.10）：失败也是 200，把原因放在 error 里
export interface LlmTestResult {
  ok: boolean;
  model: string;
  supports_vision: boolean;
  error: string | null;          // 上游错误的脱敏摘要；ok 时为 null
}
export type LlmSettingsTestRequest = Partial<LlmSettingsPut>;   // 空体 {} = 用已保存的配置试

// ---------- 导入（决策 §5）----------
export type ImportStatus = 'uploaded' | 'parsing' | 'ready' | 'committed' | 'failed';
export type ImportRowStatus = 'pending' | 'edited' | 'skipped';
export type ImportFlag = 'duplicate' | 'refund_candidate' | 'repayment' | 'needs_review';

// GET/POST /ledgers/{id}/imports、GET .../imports/{bid}（03 §5.38–§5.40）
export interface ImportBatch {
  id: Uuid; ledger_id: Uuid; source_id: Uuid; source_name: string; created_by: Uuid;
  filename: string; mime_type: string; size_bytes: number;
  status: ImportStatus;
  progress: { done: number; total: number | null };  // total 在抽取完成前是 null（03 §5.40）
  row_count: number;
  error: string | null;            // 给人看的一句话，前缀是 §3.7 表里的 code（没有独立的 error_code 字段）
  model: string | null;
  used_vision: boolean;
  flags_summary: Record<ImportFlag, number>;
  row_status_summary: Record<ImportRowStatus, number>;
  uncategorized_count: number;     // 还差几行没补一级分类（提交阻断条件，§4.11.8）
  created_at: IsoDateTime; updated_at: IsoDateTime;
  committed_at: IsoDateTime | null;
}
// GET/PATCH .../imports/{bid}/rows（03 §5.42、§5.43）；行号列名是 row_no（决策 §14.5）
export interface ImportRow {
  id: Uuid; batch_id: Uuid; row_no: number; status: ImportRowStatus;
  date: IsoDate | null; amount: Money | null; currency: string | null;
  kind: TxKind | null; merchant: string | null; note: string | null;
  category_l1: string | null; category_l2: string | null;
  confidence: number | null; source_ref: string | null;
  flags: ImportFlag[];
  matched_transaction_id: Uuid | null;      // refund_candidate 预填的原支出
  counterpart_source_id: Uuid | null;       // repayment 的对手账户
  transfer_subtype: TransferSubtype | null;
  transaction_id: Uuid | null;              // 提交后回填
  page_image_url: string | null;            // 视觉路径的页面缩略图（§4.11，见待决 D-9）
}
// GET .../rows 的查询参数（03 §5.42）
export interface ImportRowListParams {
  status?: ImportRowStatus[]; flag?: ImportFlag[]; uncategorized?: boolean;
  limit?: number;   // 上限 500
  offset?: number;
}
export type ImportRowPatch = Partial<Pick<ImportRow,
  'status' | 'date' | 'amount' | 'currency' | 'kind' | 'merchant' | 'note' |
  'category_l1' | 'category_l2' | 'matched_transaction_id' |
  'counterpart_source_id' | 'transfer_subtype'>>;
// POST .../imports/{bid}/commit（03 §5.44）
export interface ImportCommitResult {
  batch_id: Uuid; status: 'committed';
  created_transactions: number; created_transfer_pairs: number; skipped_rows: number;
  committed_at: IsoDateTime;
}
// DELETE .../imports/{bid}（03 §5.45）：带 ?dry_run=true 先问要删多少条，再真删
export interface ImportDeleteResult {
  batch_id: Uuid;
  mode: 'discard' | 'revert';
  deleted: boolean;
  would_delete_transactions?: number;  // dry_run=true 时给
  deleted_transactions?: number;       // 真删时给
}

// ---------- 汇率（03 §5.46）----------
export interface CurrencyList { currencies: Record<string, string>; }
```

### 3.4 函数清单（与决策 §11 逐条对应）

签名与 [`./03-backend-api.md`](./03-backend-api.md) §5 的每个端点一一对应：凡是后端返回 `{items, total}` 的（§4.3：`/ledgers`、`/members`、`/sources`、`/transactions`、`/imports`、`/rows`）客户端一律给 `Promise<Paged<T>>`，**不解开信封**——`total` 是分页条和「共 N 条」要用的。

| 决策 §11 端点 | 客户端函数（TypeScript 签名） |
|---|---|
| `POST /auth/register` | `authApi.register(b: RegisterRequest): Promise<AuthResponse>` |
| `POST /auth/login` | `authApi.login(b: LoginRequest): Promise<AuthResponse>` |
| `GET /me` | `meApi.get(): Promise<User>` |
| `PATCH /me` | `meApi.update(b: UserUpdate): Promise<User>` |
| `GET /me/llm-settings` | `llmApi.get(): Promise<LlmSettings \| null>` |
| `PUT /me/llm-settings` | `llmApi.put(b: LlmSettingsPut): Promise<LlmSettings>` |
| `DELETE /me/llm-settings` | `llmApi.remove(): Promise<void>` |
| `POST /me/llm-settings/test` | `llmApi.test(b?: LlmSettingsTestRequest): Promise<LlmTestResult>` |
| `GET /categories` | `categoriesApi.get(): Promise<CategoryTree>` |
| `GET /ledgers` | `ledgersApi.list(): Promise<Paged<Ledger>>` |
| `POST /ledgers` | `ledgersApi.create(b: LedgerCreate): Promise<Ledger>` |
| `GET /ledgers/{id}` | `ledgersApi.get(id: Uuid): Promise<Ledger>` |
| `PATCH /ledgers/{id}` | `ledgersApi.update(id: Uuid, b: LedgerUpdate): Promise<Ledger>` |
| `DELETE /ledgers/{id}` | `ledgersApi.remove(id: Uuid): Promise<void>` |
| `GET /ledgers/{id}/members` | `ledgersApi.members(id: Uuid): Promise<Paged<LedgerMember>>` |
| `DELETE /ledgers/{id}/members/{user_id}` | `ledgersApi.removeMember(id: Uuid, userId: Uuid): Promise<void>` |
| `POST /ledgers/{id}/leave` | `ledgersApi.leave(id: Uuid): Promise<void>` |
| `POST /ledgers/{id}/transfer-ownership` | `ledgersApi.transferOwnership(id: Uuid, b: TransferOwnershipRequest): Promise<Paged<LedgerMember>>`（响应是刷新后的成员列表，03 §5.20） |
| `POST /ledgers/{id}/invites` | `ledgersApi.createInvite(id: Uuid): Promise<LedgerInvite>` |
| `POST /ledgers/join` | `ledgersApi.join(b: JoinLedgerRequest): Promise<Ledger>` |
| `GET /ledgers/{id}/sources` | `sourcesApi.list(l: Uuid, p?: { include_archived?: boolean }): Promise<Paged<FinanceSource>>` |
| `POST /ledgers/{id}/sources` | `sourcesApi.create(l: Uuid, b: FinanceSourceCreate): Promise<FinanceSource>` |
| `GET /ledgers/{id}/sources/{sid}` | `sourcesApi.get(l: Uuid, sid: Uuid): Promise<FinanceSource>` |
| `PATCH /ledgers/{id}/sources/{sid}` | `sourcesApi.update(l: Uuid, sid: Uuid, b: FinanceSourceUpdate): Promise<FinanceSource>` |
| `DELETE /ledgers/{id}/sources/{sid}` | `sourcesApi.remove(l: Uuid, sid: Uuid): Promise<void>` |
| `GET /ledgers/{id}/transactions` | `txApi.list(l: Uuid, p: TransactionListParams): Promise<Paged<Transaction>>` |
| `POST /ledgers/{id}/transactions` | `txApi.create(l: Uuid, b: TransactionCreate): Promise<Transaction>` |
| `GET /ledgers/{id}/transactions/{tid}` | `txApi.get(l: Uuid, tid: Uuid): Promise<Transaction>` |
| `PATCH /ledgers/{id}/transactions/{tid}` | `txApi.update(l: Uuid, tid: Uuid, b: TransactionUpdate): Promise<Transaction>` |
| `DELETE /ledgers/{id}/transactions/{tid}` | `txApi.remove(l: Uuid, tid: Uuid): Promise<void>` |
| `POST /ledgers/{id}/transactions/transfer` | `txApi.createTransfer(l: Uuid, b: TransferCreate): Promise<TransferPair>` |
| `PATCH /ledgers/{id}/transactions/transfer/{pair_id}` | `txApi.updateTransfer(l: Uuid, pairId: Uuid, b: TransferUpdate): Promise<TransferPair>` |
| `DELETE /ledgers/{id}/transactions/transfer/{pair_id}` | `txApi.removeTransfer(l: Uuid, pairId: Uuid): Promise<void>` |
| `GET /ledgers/{id}/stats/summary?month=` | `statsApi.summary(l: Uuid, p: { month: string }): Promise<StatsSummary>` |
| `GET /ledgers/{id}/stats/trend?months=` | `statsApi.trend(l: Uuid, p: { months: number; end?: string }): Promise<StatsTrend>` |
| `POST /ledgers/{id}/imports`（multipart） | `importsApi.upload(l: Uuid, b: { source_id: Uuid; file: File \| Blob }, onProgress?): Promise<ImportBatch>` |
| `GET /ledgers/{id}/imports` | `importsApi.list(l: Uuid, p?: { status?: ImportStatus[]; limit?: number; offset?: number }): Promise<Paged<ImportBatch>>` |
| `GET /ledgers/{id}/imports/{bid}` | `importsApi.get(l: Uuid, bid: Uuid): Promise<ImportBatch>` |
| `POST /ledgers/{id}/imports/{bid}/retry` | `importsApi.retry(l: Uuid, bid: Uuid): Promise<ImportBatch>` |
| `GET /ledgers/{id}/imports/{bid}/rows` | `importsApi.rows(l: Uuid, bid: Uuid, p?: ImportRowListParams): Promise<Paged<ImportRow>>`（`p` 可带 `status` / `flag` / `uncategorized` / `limit`≤500 / `offset`，03 §5.42） |
| `PATCH /ledgers/{id}/imports/{bid}/rows/{rid}` | `importsApi.patchRow(l: Uuid, bid: Uuid, rid: Uuid, b: ImportRowPatch): Promise<ImportRow>` |
| `POST /ledgers/{id}/imports/{bid}/commit` | `importsApi.commit(l: Uuid, bid: Uuid): Promise<ImportCommitResult>` |
| `DELETE /ledgers/{id}/imports/{bid}` | `importsApi.remove(l: Uuid, bid: Uuid, p?: { dry_run?: boolean }): Promise<ImportDeleteResult>`（ready/failed = 丢弃；committed = 撤销；先 `dry_run` 拿条数再确认，03 §5.45） |
| `GET /rates/currencies` | `ratesApi.currencies(): Promise<CurrencyList>` |

退款候选选择器复用 `txApi.list`：`refunded_total` / `refundable` 本来就是 03 §5.28 在 `kind='expense'` 行上返回的可选字段，选择器只是把它们当必填用（`RefundCandidate`）。是让它们默认就返回，还是加一个 `?with_refund_totals=1` 开关，见 [待决 D-4](#待决)。

### 3.5 Query key 规范

两个命名空间。**账本作用域的 key 一律以 `['l', ledgerId, ...]` 开头**——这样 `queryClient.removeQueries({ queryKey: ['l', ledgerId] })` 一次就能清干净一个账本（切换账本、被移出账本、登出时用）。

```ts
export const qk = {
  global: {
    me:          () => ['global', 'me'] as const,
    llmSettings: () => ['global', 'llm-settings'] as const,
    categories:  () => ['global', 'categories'] as const,
    currencies:  () => ['global', 'currencies'] as const,
    ledgers:     () => ['global', 'ledgers'] as const,
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

### 3.6 失效矩阵

每一次 mutation 成功后要失效哪些 key。`invalidate` = 标记过期并在活跃时重取；`remove` = 直接从缓存删除。

| Mutation | 失效（invalidate） | 备注 |
|---|---|---|
| `ledgersApi.create` | `global.ledgers` | 成功后跳新账本首页 |
| `ledgersApi.update` | `global.ledgers`、`l/{id}/detail` | 改基准币种时**额外** invalidate `l/{id}` 整棵（统计、余额、折算全变） |
| `ledgersApi.remove` | `global.ledgers`；`removeQueries(['l', id])` | 跳 `/ledgers` |
| `ledgersApi.join` | `global.ledgers` | 跳新账本首页 |
| `ledgersApi.createInvite` | 无（结果直接展示） | 邀请码不缓存 |
| `ledgersApi.removeMember` / `transferOwnership` | `l/{id}/members`、`l/{id}/detail`、`global.ledgers`（`role` 可能变） | |
| `ledgersApi.leave` | `global.ledgers`；`removeQueries(['l', id])` | 跳 `/ledgers` |
| `sourcesApi.create` | `l/{id}/sources`（全部变体） | |
| `sourcesApi.update` | `l/{id}/sources`、`l/{id}/sources/detail/{sid}`；改 `opening_balance` 时另加 `l/{id}/stats` | 余额随期初变 |
| `sourcesApi.remove` | `l/{id}/sources`、`l/{id}/tx`、`l/{id}/stats` | |
| `txApi.create` / `update` / `remove` | `l/{id}/tx`（整棵，含所有筛选组合）、`l/{id}/sources`（余额）、`l/{id}/stats`（整棵） | 精确到单条 key 的乐观更新不划算：筛选组合是开放集合 |
| `txApi.createTransfer` / `updateTransfer` / `removeTransfer` | 同上，另加 `l/{id}/tx/transfer/{pairId}` | |
| `importsApi.upload` | `l/{id}/imports/list` | 跳批次详情页开始轮询 |
| `importsApi.retry` | `l/{id}/imports/detail/{bid}`、`l/{id}/imports/list` | 重新轮询 |
| `importsApi.patchRow` | 只 `setQueryData` 更新 `l/{id}/imports/rows/{bid}` 里那一行 | **不 invalidate**：表格正在编辑，整表重取会打断 |
| `importsApi.commit` | `l/{id}/imports/*`、`l/{id}/tx`、`l/{id}/sources`、`l/{id}/stats` | |
| `importsApi.remove`（撤销 committed） | 同 commit | 撤销删掉的是真交易 |
| `meApi.update` | `global.me`；语言变化时切 i18n | |
| `llmApi.put` / `remove` | `global.llm-settings` | |

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
}
```

- 422（FastAPI 校验错误，`detail` 是数组）：按 `loc` 的最后一段归到 `fields`，`code` 置 `validation_error`。
- 无响应（超时 / 离线 / CORS）：`status=0`、`code='network_error'`。

**文案映射全部走 i18n**（§5），组件永远不直接显示 `detail`：

```ts
export function errorMessage(t: TFunction, e: ApiClientError): string {
  return t([`errors.${e.code}`, 'errors.unknown'], { detail: e.detail });
}
```

`errors.*` 语言包：`errorMessage()` 查的是 `errors.${e.code}`，所以**每个 key 必须是 [`./03-backend-api.md`](./03-backend-api.md) §4.2 注册表里的 code 原名**（决策 §14.4）。下表覆盖注册表的全部 44 个 code，外加一个纯前端的 `network_error` 和兜底的 `unknown`；顺序与注册表一致。

| code | HTTP | zh | en |
|---|---|---|---|
| `network_error` | — | 网络连接失败，请检查网络后重试 | Can't reach the server. Check your connection. |
| `validation_error` | 422 | 有几项填得不对，请检查标红的字段 | Some fields need fixing |
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
| `invite_invalid` | 400 | 邀请码不对 | That invite code isn't valid |
| `invite_expired` | 400 | 邀请码已过期，请让对方重新生成 | That invite code has expired |
| `invite_used` | 400 | 邀请码已经被用过了 | That invite code has already been used |
| `invite_rate_limited` | 429 | 尝试次数太多，请稍后再试 | Too many attempts. Try again later. |
| `login_rate_limited` | 429 | 登录尝试太频繁，请稍后再试 | Too many sign-in attempts. Try again later. |
| `import_rate_limited` | 429 | 这一小时的导入次数已用完，请稍后再试 | You've used up this hour's imports. Try again later. |
| `llm_test_rate_limited` | 429 | 测试太频繁了，请过一会儿再试 | Too many test calls. Try again in a moment. |
| `register_rate_limited` | 429 | 注册尝试太频繁，请稍后再试 | Too many sign-up attempts. Try again later. |
| `source_archived` | 409 | 这个账户已归档，不能再记账 | This account is archived |
| `source_has_transactions` | 409 | 这个账户下还有交易，只能归档不能删除 | This account has transactions — archive it instead |
| `same_source` | 400 | 转出和转入不能是同一个账户 | The two sides of a transfer must be different accounts |
| `category_invalid` | 400 | 分类不可用，请重新选择 | That category isn't valid |
| `category_kind_mismatch` | 400 | 这个分类和收支类型对不上，请重新选择 | That category doesn't match this transaction type |
| `kind_change_not_allowed` | 400 | 转账和其他类型之间不能互改，请删掉这条重新记 | You can't switch between transfer and other types — delete and re-enter |
| `refund_target_invalid` | 400 | 关联的原支出不可用，请重新选择或不关联 | That original expense can't be linked |
| `transfer_pair_incomplete` | 409 | 这笔转账的数据不完整（缺一条腿），请刷新后重试 | This transfer is missing one side. Reload and try again. |
| `import_in_progress` | 409 | 这个账本已有一个账单正在解析，请等它结束 | Another statement is still being parsed in this ledger |
| `file_too_large` | 413 | 文件超过 10 MB | File is larger than 10 MB |
| `unsupported_file` | 415 | 不支持这种文件格式 | That file type isn't supported |
| `rows_exceed_limit` | 422 | 这份账单超过 2000 行 | This statement has more than 2000 rows |
| `batch_not_ready` | 409 | 这批账单还不能提交，请先补齐日期、金额和类型 | This batch isn't ready yet — fill in date, amount and type first |
| `batch_already_committed` | 409 | 这批账单已经提交过了 | This batch has already been submitted |
| `batch_not_failed` | 409 | 只有解析失败的批次才能重试 | Only a failed batch can be retried |
| `rows_uncategorized` | 409 | 还有行没有选一级分类，补齐后才能提交 | Some rows still need a top-level category |
| `llm_not_configured` | 409 | 还没配置模型，先去个人设置里填 | Set up your model first in Settings |
| `llm_error` | 502 | 模型调用失败：{{detail}} | The model call failed: {{detail}} |
| `fx_unavailable` | 503 | 暂时拿不到汇率，折算金额可能缺失 | Exchange rates are unavailable right now |
| `internal_error` | 500 | 服务器出错了，请稍后重试 | Something went wrong on the server. Please try again. |
| `unknown` | — | 出错了（{{detail}}） | Something went wrong ({{detail}}) |

两条注意：

- **`forbidden` 与 `not_owner` 是两个 code**（03 §4.2）：`forbidden` 是留给未来的通用权限拒绝，owner-only 的操作用的是 `not_owner`，所以「只有账本创建者可以…」这句文案必须挂在 `not_owner` 上，不能挂在 `forbidden` 上。
- **`not_found` 是通用的**：账本不可见、交易被别人删了、路径里的 id 打错了都用它（03 §3.3），所以文案要写得两边都成立，不能写死成「这个账本不存在」。判定「被移出账本」要看是哪个 query 报的 404，见 §1.5 第 4 条。

新增后端 code 时，缺 key 会落到 `errors.unknown` 并把 `detail` 显示出来——不会出现空白提示。

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
- **端点**：`POST /auth/register` → `GET /me`。币种列表 `GET /rates/currencies`。
- **状态**：**注册关闭**（决策 §0.5）——页面顶部一块说明卡：「目前未开放注册。如果你是被邀请来的，请让对方把邀请码发给你，并用已有账号登录。」表单整体禁用、提交按钮置灰。前端怎么知道关没关：先信服务端 —— 提交后拿到 403 `registration_closed` 就切到这个状态；同时 `GET /me` 之外提供一个匿名可读的开关来源，见 [待决 D-5](#待决)。
- **交互**：邮箱、密码、确认密码、默认币种（`Picker`，默认按浏览器语言猜：`zh-*` → CNY，其余 → USD）。
- **校验**：邮箱格式；密码 ≥ 8（与服务端 `min_length=8` 对齐，现状前端写的是 6，`frontend/src/screens/LoginScreen.tsx:22-26`，属于不一致）；确认密码相等；币种为 3 位大写且在币种列表里。
- **成功后**：直接进入自动创建的默认账本首页，并在首页顶部显示一次性引导卡：「先去添加一个账户 →」。

### 4.3 账本列表 `/ledgers`、新建 `/ledgers/new`、加入 `/ledgers/join`

- **目的**：看到我参与的所有账本，切换、新建、加入。
- **端点**：`GET /ledgers`；`POST /ledgers`；`POST /ledgers/join`。
- **列表状态**：加载（3 个骨架卡）；空（理论上不会，仍给「新建账本」大按钮）；错误（重试按钮）。每张卡：账本名、基准币种、成员数、我的角色徽章（owner 显示皇冠）、最后更新时间。点击 → `/l/:id`。
- **新建**：账本名（1–50 字）、基准币种（默认取 `user.base_currency`，决策 §2）。软限制每人最多 10 本（决策 §2）：已有 10 本时按钮禁用并说明。成功后跳新账本首页。
- **加入**：一个 6 位数字输入（六个独立格子，自动跳格、支持整段粘贴、只收数字），输入满 6 位自动提交。
  - 错误：`invite_invalid` / `invite_expired` / `invite_used` / `already_member` 分别显示对应文案（§3.7），格子整体抖动一下并清空。
  - **限流**（决策 §2：15 分钟最多 5 次）：429 `invite_rate_limited` 时禁用输入并显示倒计时（倒计时秒数取响应的 `Retry-After` 头，03 §8.1）。
  - 成功后跳新账本首页，Toast「已加入《XXX》」。

### 4.4 首页 `/l/:ledgerId?month=YYYY-MM`

- **目的**：一屏看清「我现在有多少钱」「这个月花了多少、花在哪」「最近一年的趋势」（决策 §7）。
- **端点**：`GET /ledgers/{id}/sources`（余额）、`GET /ledgers/{id}/stats/summary?month=`、`GET /ledgers/{id}/stats/trend?months=12`。
- **区块**（窄屏纵向堆叠，宽屏两列）：
  1. **净资产条**：所有未归档账户 `balance_base` 之和，账本基准币种（决策 §7、§8：余额用最新汇率）。信用卡账户余额为负，正常参与求和。
  2. **账户余额卡片**：横向可滚的卡片行（宽屏是网格）。每张显示账户名、类型图标、`balance` + 币种；`default_currency !== base_currency` 时第二行小字显示 `balance_base`。点击 → 交易列表并预填 `?source_id=`。归档账户默认不显示。
  3. **本月汇总**：月份切换器（`‹ 2026 年 8 月 ›`，写进 `?month=`，不能越过当前月）。支出 / 收入两个大数（支出已按退款日期冲减，决策 §7）。下面是按一级分类的条形排行（前 8 条 + 「其他 N 项」），点一条展开二级分类。转账不出现（决策 §1）。
  4. **12 个月趋势**：支出/收入双折线，X 轴月份，Y 轴基准币种。点某个月 → 切到该月汇总。
- **状态**：三块各自骨架屏，互不阻塞；某块失败只在该块内显示重试；账户为 0 时余额区显示空态「先添加一个账户」+ 按钮；本月无交易时汇总区显示「这个月还没有记账」+「记一笔」按钮。
- **交互**：下拉刷新（原生）/ 顶部刷新按钮（Web）；`refetchOnWindowFocus` 保证切回标签页即最新（§2.4）。

### 4.5 交易列表 `/l/:ledgerId/transactions`

- **目的**：查、筛、改。
- **端点**：`GET /ledgers/{id}/transactions`（决策 §4 的全部参数）；`GET /ledgers/{id}/sources` 供筛选栏用；分类树来自缓存（§2.3）。
- **筛选栏**（窄屏收进一个「筛选」抽屉，显示已启用条件数的角标；宽屏常驻在列表上方）：

| 控件 | 参数 | 说明 |
|---|---|---|
| 搜索框 | `q` | 输入防抖 300ms 后写 URL |
| kind 多选 | `kind` | 四个 chip，可多选，全不选 = 全部 |
| 账户多选 | `source_id` | 下拉多选，显示账户名 + 币种 |
| 日期范围 | `from` / `to` | 快捷项：本月 / 上月 / 近 3 个月 / 今年 / 自定义 |
| 分类 | `category_l1` / `category_l2` | 两级级联，随 kind 过滤可选项（决策 §1.3） |
| 金额范围 | `min_amount` / `max_amount` | 绝对值，两个数字框 |
| 币种 | `currency` | 单选 |

  「清空筛选」按钮把 URL 恢复成裸路径。所有变更走 `router.replace`（不污染后退栈），只有进出列表页用 `push`。
- **分页**：`limit=50`，**窄屏无限滚动**（`useInfiniteQuery`，`offset` 递增，滚动位置在返回时恢复），**宽屏底部分页条**（显示 `total`，`offset` 写进 URL）。两种模式共用同一个 query 家族。
- **行内容**（一行一交易）：

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [↓] 餐饮 · 午餐        星巴克                              −¥38.00       │
│     和同事                                       08-14 · 招行信用卡      │
└─────────────────────────────────────────────────────────────────────────┘
  ↑kind图标 ↑一级·二级     ↑merchant   ↑note(次行)   ↑金额  ↑日期·账户
```
  - kind 图标 + 颜色：支出 ↓ / 收入 ↑ / 退款 ↩ / 转账 ⇄（四个语义色，§6.3），图标旁有文字标签给读屏用，**不只靠颜色**区分。
  - `currency !== base_currency` 时金额下方小字显示 `amount_base`（发生日汇率，决策 §8；`amount_base` 为 `null` 表示汇率暂不可用，显示「暂无汇率」而不是 0）。
  - 转账行显示「转出账户 → 转入账户」；单腿显示「转出账户 → 老婆（未在应用）」（`counterparty`，决策 §1.2）；`transfer_subtype='repayment'` 加一个「还款」徽章。
  - 退款行显示「退款」徽章；`refund_of` 非空时可点进原支出。
  - `import_batch_id` 非空的行右上角有一个小的「导入」标记，点击跳该批次。
- **分组**：按 `occurred_at` 分日，每个日期头右侧显示当日支出合计。
- **状态**：加载（8 行骨架）；空（区分「这个账本还没有交易」和「没有符合筛选条件的交易 + 清空筛选」两种文案）；错误（整块重试）；加载更多（底部 spinner）。
- **交互**：行点击 → 详情；行右滑（窄屏）/ 悬停操作按钮（宽屏）给「编辑」「删除」；删除走 `confirm`，转账（有 `transfer_pair_id`）时文案说明「会同时删除两腿」并调 `DELETE .../transfer/{pair_id}`（决策 §1.2）。

### 4.6 记一笔 `/l/:ledgerId/transactions/new?kind=...`

四个 kind 一个页面、四个 tab（决策 §1）。tab 切换写进 URL 的 `kind`，不丢已填字段中语义相同的部分（金额、日期、账户、备注保留；分类在支出↔收入切换时清空，因为分类树不同，决策 §1.3）。

**共同字段**：账户（默认取上次使用的账户，存 `localStorage['wallet:last_source:<ledgerId>']`）、金额（`keyboardType="decimal-pad"` + `inputMode="decimal"`）、币种（默认取所选账户的 `default_currency`）、日期（默认今天，本地时区，**不是** 现状那样的 UTC `toISOString().split('T')[0]`，`frontend/src/screens/TransactionFormScreen.tsx:28`）、商户、备注。

**用户永远不输入正负号**：符号由 kind 决定（决策 §1），提交前由客户端置好符号（`expense` 负，`income`/`refund` 正，转账两腿由服务端定，决策 §1.2）。金额在请求体里是**字符串**（03 §4.5 的 `Decimal` 约定），前端用字符串拼装、不经过浮点数。

#### 4.6.1 支出 tab（`kind=expense`）

- 分类：一级必填、二级可选（决策 §1），从支出树取（§2.3）。选择器是两级面板：左列一级、右列二级；窄屏是「先选一级 → 滑出二级」。最近用过的 6 个分类置顶（本地记录）。
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
- **子类型**（决策 §1.2）：`plain` / `repayment`。选「信用卡还款」时，如果转入账户不是 `credit` 类型，给一条提示（不阻断）。
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
- **成功后**：默认跳回来的地方（`?next=` 或 `router.back()`）；底部提供「保存并继续记下一笔」——保存后清空金额/商户/备注，保留账户、日期、kind、分类，焦点回到金额框。这是连续补录时最省力的路径。
- **离开确认**：表单有未保存改动时拦截路由跳转与浏览器关闭（`beforeunload`）。

### 4.7 交易详情 `/l/:ledgerId/transactions/:txId` 与编辑

- **详情**：只读展示全部字段 + 「谁在什么时候建的/改的」（`created_by` / `updated_by` / `updated_at`，决策 §2）。退款行显示关联原单卡（可点进）；支出行如果有指向它的退款，列出退款行与累计已退（这需要一个反查，见 [待决 D-6](#待决)）。转账行显示两腿。
- **编辑单笔** `/…/:txId/edit`：复用记一笔表单，预填。
  - **改 kind 的限制**（决策 §1、§10 的 CHECK 决定了哪些改动会破坏约束）：
    - `expense ⇄ income`：允许，必须重选分类（分类树不同），符号自动翻转。
    - `expense/income → refund`：允许，符号变正，可选关联原单。
    - `→ transfer` 与 `transfer → 其他`：**不允许**（决策 §14.3；服务端返回 400 `kind_change_not_allowed`，见 [`03-backend-api.md`](./03-backend-api.md) §5.31）。转账的 `transfer_role`/`transfer_subtype` 必填而其他 kind 必须为空，且两腿转账要成对处理；界面上把「转账」tab 在编辑模式下禁用，提示「要把它改成转账，请删掉这条重新记」——前端先挡是为了少一次往返，服务端仍然是唯一的权威判定。
    - 已有 `refund_of` 的行改成非 `refund`：先要求解除关联（服务端约束 `refund_of IS NULL OR kind='refund'`，决策 §10）。
    - 由导入产生的行（`import_batch_id` 非空）照常可改，但顶部提示「这条来自 <文件名> 的导入」。
- **编辑两腿转账** `/l/:ledgerId/transfers/:pairId/edit`（决策 §1.2）：一个表单**同时**编辑两腿——日期、备注、子类型是共享的；两腿各自的账户、金额、币种分别编辑。提交一次 `PATCH .../transactions/transfer/{pair_id}`。绝不允许在这里只改一腿。
- **并发**：两个编辑页都带 `updated_at`，409 走 §3.8。

### 4.8 账户列表 `/l/:ledgerId/sources`

- **端点**：`GET /ledgers/{id}/sources`（含余额，决策 §11）。
- **列表**：按类型分组（活期 / 储蓄 / 信用卡 / 现金 / 其他）。每行：名称、类型图标、币种、`balance`（非基准币种时下方小字给 `balance_base`）。归档账户折叠在底部「已归档（N）」里，`?include_archived=1` 展开。
- **交互**：点击 → 编辑；行操作「归档 / 取消归档」「删除」。删除只在**没有交易**时可用（决策 §3），否则按钮禁用并提示「这个账户下有交易，只能归档」；服务端也会用 `source_has_transactions` 兜底。
- **状态**：空态「还没有账户，添加一个开始记账」+ 按钮。

### 4.9 账户表单 `/l/:ledgerId/sources/new`、`/…/:sourceId/edit`

| 字段 | 新建 | 编辑 | 规则 |
|---|---|---|---|
| `name` | ✓ | ✓ | 1–100 字，账本内不要求唯一（但重名时给一条软提示） |
| `type` | ✓ | ✓ | `checking` / `savings` / `credit` / `cash` / `other`（决策 §3；`cash` 是新增的，`investment` 不在其列） |
| `default_currency` | ✓ | ✗ | 3 位大写；建后不可改（改了历史交易的币种含义会乱） |
| `opening_balance` | ✓ | ✓ | `NUMERIC(18,4)`，默认 0，可负（信用卡欠款）（决策 §3） |
| `archived` | ✗ | ✓ | 开关 |

- 期初余额旁一行说明：「余额 = 期初余额 + 这个账户下所有交易金额之和（决策 §3）。信用卡请填当前欠款的负数。」
- 编辑时修改 `opening_balance` 会立刻影响所有历史余额与首页净资产，保存前二次确认。
- 端点：`POST` / `PATCH /ledgers/{id}/sources[/{sid}]`；`PATCH` 带 `updated_at`。成功后回列表 + Toast。

### 4.10 导入 `/l/:ledgerId/imports*`（决策 §5）

四步，走的是同一个批次 id 的不同 `status`：

```
 /imports/new                      /imports/:bid                     /imports/:bid            /imports/:bid
┌────────────────┐  POST /imports ┌──────────────┐  轮询 GET      ┌──────────────────┐ POST  ┌──────────────┐
│ 1 选账户+上传   │───────────────▶│ 2 解析中      │───status──────▶│ 3 review 表格    │commit▶│ 4 结果        │
│ source_id + 文件│               │ uploaded/     │  = ready        │ (可编辑草稿行)    │       │ committed     │
└────────────────┘                │ parsing       │                └──────────────────┘       └──────┬───────┘
                                  └──────┬────────┘                         ▲                        │
                                         │ status=failed                    │ 修完继续              │ DELETE = 撤销
                                         ▼                                  │                        ▼
                                  ┌──────────────┐  POST retry              │                 ┌──────────────┐
                                  │ 解析失败      │──────────────────────────┘                 │ 已撤销/丢弃   │
                                  │ 显示 error    │                                            └──────────────┘
                                  └──────────────┘
```

#### 步骤 1 — 选账户并上传（`/imports/new`）

- **前置检查**：`GET /me/llm-settings` 为空 → 不显示上传区，改显示引导卡「还没配置模型，导入需要它 → [去个人设置]」（决策 §6）。
- 目标账户：必选（决策 §5，不让 LLM 猜），只列未归档账户；选中后显示该账户的币种作为解析提示。
- 文件区：拖拽 + 点击选择。接受 `application/pdf`、`text/csv`、`.xlsx`、`image/jpeg`、`image/png`（决策 §5）。
- **客户端限制**（服务端仍会校验，决策 §5、§9）：> 10 MB 直接拒绝并提示；类型不符直接拒绝。
- 上传用 `uploadClient`（§3.2），显示进度条（`onUploadProgress`）。
- **同一账本同时只允许一个批次在 `parsing`**（决策 §5）：已有在跑的批次时上传按钮禁用，并给出跳过去看的链接；服务端返回 `import_in_progress` 时同样处理。
- 成功 → `router.replace('/l/:id/imports/:bid')`。

#### 步骤 2 — 解析进度（`status ∈ {uploaded, parsing}`）

- 轮询 `GET /ledgers/{id}/imports/{bid}`（决策 §5：数据库状态轮询，不引入队列）：**间隔 2 秒起，每 5 次退避一档到 5 秒，上限 5 秒**；`refetchIntervalInBackground: false`（标签页隐藏时不轮询，回来立刻取一次）。
- 页面显示：文件名、大小、目标账户、已用时长，以及一条进度条 + 阶段文案。进度来自批次的 `progress: {done, total}`（03 §5.40）：`total` 为 `null`（还在抽取文本、块数未知）时显示不确定进度条 + 「正在提取文本…」；`total` 有值后显示 `done/total` 的确定进度条 + 「正在识别第 3/8 块…」。
- **超时保护**：超过 5 分钟仍在 `parsing`，显示「解析时间比预期长，可以先离开，稍后回到导入历史里查看」。
- `status='failed'`：批次只有一个 `error` 字段（03 §5.40），它的前缀就是 §4.2 的 code（如 `llm_error: upstream returned 429 after 1 chunk`）——按前缀查 §3.7 的文案表，把原文放进「详情」折叠。两个按钮「重试」（`POST .../retry`）与「丢弃」（`DELETE`）。
- 服务重启会把残留的 `parsing` 批次标 `failed`（决策 §5），前端不需要特殊处理，轮询自然看到。

#### 步骤 4 — 结果与撤销

- `status='committed'`：显示「已导入 N 条交易」，按钮「查看这批交易」（跳交易列表并按批次筛选，见 [待决 D-7](#待决)）与「撤销这批导入」。
- **撤销**（决策 §5，不限时限）：`confirm` 里必须显示条数——「这会删除这批导入建立的 128 条交易，无法恢复」，`tone: 'danger'`，要求二次点击。调 `DELETE /ledgers/{id}/imports/{bid}`。
- **历史批次列表**（`/l/:ledgerId/imports`）：表格/卡片列表，列：文件名、目标账户、上传时间、上传人、状态徽章、行数、已建交易数。`ready` 的批次带「继续 review」按钮；`failed` 带「重试 / 丢弃」；`committed` 带「撤销」。分页 20 条一页。

### 4.11 导入 review 表格（`status='ready'`，决策 §5）

这是整个产品最重的一屏，桌面优先（决策 §0.6）。

#### 4.11.1 布局

```
┌──────────────────────────────────────────────────────────────────────────────┬──────────┐
│ 招商银行信用卡 8 月账单.pdf → 招行信用卡 · 共 128 行 · 待归类 6 · 可能重复 3   │ 页面缩略 │
├──────────────────────────────────────────────────────────────────────────────┤   图侧栏  │
│ [☑ 已选 4] [批量设分类▾] [批量跳过] [取消跳过]   筛选:[全部|待归类|有标记|已跳过]│ ┌──────┐ │
├──┬────┬──────┬────────┬────┬──────┬────────┬──────┬──────┬──────┬──────┬─────┤ │ p.1  │ │
│☐ │行/ │ 日期  │ 金额    │币种│ kind │ 商户    │ 备注 │ 一级 │ 二级 │对手  │标记 │ │[缩略]│ │
│  │原文│      │         │    │      │        │      │      │      │账户  │     │ ├──────┤ │
├──┼────┼──────┼────────┼────┼──────┼────────┼──────┼──────┼──────┼──────┼─────┤ │ p.2  │ │
│☐ │ 1  │08-02 │ −38.00 │CNY │支出▾ │星巴克  │和同事│餐饮▾ │午餐▾ │  —   │     │ │[缩略]│ │
│☑ │ 2  │08-03 │ −1299  │CNY │支出▾ │京东    │      │ ⚠︎待  │      │  —   │ ⚑重 │ │◀当前 │ │
│☐ │ 3  │08-05 │ +1000  │CNY │转账▾ │还款    │      │  —   │  —   │储蓄卡│ ⚑还 │ ├──────┤ │
│☐ │ 4  │08-07 │ +259.0 │CNY │退款▾ │淘宝    │      │服饰▾ │衣服▾ │  —   │ ⚑退 │ │ p.3  │ │
│~~5~~ 已跳过 …………………………………………………………………………………………………………………… │ │[缩略]│ │
├──────────────────────────────────────────────────────────────────────────────┤ └──────┘ │
│ ⚠︎ 还有 6 行没有一级分类，补齐后才能提交   [提交 122 行]（禁用）              │          │
└──────────────────────────────────────────────────────────────────────────────┴──────────┘
```

#### 4.11.2 列清单

| 列 | 可编辑 | 控件 | 说明 |
|---|---|---|---|
| 勾选 | — | Checkbox | 表头全选/反选；Shift 点击选区间 |
| 行号 / 原文 | 否 | 文本 + 悬浮卡 | `row_no`；悬停/点击显示 `source_ref` 指向的原始文本行或「第 3 页第 12 行」（决策 §6） |
| 日期 | ✓ | 日期框 | `date`；为空时红框 |
| 金额 | ✓ | 数字框 | `amount`，显示带符号；符号由 kind 决定，用户改 kind 时自动翻转 |
| 币种 | ✓ | Picker | `currency`，默认目标账户的 `default_currency` |
| kind | ✓ | 下拉 | 支出 / 收入 / 退款 / 转账（决策 §1）；改 kind 联动分类树与对手账户列的可用性 |
| 商户 | ✓ | 文本框 | `merchant`（≤200） |
| 备注 | ✓ | 文本框 | `note`（≤500） |
| 一级分类 | ✓ | 级联选择器 | `category_l1`；transfer 行置为 `—` 且禁用（决策 §10） |
| 二级分类 | ✓ | 级联选择器 | `category_l2`；随一级过滤 |
| 对手账户 | ✓ | Picker | `counterpart_source_id`，仅 `kind='transfer'` 行可用；另有 `transfer_subtype` 的普通/还款切换（在同一格的小开关里） |
| 关联原单 | ✓ | 弹层 | `matched_transaction_id`，仅 `kind='refund'` 行可用，复用 §4.6.3 的选择器 |
| 状态/标记 | 部分 | 徽章 + 跳过开关 | `status` 与 `flags`（下表） |

`confidence` 不单独占列：`< 0.6` 的行整行左侧加一条浅色竖线，悬停显示「模型把握不大」。

#### 4.11.3 标记徽章（决策 §5）

| 徽章 | 来源 | 颜色 | 含义与默认操作 |
|---|---|---|---|
| ⚑ 可能重复 | `flags` 含 `duplicate` | 警告色 | 同账户同日同金额已存在。默认**不自动跳过**，但排在筛选「有标记」的最前，一键「跳过这些重复行」 |
| ⚑ 疑似退款 | `flags` 含 `refund_candidate` | 强调色 | 已把 `kind` 置 `refund` 并预填 `matched_transaction_id`（唯一候选时）。悬停显示匹配到的原单摘要 |
| ⚑ 还款 | `flags` 含 `repayment` | 强调色 | 已把 `kind` 置 `transfer`、`transfer_subtype='repayment'`，并可能预填 `counterpart_source_id`。若还找到了对手账户的反向腿，同时叠加「可能重复」 |
| ⚑ 需核对 | `flags` 含 `needs_review` | 警告色 | 视觉路径解析出的行，或日期/金额解析失败的行（决策 §5、§6）。点徽章 → 侧栏跳到对应页缩略图 |
| ⚠︎ 待归类 | 派生：`category_l1 == null && kind !== 'transfer' && status !== 'skipped'` | 阻断色 | **提交前必须补齐**（决策 §1.3、§5） |
| 已跳过 | `status === 'skipped'` | 中性 | 整行置灰删除线，不参与提交，不参与「待归类」计数 |
| 已编辑 | `status === 'edited'` | 中性细标 | 用户改过这一行 |

#### 4.11.4 行内编辑与保存

- 每个单元格失焦（或选择器关闭）即 `PATCH .../rows/{rid}`，**只发改动的字段**。
- 乐观更新：先 `setQueryData` 改本地行，请求失败时回滚并在该格显示红色感叹号 + 重试。
- 保存状态在行号旁用一个小圆点表示：灰＝已保存、蓝＝保存中、红＝失败。
- 防抖：文本框 500ms，选择器立即。
- 这张表**关闭 `refetchOnWindowFocus`**（§2.4），否则切窗口回来会覆盖正在输入的内容。

#### 4.11.5 批量操作

- **批量设分类**：选中若干行 → 选一个一级（可选二级）→ 逐行 `PATCH`（并发上限 6，带整体进度条，失败的行留在选中集合里可重试）。kind 不匹配的行（如给收入行设支出分类）自动排除并在结果里说明。
- **批量跳过 / 取消跳过**：把 `status` 设成 `skipped` / `pending`。
- **批量设 kind**、**批量设币种**：同机制。
- 顶部筛选切片：全部 / 待归类 / 有标记 / 已跳过 / 低置信度。切片只影响显示，不影响选中集合（切走再切回来选中还在）。

#### 4.11.6 视觉路径的页面缩略图侧栏（决策 §5）

- 只有批次里存在 `page_image_url` 非空的行时才出现（即走了视觉模型的批次）。
- 侧栏纵向排列每页缩略图；点某页 → 表格滚动并高亮该页产生的行；反过来，光标停在某一行 → 侧栏高亮并滚动到对应页。
- 点缩略图放大成可缩放的浮层（滚轮缩放、拖拽平移），方便对照原始账单核对金额。
- 窄屏：侧栏收成表格上方的一条横向缩略图带，点击弹出全屏查看。

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
| `C` | 打开当前行的分类选择器（选择器内部用输入过滤 + `↑↓` + `Enter`） |
| `[` / `]` | 跳到上一个/下一个待归类行 |
| `⌘/Ctrl + Enter` | 提交整批（阻断条件满足时才生效） |
| `?` | 显示快捷键帮助浮层 |

焦点单元格用 2px 强调色描边（不是浏览器默认 outline），滚动时始终保持在视口内。

#### 4.11.8 提交与阻断条件

- 提交按钮文案带数量：「提交 122 行」（= 非 `skipped` 的行数）。
- **阻断**（决策 §1.3、§5）：存在待归类行（§4.11.3 的派生定义）时按钮禁用，按钮上方一条常驻提示「还有 N 行没有一级分类」+「跳到第一条」链接。
- 其他阻断：任何行 `date` 或 `amount` 为空；`kind='transfer'` 但没选对手账户且没填对方文本；有正在保存失败的行。
- 提交调 `POST .../commit`，服务端在一个事务里建全部交易（决策 §5）。期间显示遮罩进度。
- 成功 → 步骤 4；失败（409 `batch_not_ready` / 409 `rows_uncategorized` / 某行 400 校验失败）→ Toast + 把服务端指出的 `row_no` 高亮滚动到位。

#### 4.11.9 手机上的降级方案

宽表在手机上不可用，改成**卡片流**，语义完全等价：

```
┌───────────────────────────────────┐
│ #2  08-03            ⚑重复  ⚠︎待归类│
│ 京东                    −¥1,299.00 │
│ 支出 ▾   [ 选择分类 ]              │
│ [编辑详情]              [跳过]     │
└───────────────────────────────────┘
```

- 一行一卡，最常改的两件事（kind、分类）直接在卡上；其余字段进「编辑详情」底部抽屉。
- 批量操作放在底部固定条：长按进入多选模式后出现。
- 缩略图变成卡上的一个小图标，点开全屏查看。
- 顶部筛选切片保留，默认落在「待归类」——手机上最合理的用法是「只把待归类的补完，剩下的回电脑上处理」。

### 4.12 账本设置 `/l/:ledgerId/settings`

- **端点**：`GET /ledgers/{id}`、`PATCH /ledgers/{id}`、`GET /ledgers/{id}/members`、`POST /ledgers/{id}/invites`、`DELETE /ledgers/{id}/members/{user_id}`、`POST /ledgers/{id}/transfer-ownership`、`POST /ledgers/{id}/leave`、`DELETE /ledgers/{id}`。
- **基本信息**：账本名（owner 可改）。**基准币种**（owner 可改）——改之前弹警告：

  > 改成 EUR 之后，首页统计和所有折算金额都会按 EUR 重新计算（原始交易金额和币种不变）。历史数据不会被改写，但所有汇总数字都会变。确定吗？

  （决策 §2：基准币种属于账本；决策 §8：折算是读取时计算，所以改了立刻全变。）
- **成员列表**：每行邮箱、角色徽章、加入时间。owner 行不可移除。
  - `member` 视角：只读，底部只有「退出这个账本」。
  - `owner` 视角：每行有「移出」（确认框说明「他记的账会保留在账本里」）；「转让创建者」下拉选一个成员 + 二次确认（转让后自己变成 member，界面立刻降权）。
- **邀请码**（决策 §2）：按钮「生成邀请码」→ 显示 6 位大字码 + **10 分钟倒计时**（`expires_at` 驱动，每秒刷新）+ 复制按钮。倒计时归零后码变灰并提示重新生成。一次性使用，成功被用掉后（下次拉成员列表发现多了人）也提示已使用。页面提示「把这 6 位码线下告诉对方，让他在『加入账本』里输入」。
- **软限制**（决策 §2）：成员满 10 人时生成邀请码按钮禁用。
- **退出**：member 直接退；owner 必须先转让（按钮禁用 + 说明，决策 §2）。
- **删除账本**（仅 owner）：`tone: 'danger'` 确认框，必须输入账本名才能确认，文案列出将被删除的内容——「N 个账户、M 条交易、K 批导入记录会一并删除，无法恢复」（决策 §2 的级联删除）。成功后跳 `/ledgers`。

### 4.13 个人设置 `/settings` 与 LLM 设置 `/settings/llm`

**`/settings`**：

- 只读：邮箱、注册时间。
- **默认币种**（`PATCH /me`，`base_currency`）：一行说明「只影响新建账本时的默认值；已有账本的基准币种在各自的账本设置里改」（决策 §2）。
- **语言**：跟随系统 / 中文 / English（决策 §0.4）。切换立即生效（`i18n.changeLanguage`）并 `PATCH /me` 持久化。
- 入口：LLM 设置、账本设置、登出。

**`/settings/llm`**（决策 §6）：

| 字段 | 控件 | 说明 |
|---|---|---|
| `base_url` | 文本框 | 默认 `https://openrouter.ai/api/v1`；提示「任何 OpenAI 兼容端点都行，会调用它的 `/chat/completions`」 |
| `api_key` | 密码框 | **只显示尾 4 位**（`api_key_last4`）：已保存时占位符渲染成 `••••••••••••3f9a`，聚焦即清空表示要重填；不填就是保留原 key（`LlmSettingsPut.api_key` 省略） |
| `model` | 文本框（带常用值下拉建议） | 文本解析用 |
| `vision_model` | 文本框，可空 | 导图片时用；留空则用 `model`（决策 §6） |

- **测试连接**（`POST /me/llm-settings/test`）：按钮旁显示结果块：

```
✅ 连接成功 · 模型可用 · 支持图片输入 · 1.2s
⚠️ 连接成功 · 模型可用 · 不支持图片输入（扫描件/图片账单会失败）
❌ 连接失败：401 Unauthorized（api_key 不对）
```

  测试用**表单里当前的值**（未保存也能测），所以 `llmApi.test` 接受一个可选 body。
- **删除配置**：`DELETE /me/llm-settings`，确认框说明「删掉后就不能导入账单了」。
- 页面顶部说明：「模型调用在服务器上用你自己的 key 发起，账单内容会发给你配置的这个服务商。」（决策 §6：没有服务端共享 key。）

---

## 5. i18n

### 5.1 选型

**i18next 25 + react-i18next 16 + expo-localization**（决策 §0.4）。

| 候选 | 取舍 |
|---|---|
| **i18next + react-i18next**（选中） | 复数、插值、命名空间、`t(['a','b'])` 的 key 回退（§3.7 的错误映射直接用得上）、懒加载语言包、生态里有现成的 key 提取与缺失检测工具；跨 Web/原生同一套 API |
| `react-intl` (FormatJS) | ICU 消息格式更强、日期数字格式化一体化；但 API 更重，运行时体积更大，且 key 回退要自己写 |
| 自己写一个 `t()` | 只有两种语言时看着够用，但复数、插值、缺失 key 回退、语言切换重渲染都得重新实现一遍，不划算 |

`expo-localization` 负责读设备语言（`getLocales()[0].languageCode`）。语言决策顺序：`user.language`（服务端持久化，决策 §11 的 `PATCH /me`）→ `localStorage['wallet:lang']` → 设备语言 → `zh`。选了「跟随系统」时存 `'system'` 并在设备语言变化时跟着变。

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
      import.json          导入四步与 review 表格
      settings.json        个人设置、LLM
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
    "day_total": "当日支出 {{amount}}",
    "count": "{{count}} 笔交易"
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

分类是后端常量，接口 `GET /categories` 同时给 `name_zh` 和 `name_en`（决策 §1.3、§11）。前端：

```ts
export function categoryName(c: Category, lang: string): string {
  return lang.startsWith('zh') ? c.name_zh : c.name_en;
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

## 6. 视觉重设计方向

> **实现前必须先出 mockup 并经用户确认（决策 §0.3）。** 本节给的是方向与 token 骨架，不是最终稿；`.planning/research/ui-redesign-v2/spec.md` 只作参考（决策 §0.3），不作为约束。

现状是没有设计的默认外观：14 个文件里 147 处字面量颜色、18 种色值、一个 `#0ea5e9` 蓝当强调色、emoji 当图标、没有深色模式（现状文档 §6.2；`frontend/app.json:8` 的 `userInterfaceStyle: "light"`）。重做的目标不是「更好看」，是**让这个应用一眼看上去不像模板**，并且让密集的数字表格（交易列表、review 表格）真的好读。

### 6.1 三个候选方向

#### 方向 A —「账本纸张」（Ledger Paper）

- **概念**：向纸质账本和财务报表借语言。暖白纸底、墨色文字、发丝线分栏，红黑两色承担收支语义（中文记账传统里「赤字」就是红的）。
- **排版**：标题用衬线（`Noto Serif SC` / `Source Serif 4`），正文用无衬线（`Noto Sans SC` / `Inter`），**所有金额与表格数字用等宽 tabular**（`IBM Plex Mono` 或 `Inter` 的 `font-variant-numeric: tabular-nums`）。字号跨度大：页面主数字 40–48px，正文 14px。
- **配色**：纸 `#FBF9F4`；墨 `#1A1917`；分隔线 `#E3DDD1`；支出朱红 `#C2402C`；收入墨绿 `#1F5C4A`；退款琥珀 `#B4741A`；转账灰蓝 `#4A5A6B`；强调（按钮/焦点）墨绿。
- **形状**：圆角 4px（几乎方）；不用阴影，用 1px 发丝线和背景色差分层；卡片是「纸片」而不是「浮起的盒子」。
- **图标**：1.5px 线稿，方头端点，手绘感的收支箭头。
- **深浅色**：浅色是主设计；深色做「夜灯」变体（暖深灰 `#1A1815` 而不是纯黑，墨色反相成 `#EDE8DE`），红绿两色提亮保持对比度。
- **适合的理由**：和「记账」这件事语义直接相关，第一眼不像任何 SaaS 模板；等宽数字对交易列表和 review 表格是**功能性优势**而不只是风格；红/绿/琥珀/灰蓝四色天然对应四个 kind（决策 §1），语义色不用另外发明。
- **风险**：衬线在小屏、小字号下可读性差（缓解：衬线只用于标题和大号金额）；「复古纸感」做不好会滑向廉价的仿旧；深色变体要重新设计而不是简单反相。

#### 方向 B —「静音仪表盘」（Quiet Instrument）

- **概念**：瑞士网格 + 专业交易终端。几乎无彩的灰阶承担全部层次，只留一个高饱和强调色。
- **排版**：全程 `Inter` / `Noto Sans SC`，字重跨度大（400 正文 / 600 小标题 / 700 大数字），全局 `tabular-nums`。
- **配色**：底 `#FAFAFA` / 面 `#FFFFFF`；文字 `#111214` / `#5B5F66` / `#9AA0A6`；线 `#E8EAED`；强调靛蓝 `#3A4FE4`；支出/收入用**灰阶 + 箭头方向**区分，只有需要强调时才上色（红 `#D93B3B` / 绿 `#1B8A5A`）。
- **形状**：8px 间距刻度，10px 圆角，极轻阴影（`0 1px 2px rgba(0,0,0,.05)`）。
- **图标**：20px 线性，2px 描边，统一图标集（`lucide` 风格）。
- **深浅色**：天然对称，深色只需换一组灰阶 token。
- **适合的理由**：信息密度最高，交易列表和 review 表格里最不会累；实现成本最低，token 体系最直白；深浅色双主题几乎零额外设计。
- **风险**：**最容易滑向「通用 SaaS 模板」**——正是要避免的东西。要靠字号跨度、留白节奏和一个不常见的强调色把它拉开，这需要更强的排版功力，不是靠 token 表能保证的。

#### 方向 C —「夜间记账台」（Night Desk）

- **概念**：深色优先，浅色是派生。单一暖强调色在深底上发光。
- **排版**：`Inter` / `Noto Sans SC`，大量 12–13px 的次要信息，数字 `tabular-nums`。
- **配色**：底 `#0E1116`；面 `#161A21` / `#1D222B`；文字 `#E6E9EF` / `#98A1B0`；强调琥珀 `#FFB020`；支出 `#FF6B5A`；收入 `#3ED598`；分类用彩色圆点而非彩色块。
- **形状**：16px 圆角，柔和内发光边框（`inset 0 0 0 1px rgba(255,255,255,.06)`）。
- **适合的理由**：夜里记账是真实高频场景；深色下彩色点的分类色板很好看，首页统计会很出彩。
- **风险**：**导入 review 表格在深色下长时间阅读疲劳**，而决策 §0.6 明确要求它好用；截图分享、打印都不友好；浅色变体必须认真做而不能敷衍，工作量实际翻倍。

### 6.2 推荐

**推荐方向 A「账本纸张」**，理由按重要性排序：

1. 它是三个里唯一有**内容主张**的：一眼能看出这是记账应用而不是一个通用 dashboard 模板，直接命中决策 §0.3「全新视觉重设计」的意图。
2. 等宽数字 + 发丝线分栏这套东西对本产品的两块重头戏（交易列表、review 表格）是功能性的，不是装饰。
3. 四个 kind（决策 §1）在它的配色里有现成的语义位置，不用额外发明色板。

采纳它的同时吸收 B 的两点：**8px 间距刻度**和**统一线性图标集**——A 的「手绘线稿」如果没有成套图标支撑会做不出一致性。风险缓解已写在 §6.1 A 的对应条目里。

最终以 mockup 为准；如果 mockup 阶段用户更喜欢 B 或 C，token 清单（§6.3）的**结构**不变，只换值。

### 6.3 设计 token 清单

token 定义在 `frontend/src/theme/tokens.ts`，由一个 `ThemeProvider` 按 `light` / `dark` 提供；组件只读语义名，**不允许在组件里写字面量色值**（这是对现状 147 处硬编码的直接修正）。

**颜色（语义名，不是色名）**

| token | 用途 |
|---|---|
| `bg.canvas` / `bg.surface` / `bg.raised` | 页面底 / 卡片面 / 浮层面 |
| `bg.subtle` / `bg.hover` / `bg.selected` | 次级块 / 悬停 / 选中 |
| `fg.primary` / `fg.secondary` / `fg.muted` / `fg.inverse` | 主文字 / 次要 / 弱化 / 反白 |
| `border.default` / `border.strong` / `border.focus` | 发丝线 / 强分隔 / 焦点环 |
| `accent.solid` / `accent.fg` / `accent.subtle` | 主按钮底 / 其上文字 / 淡底 |
| `kind.expense` / `kind.income` / `kind.refund` / `kind.transfer` | 四个 kind 的语义色（决策 §1），各配 `.subtle` 淡底版 |
| `status.success` / `warning` / `danger` / `info`（各 `.fg` / `.bg`） | Toast、徽章、校验 |
| `flag.duplicate` / `flag.needs_review` / `flag.uncategorized` | review 表格徽章（§4.11.3） |
| `chart.series[0..7]` | 分类汇总条形与趋势线；色相均匀分布且深浅两套都过 3:1 |

所有前景/背景组合必须过 WCAG AA（正文 4.5:1，大字与图形 3:1），深浅两套各验一遍。

**字号阶**（1.25 比例，向下压平）

| token | px / line-height | 用途 |
|---|---|---|
| `text.display` | 40 / 44 | 首页净资产、月度大数 |
| `text.title` | 28 / 34 | 页面标题 |
| `text.heading` | 20 / 28 | 区块标题 |
| `text.subheading` | 16 / 24 | 卡片标题 |
| `text.body` | 14 / 20 | 正文（Web 输入框实际渲染 ≥16px，见 §7.1） |
| `text.caption` | 12 / 16 | 次要信息、表头 |
| `text.micro` | 11 / 14 | 徽章、角标 |
| `num.*` | 同上各档 + `tabular-nums` | 一切金额、日期、行号 |

**间距**（4 的倍数）：`space.0/1/2/3/4/5/6/8/10/12/16` = 0/4/8/12/16/20/24/32/40/48/64。
**圆角**：`radius.sm`=4、`radius.md`=8、`radius.lg`=12、`radius.pill`=999。
**阴影**：`shadow.none` / `shadow.raised`（浮层）/ `shadow.overlay`（模态）——方向 A 只在浮层用阴影，平面靠线分层。
**其他**：`z.*`（dropdown 100 / sticky 200 / overlay 300 / toast 400）、`motion.fast`=120ms / `motion.base`=200ms（`prefers-reduced-motion` 时全部归零）、`breakpoint.md`=1024。

### 6.4 组件清单

`frontend/src/ui/` 下，每个组件跨 Web/原生同一份实现，**内部不出现 `Platform.OS` 之外的平台假设，页面里一次都不出现**。

| 组件 | 变体 / 要点 |
|---|---|
| `Button` | `primary` / `secondary` / `ghost` / `danger`；`sm`/`md`/`lg`；`loading`、`iconOnly`；最小命中区 44×44（沿用现状约束 `frontend/src/components/Button.tsx:75,95` 与 `scripts/verify-touch-targets.mjs`） |
| `TextField` | label / hint / error / 前后缀（币种符号）/ 字数上限提示；`numeric` 变体带 `inputMode="decimal"` |
| `AmountField` | 金额专用：等宽、千分位、符号只读、币种内嵌下拉 |
| `DateField` | 跨平台日期选择（Web `<input type="date">` 封装在组件内部，原生用日期轮）；替代现状 5 处裸 `<input>` |
| `Select` / `MultiSelect` | 单选/多选下拉，带搜索；替代现状 4 份复制的 Modal 选择器（现状文档 §4.9） |
| `CategoryPicker` | 两级级联，最近使用置顶，按 kind 过滤（决策 §1.3） |
| `SourcePicker` | 账户选择：名称 + 类型图标 + 币种 + 余额，排除归档 |
| `SegmentedControl` | kind tab、子类型切换 |
| `Card` | `flat` / `outlined` / `raised` |
| `DataTable` | review 表格的底座：列定义、粘性表头、行虚拟化、键盘导航、行内编辑槽位、选中集合 |
| `Badge` | `neutral` / `info` / `warning` / `danger` / `kind-*`；带图标位（review 标记用） |
| `Chip` | 筛选栏的可关闭条件片 |
| `BottomTabBar` | 五项 + 中央凸起 FAB（决策 §0.6） |
| `Sidebar` | 宽屏导航 + 账本切换器 |
| `LedgerSwitcher` | 下拉：账本列表 + 新建 + 加入 |
| `EmptyState` | 图形 + 标题 + 一句话 + 主按钮；每个列表页都有专属文案 |
| `Toast` / `ToastHost` | success / error / warning，错误可展开 detail（§3.9） |
| `ConfirmDialog` | 标题 / 正文 / 危险态 / 需输入确认词 |
| `Skeleton` | 行、卡、表格三种骨架 |
| `Sheet` | 窄屏底部抽屉（筛选、行详情、账本切换） |
| `ProgressBar` | 上传进度、解析不确定进度、批量操作进度 |
| `StatTile` | 首页大数：标题 + 大数 + 环比小字 |
| `BarList` / `TrendChart` | 分类排行与 12 月趋势（数值标签必须直接可读，不只靠 tooltip） |
| `KeyboardHint` | review 表格的快捷键帮助浮层 |

### 6.5 实现前要出的 mockup 清单（决策 §0.3）

按「页面 × 断点」列。断点：**M** = 375×812（窄），**D** = 1440×900（宽）。带 ★ 的是决定整体调性、必须先做的第一批。

| # | 页面 / 状态 | M | D |
|---|---|---|---|
| 1 ★ | 首页（有数据：3 个账户、本月 8 个分类、12 月趋势） | ✓ | ✓ |
| 2 ★ | 交易列表（有数据 + 筛选栏展开，含四种 kind 各一行、跨币种一行、单腿转账一行） | ✓ | ✓ |
| 3 ★ | 导入 review 表格（含四种徽章、待归类阻断条、缩略图侧栏） | ✓（卡片流降级） | ✓ |
| 4 ★ | 记一笔 — 支出 tab | ✓ | ✓ |
| 5 | 记一笔 — 转账 tab（两腿跨币种展开态 + 单腿 counterparty 态两张） | ✓ | ✓ |
| 6 | 记一笔 — 退款 tab + 关联原支出选择器浮层 | ✓ | ✓ |
| 7 | 交易详情（两腿转账） | ✓ | ✓ |
| 8 | 账户列表 + 账户表单 | ✓ | ✓ |
| 9 | 导入步骤 1（选账户 + 上传）与步骤 2（解析中） | ✓ | ✓ |
| 10 | 导入历史列表（含 committed / failed / ready 三种状态行） | ✓ | ✓ |
| 11 | 账本设置（成员列表 + 邀请码倒计时态） | ✓ | ✓ |
| 12 | 账本列表 / 加入账本（6 位码输入） | ✓ | ✓ |
| 13 | 个人设置 + LLM 设置（含测试连接三种结果） | ✓ | ✓ |
| 14 | 登录 / 注册（含注册关闭态） | ✓ | ✓ |
| 15 | 空态合集（无账户 / 无交易 / 筛选无结果 / 无导入） | ✓ | — |
| 16 | 错误与反馈合集（Toast 三态、409 冲突提示、危险确认框、离线条） | — | ✓ |
| 17 | 深色模式：#1、#2、#3 各一张 | ✓ | ✓ |
| 18 | 组件板（§6.4 全部组件的全部变体，一张长图） | — | ✓ |

流程：先出 ★ 四项的 M+D 共 8 张 → **给用户确认整体方向（决策 §0.3）** → 定稿后补完其余 → 再把 token 落进代码。方向没确认之前不写任何样式代码。

---

## 7. PWA 与构建

沿用现状（[`../current-design/04-frontend.md`](../current-design/04-frontend.md) §7、§8）：`frontend/public/` 里的 `manifest.json` / `index.html` / `pwa.css` / `offline.html`、`workbox generateSW` 生成 `dist/sw.js`、`registerSW.ts` 在 Web 上注册、`expo export -p web` 产出 `dist/` 交给 Caddy（决策 §0.1 部署沿用现状）。以下是必须调整的点。

### 7.1 保持不变的

- `pwa.css` 的 `input, select, textarea { font-size: 16px !important; }`（`frontend/public/pwa.css:4-6`）——防 iOS Safari 聚焦放大。设计 token 里 `text.body` 是 14px，但 Web 上输入框实际渲染 16px，这是有意的，mockup 里要按 16px 画输入框。
- `viewport-fit=cover`（`frontend/public/index.html:6`）+ `SafeAreaProvider`（`frontend/App.tsx:38`）。
- 图标生成脚本 `frontend/scripts/generate-icons.mjs`（背景色 `#0ea5e9` 要换成新主题的强调色）。
- `scripts/verify-pwa.mjs` 与 `scripts/verify-touch-targets.mjs` 的检查项继续跑。

### 7.2 必须调整的

| 项 | 现状 | 目标 | 原因 |
|---|---|---|---|
| `navigateFallback` | `/offline.html`，denylist 只排除 `/api`（`frontend/workbox-config.cjs:33-34`） | `navigateFallback: '/index.html'`，denylist `[/^\/api/]`；离线由应用内的离线条处理 | 现状下任何非 `/` 的导航都会拿到 `offline.html`，**即使在线**（现状文档 §7.4）。v3.0 有真实路由（§1.2），深链接是核心功能，这条必须改，否则刷新 `/l/xxx/transactions` 就白屏 |
| `api-cache` 运行时缓存 | `NetworkFirst`，缓存全部 `/api/` GET，登出不清（现状文档 §7.4） | 只缓存 `GET /api/v1/categories` 与 `GET /api/v1/rates/currencies`（`CacheFirst`，30 天）；其余 API 请求 `NetworkOnly` | 账本数据是多人共享的（决策 §2），从 service worker 缓存里读到别人已经改过的旧数据比报错更糟；另外缓存按 URL 键控，换用户不换 key |
| 登出清缓存 | 无 | `logout()` 里 `caches.delete('api-cache')` + `queryClient.clear()` | 共用设备时不能把上一个用户的数据留在磁盘上 |
| 更新提示 | 无（新 worker 直接 `skipWaiting`，用户下次刷新才拿到新代码，现状文档 §7.5） | 保留 `skipWaiting`，另加：检测到 `controllerchange` 时弹一条 Toast「已更新到新版本，刷新以使用」 | 避免用户在旧 bundle 上遇到已修的 bug |
| `manifest.json` 的 `theme_color` / `background_color` | `#0ea5e9` / `#ffffff` | 换成新主题的值；`background_color` 与启动屏一致 | 视觉重设计 |
| `app.json` 的 `userInterfaceStyle` | `"light"`（`frontend/app.json:8`） | `"automatic"` | §6.3 要求深浅色双主题 |
| `API_BASE_URL` 的切换方式 | `build:web` 用 `cp config.prod.ts config.ts` 覆盖，失败时会把生产配置留在工作区（`frontend/package.json:10`） | 改成 `app.config.ts` + `EXPO_PUBLIC_API_BASE_URL` 环境变量，`config.prod.ts` / `config.dev.ts` 两个文件删除 | 现状那条命令链是脆的，且三个 config 文件容易漂移 |
| `offline.html` | 保留 | 保留，但只在 precache 缺失时兜底 | 不再作为导航回落 |
| 上传大小 | 无客户端限制 | 客户端先判 10 MB（决策 §5、§9） | 省一次失败的往返 |

### 7.3 构建

`package.json` 脚本目标形态：

| 脚本 | 命令 |
|---|---|
| `web` | `expo start --web` |
| `build:web` | `EXPO_PUBLIC_API_BASE_URL=/api/v1 expo export -p web && npx workbox generateSW workbox-config.cjs` |
| `test` | `jest` |
| `typecheck` | `tsc --noEmit` |
| `lint` | `eslint . --max-warnings 0` |
| `verify` | `npm run typecheck && npm run lint && npm test && npm run build:web && node scripts/verify-pwa.mjs --all && node scripts/verify-touch-targets.mjs` |

`build:web` 不再改动工作区文件，`config.prod.ts` / `config.dev.ts` 一并删除。

---

## 8. 测试

现状的 5 个测试套件全是 `fs.readFileSync` + 字符串断言，没有一个渲染组件（现状文档 §9.2）。这类测试在重写中一条都活不下来，也不该活下来。目标是三层：

### 8.1 单元测试（纯函数，`jest`，无渲染）

| 对象 | 用例 |
|---|---|
| `normalize(params)`（§3.5） | 空值删除、数组排序、键序稳定 → 相同筛选状态产出相同 key |
| URL ↔ 筛选状态互转（§1.3） | 往返一致；数组用重复键；空值不出现在 URL 里 |
| `formatMoney` / `formatDate` / `formatMonth`（§5.4） | 负号用 U+2212；JPY 零小数；`'2026-08-14'` 在 UTC+8 下显示 8 月 14 日**不是** 13 日；「今天/昨天」按本地时区 |
| kind → 金额符号 | 四种 kind 各自的符号规则（决策 §1） |
| 分类可用集 | `kindAllows('expense')` 只返回支出树；`'transfer'` 返回空（决策 §1.3） |
| 待归类判定（§4.11.3） | `skipped` 行不算；`transfer` 行不算；`category_l1` 为空的 expense 行算 |
| `errorMessage` 映射（§3.7） | 已知 code 命中文案；未知 code 落到 `errors.unknown` 且带 detail |
| **`errors.*` 与后端注册表对齐**（§3.7） | 一个用例把 [`./03-backend-api.md`](./03-backend-api.md) §4.2 的 code 清单写成常量数组，断言 `zh` / `en` 两个语言包里**每个 code 都有 key**——这条测试就是为了防止第一轮那种「10 个 key 全部对不上、运行时 100% 落到 `errors.unknown`」再次发生 |
| 语言包完整性 | `zh` 与 `en` 的 key 集合完全相同；没有空字符串；插值变量名两边一致 |

### 8.2 API 层测试（mock adapter，不打真网络）

用 `axios-mock-adapter` 或 `msw`：

| 用例 | 断言 |
|---|---|
| 请求拦截器 | 有令牌时带 `Authorization`；无令牌时不带 |
| 401 响应 | 触发 `onUnauthorized()` 恰好一次；`GET /me` 的 401 走引导路径不重复触发 |
| 422 响应 | `ApiClientError.fields` 按 `loc` 正确拆分；`code === 'validation_error'`；**不出现** `[object Object]`（这是现状的真实 bug，现状文档 §5.3） |
| 409 `stale_update` | 抛出的 `ApiClientError.code === 'stale_update'`、`status === 409` |
| 网络失败 | `status === 0`、`code === 'network_error'` |
| 每个 API 函数 | 请求方法、URL（含 `ledgerId` 拼接）、query 序列化（数组用重复键）、body 形状；上传走 `uploadClient` 且不设 `Content-Type` |
| 失效矩阵（§3.6） | 每个 mutation 触发后，断言 `queryClient` 上被 invalidate 的 key 集合与矩阵一致 |

### 8.3 组件 / 集成测试（`@testing-library/react-native`，已装未用：`frontend/package.json:38`）

跑真实渲染 + 用户事件，`QueryClientProvider` 用每个测试新建的 client（`retry: false`）。

| 范围 | 关键用例 |
|---|---|
| 路由守卫（§1.5） | 未登录访问 `/l/x/transactions` → 落到 `/login?next=…`；登录后回到原 URL；`ledgerId` 不在列表 → 渲染「不存在或无权限」而**不是**自动跳转 |
| `LedgerContext` | 切账本保留路由形态、丢弃 id 类筛选、写 `last_ledger_id` |
| 登录页 | 401 后表单**不被清空**、错误可见（现状的反面，现状文档 §2.5） |
| 记一笔 — 四 kind | 支出提交负金额、收入正金额；transfer tab 不渲染分类控件；退款 tab 关联原单后分类被预填且可改；超额退款只警告不阻断 |
| 记一笔 — 转账 | 两腿同币种时只有一个金额框；改一边币种后第二组金额框出现；勾「对方不在应用里」后转入账户变成文本框且提交走普通 `POST`；两腿走 `POST .../transfer` 且只发一次请求，body 是扁平的 `{from_source_id, to_source_id, amount_out, currency_out, amount_in, currency_in, occurred_at, subtype, note}`（03 §5.33） |
| 交易列表 | 改筛选写进 URL；从 URL 恢复筛选；清空筛选回到裸路径；分页 `offset` 进 URL |
| 编辑 + 409（§3.8） | mock 409 → 提示出现、数据被重取、用户改过的字段保留、**没有自动重发** |
| 账本设置 | member 看不到 owner 专属按钮；owner 未转让时「退出」禁用；邀请码倒计时归零后失效 |

### 8.4 review 表格的关键用例（§4.11）

这张表最复杂，单独列：

1. **待归类阻断**：3 行缺 `category_l1` → 提交按钮禁用且提示写「还有 3 行没有一级分类」；把其中 1 行标 `skipped` → 变成 2 行；补齐最后一行 → 按钮可用。
2. **transfer 行不算待归类**：`kind='transfer'` 且分类为空，不进阻断计数，分类格禁用。
3. **改 kind 联动**：把一行从 `expense` 改成 `transfer` → 分类被清空且禁用、对手账户格变可用、金额符号跟着 kind 规则走。
4. **行内编辑落库**：改商户 → 500ms 后恰好发一次 `PATCH`，body 只含 `merchant`；请求失败 → 值回滚且该格出现重试。
5. **不被后台刷新打断**：正在编辑某格时触发窗口聚焦 → 不发生 `refetch`（`refetchOnWindowFocus: false` 生效）。
6. **批量设分类**：选 5 行（其中 1 行是收入）→ 设支出分类 → 只发 4 个 `PATCH`，结果提示说明 1 行被跳过。
7. **批量跳过**：选中行 `status` 变 `skipped`、提交计数相应减少、行渲染成删除线。
8. **徽章渲染**：`flags: ['duplicate','needs_review']` 的行同时渲染两个徽章，且各带**文字标签**（不只颜色）。
9. **缩略图联动**：点侧栏第 2 页 → 表格滚动到该页首行并高亮；点 `needs_review` 徽章 → 侧栏切到对应页。
10. **键盘导航**：`↓` 移动焦点行、`Enter` 进入编辑、`Esc` 恢复原值、`S` 切跳过、`[`/`]` 在待归类行之间跳、`⌘/Ctrl+Enter` 在阻断条件下**不触发**提交。
11. **提交**：`POST .../commit` 恰好一次；成功后 `l/{id}/tx`、`sources`、`stats` 都被 invalidate（§3.6）。
12. **窄屏降级**：视口 375 宽时渲染卡片流而不是表格，kind 与分类仍可直接改。

### 8.5 不做的

- 不做端到端浏览器测试（Playwright/Detox）：一个人维护的项目里，维护成本超过收益。§8.3 的集成测试覆盖到路由与表单为止。
- 不做视觉回归测试。mockup 确认（决策 §0.3）代替它。

---

## 待决

以下问题 [`00-decisions.md`](./00-decisions.md) 没有覆盖，本文没有在正文里拍板。每条给出建议默认值，需用户或后续评审确认。

第一轮评审后有三条已经出表：**D-3**（`GET /ledgers` 返不返回角色与成员数）已由 [`03-backend-api.md`](./03-backend-api.md) §5.12 / §5.17 回答——返回 `role`（不是 `my_role`）+ `member_count`，成员列表返回 `email` + `is_me`；**D-10**（解析进度）已由 §5.40 回答——批次返回 `progress: {done, total}`，`total` 在抽取完成前为 `null`；**D-12**（`users.language`）已由决策 §14.6 裁定，保留在表里但标了结论。

| # | 问题 | 建议默认值 |
|---|---|---|
| D-1 | 路由库选 Expo Router v6 还是 `@react-navigation/native` + 手写 `linking`？（§1.1） | **Expo Router v6**：Web 上直接是真实 URL，将来做 App（决策 §0.1）时深链接零成本 |
| D-2 | 决策 §11 同时写了「现有 `auth` 接口保留」和 `GET /me` / `PATCH /me`。现状是 `GET /auth/me` / `PATCH /auth/me`。两者共存还是迁走？（§2.1） | **迁到 `/me`**，`/auth` 下只留 `register` / `login`；旧路径不保留（只有测试数据，决策 §13） |
| D-4 | 退款关联选择器需要每条候选的「已退/可退」（决策 §1.1），接口形态未定：给 `GET .../transactions` 加 `?with_refund_totals=1`，还是单开 `GET .../transactions/{tid}/refunds`？（§3.4） | **加 `?with_refund_totals=1`**：复用同一套筛选（决策 §1.1 明确要求复用列表筛选），少一个端点 |
| D-5 | 前端怎么知道 `REGISTRATION_OPEN` 的值，才能在打开 `/register` 时就提示而不是提交后才报错？（§4.2） | 加一个匿名可读的 `GET /api/v1/config`，返回 `{registration_open: bool}`；在此之前前端只按提交后的 403 `registration_closed` 处理 |
| D-6 | 交易详情页要显示「这笔支出被退了多少」，需要按 `refund_of` 反查退款行。接口形态未定（§4.7） | 详情响应里带 `refunds: RefundSummary[]`（每条含 id、日期、金额）；或复用 D-4 的 `with_refund_totals` |
| D-7 | 交易列表能否按 `import_batch_id` 筛选（导入结果页的「查看这批交易」需要）？决策 §4 的筛选参数里没有它（§4.10 步骤 4） | **加 `?import_batch_id=` 参数**；不加的话该按钮只能退化成跳到批次详情 |
| D-8 | `GET /categories` 的响应结构：一级/二级是嵌套 `children` 还是扁平带 `parent`？`version` 是什么形态（语义版本 / 内容哈希）？（§3.3 的 `CategoryTree`） | 嵌套 `children`（前端级联选择器直接用），`version` 用内容哈希字符串 |
| D-9 | `ImportRow` 的页面缩略图怎么给前端？决策 §5 只说「review 界面旁边显示该页缩略图」（§4.11.6）。**注意**：解析进度这一半已被 [`03-backend-api.md`](./03-backend-api.md) §5.40 回答（批次返回 `progress: {done, total}`，`total` 在抽取完成前为 `null`），只剩缩略图的传输形态未定 | 批次响应里给 `pages: [{page_no, image_url}]`，行上给 `page_no`；图片走带鉴权的 `GET .../imports/{bid}/pages/{n}.png` |
| D-11 | 账本内是否需要「按人筛选」（只看某个成员记的账）？决策 §4 的筛选参数没有 `created_by` | **本版本不做**。多人账本刚起步，等有实际需求再加 |
| D-12 | 语言字段 `users.language` | **已由决策 §14.6 裁定**：`users.language VARCHAR(8) NULL`，取值 `zh` / `en`，NULL 表示跟随系统；`PATCH /me` 可改。前端的 `User.language` 与 `UserUpdate.language` 已按此定义（§3.3、§5.1）。DDL 见 [`02-database.md`](./02-database.md)，同一结论也记在 [`01-domain-and-flows.md`](./01-domain-and-flows.md) 待决 2 |
| D-13 | 视觉方向最终选 A / B / C 哪个？（§6.2） | 推荐 **A「账本纸张」**；以 ★ 四张 mockup 确认为准（决策 §0.3） |

---

## 另见

* [./README.md](./README.md) — 目标设计的索引与阅读顺序
* [./00-decisions.md](./00-decisions.md) — 决策记录（唯一事实来源），本文每处标注都指向它
* [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域模型与流程：四种 kind、退款关联、转账单腿/两腿的语义
* [./02-database.md](./02-database.md) — 目标 schema：本文 §3.3 的字段名以它为准
* [./03-backend-api.md](./03-backend-api.md) — 全部接口的请求/响应定义、状态码与错误 code，本文 §3.4 的函数与它一一对应
* [./05-import-and-llm.md](./05-import-and-llm.md) — 解析流水线、标记算法与 `flags` 的产生规则，本文 §4.11 的 review 表格消费它的输出
* [../current-design/04-frontend.md](../current-design/04-frontend.md) — 前端现状：本文 §0 的差异总览与所有 `path:line` 引用的出处
* [../current-design/03-backend-api.md](../current-design/03-backend-api.md) — 现有接口的完整定义
* [../current-design/05-infra-and-ops.md](../current-design/05-infra-and-ops.md) — Caddy 与 `dist/` 的部署方式（决策 §0.1 沿用）
* [../current-design/06-known-issues.md](../current-design/06-known-issues.md) — 现状的已知问题清单，本文修复的前端问题都能在里面找到条目
