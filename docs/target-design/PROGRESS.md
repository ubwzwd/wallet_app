# v3.0 实施进度

按 [README §5 实施顺序](./README.md#5-实施顺序建议) 分八个阶段推进；每个阶段由编排工作流在集成分支 `v3/phase-N-*` 上并行实现、逐任务审核、终审后合回 `main`。规则：代码只按本目录的设计文档写，文档与代码冲突时以文档为准并在这里登记，不悄悄改文档。

| 阶段 | 内容 | 分支 | 状态 |
|---|---|---|---|
| 1 地基 | 十张表的模型与约束、六步迁移链、`core/categories.py`、`services/fx.py`、配置项（03 §2）、错误体（03 §4.1）、删除旧接口层 | `v3/phase-1-foundation` | 进行中（2026-09-11） |
| 2 账本 | 账本 / 成员 / 邀请码接口（03 §5.8–5.19）、注册自动建账本、`core/deps.py`、限流 | | 未开始 |
| 3 账户与交易 | 账户接口（余额与三个合计）、交易 CRUD、两腿转账、配对 / 拆开、`transaction_events` | | 未开始 |
| 4 统计 | `stats/summary`、`stats/trend` | | 未开始 |
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
