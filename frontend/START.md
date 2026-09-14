# 怎么把前端跑起来

完整说明在 [`README.md`](./README.md)，这里只讲「从零到能点」。

---

## 1. 装依赖

`node_modules/` 不入库，第一次拿到仓库要先装：

```bash
cd frontend
npm ci
```

`npm ci` 严格按 `package-lock.json` 装，比 `npm install` 稳。**不要**手改 `package.json` / `package-lock.json` 来绕过报错。

## 2. 先起后端

前端默认调 `http://localhost:8000/api/v1`。按 `backend/README.md` 把后端跑起来，否则登录页会一直报网络错误。

想指向别的后端：

```bash
EXPO_PUBLIC_API_BASE_URL=https://example.com/api/v1 npm run web
```

## 3. 起前端

```bash
npm run web
```

浏览器打开 `http://localhost:8081`。第一次会停在登录页；没有账号就点「注册」（后端 `GET /config` 的 `registration_open` 要是 `true`）。

其它平台：`npm start` 显示 QR 码，用 Expo Go 扫；`npm run ios` / `npm run android` 起模拟器。

---

## 改完代码之前

```bash
npm run typecheck   # tsc --noEmit
npm test            # 全部测试
npm run verify      # typecheck + test + build:web + 两个校验脚本，提交前跑这一条
```

只想跑一部分测试：

```bash
npx jest src/screens/home        # 一个目录
npx jest --silent -t '拆开'       # 按用例名
```

## 出构建产物

```bash
npm run build:web
```

产出在 `dist/`（不入库），里面包含 `expo export -p web` 的 bundle 和 `workbox generateSW` 生成的 `dist/sw.js`。本地起个静态服务器看效果：

```bash
npx serve dist        # 注意：service worker 需要 http://localhost 或 https
```

---

## 故障排除

### 端口 8081 被占用

```bash
lsof -i :8081
kill -9 <PID>
```

### 改了代码没生效 / Metro 缓存脏了

```bash
npx expo start --clear
```

### 依赖装坏了

```bash
rm -rf node_modules
npm ci
```

### 浏览器里加载的一直是旧版本

生产构建注册了 service worker（开发模式不注册）。开发者工具 → Application → Service Workers → Unregister，再硬刷新。

### 测试超时 / 偶发失败

Testing Library 的 `asyncUtilTimeout` 在 `jest.setup.js` 里已经提到 10 秒。并行跑仍然抖的话，单独跑那一个文件确认是不是真失败。
