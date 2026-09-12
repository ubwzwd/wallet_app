# v3.0 实施进度

按 [README §5 实施顺序](./README.md#5-实施顺序建议) 分八个阶段推进；每个阶段由编排工作流在集成分支 `v3/phase-N-*` 上并行实现、逐任务审核、终审后合回 `main`。规则：代码只按本目录的设计文档写，文档与代码冲突时以文档为准并在这里登记，不悄悄改文档。

| 阶段 | 内容 | 分支 | 状态 |
|---|---|---|---|
| 1 地基 | 十张表的模型与约束、六步迁移链、`core/categories.py`、`services/fx.py`、配置项（03 §2）、错误体（03 §4.1）、删除旧接口层 | `v3/phase-1-foundation` → 已合回 `main`（52b966d） | **完成（2026-09-12）** |
| 2 账本 | 账本 / 成员 / 邀请码接口（03 §5.8–5.19）、注册自动建账本、`core/deps.py`、限流 | `v3/phase-2-ledgers` → 已合回 `main`（656cfb7） | **完成（2026-09-12）** |
| 3 账户与交易 | 账户接口（余额与三个合计）、交易 CRUD、两腿转账、配对 / 拆开、`transaction_events`、统计 summary / trend | `v3/phase-3-transactions` → 已合回 `main`（666c4ed） | **完成（2026-09-12）** |
| 4 统计 | 并入第三阶段 | — | — |
| 5 前端骨架 | API 层、错误文案表、登录 / 账本 / 首页 / 交易 / 记一笔 / 账户各页 | `v3/phase-5-frontend`（5a 地基与骨架 → 5b 各页） | 进行中（2026-09-12） |
| 6 导入 | `services/importing/`、导入端点、skill 生成脚本、前端导入指南 / 上传 / review / 历史 | | 未开始 |
| 7 视觉 | `theme/tokens.ts`、组件按 04 §6 换色、浅色 / 深色 WCAG 验收 | | 未开始 |
| 8 部署与原生 | 部署更新、Android / iOS 打包 | | 未开始 |

## 环境备忘

- 前端：`cd frontend && npm ci`（Node 24；`frontend/node_modules` 不入库）；`npx tsc --noEmit`、`npx jest`（jest-expo 预设，能真实渲染组件）、`npm run build:web`（`expo export -p web` 约 1 分钟 + workbox）。编排工作流的每个 worktree 要先 `ln -sfn /home/ubwzwd/Code/wallet_app/frontend/node_modules <worktree>/frontend/node_modules`（已被 .gitignore 忽略）。
- 后端测试用系统 Python（3.12，已装 fastapi / sqlalchemy 2.0.49 / alembic 1.18.4 / psycopg2）：`cd backend && DEBUG=false SECRET_KEY=test-secret python3 -m pytest -q`。仓库里没有 poetry。
- Postgres 迁移测试用本机 docker 里的 `wallet_db` 容器（`postgresql://wallet_user:wallet_password@localhost:5432/wallet_db`，超级用户，可 `CREATE DATABASE`），通过环境变量 `TEST_POSTGRES_URL` 传入；不设则自动跳过。
- 注意：本机 `wallet_db` 库里的 `alembic_version` 是 `9ebe856ac106`，不在仓库的迁移链里（链头是 `8a4f4d66d893`）。它只是开发库，第一阶段的迁移测试都在临时新建的库上跑；正式在这个库上升级前需要先把它重置或 `alembic stamp 8a4f4d66d893`。

## 日志

- 2026-09-11：文档终稿合回 `main`（47ea5d8），GSD 记录归档（6598d03），第一阶段启动。
- 2026-09-12：第一阶段完成并合回 `main`。两轮工作流（8 个任务 + 4 个收尾任务），后端 189 个测试通过、13 个 Postgres 用例需 `TEST_POSTGRES_URL`（本机全绿 202）。要点：
  - 迁移链 `b1f3c2a10d41`–`46` 在空 SQLite 与真实 Postgres 上正反向都通过；`tests/test_migrations.py` 除 Alembic 的 `compare_metadata` 外另有反射比对（列类型 / 长度 / 可空 / 默认值、PK / FK / UNIQUE / CHECK / 索引名），已验证能抓到约束名与列长度的漂移。
  - 实现与文档的两处偏离（待同步进 02 §5.3）：第 3 步迁移多了 `finance_sources.name` 收窄到 VARCHAR(100) 前的 `truncate_and_warn`（超长值截断并打 warning，与 `delete_and_warn` 同风格；现有数据只有测试数据，决策 §13）、以及 `pk_accounts` / `fk_transactions_account_id_accounts` 两个旧约束名的改名（Postgres 用 RENAME CONSTRAINT，SQLite 在 batch 里重建）。
  - 已知小项（不阻塞）：SQLite 上经迁移建出的库里 `finance_sources.id` / `transactions.id` 反射为 NUMERIC（初始迁移用了 `sa.UUID()`），只影响 SQLite 开发库；`tests/test_migrations.py` 的临时库上下文与 conftest 的 fixture 重复；`tests/test_config.py:24` 超过 100 列。
  - `backend/env.example` 的 SECRET_KEY 已改为哨兵值，`cp env.example .env` 后必须自己生成（`openssl rand -hex 32`），否则进程拒绝启动。
- 2026-09-12：第二阶段完成并合回 `main`（656cfb7）。两轮工作流（7 个任务 + 1 个收口任务），后端 477 个测试通过。产出：`core/{deps,ratelimit,clock}.py`、`services/ledger_service.py`、`schemas/{common,auth,user,ledger}.py`、`api/{auth,me,categories,config,ledgers}.py`，路由改为自动挂载（`app/api` 下定义 `router` 的模块自动挂上）。要点：
  - 注册要求 `base_currency` 在 Frankfurter 支持列表里（03 §5.1 已补两行）；登录 / 注册 / 加入账本三处限流共用一个进程内令牌桶，`RATE_LIMIT_JOIN_QPS` 必须为正。
  - 留档未做：`client_ip` 信任 `X-Forwarded-For` 首段（03 §8.1 原文，部署阶段与 Caddy 一起定）；`pagination` 的 500 上限（导入端点自带）；`GET /categories` 的 response_model；`GET /import-format` 等第六阶段。
  - 统计端点并入第三阶段一起做（原第四阶段取消）。
- 2026-09-12：第三阶段完成并合回 `main`（666c4ed）。两轮工作流（8 个任务 + 3 个收口任务），后端 826 个测试通过（含 Postgres 迁移用例 841）。产出：`services/{events,valuation,stats,transaction_service}.py`、`schemas/{common(Amount / Rate),finance_source,transaction,stats}.py`、`api/{finance_sources,transactions,stats}.py`（03 §5.20–§5.36 全部端点）、conftest 的 `source_factory` / `transaction_factory` / `pair_factory`、端到端流程测试。要点：
  - 配对按 §14.53a 统一子类型，只有值真变了的那条腿写 `updated` 事件；同一操作的全部事件与交易的 `created_at` / `updated_at` 同一时刻（02 §1.9），`events.list_for` 按 `(at DESC, id DESC)`。
  - `GET /transactions` 没给金额区间时走快路径（`COUNT(*)` + 只折算当页），`summary` 用 `(kind, currency, occurred_at)` 分组小计折算（03 §5.25 已加注，与逐行折算只差第 4 位小数的舍入）；给了区间时全量折算且 `count == total` 只计能折算的行（03 §5.25 已加注）。
  - 金额整数位超过 14 位（NUMERIC(18,4)）在服务层就回 400；X-Client 统一 ≤ 16 字符（03 §4.7、§1.2 已同步）；03 §5.30 / §5.33 响应补顶层 `updated_at`，§5.27 `other_refunds` 补 `source_id`，04 `TransactionSummary` 字段名改成与 03 一致（同步 2026-09-12）。
  - 留档未做（不阻塞）：`transaction_events.id` 是随机 UUID，同一时刻两条事件的次序在语义上不确定（只影响时间线里同一操作两条的先后）；`_amount` 量化后跨越上限那一条分支没有直接测试；`fx.py` 与 `valuation.py` 仍各有一份 `quantize_amount` 风格的写法（rate 已统一到 `fx.quantize_rate`）。
- 2026-09-12：第五阶段（前端）启动。wave 0 已提交在 `v3/phase-5-frontend`：Expo Router v6 入口与 SDK 54 依赖（expo-router / expo-localization / react-native-svg / expo-font + Figtree & IBM Plex Mono / lucide 图标 / i18next），jest 换 jest-expo 预设（真实组件渲染、`renderRouter`、i18next 都已验证），删除全部 v2 页面 / 组件 / API 模块 / 测试，新增 `src/api/types.ts`（04 §3.3 逐字）、`src/constants/config.ts`（`EXPO_PUBLIC_API_BASE_URL`，04 §7.2）、`src/utils/prefs.ts`、`scripts/gen-tokens.mjs` → `src/theme/tokens.ts`。**实现与文档的偏差（待同步进 04 §3.7）**：后端 422 的 `detail` 是字符串（`"body.email: …; body.password: Field required"`，03 §4.1 的实现），不是 04 §3.7 假设的数组；前端按字符串解析出字段级错误，同时兼容数组形态。计划分两段：5a 地基与骨架（API 层 / i18n / 主题与组件库 / 领域纯函数 / Query 层 / AuthContext / 路由守卫与导航壳 / 登录注册账本页），5b 首页 / 交易 / 记一笔 / 详情 / 账户 / 设置与构建。
- 2026-09-12：5a「前端地基与骨架」工作流（9 个任务 / 3 波）全部合入 `v3/phase-5-frontend`，前端 473 个测试、tsc 零错误。终审的 blocker（两处旧 `@/ui/index2` 引用）与 major（全局错误 Toast 与页面重复弹）已直接修掉，`types.ts` 按 03 改正三处（`TransactionSummary` 字段名、`TransactionPairRequest.other_transaction_id`、`ImportRowListParams.flagged`）。**新增后端端点** `GET /ledgers/{id}/transactions/transfer/{pair_id}`（03 §5.30a，同步 2026-09-12）：04 §1.2 的两腿详情 / 编辑路由只带 pair_id，原接口集无法按 pair_id 读一对。jest 改为直接转换 lucide-react-native（去掉手写 mock）；`expo-asset` 补为直接依赖（expo-font 隐式依赖它，否则字体 hook 无法解析）。终审剩余 minor（约 30 条：Toast 避让底部 tab、confirm 二次确认文案、登录时 language=null 越过本地偏好、`/settings` 不在壳下、formatConverted 符号、filters 空串解析、safeNext 控制字符、Button 横向 hitSlop、CategoryPicker 411 行、TrendChart 标签过宽等）作为 5b 的第一波两个收口任务处理。人工冒烟注意：5b 合入前 `/l/:id` 没有首页路由。
- 2026-09-12：5b「前端各页」工作流（10 个任务 / 3 波）跑完，七个任务合入：两个 5a 收口（fe-fix-core 二十条、fe-fix-shell 二十一条）、04 文档同步、首页、交易列表、账户、账本设置与个人设置。**fe-tx-form（记一笔与编辑）被审核打回**（两轮修复后仍有两处 major，都在两腿转账的编辑路径），fe-tx-detail 与 fe-build 因依赖被跳过。编排者手工处理：把 `task/fe-tx-form` 合入后直接补掉两处 major——(a) `toTransferUpdate` 改为按差异只发改动字段（03 §5.31 只在请求点名时才写两腿的 `occurred_at` / `subtype` / `note`，原来的全量 body 会把 §14.53a 允许的「两腿各有日期与备注」在任何一次保存时抹平）；(b) `showsSecondLeg()` 成为「第二组金额是否展开」的唯一判据，并同时看币种与金额，使同币种 1000 → 995 的一对不再在第一次保存时被镜像成 1000 / 1000。另外 `jest.setup.js` 把 Testing Library 的 `asyncUtilTimeout` 提到 10 秒（48 个测试套件并行时 1 秒默认值会随机误报）。此时 647 个前端测试通过。
- 2026-09-12：5c 收尾工作流启动（3 个任务 / 2 波）：交易详情与两腿转账详情、5b 终审收口（四个页面窄屏顶栏标题、「共 N 笔」计数漂移、记一笔表单的八条 minor、prefs / 错误判定 / 金额比较三处小重构）、构建与 PWA 收尾（workbox 策略、manifest / index.html / app.json 取 token 色、`verify-touch-targets.mjs` 重写、导入占位路由、README / START、全应用贯穿测试）。

