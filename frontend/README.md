# Wallet · 前端

Expo（React Native + Web）+ TypeScript + **Expo Router**。主力形态是 **Web PWA**，同一套代码也能跑在 iOS / Android 上（本阶段不发原生包）。

设计文档在 `docs/target-design/`，其中 [`04-frontend.md`](../docs/target-design/04-frontend.md) 是前端规格，[`00-decisions.md`](../docs/target-design/00-decisions.md) 是最终裁定；两者冲突时以 `00` 为准。

---

## 快速开始

```bash
cd frontend
npm ci          # 安装依赖（node_modules 不入库）
npm run web     # 开发服务器，浏览器打开 http://localhost:8081
```

后端默认指向 `http://localhost:8000/api/v1`，先把 `backend/` 跑起来（见 `backend/README.md`）。

其它平台：

```bash
npm start        # 显示 QR 码，用 Expo Go 扫码
npm run android  # Android 模拟器
npm run ios      # iOS 模拟器（需要 macOS）
```

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run web` | `expo start --web`，开发服务器 |
| `npm run build:web` | `EXPO_PUBLIC_API_BASE_URL=/api/v1 expo export -p web` 产出 `dist/`，再用 `workbox generateSW` 生成 `dist/sw.js` |
| `npm test` | Jest（`jest-expo` preset + Testing Library） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | typecheck → test → build:web → `verify-pwa` → `verify-touch-targets`，提交前跑这一条 |

单独跑某一组测试：`npx jest src/screens/home`。

`dist/` 与 `node_modules/` 都不入库（见 `.gitignore`）。

---

## 配置

只有一个构建期变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | 后端 API 根地址。生产构建由 `build:web` 设成 `/api/v1`（同源，Caddy 反代）。原生模拟器不能用相对地址，所以默认值是绝对的。 |

`EXPO_PUBLIC_` 前缀的变量由 Expo 在打包时内联进 bundle，读取处在 `src/constants/config.ts`。**没有** `config.prod.ts` / `config.dev.ts` 这类会被覆盖的文件（04 §7.2）。

---

## 目录结构

```text
frontend/
  app/                     # Expo Router 的路由树，每个文件都是薄壳：
                           #   export { default } from '@/screens/<area>/<Screen>'
    _layout.tsx            #   根布局：主题 / i18n / QueryClient / Auth / Toast / 确认框
    (auth)/                #   登录、注册
    (app)/                 #   需要登录的一切，全部是 _layout.tsx 那一个 Slot 的直接子路由（没有嵌套导航器）
      home.tsx             #     首页 /home
      transactions/        #     交易列表、记一笔、详情与编辑 /transactions*
      transfers/           #     两腿转账详情与编辑 /transfers/:pairId*
      imports/             #     导入历史、上传、格式说明、批次 /imports*
      ledger.tsx           #     当前账本的设置 /ledger
      settings.tsx         #     个人设置 /settings
      accounts/            #     本人的账户列表与表单 /accounts*
      ledgers/             #     零账本引导 / 新建 / 加入 /ledgers*
  src/
    api/                   # axios 客户端、类型（对齐 03-backend-api.md §5）、各 xxxApi
    constants/             # 构建期配置
    domain/                # 纯函数：金额、四种 kind、转账、净值、路由表、筛选的规范化
    i18n/                  # i18next 初始化、格式化、错误码文案、zh / en 语言包
    navigation/            # 路由守卫、AppShell、侧栏 / 底部 tab / 顶栏
    pwa/                   # service worker 注册（仅生产 Web）
    queries/               # TanStack Query 的 hooks 与失效策略
    screens/               # 页面组件与它们私有的子组件
    store/                 # AuthContext、当前账本（CurrentLedgerProvider）、浏览状态（ViewStateProvider）
    test/                  # 测试专用：renderWithProviders / mockApi / fixtures
    theme/                 # 设计 token（由 tokens.json 生成）、ThemeProvider
    ui/                    # 组件库（Button / TextField / Card / 各种选择器 / 图表…）
  public/                  # PWA 静态资源：manifest.json、index.html、pwa.css、图标
  scripts/                 # gen-tokens / generate-icons / verify-pwa / verify-touch-targets
  workbox-config.cjs       # service worker 生成配置
```

写页面时的几条硬约定（完整版见 04 §3、§6）：

- 数据只走 `src/queries` 的 hooks，写操作成功后的缓存失效由 hooks 负责。
- 每一个字都来自语言包（`useTranslation('<ns>')`），包括 Toast、确认框、空态和 `accessibilityLabel`。
- 不允许字面量色值，颜色一律 `useColors()['<token>']`；页面里不出现 `Platform.OS`（`npm run verify` 会 grep）。
- 表单用 `react-hook-form` + `zod`，校验文案的 key 在 `validation` 命名空间。
- 窄 / 宽屏用 `useIsWide()`，窄屏的筛选与选择器用 `Sheet`。

---

## 设计 token

`src/theme/tokens.ts` 是**生成文件**，源头是 `docs/target-design/mockups/tokens.json`：

```bash
node scripts/gen-tokens.mjs           # 重新生成
node scripts/gen-tokens.mjs --check   # 校验是否与 tokens.json 一致
```

`public/manifest.json`、`public/index.html`、`app.json`、`scripts/generate-icons.mjs` 里的颜色也取自同一份 token（`accent.solid` `#2F4A38`、`bg.canvas` `#F1F6F1`）——它们是 JSON / HTML / 脚本，不受「组件里无字面量色值」的约束，但改动时要一起改。

图标（`public/192.png` 等）由 `node scripts/generate-icons.mjs` 生成，改了品牌色才需要重跑。

---

## PWA

- `public/manifest.json` + `public/index.html`（`viewport-fit=cover`、apple 系列 meta）+ `public/pwa.css`（输入框 16px，防 iOS 聚焦缩放）。
- `npm run build:web` 的第二步用 `workbox-config.cjs` 生成 `dist/sw.js`：
  - 导航回落到 `/index.html`（深链接是核心功能，刷新 `/transactions/<id>` 必须拿到应用本体）；
  - `GET /api/v1/categories`、`/api/v1/import-format`、`/api/v1/rates/currencies` 走 `CacheFirst`（30 天），**其余 `/api/` 一律 `NetworkOnly`**——账本数据是多人共享的，读到别人改过的旧数据比报错更糟；
  - `offline.html` 仍在预缓存里，但只在应用本体也缺失时兜底。
- `src/pwa/registerSW.ts` 只在生产 Web 注册 worker；新 worker 接管（`controllerchange`）时由 `src/navigation/useSwUpdateToast.ts` 弹一条「刷新以使用新版本」。

校验：

```bash
npm run build:web
node scripts/verify-pwa.mjs --all              # manifest / apple-meta / viewport / sw / ios-zoom
node scripts/verify-touch-targets.mjs          # 触控目标与输入法属性
```

---

## 测试

- `jest-expo` preset，`@testing-library/react-native`，路由相关用 `expo-router/testing-library` 的 `renderRouter`。
- 统一入口是 `src/test/renderWithProviders`（**async**）+ `mockApi()`（`axios-mock-adapter`）+ `src/test/fixtures`。
- 断言行为——发出的请求、URL、渲染出来的文案——不做快照。
- `src/__tests__/app-flow.test.tsx` 是贯穿整棵真实路由树的集成测试：匿名深链接 → 登录 → 首页 → 交易列表 → 记一笔。

---

## 部署

`npm run build:web` 产出的 `dist/` 交给 Caddy 托管（未知路径回落 `index.html`，`/api/*` 反代到后端），见 `infra/Caddyfile`。
