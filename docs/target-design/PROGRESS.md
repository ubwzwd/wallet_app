# v3.0 实施进度

按 [README §5 实施顺序](./README.md#5-实施顺序建议) 分八个阶段推进；每个阶段由编排工作流在集成分支 `v3/phase-N-*` 上并行实现、逐任务审核、终审后合回 `main`。规则：代码只按本目录的设计文档写，文档与代码冲突时以文档为准并在这里登记，不悄悄改文档。

| 阶段 | 内容 | 分支 | 状态 |
|---|---|---|---|
| 1 地基 | 十张表的模型与约束、六步迁移链、`core/categories.py`、`services/fx.py`、配置项（03 §2）、错误体（03 §4.1）、删除旧接口层 | `v3/phase-1-foundation` → 已合回 `main`（52b966d） | **完成（2026-09-12）** |
| 2 账本 | 账本 / 成员 / 邀请码接口（03 §5.8–5.19）、注册自动建账本、`core/deps.py`、限流 | `v3/phase-2-ledgers` → 已合回 `main`（656cfb7） | **完成（2026-09-12）** |
| 3 账户与交易 | 账户接口（余额与三个合计）、交易 CRUD、两腿转账、配对 / 拆开、`transaction_events`、统计 summary / trend | `v3/phase-3-transactions` | 进行中（2026-09-12） |
| 4 统计 | 并入第三阶段 | — | — |
| 5 前端骨架 | API 层、错误文案表、登录 / 账本 / 首页 / 交易 / 记一笔 / 账户各页 | | 未开始 |
| 6 导入 | `services/importing/`、导入端点、skill 生成脚本、前端导入指南 / 上传 / review / 历史 | | 未开始 |
| 7 视觉 | `theme/tokens.ts`、组件按 04 §6 换色、浅色 / 深色 WCAG 验收 | | 未开始 |
| 8 部署与原生 | 部署更新、Android / iOS 打包 | | 未开始 |

## 环境备忘

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
