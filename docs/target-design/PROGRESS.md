# v3.0 实施进度

按 [README §5 实施顺序](./README.md#5-实施顺序建议) 分九个阶段推进（第八阶段「账户归人」2026-09-16 插入）；每个阶段由编排工作流在集成分支 `v3/phase-N-*` 上并行实现、逐任务审核、终审后合回 `main`。规则：代码只按本目录的设计文档写，文档与代码冲突时以文档为准并在这里登记，不悄悄改文档。

| 阶段 | 内容 | 分支 | 状态 |
|---|---|---|---|
| 1 地基 | 十张表的模型与约束、六步迁移链、`core/categories.py`、`services/fx.py`、配置项（03 §2）、错误体（03 §4.1）、删除旧接口层 | `v3/phase-1-foundation` → 已合回 `main`（52b966d） | **完成（2026-09-12）** |
| 2 账本 | 账本 / 成员 / 邀请码接口（03 §5.8–5.19）、注册自动建账本、`core/deps.py`、限流 | `v3/phase-2-ledgers` → 已合回 `main`（656cfb7） | **完成（2026-09-12）** |
| 3 账户与交易 | 账户接口（余额与三个合计）、交易 CRUD、两腿转账、配对 / 拆开、`transaction_events`、统计 summary / trend | `v3/phase-3-transactions` → 已合回 `main`（666c4ed） | **完成（2026-09-12）** |
| 4 统计 | 并入第三阶段 | — | — |
| 5 前端 | API 层、错误文案表、登录 / 账本 / 首页 / 交易 / 记一笔 / 详情 / 账户 / 设置各页、PWA 与构建 | `v3/phase-5-frontend` → 已合回 `main`（d0b4044） | **完成（2026-09-15）** |
| 6 导入 | `services/importing/`、导入端点、skill 生成脚本、前端导入指南 / 上传 / review / 历史 | `v3/phase-6-import` → 已合回 `main`（60bf8cb） | **完成（2026-09-15）** |
| 7 视觉 | 逐屏对稿重做表现层：组件库、宽屏侧栏壳、14 屏与深色、`verify-contrast.mjs` WCAG 门禁、日期 ISO 化 | `v3/phase-7-visual` → 已合回 `main`（272b4ec） | **完成（2026-09-16）**，收尾轮亦已合回（06aa97b） |
| 8 账户归人 | `finance_sources` 改归用户、`ledger_sources` 共享表、个人净资产、`/sources*` 与共享接口、全局账户页与选择器分组、迁移（决策 §14.62） | | 未开始（2026-09-16 立项） |
| 9 部署与原生 | 部署更新、Android / iOS 打包 | | 未开始 |

## 环境备忘

- 前端：`cd frontend && npm ci`（Node 24；`frontend/node_modules` 不入库）；`npx tsc --noEmit`、`npx jest`（jest-expo 预设，能真实渲染组件）、`npm run build:web`（`expo export -p web` 约 1 分钟 + workbox）。编排工作流的每个 worktree 要先 `ln -sfn /home/ubwzwd/Code/wallet_app/frontend/node_modules <worktree>/frontend/node_modules`（已被 .gitignore 忽略）。
- 后端测试用系统 Python（3.12，已装 fastapi / sqlalchemy 2.0.49 / alembic 1.18.4 / psycopg2）：`cd backend && DEBUG=false SECRET_KEY=test-secret python3 -m pytest -q`。仓库里没有 poetry。
- Postgres 迁移测试用本机 docker 里的 `wallet_db` 容器（`postgresql://wallet_user:wallet_password@localhost:5432/wallet_db`，超级用户，可 `CREATE DATABASE`），通过环境变量 `TEST_POSTGRES_URL` 传入；不设则自动跳过。
- 注意：本机 `wallet_db` 库里的 `alembic_version` 是 `9ebe856ac106`，不在仓库的迁移链里（链头是 `8a4f4d66d893`）。它只是开发库，第一阶段的迁移测试都在临时新建的库上跑；正式在这个库上升级前需要先把它重置或 `alembic stamp 8a4f4d66d893`。

## 待办（第八阶段之前或之中处理，用户 2026-09-16 定的顺序：先放着，最后再搞）

- **品牌标与应用名重新设计**（用户 2026-09-16 提出）：现在的品牌标是应用名「家庭记账」的首字「家」放在方块里，窄屏侧栏 / 登录页只剩一个「家」很怪；屏幕稿 17 画的是「账」方块，也只是占位。要出几个方向（名字 zh / en 一对 + 图形标），用户定稿后落到 `auth:brand`、`AuthLayout` 的 brand-mark、侧栏与顶栏、PWA 图标 / favicon / manifest（`frontend/public/`、`app.json`）。
- **登录页的网络错误不该挂在口令框下面**：`LoginScreen` 把所有非字段错误都显示在口令下并弹 toast，网络错误应只弹 toast。
- **05 章文件名** `05-import-and-llm.md` 早已不含 LLM，改名要连带 README 与各章链接。
- **等后端补字段**：屏幕 11 页头「已入账 N 笔」、屏幕 02 页头「转账」段（见 2026-09-16 日志）。币种多选筛选已按 §14.60 做完（2026-09-16）。

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
- 2026-09-15：5c 收尾工作流（3 个任务 / 2 波）全部合入，终审 ship：交易详情与两腿转账详情、5b 终审的十一条收口、构建与 PWA 收尾（workbox 只缓存三条只读接口、导航回落 index.html、主题色取 tokens、`verify-touch-targets.mjs` 重写、导入占位路由、README / START 重写、全应用贯穿测试）。`npm run verify` 端到端通过，前端 685 个测试、后端 828 个测试全绿。编排者手工补了两处：
  - **真 bug**：`UnpairResult` 原本按 `{out, in}` 定型，而 03 §5.34 与后端 `UnpairResponse` 返回 `{pair_id, unpaired: [leg, leg]}`，`useUnpairTransfer` 的 `onSuccess` 在真实后端上会抛异常并导致两条腿都不失效。已改成 `{pair_id, unpaired}` + `UnpairedLeg` 精简形态，两处测试 mock 同步，04 §3.3 已注（同步 2026-09-15）。
  - `/l/:ledgerId/imports/:batchId` 没有路由文件，而交易列表与两个详情页都会跳它，「来自导入」一点就 404；已补占位路由并登记进贯穿测试的路由表。
  - 04 §4.5「共 N 笔」的口径改成服务端 `total`（过滤后的行数），文档已同步；两腿转账仍合并成一行显示。
- 2026-09-15：第六阶段（导入）完成并合回 `main`（60bf8cb）。三轮工作流（10 + 5 + 2 个任务）加编排者手工收口，后端 1165 个测试、前端 59 套件 776 个测试、`npm run verify` 端到端全绿。产出：`services/importing/`（`reading` / `validation` + `drafts` + `rules` / `flagging` / `committing` + `commit_checks`）、`schemas/importing.py`、`api/imports.py`（03 §5.37–§5.44 八个端点）与 `api/import_format.py`、`scripts/gen_import_skill.py` + `skills/wallet-import/` 四份交付物、`backend/tests/fixtures/import/` 十四份样本与端到端用例；前端 `queries/useImports.ts`、导入指南 / 上传粘贴 / 历史与撤销三页、review 表格（`ui/DataTable.tsx` + `ui/useRowWindow.ts` + `screens/imports/review/`）与已提交结果页。要点与偏差：
  - **新决策 §14.55**：批量改草稿行不接受 `matched_transaction_id` / `counterpart_source_id` / `counterparty`（03 §5.42 与 05 §4.1 冲突，取 05）。03 §5.42 与 05 §4.1 待同步。
  - **部署级修正**：生产镜像的 build context 从 `backend/` 提到仓库根，`infra/Dockerfile.api` 增 `COPY skills/ ./skills/`，仓库根新增 `.dockerignore`（挡住 `frontend/` / `docs/` / `.git/` 等）。此前 `skills/` 进不了镜像，线上 `GET /import-format` 的 `sample_csv` / `skill_text` / `skill_markdown` 会是空串、导入指南页整页空白。镜像里命中的是 `<backend dir>/skills/wallet-import`（`/app/skills/wallet-import`），开发机命中 `<repo-root>/skills/wallet-import`，两条探测路径都承重。`infra/scripts/smoke.sh` 与 `RUNBOOK.md` 同步。
  - **跨任务缺陷修正**：`skill_outdated` 的 `guide_url` 原为 `/import/guide`（03 示例值），应用里没有这条路由，版本过期时的恢复按钮会跳 404；改为端点层按本账本拼 `/l/{ledger_id}/imports/guide`（03 §5.37 示例待同步）。11 列表头收敛到 `services/importing/drafts.COLUMNS` 一份真源（`import_format.HEADERS` 由它派生）。`GET /import-format` 的 ETag 改成整个响应体的摘要（原来只用 `CATEGORY_VERSION`，只改 skill 文案的发版会让老客户端永远拿 304）。
  - **前端要点**：review 表格的提交失败按响应体的 `rows` 定位出错行（`detail` 里没有行号）；批量设 kind 先按选中行的金额符号过滤掉注定失败的选项，失败文案不再假称是分类问题；撤销流程收敛到 `screens/imports/undoBatch.ts` 一份；手机上的跳转改为实测当前节点位置（卡片只是被挤下去时不会触发布局回调，缓存的偏移必然是旧的）；`DataTable` 做了行窗口化（视口未测量时降级到 162 行，否则 jest 里会一片空白），窗口按 index 定位所以能跳到未挂载的行。
  - **`npm run verify` 曾经是红的**：第六阶段新增的三个 `Pressable`（`DataTable` 的行选择与单元格、`ReviewCards` 的整卡）没到 44px 触控目标，被跳过的收口任务恰好是唯一会跑完整 verify 的那个，所以两轮都没撞上。已按真实尺寸补上（只有整卡那个用豁免注释）。教训：手工合入任务分支时要跑 `CI=1 npm run verify`，不能只跑 tsc + jest。
  - 留档未做（不阻塞）：`DataTable` 的行高按 44 估算，带 `hint` 的行实际更高，滚动时有十几像素抖动；正在编辑的单元格被快速滚出窗口会丢掉 500ms 去抖内未提交的草稿（干净的修法要动 `ReviewRow.tsx` 的 `useDraft`）；贯穿测试的导入那一段跑在窄屏，虚拟化后的宽屏表格只在 `review.test.tsx` 里被覆盖；`ImportRowsBulkPatch` 的批量语义已收窄但 03 §5.42 / 05 §4.1 两处文档尚未同步。
- 留档未做（不阻塞，第六阶段或之后处理）：记一笔表单里 `CategoryPicker` / `SourcePicker` / `CurrencyPicker` 的浮层打开时 Esc 仍会落到表单（这三个组件的 open 状态私有在 `src/ui` 内部，要加 `onOpenChange` 才能上报）；`RefundOriginCard` 的「原单已删除」分支在生产不可达（后端 `ON DELETE SET NULL` 会让 `refund_of` 一起变 null）；退款行的 accessibilityLabel 逐行相同；`BarList` 的「其他 N 项」非交互行也被撑到 44 高。
- 2026-09-16：第七阶段（视觉）完成并合回 `main`（272b4ec）。起因是用户在本地看到应用「和设计稿完全长两个样子」：第五、六阶段照 04 章文字写，而 04 章与 17 张屏幕稿不一致。三轮工作流（13 → 8 → 5 个任务，含两次连带跳过后的重排）加编排者手工合入（v7-imports 两轮审核后剩一条 major 手工合入、v7-import-review 的半成品分支交给第三轮接着做）。`CI=1 npm run verify` 端到端全绿：61 套件 896 个测试（776 → 896，04 §8 用例一条没删）、web 构建、PWA、触控目标、新增 WCAG 对比度门禁（light / dark 各 49 对全过）。产出：`src/ui/` 组件库（PageHeader / SectionHeader / ListCard / ListRow / KeyValueRows / Avatar / TintCard / KindIcon / BarChart / SegmentedControl / Badge / Chip / FilterChips / DateField / AmountField / Popover），宽屏侧栏壳（账本卡片 + 五项导航 + 记一笔 + 用户行，宽屏无通用顶栏，`/ledgers*` 上是「账本管理」卡 + 三项导航），首页 / 交易列表 / 记一笔 / 详情 / 账户 / 导入（指南与上传合并页、历史、撤销对话框、review 表格与合并底栏）/ 账本设置 / 我的 / 账本列表与加入 / 登录注册 全部按稿重做，深色三帧对齐。
  - **新决策**：§14.56（六条布局裁定）、§14.57（分类选择器不要搜索框，用户决定）、§14.58（内容卡 `bg.raised` / chrome `bg.surface`；`/ledgers*` 宽屏开壳；review 表格三处按稿修订）、§14.59（第四轮的裁定：金额裸写与外币符号表、屏幕 02 / 04 / 08 的几处按稿、邀请码失效态保留数字、币种筛选本阶段仍单选、装饰性细线不进对比度门禁）。04 章已由 docs-sync 任务同步 §1.4 / §4.x / §6。
  - **手工修正与基础设施**：`ui/Popover.tsx`（react-native-web 每个 View 都是独立 stacking context，内联下拉会被后面的字段盖住，改成 Modal 门户）；分类面板列宽（`flex:1` + `flexGrow:0` 在 web 上解析成零宽）；`domain/routes.ts` 返回 `RouteHref = Extract<Href,string>`，`tsconfig.json` 按 expo 重写后的样子入库（任何 `expo start` 都会重生成 `.expo/types/router.d.ts` 并改写 tsconfig，此前 tsc 每次都红）；`TextField` 去掉浏览器焦点描边；`jest.config.js` 把 worker 上限定为 4 + 空闲内存上限。
  - **教训**：(a) WSL（23 GB）被撑死两次——并行 worktree 各自跑 jest（CPUs-1 个 worker）+ expo + chromium；对策是 jest 限 4 worker、每波最多三个前端任务、任务结束即杀 dev server；(b) worktree 里把 `frontend/node_modules` 软链到主仓会让 Metro 把入口算到仓库之外、整页白屏，改用 `cp -al` 硬链接副本；(c) 后端 `ALLOWED_ORIGINS` 要放行每个任务端口，否则截图全被 CORS 挡在登录页；(d) CI 模式的 Metro 没有文件监听，改完代码必须 `--clear` 重启否则一直发第一份 bundle；(e) 崩溃后的工作流要清掉 worktree / task 分支重新起（resume 会回放过期缓存），计划 JSON 要落盘（`.orchestrate/plans/`）并通过一个内嵌计划的包装脚本启动，避免每次把 90 KB 计划塞进工具调用；(f) 演示数据会被执行 agent 漂移（D 用户名下多了一本账），验收前要还原。
  - 截图工具在 `.claude/shots/`（不入库）：`render-mockups.mjs`（66 帧）、`shoot-app.mjs`（10 个场景）、`reseed-ids.py`、两个守护脚本（后端 :8000 / 预览 :8081）。
  - **留给第四轮（minor，不阻塞）**：金额裸写 + 外币符号表（稿的 D1）、屏幕 02 页头统计口径 / 筛选面板折叠 / 窄屏汇总卡、04 窄屏账户与日期合卡、08 账户行用账户类型图标、11 页头「已入账 N 笔」、时间线时间戳去年份、Sheet 背景无障碍名、币种中文名表接到全部选择器、`transferTitle` 的「对方：X」形态、`showsLedgerManageCard` 死代码、`/ledgers` 冷开导航 pop-in、几处注释与死状态、`verify-contrast.mjs` 两处小瑕疵、04 §5.4 `formatDate` 契约与 §0.2 / §0.3 总览、§4.3 邀请码失效态文字。**不做**（记录）：侧栏页面专属槽位（D5 / D10）、行尾 `…` 菜单换 `›`（D9）、撤销幽灵按钮（D11）、首页刷新按钮（D13）、注册字段集（D14，由 API 契约决定）、窄屏页面专属顶栏（§14.56）。
  - 留档未做（不阻塞）：`api/types.ts`（405）与 `useTransactionForm.ts`（432）两个基线文件仍超 400 行；`border.default` / `border.strong` on `bg.raised` 对比度 1.2–1.7（装饰性细线，不进门禁，见 §14.59）；`Page` 的 `wide` prop 空转待删；`DataTable` 行高估值仍是常量。
- 2026-09-16：第七阶段收尾轮（第四轮，5 个任务 / 3 波）合入并合回 `main`（06aa97b）：§14.59 落地——`formatMoney` 符号表（外币写 `S$4,120.80`）、基准币种金额在列表 / 表格 / 统计卡里裸写（唯一入口 `formatLedgerAmount`）、02 页头统计与筛选折叠与窄屏汇总卡、04 窄屏账户日期合卡、08 账户类型图标、操作记录时间戳去年份、币种中文名接到全部选择器、`/ledgers` 冷开占位、Sidebar 与三个超长文件拆到 400 行内、`MoneyText` 退役、04 章同步。整体审核剩下的 minor 由编排者手工收口（记一笔三个币种选择器的中文名、四处重复的金额规则合一、账户分组小计与详情金额行按稿保留符号、导入历史去掉字节数与「已入账」客户端扫描、账户表去掉汇率日期行、`formatDateTime` 死参数、转账行不带正负号、04 §5.4 契约与示例）。`CI=1 npm run verify` 全绿：62 套件 928 个测试。**第七阶段至此结束**；决策 §14.56、§14.58、§14.59 待用户追认；下一步第八阶段（部署更新、Android / iOS）。
  - 留档未做（不阻塞，等后端补字段）：屏幕 11 页头的「已入账 N 笔」与屏幕 02 页头的「转账」段（`summary` 按 §14.52 A14 排除转账；已提交行数没有账本级合计）；币种筛选多选（接口只收一个 `currency`）。
