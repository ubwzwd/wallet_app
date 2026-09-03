# 06 — 已知问题与缺口清单（Known Issues）

> 本文回答的问题：**这个仓库现在有哪些已经核实的缺陷、不一致和未实现项？每一条在代码里的证据在哪里？它对用户、数据和运维分别意味着什么？** 本文只记录现象、证据和影响，不提改法。所有条目都在 2026-09-03 对着工作树核实过行号（分支 `docs/current-design`，基于 `main` 的 `56881b2`）；文中所有路径相对仓库根目录 `/home/ubwzwd/Code/wallet_app`。

---

## 0. 阅读说明

### 0.1 严重程度的含义

| 等级 | 判定标准 |
|---|---|
| 高 | 会造成数据错误或丢失、安全暴露，或者核心功能在常规使用路径上直接不可用 |
| 中 | 用户或运维可感知的功能缺陷、运维缺口；有绕过办法或影响范围有限 |
| 低 | 代码、依赖、文档层面的不一致与残留；不直接改变当前运行行为，但会误导读者或埋下隐患 |

### 0.2 核实方式

| 方式 | 说明 |
|---|---|
| 静态阅读 | 每条引用都用 `grep -n` 或 `sed -n` 在工作树里核对过行号 |
| 进程内驱动（in-process） | 用本机系统 Python 3.12.3 + `fastapi.testclient.TestClient` 驱动真实的 `app.main:app`，数据库为内存 SQLite，`EXCHANGE_RATE_API_URL` 指向不可达地址。注意本机安装的是 fastapi 0.135.3 / starlette 1.0.0 / bcrypt 3.2.2，**不是** `backend/poetry.lock` 锁定的 0.109.2 / 0.36.3 / 5.0.0；凡是依赖版本的结论都单独注明 |
| Docker 校验 | Docker 28.5.1 + 本地 `caddy:alpine` 镜像跑 `caddy validate` / `caddy adapt` |
| 网络探测（live probe） | `curl -sI` 探测 Frankfurter 两个主机 |
| `wallet_dev.db` 只读打开 | `sqlite3` 模块以 `mode=ro` 打开 `backend/wallet_dev.db` 查表和计数 |

### 0.3 编号规则

`H-xx` 为高，`M-xx` 为中，`L-xx` 为低。低严重程度条目按领域分表列出。同一根因引起的多个现象合并成一条，并在"现象"里分点写。

### 0.4 总览

| 编号 | 标题 | 等级 |
|---|---|---|
| H-01 | 转账非原子、服务端不做任何配对校验，编辑一条腿不保证同步另一条 | 高 |
| H-02 | 两套互相矛盾的汇率公式；始终用"当天"汇率；`conversion_date` 是服务器日期 | 高 |
| H-03 | 代码默认的 Frankfurter 主机已 301 跳转，默认配置下所有换算字段静默为 `null` | 高 |
| H-04 | Web 端 `Alert.alert` 是空操作：无法登出，多处错误无任何提示 | 高 |
| H-05 | 令牌过期后客户端状态失步：存储被清空但界面仍停留在已登录页 | 高 |
| H-06 | 前端提供 `cash` / `investment` 两种账户类型，后端拒绝（422），Web 端无提示 | 高 |
| H-07 | 列表接口返回裸数组、无总数；前端固定 `limit=50` 且无翻页，第 51 条以后不可见 | 高 |
| H-08 | `SECRET_KEY` 有公开默认值且无任何校验；模板声称的"缺失会大声失败"不成立 | 高 |
| H-09 | Caddy 环境变量语义与 RUNBOOK 冲突：按 RUNBOOK 操作拿不到 Let's Encrypt 证书，且会让 Caddy 起不来 | 高 |
| M-01 | 同一请求内重复标签（归一化后相同）→ 500；标签超过 64 字符在 PostgreSQL 上 → 500 | 中 |
| M-02 | Service Worker 的 `navigateFallback` 指向 `offline.html`，在线时访问非根路径也显示离线页 | 中 |
| M-03 | 已归档账户仍可新建交易、仍可被设为默认账户 | 中 |
| M-04 | `tenacity` 重试装饰器永远不会生效；README 宣称的"自动重试"不存在 | 中 |
| M-05 | `AuthContext.isLoading` 在每次登录/注册/登出时卸载整棵 `Navigation` 树 | 中 |
| M-06 | 422 校验错误在前端显示为 `[object Object]`；前后端密码长度规则不一致（6 vs 8） | 中 |
| M-07 | 日期按 UTC 日历日默认、按本地时区显示，负时差地区会差一天 | 中 |
| M-08 | 登出不清 React Query 缓存和 Service Worker 的 `api-cache`，同一设备的下一个用户能看到上一个用户的数据 | 中 |
| M-09 | `smoke.sh` 探测的健康路径不存在，`full` 模式永远跑不绿；`trap` 在任何模式下都会 `down -v` | 中 |
| M-10 | Caddy 无请求体大小限制、无超时、无访问日志；HSTS 在 `localhost` 上也无条件下发 | 中 |
| M-11 | 锁定的 starlette 0.36.3 / python-multipart 0.0.6 版本过旧；基础镜像标签浮动、依赖导出不带哈希 | 中 |
| M-12 | 没有备份、没有 CI、没有监控告警、没有回滚手段；镜像只有一个可变标签 | 中 |
| M-13 | 没有刷新令牌、没有服务端注销、没有登录限速或锁定 | 中 |
| M-14 | 交易表单直接渲染 DOM `<select>` / `<input type="date">` 并调用 `crypto.randomUUID()`，实际上只能在 Web 上用 | 中 |
| M-15 | 测试套件对本地 `.env` 敏感、部分测试引用未导入的 `pytest`、大量测试只是源码字符串匹配 | 中 |
| M-16 | `jest` 30 与 `jest-expo` 55 与 Expo SDK 54 不匹配，`jest-expo` 预设实际没被使用 | 中 |
| L-xx | 见第 3 节各表 | 低 |

---

## 1. 高严重程度

### H-01 转账非原子、服务端不做任何配对校验，编辑一条腿不保证同步另一条

#### 现象

1. 一笔转账（transfer）在服务端没有任何专门的表示或端点：它就是两条普通交易，共用一个由**客户端**生成的 `transfer_pair_id`。前端先 `POST /api/v1/transactions` 写出账腿（`amount = -abs`），再 `POST` 一次写入账腿（`amount = +abs`）。
2. 第二次 `POST` 失败时，前端尝试 `DELETE` 第一条；如果 `DELETE` 也失败，第一条就永久残留，界面只弹出一句"Transfer partially created…please check your transactions and delete manually"。
3. 两次 `POST` 之间存在一个窗口：任何列表刷新都能看到只有一条腿的转账（带"Transfer"徽标）。
4. 服务端对 `transfer_pair_id` 只是原样存储：不检查该 id 是否已被使用、是否恰好两条、金额是否相反相等、币种日期是否一致、两条腿是否来自不同账户。单独 `POST` 一条带 `transfer_pair_id` 的交易返回 201（进程内验证）。
5. 编辑转账时前端先 `PATCH` 当前腿，再从 React Query 缓存 `['transactions']` 里找另一条腿；缓存为空时改为再请求一次 `GET /transactions`（不带参数，服务端默认 `limit=50`）。两种来源都最多只有最近 50 条记录，配对腿不在其中就静默只改一条并照样提示成功；第二个 `PATCH` 失败时第一个已提交，没有回滚。
6. 删除任一条腿时，服务端用一条 `DELETE ... WHERE transfer_pair_id = ? AND user_id = ?` 删掉该用户名下所有同 id 的行，`deleted_count` 是实际匹配数（1、2 或更多）。

#### 证据

- 两次顺序 `POST` 与回滚逻辑：`frontend/src/screens/TransactionFormScreen.tsx:161-234`（`handleTransferSubmit`），其中 `pairId = crypto.randomUUID()` 在 `:164`，第一腿 `:180-184`，第二腿 `:197-201`，回滚 `DELETE` 在 `:214`，部分失败提示在 `:215-225`。
- 编辑转账：`frontend/src/screens/TransactionFormScreen.tsx:236-294`（`handleTransferUpdate`），当前腿 `PATCH` 在 `:249-255`，缓存查找 `:258-264`，配对腿 `PATCH` 在 `:266-275`；缓存来源是 `frontend/src/screens/TransactionsScreen.tsx:19-25`（固定 `limit=50`）。
- 服务端原样存储 `transfer_pair_id`：`backend/app/api/transactions.py:91-100`；`create_transaction` 全函数（`:52-141`）没有任何与配对相关的检查；`transfer_pair_id` 不在 `TransactionUpdate` 里，创建后不可改：`backend/app/schemas/transaction.py:57-86`。
- 列上无外键、无唯一约束：`backend/app/models/transaction.py:24`。
- 成对删除：`backend/app/api/transactions.py:447-459`。
- `SPEC.md:60` 声称会自动打上保留标签 `transfer`，代码里不存在（`grep -rn "'transfer'" backend/app frontend/src` 只命中前端的 `TransactionType` 字面量）。

#### 影响

- 数据：网络抖动、令牌过期（H-05）或第二个账户被并发归档等情况都会留下"单腿转账"，账本从此不平；用户看到的是带"Transfer"徽标却只有一边的记录，删除它只会删掉自己。
- 数据：编辑转账时若另一条腿不在最近 50 条内，两条腿的金额/日期/描述会永久分叉，界面仍提示"Transfer updated successfully!"。
- 用户：任何直接调 API 的客户端都能造出任意数量共用一个 `transfer_pair_id` 的行，之后一次删除会一起删掉。

### H-02 两套互相矛盾的汇率公式；始终用"当天"汇率；`conversion_date` 是服务器日期

#### 现象

1. 单条路径（`POST /transactions`、`GET /transactions/{id}`、`PATCH /transactions/{id}`）由 `_build_conversion_fields` 计算：先 `convert_amount(amount, tx_currency, base)`（内部请求 `from=tx&to=base`，`converted = amount × rate`，量化到 4 位小数），再**第二次**请求同一对币种拿 `conversion_rate`（不量化）。
2. 列表路径（`GET /transactions`）只请求一次 `from=base&to=[页内所有币种]`，方向相反，因此 `converted = amount / rate`（4 位），`conversion_rate = 1 / rate`（6 位）。
3. 同一条交易在两条路径下 `converted_amount` 末位和 `conversion_rate` 的精度都不同（Frankfurter 两个方向各自四舍五入）。
4. 无论 `occurred_at` 是哪天，两条路径都取 Frankfurter 的 `/latest`；Frankfurter 返回体里的 `date` 被丢弃，`conversion_date` 一律填服务器进程的 `date.today()`（容器本地日期）。历史汇率从未实现，`exchange_rates` 表已在迁移中删除。
5. `/api/v1/rates/latest` 和 `/api/v1/rates/convert` 的 `date` 字段同样是 `date.today()`。

#### 证据

- 单条路径：`backend/app/api/transactions.py:20-46`（`:39` 调 `convert_amount`，`:41-42` 再次 `fetch_latest_rates`，`:43` 返回 `date.today()`）；乘法与量化在 `backend/app/services/rates.py:127-139`。
- 列表路径：`backend/app/api/transactions.py:217-235`（一次批量请求，方向 base → tx）与 `:248-255`（`tx.amount / rate`、`Decimal("1") / rate`、`date.today()`）。
- 丢弃上游 `date`：`backend/app/services/rates.py:89-93` 只读 `data.get("rates")`。
- `/rates/*` 的日期：`backend/app/api/rates.py:54-61`、`:96-104`。
- 历史汇率表已删：`backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py`；`SPEC.md:66-67` 明确写着"latest available rate at query time"，历史汇率是"Future"。
- 代码地图写错了方向：`.planning/codebase/ARCHITECTURE.md:170-171` 说列表路径是 `amount * rate`，且调用的是不存在的 `rates.service.fetch_rate`。

#### 影响

- 数据：同一条记录在"新建成功后的响应"和"列表"里显示不同的换算金额与汇率；用户无法用 `converted_amount` 做任何对账。
- 数据：`conversion_date` 不是汇率日期，也不是交易日期，只是"谁在什么时候看了这条记录"；一年前的交易今天看是今天的汇率，明天看又是明天的。
- 运维：单条路径每次访问打两次上游请求，列表路径每页一次；没有任何缓存（见 L-B-07）。

### H-03 代码默认的 Frankfurter 主机已 301 跳转，默认配置下所有换算字段静默为 `null`

#### 现象

1. `Settings.EXCHANGE_RATE_API_URL` 的代码默认值和 `backend/env.example` 模板都是 `https://api.frankfurter.app`；生产模板 `infra/.env.example` 和本机（被 gitignore 的）`backend/.env` 用的是 `https://api.frankfurter.dev/v1`。
2. 2026-09-03 实测：`curl -sI "https://api.frankfurter.app/latest?from=USD&to=EUR"` 返回 `HTTP/2 301`，`location: https://api.frankfurter.dev/v1/latest?from=USD&to=EUR`；`https://api.frankfurter.dev/v1/latest?...` 返回 `HTTP/2 200`。
3. 服务端用模块级 `httpx.get(url, params=..., timeout=10.0)`，httpx 默认不跟随重定向，随后 `response.raise_for_status()` 对 3xx 同样抛 `httpx.HTTPStatusError`，被捕获后变成 `HTTPException(503)`。
4. 交易路由把任何 `HTTPException` 吞掉，三个换算字段全部返回 `null`，HTTP 状态仍是 200/201；没有任何日志。

#### 证据

- 默认值：`backend/app/core/config.py:28`；开发模板 `backend/env.example:18`；生产模板 `infra/.env.example:28`。
- 请求与错误映射：`backend/app/services/rates.py:79-99`（`:86-87` 请求并 `raise_for_status`，`:95-99` 映射为 503）。
- 吞掉异常：`backend/app/api/transactions.py:44-46`（单条）、`:234-235`（列表）。
- `SPEC.md:118` 与 `.planning/codebase/*` 仍写 `api.frankfurter.app`。

#### 影响

- 用户：按 `backend/README.md` / `README.md` 的步骤 `cp env.example .env` 起后端，多币种换算这一核心功能整体失效，界面上只是不显示"In USD"那一行，没有任何错误。
- 运维：`/health` 不探测上游，任何监控都看不出来；只有直接调 `/api/v1/rates/latest` 才会得到 503。

### H-04 Web 端 `Alert.alert` 是空操作：无法登出，多处错误无任何提示

#### 现象

1. 安装的 react-native-web 0.21.2 把 `Alert` 实现为 `class Alert { static alert() {} }`，在浏览器里什么都不做，也不会调用回调。
2. `HomeScreen` 的"Logout"按钮唯一动作就是 `Alert.alert(...)`，真正的 `logout()` 挂在对话框的"Logout"按钮回调里；`HomeScreen` 里没有任何 `Platform.OS` 分支。Web 用户点"Logout"没有任何反应。
3. 同样没有平台分支、只用 `Alert.alert` 反馈的还有：登录失败（`LoginScreen`）、注册成功/失败（`RegisterScreen`）、创建/编辑资金账户的成功与失败（`FinanceSourceFormScreen`）。其中 `FinanceSourceFormScreen` 的失败分支在 Web 上完全无声（H-06 的 422 就落在这里）。
4. `SPEC.md:608` 声称 React Native Web 会回退到浏览器 confirm，实际库代码不是这样。

#### 证据

- `frontend/node_modules/react-native-web/dist/exports/Alert/index.js`（整个文件只有空方法）。
- `frontend/src/screens/HomeScreen.tsx:20-39`（`handleLogout`）、`:185-190`（按钮）；文件只从 `react-native` 引入了 `Alert`，没有 `Platform`（`:2`）。
- `frontend/src/screens/LoginScreen.tsx:45`；`frontend/src/screens/RegisterScreen.tsx:73`、`:77`；`frontend/src/screens/FinanceSourceFormScreen.tsx:44`、`:48`、`:58`、`:62`。
- 有平台分支的对照组：`frontend/src/screens/FinanceSourcesScreen.tsx:36-43`、`:51-71`；`frontend/src/screens/TransactionsScreen.tsx:53-66`；`frontend/src/screens/ProfileScreen.tsx:64-77`。
- `SPEC.md:608`。

#### 影响

- 用户（Web，也就是唯一已交付的形态）：没有任何办法主动退出登录；共享电脑上只能手动清 localStorage 或等 30 分钟令牌过期后刷新页面（H-05）。
- 用户：登录密码错、注册邮箱重复（这条有内联提示）、创建账户失败时，Web 上要么表单被重置、要么什么都不发生，用户不知道操作是否成功。

### H-05 令牌过期后客户端状态失步：存储被清空但界面仍停留在已登录页

#### 现象

1. JWT 有效期 30 分钟，没有刷新机制；每个请求直接从 AsyncStorage 读令牌带上。
2. 过期后第一个受保护请求返回 401；axios 响应拦截器在"不是 `GET /auth/me`"的情况下删除 `@wallet_app:auth_token` 和 `@wallet_app:user_data`，注释写着"Navigation will be handled by AuthContext"，但 `AuthContext` 没有任何东西监听存储或拦截器，`user` 仍非空，`isAuthenticated` 仍为 `true`，`HomeScreen` 继续显示。
3. 之后每个请求都不再带 `Authorization` 头，被 `HTTPBearer` 直接拒绝（锁定的 FastAPI 0.109.2 返回 403 `Not authenticated`；本机的 0.135.3 返回 401，见第 5 节）。列表页没有错误 UI，只会一直显示旧缓存或空列表；写操作在 Web 上弹 `window.alert`。
4. 唯一恢复方式是刷新页面让 `loadUser` 发现没有令牌；Web 上的 Logout 按钮又是空操作（H-04）。
5. 相反方向也有问题：应用离线启动时 `loadUser` 的 `GET /auth/me` 因网络错误抛出，同一个 `catch` 会清掉本来仍有效的令牌并登出。

#### 证据

- 拦截器：`frontend/src/api/client.ts:43-64`（`:56-63` 清存储与注释）。
- `AuthContext` 只在 `:51`、`:81`、`:108`、`:141` 设置 `user`，只在 `:60`、`:127` 清空；`frontend/src/store/AuthContext.tsx:36-64`（`loadUser`，`:56-60` 是离线也清令牌的 `catch`）。
- 切换依据：`frontend/src/components/Navigation.tsx:17-19`（`isAuthenticated`）与 `AuthContext.tsx:152`（`!!user`）。
- 过期时间：`backend/app/core/config.py:17`；`backend/app/core/security.py:53-58`。
- 列表页无错误 UI：`frontend/src/screens/TransactionsScreen.tsx:22-25` 只解构 `data / isLoading / refetch`。
- React Query 对查询默认重试 1 次：`frontend/src/utils/queryClient.ts:9`。

#### 影响

- 用户：半小时后应用"看起来还登录着"，但所有操作都失败，提示文案是 `Not authenticated` / `Could not validate credentials`，且 Web 上无法登出，只能刷新。
- 用户：离线打开 PWA 会被登出，而 Service Worker 精心缓存的壳和 API 响应（M-02）此时没有意义。

### H-06 前端提供 `cash` / `investment` 两种账户类型，后端拒绝（422），Web 端无提示

#### 现象

1. `FinanceSourceFormScreen` 的类型按钮是 `['checking', 'savings', 'credit', 'cash', 'investment', 'other']`。
2. 后端 `FinanceSourceCreate.type` 用正则 `^(checking|savings|credit|other)$` 校验；选 `cash` 或 `investment` 提交得到 422，`msg` 为 `String should match pattern '^(checking|savings|credit|other)$'`（进程内验证）。
3. 失败分支只调 `Alert.alert('Error', …)`，Web 上无声（H-04）；即使有声，消息也是 `[object Object]`（M-06）。
4. 数据库列是 `String(32)` 无 CHECK，`type` 创建后不可改（`FinanceSourceUpdate` 只有 `name`、`archived`）。
5. `README.md:44` 宣传"Support for checking accounts, credit cards, cash, investments, and more"。

#### 证据

- `frontend/src/screens/FinanceSourceFormScreen.tsx:16`（`SOURCE_TYPES`）、`:92-96`（提交）、`:48`（错误处理）。
- `backend/app/schemas/finance_source.py:21-26`（正则）、`:34-48`（`FinanceSourceUpdate`）。
- `backend/app/models/finance_source.py:19`。
- `README.md:44`。

#### 影响

- 用户：六个类型里有两个永远创建不了，Web 上点"Create"后按钮从"Saving..."恢复，什么也没发生，也没有解释。

### H-07 列表接口返回裸数组、无总数；前端固定 `limit=50` 且无翻页，第 51 条以后不可见

#### 现象

1. `GET /api/v1/transactions` 的 `response_model=List[TransactionResponse]`，返回 JSON 数组，没有 `total`、`next` 或任何分页元数据；`limit` 默认 50、上限 100（超过静默截到 100）、无下限校验；`offset` 不校验。
2. `GET /api/v1/finance-sources` 同样是裸数组，且完全没有分页。
3. 前端 `TransactionsScreen` 用 `useState(50)` 的常量 `limit`，query key 是 `['transactions']`（不含 limit），没有翻页控件、没有筛选控件、没有"加载更多"；`TransactionListParams` 定义了 `source_id / from_date / to_date / tag / offset` 但 UI 从不传。
4. 列表头显示的 "N transactions" 是本页行数，不是总数；超过 50 条后永远显示 "50 transactions"。
5. `SPEC.md:540` 把 `TransactionsScreen` 描述为"Paginated list, filters (source/date/tag), pull-to-refresh"，其中分页和筛选都不存在，pull-to-refresh 在 Web 上也是空操作（见 L-F-05）。

#### 证据

- `backend/app/api/transactions.py:144`（`List[...]`）、`:150-151`（默认值）、`:168-169`（只做上限截断）、`:215`（`offset/limit`）。
- `backend/app/api/finance_sources.py:54-71`。
- `frontend/src/screens/TransactionsScreen.tsx:19-25`（常量 limit）、`:192-201`（计数文案）；`frontend/src/api/transactions.ts:8-15`（未被 UI 使用的参数类型）。
- `SPEC.md:540`。

#### 影响

- 用户：记满 50 条后，更早的交易在应用里再也看不到、编辑不了、删不掉（服务端仍在，只能直接调 API 加 `offset`）。
- 数据：H-01 的配对腿查找建立在这 50 条上，旧转账的编辑必然只改一条腿。

### H-08 `SECRET_KEY` 有公开默认值且无任何校验；模板声称的"缺失会大声失败"不成立

#### 现象

1. `Settings.SECRET_KEY` 默认 `"your-secret-key-change-this-in-production"`，`pydantic-settings` 不做任何校验；进程起来后就用它给 JWT 签名和验签。
2. `infra/.env.example:9` 写着"A missed substitution will fail loudly because CHANGE_ME_* values are sentinels"，`.planning/codebase/CONCERNS.md:48` 也复述这句。代码、compose、脚本里没有任何地方检测 `CHANGE_ME_*` 或默认值：`env-coverage.sh` 只比对 `Settings` 字段名是否出现在 `.env.example` 里，不看值；`smoke.sh` 只检查键存在。
3. 因为 `Settings` 允许缺省，`infra/.env` 少写一行 `SECRET_KEY`（或容器环境没传到）时不会报错，而是静默使用默认签名密钥。
4. `DATABASE_URL` 默认值内嵌 `wallet_user:wallet_password`，与 `infra/docker-compose.dev.yml` 硬编码的凭据一致，且该 compose 把 5432 端口发布到宿主机。

#### 证据

- `backend/app/core/config.py:15`（默认值）、`:12`（数据库默认值）；签名与验签使用点 `backend/app/core/security.py:59`、`:77`。
- `infra/.env.example:9`、`:20`；`.planning/codebase/CONCERNS.md:33-53`。
- `infra/scripts/env-coverage.sh:17-34`（只比对键名）；`infra/scripts/smoke.sh:40-43`（只 `grep -q "^${k}="`）。
- `infra/docker-compose.dev.yml:6-11`。

#### 影响

- 安全：任何人拿到默认密钥就能伪造任意用户的 `sub` 签出有效令牌；而"是否用了默认密钥"在运行时不可观测。
- 运维：文档承诺的安全网（sentinel 失败）不存在，操作者会误以为漏配会被拦住。

### H-09 Caddy 环境变量语义与 RUNBOOK 冲突：按 RUNBOOK 操作拿不到 Let's Encrypt 证书，且会让 Caddy 起不来

#### 现象

1. `Caddyfile` 用 `tls {$CADDY_TLS_MODE:internal}`，compose 又给 `caddy` 服务传 `CADDY_TLS_MODE: ${CADDY_TLS_MODE:-internal}`。RUNBOOK §9 和 `.env.example` 都指示在 VM 上"删除或注释掉 `CADDY_TLS_MODE`，Caddy 就会回退到 ACME"。实际两层默认值都是 `internal`：删掉这行的结果是 `tls internal`——为真实域名签发 Caddy 内部 CA 的自签证书，Let's Encrypt 根本不会被联系。
2. `Caddyfile` 的全局 `acme_ca {$CADDY_ACME_CA:https://acme-v02.api.letsencrypt.org/directory}` 只在变量**未设置**时使用默认值；compose 却总是传 `CADDY_ACME_CA: ${CADDY_ACME_CA:-}`，即 `.env` 里缺失或为空时容器内得到**空字符串**。RUNBOOK §11（生产切换）明确执行 `sed -i 's|^CADDY_ACME_CA=.*|CADDY_ACME_CA=|' .env` 把它置空，`.env.example` 的默认值也是空。
3. Docker 实测（本机 `caddy:alpine`，2026-09-03）：`CADDY_ACME_CA=` 为空时 `caddy validate` 报 `parsing caddyfile tokens for 'acme_ca': wrong argument count or unexpected line ending after 'acme_ca', at /etc/caddy/Caddyfile:2`；`CADDY_TLS_MODE` 未设置、`CADDY_ACME_CA` 为 staging URL 时，站点的 issuer 是 `{"module":"internal"}`；只有把 `CADDY_TLS_MODE` 设为一个邮箱地址（RUNBOOK 没有这个步骤）才得到 `acme` issuer。
4. 因此按 `.env.example` 原样 `cp` 出来的 `infra/.env`（`CADDY_ACME_CA=` 为空）在笔记本上会让 `caddy` 容器反复重启；`verify-phase6.sh quick` 检查不到，因为它跑 `caddy validate` 时不传任何环境变量。
5. RUNBOOK 还指示改完 `.env` 后用 `docker compose ... restart caddy` / `restart api` 生效；Compose 的 `restart` 不重新读取 `env_file`，只有 `up -d` 重建容器才会。
6. `06-01-SUMMARY.md:35,81,94` 记录的指示是"REMOVE/UNSET，不能置空"，RUNBOOK 与 `.env.example` 没有跟着改；而且 compose 的 `${CADDY_ACME_CA:-}` 会把"未设置"也变成空串，所以该指示在 compose 环境下同样得不到非空值。

#### 证据

- `infra/Caddyfile:2`、`:6`；`infra/docker-compose.prod.yml:66-68`。
- `infra/.env.example:34-35`、`:40-44`；`infra/RUNBOOK.md:485`、`:502-503`、`:581-593`、`:948-949`。
- `.planning/phases/06-provision-oracle-vm-domain-caddy-https/06-01-SUMMARY.md:35`、`:81`、`:94`。
- `infra/scripts/verify-phase6.sh:43-46`（无环境变量的 `caddy validate`）。
- 本机 `infra/.env` 现有 13 个键，不含 `CADDY_ACME_CA`（只列键名核实）。

#### 影响

- 运维：Phase 6 尚未执行的 06-05/06-06 计划（`.planning/STATE.md:99-100`）按现有文档做不出预期结果：要么 Caddy 起不来，要么拿到的是浏览器不信任的内部 CA 证书；若该域名此前已被浏览器记录过 HSTS（例如先前曾拿到过有效的 Let's Encrypt 证书），随后签出的内部 CA 证书会让浏览器直接拒绝连接且无法绕过；若从未记录过 HSTS，则只是常规证书告警（见 M-10）。
- 运维：笔记本上的"生产形态"栈也依赖操作者自行发现要给 `CADDY_ACME_CA` 填一个非空 URL。

---

## 2. 中严重程度

### M-01 同一请求内重复标签（归一化后相同）→ 500；标签超过 64 字符在 PostgreSQL 上 → 500

#### 现象

1. 创建和更新交易时，服务端对每个标签做 `tag.strip().lower()` 后逐行插入 `transaction_tags`，主键是 `(transaction_id, tag)`；请求体 `["Food", "food "]` 归一化后相同，`db.commit()` 抛 `IntegrityError`，没有捕获，HTTP 500（进程内验证；`DEBUG=True` 时返回 traceback 页）。因为失败发生在提交阶段，交易行本身也不会落库。
2. `tags` 只有 `List[str]` 类型，没有单项长度和数量限制；列是 `String(64)`，PostgreSQL 上超长标签在提交时报错 → 500，SQLite 上照常存入。
3. 前端把逗号分隔输入 `trim` 后原样发送，不做小写和去重；用户输入 `Food, food` 就会触发。
4. 500 响应没有 `detail`，axios 拦截器把消息变成 `'An error occurred'`。

#### 证据

- `backend/app/api/transactions.py:106-112`（创建）、`:374-384`（更新，先 `delete()` 再插入）。
- `backend/app/models/transaction_tag.py:14`（`String(64)`）、`:17-20`（复合主键）。
- `backend/app/schemas/transaction.py:46-50`、`:83-86`。
- `frontend/src/screens/TransactionFormScreen.tsx:315-318`、`:166`、`:243`。
- `frontend/src/api/client.ts:67-70`。

#### 影响

- 用户：普通输入导致整次保存失败，提示是泛泛的"An error occurred"，看不出是标签的问题。
- 运维：每次触发都是一条完整 traceback 日志。

### M-02 Service Worker 的 `navigateFallback` 指向 `offline.html`，在线时访问非根路径也显示离线页

#### 现象

1. `workbox-config.cjs` 设置 `navigateFallback: '/offline.html'`，仅把 `/^\/api/` 列入 denylist。生成的 `dist/sw.js` 里注册的是 `NavigationRoute(createHandlerBoundToURL("/offline.html"), {denylist: [/^\/api/]})`，即**所有**不在预缓存清单里的导航请求都直接返回预缓存的 `offline.html`，不管当前是否在线。
2. `/`、`/index.html` 在预缓存清单里，由 `precacheAndRoute` 先行匹配，所以根路径正常；配置里针对 `/` 的 `NetworkFirst`（`app-shell`）路由排在预缓存之后，实际收不到导航请求，注释描述的"NetworkFirst 保证下次导航拿到新壳"并非生成物的行为。
3. Caddy 对未知路径 `try_files {path} /index.html` 本来会回退到 SPA，但请求到不了 Caddy——被 SW 先拦下。
4. 应用从不改变 URL（`frontend/src` 无 `window.location` / `window.history` 使用），所以目前只有手输 `https://<domain>/anything` 或收藏了带路径的链接会撞上。
5. `runtimeCaching` 的 `api-cache` 规则会把所有 `GET /api/...` 的 200 响应按 URL 缓存，网络失败或超过 5 秒时返回缓存，且不区分用户、不随登出清理（见 M-08）。

#### 证据

- `frontend/workbox-config.cjs:33-34`（fallback 与 denylist）、`:40-45`（`app-shell`）、`:50-56`（`api-cache`）、`:10-12` 与 `frontend/src/pwa/registerSW.ts:12-13`（对 NetworkFirst 的描述）。
- `frontend/dist/sw.js`（未跟踪的构建产物）中的 `NavigationRoute(e.createHandlerBoundToURL("/offline.html")`。
- `infra/Caddyfile:28-32`。

#### 影响

- 用户：任何带路径的入口（例如分享出去的链接、浏览器地址栏补全）在线也看到"You're offline"，且因为 `skipWaiting + clientsClaim` 已生效，用户只能改回根路径。

### M-03 已归档账户仍可新建交易、仍可被设为默认账户

#### 现象

1. `POST /transactions` 只检查 `source_id` 存在且属于当前用户，不检查 `archived`；对已归档账户创建交易返回 201（进程内验证）。省略 `source_id` 时回退到 `default_source_id`，即使该账户已归档。
2. `PATCH /auth/me {"default_source_id": …}` 同样只查归属，不查 `archived`。
3. 归档只影响列表的默认过滤和前端的选择器；前端交易表单只加载未归档账户，所以 UI 暂时不会触发，但 API 客户端和 H-01 的第二腿（在两次 POST 之间归档目标账户）都能触发。
4. `finance_sources` 没有 DELETE 端点，归档是唯一的"删除"，但归档账户上的交易仍然全部列出，`?source_id=<archived>` 也被接受。

#### 证据

- `backend/app/api/transactions.py:69-88`（无 `archived` 检查）、`:175-186`（列表过滤）。
- `backend/app/api/auth.py:113-120`。
- `backend/app/api/finance_sources.py:67-68`（仅列表过滤）；文件中只有 `post / get / get-id / patch` 四个路由（`:17`、`:54`、`:74`、`:99`）。
- `frontend/src/screens/TransactionFormScreen.tsx:43-46`。

#### 影响

- 数据：用户以为"关掉"的账户仍会静默进账；`default_source_id` 指向归档账户时，省略 `source_id` 的 API 调用把钱记到已归档账户上。

### M-04 `tenacity` 重试装饰器永远不会生效；README 宣称的"自动重试"不存在

#### 现象

1. `get_supported_currencies` 和 `fetch_latest_rates` 都带 `@retry(... retry=retry_if_exception_type(httpx.HTTPError) ...)`，但函数体内部把 `httpx.HTTPError` 捕获后改抛 `fastapi.HTTPException`；装饰器只匹配 `httpx.HTTPError`，因此恰好尝试一次。进程内验证：把 `httpx.get` 替换为抛 `ConnectError` 的桩后，`fetch_latest_rates` 抛出 `HTTPException`，上游调用次数为 1。
2. 两个函数的 docstring 都写"Retries up to 3 times on network errors with exponential backoff"；`README.md:30-32` 写"Automatic retry on API failures"。
3. 副作用是超时最多 10 秒而不是文档暗示的 10 秒 × 3。

#### 证据

- `backend/app/services/rates.py:18-23`、`:49-53`（第一处）；`:56-61`、`:95-99`（第二处）；docstring `:29`、`:66`。
- `README.md:32`。

#### 影响

- 运维：对 Frankfurter 的瞬时抖动零容忍，任何一次失败都直接变成整页换算为 `null`（交易路由）或 503（`/rates/*`）；文档给出了错误的可靠性预期。

### M-05 `AuthContext.isLoading` 在每次登录/注册/登出时卸载整棵 `Navigation` 树

#### 现象

1. `AppContent` 在 `isLoading` 为 `true` 时用一个全屏 spinner **替换**掉 `<Navigation/>`。`login()`、`register()`、`logout()` 都在开头 `setIsLoading(true)`，`finally` 里置回。
2. 登录/注册请求期间 `LoginScreen` / `RegisterScreen` 被卸载；失败后 `Navigation` 重新挂载，`activeScreen` 回到 `'login'`，输入框清空。屏幕自身的 `catch` 在已卸载的实例上执行：`Alert.alert` 在 Web 上是空操作（H-04），`setErrors({password: …})` 作用于已卸载组件。
3. 屏幕内的按钮 spinner（`isLoading ? 'Signing in...'`）因为同样原因永远看不到。

#### 证据

- `frontend/App.tsx:13-23`。
- `frontend/src/store/AuthContext.tsx:45`、`:71`、`:98`、`:125`。
- `frontend/src/components/Navigation.tsx:15`；`frontend/src/screens/LoginScreen.tsx:8-11`、`:37-49`、`:88-95`；`frontend/src/screens/RegisterScreen.tsx:64-85`。

#### 影响

- 用户（Web）：输错密码后表单被清空、没有任何错误提示；注册时选错的币种、填好的邮箱都要重填。
- 用户：一个 401 从登录接口回来时拦截器还会顺手清一遍存储（此时本来就没有令牌，无实际后果）。

### M-06 422 校验错误在前端显示为 `[object Object]`；前后端密码长度规则不一致（6 vs 8）

#### 现象

1. FastAPI 的 422 响应 `detail` 是对象数组；axios 拦截器执行 `new Error(errorData?.detail || ...)`，数组被字符串化为 `[object Object]`。所有 422（密码过短、币种小写、金额超过 4 位小数、账户类型不合法……）在界面上都显示这串字符（或在 Web 上无声，见 H-04）。
2. `LoginScreen` / `RegisterScreen` 客户端校验密码 `>= 6`，后端 `UserCreate.password` 要求 `min_length=8`；6–7 位密码通过前端校验后被后端 422 拒绝，注册页在 Web 上什么都不显示（H-04 + M-05）。
3. `ProfileScreen` 的 `onError` 读 `err?.response?.data?.detail`，但拦截器早已把 `AxiosError` 换成普通 `Error`，`err.response` 永远是 `undefined`，只会显示固定的"Failed to update profile"。

#### 证据

- `frontend/src/api/client.ts:67-70`。
- `frontend/src/screens/LoginScreen.tsx:24`；`frontend/src/screens/RegisterScreen.tsx:44-46`；`backend/app/schemas/user.py:11`。进程内验证：7 位密码注册返回 422，`detail` 类型为 `list`。
- `frontend/src/screens/ProfileScreen.tsx:72`。
- `SPEC.md:561` 已记录这处不一致。

#### 影响

- 用户：所有字段级校验错误都无法理解；注册最常见的失败（密码 6–7 位）在 Web 上零反馈。

### M-07 日期按 UTC 日历日默认、按本地时区显示，负时差地区会差一天

#### 现象

1. 交易表单的默认日期是 `new Date().toISOString().split('T')[0]`，即 **UTC** 日历日；美洲用户晚上记账默认就是"明天"。
2. 列表页 `formatDate` 用 `new Date('YYYY-MM-DD')`（UTC 午夜）再按本地时区比较和格式化，负时差地区显示为前一天（`2025-01-02` 在 `America/New_York` 渲染为 "Jan 1"）。
3. 服务端：`occurred_at` 是纯 `Date`；`created_at` 是 naive `datetime.utcnow()`，序列化时不带时区后缀；`conversion_date` 是容器本地 `date.today()`。三者的时区语义各不相同，响应里都没有标注。

#### 证据

- `frontend/src/screens/TransactionFormScreen.tsx:28`。
- `frontend/src/screens/TransactionsScreen.tsx:82-95`。
- `backend/app/models/transaction.py:21`、`:25`；`backend/app/models/user.py:21`；`backend/app/api/transactions.py:43`、`:255`。

#### 影响

- 数据：用户以为记在"今天"的交易被存到了另一天，按日期筛选（API）和列表分组都会错位。

### M-08 登出不清 React Query 缓存和 Service Worker 的 `api-cache`，同一设备的下一个用户能看到上一个用户的数据

#### 现象

1. `logout()` 只清两个 AsyncStorage 键和 `user` 状态；`frontend/src` 里没有任何 `queryClient.clear()` / `removeQueries()`。`['transactions']`、`['finance_sources', …]` 的缓存在 `gcTime`（10 分钟）内保留，`staleTime` 5 分钟内另一个账号登录后会先看到上一个账号的列表。
2. Service Worker 的 `api-cache` 按 URL 缓存所有 `GET /api/...` 的 200 响应，与用户无关，永不因登出而清理；网络失败或超过 5 秒时会把上一个用户的 `/api/v1/auth/me`、`/api/v1/transactions?limit=50` 返回给当前请求。
3. 令牌本身存在 localStorage（Web 上 AsyncStorage 的实现），不是 HttpOnly。

#### 证据

- `frontend/src/store/AuthContext.tsx:123-133`；`frontend/src/api/client.ts:91-94`；`grep -rn "queryClient.clear\|removeQueries" frontend/src` 无结果。
- `frontend/src/utils/queryClient.ts:10-11`。
- `frontend/workbox-config.cjs:50-56`。

#### 影响

- 安全/隐私：共享设备上前一个用户的账本会短暂或在离线时长期泄露给后一个用户；而 Web 上本来就无法登出（H-04）。

### M-09 `smoke.sh` 探测的健康路径不存在，`full` 模式永远跑不绿；`trap` 在任何模式下都会 `down -v`

#### 现象

1. `smoke.sh:108-109`（`full` 模式倒数第二个检查）执行 `curl -fsk https://localhost/api/v1/health`。后端只注册了 `GET /health`（无前缀），Caddy 把 `/api/*` 原样转发，FastAPI 返回 404 `{"detail":"Not Found"}`，`curl -f` 以 22 退出，`set -e` 终止脚本；`OK: Phase 4 smoke green` 不可达。
2. 脚本开头无条件注册 `trap teardown EXIT`，`teardown` 执行 `docker compose -f infra/docker-compose.prod.yml down -v --remove-orphans`：
   - `up` 模式（注释说是"compose up --wait only (debug)"）结束时也会把刚起的栈连同 `wallet_pgdata_prod`、`caddy_data` 卷一起删掉；
   - 两个 compose 文件都在 `infra/` 下，项目名相同，`--remove-orphans` 会顺手删掉开发用的 `wallet_db` 容器。
3. `smoke.sh:64-65` 强制 `docker build --platform linux/arm64`，x86 笔记本需要 QEMU 仿真。
4. Phase 4 的验证报告记录该脚本只做了语法检查，从未端到端执行。`.planning/codebase/STRUCTURE.md:131` 把它描述为"curl /health, /docs, etc."。

#### 证据

- `infra/scripts/smoke.sh:108-109`；`backend/app/main.py:33-40`（唯一的健康路由）、`:27-30`（路由前缀）；`infra/Caddyfile:12-14`。
- `infra/scripts/smoke.sh:5`、`:24-28`、`:65`。
- `.planning/phases/04-containerize-and-compose-locally/04-VERIFICATION.md:109-111`。
- `.planning/codebase/STRUCTURE.md:131`。

#### 影响

- 运维：作为 Phase 4 验收门禁的脚本不可能通过；误在有数据的机器上跑 `smoke.sh up` 会删库删证书。

### M-10 Caddy 无请求体大小限制、无超时、无访问日志；HSTS 在 `localhost` 上也无条件下发

#### 现象

1. `Caddyfile` 全文 33 行，没有 `request_body max_size`、没有 `timeouts`、`reverse_proxy` 没有 transport 超时、没有 `log` 指令（Caddy 只在 stderr 输出运行日志，没有 HTTP 访问日志）。uvicorn 侧也没有 `--limit-*`、`--timeout-*` 参数，单进程无 `--workers`、无 `--proxy-headers`。
2. `header Strict-Transport-Security "max-age=31536000; includeSubDomains"` 对站点所有响应下发，包括 `CADDY_DOMAIN=localhost` + 自签证书的笔记本场景。
3. compose 里没有任何 `logging:`、`mem_limit`、`cpus`、`read_only`、`cap_drop`；容器日志走 Docker 默认 `json-file`，无轮转。
4. 客户端 axios 超时 10 秒，服务端 Frankfurter 调用 10 秒（单条路径两次），持有数据库连接期间阻塞。

#### 证据

- `infra/Caddyfile:1-33`；`:8`（HSTS）。
- `infra/Dockerfile.api:78`（uvicorn 命令行）。
- `infra/docker-compose.prod.yml:1-84`（无上述键）。
- `frontend/src/api/client.ts:10`；`backend/app/services/rates.py:42`、`:86`。

#### 影响

- 运维：任意大小的请求体会被完整读入；慢客户端可长期占用连接；出了问题没有访问日志可查。
- 用户/运维：HSTS 头在 `localhost` 上也无条件下发。只要浏览器曾经通过一个受信任的证书（例如操作者手动信任了 Caddy 的本地根 CA，或该域名曾成功签发过 Let's Encrypt 证书）接受过这个头，之后一年内浏览器都会拒绝以 http 访问该主机（含子域），并且在遇到证书错误时不再提供"继续访问"的绕过入口；在证书本身不受信任的情况下，浏览器会忽略该头（RFC 6797 §8.1）。

### M-11 锁定的 starlette 0.36.3 / python-multipart 0.0.6 版本过旧；基础镜像标签浮动、依赖导出不带哈希

#### 现象

1. `poetry.lock` 锁定 `fastapi 0.109.2`、`starlette 0.36.3`、`python-multipart 0.0.6`。starlette 0.36.3 处于 CVE-2024-47874（multipart 表单解析内存耗尽，0.40.0 修复）影响范围内；python-multipart 0.0.6 早于 CVE-2024-24762（0.0.7 修复）和 CVE-2024-53981（0.0.18 修复）的修复版本。当前代码没有任何 `Form` / `UploadFile` 参数（`grep -rn "Form\b\|UploadFile" backend/app` 无结果），因此 multipart 解析器不会被现有路由触达。
2. `passlib[bcrypt]` 声明在 `pyproject.toml` 但 `backend/app` 从未导入（哈希直接用 `bcrypt`）；`python-multipart` 同样声明但无使用点。
3. 镜像：`python:3.11-slim`、`ghcr.io/astral-sh/uv:latest`、`caddy:alpine`（连大版本都不固定）、`postgres:15-alpine` 都是浮动标签；`poetry export --without-hashes`；仓库里没有任何漏洞扫描或 CI（M-12）。

#### 证据

- `backend/poetry.lock:449-450`（fastapi）、`:1551-1552`（starlette）、`:1291-1292`（python-multipart）、`:880-881`（passlib）；`backend/pyproject.toml:11`、`:18-19`。
- `infra/Dockerfile.api:22`、`:27`、`:40`、`:54`；`infra/docker-compose.prod.yml:7`、`:62`。

#### 影响

- 安全：依赖树里带着已知漏洞的版本，且没有机制发现；`caddy:alpine` 下一次大版本发布可能让 Caddyfile 语法直接失效。

### M-12 没有备份、没有 CI、没有监控告警、没有回滚手段；镜像只有一个可变标签

#### 现象

1. 仓库里没有 `.github/`、`.gitlab-ci.yml`、`Makefile`、备份脚本、systemd 单元；Phase 7（CI/CD、R2 备份、零停机发布）标记为 "Not started"。
2. 唯一的持久状态是两个命名卷 `wallet_pgdata_prod`（全部用户数据）和 `caddy_data`（ACME 账户与证书）；保护措施只有 RUNBOOK 里"永远不要 `down -v`"的警告，而 compose 文件头部给出的拆除命令恰恰是 `down -v`。
3. API 镜像固定打 `wallet-app/api:local` 标签，`up -d --build` 会覆盖上一版；没有 SHA 标签、没有 digest；RUNBOOK 目录里没有回滚章节；`alembic downgrade` 只是 README 里列出的命令。
4. `api` 服务重建时旧容器先停、新容器要过 `start_period` 与第一次健康检查后才被 Caddy 转发，期间 `/api/*` 返回 502。宿主机重启后 `migrate` 不会重跑（`restart: "no"`），`depends_on` 条件也不会重新评估。
5. 外部监控（UptimeRobot）、告警、日志聚合都只存在于计划里。

#### 证据

- `find` 结果（无 CI/备份文件）；`.planning/STATE.md:37`；`.planning/REQUIREMENTS.md:55`、`:61-63`。
- `infra/docker-compose.prod.yml:3`（`down -v`）、`:37`、`:47`（单一标签）、`:41`、`:51-59`；`infra/RUNBOOK.md:959-968`。
- `infra/RUNBOOK.md:13-33`（目录中无 rollback 条目，`grep -in rollback` 无结果）；`backend/README.md:171`。

#### 影响

- 数据：一次误操作或磁盘故障即永久丢失全部账本；证书状态丢失会消耗 Let's Encrypt 配额。
- 运维：坏版本上线后只能"再发一版"，没有退路；发布必有短暂 502。

### M-13 没有刷新令牌、没有服务端注销、没有登录限速或锁定

#### 现象

1. 令牌 30 分钟一次性签发，没有 `jti`、没有吊销列表、没有刷新端点；`/auth/logout` 不存在，前端的 `authApi.logout` 是一个从未被调用的空函数。
2. `POST /auth/login` 没有失败计数、锁定或任何限速；应用层和 Caddy 层都没有 rate limiting。
3. `/api/v1/rates/currencies`、`/rates/latest`、`/rates/convert` 三个路由没有鉴权依赖，是对 Frankfurter 的匿名代理。
4. `/docs`、`/docs/oauth2-redirect`、`/openapi.json` 在任何 `ENVIRONMENT` 下都开启（`FastAPI()` 未设置 `docs_url=None` / `openapi_url=None`），且 Caddy 把它们原样代理到公网，所有路由、请求体结构和错误文案对匿名访问者可见。

#### 证据

- `backend/app/core/security.py:40-60`；`backend/app/api/auth.py` 只有 `:20`、`:65`、`:91`、`:101` 四个路由；`frontend/src/api/auth.ts:49-52`。
- `backend/app/api/auth.py:65-88`；`backend/app/main.py:17-24`（唯一中间件是 CORS）；`SPEC.md:418`、`:422`。
- `backend/app/api/rates.py:20-105`（无 `Depends(get_current_user)`）。
- `backend/app/main.py:11-15`（`FastAPI(...)` 未关闭文档路由）；`infra/Caddyfile:20-26`。

#### 影响

- 安全：泄露的令牌在 30 分钟内无法作废；密码可被在线穷举；`/rates/*` 可被用来放大对 Frankfurter 的请求。
- 安全：接口面对外完整公开，便于针对性构造请求（例如 M-01、L-B-03 的 500 触发方式）。
- 用户：每 30 分钟必须重新登录，且过期体验如 H-05。

### M-14 交易表单直接渲染 DOM `<select>` / `<input type="date">` 并调用 `crypto.randomUUID()`，实际上只能在 Web 上用

#### 现象

1. `TransactionFormScreen` 在五处无平台判断地渲染 JSX 内建元素 `<select>`（转账 From、普通表单的 Finance Source）和 `<input type="date">`（三处）；只有转账目的地选择器有 `Platform.OS === 'web'` 分支。这些标签在原生端没有宿主组件。
2. 转账 id 用全局 `crypto.randomUUID()`，`frontend/src` 没有引入任何 polyfill，`expo-crypto` 未安装，Expo 的 `winter` 运行时里没有 `crypto`。
3. 创建/更新交易和删除交易的成功/失败提示只在 `Platform.OS === 'web'` 下弹 `window.alert`，原生端无声。
4. `README.md:48`、`frontend/README.md:22-24` 仍把 Expo Go / Android / iOS 列为可用形态；`app.json` 带 iOS/Android 配置但没有 `eas.json`。
5. `frontend/README.md:22-24` 指引的 `npm start` + Expo Go 真机路径在当前代码下无法登录：`config.ts` / `config.dev.ts` 把 `API_BASE_URL` 写死为 `http://localhost:8000/api/v1`，`frontend/src` 中没有任何环境变量或 `Platform` 分支可以改成局域网地址；手机上的 `localhost` 指向手机自身，每个请求都以拦截器的 `Network error. Please check your connection.` 失败。要在真机上联调只能手改 `config.ts` 并按 `README.md:100` 用 `--host 0.0.0.0` 起后端，这一步没有任何文档说明。

#### 证据

- `frontend/src/screens/TransactionFormScreen.tsx:404-414`、`:558-566`、`:640-648`、`:707-717`、`:752-760`；唯一的平台分支 `:422`。
- `frontend/src/screens/TransactionFormScreen.tsx:164`；`ls frontend/node_modules/expo-crypto` 不存在；`frontend/node_modules/expo/src/winter/runtime.native.ts` 中无 `crypto`。
- `frontend/src/screens/TransactionFormScreen.tsx:102-111`、`:121-130`；`frontend/src/screens/TransactionsScreen.tsx:36-41`。
- `README.md:48`；`frontend/README.md:22-24`；`ls frontend/eas.json` 不存在。
- `frontend/src/constants/config.ts:1-7`（写死的 `API_BASE_URL`，文件头注释说明这是 dev/native 默认值）、`frontend/src/constants/config.dev.ts:7`；`frontend/src/api/client.ts:71-73`；`frontend/README.md:22-24`；`README.md:100`；`grep -rn -e "process.env" -e "Platform.OS" frontend/src/constants frontend/src/api` 无结果。

#### 影响

- 用户：文档承诺的手机原生形态实际上不能记账；PWA 才是唯一可用形态。

### M-15 测试套件对本地 `.env` 敏感、部分测试引用未导入的 `pytest`、大量测试只是源码字符串匹配

#### 现象

1. `tests/test_config.py` 的两个"默认值"测试直接实例化 `Settings()`，会读取 `backend/.env`。本机 `.env` 与 `backend/env.example` 都带 `DEBUG=True`，实测 `python3 -m pytest tests/test_config.py` 为 2 failed / 2 passed；加 `DEBUG=False` 环境变量后 4 passed。
2. `tests/test_transactions_structure.py` 只 `import ast` 和 `Path`，没有 `import pytest`，但 `:78`、`:81` 调用 `pytest.fail(...)`；这些分支一旦到达会抛 `NameError` 而不是测试失败。
3. 后端 36 个测试里没有一个通过 HTTP 覆盖 `/finance-sources`、`/transactions`、`/rates`；`test_auto_default_source.py`、`test_profile_structure.py`、`test_transactions_structure.py` 断言的是源码文本。前端 5 个测试文件都以 `fs.readFileSync` 读源码做 `toContain` 为主；`TransactionsScreen.test.ts:59-117` 另有一个 `(unit)` 块用 `jest.spyOn(Alert, 'alert')` 断言，但被断言的是测试自己内联复制的一段标签逻辑，没有导入或渲染任何屏幕组件；`jest.config.js` 的注释说明是为了绕开 `expo/winter` 和 `react-native-worklets` 的初始化失败。
4. `backend/README.md:155` 给出 `pytest --cov`，但 `pytest-cov` 不在 `poetry.lock`（`grep -c '^name = "pytest-cov"'` 为 0）；`:158` 引用的 `tests/test_auth.py` 不存在。
5. 测试用内存 SQLite + `Base.metadata.create_all`，Alembic 迁移链从未被测试执行；PostgreSQL 特有行为（FK 级联、长度约束、`NUMERIC` 精度）不在测试覆盖内。

#### 证据

- `backend/tests/test_config.py:6-18`；`backend/.env`（gitignored，`DEBUG=True`）；`backend/env.example:12`。
- `backend/tests/test_transactions_structure.py:1-5`、`:78`、`:81`。
- `backend/tests/` 目录（6 个测试模块）；`frontend/__tests__/`（5 个文件）；`frontend/jest.config.js:2-7`。
- `backend/README.md:155`、`:158`。
- `backend/tests/conftest.py:10-11`、`:58-69`。

#### 影响

- 运维/开发：按 README 配好 `.env` 后跑测试就红；绿色的测试也不能证明 API 行为正确（本文 H-01、M-01、M-03 涉及的路径全部无覆盖）。

### M-16 `jest` 30 与 `jest-expo` 55 与 Expo SDK 54 不匹配，`jest-expo` 预设实际没被使用

#### 现象

1. `package.json` 声明 `expo ~54.0.20`、`jest ^30.3.0`、`jest-expo ^55.0.13`。`jest-expo` 的版本号跟随 Expo SDK 大版本，55 对应 SDK 55；它依赖 `@expo/config ~55.0.12`，而 `expo@54.0.20` 依赖 `@expo/config@12.0.10`，`node_modules` 里存在两份。
2. `jest-expo@55.0.13` 依赖 `babel-jest ^29.2.1`、`jest-environment-jsdom ^29.2.1`、`@jest/globals ^29.2.1`（Jest 29 系），顶层安装的 `babel-jest` 是 29.7.0（`jest-expo` 的依赖），而 `jest@30.3.0` 所需的 `babel-jest@30.3.0` 只作为嵌套副本存在于 `frontend/node_modules/jest-config/node_modules/babel-jest`。`jest.config.js` 显式写 `transform: {'\\.[jt]sx?$': ['babel-jest', …]}`，解析到的是顶层 29.7.0。
3. `jest.config.js` 没有引用 `jest-expo` 的任何 preset，`testEnvironment: 'node'`；`@testing-library/react-native` 也没有任何测试使用。

#### 证据

- `frontend/package.json:21`、`:44-45`、`:38`；`frontend/node_modules/jest-expo/package.json`（`dependencies` 段）；`npm ls jest babel-jest jest-expo expo @expo/config` 输出。
- `frontend/jest.config.js:1-21`。

#### 影响

- 开发：依赖树里两套 Expo 配置包和两套 Jest 运行时并存；一旦有人尝试启用 `jest-expo` 预设做真正的组件测试，版本组合并不受支持。

---

## 3. 低严重程度

### 3.1 后端行为细节（L-B）

| 编号 | 标题 | 现象 | 证据 | 影响 |
|---|---|---|---|---|
| L-B-01 | `amount` 允许为 0 | `TransactionCreate.amount` / `TransactionUpdate.amount` 只有 `decimal_places=4`，无 `gt` / `ne` / `max_digits`；`"amount": 0` 返回 201（进程内验证，响应 `"0.0000"`）。前端表单拒绝 `<= 0`，编辑时把 `amount >= 0` 的行当作 income。`.planning/codebase/CONCERNS.md:503` 声称"validates amount > 0 (line 141)"，代码里没有 | `backend/app/schemas/transaction.py:19-23`、`:60-64`；`backend/app/api/transactions.py:52-141`；`frontend/src/screens/TransactionFormScreen.tsx:140-143`、`:76-87`；`.planning/codebase/CONCERNS.md:503` | 直接调 API 可写入 0 金额记录；`NUMERIC(18,4)` 的整数位上限只由 PostgreSQL 在提交时报错 |
| L-B-02 | `base_currency` 不做格式校验 | 注册和 `PATCH /auth/me` 只要求长度 3，不用 `CurrencyCode` 正则，也不对照 Frankfurter 列表；`"ab1"` 会被存成 `"AB1"`。`transactions.currency` 与 `finance_sources.default_currency` 用 `^[A-Z]{3}$`，小写直接 422（尽管处理器随后还会 `.upper()`），但任意三个大写字母（如 `XXX`）都通过 | `backend/app/schemas/user.py:12`、`:35-40`；`backend/app/api/auth.py:45`、`:124-126`；`backend/app/schemas/currency.py:9`；`backend/app/api/transactions.py:95`、`:369-370` | 非法基准币种让每条交易的换算都为 `null`（上游 404 → 503 → 吞掉）；前端只在按钮列表里选，暂不触发 |
| L-B-03 | `PATCH` 显式 `null` 打到 NOT NULL 列 → 500 | `PATCH /auth/me {"base_currency": null}` 返回 500（进程内验证）；`PATCH /finance-sources/{id} {"name": null}` 同理。`update_transaction` 对 `amount / currency / occurred_at` 做了跳过，其余两个处理器没有 | `backend/app/api/auth.py:122-129`；`backend/app/api/finance_sources.py:127-130`；`backend/app/api/transactions.py:364-371` | API 客户端一个常见写法直接触发 500 |
| L-B-04 | 邮箱唯一性对本地部分大小写敏感 | `EmailStr` 只把域名小写；`Doc.User@example.com` 与 `doc.user@example.com` 是两个账号；唯一索引 `ix_users_email` 按字节比较 | `backend/app/schemas/user.py:10`；`backend/app/api/auth.py:32-37`；`backend/app/models/user.py:17` | 同一个人可能注册出多个账号、登录时"找不到账号" |
| L-B-05 | 标签：数量无上限、空串可入库、顺序不定 | `tags: List[str]` 没有条数限制；`"  "` 归一化后是 `""` 仍会插入；`Transaction.tags` 关系无 `order_by`，响应里的顺序由数据库决定；`?tag=` 过滤只 `lower()` 不 `strip()` | `backend/app/schemas/transaction.py:46-50`；`backend/app/api/transactions.py:110`、`:212`；`backend/app/models/transaction.py:30` | 界面上出现空标签 chip；同一条记录两次响应标签顺序可能不同 |
| L-B-06 | 转账删除走批量 `DELETE`，绕过 ORM 级联 | `Query.delete()` 不触发 `cascade="all, delete-orphan"`，标签行只靠数据库 `ON DELETE CASCADE`；PostgreSQL 有效，SQLite 未开 `PRAGMA foreign_keys` 时留下孤儿 | `backend/app/api/transactions.py:449-452`；`backend/app/models/transaction_tag.py:13`；`backend/app/core/database.py:19-33`（无 PRAGMA） | 见 L-D-01 的本地数据库实证 |
| L-B-07 | 汇率无缓存、N+1 查询、阻塞式上游调用 | 每次列表一次上游请求、每次单条两次；`tx.tags` 是 `lazy="select"`，一页 100 条产生 100 次标签查询；`httpx.get` 在持有数据库会话的工作线程里阻塞最多 10 秒；只有 `/currencies` 有进程级缓存且永不刷新、无锁；`POST /rates/convert` 对同一币种对同样连打两次相同的上游请求（`convert_amount` 内一次、取 `rate` 再一次）；同币种时 `rate` 是 Python float `1.0`（序列化为 `"1.0"`）、`converted_amount` 原样返回不量化，而跨币种时两者都是 4 位/上游精度的 Decimal 字符串，同一接口的输出格式随输入而变 | `backend/app/services/rates.py:15`、`:34-38`、`:46`、`:42`、`:86`；`backend/app/api/transactions.py:135`、`:268`、`:318`、`:407`；`backend/app/core/database.py:46-57`；`backend/app/api/rates.py:83-94`；`backend/app/services/rates.py:123-124` | 上游慢的时候拖住整页请求并占用连接池（5+10）；`/currencies` 列表变化要重启进程才能看到 |
| L-B-08 | Frankfurter 未知符号被静默丢弃 | 列表路径里某个币种不被上游识别时该币种的行为 `null`，其余正常；基准币种不被识别时整页 `null`；`convert_amount` 缺少符号时抛 400 也被交易路由吞掉 | `backend/app/services/rates.py:129-133`；`backend/app/api/transactions.py:44`、`:248-249` | 同一页里有的行有换算有的没有，没有解释 |
| L-B-09 | `HTTPBearer` 缺头返回 403 而非 401（依赖锁定版本） | 锁定的 FastAPI 0.109.2 在缺少 `Authorization` 时抛 403 `Not authenticated`，无 `WWW-Authenticate`；新版本改为 401。本机安装的 0.135.3 实测返回 401，未能在锁定版本上复现 | `backend/app/core/security.py:22`；`backend/poetry.lock:449-450` | 客户端拦截器只处理 401，H-05 之后的 403 不会触发任何清理 |
| L-B-10 | 超过 72 字节的密码在 bcrypt 5.0.0 下会 500 | 锁定的 `bcrypt 5.0.0` 对超过 72 字节的输入抛 `ValueError`；`register` 不捕获。本机 bcrypt 3.2.2 无此行为，未能复现 | `backend/app/core/security.py:33-37`；`backend/poetry.lock:56-57`；`backend/app/api/auth.py:40` | 长口令注册直接 500 |
| L-B-11 | 无日志配置，`logger.info` 诊断行永远不输出 | `app/` 里没有任何 `logging` 配置；uvicorn 下根 logger 停在 WARNING，`DIAG_TOKEN_DECODE` / `DIAG_USER_LOOKUP` 这类 `info` 行被丢弃，只有 `error` / `exception` 行到 stderr；`DIAG_*` 是 Phase 3 排障时留下的 | `backend/app/core/security.py:19`、`:116`、`:120`、`:123`、`:129`、`:135`、`:137`、`:141` | 生产日志里只有失败的一半上下文 |
| L-B-12 | `API_V1_PREFIX` 是死配置；`/`、`/redoc` 经 Caddy 不可达 | 路由前缀在 `main.py` 硬编码 `"/api/v1"`，`settings.API_V1_PREFIX` 无人读取，`env-coverage.sh` 特意排除它；Caddy 只代理 `/api/*`、`/health`、`/docs*`、`/openapi.json`，FastAPI 的 `GET /` JSON 与 `/redoc` 都被 SPA 回退吃掉 | `backend/app/main.py:27-30`；`backend/app/core/config.py:20`；`infra/scripts/env-coverage.sh:19`；`infra/Caddyfile:12-32` | 改 `API_V1_PREFIX` 没有任何效果；文档 UI 只有 Swagger 一种 |
| L-B-13 | Python 3.12 弃用的 `datetime.utcnow`、Pydantic 弃用的 `Field(example=…)` | 模型默认值用 `datetime.utcnow`；schema 里大量 `example=` 关键字在 Pydantic 2.12 下触发 `PydanticDeprecatedSince20` 警告。镜像是 3.11，本机是 3.12（`__pycache__` 也是 cpython-312） | `backend/app/models/user.py:21`、`finance_source.py:22`、`transaction.py:25`；`backend/app/schemas/transaction.py:24-50`；`backend/pyproject.toml:10`；`infra/Dockerfile.api:22`、`:54` | 升级解释器或 Pydantic 时会先变成警告噪音，再变成错误 |
| L-B-14 | 首个账户自动设为默认，但计数包含已归档账户 | `source_count == 1` 才写 `default_source_id`；把全部账户归档后再新建的不会成为默认；前端从不读也不写 `default_source_id`，交易表单默认选的是最新创建的活动账户（`sources[0]`），不是默认账户 | `backend/app/api/finance_sources.py:43-49`、`:70`；`frontend/src/screens/TransactionFormScreen.tsx:68-73`；`frontend/src/screens/ProfileScreen.tsx:51-52` | "默认账户"这个概念只对省略 `source_id` 的 API 调用有意义，界面上没有任何入口 |
| L-B-15 | `default_currency` 只是展示字段，交易表单默认币种固定为 `USD` | 账户的 `default_currency` 在服务端没有任何读取点（`create_transaction` 不校验交易币种与账户币种是否一致）；前端交易表单的币种初始值写死为 `'USD'`，不随所选账户变化；转账向导把同一个币种写入两条腿，不看来源/目标账户各自的 `default_currency`；该字段仅出现在选择器的显示文字里 | `backend/app/api/transactions.py:52-141`；`backend/app/models/finance_source.py:20`；`frontend/src/screens/TransactionFormScreen.tsx:27`、`:167-174`、`:411`、`:432`、`:714` | 用户每次记账都要手动改币种；一个 EUR 账户可以记出 USD 交易且界面不会提示 |

### 3.2 前端行为细节（L-F）

| 编号 | 标题 | 现象 | 证据 | 影响 |
|---|---|---|---|---|
| L-F-01 | 编辑时无法清空 `description` / `merchant`，无法改方向、账户、币种类型 | 提交时对 `description.trim()` 的结果做"为空则改成 `undefined`"的处理，空字符串因此变成 `undefined` 并被 JSON 丢弃，服务端 `exclude_unset` 认为字段未提供；编辑时类型按钮和账户选择器隐藏，方向由存储值的符号推导；账户的 `type` / `default_currency` 创建后不可改 | `frontend/src/screens/TransactionFormScreen.tsx:327-328`、`:362`、`:703`、`:76-87`；`backend/app/api/transactions.py:359`；`backend/app/schemas/finance_source.py:34-48` | 填错的商户名只能删掉整条记录重建；把支出改成收入同理 |
| L-F-02 | `Number(amount)` 接受科学计数法和十六进制 | 校验只看 `Number(amount)` 是否有限且 `> 0`；`"1e3"` 记为 1000，`"0x10"` 记为 16 | `frontend/src/screens/TransactionFormScreen.tsx:140-143`、`:313-314` | 手机键盘上不易误触，但桌面浏览器可以 |
| L-F-03 | 账户名长度校验用未 trim 的字符串 | `name.trim()` 判空，但 `< 2` 和 `> 100` 用原始 `name.length` | `frontend/src/screens/FinanceSourceFormScreen.tsx:66-79` | `" a "` 通过前端、后端存成 `"a"`；99 个字符加两个空格被前端拒绝 |
| L-F-04 | 改基准币种后交易列表不失效；创建首个账户后 `user.default_source_id` 不刷新 | `ProfileScreen` 成功后只 `refreshUser()`，不 `invalidateQueries(['transactions'])`；列表 5 分钟内用**新**基准币种做 `item.currency !== user.base_currency` 判断，却渲染按**旧**基准算出的 `converted_amount`。`FinanceSourceFormScreen` 成功后不调 `refreshUser` | `frontend/src/screens/ProfileScreen.tsx:53-70`；`frontend/src/screens/TransactionsScreen.tsx:100-103`；`frontend/src/utils/queryClient.ts:10`；`frontend/src/screens/FinanceSourceFormScreen.tsx:40-50` | 改完币种的几分钟内"In EUR"一行显示的其实是 USD 数值 |
| L-F-05 | 下拉刷新在 Web 上是空操作；删除时所有行的按钮一起转圈 | react-native-web 的 `RefreshControl` 丢弃 `onRefresh` / `refreshing`；每一行 Delete 按钮都绑定同一个 `deleteMutation.isPending` | `frontend/node_modules/react-native-web/dist/exports/RefreshControl/index.js:2`；`frontend/src/screens/TransactionsScreen.tsx:170`、`:233-239`；`frontend/src/screens/FinanceSourcesScreen.tsx:166-172` | Web 用户没有刷新入口（`refetchOnWindowFocus: false`），只能整页刷新 |
| L-F-06 | `ScrollView` 里嵌 `FlatList` / `ScrollView` | `Screen` 默认 `scrollable=true` 包一层 `ScrollView`，五个屏幕又各自渲染 `FlatList` / `ScrollView` | `frontend/src/components/Screen.tsx:17`、`:30-37`；`frontend/src/screens/TransactionsScreen.tsx:226`、`FinanceSourcesScreen.tsx:160`、`ProfileScreen.tsx:95`、`FinanceSourceFormScreen.tsx:104`、`TransactionFormScreen.tsx:349` | 原生端 `VirtualizedList` 会告警且虚拟化失效；Web 上多一层滚动容器 |
| L-F-07 | 币种选择器复制了三份，注册页另有一份写死的 5 币种列表 | 同样的 Modal + FlatList + 样式在 `FinanceSourceFormScreen`、`ProfileScreen`、`TransactionFormScreen`（一个 Modal，两个触发按钮）各写一遍；`RegisterScreen` 用硬编码 `USD/EUR/GBP/CNY/SGD`；其余三处的加载态回退列表是六种 | `frontend/src/screens/RegisterScreen.tsx:6-12`；`frontend/src/screens/TransactionFormScreen.tsx:56-58`；`FinanceSourceFormScreen.tsx:35-37`；`ProfileScreen.tsx:39-41` | 注册时只能选 5 种基准币种，之后在个人页可改成 30 种之一 |
| L-F-08 | 没有 URL 路由、没有浏览器历史、没有 Android 返回键处理 | 导航全是组件状态；刷新回到 `'main'`，浏览器后退直接离开站点；`predictiveBackGestureEnabled: false` 且无 `BackHandler`；`HomeScreen` 在 `'edit-source'` / `'edit-transaction'` 但对应 `selected*` 为空时会静默落到主视图 | `frontend/src/components/Navigation.tsx:13-19`；`frontend/src/screens/HomeScreen.tsx:12-18`、`:117-131`、`:139`；`SPEC.md:457-459` | 无法分享或收藏任何页面；M-02 的离线页问题因此只在手输路径时出现 |
| L-F-09 | 无 i18n、无可访问性属性 | 所有文案是英文字面量；`frontend/src` 无 `accessibilityLabel` / `accessibilityRole` / `testID`；密码可见性切换是纯 emoji；收入/支出只靠颜色和 `+`/`-`；`userInterfaceStyle: "light"` 无深色模式 | `grep -rn -e accessibilityLabel -e testID -e i18n frontend/src` 无结果；`frontend/src/components/Input.tsx:46-55`；`frontend/src/screens/TransactionsScreen.tsx:70-80` | 读屏用户无法使用；开发文档是中文、界面是英文 |
| L-F-10 | 死代码与从不读取的存储 | `getTransaction`、`getFinanceSource`、`getAuthToken`、`authApi.logout` 无调用方；`@wallet_app:user_data` 写了四处从不读取；`QUERY_KEYS.USER` / `EXCHANGE_RATES`、类型 `ExchangeRate` / `ConversionRequest` / `ConversionResult` / `ApiError` 无人引用；`TransactionCreate.amount` 在前端是 `number`、响应里是 `string` | `frontend/src/api/transactions.ts:32-35`；`frontend/src/api/financeSources.ts:25-28`；`frontend/src/api/client.ts:99-101`；`frontend/src/api/auth.ts:49-52`；`frontend/src/store/AuthContext.tsx:54`、`:84`、`:111`、`:142`；`frontend/src/constants/config.ts:21`、`:25`；`frontend/src/types/api.ts:63`、`:78`、`:101-125` | 阅读代码时容易把这些当成在用的机制 |
| L-F-11 | `build:web` 失败时 `config.ts` 停在生产版本 | 脚本用 `&&` 串联，`expo export` 或 `workbox` 失败后最后的 `cp config.dev.ts config.ts` 不执行，工作树里的 `config.ts` 指向 `/api/v1`，下一次 `npm run web` 会打到 Metro 自身 | `frontend/package.json:10`；`frontend/src/constants/config.prod.ts:5` | 开发者会在一次失败构建后莫名其妙地得到 404 |

### 3.3 数据库与本地开发（L-D）

| 编号 | 标题 | 现象 | 证据 | 影响 |
|---|---|---|---|---|
| L-D-01 | 本地 SQLite 不执行外键，`wallet_dev.db` 已有孤儿标签 | 引擎对 SQLite 不发 `PRAGMA foreign_keys=ON`；只读打开 `backend/wallet_dev.db`：`transactions` 2 行、`transaction_tags` 4 行，其中 2 行引用不存在的交易；`PRAGMA foreign_keys` 为 0 | `backend/app/core/database.py:19-33`；`backend/wallet_dev.db`（只读检查） | 本地开发看到的删除/级联行为与 PostgreSQL 不同 |
| L-D-02 | 迁移链在 SQLite 上跑不通；`wallet_dev.db` 不是 Alembic 建的 | 第 5 个迁移用 `op.create_foreign_key(...)`（SQLite 不支持 ALTER 约束）并导入 PostgreSQL 方言的 `UUID`；`wallet_dev.db` 没有 `alembic_version` 表，索引名是 ORM 命名 `ix_transactions_transfer_pair_id`，说明由 `Base.metadata.create_all` 生成，而 `backend/app` 里没有 `create_all` 调用（只有 `tests/conftest.py`） | `backend/migrations/versions/76227e076393_add_default_source_to_users.py:12`、`:25-35`；`backend/wallet_dev.db` 表与索引清单；`backend/tests/conftest.py:67` | `backend/README.md` 的 `alembic upgrade head` 对 SQLite 配置不可用；本地库结构只能靠不明来源的脚本 |
| L-D-03 | Alembic 建出的索引/约束名与 ORM 不一致 | 表重命名迁移只改表名和列名，PostgreSQL 保留旧对象名：`ix_accounts_user_id`、`ix_transactions_account_id`、`accounts_pkey` 等；`transfer_pair_id` 的索引在迁移里叫 `idx_transactions_transfer_pair`，ORM 叫 `ix_transactions_transfer_pair_id`；`fk_users_default_source` 是迁移命名、ORM 无名 | `backend/migrations/versions/026ee0aecb66_rename_accounts_to_finance_sources.py:24-27`；`e533c88884b7_initial_schema_users_accounts_.py:56`、`:71`；`8a4f4d66d893_add_transfer_pair_id_to_transactions.py:30`；`76227e076393_add_default_source_to_users.py:30-35` | 下一次 `alembic revision --autogenerate` 会产生一堆改名操作 |
| L-D-04 | `NUMERIC(18,4)` 在 SQLite 上是浮点 | 本地库里 `amount` 以 REAL/INTEGER 存储，读回时再构造 4 位 `Decimal`；PostgreSQL 才是精确小数 | `backend/app/models/transaction.py:19`；`backend/wallet_dev.db` | 本地和生产的舍入行为不同 |
| L-D-05 | 生产 PostgreSQL 参数硬编码为 12 GB 机器的值 | `shared_buffers=3GB`、`effective_cache_size=8GB`、`shm_size: 1g` 写死在 compose 里，笔记本上也照用 | `infra/docker-compose.prod.yml:15-23` | 内存小的机器起不来或被 OOM |
| L-D-06 | 开发 compose 把 PostgreSQL 连同固定密码暴露到宿主机 5432 | `wallet_user` / `wallet_password` 硬编码并 `5432:5432` 发布 | `infra/docker-compose.dev.yml:6-11` | 局域网内任何人可连开发库 |

### 3.4 基础设施与运维细节（L-I）

| 编号 | 标题 | 现象 | 证据 | 影响 |
|---|---|---|---|---|
| L-I-01 | `verify-phase6.sh quick` 需要先存在 `infra/.env`，且 `caddy validate` 不带环境变量 | 末尾的 `docker compose config -q` 在缺少 `env_file` 时报错；`caddy validate` 用 Caddyfile 默认值，测不到 H-09 的空串场景 | `infra/scripts/verify-phase6.sh:43-46`、`:68-70` | 新克隆上跑不了；绿了也不代表 compose 环境下能起 |
| L-I-02 | `frontend/dist` 被 gitignore，Caddy 挂载的是可能为空的目录 | compose 直接 `../frontend/dist:/srv:ro`；新克隆没有 `dist/`，`build:web` 又以 `rm -rf dist` 开头，运行中的 Caddy 会短暂看到空目录 | `infra/docker-compose.prod.yml:74`；`.gitignore:19`；`frontend/package.json:10` | 未先构建就 `up` 得到的是空站点；线上重建期间 404 |
| L-I-03 | uvicorn 不信任 `X-Forwarded-*` | 没有 `--proxy-headers` / `--forwarded-allow-ips`，应用看到的客户端 IP 是 Caddy 容器、协议是 `http`；目前没有代码读这些值 | `infra/Dockerfile.api:78` | 将来加限速或审计日志时拿到的都是代理地址 |
| L-I-04 | `env.example` 在镜像里、`pip` 在运行时镜像里 | `.dockerignore` 没排除 `env.example`；运行时阶段 `COPY --from=builder /usr/local/bin` 把 `pip` 一并带入 | `backend/.dockerignore`（无 `env.example` 条目）；`infra/Dockerfile.api:65-68` | 镜像内容比"只含应用"多一些，无直接危害 |
| L-I-05 | `migrate` 服务继承了 API 镜像的 `HEALTHCHECK` | 一次性容器上的探针会去连从不监听的 8000 端口；`service_completed_successfully` 只看退出码，所以无害但会产生噪音 | `infra/Dockerfile.api:76`；`infra/docker-compose.prod.yml:33-44` | `docker ps` 里 `migrate` 显示 unhealthy |
| L-I-06 | 两个 compose 文件共用项目名 `infra` | 网络 `infra_default`、卷前缀 `infra_` 相同；`down --remove-orphans` 会互相删容器（M-09） | `infra/docker-compose.dev.yml`、`infra/docker-compose.prod.yml` 同目录 | 开发库与生产形态栈互相干扰 |
| L-I-07 | ROADMAP 里的 Let's Encrypt 限额说法已过时，REQUIREMENTS 的端口说法与 RUNBOOK 冲突 | ROADMAP 写"5-issuance/week prod rate limit"；同阶段 research 指出实际为每注册域名 50/周；`REQUIREMENTS.md:68` 仍写 ufw 只开 `22/80/443`，ROADMAP/RUNBOOK 已改为 23333 | `.planning/ROADMAP.md:78`、`:80`；`.planning/REQUIREMENTS.md:68` | 操作者对证书配额过度保守，对端口配置产生歧义 |

### 3.5 依赖、死代码与配置残留（L-P）

| 编号 | 标题 | 现象 | 证据 | 影响 |
|---|---|---|---|---|
| L-P-01 | 前端声明但从未导入的库 | `nativewind`、`tailwindcss`、`@react-navigation/native`、`@react-navigation/native-stack`、`react-native-screens`、`react-hook-form`、`@hookform/resolvers`、`zod`、`react-native-reanimated`、`react-native-gesture-handler`、`react-native-worklets`、`@testing-library/react-native`、`jest-expo` 在 `App.tsx` + `src/` 中零引用；`tailwind.config.js` 无人消费；Babel 里 reanimated 插件只在能解析到 worklets 时挂上 | `frontend/package.json:15`、`:17-18`、`:23`、`:26`、`:28-29`、`:31`、`:33-35`、`:38`、`:45`；`grep -rn -e react-navigation -e react-hook-form -e hookform -e "from 'zod'" -e nativewind -e className= -e gesture-handler -e reanimated -e worklets -e react-native-screens frontend/App.tsx frontend/src` 无结果 | 安装体积、升级面和安全面都被这些包放大；新人按 README 以为它们在用 |
| L-P-02 | 后端声明但未使用的库 | `passlib[bcrypt]`、`python-multipart`（见 M-11）；`pytest-asyncio` 与 `asyncio_mode="auto"` 配置了，但没有任何 async 测试 | `backend/pyproject.toml:18-19`、`:28`、`:52` | 同上 |
| L-P-03 | 代码注释大量引用 `.planning` 中的决策编号 | `backend/app` / `frontend/src` / `infra` 共 13 个文件、50 处出现 `per D-07`、`(D-03)`、`T-04-04`、`row 04-06-01`、`PROF-03`、`XFER-`、`BUG-0x`、`MOBUI-` 这类只在 `.planning/phases/*/` 里有定义的编号（其中 `infra/scripts/smoke.sh` 一个文件就占 16 处） | `grep -rn -e "per D-" -e "(D-" -e "T-0" -e "row 0" -e PROF-0 -e XFER-0 -e BUG-0 -e CONV-0 -e MOBUI- -e PWA-0 backend/app frontend/src frontend/workbox-config.cjs infra`；例如 `backend/app/api/transactions.py:117`、`:217`；`backend/app/api/auth.py:113`、`:124`；`frontend/src/screens/TransactionFormScreen.tsx:48`、`:160`；`infra/Dockerfile.api:74-75`；`infra/scripts/smoke.sh:31-112` | 离开 `.planning` 目录这些注释无法理解 |
| L-P-04 | `README.md` 要求 Node 18+，实际依赖要求 >= 20.19.4；没有 `engines` 字段 | `react-native@0.81.5` 与 `metro@0.83.2` 的 `engines.node` 都是 `>= 20.19.4`；`frontend/package.json` 无 `engines` | `README.md:83`；`frontend/node_modules/react-native/package.json:23-25`；`frontend/node_modules/metro/package.json:79-81` | 按 README 装 Node 18 会在安装或启动时失败 |
| L-P-05 | `.planning/codebase/*` 代码地图与代码不符 | 列名写成 `owner_id`（实际 `user_id`）；调用写成 `rates.service.fetch_rate`（实际 `convert_amount` / `fetch_latest_rates`）；列表路径公式写反（H-02）；表清单里有不存在的 `Account`；说前端有 4 个测试文件（实际 5 个）；`smoke.sh` 描述为 curl `/health`；引用不存在的 `infra/README.md` 与 `wallet-ui-design.zip` | `.planning/codebase/ARCHITECTURE.md:145`、`:170-171`、`:217`；`INTEGRATIONS.md:26`；`STRUCTURE.md:96-100`、`:131-132`、`:154`；`CONCERNS.md:503` | 这些文件是后续 GSD 规划的输入，错误会被继续复制 |

### 3.6 文档与代码不一致（L-DOC）

下表按文档分组。"文档说"一栏为原文摘要，"实际"一栏为代码事实。

#### `README.md`

| 编号 | 文档说 | 实际 | 证据 |
|---|---|---|---|
| L-DOC-01 | "AI-powered receipt parsing"（第 3 行）；M3 OCR、M4 图表、M5 AI 分析 | 都不存在；仓库里没有任何 OCR/LLM 代码 | `README.md:3`、`:47`、`:74-76` |
| L-DOC-02 | "Status: M1 Core Complete"、"M2 (NEXT): Android mobile app"、M3–M6 路线 | v1.0 已于 2026-04-21 发布，当前里程碑是 v2.0（Phase 4–7：容器化、PWA、Oracle VM、CI/CD），Android 不是下一步 | `README.md:5`、`:72-77`；`.planning/MILESTONES.md:3`；`.planning/ROADMAP.md:9-28` |
| L-DOC-03 | "Multi-currency transactions (USD, EUR, GBP, CNY, SGD, HKD)"、"6 supported currencies" | 选择器从 `/rates/currencies` 拉全量（约 30 种）；六种只是加载态回退 | `README.md:23`、`:30`；`frontend/src/screens/TransactionFormScreen.tsx:49-58` |
| L-DOC-04 | "Automatic retry on API failures" | 重试从不生效（M-04） | `README.md:32`；`backend/app/services/rates.py:18-23`、`:49-53` |
| L-DOC-05 | "checking accounts, credit cards, cash, investments, and more" | `cash` / `investment` 被后端拒绝（H-06） | `README.md:44`；`backend/app/schemas/finance_source.py:21-26` |
| L-DOC-06 | "Cross-Platform: Web ready, Android/iOS via Expo (M2+)" | 交易表单只能在 Web 上用（M-14） | `README.md:48` |
| L-DOC-07 | "Cloud: AWS (ECS Fargate, RDS PostgreSQL, S3 + CloudFront)" | 目标是 Oracle A1.Flex + Docker Compose + Caddy + Cloudflare DNS | `README.md:66-68`；`.planning/ROADMAP.md:13-16`；`infra/RUNBOOK.md` |
| L-DOC-08 | 裸 `alembic upgrade head` | 需要 `poetry run` 或激活的虚拟环境；`backend/README.md:61` 用 `poetry run alembic upgrade head` | `README.md:99`；`backend/README.md:61` |
| L-DOC-09 | 演示账号 `user@test.com / password123` | 仓库里没有任何种子脚本或 fixture 创建它；只在 README 与登录页页脚出现 | `README.md:112-116`；`frontend/src/screens/LoginScreen.tsx:98-101`；`grep -rn "user@test.com" backend` 无结果 |

#### `SPEC.md`

| 编号 | 文档说 | 实际 | 证据 |
|---|---|---|---|
| L-DOC-10 | "Version 1.0, Date 2026-04-27, living document" | 最后一次修改是 2026-05-23（`git log`），内容仍只描述 v1.0 | `SPEC.md:3-6` |
| L-DOC-11 | 保留标签 `transfer` 自动打在转账两腿上 | 不存在（H-01） | `SPEC.md:60` |
| L-DOC-12 | 外部服务 `api.frankfurter.app`，31 种币种 | 该主机已 301（H-03）；实测 30 种 | `SPEC.md:118` |
| L-DOC-13 | 仓库结构含 `backend/Dockerfile`、`backend/docker-compose.yml`；本地开发 `cd backend && docker compose up -d` | 两文件已在 `bc97cde`、`32a0f9e` 删除；compose 文件在 `infra/` | `SPEC.md:126-128`、`:645`；`git log --diff-filter=D -- backend/Dockerfile backend/docker-compose.yml` |
| L-DOC-14 | `amount` 为 `> 0` income、`< 0` expense | 只是约定，服务端不检查符号，0 也接受（L-B-01） | `SPEC.md:236`；`backend/app/schemas/transaction.py:19-23` |
| L-DOC-15 | 基地址 `__DEV__ ? localhost : https://api.yourapp.com/api/v1`；"Production API URL placeholder … must be replaced" | 实际是 `config.dev.ts` / `config.prod.ts` 文件互换，生产是相对路径 `/api/v1` | `SPEC.md:494`、`:621`；`frontend/src/constants/config.prod.ts:5`；`frontend/package.json:10` |
| L-DOC-16 | `TransactionsScreen`："Paginated list, filters (source/date/tag), pull-to-refresh" | 无分页、无筛选，下拉刷新 Web 无效（H-07、L-F-05） | `SPEC.md:540` |
| L-DOC-17 | React Native Web 会把 `Alert.alert` 回退成浏览器 confirm | RNW 实现是空方法（H-04） | `SPEC.md:608` |
| L-DOC-18 | "AWS Deployment Architecture (Planned)" 及成本估算 | 见 L-DOC-07 | `SPEC.md:658-676` |
| L-DOC-19 | 已自述的半迁移状态：React Navigation 未用、RHF+zod 未用、NativeWind 未用 | 与代码一致，但与 `frontend/README.md` 矛盾（下表） | `SPEC.md:449`、`:545`、`:565`、`:579` |

#### `backend/README.md`

| 编号 | 文档说 | 实际 | 证据 |
|---|---|---|---|
| L-DOC-20 | "Run Database Migrations (Will be added in Phase 1.2)" | 六个迁移自 2025-10-28 起就存在 | `backend/README.md:56-58`；`backend/migrations/versions/` |
| L-DOC-21 | `poetry run pytest --cov=app`；`pytest tests/test_auth.py -v` | `pytest-cov` 不在锁文件；`test_auth.py` 不存在 | `backend/README.md:155`、`:158`；`backend/poetry.lock`；`backend/tests/` |
| L-DOC-22 | "See main SPEC.md and PLAN.md for AWS deployment instructions"；Next Steps 里的 Phase 1.2 / 1.3 | 根目录没有 `PLAN.md`；Phase 1.x 在 2025-10 已完成 | `backend/README.md:182`、`:217-219`；`ls PLAN.md` 不存在 |

#### `frontend/README.md` 与 `frontend/START.md`（均为中文，2025-10-29 后未更新）

| 编号 | 文档说 | 实际 | 证据 |
|---|---|---|---|
| L-DOC-23 | 使用 NativeWind (Tailwind CSS)，并给出 `className` 示例 | 零处 `className`；全部 `StyleSheet.create` + 十六进制颜色 | `frontend/README.md:3`、`:50`、`:65-79`；`grep -rn "className=" frontend/src` 无结果 |
| L-DOC-24 | React Navigation 路由、React Hook Form + Zod 表单 | 都未引入（L-P-01）；路由是 `useState`，表单是手写校验 | `frontend/README.md:51`、`:53`；`frontend/src/components/Navigation.tsx:13-19` |
| L-DOC-25 | 目录含 `src/hooks/` | 不存在 | `frontend/README.md:35`；`ls frontend/src/hooks` 不存在 |
| L-DOC-26 | 生产 API 地址 `https://api.yourapp.com/api/v1` | `/api/v1`（同源） | `frontend/README.md:61`；`frontend/src/constants/config.prod.ts:5` |
| L-DOC-27 | 示例用 `fetch('/api/v1/transactions')` | 所有请求走带拦截器的 axios `apiClient` | `frontend/README.md:91`；`frontend/src/api/client.ts:8-79` |
| L-DOC-28 | `npx expo export:web` 输出到 `web-build/` 再传 S3；`npx eas build --platform android` | `npm run build:web` 输出 `dist/`，由 Caddy 提供；没有 `eas.json` | `frontend/README.md:102-104`、`:108`；`frontend/package.json:10` |
| L-DOC-29 | 路径 `/home/ubwzwd/Coding/side_projects/wallet_app/frontend`；启动后应看到"蓝色卡片 🎉 Wallet App" | 仓库在 `/home/ubwzwd/Code/wallet_app`；首屏是 Login/Register 标签页 | `frontend/START.md:6`、`:15`、`:53`；`frontend/src/components/Navigation.tsx:21-47` |

#### `infra/` 内的说明文字

| 编号 | 文档说 | 实际 | 证据 |
|---|---|---|---|
| L-DOC-30 | `.env.example`："A missed substitution will fail loudly because CHANGE_ME_* values are sentinels" | 无任何校验（H-08） | `infra/.env.example:9` |
| L-DOC-31 | `.env.example` 与 RUNBOOK："comment removal causes Caddy to fall back to ACME" | 两层默认都是 `internal`（H-09） | `infra/.env.example:34-35`；`infra/RUNBOOK.md:485` |
| L-DOC-32 | compose 文件头："Tear down: docker compose … down -v" | RUNBOOK 附录 C 把同一命令列为"FORBIDDEN" | `infra/docker-compose.prod.yml:3`；`infra/RUNBOOK.md:959-968` |
| L-DOC-33 | `workbox-config.cjs` / `registerSW.ts` 注释："NetworkFirst on /index.html surfaces the fresh shell on the next navigation/refresh" | 生成物里根路径导航由预缓存路由先接管（M-02） | `frontend/workbox-config.cjs:10-12`、`:38-40`；`frontend/src/pwa/registerSW.ts:12-13` |

### 3.7 GSD 工具残留（L-GSD）

#### 现象

1. 整个 `.planning/` 目录（约 `PROJECT.md`、`STATE.md`、`ROADMAP.md`、`REQUIREMENTS.md`、`MILESTONES.md`、`BACKLOG.md`、`config.json`、`v1-MILESTONE-AUDIT.md`、`codebase/` 7 份地图、`phases/01..06` 下的 PLAN / SUMMARY / CONTEXT / RESEARCH / VERIFICATION / VALIDATION / UI-SPEC、`research/`）是 "GSD" 工作流的产物，并被提交进仓库（`config.json` 里 `commit_docs`、分支模板 `gsd/phase-{phase}-{slug}`）。
2. 32 个 Markdown 文件直接提到 `gsd`：包括 `/gsd-verify-work`、`/gsd:plan-phase`、`/gsd-complete-milestone` 这类斜杠命令，"Verifier: Claude (gsd-verifier)"、"Generated by gsd-ui-researcher, verified by gsd-ui-checker" 这类署名，以及 `MILESTONES.md` 里"v2.0 entry will be appended here by /gsd-complete-milestone"这种占位句。
3. 源码和基础设施文件里有 50 处引用只在这些规划文档中定义的编号（见 L-P-03）；`infra/scripts/smoke.sh` 每一步都标着 "row 04-06-01" 之类的 VALIDATION 表行号。
4. `.planning/codebase/` 的地图本身有错（L-P-05），却被标注为后续 `/gsd:plan-phase` / `/gsd:execute-phase` 的输入。
5. `.planning/research/ui-redesign-v2/` 是一份未实施的重设计提案，其原始压缩包 `wallet-ui-design.zip` 被 `.gitignore` 引用但不在工作树里。

#### 证据

- `.planning/config.json:3`（`commit_docs`）、`:11-12`（`gsd/...` 分支模板）；`grep -rli "gsd" --include="*.md" .`（32 个文件）；代表性位置：`.planning/MILESTONES.md:35`、`.planning/REQUIREMENTS.md:103`、`.planning/PROJECT.md:123`、`:134`、`:141`、`.planning/codebase/STRUCTURE.md:134-135`、`:141`、`:275-277`、`:446-447`、`.planning/phases/05-pwa-ify-frontend-mobile-polish/05-VERIFICATION.md:6`、`:43-44`、`.planning/research/ui-redesign-v2/README.md:9`、`:35`。
- `infra/scripts/smoke.sh:31-112`（`row 04-xx-xx` 标注）；L-P-03 的 grep。
- `.gitignore:22`；`.planning/research/ui-redesign-v2/README.md:1-8`。

#### 影响

- 读者：不了解 GSD 的工程师会把这些斜杠命令、编号和"verifier"署名当成项目自身的流程；`.planning/` 的体量远大于代码，且部分内容与代码矛盾。

### 3.8 规划中但未完成或未执行的事项（L-TODO）

| 编号 | 事项 | 状态与证据 |
|---|---|---|
| L-TODO-01 | 公网部署（Oracle VM、域名、Let's Encrypt） | Phase 6 的 06-05 / 06-06 / 06-07 未执行；`infra/runbook-evidence/` 只有 `.gitkeep`；仓库里没有任何域名或 IP。`.planning/STATE.md:36`、`:43-48`、`:99-100`；`.planning/ROADMAP.md:27`、`:89-91` |
| L-TODO-02 | CI/CD、GHCR 镜像、R2 备份、零停机发布、部署通知 | Phase 7 未开始。`.planning/STATE.md:37`；`.planning/ROADMAP.md:28`、`:93-102`；`.planning/REQUIREMENTS.md:55`、`:61-63` |
| L-TODO-03 | 真机 PWA 安装验证（MOBUI-05） | 从 Phase 5 推迟到 Phase 6 的 06-07，未执行。`.planning/STATE.md:35`；`.planning/ROADMAP.md:83`、`:91` |
| L-TODO-04 | v1.0 验收中推迟给人工 UAT 的 13 项（原生弹窗、真实 Frankfurter 换算、PostgreSQL 会话持久化） | 未做。`.planning/MILESTONES.md:27` |
| L-TODO-05 | 转账向导与个人页的自动化测试 | 未做。`.planning/MILESTONES.md:28` |
| L-TODO-06 | 原生 EAS 构建、Sentry、fail2ban、Cloudflare 代理/WAF、证书到期监控、`www` 跳转、证书状态备份 | 明确推迟。`.planning/REQUIREMENTS.md:74-75`（EAS、Sentry）；`.planning/phases/06-provision-oracle-vm-domain-caddy-https/06-CONTEXT.md:13`（fail2ban、Cloudflare 代理/WAF、证书到期监控）、`:43`（fail2ban）、`:176`（`www` 跳转）、`:178`（证书状态备份） |
| L-TODO-07 | UI 重设计 v2（底部标签栏、仪表盘、设计令牌）与 `GET /summary`、账户余额字段 | 只是提案。`.planning/research/ui-redesign-v2/README.md:28-31` |
| L-TODO-08 | 预算、图表、周期交易、共享钱包、推送、OAuth、银行聚合、OCR/LLM | 不在 v2.0 范围。`README.md:47`、`:74-77`；`SPEC.md` 产品范围段 |

---

## 4. 与依赖版本相关的说明

本文有三处结论依赖 `backend/poetry.lock` 锁定的版本，而本机系统 Python 里装的是更新的版本，未能在锁定版本上复现：

| 条目 | 锁定版本 | 本机版本 | 未复现的行为 |
|---|---|---|---|
| L-B-09 | fastapi 0.109.2（`backend/poetry.lock:449-450`） | fastapi 0.135.3 | 缺 `Authorization` 头返回 403（本机返回 401） |
| L-B-10 | bcrypt 5.0.0（`backend/poetry.lock:56-57`） | bcrypt 3.2.2 | 超过 72 字节密码抛 `ValueError` |
| M-11 | starlette 0.36.3、python-multipart 0.0.6 | starlette 1.0.0 | CVE 与版本的对应关系来自公开通告，本次未对照漏洞库逐条核对 |

其余所有"进程内验证"的结论（422 文案、`amount=0` 返回 201、重复标签 500、归档账户接受交易、单腿转账被接受、列表为裸数组、`base_currency: null` 500、7 位密码 422 且 `detail` 为数组、`fetch_latest_rates` 只尝试一次）不依赖这些版本差异。

---

## 另见

- [./README.md](./README.md) — 项目总览、仓库布局、技术栈版本与运行方式
- [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域模型与每条用户流程的逐步描述（转账、标签、换算的现状）
- [./02-database.md](./02-database.md) — 四张表、索引、迁移链、SQLite 与 PostgreSQL 的差异
- [./03-backend-api.md](./03-backend-api.md) — 每个端点的请求/响应、校验顺序、汇率服务的两条路径
- [./04-frontend.md](./04-frontend.md) — `AuthContext` 状态机、axios 拦截器、各屏幕的行为与 PWA 管线
- [./05-infra-and-ops.md](./05-infra-and-ops.md) — Dockerfile、compose、Caddyfile、脚本与 RUNBOOK 的现状
