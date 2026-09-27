# Wallet App

多账本、多账户、多币种的家庭记账应用。Web（PWA）优先，后续打包 Android / iOS。

v3.0 于 2026-09 按 [`docs/target-design/`](docs/target-design/README.md) 重写完成：产品网页端全功能、视觉按设计稿对齐、账户归人并按账本共享、干净地址。进度见 [`docs/target-design/PROGRESS.md`](docs/target-design/PROGRESS.md)。

## 仓库结构

| 目录 | 内容 |
|---|---|
| `backend/` | FastAPI + SQLAlchemy + Alembic。本地 SQLite，生产 Postgres。 |
| `frontend/` | Expo SDK 54 + expo-router，`react-native-web` 出 Web 包，同一套代码打原生。 |
| `skills/wallet-import/` | 用户交给自己的 ChatGPT / Claude 的账单整理 skill，产出标准 CSV 再导入。由 `scripts/gen_import_skill.py` 从分类表生成。 |
| `infra/` | 生产形态栈：`Dockerfile.api`、`docker-compose.prod.yml`（Postgres + 迁移 + API + Caddy）、`Caddyfile`、操作手册 `RUNBOOK.md`。 |
| `docs/target-design/` | v3.0 设计文档。[`00-decisions.md`](docs/target-design/00-decisions.md) 是唯一事实来源，01–05 各章展开它，`mockups/` 是视觉稿。 |
| `docs/current-design/` | 重写前（v2）的现状记录，只作历史参考。 |
| `SPEC.md` | v1 时期的产品 / 工程规格，已被 `docs/target-design/` 取代。 |

## 本地运行

后端（Python 3.12，系统解释器，无 poetry）：

```bash
cd backend
DEBUG=true ENVIRONMENT=development SECRET_KEY=local-dev-secret DATABASE_URL=sqlite:///./wallet_local.db \
  python3 -m alembic upgrade head
DEBUG=true ENVIRONMENT=development SECRET_KEY=local-dev-secret DATABASE_URL=sqlite:///./wallet_local.db \
  ALLOWED_ORIGINS=http://localhost:8081 python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

前端：

```bash
cd frontend
npm install
EXPO_PUBLIC_API_BASE_URL=http://{host}:8000/api/v1 npx expo start --web --port 8081
```

`{host}` 在运行时换成页面自己的主机名：电脑上是 `localhost`，同一 Wi-Fi 的手机上是电脑的局域网 IP，一个包两边都能连。

## 测试与检查

```bash
cd backend && DEBUG=false SECRET_KEY=test-secret-key-for-tests-only python3 -m pytest -q
cd frontend && CI=1 npm run verify   # tsc + jest + build:web + PWA / 触控目标 / 对比度门禁
```

## 部署

生产形态栈的定义在 `infra/`，目标是一台 Oracle Cloud Always Free 的 A1.Flex 虚拟机（Docker Compose + Caddy 自动签证书）。步骤见 [`infra/RUNBOOK.md`](infra/RUNBOOK.md)。第九阶段正在把它落地。
