# 05 — 基础设施与运维（现状）

> **本文回答什么问题。** Wallet App 现在是怎么被构建、运行、部署和运维的：镜像里有什么，两个 Compose 文件各起哪些服务，Caddy 把请求路由到哪，配置与密钥从哪里读、有哪些变量，`infra/scripts/` 三个脚本各检查什么、哪里与代码不一致，本地怎样把开发环境或完整生产形态栈跑起来，Phase 6 规划了怎样的部署方案（**已规划、从未执行**），以及日志、监控、备份、迁移、回滚、安全的现状。全文只描述仓库现状，不提改法。

**仓库状态。** 分支 `main`，提交 `56881b2`（2026-09-03，"Merge branch 'gsd/phase-06-provision-oracle-vm-domain-caddy-https' into main"）。`infra/` 下所有文件最后一次改动在 2026-05-11 到 2026-05-26 之间（见 1.1 清单表中的 `git log -1 -- <file>` 结果）。

**一段话概括。** 整个生产形态（prod-shaped）栈由四个文件定义：`infra/Dockerfile.api`（仓库里唯一的 Dockerfile）、`infra/docker-compose.prod.yml`（Postgres + 一次性 Alembic 迁移 + FastAPI API + Caddy）、`infra/Caddyfile`（TLS 终止、`/api/*` 反向代理、静态 SPA 服务）和 `infra/.env.example`（被 gitignore 的 `infra/.env` 的模板）。另一个文件 `infra/docker-compose.dev.yml` 只起一个 Postgres 供本地开发。前端没有镜像：`npm run build:web` 产出 `frontend/dist/`，以只读 bind mount 方式挂进 Caddy 容器。仓库里**没有 CI 配置、没有已部署的 VM、没有备份任务、没有监控、没有回滚流程**；一份 1013 行的操作手册（`infra/RUNBOOK.md`）和 `infra/scripts/` 下三个 bash 脚本描述了"将来如何"部署到一台 Oracle A1.Flex VM。这次部署处于规划状态，从未执行过（`.planning/STATE.md:36,43-46`；`infra/runbook-evidence/` 目录里只有一个空的 `.gitkeep`）。

**证据约定。** `(path:line-range)` 指向仓库中的文件；"观测（2026-09-03）"表示在开发机上运行只读命令得到的结果（Docker 28.5.1、Compose v2.40.2；本地镜像 `caddy:alpine` = v2.11.3 `5190456911ce`、`postgres:15-alpine` `ba05c11fe977` = PostgreSQL 15.14、`wallet-app/api:local` `6557e09e9c62`）。

---

## 1. 清单与拓扑

### 1.1 定义基础设施的文件

| 路径 | 作用 | 最后提交 |
|---|---|---|
| `infra/Dockerfile.api` | FastAPI 后端多阶段镜像；`migrate` 服务复用同一镜像 | `a5512f8` 2026-05-23 |
| `backend/.dockerignore` | 构建上下文排除项（密钥、SQLite 文件、tests、缓存） | `2a0755f` 2026-05-11 |
| `infra/docker-compose.dev.yml` | 开发：仅 Postgres，发布到宿主机 5432 端口 | `3ff28fb` 2026-05-11 |
| `infra/docker-compose.prod.yml` | 生产形态栈：`db`、`migrate`、`api`、`caddy` | `a8be85d` 2026-05-25 |
| `infra/Caddyfile` | Caddy v2 配置：TLS、HSTS、压缩、路由、SPA 回退 | `570ff9e` 2026-05-25 |
| `infra/.env.example` | 已提交的模板，对应被 gitignore 的 `infra/.env`（14 个键） | `60ad324` 2026-05-25 |
| `infra/.env` | 真实值；被 gitignore（`.gitignore:16`）；本机存在，权限 `-rw-------`（观测） | 不适用 |
| `infra/scripts/env-coverage.sh` | 漂移检查：`backend/app/core/config.py` 里每个 `Settings` 字段必须出现在 `.env.example` | `8b0846e` 2026-05-22 |
| `infra/scripts/smoke.sh` | Phase 4 端到端笔记本验证器（构建镜像、构建前端、compose up、断言、拆栈） | `6dd0cfa` 2026-05-22 |
| `infra/scripts/verify-phase6.sh` | Phase 6 纯断言验证器（`quick` = 静态检查，`full` = 对着线上 VM） | `ed262d6` 2026-05-25 |
| `infra/RUNBOOK.md` | 操作手册：Oracle VM + Cloudflare 域名 + Let's Encrypt | `e5f133b` 2026-05-26 |
| `infra/runbook-evidence/.gitkeep` | 部署证据占位目录；其中的 PNG 被 gitignore（`.gitignore:25-26`） | 不适用 |
| `frontend/package.json`（`build:web`） | 产出 Caddy 所服务的 `frontend/dist/` | `5c73e40` 2026-05-25 |
| `frontend/workbox-config.cjs` | 在 `expo export` 之后生成 `dist/sw.js`（service worker） | `b31c40f` 2026-05-25 |

仓库里**不存在**（用 `find` 查过 `.github`、`.gitlab-ci.yml`、`Makefile`、`Procfile`、`fly.toml`、`render.yaml`、其他 `Dockerfile*` 与 `docker-compose*`、`*.service`）：任何 CI/CD 工作流、第二个 Dockerfile、仓库根目录的 compose 文件、备份脚本、systemd 单元。`find` 只命中 `infra/docker-compose.prod.yml`、`infra/docker-compose.dev.yml`、`infra/Dockerfile.api` 三个文件（观测）。

### 1.2 生产形态栈的运行时拓扑

```text
                 浏览器 / curl
                       |
                :80  /  :443            （整个栈只发布这两个端口：
                       |                  docker-compose.prod.yml:69-71）
   +-------------------v----------------------------------------------+
   | compose 项目 "infra"（网络：infra_default）                        |
   |                                                                  |
   |  caddy  (caddy:alpine, wallet_caddy_prod)                        |
   |    /etc/caddy/Caddyfile  <- bind ro  infra/Caddyfile             |
   |    /srv                  <- bind ro  frontend/dist               |
   |    /data                 <- volume   infra_caddy_data（证书）     |
   |    /config               <- volume   infra_caddy_config          |
   |     |  /api/* /health /docs* /openapi.json                       |
   |     |  reverse_proxy api:8000            其余全部路径：           |
   |     |                                    file_server /srv +      |
   |     v                                    SPA 回退 index.html     |
   |  api (wallet-app/api:local, wallet_api_prod, uid 1000)           |
   |    uvicorn app.main:app :8000（不发布到宿主机）                   |
   |     |  DATABASE_URL=postgresql://...@db:5432/...                 |
   |     v                                                            |
   |  db (postgres:15-alpine, wallet_db_prod)（不发布到宿主机）        |
   |    /var/lib/postgresql/data <- volume infra_wallet_pgdata_prod   |
   |    shared_buffers=3GB effective_cache_size=8GB max_connections=50|
   |                                                                  |
   |  migrate（与 api 同一镜像, wallet_migrate_prod, restart: no）     |
   |    只运行一次：alembic upgrade head，然后退出                     |
   +------------------------------------------------------------------+
```

卷与网络名称由 Compose 根据项目名 `infra`（即 compose 文件所在目录名）派生：`infra_default`、`infra_caddy_data`、`infra_caddy_config`、`infra_wallet_pgdata_prod`；dev 文件产生 `infra_postgres_data`，同样挂在 `infra_default` 网络上（对两个文件各运行 `docker compose config --format json` 观测）。容器名在文件里写死（`infra/docker-compose.prod.yml:8,38,48,63`；`infra/docker-compose.dev.yml:4`）。

---

## 2. 镜像

### 2.1 `infra/Dockerfile.api`（后端 API 与 migrate）

构建上下文是 `backend/`（由 compose 文件设置：`infra/docker-compose.prod.yml:34-36`；Dockerfile 注释 `infra/Dockerfile.api:16-17`）。文件头是 `# syntax=docker/dockerfile:1.6`（`infra/Dockerfile.api:1`）。文件里**不**固定 `--platform`；注释要求面向 Oracle 目标时在构建命令中传 `--platform linux/arm64`，否则用宿主机架构（`infra/Dockerfile.api:11-14`；该固定值在提交 `a5512f8`（2026-05-23）中被移除）。

原文（`infra/Dockerfile.api`，去掉注释行后的全部指令，行号为原文件行号）：

```dockerfile
 1  # syntax=docker/dockerfile:1.6
22  FROM python:3.11-slim AS builder
24  RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*
27  COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
34  RUN pip install --no-cache-dir poetry==1.8.5 "poetry-plugin-export>=1.8"
36  WORKDIR /app
38  COPY pyproject.toml poetry.lock ./
40  RUN poetry export -f requirements.txt --without-hashes --only main -o /tmp/requirements.txt
41  RUN uv pip install --system --no-cache -r /tmp/requirements.txt
48  RUN pip uninstall -y poetry poetry-plugin-export poetry-core || true \
49      && rm -f /usr/local/bin/poetry /usr/local/bin/poetry-* /bin/uv /bin/uvx
54  FROM python:3.11-slim AS runtime
56  RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*
61  RUN useradd -m -u 1000 appuser
63  WORKDIR /app
65  COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
66  COPY --from=builder /usr/local/bin /usr/local/bin
68  COPY --chown=appuser:appuser . .
70  USER appuser
72  EXPOSE 8000
76  HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status == 200 else 1)"
78  CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**阶段 1 — `builder`**（`infra/Dockerfile.api:22-49`）

| 步骤 | 行 | 说明 |
|---|---|---|
| 基础镜像 | 22 | `python:3.11-slim`，浮动 tag，无 digest |
| 系统依赖 | 24 | `gcc libpq-dev`，用于编译没有 wheel 的包；apt 列表在同一层删除 |
| uv | 27 | 从 `ghcr.io/astral-sh/uv:latest` 拷贝二进制，`latest` 未固定版本 |
| Poetry | 34 | `poetry==1.8.5` 加 `poetry-plugin-export>=1.8`；Poetry **只用于导出锁文件**，29-33 行注释解释选 1.8.5 的原因（原计划的 1.7.1 与插件版本要求冲突） |
| 工作目录 | 36 | `/app` |
| 锁文件输入 | 38 | 只拷贝 `pyproject.toml` 与 `poetry.lock` |
| 导出 | 40 | `poetry export -f requirements.txt --without-hashes --only main`：无哈希、只含 main 组（不含 dev 依赖） |
| 安装 | 41 | `uv pip install --system --no-cache`，装进 `/usr/local/lib/python3.11/site-packages` |
| 剥离 | 48-49 | 卸载 poetry、poetry-plugin-export、poetry-core（失败不中断），删除 `/usr/local/bin/poetry*`、`/bin/uv`、`/bin/uvx`；目的是让后面的 `COPY --from=builder /usr/local/bin` 不带上 Poetry/uv（注释 43-47 行） |

**阶段 2 — `runtime`**（`infra/Dockerfile.api:54-78`）

| 步骤 | 行 | 说明 |
|---|---|---|
| 基础镜像 | 54 | `python:3.11-slim` |
| 系统依赖 | 56 | `libpq5`（psycopg2 的运行时客户端库） |
| 用户 | 61 | `useradd -m -u 1000 appuser`，在 `WORKDIR`/`COPY` **之前**创建（58-60 行注释说明顺序原因） |
| 工作目录 | 63 | `/app` |
| 依赖 | 65-66 | 从 builder 拷贝 site-packages 与整个 `/usr/local/bin`（带来 `uvicorn`、`alembic` 命令，也带来 `pip`；观测镜像内 `pip 24.0` 存在） |
| 应用代码 | 68 | `COPY --chown=appuser:appuser . .`：整个 `backend/` 上下文减去 `.dockerignore` 排除项 |
| 切换用户 | 70 | `USER appuser`；观测镜像内 `uid=1000(appuser) gid=1000(appuser)` |
| 端口 | 72 | `EXPOSE 8000`，仅文档作用；compose 未发布此端口 |
| 健康检查 | 76 | 每 30 s、超时 3 s、启动宽限 5 s、3 次失败；用标准库 `urllib` 而非 `requests`（74-75 行注释）。compose 对 `api` 覆盖了此配置（见 3.2），对 `migrate` 未覆盖——镜像级健康检查会对一个从不监听的进程运行，但 `service_completed_successfully` 只看退出码不看健康状态 |
| 入口 | 78 | 没有 `ENTRYPOINT`；`CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`：单个 uvicorn 进程，没有 `--workers`，也没有显式传 `--proxy-headers`/`--forwarded-allow-ips`。注意 uvicorn 0.27.1 的 `proxy_headers` 默认就是 `True`（镜像内 `uvicorn/config.py:207`），代理头之所以不被采信，是因为 `forwarded-allow-ips` 默认只信任 `127.0.0.1`（`config.py:347`），而 Caddy 是从容器网络 IP 连入的（见 4.1 与 10.1） |

**本地构建镜像的观测内容**（`docker run --rm wallet-app/api:local sh -c 'ls -A /app; ...'`，2026-09-03）：`/app` 恰好包含 `.dockerignore alembic.ini app env.example migrations poetry.lock pyproject.toml`；`/app/.env` 不存在；`/app/tests` 不存在；`which poetry`、`which uv` 均无结果；`python --version` = 3.11.15；关键包 `fastapi 0.109.2`、`uvicorn 0.27.1`、`alembic 1.17.0`、`SQLAlchemy 2.0.44`、`pydantic 2.12.3`、`python-jose 3.5.0`、`bcrypt 5.0.0`、`passlib 1.7.4`、`httpx 0.26.0`、`starlette 0.36.3`。`docker image inspect` 报告 `Architecture=amd64`（在 x86_64 笔记本上未加 `--platform` 构建）、`User=appuser`、`WorkingDir=/app`、`ExposedPorts 8000/tcp`、`Entrypoint=[]`、大小 260 MB。

### 2.2 `backend/.dockerignore`

这是 `COPY . .` 的必要配套，否则 `backend/.env` 会被打进镜像。排除：`.env`、`.env.*`、`*.pem`、`*.key`（`backend/.dockerignore:6-9`）；`*.db`、`*.sqlite`、`*.sqlite3`（12-14 行，把本地 `backend/wallet_dev.db` 挡在外面）；Python 缓存与测试产物（17-26 行）；`.git/`、`.gitignore`、编辑器目录（29-33 行）；`README.md` 与 `tests/`（36-37 行）。`env.example` **没有**被排除，会随镜像发布（观测）。

### 2.3 现成镜像

| 服务 | 镜像 | tag 策略 | 本地观测 |
|---|---|---|---|
| `db`（prod）与 `db`（dev） | `postgres:15-alpine`（`infra/docker-compose.prod.yml:7`、`infra/docker-compose.dev.yml:3`） | 浮动 minor/patch | `ba05c11fe977`，10 个月前，`postgres --version` = 15.14 |
| `caddy` | `caddy:alpine`（`infra/docker-compose.prod.yml:62`） | 完全浮动（含 major） | v2.11.3，`5190456911ce` |

任何地方都没有固定镜像 digest。没有镜像仓库（registry）：API 镜像在运行 `docker compose ... --build` 的那台机器上构建，并打上 `wallet-app/api:local` 标签（`infra/docker-compose.prod.yml:37,47`）。Phase 7 计划推送到 GHCR（`.planning/REQUIREMENTS.md:61`），未开始。

### 2.4 没有 web 镜像：前端构建产物

前端以静态文件形式提供。`npm run build:web`（`frontend/package.json:10`）执行的是：

```text
rm -rf dist
&& cp src/constants/config.prod.ts src/constants/config.ts
&& expo export -p web
&& npx workbox generateSW workbox-config.cjs
&& cp src/constants/config.dev.ts src/constants/config.ts
```

- `config.prod.ts` 导出 `API_BASE_URL = '/api/v1'`（相对路径、同源；`frontend/src/constants/config.prod.ts:5`）；`config.dev.ts` 导出 `'http://localhost:8000/api/v1'`（`frontend/src/constants/config.dev.ts:7`）。`config.ts` 已提交进 git，静止状态下与 `config.dev.ts` 逐字节相同（`git ls-files frontend/src/constants` 列出三个文件；`diff -q` 无差异，观测）；`config.ts:1-6` 的头注释说明它是自动管理的。axios 客户端把 `API_BASE_URL` 作为 `baseURL`，超时 10 s（`frontend/src/api/client.ts:3,8-10`）。
- 由于整条命令用 `&&` 串联，`expo export` 失败时 `config.ts` 会停留在 prod 副本，直到下一次成功构建（没有 trap/恢复）。`config.ts` 的状态：

```text
  config.ts == config.dev.ts（静止态，已提交）
        |  cp config.prod.ts -> config.ts
        v
  config.ts == config.prod.ts（构建中）
        |  expo export 成功 && workbox 成功 && cp config.dev.ts -> config.ts
        v
  config.ts == config.dev.ts
        （若 expo export 或 workbox 失败：停留在 prod 副本，工作树出现脏改动）
```

- `expo export -p web` 写出 `dist/`，内含 `frontend/public/` 的内容（`index.html` 模板、`manifest.json`、`offline.html`、`pwa.css`、图标）加上一个带哈希的 bundle `dist/_expo/static/js/web/index-<hash>.js`（观测：`index-6b8f62b235df4cff10dc042e9ef97d75.js`，由 `dist/index.html` 里 Expo 插入的 `<script src="..." defer>` 引用）。观测到的 `dist/` 清单：`192.png 512-maskable.png 512.png _expo/ apple-touch-icon.png favicon.ico index.html manifest.json metadata.json offline.html pwa.css sw.js sw.js.map workbox-35f09345.js workbox-35f09345.js.map`。
- Workbox 随后根据 `frontend/workbox-config.cjs` 写出 `dist/sw.js` 与 `dist/workbox-<hash>.js`：预缓存 `dist/` 下所有 `js/css/html/png/svg/jpg/jpeg/webp/woff/woff2/ico/json` 文件，但排除 `sw.js`、`workbox-*.js`（`frontend/workbox-config.cjs:26-29`）；`skipWaiting`、`clientsClaim`、`cleanupOutdatedCaches` 全为 `true`（30-32 行）；`navigateFallback: '/offline.html'`，且 `/^\/api/` 在 denylist 中（33-34 行）；`dontCacheBustURLsMatching` 信任 Expo 的 20 位以上十六进制哈希文件名（35 行）；运行时缓存四条（36-76 行）：`/` 与 `/index.html` 用 `NetworkFirst`（3 s，`app-shell`）；URL 含 `/api/` 用 `NetworkFirst`（5 s，缓存状态 0/200，`api-cache`）；字体 `CacheFirst` 30 天；图片 `CacheFirst` 30 天。
- `frontend/dist/` 被 gitignore（`frontend/.gitignore:7`；`.gitignore:19`），新克隆的仓库在运行 `npm run build:web` 之前没有 bundle；此时 compose 的 bind mount `../frontend/dist:/srv:ro`（`infra/docker-compose.prod.yml:74`）指向空目录或不存在的目录，Caddy 只能返回 404 或没有 `index.html` 的回退。
- `frontend/dist/` 里 `grep -c 'localhost:8000'` 为 0（观测），与 `smoke.sh` 第 7 步的断言一致。

---

## 3. Compose

### 3.1 `infra/docker-compose.dev.yml`（开发：仅 Postgres）

| 键 | 值 | 出处 |
|---|---|---|
| 服务 | 只有 `db`；注释写明 "Dev compose intentionally db-only" | `infra/docker-compose.dev.yml:2,20-22` |
| 镜像 | `postgres:15-alpine` | 3 行 |
| 容器名 | `wallet_db` | 4 行 |
| restart | `unless-stopped` | 5 行 |
| environment | `POSTGRES_USER=wallet_user`、`POSTGRES_PASSWORD=wallet_password`、`POSTGRES_DB=wallet_db`（写死，无 env_file） | 6-9 行 |
| ports | `5432:5432` 发布到宿主机 | 10-11 行 |
| volume | `postgres_data:/var/lib/postgresql/data`，实际名 `infra_postgres_data` | 12-13、24-25 行 |
| healthcheck | `pg_isready -U wallet_user -d wallet_db`，间隔 10 s、超时 5 s、5 次重试 | 14-18 行 |
| 网络 | 隐式 `infra_default` | 观测 |

这组凭据与代码默认值 `DATABASE_URL = "postgresql://wallet_user:wallet_password@localhost:5432/wallet_db"`（`backend/app/core/config.py:12`）完全一致，所以本地 uvicorn 在完全没有 `.env` 的情况下也能连上这个库。

### 3.2 `infra/docker-compose.prod.yml`（生产形态栈）

文件头注释给出两条生命周期命令：`docker compose -f infra/docker-compose.prod.yml up -d --wait` 与 `docker compose -f infra/docker-compose.prod.yml down -v`（`infra/docker-compose.prod.yml:1-3`；注意拆栈命令带 `-v`，会删除命名卷——RUNBOOK 在 VM 上明令禁止此命令，`infra/RUNBOOK.md:596,959-963`，见 4.4 与 9.3）。

| | `db` | `migrate` | `api` | `caddy` |
|---|---|---|---|---|
| 行号 | 6-31 | 33-44 | 46-59 | 61-79 |
| image / build | `postgres:15-alpine` | `build: context ../backend, dockerfile ../infra/Dockerfile.api`；`image: wallet-app/api:local`（构建结果打上这个名字） | `image: wallet-app/api:local`（无 `build:`，复用 `migrate` 构建的 tag） | `caddy:alpine` |
| 容器名 | `wallet_db_prod` | `wallet_migrate_prod` | `wallet_api_prod` | `wallet_caddy_prod` |
| restart | `unless-stopped` | `"no"` | `unless-stopped` | `unless-stopped` |
| env_file | `./.env`（全部键） | `./.env` | `./.env` | 无 |
| environment | `POSTGRES_USER/PASSWORD/DB` 再次从 `${...}` 声明（12-14 行） | 无 | 无 | `CADDY_DOMAIN: ${CADDY_DOMAIN:-localhost}`、`CADDY_TLS_MODE: ${CADDY_TLS_MODE:-internal}`、`CADDY_ACME_CA: ${CADDY_ACME_CA:-}`（65-68 行） |
| command | `postgres -c shared_buffers=3GB -c effective_cache_size=8GB -c max_connections=50`（15-22 行，exec 形式数组） | `["alembic", "upgrade", "head"]`（40 行） | 镜像 CMD（uvicorn） | 镜像默认（`caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`） |
| shm_size | `1g`（23 行）——3 GB `shared_buffers` 超过 `/dev/shm` 默认 64 MB，不加会导致 Postgres 重启循环（`.planning/phases/04-containerize-and-compose-locally/04-05-SUMMARY.md:87`） | 无 | 无 | 无 |
| ports | 无 | 无 | 无 | `80:80`、`443:443`（69-71 行） |
| volumes | `wallet_pgdata_prod:/var/lib/postgresql/data`（24-25 行） | 无 | 无 | `./Caddyfile:/etc/caddy/Caddyfile:ro`、`../frontend/dist:/srv:ro`、`caddy_data:/data`、`caddy_config:/config`（72-76 行） |
| depends_on | 无 | `db: condition: service_healthy`（42-44 行） | `migrate: condition: service_completed_successfully`（51-53 行） | `api: condition: service_healthy`（77-79 行） |
| healthcheck | `pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}`（`$$` 让 Compose 不做插值、由容器内 shell 展开），10 s / 5 s / 5 次 / `start_period: 30s`（26-31 行） | 无（镜像 HEALTHCHECK 生效，见 2.1） | 用 urllib 探测 `http://localhost:8000/health`，15 s / 3 s / 5 次 / `start_period: 10s`（54-59 行），覆盖镜像的 30 s / 3 次 | 无 |

命名卷在 81-84 行声明：`wallet_pgdata_prod`、`caddy_data`、`caddy_config`。文件里没有 `networks:` 段；任何服务都没有资源限制（`cpus`、`mem_limit`）、没有 `logging:`、没有 `read_only`、没有 `cap_drop`、没有 `user:` 覆盖。

### 3.3 `.env` 如何到达每个容器

通过 `docker compose config` 观测：`db`、`migrate`、`api` 各自收到本机 `infra/.env` 里全部 13 个键（`ACCESS_TOKEN_EXPIRE_MINUTES ALGORITHM ALLOWED_ORIGINS CADDY_DOMAIN CADDY_TLS_MODE DATABASE_URL DEBUG ENVIRONMENT EXCHANGE_RATE_API_URL POSTGRES_DB POSTGRES_PASSWORD POSTGRES_USER SECRET_KEY`）；`caddy` 只收到 `CADDY_DOMAIN`、`CADDY_TLS_MODE`、`CADDY_ACME_CA`（04-05 的决策：Caddy 绝不走 env_file，避免代理被攻破时泄露数据库凭据，`.planning/phases/04-containerize-and-compose-locally/04-05-SUMMARY.md:43`）。env 文件里 `DATABASE_URL` 中的 `${POSTGRES_USER}` 等引用由 Compose 的 env-file 解析器展开：解析后的 `DATABASE_URL` 以 `@db:5432/<db>` 结尾，不残留 `${`（观测）。YAML 里 Compose 自身的 `${...}` 插值（12-14、66-68 行）同样从 `infra/.env` 取值，因为项目目录就是 `infra/`。

### 3.4 启动流程（`docker compose -f infra/docker-compose.prod.yml up -d --build --wait`）

1. Compose 用 `infra/Dockerfile.api` 从 `backend/` 构建 `wallet-app/api:local`（只有 `migrate` 有 `build:` 块，34-36 行）。不加 `--build` 时复用已有的本地 tag `wallet-app/api:local`；tag 不存在时 Compose 先为带 `build:` 的 `migrate` 服务构建该镜像，`api` 随后复用同一 tag（依据 Compose v2 的镜像准备顺序，本文档未实测；与 README §5.4 一致）。
2. `db` 启动。只有当 `infra_wallet_pgdata_prod` 为空时 Postgres 才运行 `initdb`（使用 `POSTGRES_USER/PASSWORD/DB`）；否则直接打开已有集群，环境变量只被健康检查使用。`pg_isready` 成功后 `db` 变为 healthy（最多 30 s 宽限 + 5 × 10 s）。
3. `migrate` 启动（`depends_on db healthy`），以 uid 1000 在 `/app` 下运行 `alembic upgrade head`（细节见 9.4）并退出。需要退出码 0；非零退出会中止序列（"dependency failed to start"），`up` 返回非零。
4. `api` 启动（`depends_on migrate completed successfully`）。uvicorn 在网络内的 `0.0.0.0:8000` 服务 `app.main:app`。`create_engine` 在 import 时不连接数据库（`backend/app/core/database.py:33`），所以即使数据库不可用进程也能起来。`GET /health` 返回 200 后 `api` 变为 healthy（10 s 宽限、15 s 间隔、5 次重试）。
5. `caddy` 启动（`depends_on api healthy`），用三个 `CADDY_*` 环境变量解析 `/etc/caddy/Caddyfile`，绑定 `:80` 与 `:443`，并按 4.5 节配置 TLS。若 Caddyfile 无法适配（adapt），容器退出，`restart: unless-stopped` 让它反复重启。
6. `--wait` 在 `db`、`api` 为 healthy、`migrate` 退出码 0、`caddy` 处于 running（它没有健康检查）时返回。

服务状态机（按 Compose 的判定）：

```text
db:       created --> starting --(pg_isready ok)--> healthy --(连续 5 次失败)--> unhealthy
migrate:  created --(db healthy)--> running --> exited(0)    [放行 api]
                                             \-> exited(!0)  [api 永不启动]
api:      created --(migrate exited 0)--> starting --(/health 200)--> healthy
caddy:    created --(api healthy)--> running         （无健康状态）
```

**宿主机重启之后**，Docker 按 `unless-stopped` 策略各自独立重启 `db`、`api`、`caddy`；守护进程不会重新评估 `depends_on` 条件，`migrate`（`restart: "no"`）不会再跑。之后再执行一次 `docker compose up -d`，Compose 会重新启动已退出的 `migrate` 容器，于是 `alembic upgrade head` 会在 `api` 被（重新）启动之前再跑一次（没有新 revision 时是幂等的）。

### 3.5 前端如何到达 Caddy

没有拷贝步骤。宿主机上的 `frontend/dist/` 以只读方式 bind mount 到 `/srv`（`infra/docker-compose.prod.yml:74`），Caddyfile 设置 `root * /srv`（`infra/Caddyfile:29`）。重新执行 `npm run build:web` 的结果会被正在运行的 Caddy 容器立即看到；构建脚本开头的 `rm -rf dist` 会在活动挂载下短暂删掉这个目录（Phase 4 的 D-12 为快速迭代刻意选择了这种方式：`.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md:53`）。在规划中的 VM 上，RUNBOOK 让操作者用 `scp -P 23333 -r dist deploy@<vm-ip>:~/wallet_app/frontend/` 拷贝笔记本上的构建结果，或在装了 Node 的 VM 上构建（`infra/RUNBOOK.md:516-533`）。

---

## 4. Caddy

完整文件（`infra/Caddyfile`，33 行）：

```text
{
    acme_ca {$CADDY_ACME_CA:https://acme-v02.api.letsencrypt.org/directory}
}

{$CADDY_DOMAIN:localhost} {
    tls {$CADDY_TLS_MODE:internal}

    header Strict-Transport-Security "max-age=31536000; includeSubDomains"

    encode zstd gzip

    handle /api/* {
        reverse_proxy api:8000
    }

    handle /health {
        reverse_proxy api:8000
    }

    handle /docs* {
        reverse_proxy api:8000
    }

    handle /openapi.json {
        reverse_proxy api:8000
    }

    handle {
        root * /srv
        try_files {path} /index.html
        file_server
    }
}
```

### 4.1 路由

`handle` 块互斥；Caddy 选取最具体的路径匹配器，无匹配器的 `handle` 是兜底。解析后的路由表：

| 请求路径 | 处理块 | 上游 / 结果 |
|---|---|---|
| `/api/` 加任意后缀（如 `/api/v1/auth/login`、`/api/v1/transactions?...`） | `handle /api/*`（`infra/Caddyfile:12-14`） | `reverse_proxy api:8000`，路径原样保留（用的是 `handle` 而非 `handle_path`；决策记录在 `.planning/phases/04-containerize-and-compose-locally/04-05-SUMMARY.md:42`），FastAPI 看到的就是 `/api/v1/...`，即所有路由器挂载的位置（`backend/app/main.py:27-30`） |
| `/health` | `infra/Caddyfile:16-18` | 代理；FastAPI `GET /health`（`backend/app/main.py:33-40`） |
| `/docs`、`/docs/...`、`/docsanything` | `infra/Caddyfile:20-22` | 代理；FastAPI Swagger UI |
| `/openapi.json` | `infra/Caddyfile:24-26` | 代理 |
| `/api`（无尾部斜杠）、`/redoc`、`/` 及其他所有路径 | 兜底 `infra/Caddyfile:28-32` | `try_files {path} /index.html`：路径在 `/srv` 下存在（如 `/sw.js`、`/manifest.json`、`/offline.html`、`/_expo/static/js/web/index-<hash>.js`、`/192.png`）就原样返回；否则返回 `/srv/index.html`，状态 200（SPA 回退）。因此 FastAPI 自己的 `GET /` JSON（`backend/app/main.py:43-51`）与 `/redoc` 经由 Caddy 无法访问 |

`/health`、`/docs*`、`/openapi.json` 三个块由提交 `9a0c6bd`（2026-05-23，"fix(caddy): proxy /health /docs /openapi.json to api (not SPA fallback)"）加入；在此之前 Phase 4 的栈对 `/health` 返回的是 `index.html`。

`reverse_proxy api:8000` 通过 Docker 在 `infra_default` 上的内置 DNS 解析 `api`。Caddy 的 `reverse_proxy` 默认会加上 `X-Forwarded-For`、`X-Forwarded-Proto`、`X-Forwarded-Host`；uvicorn 不信任它们，因为 `--forwarded-allow-ips` 默认是 `'127.0.0.1'`（在镜像内运行 `uvicorn --help` 观测），而 Caddy 是从容器 IP 连过来的——所以 API 看到的客户端地址是 Caddy 的地址、协议是 `http`。当前应用代码没有任何地方读客户端 IP 或协议，因此目前没有功能影响。

### 4.2 请求经过整个栈的流程（浏览器加载应用、再调用 API）

1. 浏览器请求 `https://localhost/`（笔记本）或 `https://<domain>/`。
2. Caddy 按 4.5 节选出的证书终止 TLS；兜底块返回 `/srv/index.html`（`infra/Caddyfile:28-32`），加上 `Strict-Transport-Security: max-age=31536000; includeSubDomains`（8 行；在适配后的 JSON 里表现为站点所有响应都经过的一个 `headers` 处理器，观测），并对符合条件的响应做压缩（`encode zstd gzip`，10 行；适配后 `prefer: ["zstd","gzip"]`，观测）。
3. `index.html` 加载 `/_expo/static/js/web/index-<hash>.js`、`/pwa.css`、`/manifest.json`、`/favicon.ico`，全部由 `/srv` 静态返回。应用注册 `/sw.js`；service worker 预缓存 2.4 节列出的资源并应用运行时策略。
4. bundle 用 `baseURL = '/api/v1'`（相对路径）通过 axios 发请求，例如 `POST https://localhost/api/v1/auth/login`。同源，没有 CORS 预检。
5. Caddy 命中 `handle /api/*`，转发到 `http://api:8000/api/v1/auth/login`。
6. FastAPI 处理（CORS 中间件存在但同源请求不会触发），返回 JSON；Caddy 转发，附加 HSTS 头并可能压缩。

经 Caddy 访问 `GET /health`，在 `ENVIRONMENT=production` 时返回（`backend/app/main.py:36-40`）：

```json
{"status":"healthy","environment":"production","version":"0.1.0"}
```

而 `GET /api/v1/health` 返回的是（不存在这条路由；只有根路径下的 `/health`，`backend/app/main.py:33`；`grep -rn health backend/app` 只命中 `main.py`）：

```json
{"detail":"Not Found"}
```

### 4.3 环境变量展开（`{$VAR:default}`）

Caddy 在解析之前先替换 `{$VAR}` / `{$VAR:default}` 记号。compose 文件总是把三个变量传进容器，在 `infra/.env` 缺失或为空时用默认值补上（`infra/docker-compose.prod.yml:66-68`）。用栈实际使用的镜像（`caddy:alpine` = v2.11.3）在 2026-09-03 运行 `caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile` 的观测结果：

| 容器环境 | 站点得到的 TLS 自动化策略 |
|---|---|
| `CADDY_DOMAIN=example.com`，`CADDY_TLS_MODE` 未设，`CADDY_ACME_CA` 未设 | `issuers: [{module: internal}]`——Caddyfile 自身默认值 `internal` 生效 |
| `CADDY_DOMAIN=example.com`，`CADDY_TLS_MODE=internal`，`CADDY_ACME_CA` 未设 | `issuers: [{module: internal}]` |
| `CADDY_DOMAIN=example.com`，`CADDY_TLS_MODE=ops@example.com`，`CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` | `issuers: [{module: acme, ca: <staging>, email: ops@example.com}, {module: acme, ca: https://acme.zerossl.com/v2/DV90, email: ...}]`——只有当 `tls` 的唯一参数是邮箱而非 `internal` 时才走 ACME |
| `CADDY_DOMAIN=localhost`，`CADDY_TLS_MODE=internal`，`CADDY_ACME_CA` 未设（笔记本） | `issuers: [{module: internal}]` |
| `CADDY_DOMAIN=example.com`，`CADDY_ACME_CA=`（已设但为空） | **adapt 失败**：`Error: parsing caddyfile tokens for 'acme_ca': wrong argument count or unexpected line ending after 'acme_ca', at /etc/caddy/Caddyfile:2` |
| `CADDY_DOMAIN=example.com`，`CADDY_TLS_MODE=`（已设但为空） | **adapt 失败**：`Error: parsing caddyfile tokens for 'tls': wrong argument count or unexpected line ending after 'tls', at /etc/caddy/Caddyfile:6`（这个情况经 compose 不会出现，因为 `${CADDY_TLS_MODE:-internal}` 会把空值替换为 `internal`） |

每种情况下适配结果中都另有一条 `subjects` 为空、issuer 为 `acme` 且 `ca` 取自 `acme_ca` 全局选项的策略（观测），它是全局默认策略，对本站点不生效，因为站点有自己的更具体策略。

理解现状必须掌握的两个后果（上表证据加 compose config）：

- **容器里 `CADDY_ACME_CA` 总是被设置的**（`infra/docker-compose.prod.yml:68` 的 `${CADDY_ACME_CA:-}` 在 `.env` 缺少该键或值为空时产生空字符串；`docker compose config` 观测到 `CADDY_ACME_CA: ''`）。用模板出厂值 `CADDY_ACME_CA=`（`infra/.env.example:44`）或者不写该键（本机 `infra/.env` 就没有这个键，观测），Caddy 在 compose 提供的环境里解析 Caddyfile 都会得到上表的解析错误。因此这个栈里的 Caddy 只有在 `infra/.env` 里给出非空 ACME 目录 URL 时才能启动。`verify-phase6.sh quick` 抓不到这一点，因为它在完全没有环境变量的情况下运行 `caddy validate`（`infra/scripts/verify-phase6.sh:43-46`），默认值会生效。`06-01-SUMMARY.md` 记录了与此一致的判断（"Caddy 的 `{$VAR:default}` 只在变量未设时回退默认值，空字符串不会"，`.planning/phases/06-provision-oracle-vm-domain-caddy-https/06-01-SUMMARY.md:81`），但 `.env.example:42`、`RUNBOOK.md:581-587` 和 `verify-phase6.sh:94` 的文案仍然是"设为空"。
- **`CADDY_TLS_MODE` 无法通过 `.env` "取消设置"**：compose 默认值（`infra/docker-compose.prod.yml:67`）与 Caddyfile 默认值（`infra/Caddyfile:6`）都是 `internal`。删除或清空该键——RUNBOOK 对 VM 的指示正是如此（`infra/RUNBOOK.md:485,502-503`）——得到的仍是 `tls internal`，即用 Caddy 本地 CA 给真实域名签证书，Let's Encrypt 永远不会被联系（上表第 1、2 行）。`.env.example` 里"注释掉会让 Caddy 回退到 ACME"的说明（`infra/.env.example:34-35`）和 `04-CONTEXT.md` 里的同类描述（`.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md:48`）与此行为不符。

### 4.4 TLS、响应头、限制

- **TLS 模式。** `tls {$CADDY_TLS_MODE:internal}`（`infra/Caddyfile:6`）。笔记本上（`CADDY_DOMAIN=localhost`、`CADDY_TLS_MODE=internal`，`infra/.env.example:36-37`）Caddy 用内部 CA 签发证书，存于 `infra_caddy_data` 卷的 `/data/caddy/certificates/local/` 下，浏览器在信任本地根证书之前会显示警告（`.planning/phases/04-containerize-and-compose-locally/04-VERIFICATION.md:11-13` 把它列为待人工确认项）。TLS 协议版本与密码套件都是 Caddy 默认值（没有 `protocols`/`ciphers` 子选项）。
- **ACME CA。** 全局 `acme_ca`（`infra/Caddyfile:1-3`），默认值显式写为 Let's Encrypt 生产目录；意图（Phase 6 D-05，`.planning/phases/06-provision-oracle-vm-domain-caddy-https/06-CONTEXT.md:26`）是先 staging 再生产，由 `CADDY_ACME_CA` 驱动。证书与 ACME 账户状态持久化在 `infra_caddy_data`（`/data`），这也是 RUNBOOK 禁止 `down -v` 的原因（`infra/RUNBOOK.md:596,959-963`）。
- **HSTS。** `header Strict-Transport-Security "max-age=31536000; includeSubDomains"` 作用于站点所有响应，无 `preload`（`infra/Caddyfile:8`；D-19 `06-CONTEXT.md:58`）。在笔记本上用自签证书时同样会发出——Phase 4 正因为这个原因把 HSTS 推迟（`04-CONTEXT.md:49`），Phase 6 还是加了，RUNBOOK 用"staging 期间只用无痕窗口打开"来规避（`infra/RUNBOOK.md:554-562`）。
- **压缩。** `encode zstd gzip`（`infra/Caddyfile:10`）对代理响应与静态响应都生效（Caddy 默认最小尺寸阈值适用）。
- **端口。** 发布 `80` 与 `443`（`infra/docker-compose.prod.yml:69-71`）；80 端口用于 Caddy 的 HTTP-01 挑战响应和自动 HTTP 到 HTTPS 重定向（Caddy 自动 HTTPS 的默认行为）。适配后的站点服务器监听 `:443`（观测 `listen [":443"]`）。
- **不存在的东西：** 没有 `request_body max_size`（边缘没有请求体限制；FastAPI/uvicorn 也没有），服务器没有 `timeouts`，`reverse_proxy` 没有 `transport` 超时（Caddy 默认值），没有 `log` 指令（Caddy 只把 JSON 运行日志写到 stderr；**没有 HTTP 访问日志**），没有限流（stock 镜像也不带 `rate_limit` 模块），没有 `basicauth`，SPA 资源没有 `Cache-Control` 头（浏览器用启发式缓存；service worker 自己管理缓存）。

---

## 5. 配置与密钥

### 5.1 配置从哪里读

- API 读 pydantic-settings 的 `Settings` 类（`backend/app/core/config.py:8-38`）：先环境变量，再**当前工作目录**下的 `.env` 文件（`env_file=".env"`，34 行），`case_sensitive=True`、`extra="allow"`（36-37 行，所以容器环境里 `POSTGRES_USER` 之类无关键不会报错）。模块级单例 `settings = Settings()` 在 import 时创建（47 行）。容器里 `WORKDIR /app` 下没有 `.env`（被 `backend/.dockerignore:6` 排除），只有 compose `env_file` 注入的进程环境生效。本地 uvicorn 只有从 `backend/` 目录启动时才会读到 `backend/.env`。
- Alembic 读同一个 `settings.DATABASE_URL`（`backend/migrations/env.py:14,22`），覆盖 `backend/alembic.ini:87` 里的占位值 `sqlalchemy.url = driver://user:pass@localhost/dbname`。
- Caddy 只从容器环境读 `CADDY_DOMAIN`、`CADDY_TLS_MODE`、`CADDY_ACME_CA`（4.3）。
- Postgres 在首次初始化时和健康检查中读 `POSTGRES_USER/PASSWORD/DB`。

### 5.2 每一个变量

| 变量 | 代码默认值（`backend/app/core/config.py`） | `backend/env.example`（dev） | `infra/.env.example`（prod 模板） | 谁读 | 用途 / 备注 |
|---|---|---|---|---|---|
| `POSTGRES_USER` | 无（不是 Settings 字段） | 无 | `CHANGE_ME_POSTGRES_USER`（12 行） | `db`（initdb + 健康检查，compose 12-14、27 行）；compose 插值 | 也通过 `${POSTGRES_USER}` 嵌进 `DATABASE_URL`（17 行） |
| `POSTGRES_PASSWORD` | 无 | 无 | `CHANGE_ME_POSTGRES_PASSWORD`（13 行） | `db` | 密钥 |
| `POSTGRES_DB` | 无 | 无 | `CHANGE_ME_POSTGRES_DB`（14 行） | `db` | |
| `DATABASE_URL` | `postgresql://wallet_user:wallet_password@localhost:5432/wallet_db`（12 行） | 与代码默认值相同（2 行） | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`（17 行） | `api`、`migrate`（`backend/app/core/database.py:19,33`；`backend/migrations/env.py:22`） | 栈内主机名必须是 compose 服务名 `db`。测试覆盖为 `sqlite:///:memory:`（`backend/tests/conftest.py:10`） |
| `SECRET_KEY` | `your-secret-key-change-this-in-production`（15 行） | 占位字符串（5 行） | `CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32`（20 行） | `api`（`backend/app/core/security.py:59,77` 签发/校验 JWT） | 密钥。没有任何校验：缺失或哨兵值都会被接受并用来签令牌（`.planning/codebase/CONCERNS.md:33-53`）；`.env.example:9` 所说的"漏替换会大声失败"在代码和 compose 里没有对应实现——哨兵凭据会被原样使用 |
| `ALGORITHM` | `HS256`（16 行） | `HS256`（6 行） | `HS256`（22 行） | `api` | JWT 算法 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30`（17 行） | `30`（7 行） | `30`（21 行） | `api`（`backend/app/core/security.py:56`） | JWT 有效期 |
| `API_V1_PREFIX` | `/api/v1`（20 行） | `/api/v1`（10 行） | 无（被 `env-coverage.sh:19` 排除） | **没有人读**——`backend/app/main.py:27-30` 用字面量 `"/api/v1"` 挂载路由器；全仓库 grep 只在 `config.py:20` 与 `env-coverage.sh:15,19` 出现 | 死设置 |
| `PROJECT_NAME` | `Wallet App API`（21 行） | 已设（11 行） | 无（被排除） | `api`（`backend/app/main.py:12` OpenAPI 标题） | |
| `DEBUG` | `False`（22 行） | `True`（12 行） | `False`（32 行） | `api`（`backend/app/main.py:13` FastAPI debug；`backend/app/core/database.py:21` 仅当 `ENVIRONMENT == "development"` 且 `DEBUG` 时打开 SQL echo） | 测试固定了默认值（`backend/tests/test_config.py:7-9`） |
| `ALLOWED_ORIGINS` | `http://localhost:8081,http://localhost:19006,http://localhost:3000`（25 行） | 相同（15 行） | `https://CHANGE_ME_YOUR_DOMAIN`（25 行） | `api`（`backend/app/main.py:20` 经 `allowed_origins_list` 逗号拆分并去空白，`config.py:40-43`） | CORS 白名单 |
| `EXCHANGE_RATE_API_URL` | `https://api.frankfurter.app`（28 行） | 相同（18 行） | `https://api.frankfurter.dev/v1`（28 行） | `api`（`backend/app/services/rates.py:41,80` 拼接 `/currencies` 与 `/latest`） | dev 与 prod 模板指向两个不同的 Frankfurter 主机 |
| `ENVIRONMENT` | `development`（31 行） | `development`（21 行） | `production`（31 行） | `api`（`backend/app/main.py:38` 回显在 `/health`；`backend/app/core/database.py:21`） | |
| `CADDY_DOMAIN` | 无 | 无 | `localhost`（36 行） | `caddy`（compose 66 行 → `infra/Caddyfile:5`） | 站点地址 |
| `CADDY_TLS_MODE` | 无 | 无 | `internal`（37 行） | `caddy`（compose 67 行 → `infra/Caddyfile:6`） | `tls` 的唯一参数；见 4.3 |
| `CADDY_ACME_CA` | 无 | 无 | 空（44 行），注释里给出 staging URL（43 行） | `caddy`（compose 68 行 → `infra/Caddyfile:2`） | 见 4.3 |

本机 `infra/.env` 现有的键（值不列出）：3.3 节列出的 13 个键——`CADDY_ACME_CA` 不在其中（观测）。文件权限 `-rw-------`（观测），符合 `.env.example:6` 的 `chmod 600` 指示。

### 5.3 git 与镜像中的密钥处理

- `.gitignore` 忽略 `.env`、`.env.local`（12-13 行）、`infra/.env`（16 行）、`frontend/dist/`（19 行）、`infra/runbook-evidence/*.png` 但保留 `.gitkeep`（25-26 行）、`.claude/`（5 行）。`backend/.gitignore:31` 忽略 `backend/.env`；`frontend/.gitignore:31-32` 忽略 `.env*.local` 与 `.env`。`git check-ignore -v` 确认 `infra/.env`、`backend/.env`、`frontend/dist`、`infra/runbook-evidence/uptime-alert.png` 都被忽略（观测）。
- 已提交的模板：`infra/.env.example` 与 `backend/env.example`（无前导点）。
- 镜像永远不含 `.env`（`backend/.dockerignore:6-7`；观测不存在）。密钥只通过 compose 的 `env_file`/`environment` 进入容器，这意味着宿主机上 `docker inspect` 与 `docker compose config` 的输出里能看到它们。
- 没有密钥管理器、没有 SOPS、没有 Docker secrets。Phase 6 规划在 VM 上 `chmod 600`（`infra/RUNBOOK.md:467-476`），Phase 7 规划由 CI 经 SSH 注入（`.planning/REQUIREMENTS.md:67`）；两者都不存在。

### 5.4 `infra/scripts/env-coverage.sh` 强制了什么

机制（`infra/scripts/env-coverage.sh`）：

1. 从脚本自身位置解析 `REPO_ROOT`；要求 `backend/app/core/config.py` 与 `infra/.env.example` 存在，否则打印 `missing <path>` 到 stderr 并退出 1（7-12 行）。
2. `required` = `config.py` 中所有匹配 `^\s+[A-Z][A-Z_0-9]+:\s` 的行（缩进的 UPPER_SNAKE 带类型注解属性），减去 `API_V1_PREFIX` 与 `PROJECT_NAME`（17-20 行）。今天这一步得到 8 个名字：`ACCESS_TOKEN_EXPIRE_MINUTES ALGORITHM ALLOWED_ORIGINS DATABASE_URL DEBUG ENVIRONMENT EXCHANGE_RATE_API_URL SECRET_KEY`（观测；正则原始命中 10 个，含被排除的 2 个）。
3. `declared` = `.env.example` 中每个行首的 `KEY=`（22-24 行；今天 14 个键）。
4. `comm -23 required declared` = 模板里缺少的必需名字（26 行）。非空则向 stderr 打印 `MISSING in <path>:` 加名字列表并退出 1（28-32 行）；否则打印 `OK: all 8 Settings fields in <config.py> appear in <.env.example>` 并退出 0（34 行；观测输出与此一致，退出码 0）。

它**不**检查：值或哨兵、真实的 `infra/.env`、模板里多出来的键、非 Settings 键（`POSTGRES_*`、`CADDY_*`——删掉它们脚本也不会失败；记录于 `.planning/phases/04-containerize-and-compose-locally/04-04-env-secrets-SUMMARY.md:82-86` 与 `.planning/STATE.md:94-95`），也不检查以非缩进或小写方式声明的 `Settings` 字段。

---

## 6. 脚本（`infra/scripts/`）

三个脚本都是 `-rwxr-xr-x`、`#!/usr/bin/env bash`、`set -euo pipefail`，并从自身路径解析仓库根目录（`REPO_ROOT`）。`smoke.sh` 与 `verify-phase6.sh` 向 stdout 打印 `==> 步骤` 行、失败时打印 `FAIL: 原因`；`env-coverage.sh` 没有 `==>`/`FAIL:` 前缀，失败时向 stderr 打印 `missing <path>` 或 `MISSING in <path>:` 加名字列表，成功时向 stdout 打印一行 `OK: ...`（见 5.4）。

### 6.1 `env-coverage.sh`

用法 `bash infra/scripts/env-coverage.sh`。退出 0 = 所有必需 Settings 字段都在 `.env.example` 中声明；退出 1 = 有漂移（列表输出到 stderr）或输入文件缺失。细节见 5.4。被 `smoke.sh:37-38` 调用。

### 6.2 `smoke.sh` — Phase 4 笔记本验证器

用法：`bash infra/scripts/smoke.sh up`（只做 compose up，"debug"）或 `bash infra/scripts/smoke.sh full`（默认）（`infra/scripts/smoke.sh:4-6,13`）。只有 Phase 4 每条成功标准都被观测到才退出 0；任何失败步骤打印 `FAIL: ...` 并以非零退出（8-9 行）。第 24-28 行无条件注册了 `trap teardown EXIT`，脚本**无论因何退出——包括成功、包括 `up` 模式**——都会运行 `docker compose -f infra/docker-compose.prod.yml down -v --remove-orphans`：所以 `up` 模式不会留下运行中的栈；`-v` 会删除 `infra_wallet_pgdata_prod`/`infra_caddy_data`。两个 compose 文件默认项目名都是 `infra`（取自文件所在目录），且都把 Postgres 服务命名为 `db`（`infra/docker-compose.dev.yml:2`、`infra/docker-compose.prod.yml:6`）。因此当 dev 库是用 `-f infra/docker-compose.dev.yml` 默认项目名启动时，prod 文件的 `up`/`down` 会把 dev 的 `wallet_db` 容器视为同一个 `db` 服务来重建或删除，与是否加 `--remove-orphans` 无关。注：本机现有的 `wallet_db` 容器带 `com.docker.compose.project=backend` 标签、卷名 `backend_postgres_data`（它是在 compose 文件还位于 `backend/` 时启动的，观测），所以此刻并不与 prod 栈冲突。

按顺序的检查项：

| # | 行 | 检查 | 失败文案 |
|---|---|---|---|
| 1 | 31-32 | `infra/.env` 存在 | `FAIL: <path> missing — run 'cp <example> <path>' and fill in real values` |
| 2 | 34-35 | `git check-ignore -q infra/.env` | `FAIL: <path> is not gitignored` |
| 3 | 37-38 | 运行 `env-coverage.sh` | 透传其退出码 1 |
| 4 | 40-43 | `.env.example` 含 `POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB SECRET_KEY ALLOWED_ORIGINS CADDY_DOMAIN CADDY_TLS_MODE` 这些键 | `FAIL: <path> missing key <k>` |
| 5 | 45-46 | `docker compose -f infra/docker-compose.dev.yml config -q` | compose 自身报错 |
| 6 | 49-51 | `cd frontend && npm run build:web`（日志写到 `/tmp/smoke-build.log`）；`frontend/dist` 必须存在 | `FAIL: build:web` / `FAIL: frontend/dist not created` |
| 7 | 53-58 | `grep -rq 'localhost:8000' frontend/dist/` 必须无命中 | 列出命中文件后 `exit 1` |
| 8 | 60-61 | `diff -q config.ts config.dev.ts`（构建后应已恢复） | `diff` 退出 1 经 `set -e` 中止 |
| 9 | 64-65 | `docker build --platform linux/arm64 -f infra/Dockerfile.api backend/ -t wallet-app/api:local` | `FAIL: docker build`（x86 宿主机需要 arm64 模拟） |
| 10 | 67-68 | 镜像 `.Architecture == arm64` | `FAIL: image not arm64` |
| 11 | 70-71 | `docker run --rm wallet-app/api:local id -u` == `1000` | `FAIL: not running as uid 1000` |
| 12 | 73-83（`up`/`full`） | prod compose `config -q`、`up -d --wait`、`ps` | compose 自身报错 |
| 13 | 85-90（`full`） | 用 python3 解析 `docker compose ps migrate --format json`，要求 `State` 为 `exited` 且 `ExitCode` 为 0 | `FAIL: migrate did not exit 0` |
| 14 | 93-98 | `set +u` 后 source `infra/.env`，`psql ... -tAc "SHOW shared_buffers"` 必须等于 `3GB` | `grep` 退出 1 经 `set -e` 中止 |
| 15 | 100-102 | `HostConfig.ShmSize` >= 1073741824 | `FAIL: shm_size <n> < 1073741824` |
| 16 | 105-106 | `curl -sIk https://localhost` 首行为 `HTTP/2 200` | `FAIL: https://localhost did not return 200` |
| 17 | 108-109 | `curl -fsk https://localhost/api/v1/health` 含 `"status"` | `FAIL: /api/v1/health did not return JSON status` |
| 18 | 111-112 | `curl -ksf https://localhost/` 含 `<html` | `FAIL: SPA shell not served at /` |
| 19 | 114 | 打印 `OK: Phase 4 smoke green` | |

与代码已知的不一致：第 17 步访问 `/api/v1/health`，这条路由不存在（唯一的健康路由是 `GET /health`，`backend/app/main.py:33`；`backend/app` 里 grep "health" 只命中 `main.py`）。FastAPI 返回 404 `{"detail":"Not Found"}`，`curl -f` 以 22 退出，所以 `smoke.sh full` 今天无法走到第 114 行。第 9 步打的是 arm64 镜像，第 12 步随后在笔记本上运行它（模拟执行）。Phase 4 的验证报告记录该脚本只做过语法检查，未端到端执行（`.planning/phases/04-containerize-and-compose-locally/04-VERIFICATION.md:107-115`）。

### 6.3 `verify-phase6.sh` — Phase 6 纯断言验证器

用法：`bash infra/scripts/verify-phase6.sh quick` 或 `bash infra/scripts/verify-phase6.sh full <domain> <vm-ip>`（`infra/scripts/verify-phase6.sh:4-6`）。`full` 缺少任一参数，或模式名不是 `quick`/`full`，打印用法并退出 1（23-33 行）。退出 0 = 所选模式的所有断言为真；否则打印失败断言并退出 1（8-9 行）。它从不调用 compose 生命周期命令（11-14、79 行）。

quick 段（任何模式都执行，42-70 行）：

| 检查 | 命令 | 备注 |
|---|---|---|
| Caddyfile 合法 | `docker run --rm -v infra/Caddyfile:/etc/caddy/Caddyfile:ro caddy:alpine caddy validate --config ... --adapter caddyfile`（43-46 行） | 需要 Docker，本地没有 `caddy:alpine` 时会拉取；**没有**传任何 `CADDY_*` 环境变量，所以 Caddyfile 默认值全部生效（观测退出 0）——它不覆盖 compose 提供空 `CADDY_ACME_CA` 的情况（4.3） |
| HSTS 存在 | 精确字符串 grep `Strict-Transport-Security "max-age=31536000; includeSubDomains"`（48-50 行） | |
| Caddyfile 中无 `preload` | `! grep -q 'preload'`（52-54 行） | |
| `acme_ca` 由环境变量驱动 | 正则 `acme_ca \{\$CADDY_ACME_CA(:[^}]*)?\}`（56-58 行） | 匹配 `infra/Caddyfile:2` |
| `.env.example` 有 `^CADDY_ACME_CA=` | 60-62 行 | |
| `.env.example` 恰好含 `ALLOWED_ORIGINS=https://CHANGE_ME_YOUR_DOMAIN` | 64-66 行 | |
| prod compose 通过 lint | `docker compose -f infra/docker-compose.prod.yml config -q`（68-70 行） | 要求 `infra/.env` 存在：Compose 对缺失的 `env_file` 会报 `env file ... not found` 并中止，所以 quick 模式在没有先创建 `infra/.env` 的新克隆上跑不通 |

然后打印 `OK: Phase 6 quick verify green`，退出 0（72-75 行）。

full 段（81-130 行），全部从操作者机器对着 `https://<domain>` 执行：`dig @1.1.1.1 <domain> +short` 的 A 记录等于 `<vm-ip>`（81-83 行）；`curl -sI` 返回 `HTTP/2 200`（85-87 行）；`curl -vI` 输出中 issuer 含 `Let's Encrypt`，且不含 `STAGING`、`Fake LE`、`Pretend Pear` 三者任一（89-96 行；命中 staging 时的失败文案要求操作者"set CADDY_ACME_CA= (empty)"，见 4.3）；`strict-transport-security` 头含 `max-age=31536000` 与 `includeSubDomains`（98-100 行）；`nmap -Pn -p 22,23333,80,443 -oG -` 显示 22 为 closed/filtered、23333/80/443 为 open（102-111 行）；`/health` 响应体含 `"status"`（113-115 行）；`/health` 的 `time_total` < 0.5 s（外部 500 ms 阈值，而 ROADMAP 写的是 100 ms 局域网数值，117-122 行）；`infra/runbook-evidence/uptime-alert.png` 存在且非空（124-128 行）。结束打印 `OK: Phase 6 full verify green`（130 行）。本地需要 `dig`、`curl`、`nmap`。

---

## 7. 本地运行配方

### 7.1 只起 dev 数据库 + 本地 uvicorn + Expo web（文档记载的日常工作流）

记载于 `README.md:94-112` 与 `backend/README.md:24-79`。命令原样（`README.md:98-100` 里 alembic/uvicorn 不带 `poetry run` 前缀且 uvicorn 带 `--host 0.0.0.0 --port 8000`；`backend/README.md:61,67` 带 `poetry run` 但 uvicorn 只有 `--reload`；下面两种写法都原样列出）：

```bash
# 1. Postgres（宿主机 5432 端口，凭据 wallet_user/wallet_password/wallet_db）
docker compose -f infra/docker-compose.dev.yml up -d db

# 2. 后端（在 backend/ 目录下运行，pydantic-settings 才能找到 backend/.env——如果你创建了它）
cd backend
poetry install
cp env.example .env            # 可选：默认值本来就对应 dev 库（backend/README.md:39）
poetry run alembic upgrade head
poetry run uvicorn app.main:app --reload                       # backend/README.md:67 原文（默认监听 127.0.0.1:8000）
# 或按 README.md:100 原文（不带 poetry run，需已激活 Poetry 环境）：
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
#  -> http://localhost:8000，Swagger 在 /docs，健康检查在 /health

# 3. 前端（另开一个终端）
cd frontend
npm install
npm run web                    # expo start --web -> http://localhost:8081
```

它为什么能工作：`config.ts`（= `config.dev.ts`）把 bundle 指向 `http://localhost:8000/api/v1`（`frontend/src/constants/config.dev.ts:7`），相对 `:8081` 是跨源，所以 API 默认的 `ALLOWED_ORIGINS` 里包含 `http://localhost:8081`（`backend/app/core/config.py:25`）是浏览器调用得以放行的原因。`DEBUG` 默认 `False`；`backend/env.example` 设了 `DEBUG=True`（12 行），配合 `ENVIRONMENT=development` 会打开 SQLAlchemy echo（`backend/app/core/database.py:21`）。`README.md:112-116` 提到演示账号 `user@test.com` / `password123`；仓库里没有任何东西创建它（`backend/` 下 grep 这两个字符串无命中，没有 fixture 或迁移插入），它只有通过 `/api/v1/auth/register` 注册后才存在。

停止/重置：`docker compose -f infra/docker-compose.dev.yml down`（保留 `infra_postgres_data`）或 `down -v`（`backend/README.md:202`）。

测试：`cd backend && poetry run pytest`（经 `backend/tests/conftest.py:10-11` 用 SQLite 内存库）；`cd frontend && npm test`；`npm run verify:phase5` = 构建 + PWA/触控目标检查 + jest（`frontend/package.json:11`；脚本位于 `frontend/scripts/verify-pwa.mjs`、`verify-touch-targets.mjs`）。

### 7.2 在笔记本上起完整生产形态栈

```bash
# 1. 环境
cp infra/.env.example infra/.env
#   替换每个 CHANGE_ME_* 值；保留 CADDY_DOMAIN=localhost、CADDY_TLS_MODE=internal
chmod 600 infra/.env

# 2. 前端 bundle（Caddy bind mount 的是 frontend/dist）
cd frontend && npm install && npm run build:web && cd ..

# 3. 栈
docker compose -f infra/docker-compose.prod.yml up -d --build --wait
docker compose -f infra/docker-compose.prod.yml ps
#   预期：db healthy，migrate exited (0)，api healthy，caddy running

# 4. 验证
curl -sk https://localhost/health            # {"status":"healthy","environment":"production","version":"0.1.0"}
curl -sIk https://localhost/ | head -1       # HTTP/2 200
open https://localhost                       # 接受自签（内部 CA）证书警告

# 5. 停止 / 清空
docker compose -f infra/docker-compose.prod.yml down        # 保留卷
docker compose -f infra/docker-compose.prod.yml down -v     # 删除数据库 + 证书状态
```

观测到的约束（2026-09-03）：按 `.env.example:44` 出厂的 `CADDY_ACME_CA=`（或者不写这个键），`caddy` 服务无法适配配置并陷入重启循环（4.3）；只有当 `infra/.env` 把 `CADDY_ACME_CA` 设为非空目录 URL（例如 `.env.example:43` 注释里的 staging URL）时栈才能走到第 4 步（笔记本上 `tls internal` 生效，这个值本身用不到）。这里构建出的镜像是 `amd64`；`smoke.sh` 构建的则是 `arm64`。宿主机 80/443 端口必须空闲。两个 compose 文件默认项目名都是 `infra`（取自文件所在目录），且都把 Postgres 服务命名为 `db`（`infra/docker-compose.dev.yml:2`、`infra/docker-compose.prod.yml:6`）。因此当 dev 库是用 `-f infra/docker-compose.dev.yml` 默认项目名启动时，prod 文件的 `up`/`down` 会把 dev 的 `wallet_db` 容器视为同一个 `db` 服务来重建或删除，与是否加 `--remove-orphans` 无关。注：本机现有的 `wallet_db` 容器带 `com.docker.compose.project=backend` 标签、卷名 `backend_postgres_data`（它是在 compose 文件还位于 `backend/` 时启动的，观测），所以此刻并不与 prod 栈冲突。

---

## 8. 部署方案——已规划、从未执行

状态证据：`.planning/STATE.md:36`（"Phase 6 ... In Progress (4/7 plans)"）、`:43-46`（下一步 = 由操作者执行的 06-05）；`.planning/ROADMAP.md:89-91`（06-05、06-06、06-07 未勾选）；`.planning/phases/06-provision-oracle-vm-domain-caddy-https/` 下有 `06-05-PLAN.md`、`06-06-PLAN.md`、`06-07-PLAN.md`，但没有对应的 `SUMMARY.md`；`infra/runbook-evidence/` 只有空的 `.gitkeep`（观测），而计划期望那里出现 `staging-verified.log`、`health-db-independence.log`、`nmap-scan.txt`、`prod-verified.log`、`uptime-alert.png`（`06-05-PLAN.md:36-44`、`06-06-PLAN.md:28-30`、`06-07-PLAN.md:30-33`）。仓库里任何地方都没有域名、VM IP 或账户标识（RUNBOOK 全部使用 `<your-domain>`、`<vm-ip>`、`<your-org>` 占位符）。

### 8.1 目标与决策（Phase 6，`.planning/phases/06-provision-oracle-vm-domain-caddy-https/06-CONTEXT.md`）

| 主题 | 决策 | 引用 |
|---|---|---|
| 托管 | Oracle Cloud Always Free，`VM.Standard.A1.Flex`（Ampere ARM64），2 OCPU / 12 GB 内存，Ubuntu 24.04 Minimal；区域 = 哪里有 A1.Flex 容量就用哪里（Phoenix/Tokyo/Mumbai 比 Singapore 更常有货） | D-06..D-08（`06-CONTEXT.md:30-32`），`infra/RUNBOOK.md:118-119` |
| 域名与 DNS | Cloudflare Registrar + Cloudflare DNS，仅一条 apex `A` 记录，代理**关闭**（灰云），让 Let's Encrypt HTTP-01 直达 VM；没有 `www` | D-01..D-03（`06-CONTEXT.md:22-24`） |
| 顺序门 | 首次启动 Caddy 之前 `dig @1.1.1.1 <domain> +short` 必须返回 VM IP | D-04（`06-CONTEXT.md:25`），`infra/RUNBOOK.md:406-434` |
| TLS | Caddy 对接 Let's Encrypt；先 staging 端点（"Commit A"），再单独一次刻意改动切到生产（"Commit B"）；HSTS `max-age=31536000; includeSubDomains`，无 preload | D-05（`06-CONTEXT.md:26`），D-19（`:58`） |
| SSH | 新生成的 ed25519 密钥，端口 23333，仅密钥登录，禁止 root 登录；`deploy` 用户带 `NOPASSWD` sudo | D-09..D-11（`06-CONTEXT.md:36-38`） |
| 防火墙 | ufw 默认拒绝入站；只允许 23333/80/443 TCP；Oracle 安全列表镜像同样规则；外部 `nmap` 检查 | D-12、D-15（`06-CONTEXT.md:39,45`） |
| 补丁 | `unattended-upgrades`，只用 security pocket，`Automatic-Reboot "false"` | D-14（`06-CONTEXT.md:44`） |
| CORS | `ALLOWED_ORIGINS=https://<domain>` | D-20（`06-CONTEXT.md:62`） |
| 监控 | 一个 UptimeRobot 免费档 HTTPS 监控 `/health`，5 分钟间隔，邮件告警；用 `docker compose stop caddy` 做刻意停机演练并以截图为证据 | D-21..D-23（`06-CONTEXT.md:66-68`） |
| 明确推迟 | fail2ban、按 IP 限制 SSH、Cloudflare 代理/WAF、证书过期监控、provisioning 脚本、`www` 重定向、证书状态备份 | `06-CONTEXT.md:168-179` |

读这份计划时需要知道的研究结论：ROADMAP 写的 Let's Encrypt "每周 5 次签发"限制已过时（每个注册域名每周 50 次；相同 SAN 集合的重复证书每周 5 次）（`06-RESEARCH.md:730,737`）；UptimeRobot 免费档自 2024 年 12 月起仅限个人用途（`06-RESEARCH.md:734`）。

### 8.2 `infra/RUNBOOK.md`——操作者会做什么

前言：读者、约 60 分钟的重建目标、两个硬性门（§8 的 DNS 传播；§10 到 §11 的 staging 先于 prod）（`infra/RUNBOOK.md:3-7`）。目录在 13-33 行。

| § | 行 | 内容 |
|---|---|---|
| 0 | 37-71 | 前置条件：有 A1.Flex 资格的 Oracle 账户（41 行）；笔记本工具 `ssh dig curl nmap git docker compose`（44-48 行）；`ssh-keygen -t ed25519 -C wallet-app-oracle -f ~/.ssh/wallet_app_oracle`（65 行） |
| 1 | 75-90 | 在 Cloudflare Registrar 注册域名（`https://dash.cloudflare.com`，81 行） |
| 2 | 94-132 | Oracle 控制台：compartment（102 行）、VCN 向导 "Create VCN with Internet Connectivity"（104-106 行）、保留公网 IP `wallet-app-prod-ip`（111-112 行）、实例 `wallet-app-prod`（Ubuntu 24.04 Minimal ARM64，2 OCPU/12 GB，116-120 行）、粘贴公钥、安全列表入站 TCP 23333/80/443 来源 `0.0.0.0/0`（124-129 行） |
| 3 | 136-159 | 首次以 `ubuntu` 用户走 22 端口 SSH（`ssh -i ~/.ssh/wallet_app_oracle ubuntu@<vm-ip>`，141 行） |
| 4 | 163-219 | SSH 加固：drop-in `/etc/ssh/sshd_config.d/99-wallet-hardening.conf`（`Port 23333`、`PermitRootLogin no`、`PasswordAuthentication no`、`KbdInteractiveAuthentication no`、`PubkeyAuthentication yes`，172-178 行），`ssh.socket.d/listen.conf` 覆盖（`ListenStream=` 再 `ListenStream=23333`，187-191 行），在第二个终端验证之后才关闭第一个（165 行） |
| 5 | 223-327 | `deploy` 用户（`/etc/sudoers.d/deploy` NOPASSWD，232-233 行；拷贝 `authorized_keys`，236-239 行），ufw 按 deny-incoming / allow-outgoing / allow 23333,80,443 / enable 的顺序（264-272 行；279 行强调不要放开 22），`unattended-upgrades` 仅 security 源、关闭自动重启（288-298 行） |
| 6 | 331-384 | 从官方 apt 源安装 Docker CE + Compose v2（deb822 格式、arm64，345-353 行；`docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`，362 行），`usermod -aG docker deploy`（368 行） |
| 7 | 388-402 | Cloudflare `A @ <vm-ip>`，Proxy status "DNS only"（396 行），TTL Auto（397 行） |
| 8 | 406-434 | 用 `dig @1.1.1.1` 循环等待直到返回 `<vm-ip>`（416-417 行）；再用 `8.8.8.8` 交叉检查（430 行） |
| 9 | 438-506 | `~/.ssh/config` 别名 `wallet-app`；`git clone https://github.com/<your-org>/wallet_app.git`；`cp .env.example .env`（464 行）；`chmod 600 .env && chown deploy:deploy .env`（467-476 行）；填值（Postgres 用 `openssl rand -base64 24`、`SECRET_KEY` 用 `openssl rand -hex 32`、`ALLOWED_ORIGINS=https://<domain>`、`CADDY_DOMAIN=<domain>`、**删除/注释 `CADDY_TLS_MODE`**、`CADDY_ACME_CA=<staging URL>`，480-486 行）；预检 grep（492-504 行） |
| 10 | 510-571 | 在笔记本上构建 `frontend/dist` 并 `scp -P 23333 -r dist deploy@<vm-ip>:~/wallet_app/frontend/`（516-523 行），或在 VM 上构建（526-533 行）；`docker compose -f docker-compose.prod.yml up -d --build --wait`（540 行）；查看 Caddy 日志确认 staging 签发（548-550 行）；只在无痕窗口打开站点（HSTS 警告，554-562 行）；向 `runbook-evidence/staging-verified.log` 追加 `Commit A (staging) verified at <ts>`（568 行） |
| 11 | 575-621 | 用 `sed -i` 把 `.env` 里 `CADDY_ACME_CA=...` 那一行整体替换成 `CADDY_ACME_CA=`（**设为空**，585-587 行），`docker compose ... restart caddy`（593 行；596 行强调绝不 `down -v`），用 `curl -vI` 验证 issuer 是 Let's Encrypt（609-610 行），向 `prod-verified.log` 追加 `Commit B ...`（618 行） |
| 12 | 625-672 | `/health` 与数据库无关性：`docker compose stop db`（641 行），`curl -sf https://<domain>/health` 仍须返回 JSON（649 行），`start db`（657 行），记录到 `health-db-independence.log`（669 行） |
| 13 | 676-709 | `nmap -Pn -p 1-65535 <vm-ip>`（683 行）与针对性的 `-p 22,23333,80,443`（690 行）；保存 `nmap-scan.txt`（705 行） |
| 14 | 713-737 | UptimeRobot 注册，监控 `wallet-app prod /health`（719-723 行） |
| 15 | 741-796 | 停机演练：`stop caddy`（752 行），等告警邮件，截图到 `infra/runbook-evidence/uptime-alert.png`（766 行），`git add`（776 行；781 行称 `.gitignore` 有针对该文件的否定规则，实际 `.gitignore:25-26` 只否定了 `.gitkeep`，`06-07-PLAN.md:72-74` 说明需要 `git add -f`），`start caddy`（786 行） |
| 16 | 800-831 | `verify-phase6.sh quick`（808 行）与 `full`（815 行）；失败到章节的对照表 |
| A-D | 835-1013 | SSH config 片段（840-844 行）；A1.Flex 无容量时的对策（手动重试、`oci compute instance launch` 循环，855-880 行）；日常命令（见 9.1、9.5、9.6）；Oracle 串口控制台锁死恢复（972 行起） |

规划中的首次部署流程，浓缩为：

1. 操作者手工完成 VM 与域名的准备（§1-§8）；仓库里没有任何东西把这些自动化（D-16：纯 markdown，脚本推迟，`06-CONTEXT.md:49`）。
2. 在 VM 上 `git clone` + 手写 `infra/.env`（§9）。
3. 从笔记本拷贝 `frontend/dist`（§10a）。
4. `docker compose -f docker-compose.prod.yml up -d --build --wait` **在 VM 上**构建 API 镜像（arm64 原生）并启动栈（§10b）。
5. 期望 Caddy 先取得 staging 证书，在 §11 之后再取得生产证书。

按今天的文件，两处已观测到的机制会让第 4-5 步不按上文运行（证据见 4.3）：删除 `CADDY_TLS_MODE` 在 compose 层和 Caddyfile 层都得到 `tls internal`，所以 Caddy 会给域名签一张内部 CA 证书而不是联系 Let's Encrypt；§11 的 `CADDY_ACME_CA=`（空）会在重启时触发 Caddyfile 解析错误。06-01 的执行摘要记录了一条相反的指示（"REMOVE/UNSET, not set to empty"，`06-01-SUMMARY.md:35,81,94`），RUNBOOK 与 `.env.example:42` 没有采用它，而且 compose 的默认值 `${CADDY_ACME_CA:-}` 无论如何都会把"未设置"变成空字符串。

### 8.3 Phase 7（CI/CD、备份）——未开始

`.planning/STATE.md:37` 把 Phase 7 标为 "Not started"；`.planning/ROADMAP.md:93-102` 与 `.planning/REQUIREMENTS.md:55,61-63,67` 描述意图：push 到 `main` 触发 GitHub Actions，在 `ubuntu-24.04-arm` 上构建 arm64 镜像，推送到 GHCR 并打 `latest` + git SHA 标签（CI-01），经 `appleboy/ssh-action` SSH 部署并运行 `docker compose pull && docker rollout <service>`（CI-02、DEPLOY-06），部署后 `curl --retry 5 --retry-delay 3 https://<domain>/health` 作为门禁（CI-03），一个每日 `pg_dump | gzip` 的 cron 容器用 `rclone` 推送到 Cloudflare R2、保留 7 天、不做恢复演练（OPS-03），Slack/Discord 部署 webhook（OPS-05）。这些文件、工作流、容器在仓库里都不存在。

---

## 9. 运维（今天存在什么）

### 9.1 日志

| 组件 | 日志去向 | 配置 |
|---|---|---|
| 所有容器 | Docker `json-file` 驱动，没有大小/轮转选项（两个 compose 文件都没有 `logging:`）——文件在 `/var/lib/docker/containers/` 下无限增长 | 无 |
| API | uvicorn 的访问日志与错误日志走 stdout/stderr（uvicorn 默认；没有 `--log-config`）。应用层 logger（`backend/app/core/security.py:19` 的 `logging.getLogger(__name__)`）在 `backend/app` 里没有任何 handler 配置（grep `basicConfig`、`dictConfig`、`logging.config` 无命中），所以 Python 的 last-resort handler 只把 WARNING 及以上打到 stderr，`logger.info(...)` 的诊断行会被丢弃 | 无 |
| migrate | Alembic 按 `backend/alembic.ini:113-147` 配置日志（`alembic` INFO 到 stderr，134-137 行；`sqlalchemy.engine` WARNING，129-132 行；root WARNING，124-127 行；handler 为 `StreamHandler(sys.stderr)`，139-143 行）；有 revision 需要执行时输出 `INFO  [alembic.runtime.migration] Running upgrade ...` 行 | alembic.ini |
| Caddy | JSON 运行日志到 stderr（签发、续期、错误）；**没有 HTTP 访问日志**（`infra/Caddyfile` 无 `log` 指令） | 无 |
| Postgres | stderr（镜像默认） | 无 |

读取方式：`docker compose -f infra/docker-compose.prod.yml logs --tail 100 -f <service>`（`infra/RUNBOOK.md:907-914`）。没有聚合、没有外发、没有保留策略（Sentry/Loki/Grafana 按 `06-CONTEXT.md:13` 在范围之外）。

### 9.2 健康监控

- 应用端点：`GET /health` → `{"status":"healthy","environment":"<ENVIRONMENT>","version":"0.1.0"}`，HTTP 200，不访问数据库（`backend/app/main.py:33-40`）。通过 Caddy 暴露（`infra/Caddyfile:16-18`），被镜像 HEALTHCHECK（`infra/Dockerfile.api:76`）和 compose 对 `api` 的健康检查（`infra/docker-compose.prod.yml:54-59`）使用。
- Postgres：`pg_isready` 健康检查（`infra/docker-compose.prod.yml:26-31`；`infra/docker-compose.dev.yml:14-18`）。
- 状态查看：`docker compose -f infra/docker-compose.prod.yml ps`（`infra/RUNBOOK.md:952-957`）。
- 外部监控：未配置；UptimeRobot 在规划中（8.1）。
- 告警：无。

### 9.3 备份

没有。仓库里没有 `pg_dump` 任务、没有卷快照、没有 cron 容器、没有对象存储配置、没有恢复流程。唯一的持久状态是两个命名卷 `infra_wallet_pgdata_prod`（全部用户数据）和 `infra_caddy_data`（ACME 账户 + 证书）；RUNBOOK 的唯一保护是"绝不对它们执行 `down -v` 或 `docker volume rm`"（`infra/RUNBOOK.md:959-968`）。每日转储到 Cloudflare R2、保留 7 天是 Phase 7 的需求（`.planning/REQUIREMENTS.md:55`），未开始；Caddy 卷明确连那个计划都不包含（`06-CONTEXT.md:178`）。

### 9.4 容器内的数据库迁移

- 镜像内容：`/app/alembic.ini`、`/app/migrations/env.py`、`/app/migrations/versions/*.py`（观测）。`alembic.ini` 设 `script_location = %(here)s/migrations`（8 行）与 `prepend_sys_path = .`（19 行）。
- `migrate` 以 uid 1000 在 `WORKDIR /app` 下运行 `alembic upgrade head`（`infra/docker-compose.prod.yml:40`；观测镜像 `WorkingDir=/app`）。`env.py` 把上级目录加入 `sys.path`（11 行），导入 `settings` 与全部模型（14-15 行），用容器环境里的 `settings.DATABASE_URL` 覆盖 `sqlalchemy.url`（22 行），以 `poolclass=pool.NullPool` 在线运行（70-74、76-82 行）。
- Revision 链（`backend/migrations/versions/*.py` 的 `revision`/`down_revision`）：`e533c88884b7`（初始 schema）→ `d671e51094c8` → `5ca7fe6e37db` → `026ee0aecb66` → `76227e076393` → `8a4f4d66d893`（head，"add transfer_pair_id to transactions"）。
- 顺序保证：`migrate` 退出码 0 之前 `api` 无法启动（`infra/docker-compose.prod.yml:51-53`），所以正常 `up` 时 API 不会在未迁移的 schema 上提供服务。dev 工作流里没有任何迁移步骤，只有手工的 `poetry run alembic upgrade head`（`backend/README.md:61`）。

### 9.5 升级一个运行中的部署（按文档记载）

依据 `infra/RUNBOOK.md:935-939`（"Pull the latest image after a code update ... for now, rebuild on VM"）与 `06-CONTEXT.md:147`（"`git pull` is how subsequent deploys would happen"）：

1. 在 VM 上：在 `~/wallet_app` 里 `git pull`（隐含；RUNBOOK 没有明写）。
2. 前端有改动时：在笔记本上 `npm run build:web` 再 `scp` 一次 `dist/`（`infra/RUNBOOK.md:516-523`）；Caddy 立即提供新文件（bind mount）。
3. `docker compose -f docker-compose.prod.yml up -d --build`（`infra/RUNBOOK.md:938`）：重建 `wallet-app/api:local`（`migrate` 持有 `build:` 块），重建 `migrate`（运行 `alembic upgrade head`），重建 `api`（旧容器在新容器通过健康检查之前就被停掉，所以 `/api/*` 在大约 `start_period` + 第一次成功探测的时间内由 Caddy 返回 502），`db` 与 `caddy` 在配置未变时保持不动。
4. `.env` 有改动时：`docker compose ... restart caddy` 或 `restart api`（`infra/RUNBOOK.md:941-950`）。注意 `restart` 不会重新读取 `env_file`；只有 `up -d` 会用新环境重建容器（Compose 语义）。

零停机切换（`docker rollout`）属于 Phase 7（`.planning/REQUIREMENTS.md:27`），未实现。

### 9.6 回滚

没有记载任何回滚流程（RUNBOOK 目录 `infra/RUNBOOK.md:13-33` 没有此类章节），也没有机制支持回滚：API 镜像只有一个可变 tag `wallet-app/api:local`（`infra/docker-compose.prod.yml:37,47`），重建时覆盖前一个镜像；没有镜像 digest 或 SHA 标签；`alembic downgrade` 作为 CLI 能力列在 `backend/README.md:171`，但栈里没有任何东西接入它；没有可供恢复的数据库备份（9.3）。文档里描述的保留状态的操作只有 `stop`/`start`/`restart`/`up -d`/不带 `-v` 的 `down`（`infra/RUNBOOK.md:916-933,965-968`）。

### 9.7 资源与调优事实

- Postgres：`shared_buffers=3GB`、`effective_cache_size=8GB`、`max_connections=50`、`shm_size` 1 GiB（`infra/docker-compose.prod.yml:15-23`）。理由（让内存占用保持在 Oracle 20% 空闲回收阈值之上）记录在 `.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md:61`。这些值写死在 compose 文件里，在任何宿主机（包括笔记本）上都生效。
- API：单个 uvicorn 进程；非 SQLite URL 时 SQLAlchemy 连接池 `pool_size=5`、`max_overflow=10`、`pool_pre_ping=True`、`pool_recycle=3600`（`backend/app/core/database.py:23-27`），所以 API 最多 15 个连接，加上 `migrate` 的一个临时连接，远低于 `max_connections=50`。
- 任何容器都没有 CPU/内存限制。

---

## 10. 安全现状

### 10.1 逐项

| 领域 | 现状 | 证据 |
|---|---|---|
| 网络暴露 | 只有 Caddy 发布端口（80/443）。`api` 与 `db` 只在 `infra_default` 上可达。**dev** compose 把 Postgres 以固定凭据 `wallet_user`/`wallet_password` 发布到宿主机 `5432`。 | `infra/docker-compose.prod.yml:69-71`；`infra/docker-compose.dev.yml:7-11` |
| TLS | 笔记本：Caddy 内部 CA（自签，浏览器警告）。VM：意图是 Let's Encrypt，但当前环境默认值产生 `tls internal`（4.3）。TLS 版本/套件：Caddy 默认。HSTS 一年、`includeSubDomains`、无 preload，无论证书类型都发送。 | `infra/Caddyfile:6,8`；4.3 的 adapt 结果 |
| CORS | Starlette `CORSMiddleware`，`allow_origins` 取自 `ALLOWED_ORIGINS`（逗号拆分），`allow_credentials=True`，`allow_methods=["*"]`，`allow_headers=["*"]`。代码默认 = 三个 localhost 源；prod 模板 = 一个 `https://` 源。生产形态下经 Caddy 同源，浏览器不会发预检；白名单作为纵深防御保留。 | `backend/app/main.py:18-24`；`backend/app/core/config.py:25,40-43`；`infra/.env.example:25`；`.planning/codebase/CONCERNS.md:192-215` |
| 认证 | JWT HS256，用 `SECRET_KEY` 签名，30 分钟过期；口令直接用 `bcrypt` 库散列（`bcrypt.hashpw`/`bcrypt.checkpw`，不经 passlib）；bearer 令牌放在 `Authorization` 头；web 客户端把令牌存在 AsyncStorage（web 上即 localStorage） | `backend/app/core/config.py:15-17`；`backend/app/core/security.py:9,25-36,56,59,77`；`frontend/src/api/client.ts:19-34` |
| 密钥 | 只经 env/`.env` 文件传递，且已 gitignore；不打进镜像；本机 `infra/.env` 权限 600；宿主机上 `docker inspect` 可读。`SECRET_KEY` 有不安全的代码默认值且无校验，环境变量缺失时静默使用一个可猜测的签名密钥。 | 5.3；`backend/app/core/config.py:15`；`.planning/codebase/CONCERNS.md:33-53` |
| 容器加固 | API 以非 root uid 1000 运行于 slim 镜像，不含 Poetry/uv；`pip` 仍在。Caddy 与 Postgres 用各自 stock 镜像的用户。没有 `read_only` 根文件系统、没有 `cap_drop`、没有 seccomp/AppArmor 配置、没有资源限制。 | `infra/Dockerfile.api:61,70`；观测 `id`；两个 compose 文件 |
| 限流 / 滥用控制 | 任何层都没有（没有 FastAPI 中间件，Caddy 没有 `rate_limit`，v2.0 不计划 fail2ban）。Frankfurter 调用有指数退避重试但没有客户端节流。 | `backend/app/main.py`（无此类中间件）；`infra/Caddyfile`；`backend/app/services/rates.py:18-21,56-59`；`.planning/codebase/CONCERNS.md:57-78`；`06-CONTEXT.md:43,168` |
| 请求限制 / 超时 | Caddy 与 uvicorn 都没有请求体大小限制、没有服务器超时；axios 客户端超时 10 s | 4.4；`frontend/src/api/client.ts:10` |
| 代理头 | Caddy 设置 `X-Forwarded-*`；uvicorn 忽略它们（默认 `forwarded-allow-ips=127.0.0.1`），应用看到的是 Caddy 的 IP 与 `http` | 镜像内 `uvicorn --help` 观测 |
| 宿主机加固 | 不存在（没有 VM）。规划：ufw 23333/80/443、仅密钥 SSH、无人值守安全更新、非 root deploy 用户。 | 8.1 |
| 供应链 | 浮动的基础镜像/镜像 tag：`python:3.11-slim`、`ghcr.io/astral-sh/uv:latest`、`caddy:alpine`（major 未固定）、`postgres:15-alpine`；`poetry==1.8.5` 固定，`poetry-plugin-export>=1.8` 浮动。Python 依赖从 `poetry.lock` 解析但不带哈希（`--without-hashes`）。没有镜像或依赖漏洞扫描（没有 CI）。 | `infra/Dockerfile.api:22,27,34,40,54`；`infra/docker-compose.prod.yml:7,62` |
| 静态数据 | Postgres 数据以明文存于 Docker 卷；没有备份（9.3）。 | |

### 10.2 锁文件中的依赖版本（仅来自锁文件的事实）

后端（`backend/poetry.lock`，`lock-version = "2.1"`、`python-versions = "^3.11"`，55 个包；声明范围在 `backend/pyproject.toml:9-24`）：`fastapi 0.109.2`、`starlette 0.36.3`、`uvicorn 0.27.1`（加 `uvloop 0.22.1`、`httptools 0.7.1`、`websockets 15.0.1`、`watchfiles 1.1.1`）、`sqlalchemy 2.0.44`、`alembic 1.17.0`、`pydantic 2.12.3`、`pydantic-core 2.41.4`、`pydantic-settings 2.11.0`、`python-jose 3.5.0`（连同 `cryptography 46.0.3`、`ecdsa 0.19.1`、`rsa 4.9.1`、`pyasn1 0.6.1`）、`passlib 1.7.4`、`bcrypt 5.0.0`、`python-multipart 0.0.6`、`httpx 0.26.0`、`psycopg2-binary 2.9.11`、`email-validator 2.3.0`、`tenacity 9.1.2`、`anyio 4.11.0`、`h11 0.16.0`、`certifi 2025.10.5`。dev 组（不进镜像）：`pytest ^7.4`、`pytest-asyncio ^0.23`、`black ^24`、`ruff ^0.1`、`mypy ^1.8`（`backend/pyproject.toml:26-31`）。

前端（`frontend/package-lock.json`，`lockfileVersion 3`）：`expo 54.0.20`、`react 19.1.0`、`react-dom 19.1.0`、`react-native 0.81.5`、`react-native-web 0.21.2`、`axios 1.13.0`、`@tanstack/react-query 5.90.5`、`@react-native-async-storage/async-storage 2.2.0`、`metro 0.83.2`、`typescript 5.9.3`、`workbox-cli 7.4.1`、`workbox-build 7.4.1`、`jest 30.3.0`、`jest-expo 55.0.13`。

本地观测到的运行时镜像：Caddy v2.11.3、PostgreSQL 15.14（alpine）、Python 3.11.15。

### 10.3 已知公开公告（仓库内无法核实）

仓库里没有任何扫描器输出，也没有 CI；下面只列出针对上述锁定版本、公开且广为人知的公告条目，来源是公开漏洞数据库的常识而非仓库内证据，读者需自行到 NVD/GitHub Advisory 核对：

| 包与锁定版本 | 公告 | 与本仓库的关系 |
|---|---|---|
| `python-multipart 0.0.6` | CVE-2024-24762（Content-Type 解析 ReDoS，修复于 0.0.7）；CVE-2024-53981（畸形 multipart 触发过量日志导致 DoS，修复于 0.0.18） | 锁定版本低于两个修复版本。`backend/app` 里没有 `Form(` 或文件上传用法（grep 无命中），该包因 `fastapi` 的依赖声明进入镜像 |
| `starlette 0.36.3` | CVE-2024-47874（无大小限制的 `multipart/form-data` 解析导致 DoS，修复于 0.40.0） | 锁定版本低于修复版本；`fastapi 0.109.2` 的依赖约束把 starlette 固定在 0.36.x |
| `ecdsa 0.19.1` | CVE-2024-23342（Minerva 时序侧信道，上游声明不修复） | 经 `python-jose` 间接引入；应用只用 HS256（`backend/app/core/config.py:16`），不使用 ECDSA 签名 |
| `python-jose 3.5.0` | CVE-2024-33663、CVE-2024-33664 修复于 3.4.0 | 锁定版本高于修复版本 |
| `axios 1.13.0` | CVE-2025-27152（修复于 1.8.2）、CVE-2025-58754（修复于 1.12.0） | 锁定版本高于修复版本 |

`passlib 1.7.4` 在锁文件里，但 `security.py` 直接调用 `bcrypt`（`backend/app/core/security.py:9,27,35-36`），passlib 的代码路径不会被执行。

---

## 11. 与基础设施不再一致的文档

读者会遇到这些内容，逐条列出，只写现象：

- `README.md:66-68`（"Cloud: AWS (ECS Fargate, RDS PostgreSQL, S3 + CloudFront)"）与 `SPEC.md:658-676`（"2.12 AWS Deployment Architecture (Planned)"）描述的是 v2.0 之前的计划；实际目标是 Oracle A1.Flex + Cloudflare DNS + Caddy（`.planning/PROJECT.md:69-71`）。
- `frontend/README.md:98-104` 说用 `npx expo export:web` 构建到 `web-build/` 再上传 S3/CloudFront；实际构建是 `npm run build:web` 输出到 `dist/`，由 Caddy 提供。
- `backend/README.md:182,219` 引用一个不存在的 `PLAN.md`；`backend/README.md:58` 说迁移"将在 Phase 1.2 加入"，而现在已有六个 revision。
- `.planning/ROADMAP.md:78,133` 引用的 Let's Encrypt "每周 5 次签发"限制已被本阶段自己的研究推翻（`06-RESEARCH.md:730`）。
- `.planning/REQUIREMENTS.md:68` 仍写 "ufw allows only 22/80/443"，而 ROADMAP 与 RUNBOOK 使用 23333（`.planning/ROADMAP.md:80`）。
- `infra/.env.example:9`（"A missed substitution will fail loudly because CHANGE_ME_* values are sentinels"）——代码和 compose 里没有任何东西校验哨兵值（5.2）。
- `infra/.env.example:34-35`、`infra/RUNBOOK.md:485`、`.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md:48`（"移除 `CADDY_TLS_MODE` 会让 Caddy 回退到 ACME"）——与 `infra/docker-compose.prod.yml:67` 和 `infra/Caddyfile:6` 的 `internal` 默认值矛盾（4.3）。
- `infra/.env.example:42`、`infra/RUNBOOK.md:581-587`、`infra/scripts/verify-phase6.sh:94`（"把 `CADDY_ACME_CA` 设为空"）——空值导致 Caddyfile 解析错误（4.3 观测）；`06-01-SUMMARY.md:35,81,94` 记录的是相反的"删除该行"指示。
- `infra/RUNBOOK.md:781` 称 `.gitignore` 对 `uptime-alert.png` 有否定规则；实际 `.gitignore:25-26` 只否定了 `.gitkeep`，`06-07-PLAN.md:72-74` 说明需要 `git add -f`。
- `infra/scripts/smoke.sh:108-109` 访问 `/api/v1/health`，这条路由不存在（6.2）。

---

## 另见

- [./README.md](./README.md) — 本组文档的索引、技术栈版本与本地运行方式
- [./02-database.md](./02-database.md) — 迁移链、`migrate` 容器执行的 Alembic revision 与 Postgres 调优参数
- [./03-backend-api.md](./03-backend-api.md) — `/health`、CORS 中间件、`Settings` 的使用方，以及 Caddy 转发到的所有 `/api/v1/*` 路由。
- [./06-known-issues.md](./06-known-issues.md) — H-08、H-09、M-09 至 M-12 对本文所述运维缺口的汇总
