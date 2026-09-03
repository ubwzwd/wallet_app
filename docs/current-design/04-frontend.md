# 04 — 前端（Expo / React Native Web）

> **本文回答什么问题**：`frontend/` 目录下的代码现在是怎么组织、怎么运行的——应用从哪个文件启动、Provider 树长什么样、哪些代码只在 Web 上生效；登录态（`AuthContext`）如何在本地存储与内存之间流转、`isLoading` 为什么会让整棵界面树消失；在没有路由器的情况下页面如何切换、浏览器地址栏和后退键会发生什么；每个页面维护哪些状态、调用哪些 API、如何校验表单、转账为什么要发两次请求；API 客户端如何决定 base URL、如何归一化错误；组件与样式怎么写、哪些依赖装了但没用；PWA 的 manifest 与 service worker 是怎么生成的、离线时会发生什么；`package.json` 每个脚本做什么；测试断言什么；i18n 与无障碍的现状。本文只描述现状，不做评价，不提改法。

约定：括号内的 `文件:行号` 引用都指向仓库中的真实行；"Web" 指 react-native-web 在浏览器里的构建产物，"原生（native）" 指 Expo Go 或原生二进制包。所有相对路径以仓库根目录 `/home/ubwzwd/Code/wallet_app` 为基准。

## 0. 总览

| 项目 | 现状 | 依据 |
|---|---|---|
| 框架 | Expo 54（`expo` 54.0.20）、React Native 0.81.5、React 19.1.0、react-native-web 0.21.2 | `frontend/package.json:21,27,24,32`；`node_modules` 中实际安装版本 |
| 数据层 | `@tanstack/react-query` 5.90.5、`axios` 1.13.0、`@react-native-async-storage/async-storage` 2.2.0 | `frontend/package.json:19,20,16` |
| 语言 | TypeScript 5.9.3，`strict: true` | `frontend/tsconfig.json:4` |
| 当前交付形态 | 静态 Web 构建产物 `frontend/dist/`，由 Caddy 作为文件服务器提供 | `frontend/package.json:10`；`infra/docker-compose.prod.yml:74`；`infra/Caddyfile:28-32` |
| 原生目标 | `app.json` 声明了 iOS/Android，但交易表单直接渲染 `<select>`、`<input type="date">` 等只有 Web 才有的 DOM 元素（见 §1.6） | `frontend/app.json:15-25`；`frontend/src/screens/TransactionFormScreen.tsx:404,558,640,707,752` |
| 源码规模 | `App.tsx` 60 行 + `src/` 下 27 个 `.ts/.tsx` 文件共约 4300 行；最大的是 `TransactionFormScreen.tsx`（1034 行） | `wc -l` |
| 路由 | 没有路由器；`Navigation` 组件按登录态二选一，`HomeScreen` 用一个 `useState` 做视图切换 | `frontend/src/components/Navigation.tsx:13-49`；`frontend/src/screens/HomeScreen.tsx:12-16` |
| 测试 | Jest 30，5 个静态源码断言套件、64 个用例，全部通过 | `frontend/jest.config.js`；`npx jest` 实际运行结果 |

---

## 1. 入口、Provider 树与平台目标

### 1.1 启动顺序

1. `package.json` 声明 `"main": "index.ts"`（`frontend/package.json:4`）。
2. `index.ts` 调用 `expo` 的 `registerRootComponent(App)`，它内部执行 `AppRegistry.registerComponent('main', () => App)`（`frontend/index.ts:1-8`）。
3. `App.tsx` 以副作用方式导入 `'@/pwa/registerSW'`（`frontend/App.tsx:8`）。该模块在 Web 上于 `window` 的 `load` 事件里调用 `navigator.serviceWorker.register('/sw.js')`；在原生上，`Platform.OS === 'web'` 守卫为假，整个模块什么都不做（`frontend/src/pwa/registerSW.ts:20-32`）。
4. `App()` 渲染 Provider 树（`frontend/App.tsx:36-46`）。

### 1.2 Provider 树

```
<SafeAreaProvider>                            App.tsx:38  (react-native-safe-area-context 5.6.1)
  <QueryClientProvider client={queryClient}>  App.tsx:39  (单例，来自 src/utils/queryClient.ts)
    <AuthProvider>                            App.tsx:40  (src/store/AuthContext.tsx)
      <AppContent/>                           App.tsx:41
        ├─ isLoading 为 true  → <View><ActivityIndicator/><Text>Loading...</Text></View>   App.tsx:16-23
        └─ 否则               → <><Navigation/><StatusBar style="auto"/></>                 App.tsx:25-30
```

`AppContent` 只从 `useAuth()` 里取 `isLoading`（`frontend/App.tsx:14`）。只要 `isLoading` 为 true，整棵 `<Navigation/>` 子树就被卸载、换成加载指示器（`frontend/App.tsx:16-23`）。这一点直接决定了登录/注册失败时的表现，见 §2.5。

`QueryClient` 单例在模块作用域配置一次（`frontend/src/utils/queryClient.ts:6-19`）：

| 选项 | 值 | 行 |
|---|---|---|
| `queries.retry` | `1` | 9 |
| `queries.staleTime` | `5 * 60 * 1000`（5 分钟） | 10 |
| `queries.gcTime` | `10 * 60 * 1000`（10 分钟） | 11 |
| `queries.refetchOnWindowFocus` | `false` | 12 |
| `queries.refetchOnReconnect` | `true` | 13 |
| `mutations.retry` | `0` | 16 |

### 1.3 平台目标（`app.json`）

| 键 | 值 | 行 |
|---|---|---|
| `expo.name` / `expo.slug` | `"frontend"` / `"frontend"` | `frontend/app.json:3-4` |
| `version` | `"1.0.0"` | 5 |
| `orientation` | `"portrait"` | 6 |
| `icon` | `./assets/icon.png` | 7 |
| `userInterfaceStyle` | `"light"`（没有深色模式） | 8 |
| `newArchEnabled` | `true` | 9 |
| `splash` | `./assets/splash-icon.png`，`resizeMode: "contain"`，背景 `#ffffff` | 10-14 |
| `ios.supportsTablet` | `true` | 15-17 |
| `android.adaptiveIcon` | 前景 `./assets/adaptive-icon.png`，背景 `#ffffff` | 18-22 |
| `android.edgeToEdgeEnabled` | `true` | 23 |
| `android.predictiveBackGestureEnabled` | `false` | 24 |
| `web.favicon` | `./assets/favicon.png`；但 HTML 模板自己声明了 `<link rel="icon" href="/favicon.ico">`（`frontend/public/index.html:21`），`dist/` 里只有 `favicon.ico`、没有 `favicon.png` | 26-28 |

其他配置事实：

* `frontend/` 下没有 `app.config.js/ts`、没有 `metro.config.js`、没有任何 `.env*` 文件（`.gitignore` 列出了 `.env*.local` 与 `.env`，`frontend/.gitignore:30-32`，但仓库里并不存在这些文件）。
* `tsconfig.json` 继承 `expo/tsconfig.base`，开启 `strict`，把 `@/*` 映射到 `src/*`（`frontend/tsconfig.json:2-8`）。同一别名在构建期由 `babel-plugin-module-resolver` 处理（`frontend/babel.config.js:16-26`），在测试期由 Jest 的 `moduleNameMapper` 处理（`frontend/jest.config.js:18-20`）。
* `babel.config.js`（`frontend/babel.config.js:1-39`）：按 `NODE_ENV` 缓存（2）；在非 `test` 环境下用 `require.resolve('react-native-worklets/plugin')` 探测 worklets 是否可解析（3-14）；探测成功才追加 `react-native-reanimated/plugin`（27-29）；给 `babel-preset-expo` 传 `{}` 或 `{ reanimated: false }`——测试环境或 worklets 缺失时为后者（30-37）。没有配置 NativeWind 的 babel preset（见 §6.3）。

### 1.4 每一处 `Platform.OS` 分支

用 `grep -rn "Platform.OS" App.tsx src/` 得到 22 处：

| 文件:行 | 条件 | 效果 |
|---|---|---|
| `frontend/src/pwa/registerSW.ts:20` | `=== 'web'` | 注册 `/sw.js` |
| `frontend/src/components/Screen.tsx:28` | `=== 'ios'` | `KeyboardAvoidingView` 的 `behavior` 在 iOS 用 `'padding'`，其他平台用 `'height'`（Web 上 react-native-web 的 `KeyboardAvoidingView` 只是一个 `View`，`onKeyboardChange` 是空方法，见 §1.7） |
| `frontend/src/screens/FinanceSourcesScreen.tsx:38` | `=== 'web'` | 归档失败提示：`window.alert` 与 `Alert.alert` 二选一 |
| `frontend/src/screens/FinanceSourcesScreen.tsx:51` | `=== 'web'` | 归档确认：`window.confirm` 与带按钮的 `Alert.alert` 二选一 |
| `frontend/src/screens/FinanceSourceFormScreen.tsx:156` | `=== 'web'` | 币种选择：Web 用横向按钮行，原生用 `Modal` + `FlatList` |
| `frontend/src/screens/ProfileScreen.tsx:64,73` | `=== 'web'` | 成功/失败提示：`window.alert` 与 `Alert.alert` 二选一 |
| `frontend/src/screens/TransactionsScreen.tsx:38` | `=== 'web'` | 删除失败提示：只有 `window.alert`，没有原生分支 |
| `frontend/src/screens/TransactionsScreen.tsx:53` | `=== 'web'` | 删除确认：`window.confirm` 与 `Alert.alert` 二选一 |
| `frontend/src/screens/TransactionFormScreen.tsx:102,109,121,128` | `=== 'web'` | 创建/更新 mutation 的成功与失败提示：只有 `window.alert`，没有原生分支 |
| `frontend/src/screens/TransactionFormScreen.tsx:188,205,219,228,279,288` | `=== 'web'` | 转账创建/更新的各种提示：`window.alert` 与 `Alert.alert` 二选一 |
| `frontend/src/screens/TransactionFormScreen.tsx:422` | `=== 'web'` | 转账目标账户选择：Web 用 `<select>`，原生用 `Modal` + `FlatList` |
| `frontend/src/screens/TransactionFormScreen.tsx:552,746` | `=== 'web'` | 在币种触发按钮下方显示 "Tap to search" 提示 |

### 1.5 未加平台守卫、直接渲染的原生 DOM 元素

以下 JSX 内建元素只有 react-native-web 能渲染，代码里没有任何平台判断：

| 文件:行 | 元素 | 用途 |
|---|---|---|
| `frontend/src/screens/TransactionFormScreen.tsx:404-414` | `<select>` | 转账向导第 1 步的 "From" 账户 |
| `frontend/src/screens/TransactionFormScreen.tsx:558-566` | `<input type="date">` | 转账向导第 2 步的日期 |
| `frontend/src/screens/TransactionFormScreen.tsx:640-648` | `<input type="date">` | 编辑转账时的日期 |
| `frontend/src/screens/TransactionFormScreen.tsx:707-717` | `<select>` | 普通收支的资金账户（finance source） |
| `frontend/src/screens/TransactionFormScreen.tsx:752-760` | `<input type="date">` | 普通收支的日期 |

（转账第 1 步的 "To" `<select>`（424-435）位于 `Platform.OS === 'web'` 分支内，是有守卫的。）

另外 `crypto.randomUUID()`（`frontend/src/screens/TransactionFormScreen.tsx:164`）是浏览器全局对象：Expo 的原生 winter 运行时只安装 `TextDecoder`、`TextDecoderStream`、`TextEncoderStream`、`URL`、`URLSearchParams`、`structuredClone` 等（`frontend/node_modules/expo/src/winter/runtime.native.ts:8-23`），没有 `crypto`；`expo-crypto` 也没有安装（`ls node_modules/expo-crypto` 不存在）。

### 1.6 react-native-web 的三个事实

这三点决定了 Web 上很多交互的实际表现：

* **`Alert.alert` 在 Web 上是空实现**：`class Alert { static alert() {} }`（`frontend/node_modules/react-native-web/dist/exports/Alert/index.js`）。所有没有做平台分支的 `Alert.alert` 调用在 Web 上什么都不发生，包括：`HomeScreen.tsx:21`、`LoginScreen.tsx:45`、`RegisterScreen.tsx:73,77`、`FinanceSourceFormScreen.tsx:44,48,58,62`。最直观的后果：首页 "Logout" 按钮的唯一动作是弹一个带 "Logout" 回调按钮的 `Alert.alert`（`frontend/src/screens/HomeScreen.tsx:20-39`），因此在 Web 上点击它没有任何反应。
* **`RefreshControl` 在 Web 上渲染成普通 `View`**，并丢弃 `onRefresh`、`refreshing`、`colors` 等属性（`frontend/node_modules/react-native-web/dist/exports/RefreshControl/index.js`）。因此 `FinanceSourcesScreen.tsx:166-172` 与 `TransactionsScreen.tsx:233-239` 的下拉刷新只在原生生效。
* **`KeyboardAvoidingView` 在 Web 上是一个透传的 `View`**，`onKeyboardChange(event) {}` 为空（`frontend/node_modules/react-native-web/dist/exports/KeyboardAvoidingView/index.js`）。

---

## 2. `AuthContext` 状态机

源码：`frontend/src/store/AuthContext.tsx`（172 行）；存储辅助函数在 `frontend/src/api/client.ts:84-101`。

### 2.1 上下文形状

```ts
interface AuthContextType {            // AuthContext.tsx:11-19
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;            // 计算值：!!user（第 152 行）
  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}
```

状态只有两个 `useState`：`user`（初值 `null`）和 `isLoading`（初值 `true`）（`frontend/src/store/AuthContext.tsx:30-31`）。`useAuth()` 在 Provider 之外使用时抛出 `'useAuth must be used within an AuthProvider'`（`frontend/src/store/AuthContext.tsx:165-171`）。

### 2.2 令牌存储

| 项目 | 值 | 位置 |
|---|---|---|
| 访问令牌（access token，JWT）键 | `'@wallet_app:auth_token'` | `frontend/src/constants/config.ts:11` |
| 用户数据键 | `'@wallet_app:user_data'` | `frontend/src/constants/config.ts:12` |
| 机制 | `@react-native-async-storage/async-storage` 2.2.0 | `frontend/src/store/AuthContext.tsx:2`；`frontend/src/api/client.ts:2` |
| Web 上的实现 | `AsyncStorage.getItem/setItem/removeItem` 直接委托给 `window.localStorage` 的同名方法 | `frontend/node_modules/@react-native-async-storage/async-storage/lib/module/AsyncStorage.js:58-71` |
| 写令牌 | `setAuthToken(token)` → `setItem(AUTH_TOKEN, token)` | `frontend/src/api/client.ts:84-86` |
| 清除 | `clearAuthToken()` → `removeItem(AUTH_TOKEN)` + `removeItem(USER_DATA)` | `frontend/src/api/client.ts:91-94` |
| 读令牌 | `getAuthToken()` 已导出，但没有任何模块导入它（`grep -rn getAuthToken src/` 只命中定义处） | `frontend/src/api/client.ts:99-101` |

JWT 原样存储，客户端不解析过期时间。`USER_DATA` 在每次 `GET /auth/me` 成功后都会被写入（`frontend/src/store/AuthContext.tsx:54,84,111,142`），但没有任何地方读取它——`user` 永远从服务端重新拉取。

### 2.3 状态转换

**启动加载 `loadUser`**（由 `useEffect(() => { loadUser(); }, [])` 触发一次，`frontend/src/store/AuthContext.tsx:36-64`）：

1. 客户端：`setIsLoading(true)`（45）；`AsyncStorage.getItem('@wallet_app:auth_token')`（46）。
2. 没有令牌：跳过网络请求，直接进入第 6 步；`user` 保持 `null`。
3. 有令牌：HTTP `GET /api/v1/auth/me`，请求拦截器自动附加 `Authorization: Bearer <token>`（`frontend/src/api/auth.ts:33-36`；`frontend/src/api/client.ts:22-24`）。
4. 服务端 `get_current_user`（`backend/app/core/security.py:83-144`）依次检查：Bearer 头解码失败 → 401；`sub` 声明缺失 → 401；`sub` 不是合法 UUID 或用户查询抛异常 → 401（128-139）；按 `sub` 查不到用户 → 401；所有情况 `detail` 都是 `"Could not validate credentials"`（`backend/app/core/security.py:105-109`）。通过 → 200 `UserResponse`（`backend/app/api/auth.py:91-98`）。
5. 客户端成功：`setUser(userData)`（51）；`setItem(USER_DATA, JSON.stringify(userData))`（54）。
6. 任何抛错（网络错误、401、5xx）：`console.error`，`clearAuthToken()`，`setUser(null)`（56-60）。
7. `finally setIsLoading(false)`（61-63）。

`GET /auth/me` 的响应示例（`backend/app/schemas/user.py:21-30`，客户端类型 `User`，`frontend/src/types/api.ts:7-13`）：

```json
{"id":"0f0c0a1e-9d8b-4c7a-8e6f-5a4b3c2d1e0f","email":"user@test.com","base_currency":"USD","default_source_id":null,"created_at":"2026-05-01T10:15:30.123456"}
```

**登录 `login(credentials)`**（`frontend/src/store/AuthContext.tsx:69-91`）：

1. 客户端：`LoginScreen.handleLogin` 调 `login({ email: email.trim(), password })`（`frontend/src/screens/LoginScreen.tsx:41`）；`login` 先 `setIsLoading(true)`（71）——此时 `<Navigation/>` 及其中的 `LoginScreen` 被卸载（§2.5）。
2. HTTP：`POST /api/v1/auth/login`，body `{"email":"user@test.com","password":"password123"}`（`frontend/src/api/auth.ts:25-28`）。
3. 服务端（`backend/app/api/auth.py:65-88`）依次检查：
   * Pydantic `UserLogin`（`email: EmailStr`、`password: str`，`backend/app/schemas/user.py:15-18`）校验失败 → 422，`detail` 是数组；
   * `authenticate_user` 返回空（邮箱不存在或密码不匹配）→ 401 `{"detail":"Incorrect email or password"}`（`backend/app/api/auth.py:78-83`）；
   * 通过 → 200 `{"access_token":"<jwt>","token_type":"bearer"}`（`backend/app/api/auth.py:85-88`；`backend/app/schemas/user.py:47-50`）。
4. 客户端：`setAuthToken(authResponse.access_token)`（77）。
5. HTTP：`GET /api/v1/auth/me`（80），服务端检查同上。
6. 客户端：`setUser(userData)`（81）；写 `USER_DATA`（84）。
7. 任一步抛错：`console.error` 后 **rethrow** 给页面（85-88）；`finally setIsLoading(false)`（89-90）。
8. 附注：`POST /auth/login` 返回 401 时，响应拦截器会顺带执行 `removeItem(AUTH_TOKEN)`、`removeItem(USER_DATA)`（`frontend/src/api/client.ts:58-63`），此时存储里本来就没有东西。

**注册 `register(data)`**（`frontend/src/store/AuthContext.tsx:96-118`）：与登录完全相同，只是第一步是 `POST /api/v1/auth/register`（`frontend/src/api/auth.ts:17-20`），body `{"email":"new@example.com","password":"password123","base_currency":"USD"}`。服务端（`backend/app/api/auth.py:20-62`）依次检查：Pydantic `UserCreate`（`password` `min_length=8`，`base_currency` 恰好 3 个字符，`backend/app/schemas/user.py:8-12`）失败 → 422；邮箱已存在 → 400 `{"detail":"Email already registered"}`（32-37）；插入时 `IntegrityError` → 回滚并返回同样的 400（48-57）；通过 → 201 `Token`（20, 62），`base_currency` 被转成大写存储（45）。

**登出 `logout()`**（`frontend/src/store/AuthContext.tsx:123-133`）：`setIsLoading(true)` → `clearAuthToken()` → `setUser(null)` → `finally setIsLoading(false)`。没有 HTTP 调用；`authApi.logout` 是一个空函数（`frontend/src/api/auth.ts:49-52`），没有被任何地方调用。

**刷新用户 `refreshUser()`**（`frontend/src/store/AuthContext.tsx:138-147`）：`GET /auth/me` → `setUser` → 写 `USER_DATA`；出错时 `console.error` 后 rethrow，不动存储。**不切换 `isLoading`**，因此不会卸载界面树。

### 2.4 状态图

```
                    ┌─────────────────────────────────────────────────────────────┐
   挂载 ──────────▶ │ BOOTSTRAPPING   isLoading=true, user=null                    │
                    │ getItem(token) ─▶ 无 token ─────────────┐                    │
                    │                ─▶ 有 token ─▶ GET /auth/me │                 │
                    └──────────┬──────────────────┬───────────┼────────────────────┘
                               │ 200              │ 抛错       │
                               │                  │ (clearAuthToken)
                               ▼                  ▼           ▼
        ┌──────────────────────────┐      ┌──────────────────────────────┐
        │ AUTHENTICATED            │      │ ANONYMOUS                    │
        │ user={id,email,...}      │      │ user=null                    │
        │ isAuthenticated=true     │      │ isAuthenticated=false        │
        │ <Navigation> 渲染        │      │ <Navigation> 渲染            │
        │ <HomeScreen/>            │      │ Login / Register 两个标签页  │
        └───┬───────────────┬──────┘      └──────┬──────────────┬────────┘
            │ logout()      │ refreshUser()      │ login()/     │ login()/register()
            │               │ (不切 isLoading,   │ register()   │ 失败: 错误 rethrow
            │               │  树保持挂载)       │ 成功         │ 到页面, 存储不变*
            ▼               │                    ▼              ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │ isLoading=true 期间: AppContent 渲染加载指示器, <Navigation> 被卸载   │
   │ (App.tsx:16-23); isLoading 回到 false 后按 user 是否为空重新挂载      │
   └─────────────────────────────────────────────────────────────────────┘
   * 例外: POST /auth/login 的 401 会让拦截器 removeItem(AUTH_TOKEN/USER_DATA),
     但此时存储里本来为空 (client.ts:58-63)
```

### 2.5 `isLoading` 对整棵树的影响，以及登录/注册报错的实际表现

因为 `AppContent` 在 `isLoading` 为 true 时把整棵 `<Navigation/>` 换成加载指示器（`frontend/App.tsx:16-23`），而 `login()`/`register()` 一开始就 `setIsLoading(true)`（`frontend/src/store/AuthContext.tsx:71,98`），所以请求期间 `LoginScreen`/`RegisterScreen` 处于卸载状态。请求失败时，`finally` 把 `isLoading` 置回 false，`Navigation` 以全新状态重新挂载（`activeScreen` 回到 `'login'`，输入框为空，`frontend/src/components/Navigation.tsx:15`；`frontend/src/screens/LoginScreen.tsx:8-11`）。随后页面的 `catch` 在**已卸载的旧实例**上执行：`Alert.alert('Login Failed', …)`（`frontend/src/screens/LoginScreen.tsx:45`）在 Web 上是空操作（§1.6），`setErrors({ password: errorMessage })`（46）作用于已卸载的组件。Web 上的净效果：登录/注册失败后表单被清空、没有任何提示；原生上会弹出系统对话框。页面内部按钮上的 `isLoading` 加载态（`frontend/src/screens/LoginScreen.tsx:88-95`）同样因为组件已卸载而不可见。

### 2.6 401 处理

响应拦截器（`frontend/src/api/client.ts:39-79`）：

1. 若 `error.response.status === 401`，计算 `isAuthMeGet = url.includes('/auth/me') && method === 'get'`（48-56）。
2. **不是** `GET /auth/me` 时：`AsyncStorage.removeItem(AUTH_TOKEN)` 与 `removeItem(USER_DATA)`（58-63）。注释写着 "Navigation will be handled by AuthContext"（62），但没有任何代码观察存储的变化——`user` 仍然保持原值，界面停留在 `HomeScreen`，直到刷新页面重新执行 `loadUser`（此时找不到令牌 → 匿名态）。存储被清空后，页面仍然挂载，后续任何请求（例如 React Query 的重新拉取、再次提交表单）都会因为请求拦截器读不到令牌而不带 `Authorization` 头（`frontend/src/api/client.ts:22-25`）。在锁定的 FastAPI 0.109.2 中，`HTTPBearer` 对缺少头的请求返回 **403** `{"detail":"Not authenticated"}`（`backend/app/core/security.py:22`；见 03-backend-api.md §3.4），不是 401，因此拦截器的 401 分支不会再次进入，页面看到的错误文案是 `"Not authenticated"`。
3. **是** `GET /auth/me` 时：不动存储（注释 53-55 给出了理由）。`loadUser` 自己的 `catch` 会清存储（`frontend/src/store/AuthContext.tsx:59`）；`refreshUser` 不会。
4. 所有情况下 promise 都以 `new Error(detail)` 拒绝（67-70），见 §5.3。

服务端产生 401 的来源：`POST /auth/login` → `{"detail":"Incorrect email or password"}`（`backend/app/api/auth.py:78-83`）；任何受保护路由遇到坏令牌/过期令牌/用户不存在 → `{"detail":"Could not validate credentials"}`（`backend/app/core/security.py:105-109`）。

---

## 3. 导航

没有使用任何路由库。`@react-navigation/native` 与 `@react-navigation/native-stack` 已安装（`frontend/package.json:17-18`，实际版本 7.1.19 / 7.6.1），但 `grep -rn "react-navigation\|NavigationContainer\|createNativeStackNavigator" App.tsx index.ts src/` 没有任何命中。也没有代码读写 `window.location` 或 `window.history`、没有 `BackHandler`（同一 grep 验证）。

### 3.1 顶层开关：`Navigation` 组件

`frontend/src/components/Navigation.tsx:13-49`：

* `const { isAuthenticated } = useAuth()`（14）；`const [activeScreen, setActiveScreen] = useState<'login' | 'register'>('login')`（15）。
* `if (isAuthenticated) return <HomeScreen />;`（17-19）。
* 否则渲染两个 `TouchableOpacity` 标签 "Login" / "Register"（25-40），下面是 `{activeScreen === 'login' ? <LoginScreen /> : <RegisterScreen />}`（45）。
* 标签状态是组件局部状态；每次 `Navigation` 重新挂载（即每个 `isLoading` 周期之后）都会回到 `'login'`。

```
   isAuthenticated=false                          isAuthenticated=true
 ┌──────────────────────────────┐   user 被设置   ┌───────────────────┐
 │ [Login] [Register] 标签      │ ──────────────▶ │   <HomeScreen/>   │
 │ activeScreen: login 或 reg.  │ ◀────────────── │                   │
 └──────────────────────────────┘   user=null     └───────────────────┘
```

### 3.2 `HomeScreen` 视图机

`frontend/src/screens/HomeScreen.tsx`：

```ts
type HomeView = 'main' | 'finance-sources' | 'add-source' | 'edit-source'
              | 'transactions' | 'add-transaction' | 'edit-transaction' | 'profile';     // 第 12 行
const [currentView, setCurrentView] = useState<HomeView>('main');                          // 第 16 行
const [selectedSource, setSelectedSource] = useState<FinanceSource | undefined>();        // 第 17 行
const [selectedTransaction, setSelectedTransaction] = useState<Transaction | undefined>(); // 第 18 行
```

视图机之前有一道守卫：`if (!isAuthenticated || !user)` 渲染一个只写着 "Not authenticated" 的 `Screen`（41-49）。实际不可达，因为 `Navigation` 只在已登录时才挂载 `HomeScreen`。

| `currentView` 值 | 渲染内容 | 传入的回调（行号） | 退出去向 |
|---|---|---|---|
| `'main'`（默认） | 首页仪表盘（139-193） | — | `'finance-sources'`（167）、`'transactions'`（173）、`'profile'`（179）；Logout → `Alert.alert`（20-39） |
| `'finance-sources'` | `<FinanceSourcesScreen>`（52-63） | `onCreatePress → 'add-source'`（55）；`onEditPress(source) → setSelectedSource + 'edit-source'`（56-59）；`onBackPress → 'main'`（60） | 见回调 |
| `'add-source'` | `<FinanceSourceFormScreen>`（66-73） | `onSuccess`/`onCancel → 'finance-sources'`（69-70） | 回列表 |
| `'edit-source'` **且** `selectedSource` 非空 | `<FinanceSourceFormScreen source={selectedSource}>`（76-90） | `onSuccess`/`onCancel → 清空 selectedSource + 'finance-sources'`（80-87） | 回列表 |
| `'transactions'` | `<TransactionsScreen>`（93-104） | `onCreatePress → 'add-transaction'`（96）；`onEditPress(tx) → setSelectedTransaction + 'edit-transaction'`（97-100）；`onBackPress → 'main'`（101） | 见回调 |
| `'add-transaction'` | `<TransactionFormScreen>`（107-114） | `onSuccess`/`onCancel → 'transactions'`（110-111） | 回列表 |
| `'edit-transaction'` **且** `selectedTransaction` 非空 | `<TransactionFormScreen transaction={selectedTransaction}>`（117-131） | `onSuccess`/`onCancel → 清空 + 'transactions'`（121-128） | 回列表 |
| `'profile'` | `<ProfileScreen onBack>`（134-136） | `onBack → 'main'`（135） | 回首页 |

如果 `currentView` 是 `'edit-source'`/`'edit-transaction'` 但对应的 `selected*` 为 `undefined`，没有任何 `if` 分支命中，函数落到 `'main'` 的渲染（139），此时 `currentView` 仍然是 edit 值。这个状态通过界面无法到达，因为两个 setter 总是成对调用（56-59、97-100）。

传给编辑表单的数据是列表查询缓存数组里的完整 `FinanceSource` / `Transaction` 对象（`renderItem` 里的 `item`，`frontend/src/screens/FinanceSourcesScreen.tsx:97`；`frontend/src/screens/TransactionsScreen.tsx:161`）。表单在挂载时把字段复制进自己的 `useState`（`frontend/src/screens/FinanceSourceFormScreen.tsx:22-24`；`frontend/src/screens/TransactionFormScreen.tsx:25-31`）。

```
                              ┌───────────┐
       ┌─────────────────────▶│   main    │◀────────────────────────────┐
       │                      └──┬──┬──┬──┘                             │
       │ onBackPress             │  │  │                     onBack     │
       │              ┌──────────┘  │  └───────────┐                    │
       │              ▼             ▼              ▼                    │
   ┌───┴──────────────────┐  ┌──────┴─────────┐  ┌────────────────────┴─┐
   │ finance-sources      │  │ transactions   │  │ profile              │
   └──┬───────────────┬───┘  └──┬─────────┬───┘  └──────────────────────┘
      │ onCreatePress │ onEditPress(src)  │ onCreatePress │ onEditPress(tx)
      ▼               ▼                   ▼               ▼
   ┌──────────┐  ┌────────────┐    ┌─────────────────┐  ┌──────────────────┐
   │ add-     │  │ edit-      │    │ add-transaction │  │ edit-transaction │
   │ source   │  │ source     │    │                 │  │                  │
   └────┬─────┘  └─────┬──────┘    └────────┬────────┘  └────────┬─────────┘
        │ onSuccess / onCancel              │ onSuccess / onCancel │
        └──────────▶ finance-sources        └──────────▶ transactions
```

### 3.3 返回行为

* 每一个"返回"都是显式的回调 prop，最终调用 `setCurrentView(...)`（上表）。没有历史栈：从表单"返回"总是落到它的父列表，而不是上一个任意视图。
* 浏览器：URL 永远不变（始终是 `/`）。浏览器的后退按钮会离开站点。刷新页面会重新执行 §2.3 的启动加载，`HomeScreen` 在 `'main'` 重新挂载，所有表单状态丢失。Caddy 对任何未知路径都返回 `index.html`（`infra/Caddyfile:28-32`，`try_files {path} /index.html`），所以手动输入的深层 URL 也会加载同一个应用——但 service worker 对非根路径导航另有处理，见 §7.4。
* Android 硬件返回键：代码里没有 `BackHandler`；`predictiveBackGestureEnabled: false`（`frontend/app.json:24`）时 React Native 的默认行为是退出 Activity。

---

## 4. 各页面

所有页面从 `frontend/src/screens/index.ts:5-12` 导出。每个页面都把内容包在 `<Screen>` 里（§6.1）。查询键常量来自 `frontend/src/constants/config.ts:20-26`：

```ts
export const QUERY_KEYS = {
  USER: 'user',                    // 未使用
  FINANCE_SOURCES: 'finance_sources',
  TRANSACTIONS: 'transactions',
  CURRENCIES: 'currencies',
  EXCHANGE_RATES: 'exchange_rates', // 未使用
} as const;
```

（`grep -rn "QUERY_KEYS\.\(USER\|EXCHANGE_RATES\)" src/` 无命中。）

### 4.1 `LoginScreen`（`frontend/src/screens/LoginScreen.tsx`）

* 状态：`email`、`password`、`isLoading`、`errors: { email?, password? }`（8-11）。
* 校验（`validate`，13-30）：邮箱必填，否则必须匹配 `/\S+@\S+\.\S+/`（16-20）；密码必填，否则长度 `>= 6`（22-26）。（服务端 `UserLogin` 没有长度规则，`backend/app/schemas/user.py:15-18`。）
* 提交（`handleLogin`，32-50）：`await login({ email: email.trim(), password })`（41）。出错：`Alert.alert('Login Failed', message)` + `setErrors({ password: message })`（44-46）——实际表现见 §2.5。
* 输入框：邮箱 `Input` 带 `keyboardType="email-address"`、`autoCapitalize="none"`、`autoComplete="email"`（70-72）；密码 `Input isPassword`（84）。输入时清除对应字段的错误（66-69、80-83）。
* 页脚固定显示 `Demo Account:` 与 `user@test.com / password123` 两行文字（98-101）；代码里没有任何东西创建这个账号。

产生的请求（`POST /api/v1/auth/login`）：

```json
{"email":"user@test.com","password":"password123"}
```

成功（`Token`，`backend/app/schemas/user.py:47-50`）：`{"access_token":"<jwt>","token_type":"bearer"}`；失败 401 `{"detail":"Incorrect email or password"}`。完整流程见 §2.3。

### 4.2 `RegisterScreen`（`frontend/src/screens/RegisterScreen.tsx`）

* 硬编码币种列表 `CURRENCIES = [USD, EUR, GBP, CNY, SGD]`（含英文名，6-12），渲染成一个横向 `ScrollView` 里的小号 `Button`（142-153）；被选中的用 `variant="primary"`（147）。默认 `baseCurrency = 'USD'`（19）。这是唯一一个不使用 `/rates/currencies` 实时列表的币种选择器。
* 状态：`email`、`password`、`confirmPassword`、`baseCurrency`、`isLoading`、`errors`（16-25）。
* 校验（27-57）：邮箱/密码规则与登录相同（密码 `>= 6`，42-46）；确认密码必填且必须与密码相等（49-53）。
* 提交（59-86）：`register({ email: email.trim(), password, base_currency: baseCurrency })`（68-72）→ `Alert.alert('Success', …)`（73，Web 上空操作）。出错：`Alert.alert('Registration Failed', msg)`（77）；若 `msg.toLowerCase().includes('email')` 则 `setErrors({ email: msg })`（80-82）——匹配服务端的 `"Email already registered"`（`backend/app/api/auth.py:32-37`）。
* 客户端与服务端规则的差异：服务端要求 `password` `min_length=8`（`backend/app/schemas/user.py:11`）；6–7 个字符的密码能通过客户端校验，随后得到 422，其 `detail` 是数组，被拦截器转成消息为 `"[object Object]"` 的 `Error`（§5.3）。密码输入框的占位文案 `"At least 6 characters"`（114）与提示 `"Minimum 6 characters"`（122）同样按 6 个字符表述。

请求（`POST /api/v1/auth/register`，成功 201 返回 `Token`）：

```json
{"email":"new@example.com","password":"password123","base_currency":"USD"}
```

### 4.3 `HomeScreen` 主视图（`frontend/src/screens/HomeScreen.tsx:139-193`）

静态仪表盘：问候语 "Welcome Back! 👋" + 邮箱（143-146）；"Account Information" 的 elevated `Card`，显示 Email 与 Base Currency（149-159）；"Quick Actions" 的 outlined `Card`，三个 secondary `Button`（162-182）；"Logout" secondary 按钮，`marginTop: 'auto'`（185-190）。没有任何查询。Logout → `Alert.alert` 确认 → `logout()`（20-39）（Web 上无效，§1.6）。样式表里的 `comingSoonText`（236-240）没有被引用。

### 4.4 `FinanceSourcesScreen`（`frontend/src/screens/FinanceSourcesScreen.tsx`）

Props：`onCreatePress`、`onEditPress(source)`、`onBackPress`（9-13）。

* 状态：`includeArchived`（17）。
* 查询：`useQuery({ queryKey: [QUERY_KEYS.FINANCE_SOURCES, includeArchived], queryFn: () => getFinanceSources(includeArchived) })`（20-23）→ `GET /api/v1/finance-sources?include_archived=false` 或 `=true`。切换过一次之后缓存里同时存在两个条目。
* Mutation `archiveMutation`（26-44）：`updateFinanceSource(id, { archived })` → `PATCH /api/v1/finance-sources/{id}`，body `{"archived":true}`；`onSuccess` → `invalidateQueries({ queryKey: ['finance_sources'], refetchType: 'all' })`（31-34），同时命中 `[…, false]`、`[…, true]` 以及 `TransactionFormScreen` 的 `[…, false]`；`onError` → Web `window.alert("Error\n\n"+msg)`，原生 `Alert.alert('Error', msg)`（36-43）。
* 确认流程 `handleArchiveToggle`（46-73）：`action = 'archive'` 或 `'unarchive'`；Web `window.confirm("Archive Finance Source\n\nAre you sure you want to archive \"<name>\"?")`（51-57）；原生 `Alert.alert(title, message, [Cancel, <Action>])`（59-71）。
* 行渲染（75-109）：outlined `Card`；名称、`type.toUpperCase()` 标签、币种标签（79-83）；`item.archived` 时显示琥珀色 "Archived" 徽章（85-89）；"Edit" 与 "Archive"/"Unarchive" 两个小号 secondary 按钮（93-106）。
* 空状态（111-124）只在 `!isLoading` 时作为 `ListEmptyComponent` 渲染（165）。头部有 "← Home" 小号 secondary `Button`（132-138），以及 "Show Archived"/"Hide Archived" + "Add New"（146-156）。
* 列表：`FlatList` 放在 `<Screen padding={false}>` 里（127、160-173）——`Screen` 默认 `scrollable=true`，会把 children 包进 `ScrollView`（`frontend/src/components/Screen.tsx:17,30-37`），所以这个 `FlatList` 嵌套在 `ScrollView` 里。

服务端流程（`PATCH /finance-sources/{id}`，`backend/app/api/finance_sources.py:99-135`）：`get_current_user` 401 → 按 `id` + `user_id` 查不到 → 404 `{"detail":"Finance source <id> not found"}`（120-124）→ `model_dump(exclude_unset=True)` 只写传入字段（127-130）→ 200 返回 `FinanceSourceResponse`。

响应元素（`FinanceSourceResponse`，`backend/app/schemas/finance_source.py:51-63`，客户端类型 `FinanceSource`，`frontend/src/types/api.ts:37-45`）：

```json
{"id":"7c3e1c1e-2a4b-4b6e-9a3e-1f2d3c4b5a69","user_id":"0f0c0a1e-9d8b-4c7a-8e6f-5a4b3c2d1e0f","name":"Chase Checking","type":"checking","default_currency":"USD","archived":false,"created_at":"2026-08-30T09:12:44.512345"}
```

服务端按 `created_at DESC` 排序（`backend/app/api/finance_sources.py:70`）。

### 4.5 `FinanceSourceFormScreen`（`frontend/src/screens/FinanceSourceFormScreen.tsx`）

Props：`source?`、`onSuccess`、`onCancel`（10-14）；`isEditing = !!source`（20）。

* 状态：`name`、`type`（默认 `'checking'`）、`currency`（默认 `'USD'`）、`errors: { name? }`、`currencyPickerVisible`（22-26）。
* `SOURCE_TYPES = ['checking','savings','credit','cash','investment','other']`（16），创建时渲染为一排切换按钮（132-149）。服务端只接受 `^(checking|savings|credit|other)$`（`backend/app/schemas/finance_source.py:21-26`）：选 "Cash" 或 "Investment" 会得到 422，消息以 `"[object Object]"` 的形式（§5.3）通过 `Alert.alert('Error', …)`（48）呈现——Web 上不可见。
* 币种查询：`[QUERY_KEYS.CURRENCIES]`，`staleTime: Infinity`（29-33）；`currencies = Object.keys(data.currencies).sort()`，`data` 为空（加载中，或请求失败——例如后端因 Frankfurter 不可达返回 503，`backend/app/services/rates.py:49-53`，经 `retry: 1` 重试一次后仍失败）时回退到 `['USD','EUR','GBP','CNY','SGD','HKD']`（35-37）；回退状态下 `currencyData?.currencies[item]` 为 undefined，列表行只显示币种代码、不显示全名（205、216）。
* 币种选择器（仅创建时，152-228）：Web → 横向 `ScrollView`，每个币种一个小号 `Button`（156-171）；原生 → `TouchableOpacity` 触发按钮 + 全屏 `Modal animationType="slide"`，头部 "Select Currency"/"Close"，`FlatList` 每行 `code - Full Name`，选中项背景 `#eff6ff`（172-226）。这一份没有搜索框。
* 校验（66-79）：`name.trim()` 必填（69-70）；`name.length < 2` → "Name must be at least 2 characters"（71-72）；`name.length > 100` → "Name must be less than 100 characters"（73-74）——长度检查用的是未 trim 的字符串。
* 提交（81-98）：编辑 → `updateMutation.mutate({ id, data: { name: name.trim() } })`（86-90）；创建 → `createMutation.mutate({ name: name.trim(), type, default_currency: currency })`（92-96）。
* Mutation（40-64）：两者都 `invalidateQueries({ queryKey: ['finance_sources'] })`（43、57），然后 `Alert.alert('Success', …)`（44、58，Web 上空操作）并调 `onSuccess()`；出错 `Alert.alert('Error', error.message || …)`（48、62）。
* 编辑时隐藏类型与币种，显示信息框 "ℹ️ Type and currency cannot be changed after creation"（231-237）。按钮："Cancel" 与 "Create"/"Update"/"Saving..."（240-255）。

创建流程（`POST /api/v1/finance-sources`）：

1. 客户端 `createMutation.mutate(...)`，body：

   ```json
   {"name":"Chase Checking","type":"checking","default_currency":"USD"}
   ```

2. 服务端（`backend/app/api/finance_sources.py:17-51`）：`get_current_user` 失败 → 401；Pydantic `FinanceSourceCreate`（`name` 1–100 字符、`type` 匹配正则、`default_currency` 匹配 `^[A-Z]{3}$`，`backend/app/schemas/finance_source.py:11-31`；`backend/app/schemas/currency.py:9`）失败 → 422；插入记录、`default_currency` 转大写、`archived=False`（31-41）；若这是该用户的第一个资金账户，把 `user.default_source_id` 设为它（43-49）；201 返回 `FinanceSourceResponse`。
3. 客户端：失效 `['finance_sources']`，`onSuccess()` → `HomeScreen` 切回 `'finance-sources'`。

编辑请求（`PATCH /api/v1/finance-sources/{id}`）：`{"name":"Chase Checking (joint)"}`。

### 4.6 `TransactionsScreen`（`frontend/src/screens/TransactionsScreen.tsx`）

Props：`onCreatePress`、`onEditPress(transaction)`、`onBackPress`（10-14）。

* `limit` 是一个常量 `useState(50)`（19）；查询键 `[QUERY_KEYS.TRANSACTIONS]` → `getTransactions({ limit })` → `GET /api/v1/transactions?limit=50`（22-25）。没有分页、没有筛选，`limit` 不在查询键里。服务端按 `occurred_at DESC, created_at DESC` 排序，`limit` 上限 100（`backend/app/api/transactions.py:168-169,215`）。
* `deleteMutation`（28-42）：`DELETE /api/v1/transactions/{id}`；`onSuccess` 以 `refetchType: 'all'` 失效 `['transactions']`（30-35）；`onError` 只在 Web 上 `window.alert`——原生上错误被吞掉（36-41）。
* `handleDelete`（44-68）：若 `transfer_pair_id` 非空，标题 "Delete Transfer"，正文 "This will delete BOTH sides of the transfer. Continue?"，按钮 "Keep Transfer"/"Delete Transfer"；否则 "Delete Transaction" / "Are you sure you want to delete this transaction?" / "Keep Transaction"/"Delete Transaction"（45-51）。Web `window.confirm(title + "\n\n" + message)`（53-57）；原生 `Alert.alert`，按钮带 `cancel`/`destructive` 样式（59-66）。
* `formatAmount(amount, currency)`（70-80）：`parseFloat`；`>= 0` 时符号 `'+'`、颜色 `#10b981`（绿），否则 `'-'`、`#ef4444`（红）；文本为 `${sign}${currency} ${abs.toFixed(2)}`。
* `formatDate`（82-95）：`new Date(dateString)`（`YYYY-MM-DD` 字符串按 UTC 解析）与 `new Date()` 用本地 `toDateString()` 比较，得到 "Today"、"Yesterday"，否则 `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`。
* 行（97-175）：描述或 "No description"（109-111）；商户（112-114）；日期 + "Transfer" 徽章（115-122）；标签片（123-131）；"Original" 金额（134-139）；当 `item.currency !== user.base_currency` 且 `converted_amount` 存在时显示 `In <base_currency>` 标签下的换算金额和 `@ rate.toFixed(4) <base_currency>/<currency>` 一行（100-103、140-152）；"Edit"（secondary）与 "Delete"（danger）按钮——`loading={deleteMutation.isPending}` 作用于**每一行**的 Delete 按钮（170），所以任何一次删除期间所有行的 Delete 都在转圈。
* 头部行（207-223）；`ListHeaderComponent` 是 "Recent Transactions / N transaction(s)" 汇总（192-201、231）；`!isLoading` 时的空状态（177-190、232）；下拉刷新（233-239，仅原生生效）。

删除流程（`DELETE /api/v1/transactions/{id}`，`backend/app/api/transactions.py:416-468`）：`get_current_user` 失败 → 401；按 `id` + `user_id` 查不到 → 404 `{"detail":"Transaction <id> not found"}`（440-444）；若 `transfer_pair_id` 非空，删除该用户下所有同 `transfer_pair_id` 的记录并返回 `{"deleted_count":2,"message":"Transfer deleted successfully (2 transactions)"}`（447-459）；否则删除单条并返回 `{"deleted_count":1,"message":"Transaction deleted successfully"}`（461-468）。客户端丢弃响应体（`frontend/src/api/transactions.ts:59-61`）。

响应元素（`TransactionResponse`，`backend/app/schemas/transaction.py:89-124`，客户端类型 `Transaction`，`frontend/src/types/api.ts:59-74`；`amount`、`converted_amount`、`conversion_rate` 是字符串，因为 Pydantic 把 `Decimal` 序列化为 JSON 字符串）：

```json
{"id":"3d0d8a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a","user_id":"0f0c0a1e-9d8b-4c7a-8e6f-5a4b3c2d1e0f","source_id":"7c3e1c1e-2a4b-4b6e-9a3e-1f2d3c4b5a69","amount":"-42.5000","currency":"EUR","occurred_at":"2026-09-01","description":"Groceries","merchant":"Whole Foods","transfer_pair_id":null,"created_at":"2026-09-01T12:00:00.000000","converted_amount":"-46.1200","conversion_rate":"1.0852","conversion_date":"2026-09-01","tags":["food"]}
```

### 4.7 `TransactionFormScreen`（`frontend/src/screens/TransactionFormScreen.tsx`，1034 行）

Props：`transaction?`、`onSuccess`、`onCancel`（11-15）。`type TransactionType = 'expense' | 'income' | 'transfer'`（17）。

**状态**（24-40）：

| 字段 | 初值 | 行 |
|---|---|---|
| `type` | `'expense'` | 24 |
| `sourceId` | `transaction?.source_id` 或 `''` | 25 |
| `amount`（字符串） | 编辑时 `Math.abs(Number(transaction.amount)).toString()`，否则 `''` | 26 |
| `currency` | `transaction?.currency` 或 `'USD'` | 27 |
| `date` | `transaction?.occurred_at` 或 `new Date().toISOString().split('T')[0]`（`YYYY-MM-DD`，UTC 的今天） | 28 |
| `description`、`merchant` | 来自 transaction 或 `''` | 29-30 |
| `tagsInput` | `transaction?.tags.join(', ')` 或 `''` | 31 |
| `errors` | `{}`（字符串映射） | 32 |
| `currencyPickerVisible`、`currencySearch` | `false`、`''` | 33-34 |
| `step` | `1`（转账向导） | 37 |
| `destinationSourceId`、`destPickerVisible`、`isSubmitting` | `''`、`false`、`false` | 38-40 |

**查询**：活跃资金账户 `[QUERY_KEYS.FINANCE_SOURCES, false]` → `getFinanceSources(false)`（43-46）；币种 `[QUERY_KEYS.CURRENCIES]`，`staleTime: Infinity`（49-53）；`allCurrencies` 排序后的键，加载中或请求失败时（`currencyData` 为 undefined）为 6 项回退列表（56-58，回退状态下列表行不显示全名，852、864）；`filteredCurrencies` 按代码或全名对 `currencySearch` 做不区分大小写的包含匹配（60-66）。

**副作用（`useEffect`）**：

* 默认账户：创建模式下，`sources` 非空且 `sourceId` 为空时 → `setSourceId(sources[0].id)`（69-73）。服务端按 `created_at DESC` 排序（`backend/app/api/finance_sources.py:70`），所以预选的是最新创建的账户。
* 编辑时从数据推导类型（76-87）：`transfer_pair_id` 非空 → `'transfer'`；`amount >= 0` → `'income'`；否则 `'expense'`。
* 离开 `'transfer'` 时重置 `step=1`、`destinationSourceId=''`（90-95）。

**金额正负怎么选**——由 `type` 决定，用户从不输入符号：

* 普通创建/更新：`signedAmount = type === 'income' ? numAmount : -numAmount`（`frontend/src/screens/TransactionFormScreen.tsx:313-314`）。
* 转账创建：来源腿 `amount: -absAmount`，目标腿 `amount: absAmount`（180-184、197-201）。
* 转账更新：每条腿保持自己原有的符号：`Number(transaction.amount) < 0 ? -absAmount : absAmount`（241-242），配对腿同理（267）。

**校验**（`validate`，134-158）：`sourceId` 必填 → "Finance source is required"（137-139）；`Number(amount)` 必须是数且 `> 0`——`NaN` 时消息 "Amount must be a valid number"，否则 "Amount must be greater than 0"（140-143，注意 `Number('')` 为 0，空串走后者）；`date` 必填 → "Date is required"（144-146）；新建转账时 `destinationSourceId` 必填且 `!== sourceId`（147-154）。

**普通收支提交**（`handleSubmit`，296-343）：先把转账分流到下面两个处理函数（298-307），否则校验、计算 `signedAmount`、把 `tagsInput` 按 `,` 拆分、trim、去空（315-318），然后：

* 创建 → `createMutation.mutate({ source_id, amount: signedAmount, currency: currency.toUpperCase(), occurred_at: date, description: description.trim() || undefined, merchant: merchant.trim() || undefined, tags })`（333-342）。值为 `undefined` 的键在 JSON 序列化时被丢弃。
* 更新 → `updateMutation.mutate({ id, data: { amount, currency, occurred_at, description, merchant, tags } })`（320-331）。因为空字符串变成 `undefined`（327-328）而服务端用 `model_dump(exclude_unset=True)`（`backend/app/api/transactions.py:359`），描述/商户一旦设置就无法通过这个表单清空。
* Mutation（98-132）：两者都失效 `['transactions']`（101、120）并调 `onSuccess()`；成功/失败反馈只在 Web 上 `window.alert`（102-104、109-111、121-123、128-130）。

创建流程（`POST /api/v1/transactions`）：

1. 客户端 `createMutation.mutate(...)`，body：

   ```json
   {"source_id":"7c3e1c1e-2a4b-4b6e-9a3e-1f2d3c4b5a69","amount":-42.5,"currency":"EUR","occurred_at":"2026-09-01","description":"Groceries","merchant":"Whole Foods","tags":["food"]}
   ```

2. 服务端（`backend/app/api/transactions.py:52-141`）依次检查：`get_current_user` 失败 → 401；Pydantic `TransactionCreate`（`amount: Decimal`、`decimal_places=4`；`currency` 匹配 `^[A-Z]{3}$`；`occurred_at: date`；`description` 最长 500；`merchant` 最长 200，`backend/app/schemas/transaction.py:12-54`）失败 → 422；`source_id = transaction_data.source_id or current_user.default_source_id`（70），两者都空 → 400 `{"detail":"No finance source specified and user has no default source. Please create a finance source first."}`（72-76）；该账户不属于当前用户 → 404 `{"detail":"Finance source <id> not found or does not belong to you"}`（84-88）。
3. 写库：插入交易（`currency` 转大写，91-103），每个标签 `strip().lower()` 后写入 `TransactionTag`（106-112），提交（114-115）。
4. 响应：201 `TransactionResponse`，附带按用户基准币种计算的 `converted_amount`/`conversion_rate`/`conversion_date`（117-141）。
5. 客户端：失效 `['transactions']`，Web 上 `window.alert('Success\n\nTransaction created successfully!')`，`onSuccess()` → `HomeScreen` 切回 `'transactions'`。

更新请求（`PATCH /api/v1/transactions/{id}`）：

```json
{"amount":-42.5,"currency":"EUR","occurred_at":"2026-09-01","description":"Groceries","merchant":"Whole Foods","tags":["food"]}
```

服务端（`backend/app/api/transactions.py:327-413`）：401 → 按 `id` + `user_id` 查不到 → 404 `{"detail":"Transaction <id> not found"}`（352-356）→ `exclude_unset` 取出字段（359）→ `amount`/`currency`/`occurred_at` 为 `None` 时跳过、`currency` 转大写（365-371）→ 传了 `tags` 则先删后插、标签 `strip().lower()`（374-384）→ 200 `TransactionResponse`。

**转账创建**（`handleTransferSubmit`，161-234）——两次顺序 `POST`，配对 id 由客户端生成：

1. `validate()`（162）。
2. `pairId = crypto.randomUUID()`（164）；`absAmount = Math.abs(Number(amount))`（165）；拆分标签（166）；`commonFields = { currency: currency.toUpperCase(), occurred_at: date, description|undefined, merchant|undefined, tags|undefined, transfer_pair_id: pairId }`（167-174）。
3. `setIsSubmitting(true)`（176）。
4. HTTP `POST /api/v1/transactions`，body `{ source_id: sourceId, amount: -absAmount, ...commonFields }`（180-184）。服务端检查同上一节。失败：`setIsSubmitting(false)`，提示 `Error\n\n<message>`，返回（185-194）。
5. HTTP `POST /api/v1/transactions`，body `{ source_id: destinationSourceId, amount: absAmount, ...commonFields }`（197-201）。成功：失效 `['transactions']` 与 `['finance_sources', false]`（202-203），提示 "Success\n\nTransfer created successfully!"，`onSuccess()`（204-210）。
6. 第 5 步抛错：HTTP `DELETE /api/v1/transactions/{firstLeg.id}`（214）。若回滚也抛错：提示 "Transfer Error\n\nTransfer partially created. One transaction may exist in your account — please check your transactions and delete manually if needed." 并返回（215-225）。回滚成功则提示第二次的错误（226-233）。

第一条腿的请求示例：

```json
{"source_id":"7c3e1c1e-2a4b-4b6e-9a3e-1f2d3c4b5a69","amount":-100,"currency":"USD","occurred_at":"2026-09-03","description":"Monthly transfer","tags":["savings"],"transfer_pair_id":"8b1f4d2e-5c6a-4e7f-9a0b-1c2d3e4f5a6b"}
```

```
 转账向导（仅创建）                                转账提交
 ┌────────────────────────┐  Next →（sourceId、   ┌───────────┐ 成功 ┌────────────┐ 成功 ┌──────────┐
 │ step 1                 │  destination 已选，   │ POST 腿 1 │────▶│ POST 腿 2  │────▶│ 成功提示 │
 │ From <select>          │  且两者不同）          └─────┬─────┘      └─────┬──────┘      └──────────┘
 │ To   <select> / Modal  │ ────────────────────▶       │ 失败             │ 失败
 │ [Cancel] [Next →]      │                             ▼                  ▼
 └────────────────────────┘ ◀─── ← Back ─────    ┌───────────┐      ┌──────────────────┐ 成功 ┌──────────────────┐
 │ step 2                 │                       │ 错误提示  │      │ DELETE 腿 1      │────▶│ 提示第二次的错误 │
 │ Amount、Currency、      │                       └───────────┘      └────────┬─────────┘      └──────────────────┘
 │ <input type=date>、     │                                                   │ 失败
 │ Desc、Merchant、Tags    │                                                   ▼
 │ [← Back] [Create]      │                                        ┌──────────────────────────┐
 └────────────────────────┘                                        │ "Transfer partially      │
                                                                   │  created" 提示           │
                                                                   └──────────────────────────┘
```

**转账更新**（`handleTransferUpdate`，236-294）：

1. `validate()`；没有 `transaction` 则直接返回（237-239）。
2. HTTP `PATCH /api/v1/transactions/{transaction.id}`，body `{ amount: signedAmount, occurred_at, description|undefined, merchant|undefined, tags }`——**不含** `currency`（249-255）。
3. 在缓存的 `['transactions']` 数组里找配对腿；缓存为空时 `GET /api/v1/transactions`（不带参数，服务端默认 `limit` 50）（258-264）。如果配对腿不在返回的行里，它会被静默地保持不变。
4. 找到则用相同字段和它自己的符号 `PATCH` 它（266-275）。
5. 失效 `['transactions']`，提示 "Transfer updated successfully!"，`onSuccess()`（277-284）。任一步出错 → 提示（285-293）。

**界面布局**（347-873）：

* 类型选择器（仅创建）：三个小号按钮 "💸 Expense" / "💰 Income" / "🔄 Transfer"；`!sources || sources.length <= 1` 时 Transfer 被 `disabled` 并显示提示 "Add another finance source to enable transfers."（362-393）。
* 第 1 步（396-522）：`From *` `<select>` 列出所有活跃账户（404-414）；`To *` 在 Web 上是带占位选项 "Select destination" 且排除来源账户的 `<select>`（422-436），原生上是 "Select Destination" `Modal` + `FlatList`（437-488）；Cancel + "Next →"，后者的处理函数重新检查来源/目标后 `setStep(2)`（500-519）。
* 第 2 步（525-615）：金额 `Input keyboardType="decimal-pad" inputMode="decimal"`（530-541）；币种触发按钮打开可搜索的模态框（546-551），Web 上附 "Tap to search" 提示（552）；`<input type="date">`（558-566）；Description/Merchant/Tags `Input`（571-595）；"← Back" + "Create Transfer"（598-613）。
* 编辑转账（618-697）：提示 "Source and currency cannot be changed on an existing transfer."（621）；金额、日期、Description、Merchant、Tags；"Cancel" + "Update Transfer"（680-695）。
* 普通收支（700-809）：资金账户 `<select>`（仅创建，703-721）；金额（724-735）；币种触发按钮（740-747）——编辑模式下也可用；`<input type="date">`（752-762）；Description/Merchant/Tags（765-789）；"Cancel" + "Create"/"Update"（792-807）。
* 可搜索币种 `Modal`（814-872）：头部 "Select Currency"/"Close"，`TextInput` 占位 "Search currencies..."，`FlatList` 渲染 `filteredCurrencies`；选中后设置 `currency` 并清空搜索。两个平台都使用这一份。

`<select>`/`<input>` 元素接收的是 `StyleSheet` 对象经 `as any` 强转（`styles.picker`、`styles.dateInput`：407、427、565、647、710、759）；它们的 `fontSize: 14`（919、935）会被 `public/pwa.css` 的 `font-size: 16px !important` 覆盖（`frontend/public/pwa.css:4-6`）。

### 4.8 `ProfileScreen`（`frontend/src/screens/ProfileScreen.tsx`）

Props：`onBack`（22-24）。

* 状态：`selectedCurrency`（初值 `user.base_currency ?? 'USD'`）、`pickerVisible`、`searchText`（28-30）。
* 币种查询 `[QUERY_KEYS.CURRENCIES]`，`staleTime: Infinity`（33-37）；回退列表（加载中或请求失败时均回退）与搜索过滤和 `TransactionFormScreen` 完全相同（39-49）。
* Mutation（51-79）：`updateMe({ base_currency })` → `PATCH /api/v1/auth/me`，body `{"base_currency":"EUR"}`；`onSuccess` → `await refreshUser()`（出错只记录日志，54-61）→ 提示 "Success\n\nProfile updated successfully!"（Web `window.alert`，原生 `Alert.alert`）→ `onBack()`（63-69）。`onError` 读取 `err?.response?.data?.detail`（72）——但拦截器已经把 Axios 错误替换成普通 `Error`（§5.3），`err.response` 永远是 `undefined`，所以总是显示回退文案 "Failed to update profile. Please try again."。
* `handleSave`（81-87）：只有 `selectedCurrency !== user.base_currency` 时才发请求，否则直接 `onBack()`。
* 界面："← Back" `TouchableOpacity`（98-100）；只读卡片显示 Email 与 "Member since"（`new Date(created_at).toLocaleDateString()`，89-91、105-115）；"Preferences" 卡片里的币种触发按钮（币种加载中时 `disabled`，118-131）；"Save Changes"/"Saving..."（mutation 进行中或币种加载中时禁用）+ "Cancel"（134-148）；可搜索币种 `Modal`（152-210）。

服务端流程（`PATCH /auth/me`，`backend/app/api/auth.py:101-138`）：401 → Pydantic `UserUpdate`（`base_currency` 恰好 3 字符，`backend/app/schemas/user.py:33-44`）失败 → 422 → 若传了 `default_source_id` 且不属于当前用户 → 404 `{"detail":"Finance source not found"}`（114-120）→ `exclude_unset`，`base_currency` 转大写（122-129）→ 200 `UserResponse`。

`UserUpdate` 的 `default_source_id` 字段（`frontend/src/types/api.ts:15-18`）从未在界面上被设置。

### 4.9 重复的币种选择器

同一套「模态框 + 行」的 JSX 与样式被复制了四份（前三份是币种选择器，第四份是转账目标账户选择器）：

| 副本 | JSX 行 | 样式行 | 搜索框 |
|---|---|---|---|
| `frontend/src/screens/FinanceSourceFormScreen.tsx`（仅原生分支） | 182-224 | 327-392 | 无 |
| `frontend/src/screens/ProfileScreen.tsx` | 152-210 | 286-362 | 有（176-182） |
| `frontend/src/screens/TransactionFormScreen.tsx` 币种 | 814-872 | 958-1033 | 有（838-844） |
| `frontend/src/screens/TransactionFormScreen.tsx` 目标账户（原生分支） | 448-486 | 复用上一行的币种样式 | 无 |

`frontend/src/screens/RegisterScreen.tsx:6-12,142-153` 是第五种：基于按钮、列表硬编码。

### 4.10 Alert / confirm 矩阵

| 页面 | 反馈机制 | Web 上的结果 |
|---|---|---|
| `HomeScreen` 登出 | 仅 `Alert.alert`（20-39） | 没有任何反应 |
| `LoginScreen` 错误 | `Alert.alert` + 行内错误（45-46） | 看不到任何东西（§2.5） |
| `RegisterScreen` 成功/错误 | `Alert.alert`（73、77） | 看不到；只有消息含 "email" 时邮箱字段下会显示错误（但组件已重新挂载，见 §2.5） |
| `FinanceSourceFormScreen` 全部 | `Alert.alert`（44、48、58、62） | 看不到；`onSuccess` 触发的页面切换仍会发生 |
| `FinanceSourcesScreen` | 分支（38-43、51-71） | `window.confirm` / `window.alert` |
| `TransactionsScreen` 删除确认 | 分支（53-66） | `window.confirm` |
| `TransactionsScreen` 删除失败 | 仅 Web（36-41） | `window.alert`；原生上静默 |
| `TransactionFormScreen` 创建/更新 | 仅 Web（102-111、121-130） | `window.alert`；原生上静默 |
| `TransactionFormScreen` 转账 | 分支（188-231、279-291） | `window.alert` |
| `ProfileScreen` | 分支（64-69、73-77） | `window.alert` |

---

## 5. API 客户端

### 5.1 Base URL 的解析

* 唯一的引入路径是 `@/constants/config` 导出的 `API_BASE_URL`（`frontend/src/api/client.ts:3`）。
* `frontend/src/constants/config.ts` 是**生效**文件，与 `config.dev.ts` 逐字节相同（`diff` 无差异）：`API_BASE_URL = 'http://localhost:8000/api/v1'`（`frontend/src/constants/config.ts:7`）。文件头注释说明原生开发（模拟器）无法解析相对路径，所以这里保留绝对 URL（1-6）。
* `frontend/src/constants/config.prod.ts` 设置 `API_BASE_URL = '/api/v1'`（`frontend/src/constants/config.prod.ts:5`），即同源；Caddy 用 `handle /api/* { reverse_proxy api:8000 }` 把它转发到 API 容器（`infra/Caddyfile:12-14`）。
* 替换由 `build:web` 脚本完成（`frontend/package.json:10`）：

```
rm -rf dist
&& cp src/constants/config.prod.ts src/constants/config.ts
&& expo export -p web
&& npx workbox generateSW workbox-config.cjs
&& cp src/constants/config.dev.ts src/constants/config.ts
```

如果 `expo export` 或 `workbox` 失败，最后那条 `cp` 不会执行，`config.ts` 会停留在生产形态。没有环境变量或 `app.config` 机制；三个配置文件的其余内容相同：`STORAGE_KEYS`、`APP_NAME = 'Wallet App'`、`APP_VERSION = '1.0.0'`、`QUERY_KEYS`（`frontend/src/constants/config.ts:10-26`；`frontend/src/constants/config.prod.ts:8-24`）。

开发模式下（`expo start --web`，Metro 在 `http://localhost:8081`）前端跨源访问 `http://localhost:8000`，依赖后端 CORS 白名单默认值 `"http://localhost:8081,http://localhost:19006,http://localhost:3000"`（`backend/app/core/config.py:25`；`backend/app/main.py:17-24`）。

### 5.2 Axios 实例与拦截器

```ts
export const apiClient = axios.create({      // frontend/src/api/client.ts:8-14
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});
```

请求拦截器（`frontend/src/api/client.ts:19-34`）：每个请求前 `await AsyncStorage.getItem('@wallet_app:auth_token')`；存在则设置 `config.headers.Authorization = "Bearer <token>"`；读取存储出错时 `console.error` 后请求照常以未认证方式发出。

响应拦截器（`frontend/src/api/client.ts:39-79`）：成功响应原样放行；错误先做 §2.6 的 401 副作用，再做 §5.3 的归一化后拒绝。

### 5.3 错误归一化

`apiClient` 拒绝的 promise 一律是普通 `Error`（永远不是 `AxiosError`）：

| 条件 | `Error.message` | 行 |
|---|---|---|
| `error.response` 存在 | `data.detail \|\| data.message \|\| 'An error occurred'`（空字符串等假值会继续回退） | 67-70 |
| `error.request` 存在但无响应（超时、DNS、CORS、离线） | `'Network error. Please check your connection.'` | 71-73 |
| 其他 | `error.message \|\| 'An unexpected error occurred'` | 74-77 |

FastAPI 的校验错误（422）里 `detail` 是**对象数组**，例如 `{"detail":[{"type":"string_too_short","loc":["body","password"],"msg":"String should have at least 8 characters","input":"secret","ctx":{"min_length":8}}]}`；`new Error(array)` 会把数组字符串化成 `"[object Object]"`（多条时以逗号连接）——这就是页面对任何 422 显示的文本。

### 5.4 API 模块

| 模块 | 函数 | HTTP | 调用方 |
|---|---|---|---|
| `frontend/src/api/auth.ts` | `register(data)`（17-20） | `POST /auth/register` | AuthContext |
| | `login(data)`（25-28） | `POST /auth/login` | AuthContext |
| | `getCurrentUser()`（33-36） | `GET /auth/me` | AuthContext |
| | `updateMe(data)`（41-44） | `PATCH /auth/me` | ProfileScreen |
| | `logout()`（49-52） | 无（函数体为空） | 无人调用 |
| `frontend/src/api/financeSources.ts` | `getFinanceSources(includeArchived=false)`（15-20） | `GET /finance-sources?include_archived=` | FinanceSourcesScreen、TransactionFormScreen |
| | `getFinanceSource(id)`（25-28） | `GET /finance-sources/{id}` | 无人调用 |
| | `createFinanceSource(data)`（33-36） | `POST /finance-sources` | FinanceSourceFormScreen |
| | `updateFinanceSource(id, data)`（41-47） | `PATCH /finance-sources/{id}` | FinanceSourcesScreen、FinanceSourceFormScreen |
| `frontend/src/api/rates.ts` | `getCurrencies()`（13-16） | `GET /rates/currencies` | ProfileScreen、FinanceSourceFormScreen、TransactionFormScreen |
| `frontend/src/api/transactions.ts` | `getTransactions(params?)`（20-27），参数类型 `TransactionListParams { source_id?, from_date?, to_date?, tag?, limit?, offset? }`（8-15） | `GET /transactions` | TransactionsScreen、TransactionFormScreen |
| | `getTransaction(id)`（32-35） | `GET /transactions/{id}` | 无人调用 |
| | `createTransaction(data)`（40-43） | `POST /transactions` | TransactionFormScreen |
| | `updateTransaction(id, data)`（48-54） | `PATCH /transactions/{id}` | TransactionFormScreen |
| | `deleteTransaction(id)`（59-61） | `DELETE /transactions/{id}` | TransactionsScreen、TransactionFormScreen |

（"无人调用"以 `grep -rn "getFinanceSource\b\|getTransaction\b" src/ App.tsx` 除定义处外无命中为据。）

所有路由挂在 `/api/v1` 下（`backend/app/main.py:27-30`），前缀分别是 `/auth`、`/rates`、`/finance-sources`、`/transactions`（`backend/app/api/auth.py:17`；`backend/app/api/rates.py:17`；`backend/app/api/finance_sources.py:14`；`backend/app/api/transactions.py:49`）。

`GET /rates/currencies` 的响应（`CurrencyList`，`backend/app/schemas/currency.py:12-22`；值是 Frankfurter 的币种名称，2026-09-03 线上实测共 30 项（`backend/app/api/rates.py:25` docstring 写的 31 已过时））：

```json
{"currencies":{"AUD":"Australian Dollar","BRL":"Brazilian Real","CAD":"Canadian Dollar","CHF":"Swiss Franc","CNY":"Chinese Renminbi Yuan","CZK":"Czech Koruna","DKK":"Danish Krone","EUR":"Euro","GBP":"British Pound","HKD":"Hong Kong Dollar","HUF":"Hungarian Forint","IDR":"Indonesian Rupiah","ILS":"Israeli New Sheqel","INR":"Indian Rupee","ISK":"Icelandic Króna","JPY":"Japanese Yen","KRW":"South Korean Won","MXN":"Mexican Peso","MYR":"Malaysian Ringgit","NOK":"Norwegian Krone","NZD":"New Zealand Dollar","PHP":"Philippine Peso","PLN":"Polish Złoty","RON":"Romanian Leu","SEK":"Swedish Krona","SGD":"Singapore Dollar","THB":"Thai Baht","TRY":"Turkish Lira","USD":"United States Dollar","ZAR":"South African Rand"}}
```

### 5.5 `frontend/src/types/api.ts`

| 类型 | 字段 | 行 | 是否使用 |
|---|---|---|---|
| `User` | `id: string; email: string; base_currency: string; default_source_id: string 或 null; created_at: string` | 7-13 | 是 |
| `UserUpdate` | `base_currency?: string; default_source_id?: string` | 15-18 | 是（ProfileScreen） |
| `LoginRequest` | `email; password` | 20-23 | 是 |
| `RegisterRequest` | `email; password; base_currency` | 25-29 | 是 |
| `AuthResponse` | `access_token: string; token_type: string` | 31-34 | 是 |
| `FinanceSource` | `id; user_id; name; type: string; default_currency; archived: boolean; created_at` | 37-45 | 是 |
| `FinanceSourceCreate` | `name; type; default_currency` | 47-51 | 是 |
| `FinanceSourceUpdate` | `name?; archived?` | 53-56 | 是 |
| `Transaction` | `id; user_id; source_id; amount: string; currency; occurred_at: string; description: string 或 null; merchant: string 或 null; transfer_pair_id: string 或 null; created_at; converted_amount: string 或 null; conversion_rate: string 或 null; conversion_date: string 或 null; tags: string[]` | 59-74 | 是 |
| `TransactionCreate` | `source_id?; amount: number; currency; occurred_at; description?; merchant?; tags?; transfer_pair_id?` | 76-85 | 是 |
| `TransactionUpdate` | `amount?: number; currency?; occurred_at?; description?; merchant?; tags?` | 87-94 | 是 |
| `CurrencyList` | `currencies: Record<string, string>` | 97-99 | 是 |
| `ExchangeRate`、`ConversionRequest`、`ConversionResult`、`ApiError` | — | 101-125 | 没有任何地方导入 |

客户端的 `FinanceSource.type` 是普通 `string`，而服务端强制 §4.5 所述的正则。

---

## 6. 组件与样式

### 6.1 组件清单

`frontend/src/components/index.ts:5-8` 重新导出 `Button`、`Input`、`Card`、`Screen`；`Navigation` 由 `App.tsx:7` 直接导入。

| 组件 | Props | 行为 |
|---|---|---|
| `Button`（`frontend/src/components/Button.tsx:11-67`） | `title: string; onPress; variant?: 'primary' 或 'secondary' 或 'danger'，默认 'primary'; size?: 'small' 或 'medium' 或 'large'，默认 'medium'; disabled?; loading?; style?: ViewStyle; textStyle?: TextStyle` | `TouchableOpacity activeOpacity={0.7}`；`disabled` 或 `loading` 为真时 `opacity: 0.5` 且不可点；`loading` 把标题换成 `ActivityIndicator`（secondary 用 `#0ea5e9`，其他用白色）（47-51）。基础样式 `minHeight: 44`（75）；`small` 追加 `minHeight: 44` 与 `minWidth: 44`（92-97）。颜色：primary `#0ea5e9`，secondary 白底 `#0ea5e9` 边框，danger `#ef4444`（79-89）。 |
| `Card`（`frontend/src/components/Card.tsx:4-16`） | `children; style?; variant?: 'default' 或 'outlined' 或 'elevated'，默认 'default'` | `borderRadius 12, padding 16`；outlined 加 `#e5e7eb` 边框；elevated 用 CSS `boxShadow: '0px 2px 8px rgba(0,0,0,0.1)'` 加 Android `elevation: 3`（整块 `as any`，31-35）。 |
| `Input`（`frontend/src/components/Input.tsx:11-61`） | 继承 `TextInputProps`，加 `label?; error?; hint?; isPassword?` | 标签、`TextInput`（聚焦时边框 `#0ea5e9` 宽 2，出错时边框 `#ef4444`，34-39）；密码显隐 `TouchableOpacity`，图标 `👁️` / `👁️‍🗨️`（46-55，44×44 命中区 93-102）；下方显示错误文本或提示（57-58）。 |
| `Screen`（`frontend/src/components/Screen.tsx:11-44`） | `children; scrollable?，默认 true; padding?，默认 true` | `SafeAreaView`（来自 `react-native-safe-area-context`，9、25）→ `KeyboardAvoidingView`（26-29）→ 可选的 `ScrollView keyboardShouldPersistTaps="handled"`（30-37）→ 带内边距 16 的 `View`（19-21、63-65）。背景 `#f9fafb`（47-50）。 |
| `Navigation`（`frontend/src/components/Navigation.tsx:13-49`） | 无 | 见 §3.1 |

没有任何页面传 `scrollable={false}`（`grep -rn scrollable src/` 只命中 `Screen.tsx` 的定义和一处注释）。因此在 `Screen` 内部再渲染自己的 `ScrollView`/`FlatList` 的页面都形成了嵌套滚动容器：`ProfileScreen.tsx:95`、`FinanceSourceFormScreen.tsx:104`、`TransactionFormScreen.tsx:349`、`FinanceSourcesScreen.tsx:160`、`TransactionsScreen.tsx:226`。

### 6.2 样式方式

* 每个文件都用 `StyleSheet.create` 配合字面量十六进制颜色。对 `App.tsx` + `src/` 统计（`grep -o "#[0-9a-fA-F]\{6\}\b"`）：**147** 处十六进制颜色，分布在 **14** 个文件，**18** 种不同颜色：`#1f2937`×28、`#ffffff`×23、`#6b7280`×22、`#0ea5e9`×19、`#e5e7eb`×8、`#d1d5db`×8、`#ef4444`×6、`#9ca3af`×6、`#f3f4f6`×5、`#eff6ff`×5、`#374151`×5、`#f9fafb`×4、`#4b5563`×2、`#1e40af`×2、`#fef3c7`、`#dbeafe`、`#92400e`、`#10b981` 各 1；另有一处 `rgba(0, 0, 0, 0.1)`（`frontend/src/components/Card.tsx:33`）和一处 `'transparent'`（`frontend/src/components/Navigation.tsx:67`）。按文件：TransactionFormScreen 24、ProfileScreen 23、TransactionsScreen 21、FinanceSourceFormScreen 18、FinanceSourcesScreen 14、Input 9、Button 9、HomeScreen 7、Navigation 6、RegisterScreen 4、LoginScreen 4、Card 4、App 3、Screen 1。
* 没有主题模块，没有 `useColorScheme`，没有深色模式（`userInterfaceStyle: "light"`，`frontend/app.json:8`）。
* `frontend/tailwind.config.js:9-21` 定义了以 `#0ea5e9` 为中心的 `primary` 50–900 色阶，但没有任何代码消费它。
* 图标全部是 `Text` 里的 emoji（例如 `HomeScreen.tsx:144,165,171,177`、`LoginScreen.tsx:56`、`TransactionFormScreen.tsx:367,374,381`、`Input.tsx:52`）；没有图标字体，没有 `expo-font`。

### 6.3 已安装但未使用的库（证据）

`grep -rn "react-navigation\|react-hook-form\|hookform\|from 'zod'\|nativewind\|className=\|gesture-handler\|reanimated\|worklets\|react-native-screens" App.tsx index.ts src/ app.d.ts` 只命中 `app.d.ts:1` 的 `/// <reference types="nativewind/types" />`。

| 包（`frontend/package.json` 行） | 实际安装版本 | 状态 |
|---|---|---|
| `@react-navigation/native`、`@react-navigation/native-stack`（17-18） | 7.1.19 / 7.6.1 | 从未被导入 |
| `react-hook-form`（26）、`@hookform/resolvers`（15）、`zod`（35） | 7.65.0 / 5.2.2 / 3.25.76 | 从未被导入；表单全部是 `useState` + 手写校验 |
| `nativewind`（23）、`tailwindcss`（34） | 4.2.1 / 3.4.18 | 只有 `app.d.ts:1` 引用了类型；没有 `className`；`babel.config.js` 没有 `nativewind/babel` preset（30-37） |
| `react-native-gesture-handler`（28）、`react-native-reanimated`（29）、`react-native-screens`（31）、`react-native-worklets`（33） | 2.28.0 / 4.1.3 / 4.16.0 / 0.8.1（已安装） | 应用代码从未导入；reanimated 的 babel 插件只在可解析时才接入（`frontend/babel.config.js:6-14,27-29`）。第 30 行的 `react-native-safe-area-context` 不在此列——被 `App.tsx:3` 与 `Screen.tsx:9` 使用 |
| `@testing-library/react-native`（38）、`jest-expo`（45） | 13.3.3 / 55.0.13 | `jest.config.js` 与任何测试都没有引用 |

---

## 7. PWA

### 7.1 静态文件（`frontend/public/`，由 `expo export` 原样复制进 `dist/`）

`frontend/public/manifest.json:1-30`：

```json
{
  "$schema": "https://json.schemastore.org/web-manifest-combined.json",
  "name": "Wallet",
  "short_name": "Wallet",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0ea5e9",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`frontend/public/index.html:1-28` 是 HTML 模板：viewport `width=device-width, initial-scale=1, viewport-fit=cover`（6）、`<title>Wallet</title>`（7）、`<link rel="manifest" href="/manifest.json">`（8）、`theme-color #0ea5e9`（9）、`apple-mobile-web-app-capable=yes`、`apple-mobile-web-app-status-bar-style=default`、`apple-mobile-web-app-title=Wallet`、`<link rel="apple-touch-icon" href="/apple-touch-icon.png">`（10-13）、`mobile-web-app-capable=yes`（14）、Expo 的 `#expo-reset` 样式（15-19）、`<link rel="stylesheet" href="/pwa.css">`（20）、`<link rel="icon" href="/favicon.ico">`（21）、`<div id="root">`（25）。`expo export` 在末尾追加 `<script src="/_expo/static/js/web/index-<hash>.js" defer>`（`frontend/dist/index.html:27`）。

`frontend/public/pwa.css:4-6`：`input, select, textarea { font-size: 16px !important; }`，用于阻止 iOS Safari 聚焦时放大。

`frontend/public/offline.html:1-35`：自包含页面，标题 "You're offline — Wallet"，正文 "You're offline" / "Check your connection. Your data will load once you're back online."。

图标 `192.png`、`512.png`、`512-maskable.png`、`apple-touch-icon.png`、`favicon.ico` 由 `frontend/scripts/generate-icons.mjs` 从 `assets/adaptive-icon.png`（`frontend/scripts/generate-icons.mjs:30`）生成，背景为纯色 `#0ea5e9`（33）；192/512/180 按 100% 缩放，maskable 按 80%（104-110）；`.ico` 是手工拼装的 6 字节 ICONDIR + 16 字节 ICONDIRENTRY（共 22 字节）头，后接一个 PNG 编码的 32×32 帧（76-101）。

### 7.2 Service worker 生成（`frontend/workbox-config.cjs`，由 `npx workbox generateSW` 消费）

| 选项 | 值 | 行 |
|---|---|---|
| `globDirectory` | `dist/` | 26 |
| `globPatterns` | `**/*.{js,css,html,png,svg,jpg,jpeg,webp,woff,woff2,ico,json}` | 27 |
| `globIgnores` | `**/sw.js`、`**/workbox-*.js` | 28 |
| `swDest` | `dist/sw.js` | 29 |
| `skipWaiting` / `clientsClaim` / `cleanupOutdatedCaches` | 全部 `true` | 30-32 |
| `navigateFallback` | `/offline.html` | 33 |
| `navigateFallbackDenylist` | `[/^\/api/]` | 34 |
| `dontCacheBustURLsMatching` | `/\.[0-9a-f]{20,}\./`（Expo 的内容哈希文件名） | 35 |

`runtimeCaching` 按顺序（36-76）：

| 序号 | `urlPattern` | 处理器 | `cacheName` | 选项 |
|---|---|---|---|---|
| 1 | `url.pathname === '/'` 或 `'/index.html'` | `NetworkFirst` | `app-shell` | `networkTimeoutSeconds: 3` |
| 2 | `/\/api\//` | `NetworkFirst` | `api-cache` | `networkTimeoutSeconds: 5`，`cacheableResponse.statuses [0, 200]` |
| 3 | `/\.(?:woff2?、ttf、otf、eot)$/`（原文用竖线分隔） | `CacheFirst` | `fonts` | `maxAgeSeconds` 30 天 |
| 4 | `/\.(?:png、jpe?g、svg、webp、ico)$/`（原文用竖线分隔） | `CacheFirst` | `images` | `maxAgeSeconds` 30 天 |

### 7.3 生成出来的 `dist/sw.js` 实际内容（未跟踪的构建产物；`dist/` 在 `frontend/.gitignore:7`）

去掉压缩后的结构如下（来自当前 `frontend/dist/sw.js`）：

```js
self.skipWaiting(); e.clientsClaim();
e.precacheAndRoute([
  {url:"pwa.css",…},{url:"offline.html",…},{url:"metadata.json",…},{url:"manifest.json",…},
  {url:"index.html",revision:"b69b49fb…"},{url:"favicon.ico",…},{url:"apple-touch-icon.png",…},
  {url:"512.png",…},{url:"512-maskable.png",…},{url:"192.png",…},
  {url:"_expo/static/js/web/index-6b8f62b235df4cff10dc042e9ef97d75.js",revision:"6b8f62b2…"}
],{});
e.cleanupOutdatedCaches();
e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/offline.html"),{denylist:[/^\/api/]}));
e.registerRoute(({url:e})=>"/"===e.pathname||"/index.html"===e.pathname, new e.NetworkFirst({cacheName:"app-shell",networkTimeoutSeconds:3}),"GET");
e.registerRoute(/\/api\//, new e.NetworkFirst({cacheName:"api-cache",networkTimeoutSeconds:5,plugins:[CacheableResponsePlugin({statuses:[0,200]})]}),"GET");
e.registerRoute(/\.(?:woff2?|ttf|otf|eot)$/, new e.CacheFirst({cacheName:"fonts",…2592000 秒}),"GET");
e.registerRoute(/\.(?:png|jpe?g|svg|webp|ico)$/, new e.CacheFirst({cacheName:"images",…2592000 秒}),"GET");
```

预缓存包含整个壳：`index.html`、唯一的 JS bundle、CSS、图标、`manifest.json`、`offline.html`，以及 Expo 的 `metadata.json`（内容 `{"version":0,"bundler":"metro","fileMetadata":{}}`），共 11 个 URL。

### 7.4 由路由顺序决定的运行时行为

Workbox 按注册顺序匹配路由，而 `precacheAndRoute` 注册的预缓存路由排在最前面。由此（以下是依据上面 `sw.js` 的注册顺序和 Workbox 路由语义推导的结果，未做浏览器实测）：

* 对 `/`（或 `/index.html`）的导航由**预缓存**应答——包括冷启动离线的情况——所以应用壳能离线加载。`app-shell` 那条 `NetworkFirst` 路由永远看不到对 `/` 的导航请求（它只会匹配对这两个路径的非导航请求）。`frontend/workbox-config.cjs:10-12,38-40` 与 `frontend/src/pwa/registerSW.ts:12-13` 的注释把 NetworkFirst 描述为更新路径；在实际生成的 worker 里，新的壳是通过新 `sw.js` 安装时预缓存 revision 变化而到达的。
* 任何**其他**导航（例如手动输入 `/anything`）不在预缓存里，于是 `NavigationRoute` 的处理器返回预缓存的 `/offline.html`——即使当前在线。只有 `/api…` 开头的导航被 denylist 排除。因为应用从不改变 URL（§3.3），这只有手动输入路径时才会遇到。
* `/api/` 下的 `GET` 请求（`apiClient` 的全部读取：`/api/v1/auth/me`、`/finance-sources`、`/transactions`、`/rates/currencies`）在 200 后被写入 `api-cache`，网络失败或超过 5 秒时从缓存返回。缓存只按 URL 键控，登出时不会清除（`AuthContext.logout` 只动 AsyncStorage，`frontend/src/store/AuthContext.tsx:123-133`）。非 `GET` 请求从不缓存。

### 7.5 安装 / 更新行为

* 注册：`load` 事件后 `navigator.serviceWorker.register('/sw.js')`，成功打印 `[pwa] service worker registered`，失败 `console.warn` 后吞掉（`frontend/src/pwa/registerSW.ts:21-31`）。没有 `beforeinstallprompt` 处理，没有更新提示，没有 `controllerchange` 重载（通读 `src/` 验证）。
* 更新：新的构建产生新的预缓存清单；新 worker 立即 `skipWaiting()` 与 `clientsClaim()`；activate 阶段 workbox-precaching 删除新清单里不再引用的旧预缓存条目，`cleanupOutdatedCaches()` 额外删除由更早、不兼容版本 Workbox 建立的预缓存 cache（`dist/sw.js`；`frontend/workbox-config.cjs:32`）。当前已打开的页面继续运行旧 bundle，直到用户刷新；下一次导航/刷新从刷新后的预缓存拿到新的 `index.html` 与 bundle。
* 可安装性：`display: standalone`、`start_url: /`、192/512 `any` + 512 `maskable` 图标、`theme_color`、Apple meta 标签、经 Caddy 的 HTTPS（`infra/Caddyfile:5-6`，默认 `tls internal`）。

```
 [页面加载] ──register('/sw.js')──▶ [installing] ──预缓存 11 个 URL──▶ [skipWaiting]
      ▲                                                                   │
      │                                                                   ▼
 下一次刷新使用新的预缓存 ◀── [activated, clientsClaim, cleanupOutdatedCaches]
```

### 7.6 `frontend/scripts/verify-pwa.mjs`

用法：在 `frontend/` 下执行 `node scripts/verify-pwa.mjs --check=<name>` 或 `--all`（5-7）。加载随仓库携带的 SchemaStore manifest schema `frontend/scripts/w3c-manifest-schema.json`（17086 字节，draft-04），递归删除 `$schema` 并把 `id` 改名为 `$id`（44-58），用 Ajv `{ allErrors: true, strict: false, logger: false }` 编译（63-64）。`--all` 按以下顺序执行（207-213）：

| 检查名 | 断言 | 行 |
|---|---|---|
| `manifest` | `dist/manifest.json` 存在、能解析、通过 schema 校验；至少一个 icon 的 `purpose` 匹配 `\bmaskable\b` | 81-118 |
| `apple-meta` | `dist/index.html` 包含 `apple-mobile-web-app-capable`、`apple-mobile-web-app-status-bar-style`、`apple-mobile-web-app-title`、`apple-touch-icon`；`dist/apple-touch-icon.png` 存在 | 120-143 |
| `viewport` | `dist/index.html` 包含 `viewport-fit=cover` | 145-156 |
| `sw` | `dist/sw.js` 能被 `new Function(src)` 解析，且包含字面量 `NetworkFirst`、`CacheFirst`、`skipWaiting`、`clientsClaim`、`/api/`、`/index.html` | 158-187 |
| `ios-zoom` | `dist/pwa.css` 包含 `font-size: 16px` 且匹配 `/font-size:\s*16px\s*!important/` | 189-203 |

输出节奏：进入每一步在 stdout 打印 `==> <step>`；失败在 stderr 打印 `FAIL: <reason>` 后 `process.exit(1)`（70-77）；单项模式成功打印 `==> <name>: passed`（248）；`--all` 全部通过打印 `==> all pwa checks passed`（257）。

---

## 8. 构建与脚本

### 8.1 `package.json` 脚本（`frontend/package.json:5-13`）

| 脚本 | 命令 | 作用 |
|---|---|---|
| `start` | `expo start` | Metro 开发服务器 + 二维码/按键菜单（`w` 打开 Web） |
| `android` / `ios` | `expo start --android` / `expo start --ios` | 开发服务器并打开模拟器 |
| `web` | `expo start --web` | 浏览器开发服务器 `http://localhost:8081`；API 指向 `http://localhost:8000/api/v1`（`frontend/src/constants/config.ts:7`），依赖后端 CORS 白名单（§5.1） |
| `build:web` | 见 §5.1 | 切换到生产配置 → `expo export -p web`（写 `dist/`，复制 `public/`，把带哈希的 bundle 注入 `public/index.html`）→ `workbox generateSW`（写 `dist/sw.js`、`dist/workbox-<hash>.js` 及各自的 source map）→ 恢复开发配置 |
| `verify:phase5` | `npm run build:web && node scripts/verify-pwa.mjs --all && node scripts/verify-touch-targets.mjs && npm test` | 完整的确定性检查序列 |
| `test` | `jest` | 见 §9 |

### 8.2 `build:web` 的输出

输出目录是 `frontend/dist/`（`frontend/workbox-config.cjs:26,29`）；生产 compose 文件把它以只读方式挂载进 Caddy 容器的 `/srv`（`infra/docker-compose.prod.yml:74`），Caddy 用 `root * /srv`、`try_files {path} /index.html`、`file_server` 提供服务（`infra/Caddyfile:28-32`）。当前 `dist/` 内容：`192.png 512-maskable.png 512.png apple-touch-icon.png favicon.ico index.html manifest.json metadata.json offline.html pwa.css sw.js sw.js.map workbox-35f09345.js workbox-35f09345.js.map _expo/static/js/web/index-6b8f62b235df4cff10dc042e9ef97d75.js`。

`frontend/scripts/generate-icons.mjs` 没有接进任何 npm 脚本，需要手动运行 `cd frontend && node scripts/generate-icons.mjs`（`frontend/scripts/generate-icons.mjs:16`）。

### 8.3 `frontend/scripts/verify-touch-targets.mjs`

用法：`node scripts/verify-touch-targets.mjs [--check=<name> | --all]`，不带参数等同于 `--all`（10-13、354-357）。注册顺序（`frontend/scripts/verify-touch-targets.mjs:319-330`）：

| 检查名 | 规则 | 行 |
|---|---|---|
| `button-small-44` | `Button.tsx` 的 `small: { … }` 块内同时含 `minHeight: 44` 与 `minWidth: 44`（顺序不限） | 69-84 |
| `finance-form-spot-fix-44` | `FinanceSourceFormScreen.tsx` 含 `minHeight: 44` | 86-94 |
| `tx-form-spot-fix-44` | `TransactionFormScreen.tsx` 含 `minHeight: 44` | 96-104 |
| `profile-spot-fix-44` | `ProfileScreen.tsx` 含 `minHeight: 44` | 106-113 |
| `tx-amount-inputmode` | `TransactionFormScreen.tsx` 中 `inputMode="decimal"` 的出现次数等于 `keyboardType="decimal-pad"` 的次数，且都 ≥ 3 | 115-129 |
| `login-email-props` | `LoginScreen.tsx` 含 `keyboardType="email-address"` 与 `autoComplete="email"` | 131-144 |
| `register-email-props` | `RegisterScreen.tsx` 同上 | 146-159 |
| `screen-safe-area` | `Screen.tsx` 从 `react-native-safe-area-context` 导入，且没有从 `react-native` 解构 `SafeAreaView` | 161-186 |
| `app-safe-area-provider` | `App.tsx` 引用了 `SafeAreaProvider` 并从 `react-native-safe-area-context` 导入 | 188-202 |
| `all-touchables` | `src/**/*.tsx` 中每个 `<TouchableOpacity`、`<Pressable`、`<TouchableHighlight` 在 −200/+600 字符窗口内必须有行内 `style={{ … minHeight: 44 }}`，或引用一个块内含 `minHeight: 44` 的 `styles.<key>`（含数组形式 `style={[…]}`），或在同一行/上一行带 `// touch-target-exempt: <reason>` 注释 | 206-314 |

输出：`==> verify-touch-targets[<name>]: …`、`PASS: <name>`（stdout）或 `FAIL: <name> — <reason>`（stderr）；`--all` 有任何失败则退出码 1，否则打印 `==> all touch-target checks passed`（333-381）。文件头注释说明正则方法无法判断数组式样式冲突时谁生效（5-8）。当前 `src/` 下共有 18 处 `<TouchableOpacity`（没有 `Pressable`/`TouchableHighlight`），没有任何 `touch-target-exempt` 注释（grep 验证）。

### 8.4 仓库内文档与现状的差异

`frontend/README.md`（中文，118 行）与 `frontend/START.md`（中文，60 行）描述的是更早的状态：

| 文档陈述 | 现状 |
|---|---|
| 技术栈列出 NativeWind、React Navigation、React Hook Form + Zod（`frontend/README.md:50-53`） | 都没有使用（§6.3） |
| 项目树包含 `src/hooks/`（`frontend/README.md:35`） | 没有 `hooks/` 目录 |
| 生产 API 为 `https://api.yourapp.com/api/v1`（`frontend/README.md:61`） | 是 `/api/v1`（`frontend/src/constants/config.prod.ts:5`） |
| 用 `npx expo export:web` 构建到 `web-build/`（`frontend/README.md:102-104`） | 是 `npm run build:web` 到 `dist/`（`frontend/package.json:10`） |
| NativeWind `className` 示例（`frontend/README.md:65-79`） | 代码里没有任何 `className` |
| `frontend/START.md:6,15` 的路径 `/home/ubwzwd/Coding/side_projects/wallet_app/frontend` | 仓库在 `/home/ubwzwd/Code/wallet_app/frontend` |
| `frontend/START.md:53` "显示蓝色卡片：🎉 Wallet App" | 首屏是 Login/Register 标签视图（`frontend/src/components/Navigation.tsx:21-47`） |

---

## 9. 测试

### 9.1 框架与配置

* `jest` 30.3.0；顶层 `babel-jest` 29.7.0（在 transform 里显式点名，`frontend/jest.config.js:10`）；`@types/jest` 30；`jest-expo` 55.0.13 与 `@testing-library/react-native` 13.3.3 已安装但未使用。
* `frontend/jest.config.js:1-21`：`testEnvironment: 'node'`（5）；`setupFiles: ['<rootDir>/jest.setup.js']`（8），该文件只定义 `global.__DEV__ = true`（`frontend/jest.setup.js:11-13`）；transform 用 `babel-jest` 处理 `\.[jt]sx?$`，caller 为 `{ name: 'metro', bundler: 'metro', platform: 'ios' }`，`configFile: './babel.config.js'`（9-14）；`transformIgnorePatterns` 允许转换 RN/Expo 系列包（15-17）；`moduleNameMapper '^@/(.*)$' → '<rootDir>/src/$1'`（18-20）。文件头注释解释选用 node 环境是为了避开 `expo/winter` 与 `react-native-worklets` 的初始化失败（2-7）。
* 运行方式：`cd frontend && npm test`（或 `npx jest __tests__/Button.test.ts` 跑单个文件）。本次实际运行结果：`Test Suites: 5 passed, 5 total`，`Tests: 64 passed, 64 total`，耗时约 1.2 秒。

### 9.2 每个测试文件断言什么

五个测试文件都用 `fs.readFileSync` 读取源码文本再做字符串/正则断言；没有一个渲染组件。

| 文件 | describe 块 | 断言 |
|---|---|---|
| `frontend/__tests__/Button.test.ts` | "MOBUI-01: Button small size…"（20-32） | `Button.tsx` 匹配 `/small:\s*\{/`、`/small:\s*\{[^}]*minHeight:\s*44/s`、`/small:\s*\{[^}]*minWidth:\s*44/s` |
| `frontend/__tests__/CurrencyPicker.test.ts` | `rates.ts API module`（28-44）：导出 `getCurrencies`，包含 `/rates/currencies`、`CurrencyList`、`apiClient`。`CURR-01`（48-68）：`TransactionFormScreen.tsx` 包含 `QUERY_KEYS.CURRENCIES`、`ratesApi.getCurrencies`、`staleTime: Infinity`、`from '@/api/rates'`，且不包含 `const CURRENCIES = [`。`CURR-02`（72-88）：对 `FinanceSourceFormScreen.tsx` 做前四项。`CURR-03`（92-130）：TransactionForm 包含 `Platform.OS === 'web'`、`<Modal`、`<FlatList`、`Select Currency`、`Close`、`#eff6ff`；FinanceForm 包含 `<Modal`、`Select Currency`、`Platform.OS === 'web'` | 字面量 `toContain` |
| `frontend/__tests__/FinanceSourcesScreen.test.ts` | "BUG-03"（15-35） | `FinanceSourcesScreen.tsx` 包含 `Alert.alert('Error'`、`window.alert(`、`Platform.OS === 'web'`、`Failed to update finance source`，以及从 `'react-native'` 导入 `Alert` 的 import 语句 |
| `frontend/__tests__/TransactionFormScreen.test.ts` | `XFER-03`（21-33）：不含 `Transfer support coming soon`；含 `Add another finance source to enable transfers.` 与 `sources.length <= 1`。`XFER-01`（37-65）：`Step 1 of 2`、`Step 2 of 2`、`destinationSourceId`、`Select Destination`、`Next`、`Back`、`Create Transfer`。`XFER-02`（69-93）：`crypto.randomUUID()`、`transfer_pair_id`、`-absAmount`、`deleteTransaction`、`Transfer partially created`、`Transfer created successfully!`。`D-10/D-11`（97-121）：`Update Transfer`、只读提示文案、`getQueryData`、`updateTransaction(pairedLeg.id`、`Transfer updated successfully!`、`getTransactions()` | 字面量 `toContain` |
| `frontend/__tests__/TransactionsScreen.test.ts` | "BUG-02 … static"（17-57）：导入 `Alert`，包含 `Alert.alert(title, message,`、`style: 'destructive'`、`style: 'cancel'`、`Keep Transaction`、`Delete Transaction`、`Keep Transfer`、`Delete Transfer`、`deleteMutation.mutate`、`Platform.OS === 'web'`。"BUG-02 … (unit)"（59-117）：用 `jest.requireActual('react-native')` 取 `Alert`，`jest.spyOn(Alert, 'alert')`，在测试里**重新写一遍**标签逻辑后断言 `toHaveBeenCalledWith` | unit 块测的是测试文件内部的副本，不是页面代码 |

没有测试覆盖 `AuthContext`、API 客户端或任何渲染路径。

---

## 10. i18n 与无障碍现状

**i18n：没有。** 所有界面文案都是 JSX 里的英文字面量（例如 `frontend/src/screens/HomeScreen.tsx:144`、`frontend/src/screens/LoginScreen.tsx:57-58`、`frontend/src/screens/TransactionFormScreen.tsx:398,527`）。没有安装任何 i18n 库（`frontend/package.json:14-36`），`grep -rni "i18n\|useTranslation" src/` 无命中。与区域相关的格式化是零散的：`toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`（`frontend/src/screens/TransactionsScreen.tsx:93`）、设备区域的 `toLocaleDateString()`（`frontend/src/screens/ProfileScreen.tsx:90`）、金额用 `toFixed(2)` 并在前面拼币种代码（`frontend/src/screens/TransactionsScreen.tsx:77`）、汇率用 `toFixed(4)`（148）。`<html lang="en">` 固定在 `frontend/public/index.html:2`。开发者文档（`README.md`、`START.md`）是中文。

**无障碍：只有副作用带来的部分覆盖。**

* 任何地方都没有 `accessibilityLabel`、`accessibilityRole`、`accessibilityHint`、`accessible`、`aria-*` 或 `testID`（对 `App.tsx` 与 `src/` 的 grep 无命中）。
* 只有 emoji 的控件没有文字替代：密码显隐 `👁️`（`frontend/src/components/Input.tsx:51-53`）；类型按钮 `💸/💰/🔄` 与首页快捷按钮的标题里含有文字（`frontend/src/screens/TransactionFormScreen.tsx:367-381`；`frontend/src/screens/HomeScreen.tsx:165-177`）。
* 触控目标：44 像素下限由 `Button` 基础样式（`frontend/src/components/Button.tsx:75`）、`small` 尺寸（92-97）、密码显隐（`frontend/src/components/Input.tsx:100-101`）、币种触发按钮与关闭按钮（`frontend/src/screens/ProfileScreen.tsx:286-299`；`frontend/src/screens/FinanceSourceFormScreen.tsx:327-340`；`frontend/src/screens/TransactionFormScreen.tsx:958-971`）保证，并由 `verify-touch-targets.mjs` 校验（§8.3）。
* Web 上的表单语义只来自 react-native-web 的默认输出和原生 `<select>`/`<input type="date">`（§1.5）；`Input` 的标签是独立的 `Text` 节点，没有通过 `for`/`id` 关联。
* 邮箱字段有 `keyboardType="email-address"`、`autoComplete="email"`、`autoCapitalize="none"`（`frontend/src/screens/LoginScreen.tsx:70-72`；`frontend/src/screens/RegisterScreen.tsx:106-108`）；金额字段有 `keyboardType="decimal-pad"` + `inputMode="decimal"`（`frontend/src/screens/TransactionFormScreen.tsx:538-539,632-633,732-733`）。
* iOS 放大抑制通过 `pwa.css`（§7.1）；安全区处理通过 `SafeAreaProvider`/`SafeAreaView`（`frontend/App.tsx:38`；`frontend/src/components/Screen.tsx:25`）。
* 收入/支出的区分信号是颜色（`#10b981` / `#ef4444`，`frontend/src/screens/TransactionsScreen.tsx:74`），同时也打印了 `+`/`-` 符号（73）。没有深色模式，没有减少动效的处理，除输入框边框外没有焦点样式（`frontend/src/components/Input.tsx:86-89`）。

---

## 另见

* [./README.md](./README.md) — 全局索引与阅读顺序
* [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域概念与端到端流程（转账双腿、换算字段的含义）
* [./03-backend-api.md](./03-backend-api.md) — 本文引用的每个端点的完整定义、状态码与错误文案
* [./05-infra-and-ops.md](./05-infra-and-ops.md) — Caddy、docker compose、`dist/` 的部署方式与运维脚本
