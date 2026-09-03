# 03 — 后端 HTTP 接口与内部实现

> **本文回答什么问题：** `backend/` 下的 FastAPI 服务现在是怎么组装、怎么读配置、怎么做鉴权的；它对外暴露的每一个 HTTP 接口接受什么、返回什么、每种失败情况的状态码和 `detail` 原文是什么、会写哪些表、会调哪些外部服务；汇率是怎么从 Frankfurter 拿到并换算的（两条不同的计算路径）；交易响应是怎么拼出来的；校验规则在哪一层；并发模型是什么；测试覆盖了什么、怎么跑。只描述现状，不做设计、不给改法。

所有路径相对于仓库根目录 `/home/ubwzwd/Code/wallet_app`。引用格式 `(文件:起始行-结束行)`，行号已在当前工作树核对。

---

## 0. 版本与取证方式

### 0.1 锁定版本

本文所有"库的行为"都以 `backend/poetry.lock` 锁定的版本为准（容器镜像用 `poetry export` 导出该 lock 后安装，infra/Dockerfile.api:38-41）：

| 包 | 锁定版本 | lock 位置 |
|---|---|---|
| fastapi | 0.109.2 | backend/poetry.lock:449-450 |
| starlette | 0.36.3 | backend/poetry.lock:1551-1552 |
| uvicorn | 0.27.1 | backend/poetry.lock:1612-1613 |
| sqlalchemy | 2.0.44 | backend/poetry.lock:1455-1456 |
| pydantic | 2.12.3 | backend/poetry.lock:1036-1037 |
| pydantic-settings | 2.11.0 | backend/poetry.lock:1188-1189 |
| python-jose | 3.5.0 | backend/poetry.lock:1267-1268 |
| bcrypt | 5.0.0 | backend/poetry.lock:56-57 |
| passlib | 1.7.4（已声明，代码从未 import） | backend/poetry.lock:880-881 |
| httpx | 0.26.0 | backend/poetry.lock:625-626 |
| tenacity | 9.1.2 | backend/poetry.lock:1569-1570 |
| python-multipart | 0.0.6（已声明，没有任何 Form/File 用法） | backend/poetry.lock:1291-1292 |
| email-validator | 2.3.0 | backend/poetry.lock:433-434 |
| psycopg2-binary | 2.9.11 | backend/poetry.lock:946-947 |
| alembic | 1.17.0 | backend/poetry.lock:4-5 |
| anyio | 4.11.0 | backend/poetry.lock:36-37 |
| pytest / pytest-asyncio | 7.4.4 / 0.23.8 | backend/poetry.lock:1212-1213, 1233-1234 |

声明的版本范围在 backend/pyproject.toml:9-24（主依赖）和 backend/pyproject.toml:26-31（dev 依赖）。`passlib` 在 backend/pyproject.toml:18 声明，但 `grep -rn passlib backend/app` 无任何命中；密码哈希直接用 `bcrypt` 包（backend/app/core/security.py:9）。`pytest-cov` 不在 lock 中，尽管 backend/README.md:155 给出了 `--cov=app` 的用法。

### 0.2 示例是怎么来的

下文所有 JSON 示例都是在进程内用 Starlette `TestClient` 驱动 `app.main:app` 实际得到的：数据库是文件型 SQLite（`Base.metadata.create_all` 建表），`httpx.get` 被替换为一个固定汇率表（USD 1、EUR 0.92、GBP 0.79、CNY 7.11，交叉汇率按 Frankfurter 的习惯保留 5 位小数）。因此 UUID、时间戳、汇率数值是示意性的，但字段名、类型、可空性、字符串格式、错误结构都是代码真实产出。

有一处与运行时 FastAPI 版本有关：`HTTPBearer` 在缺少 `Authorization` 头时返回的状态码。本机取证环境装的是 FastAPI 0.135.3（返回 401），而 lock 锁定的 0.109.2 返回 403。本文按锁定版本记录，见 §3.4。

---

## 1. 应用结构

### 1.1 模块图

```
backend/
  app/
    main.py                 FastAPI() 实例、CORS、路由挂载、/health、/
    core/
      config.py             Settings(pydantic-settings) + 模块级单例 settings
      database.py           engine、SessionLocal、Base、get_db 依赖
      security.py           bcrypt 封装、JWT 签发/解码、HTTPBearer、get_current_user、authenticate_user
    api/
      auth.py               /auth/register、/auth/login、/auth/me (GET, PATCH)
      rates.py              /rates/currencies、/rates/latest、/rates/convert
      finance_sources.py    /finance-sources 的 POST / GET / GET{id} / PATCH{id}（没有 DELETE）
      transactions.py       /transactions 的 CRUD + 模块级辅助函数 _build_conversion_fields
    schemas/
      user.py               UserCreate、UserLogin、UserResponse、UserUpdate、Token、TokenData
      finance_source.py     FinanceSourceCreate / Update / Response
      transaction.py        TransactionCreate / Update / Response
      currency.py           CurrencyCode 类型别名、CurrencyList、ExchangeRateResponse、ConversionRequest、ConversionResult
    services/
      rates.py              Frankfurter 客户端：get_supported_currencies、fetch_latest_rates、convert_amount、get_multiple_rates
    models/                 SQLAlchemy 模型：User、FinanceSource、Transaction、TransactionTag
  migrations/               Alembic（env.py 用 settings.DATABASE_URL 覆盖 sqlalchemy.url）
  tests/                    pytest 套件（§9）
```

`app/`、`app/api`、`app/core`、`app/schemas`、`app/services` 下的 `__init__.py` 都是空文件；只有 `app/models/__init__.py` 有内容——它导入四个模型并导出 `Base`，让 Alembic 能发现全部表（backend/app/models/__init__.py:5-17）。

模型层与本文相关的列定义（完整表结构见 ./02-database.md）：

| 模型 / 表 | 与接口行为直接相关的列 | 位置 |
|---|---|---|
| `User` / `users` | `id` Uuid PK；`email` 唯一索引；`password_hash`；`base_currency` String(3)；`default_source_id` Uuid，FK `finance_sources.id`，`ondelete="SET NULL"`，可空；`created_at` 默认 `datetime.utcnow` | backend/app/models/user.py:16-21 |
| `FinanceSource` / `finance_sources` | `user_id` FK `users.id`；`name`；`type` String(32)；`default_currency` String(3)；`archived` Boolean；`created_at` | backend/app/models/finance_source.py:16-22 |
| `Transaction` / `transactions` | `user_id`；`source_id` FK `finance_sources.id`，NOT NULL；`amount` Numeric(18,4)；`currency` String(3)；`occurred_at` Date；`description`、`merchant` 可空；`transfer_pair_id` Uuid 可空、有索引；`created_at`；`tags` relationship，`cascade="all, delete-orphan"` | backend/app/models/transaction.py:16-30 |
| `TransactionTag` / `transaction_tags` | `transaction_id` FK `transactions.id`，`ondelete="CASCADE"`；`tag` String(64)；复合主键 `(transaction_id, tag)` | backend/app/models/transaction_tag.py:13-19 |

### 1.2 应用对象与路由挂载

`app = FastAPI(title=settings.PROJECT_NAME, debug=settings.DEBUG, version="0.1.0")`（backend/app/main.py:11-15）。`debug=True` 时 Starlette 的 `ServerErrorMiddleware` 会对未捕获异常返回带堆栈的调试页，而不是纯文本 `Internal Server Error`。

四个路由器以硬编码前缀 `"/api/v1"` 挂载（backend/app/main.py:27-30）。`settings.API_V1_PREFIX` 从未被读取：`grep -rn API_V1_PREFIX backend/app` 只命中它自己的定义（backend/app/core/config.py:20）。每个路由器再叠加自己的子前缀：

| 路由器 | 子前缀 | OpenAPI tag | 定义位置 |
|---|---|---|---|
| auth | `/auth` | Authentication | backend/app/api/auth.py:17 |
| rates | `/rates` | Currency & Exchange Rates | backend/app/api/rates.py:17 |
| finance_sources | `/finance-sources` | Finance Sources | backend/app/api/finance_sources.py:14 |
| transactions | `/transactions` | Transactions | backend/app/api/transactions.py:49 |

从 `app.routes` 取到的完整注册路由表：

```
GET,HEAD  /openapi.json
GET,HEAD  /docs
GET,HEAD  /docs/oauth2-redirect
GET,HEAD  /redoc
POST      /api/v1/auth/register
POST      /api/v1/auth/login
GET       /api/v1/auth/me
PATCH     /api/v1/auth/me
GET       /api/v1/rates/currencies
GET       /api/v1/rates/latest
POST      /api/v1/rates/convert
POST      /api/v1/finance-sources
GET       /api/v1/finance-sources
GET       /api/v1/finance-sources/{source_id}
PATCH     /api/v1/finance-sources/{source_id}
POST      /api/v1/transactions
GET       /api/v1/transactions
GET       /api/v1/transactions/{transaction_id}
PATCH     /api/v1/transactions/{transaction_id}
DELETE    /api/v1/transactions/{transaction_id}
GET       /health
GET       /
```

要点：

- 集合路由用空字符串路径声明（`@router.post("")`，backend/app/api/finance_sources.py:17；backend/app/api/transactions.py:52），所以规范 URL 是 `/api/v1/finance-sources`，末尾没有斜杠。
- 没有 `DELETE /finance-sources/{id}`，也没有 `/auth/logout`；前端的 `logout()` 函数体只有一段注释、什么都不做（frontend/src/api/auth.ts:49-52）。
- 文档 URL 是 FastAPI 默认值（`/docs`、`/redoc`、`/openapi.json`），任何环境都没有关闭。生产栈中 Caddy 把 `/api/*`、`/health`、`/docs*`、`/openapi.json` 反向代理到 `api:8000`（infra/Caddyfile:12-26），但没有代理 `/redoc`，该路径会落到 SPA 的静态文件服务（infra/Caddyfile:28-32）。

### 1.3 中间件

只注册了一个中间件：`CORSMiddleware`，参数 `allow_origins=settings.allowed_origins_list`、`allow_credentials=True`、`allow_methods=["*"]`、`allow_headers=["*"]`（backend/app/main.py:18-24）。允许的来源来自环境变量 `ALLOWED_ORIGINS`，逗号分隔的字符串，由 `allowed_origins_list` 属性 `split(",")` 后逐项 `strip()`（backend/app/core/config.py:25, 40-43）。默认值是 `http://localhost:8081`、`http://localhost:19006`、`http://localhost:3000`。

实测行为（允许来源为 `http://localhost:8081`）：

```
GET /health   Origin: http://localhost:8081
  -> access-control-allow-origin: http://localhost:8081
     access-control-allow-credentials: true

GET /health   Origin: http://evil.example
  -> access-control-allow-credentials: true
     （没有 access-control-allow-origin 头，浏览器会拒绝读取响应）

OPTIONS /api/v1/auth/me   Origin: http://localhost:8081
        Access-Control-Request-Method: PATCH
        Access-Control-Request-Headers: authorization,content-type
  -> 200 "OK"
     access-control-allow-origin: http://localhost:8081
     access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
     access-control-allow-headers: authorization,content-type
     access-control-allow-credentials: true
     access-control-max-age: 600
```

生产环境里 SPA 由 Caddy 从同一 origin 提供，前端用相对路径 `/api/v1` 调用（frontend/src/constants/config.prod.ts:5），所以 CORS 只在本地开发时真正起作用。没有请求日志、GZip、TrustedHost、proxy-headers 之类的中间件；uvicorn 启动时也没有加 `--proxy-headers`（infra/Dockerfile.api:78）。

### 1.4 `/health` 与 `/`

| 方法 + 路径 | 鉴权 | 处理函数 | 响应 |
|---|---|---|---|
| `GET /health` | 无 | `health_check`，backend/app/main.py:33-40 | `status`、`environment`（取 `settings.ENVIRONMENT`）、`version` 三个字段 |
| `GET /` | 无 | `root`，backend/app/main.py:43-51 | `message`、`version`、`docs`、`health` 四个字段 |

```json
GET /health -> 200
{"status": "healthy", "environment": "development", "version": "0.1.0"}

GET / -> 200
{"message": "Wallet App API", "version": "0.1.0", "docs": "/docs", "health": "/health"}
```

`/health` 不碰数据库也不碰 Frankfurter，只说明进程在提供 HTTP 服务。它被以下几处轮询：

- 镜像的 `HEALTHCHECK`：每 30 s 一次、超时 3 s、启动宽限 5 s、重试 3 次，用标准库 `urllib` 访问 `http://localhost:8000/health`（infra/Dockerfile.api:76）。
- compose 的 `api` 服务 healthcheck：每 15 s 一次、超时 3 s、重试 5 次、启动宽限 10 s（infra/docker-compose.prod.yml:54-59）。
- `verify-phase6.sh`：检查响应体含 `"status"` 且耗时小于 500 ms（infra/scripts/verify-phase6.sh:113-122）。
- `smoke.sh` 访问的是 `https://localhost/api/v1/health` 并检查响应体含 `"status"`（infra/scripts/smoke.sh:108-109）。`/api/v1/health` 不在上面的路由表里；FastAPI 对未知路径返回 `{"detail":"Not Found"}`，其中不含 `"status"` 子串。

### 1.5 进程与容器运行方式

- 镜像基于 `python:3.11-slim` 两阶段构建：builder 阶段用 Poetry 把 `poetry.lock` 导出成无 hash 的 requirements 文件再用 `uv pip install --system` 安装（infra/Dockerfile.api:22-49）；runtime 阶段复制 site-packages、安装 `libpq5`、以 `appuser`（uid 1000）运行、`WORKDIR /app`、`EXPOSE 8000`（infra/Dockerfile.api:54-72）。
- 启动命令 `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`（infra/Dockerfile.api:78）：没有 `--workers`（单进程）、没有 `--reload`、没有 `--proxy-headers`。
- `backend/.dockerignore` 排除 `.env`、`*.db`、`tests/`、`README.md` 和各类缓存（backend/.dockerignore:6-37）；配置只能通过 compose 的 `env_file: ./.env` 进入容器（infra/docker-compose.prod.yml:39, 50）。
- 同一镜像先作为 `migrate` 服务运行 `alembic upgrade head`（infra/docker-compose.prod.yml:33-44）；`api` 服务要等 `migrate` 成功退出后才启动（infra/docker-compose.prod.yml:51-53）。`migrations/env.py` 用 `settings.DATABASE_URL` 覆盖 `alembic.ini` 里的 `sqlalchemy.url`（backend/migrations/env.py:22）。
- `api` 服务不发布任何端口，只有 Caddy 能在 compose 网络内访问它（infra/docker-compose.prod.yml:46-59, 61-79）。
- 本地开发：`poetry install`（backend/README.md:28）后 `poetry run uvicorn app.main:app --reload`（backend/README.md:67）。

---

## 2. 配置

### 2.1 加载规则

`Settings(BaseSettings)` 定义在 backend/app/core/config.py:8-43，在模块导入时实例化一次为 `settings`（backend/app/core/config.py:47）。`model_config` 为 `env_file=".env"`、`env_file_encoding="utf-8"`、`case_sensitive=True`、`extra="allow"`（backend/app/core/config.py:33-38）。由此产生的行为：

- `.env` 相对于进程当前工作目录解析，所以只有从 `backend/` 目录启动进程时 `backend/.env` 才会被读取。容器里没有 `.env` 文件（被 `.dockerignore` 排除），只有真正的环境变量生效。
- 优先级是 pydantic-settings 默认：真实环境变量 > `.env` 文件 > 类字段默认值。
- `case_sensitive=True`：变量名必须完全匹配（`DEBUG` 而不是 `debug`）。
- `extra="allow"`：只影响 `.env` 文件（dotenv）里多出来的键。pydantic-settings 从真实环境变量中只读取已声明的字段，未声明的环境变量本来就会被忽略，与 `extra` 无关；因此容器里由 compose `env_file` 注入的 `POSTGRES_USER`、`CADDY_DOMAIN` 等不经过这一项检查。只有从 `backend/` 启动且 `backend/.env` 含有未声明键时，`extra="allow"` 才让这些键被静默接受（挂到 `settings.model_extra`）而不是像 `extra="forbid"` 那样抛出 `Extra inputs are not permitted`。

### 2.2 字段表

| 字段 | 类型 | 默认值 | 环境变量 | 用在哪 | infra/.env.example 是否包含 |
|---|---|---|---|---|---|
| `DATABASE_URL` | str | `postgresql://wallet_user:wallet_password@localhost:5432/wallet_db` | `DATABASE_URL` | 建 engine 与 SQLite 判定（backend/app/core/database.py:19, 33）；Alembic（backend/migrations/env.py:22） | 是，第 17 行（`postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`） |
| `SECRET_KEY` | str | `your-secret-key-change-this-in-production` | `SECRET_KEY` | JWT 签名与验签（backend/app/core/security.py:59, 77） | 是，第 20 行（`CHANGE_ME_...` 哨兵值） |
| `ALGORITHM` | str | `HS256` | `ALGORITHM` | JWT 签名与验签（backend/app/core/security.py:59, 77） | 是，第 22 行 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | int | `30` | `ACCESS_TOKEN_EXPIRE_MINUTES` | 令牌有效期（backend/app/core/security.py:56） | 是，第 21 行 |
| `API_V1_PREFIX` | str | `/api/v1` | `API_V1_PREFIX` | 无处使用（前缀硬编码在 backend/app/main.py:27-30） | 否（infra/scripts/env-coverage.sh:19 明确把它排除在覆盖检查之外） |
| `PROJECT_NAME` | str | `Wallet App API` | `PROJECT_NAME` | FastAPI `title`（backend/app/main.py:12） | 否（同上排除） |
| `DEBUG` | bool | `False` | `DEBUG` | FastAPI `debug=`（backend/app/main.py:13）；SQL echo 开关（backend/app/core/database.py:21） | 是，第 32 行（`False`） |
| `ALLOWED_ORIGINS` | str（逗号分隔） | `http://localhost:8081,http://localhost:19006,http://localhost:3000` | `ALLOWED_ORIGINS` | CORS，经 `allowed_origins_list`（backend/app/core/config.py:40-43；backend/app/main.py:20） | 是，第 25 行（`https://CHANGE_ME_YOUR_DOMAIN`） |
| `EXCHANGE_RATE_API_URL` | str | `https://api.frankfurter.app` | `EXCHANGE_RATE_API_URL` | Frankfurter 基地址（backend/app/services/rates.py:41, 80） | 是，第 28 行，但主机不同：`https://api.frankfurter.dev/v1` |
| `ENVIRONMENT` | str | `development` | `ENVIRONMENT` | `/health` 响应体（backend/app/main.py:38）；SQL echo 开关（backend/app/core/database.py:21） | 是，第 31 行（`production`） |

补充事实：

- SQL echo 仅在 `ENVIRONMENT == "development" and DEBUG` 时打开（backend/app/core/database.py:20-22）。
- 非 SQLite URL 时 engine 追加 `pool_pre_ping=True`、`pool_recycle=3600`、`pool_size=5`、`max_overflow=10`；SQLite URL 时追加 `connect_args={"check_same_thread": False}`（backend/app/core/database.py:23-30）。
- 开发模板 `backend/env.example` 给的是 `DEBUG=True`（backend/env.example:12）、`EXCHANGE_RATE_API_URL=https://api.frankfurter.app`（backend/env.example:18）；生产模板 `infra/.env.example` 给的是 `DEBUG=False`。
- `backend/.env` 被 backend/.gitignore:31 忽略，不入库；本机快照中它存在且含 `DEBUG=True`、`DATABASE_URL=sqlite:///./wallet_dev.db`、`EXCHANGE_RATE_API_URL=https://api.frankfurter.dev/v1`，这会影响 §9 中 `test_config.py` 的结果。
- `infra/scripts/env-coverage.sh` 用正则从 `Settings` 类体里抽出全部 UPPER_SNAKE 字段名（排除 `API_V1_PREFIX`、`PROJECT_NAME`），用 `comm` 检查每个都出现在 `infra/.env.example` 中（infra/scripts/env-coverage.sh:14-34）。

---

## 3. 鉴权

### 3.1 密码哈希

`get_password_hash` 调 `bcrypt.gensalt()`（默认 cost 12，`$2b$` 前缀），再 `bcrypt.hashpw(password.encode("utf-8"), salt)`，把结果 `decode("utf-8")` 后存库（backend/app/core/security.py:33-37）。实测入库的哈希以 `$2b$12$` 开头。`verify_password` 就是 `bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))`（backend/app/core/security.py:25-30）。没有 pepper，登录时也不会重新哈希。

锁定的 bcrypt 5.0.0 对超过 72 字节的口令 `hashpw` 会抛 `ValueError`（bcrypt 5.0.0 changelog："Passing `hashpw` a password longer than 72 bytes now raises a ValueError"，此前是静默截断）。`register` 没有捕获它，所以这样的口令会得到 500。`UserCreate.password` 只有 `min_length=8`，没有上限（backend/app/schemas/user.py:11）。

### 3.2 JWT 签发

`create_access_token(data, expires_delta=None)`（backend/app/core/security.py:40-60）：

1. 复制 `data`；两个调用点传的都是 `{"sub": str(user.id)}`（backend/app/api/auth.py:60, 86）。
2. `exp = datetime.utcnow() + expires_delta`，未传则 `+ timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)`（backend/app/core/security.py:53-56）。
3. 追加 `iat = datetime.utcnow()`（backend/app/core/security.py:58）。
4. `jose.jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)`（backend/app/core/security.py:59）。

实测解码结果：

```
header: {"alg": "HS256", "typ": "JWT"}
claims: {"sub": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "exp": 1788416505, "iat": 1788414705}
```

`exp - iat = 1800` 秒（30 分钟）。没有刷新令牌、没有 `jti`、没有吊销列表；登出完全是客户端行为。

### 3.3 JWT 校验

`decode_access_token` 调 `jose.jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])`，捕到 `JWTError` 后原样重新抛出（backend/app/core/security.py:63-80）。python-jose 3.5.0 的默认选项会验签名和 `exp`（`leeway=0`）；`sub` 只校验"存在时必须是字符串"。过期令牌抛出的 `ExpiredSignatureError` 是 `JWTError` 的子类，因此与格式错误的令牌走同一条错误路径。

### 3.4 Bearer 提取与 `get_current_user`

`security = HTTPBearer()`（backend/app/core/security.py:22），`auto_error` 取默认值 `True`。在锁定的 FastAPI 0.109.2 中，`HTTPBearer.__call__` 在缺少 `Authorization` 头时抛 `HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Not authenticated")`，在 scheme 不是 `bearer` 时抛 `HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Invalid authentication credentials")`，两者都不带 `WWW-Authenticate` 头（fastapi 0.109.2 `fastapi/security/http.py` 第 301-317 行）。较新的 FastAPI（例如本机取证用的 0.135.3）这两种情况都返回 401 `"Not authenticated"` 并带 `WWW-Authenticate: Bearer`；仓库锁定的是 0.109.2。

`get_current_user(credentials, db)`（backend/app/core/security.py:83-144）按代码顺序：

1. 构造 `credentials_exception = HTTPException(401, "Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})`（backend/app/core/security.py:105-109）。
2. `decode_access_token(credentials.credentials)`；捕到 `JWTError` 时以 ERROR 级别记录 `DIAG_CREDENTIALS_EXCEPTION reason=jwt_decode_failed` 并抛 401（backend/app/core/security.py:112-117）。
3. 读 `payload.get("sub")`；为 `None` 时记录 `reason=sub_claim_missing` 并抛 401（backend/app/core/security.py:119-124）。
4. 查库之前的其他任何异常用 `logger.exception` 记录后映射为同一个 401（backend/app/core/security.py:128-130）。
5. `db.query(User).filter(User.id == uuid.UUID(user_id)).first()`；`sub` 不是合法 UUID 时 `uuid.UUID()` 在 `try` 内抛 `ValueError`，被记录为 `DIAG_DB_ERROR user query failed` 并映射为 401（backend/app/core/security.py:133-138）。
6. 查不到用户时记录 `reason=user_not_found` 并抛 401（backend/app/core/security.py:140-142）。
7. 返回 ORM `User` 对象（backend/app/core/security.py:144）。

日志：`logger = logging.getLogger(__name__)`，即 `app.core.security`（backend/app/core/security.py:19）；`app/` 下没有任何 `logging.basicConfig` / `dictConfig` 配置。uvicorn 下根 logger 停留在 WARNING，所以 backend/app/core/security.py:120 和 135 的 `logger.info(...)` 永远不会输出，而 `logger.error` / `logger.exception` 会输出到 stderr（实测只看到 `DIAG_CREDENTIALS_EXCEPTION` 和 `DIAG_DB_ERROR` 两类行）。

任何受保护路由的错误矩阵：

| 情形 | 状态码 | 响应体 | `WWW-Authenticate` 头 |
|---|---|---|---|
| 没有 `Authorization` 头 | 403（FastAPI 0.109.2） | `{"detail":"Not authenticated"}` | 无 |
| `Authorization: Basic ...` | 403（FastAPI 0.109.2） | `{"detail":"Invalid authentication credentials"}` | 无 |
| 令牌格式错误或签名不对 | 401 | `{"detail":"Could not validate credentials"}` | `Bearer` |
| 令牌过期 | 401 | 同上 | `Bearer` |
| 令牌有效但没有 `sub` | 401 | 同上 | `Bearer` |
| 令牌有效但 `sub` 不是 UUID | 401 | 同上 | `Bearer` |
| 令牌有效但用户行不存在 | 401 | 同上 | `Bearer` |

`authenticate_user(db, email, password)` 供登录用：按 email 查用户，查不到或 `verify_password` 失败都返回 `None`（backend/app/core/security.py:147-167）。

### 3.5 令牌生命周期与客户端处理

```
 [无令牌] --POST /auth/register 或 /auth/login 成功--> [令牌有效]
 [令牌有效] --30 分钟过去--> [令牌过期] --任何受保护调用--> 401
 [令牌有效] --客户端清空 AsyncStorage--> [无令牌]
```

前端把令牌存在 AsyncStorage 键 `@wallet_app:auth_token`（frontend/src/constants/config.ts:10-13），通过 `setAuthToken` 写入（frontend/src/api/client.ts:84-86），在 axios 请求拦截器里加 `Authorization: Bearer <token>`（frontend/src/api/client.ts:19-34）；响应拦截器遇到 401 且请求不是 `GET /auth/me` 时，同时删除令牌和缓存的用户 JSON `@wallet_app:user_data`（frontend/src/api/client.ts:48-64）。登录 / 注册成功后立即调 `GET /auth/me` 并把用户 JSON 缓存起来（frontend/src/store/AuthContext.tsx:74-84, 101-111）。

---

## 4. 接口逐个说明

### 4.0 约定

- "鉴权：bearer" 表示处理函数带 `Depends(get_current_user)`；§3.4 的全部错误都发生在处理函数体执行之前。
- 422 响应体是 FastAPI 标准结构 `{"detail":[{"type","loc","msg","input"[,"ctx"]}]}`；每个 schema 的具体错误见 §7。
- `Decimal` 字段在 JSON 里序列化为字符串（pydantic v2 JSON 模式）；`UUID` 为字符串；`datetime` 为不带时区、带微秒的 ISO-8601（值来自 `datetime.utcnow()` 默认值，backend/app/models/user.py:21；backend/app/models/finance_source.py:22；backend/app/models/transaction.py:25）；`date` 为 `YYYY-MM-DD`。
- 所有按 id 取单条的查询都带 `user_id == current_user.id` 条件，别人的资源和不存在的资源都返回 404，不返回 403。

### 4.1 `POST /api/v1/auth/register`

鉴权：无。处理函数 `register`（backend/app/api/auth.py:20-62）。成功状态码 201，`response_model=Token`（backend/app/schemas/user.py:47-50）。

请求体 `UserCreate`（backend/app/schemas/user.py:8-12）：

| 字段 | 类型 | 必填 | 约束 / 说明 |
|---|---|---|---|
| `email` | `EmailStr` | 是 | email-validator 做语法校验（不查 DNS）；域名部分被小写化（实测 `Alice@Example.COM` 存为 `Alice@example.com`） |
| `password` | str | 是 | `min_length=8`；无上限（bcrypt 72 字节限制见 §3.1） |
| `base_currency` | str | 是 | `min_length=3, max_length=3`；任意 3 个字符都过校验；处理函数里 `.upper()`（backend/app/api/auth.py:45） |

流程：

1. 客户端提交注册表单 → `POST /api/v1/auth/register`，JSON 请求体。
2. pydantic 校验请求体；失败 → 422。
3. `db.query(User).filter(User.email == email).first()`；已存在 → 400 `"Email already registered"`（backend/app/api/auth.py:32-37）。
4. `get_password_hash(password)`（backend/app/api/auth.py:40）。
5. 构造 `User(email, password_hash, base_currency.upper())`，`add` + `commit` + `refresh`；`default_source_id` 为 NULL，`created_at` 取 `utcnow()`（backend/app/api/auth.py:42-51）。若并发插入触发唯一索引 `ix_users_email`（backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:44）抛 `IntegrityError`，则 `rollback` 并映射为同一个 400（backend/app/api/auth.py:52-57）。
6. `create_access_token({"sub": str(new_user.id)})`（backend/app/api/auth.py:60）。
7. 响应 `{"access_token": ..., "token_type": "bearer"}`（backend/app/api/auth.py:62）。
8. 客户端存令牌、调 `GET /auth/me`、缓存用户（frontend/src/store/AuthContext.tsx:101-111）。

```json
POST /api/v1/auth/register
{"email": "alice@example.com", "password": "correct horse battery", "base_currency": "usd"}

-> 201
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0ZWUxYzhmYS1lZWFjLTRhMDgtYWQ5YS1jNGJlNzIxMWE4NzYiLCJleHAiOjE3ODg0MTY1MDUsImlhdCI6MTc4ODQxNDcwNX0.5W0SgoudJxQ22cE834lX5Mst7OS1gvi_6x2abA8ZPKo",
  "token_type": "bearer"
}
```

错误：

| 状态码 | detail | 位置 |
|---|---|---|
| 400 | `"Email already registered"` | backend/app/api/auth.py:34-37 与 54-57 |
| 422 | pydantic 错误：`email` 为 `value_error`（msg `"value is not a valid email address: An email address must have an @-sign."`）；`password` 为 `string_too_short`（ctx `{"min_length": 8}`）；`base_currency` 为 `string_too_short` 或 `string_too_long`；缺字段为 `missing` | schema |

实测 422 示例（三项同时出错）：

```json
POST /api/v1/auth/register
{"email": "nope", "password": "short", "base_currency": "US"}
-> 422
{"detail": [
  {"type": "value_error", "loc": ["body", "email"], "msg": "value is not a valid email address: An email address must have an @-sign.", "input": "nope", "ctx": {"reason": "An email address must have an @-sign."}},
  {"type": "string_too_short", "loc": ["body", "password"], "msg": "String should have at least 8 characters", "input": "short", "ctx": {"min_length": 8}},
  {"type": "string_too_short", "loc": ["body", "base_currency"], "msg": "String should have at least 3 characters", "input": "US", "ctx": {"min_length": 3}}
]}
```

副作用：一条 `INSERT INTO users`。无外部调用。

### 4.2 `POST /api/v1/auth/login`

鉴权：无。处理函数 `login`（backend/app/api/auth.py:65-88）。状态码 200，`response_model=Token`。

请求体 `UserLogin`（backend/app/schemas/user.py:15-18）：`email: EmailStr`（必填）、`password: str`（必填，无长度约束）。

流程：

1. `authenticate_user(db, email, password)`：按 email 查用户；不存在或 `verify_password` 失败都返回 `None`（backend/app/core/security.py:147-167）。
2. `None` → 401 `"Incorrect email or password"`，带 `WWW-Authenticate: Bearer`（backend/app/api/auth.py:78-83）。未知邮箱和错误口令在响应上不可区分，但未知邮箱时跳过了 bcrypt 比对（耗时不同）。
3. 签发令牌，与注册完全一致（backend/app/api/auth.py:86-88）。
4. 客户端存令牌、调 `GET /auth/me`、缓存用户（frontend/src/store/AuthContext.tsx:74-84）。

```json
POST /api/v1/auth/login
{"email": "alice@example.com", "password": "nope"}
-> 401   （响应头 WWW-Authenticate: Bearer）
{"detail": "Incorrect email or password"}

POST /api/v1/auth/login
{"email": "alice@example.com", "password": "correct horse battery"}
-> 200
{"access_token": "eyJ...", "token_type": "bearer"}
```

不写库；没有限流或锁定。

### 4.3 `GET /api/v1/auth/me`

鉴权：bearer。处理函数 `get_current_user_info`（backend/app/api/auth.py:91-98）直接返回 ORM 用户；`response_model=UserResponse`（backend/app/schemas/user.py:21-30，`from_attributes = True`）。

```json
GET /api/v1/auth/me   Authorization: Bearer <token>
-> 200
{
  "id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876",
  "email": "alice@example.com",
  "base_currency": "USD",
  "default_source_id": null,
  "created_at": "2026-09-03T05:51:45.537326"
}
```

`default_source_id` 在第一个资金账户（finance source）创建（§4.8）或 PATCH 设置之前都是 `null`。只有 §3.4 的错误。每次调用一条 `SELECT ... FROM users`（在 `get_current_user` 内部）。

### 4.4 `PATCH /api/v1/auth/me`

鉴权：bearer。处理函数 `update_current_user`（backend/app/api/auth.py:101-138）。`response_model=UserResponse`。

请求体 `UserUpdate`（backend/app/schemas/user.py:33-44），两个字段都可选：

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| `base_currency` | str，可为 null | `min_length=3, max_length=3`；无正则；处理函数里 `.upper()`（backend/app/api/auth.py:125-126） |
| `default_source_id` | UUID，可为 null | 必须是调用者自己拥有的资金账户 |

流程：

1. 校验请求体；失败 → 422。
2. 若 `default_source_id` 不是 `None`：按 id **且** `user_id == current_user.id` 查 `FinanceSource`；查不到 → 404 `"Finance source not found"`（backend/app/api/auth.py:114-120）。已归档的账户也可以设为默认。
3. `update_fields = user_data.model_dump(exclude_unset=True)`——只应用 JSON 里出现的键（backend/app/api/auth.py:122）。`.upper()` 用真值判断做了保护（backend/app/api/auth.py:125-126），所以显式的 `"base_currency": null` 会被 `setattr` 原样写入（backend/app/api/auth.py:128-129），在 commit 时违反 `NOT NULL`——实测返回 500，用户数据不变。显式的 `"default_source_id": null` 把列置为 NULL（第 2 步的归属检查对 `None` 不执行）。
4. `db.commit()`、`db.refresh(current_user)`，然后在会话关闭前主动触碰五个列以强制加载（backend/app/api/auth.py:131-136）。
5. 返回刷新后的用户。空请求体 `{}` 是合法的空操作，返回 200 和当前资料。
6. 客户端：ProfileScreen 通过 `updateMe` 发送 `{ base_currency }`（frontend/src/screens/ProfileScreen.tsx:52）。

```json
PATCH /api/v1/auth/me
{"base_currency": "eur"}
-> 200
{
  "id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876",
  "email": "alice@example.com",
  "base_currency": "EUR",
  "default_source_id": null,
  "created_at": "2026-09-03T05:51:45.537326"
}

PATCH /api/v1/auth/me
{"default_source_id": "04493455-574a-4bda-9993-c0e5c1be230d"}
-> 404
{"detail": "Finance source not found"}

PATCH /api/v1/auth/me
{"base_currency": null}
-> 500   （纯文本 Internal Server Error；NOT NULL 约束在 commit 时失败）
```

改 `base_currency` 不会改动任何已存交易；它只改变之后的响应换算到哪个币种（§5、§6）。

用户 `default_source_id` 的状态：

```
             POST /finance-sources（该用户账户数变为 1）
 [NULL] ----------------------------------------------------> [账户 X]
   ^                                                              |
   |  PATCH /auth/me {"default_source_id": null}                  |  PATCH /auth/me {"default_source_id": Y（本人拥有）}
   +--------------------------------------------------------------+---> [账户 Y]
   ^
   |  数据库层 ON DELETE SET NULL（只有绕过 API 直接删行时才会发生）
   +-- （没有任何 API 路径删除资金账户）
```

（外键 `ondelete="SET NULL"`：backend/app/models/user.py:20；迁移 backend/migrations/versions/76227e076393_add_default_source_to_users.py:30-35。）

### 4.5 `GET /api/v1/rates/currencies`

鉴权：无（没有任何依赖）。处理函数 `get_currencies`（backend/app/api/rates.py:20-29）。`response_model=CurrencyList`（`currencies: Dict[str, str]`，backend/app/schemas/currency.py:12-22）。

调 `get_supported_currencies()`：每个进程只请求一次 `GET {EXCHANGE_RATE_API_URL}/currencies`，把结果字典永久缓存在模块全局 `_SUPPORTED_CURRENCIES_CACHE`（backend/app/services/rates.py:15, 37-38, 46）。实测：连续两次请求只产生一次上游调用。

```json
GET /api/v1/rates/currencies
-> 200
{"currencies": {"USD": "United States Dollar", "EUR": "Euro", "GBP": "British Pound", "CNY": "Chinese Renminbi Yuan"}}
```

（真实的 Frankfurter 列表为 30 项（2026-09-03 线上探测）；backend/app/api/rates.py:25-26 的 docstring 写的 31 已过时。）错误：上游失败且尚无缓存时 → 503 `"Failed to fetch supported currencies: <httpx 错误文本>"`（backend/app/services/rates.py:49-53）。这是前端唯一会调用的 `/rates` 接口（frontend/src/api/rates.ts:13-16）。

### 4.6 `GET /api/v1/rates/latest`

鉴权：无。处理函数 `get_latest_rates`（backend/app/api/rates.py:32-61）。`response_model=ExchangeRateResponse`（backend/app/schemas/currency.py:25-33）。

| query 参数 | 类型 | 默认值 | 约束 |
|---|---|---|---|
| `base` | str | `"USD"` | `min_length=3, max_length=3`（backend/app/api/rates.py:34） |
| `symbols` | str | `"EUR,GBP,CNY"` | 逗号分隔；按逗号拆分、逐项 `strip()`、丢弃空项（backend/app/api/rates.py:49） |

流程：`fetch_latest_rates(base, symbol_list)` → 一次上游 `GET /latest?from=<BASE>&to=<S1,S2,...>`（代码在服务层里 `.upper()`，backend/app/services/rates.py:80-84）；响应 `{"base": base.upper(), "date": date.today().isoformat(), "rates": {code: Decimal}}`（backend/app/api/rates.py:55-61）。`date` 是服务器本地日历日期，不是 Frankfurter 返回的汇率日期。若所有 symbol 都是空白，上游的 `to` 参数被发送为空字符串（实测 `symbols=,` 时上游参数为 `{"from": "USD", "to": ""}`，响应 `rates` 为 `{}`）。

```json
GET /api/v1/rates/latest?base=usd&symbols=eur,%20gbp
-> 200
{"base": "USD", "date": "2026-09-03", "rates": {"EUR": "0.92", "GBP": "0.79"}}

GET /api/v1/rates/latest?base=US
-> 422
{"detail": [{"type": "string_too_short", "loc": ["query", "base"], "msg": "String should have at least 3 characters", "input": "US", "ctx": {"min_length": 3}}]}

GET /api/v1/rates/latest?base=USD&symbols=EUR   （Frankfurter 不可达，httpx 抛 ConnectError）
-> 503
{"detail": "Failed to fetch exchange rates: [Errno 111] Connection refused"}

GET /api/v1/rates/latest?base=XXX&symbols=USD   （Frankfurter 返回 404，raise_for_status 抛 HTTPStatusError）
-> 503
{"detail": "Failed to fetch exchange rates: Client error '404 Not Found' for url 'https://api.frankfurter.app/latest?from=XXX&to=USD'\nFor more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404"}
```

冒号后的文本就是 httpx 异常的 `str(e)`（backend/app/services/rates.py:98），随 httpx 版本和错误类型变化；上面两条是按锁定的 httpx 0.26.0 的消息格式写出的，§0.2 的取证桩件产生的文本与此不同。

不访问数据库。前端没有调用者。

### 4.7 `POST /api/v1/rates/convert`

鉴权：无。处理函数 `convert_currency`（backend/app/api/rates.py:64-105）。`response_model=ConversionResult`（backend/app/schemas/currency.py:43-50）。

请求体 `ConversionRequest`（backend/app/schemas/currency.py:36-40）：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `amount` | Decimal | 是 | `gt=0` |
| `from_currency` | str | 是 | `min_length=3, max_length=3`；大小写不敏感（服务层 `.upper()`） |
| `to_currency` | str | 是 | 同上 |

流程：

1. `convert_amount(amount, from, to)`：币种相同 → 原样返回 `amount`（不做 quantize）；否则一次上游调用 `from=FROM&to=TO`，`converted = (amount * rate).quantize(Decimal("0.0001"))`（backend/app/services/rates.py:123-139）。若上游返回的 `rates` 里没有目标币种 → 400 `"Exchange rate not available for {from_currency} to {to_currency}"`（backend/app/services/rates.py:129-133）。
2. 为了填 `rate` 字段，处理函数**再发一次完全相同的上游请求**（`fetch_latest_rates(from, [to])`），除非币种相同——那时 `rate = 1.0`（float，序列化为 `"1.0"`）（backend/app/api/rates.py:90-94）。实测：跨币种请求产生两次上游调用。
3. 响应回显原始 `amount`（按发送的形式）、大写币种码、`converted_amount`、`rate`、服务器日期（backend/app/api/rates.py:98-105）。

```json
POST /api/v1/rates/convert
{"amount": 100, "from_currency": "usd", "to_currency": "eur"}
-> 200
{"amount": "100", "from_currency": "USD", "to_currency": "EUR", "converted_amount": "92.0000", "rate": "0.92", "date": "2026-09-03"}

POST /api/v1/rates/convert
{"amount": "100.00", "from_currency": "usd", "to_currency": "USD"}
-> 200
{"amount": "100.00", "from_currency": "USD", "to_currency": "USD", "converted_amount": "100.00", "rate": "1.0", "date": "2026-09-03"}

POST /api/v1/rates/convert
{"amount": -1, "from_currency": "USD", "to_currency": "EUR"}
-> 422
{"detail": [{"type": "greater_than", "loc": ["body", "amount"], "msg": "Input should be greater than 0", "input": -1, "ctx": {"gt": 0}}]}
```

上游失败时的 503 与 §4.6 相同。不访问数据库；前端没有调用者。

### 4.8 `POST /api/v1/finance-sources`

鉴权：bearer。处理函数 `create_finance_source`（backend/app/api/finance_sources.py:17-51）。状态码 201，`response_model=FinanceSourceResponse`（backend/app/schemas/finance_source.py:51-63）。

请求体 `FinanceSourceCreate`（backend/app/schemas/finance_source.py:11-31）：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `name` | str | 是 | `min_length=1, max_length=100`（backend/app/schemas/finance_source.py:14-20） |
| `type` | str | 是 | 正则限定为 `checking`、`savings`、`credit`、`other` 四选一（backend/app/schemas/finance_source.py:21-26；正则原文见 §7） |
| `default_currency` | `CurrencyCode` | 是 | 正则 `^[A-Z]{3}$`——小写会被 422 拒绝，尽管处理函数还会再 `.upper()` 一次（backend/app/api/finance_sources.py:35） |

流程：

1. 校验 → 422。
2. 构造 `FinanceSource(user_id=current_user.id, name, type, default_currency.upper(), archived=False)`；`add`、`commit`、`refresh`（backend/app/api/finance_sources.py:31-41）。
3. `count = SELECT count(*) FROM finance_sources WHERE user_id = ?`；若 `count == 1`，把 `current_user.default_source_id` 设为新账户 id 并再次 commit（backend/app/api/finance_sources.py:44-49）。已归档账户也计数，所以自动设默认只发生在该用户有史以来创建的第一个账户上。
4. 返回该账户。
5. 客户端：FinanceSourceFormScreen 的 mutation 成功后使 `finance_sources` 查询失效（frontend/src/screens/FinanceSourceFormScreen.tsx:41-43）；交易表单在新建时默认选中 `sources[0]`（frontend/src/screens/TransactionFormScreen.tsx:69-73）。

```json
POST /api/v1/finance-sources
{"name": "Chase Checking", "type": "checking", "default_currency": "USD"}
-> 201
{
  "id": "34fa63d8-5776-4775-982b-4d58deb0ace9",
  "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876",
  "name": "Chase Checking",
  "type": "checking",
  "default_currency": "USD",
  "archived": false,
  "created_at": "2026-09-03T05:51:45.934119"
}

随后 GET /api/v1/auth/me -> 200 中 "default_source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9"
```

错误（除鉴权外只有 422）：

```json
{"detail": [{"type": "string_pattern_mismatch", "loc": ["body", "default_currency"], "msg": "String should match pattern '^[A-Z]{3}$'", "input": "usd", "ctx": {"pattern": "^[A-Z]{3}$"}}]}
{"detail": [{"type": "string_pattern_mismatch", "loc": ["body", "type"], "msg": "String should match pattern '^(checking|savings|credit|other)$'", "input": "wallet", "ctx": {"pattern": "^(checking|savings|credit|other)$"}}]}
{"detail": [{"type": "string_too_short", "loc": ["body", "name"], "msg": "String should have at least 1 character", "input": "", "ctx": {"min_length": 1}}]}
```

副作用：`INSERT INTO finance_sources`；可能还有一条 `UPDATE users SET default_source_id`。同一用户下 `name` 不要求唯一。

### 4.9 `GET /api/v1/finance-sources`

鉴权：bearer。处理函数 `list_finance_sources`（backend/app/api/finance_sources.py:54-71）。`response_model=List[FinanceSourceResponse]`。

| query 参数 | 类型 | 默认值 | 行为 |
|---|---|---|---|
| `include_archived` | bool | `false` | 为 false 时追加 `WHERE archived = false`（backend/app/api/finance_sources.py:67-68） |

排序 `created_at DESC`（backend/app/api/finance_sources.py:70）。没有分页。非布尔值 → 422 `bool_parsing`（msg `"Input should be a valid boolean, unable to interpret input"`）。前端调用时总是显式传 `include_archived`（frontend/src/api/financeSources.ts:15-20）。

```json
GET /api/v1/finance-sources?include_archived=true
-> 200
[
  {"id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "name": "Revolut EUR", "type": "other", "default_currency": "EUR", "archived": true, "created_at": "2026-09-03T05:51:45.953116"},
  {"id": "34fa63d8-5776-4775-982b-4d58deb0ace9", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "name": "Chase Checking", "type": "checking", "default_currency": "USD", "archived": false, "created_at": "2026-09-03T05:51:45.934119"}
]

GET /api/v1/finance-sources?include_archived=maybe
-> 422
{"detail": [{"type": "bool_parsing", "loc": ["query", "include_archived"], "msg": "Input should be a valid boolean, unable to interpret input", "input": "maybe"}]}
```

### 4.10 `GET /api/v1/finance-sources/{source_id}`

鉴权：bearer。处理函数 `get_finance_source`（backend/app/api/finance_sources.py:74-96）。路径参数 `source_id: UUID`（非 UUID → 422 `uuid_parsing`，`loc` 为 `["path","source_id"]`）。按 id **且**归属查询；不存在或属于别人 → 404 `"Finance source {source_id} not found"`（backend/app/api/finance_sources.py:85-94）。已归档账户照常返回。

```json
GET /api/v1/finance-sources/04493455-574a-4bda-9993-c0e5c1be230d
-> 404
{"detail": "Finance source 04493455-574a-4bda-9993-c0e5c1be230d not found"}

GET /api/v1/finance-sources/abc
-> 422
{"detail": [{"type": "uuid_parsing", "loc": ["path", "source_id"], "msg": "Input should be a valid UUID, invalid length: expected length 32 for simple format, found 3", "input": "abc", "ctx": {"error": "invalid length: expected length 32 for simple format, found 3"}}]}
```

### 4.11 `PATCH /api/v1/finance-sources/{source_id}`

鉴权：bearer。处理函数 `update_finance_source`（backend/app/api/finance_sources.py:99-135）。

请求体 `FinanceSourceUpdate`（backend/app/schemas/finance_source.py:34-48）：`name`（str，可为 null，`min_length=1, max_length=100`）、`archived`（bool，可为 null）。`type` 和 `default_currency` 不能通过接口修改。

流程：按归属查询 → 404（同 §4.10，backend/app/api/finance_sources.py:115-124）；`model_dump(exclude_unset=True)`（backend/app/api/finance_sources.py:127）；对每个出现的键 `setattr`（显式 `"name": null` 会被写入并在 commit 时违反 `NOT NULL`）（backend/app/api/finance_sources.py:129-130）；commit、refresh、返回（backend/app/api/finance_sources.py:132-135）。`{}` 是合法空操作。客户端成功后使 `finance_sources` 查询失效（frontend/src/screens/FinanceSourceFormScreen.tsx:55-57）。

```json
PATCH /api/v1/finance-sources/1022fd24-78a1-4c09-9de9-1cd7fbb0877f
{"archived": true}
-> 200
{"id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "name": "Revolut EUR", "type": "other", "default_currency": "EUR", "archived": true, "created_at": "2026-09-03T05:51:45.953116"}
```

资金账户的状态：

```
 POST -> [活跃: archived=false] --PATCH {"archived": true}--> [已归档: archived=true]
                 ^                                                       |
                 +------------------PATCH {"archived": false}------------+
 （没有删除；已归档账户仍可按 id GET、仍可作为交易的 source_id、仍可作为 default_source_id）
```

### 4.12 `POST /api/v1/transactions`

鉴权：bearer。处理函数 `create_transaction`（backend/app/api/transactions.py:52-141）。状态码 201，`response_model=TransactionResponse`（backend/app/schemas/transaction.py:89-124）。

请求体 `TransactionCreate`（backend/app/schemas/transaction.py:12-54）：

| 字段 | 类型 | 必填 | 默认 | 约束 / 说明 |
|---|---|---|---|---|
| `source_id` | UUID，可为 null | 否 | `null` → 回退到 `current_user.default_source_id`（backend/app/api/transactions.py:70） | 必须属于调用者 |
| `amount` | Decimal | 是 | — | `decimal_places=4`；符号有含义（负数为支出）；JSON 数字或数字字符串都接受；允许 0 和负数 |
| `currency` | `CurrencyCode` | 是 | — | `^[A-Z]{3}$`（处理函数里再 `.upper()`，backend/app/api/transactions.py:95） |
| `occurred_at` | date | 是 | — | `YYYY-MM-DD` |
| `description` | str，可为 null | 否 | `null` | `max_length=500` |
| `merchant` | str，可为 null | 否 | `null` | `max_length=200` |
| `tags` | list of str，可为 null | 否 | `[]`（`default_factory=list`） | 每项 `strip().lower()`（backend/app/api/transactions.py:110）；没有单个标签长度校验（数据库列是 `String(64)`，backend/app/models/transaction_tag.py:14） |
| `transfer_pair_id` | UUID，可为 null | 否 | `null` | 原样存储；不与任何东西做校验 |

流程：

1. 校验 → 422。
2. `source_id = body.source_id or current_user.default_source_id`；两者都没有 → 400 `"No finance source specified and user has no default source. Please create a finance source first."`（backend/app/api/transactions.py:70-76）。
3. 按归属查 `FinanceSource`；查不到 → 404 `"Finance source {source_id} not found or does not belong to you"`（backend/app/api/transactions.py:79-88）。已归档账户可以用。
4. 构造 `Transaction(...)`，`db.add`，`db.flush()` 取得 id（backend/app/api/transactions.py:91-103）。
5. 每个标签一条 `TransactionTag(transaction_id, tag.strip().lower())` 加入会话（backend/app/api/transactions.py:106-112）。主键是 `(transaction_id, tag)`（backend/app/models/transaction_tag.py:17-19），规范化后重复的标签（如 `["Food","food"]`）在 commit 时抛 `IntegrityError`，没有被捕获 → 500（实测）。
6. `db.commit()`、`db.refresh()`（backend/app/api/transactions.py:114-115）。
7. `_build_conversion_fields(currency, amount, current_user.base_currency)`（§5.4 路径 A）——最多两次 Frankfurter 调用；失败得到三个 null，绝不报错（backend/app/api/transactions.py:118-122）。
8. 显式构造 `TransactionResponse(...)`；`tags` 从 `new_transaction.tags` 懒加载（backend/app/api/transactions.py:124-139）。
9. 客户端：单笔创建成功后使 `transactions` 查询失效并调用 `onSuccess()` 返回（frontend/src/screens/TransactionFormScreen.tsx:99-105）。

```json
POST /api/v1/transactions
{"amount": -45.5, "currency": "EUR", "occurred_at": "2026-09-01", "description": "Groceries", "merchant": "Carrefour", "tags": [" Food ", "groceries"]}
-> 201   （用户 base_currency 为 USD）
{
  "id": "f59f243d-3246-49ab-adb5-60761e061571",
  "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876",
  "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9",
  "amount": "-45.5000",
  "currency": "EUR",
  "occurred_at": "2026-09-01",
  "description": "Groceries",
  "merchant": "Carrefour",
  "transfer_pair_id": null,
  "created_at": "2026-09-03T05:51:45.998347",
  "converted_amount": "-49.4567",
  "conversion_rate": "1.08696",
  "conversion_date": "2026-09-03",
  "tags": ["food", "groceries"]
}
```

同币种示例（三个换算字段都为 null；`amount` 以字符串发送）：

```json
POST /api/v1/transactions
{"amount": "12.34", "currency": "USD", "occurred_at": "2026-09-02", "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9"}
-> 201
{"id": "bd54a283-94e2-4511-88b2-9c7dd9e9d3ed", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9", "amount": "12.3400", "currency": "USD", "occurred_at": "2026-09-02", "description": null, "merchant": null, "transfer_pair_id": null, "created_at": "2026-09-03T05:51:46.008940", "converted_amount": null, "conversion_rate": null, "conversion_date": null, "tags": []}
```

错误：

| 状态码 | detail |
|---|---|
| 400 | `"No finance source specified and user has no default source. Please create a finance source first."` |
| 404 | `"Finance source <uuid> not found or does not belong to you"` |
| 422 | `decimal_max_places`（msg `"Decimal input should have no more than 4 decimal places"`，ctx `{"decimal_places": 4}`）；`currency` 的 `string_pattern_mismatch`；`occurred_at` 的 `date_from_datetime_parsing`（输入 `01/09/2026` 时 msg 为 `"Input should be a valid date or datetime, invalid character in year"`）；`missing` |
| 500 | 规范化后重复的标签（未捕获的 `IntegrityError`） |

副作用：`INSERT INTO transactions`、N 条 `INSERT INTO transaction_tags`、0 到 2 次 Frankfurter GET。

转账（transfer）：后端没有转账接口。前端生成 `pairId = crypto.randomUUID()`，顺序发两次 POST——来源账户 `-abs(amount)`、目标账户 `+abs(amount)`——两笔带同一个 `transfer_pair_id`、同样的币种、日期、描述、商户和标签（frontend/src/screens/TransactionFormScreen.tsx:161-201）；第二笔失败时尝试 `DELETE` 第一笔做回滚（frontend/src/screens/TransactionFormScreen.tsx:211-233）。API 把每一腿都当作普通交易。

### 4.13 `GET /api/v1/transactions`

鉴权：bearer。处理函数 `list_transactions`（backend/app/api/transactions.py:144-275）。`response_model=List[TransactionResponse]`。

| query 参数 | 类型 | 默认 | 行为 |
|---|---|---|---|
| `source_id` | UUID | 无 | 先按归属检查账户存在；查不到 → 404 `"Finance source {source_id} not found"`；然后 `WHERE source_id = ?`（backend/app/api/transactions.py:175-186）。非 UUID → 422 |
| `from_date` | str | 无 | `datetime.strptime(..., "%Y-%m-%d")`；`occurred_at >= from`；格式错 → 400 `"Invalid from_date format. Use YYYY-MM-DD"`（backend/app/api/transactions.py:188-197） |
| `to_date` | str | 无 | `occurred_at <= to`（含当天）；格式错 → 400 `"Invalid to_date format. Use YYYY-MM-DD"`（backend/app/api/transactions.py:199-208） |
| `tag` | str | 无 | `JOIN transaction_tags` 且 `tag == tag.lower()`（只小写化，不 strip）（backend/app/api/transactions.py:210-212） |
| `limit` | int | 50 | 大于 100 时静默截为 100（backend/app/api/transactions.py:168-169）；没有下限；非整数 → 422 `int_parsing` |
| `offset` | int | 0 | 直接作 SQL OFFSET |

排序 `occurred_at DESC, created_at DESC`（backend/app/api/transactions.py:215）。不返回总数；客户端只能按 `limit` / `offset` 盲翻页。前端传的可选参数 `TransactionListParams` 与之同名（frontend/src/api/transactions.ts:8-27）；TransactionsScreen 只传 `{ limit }`（frontend/src/screens/TransactionsScreen.tsx:24）。

流程：

1. 构造并执行查询（一条 `SELECT ... FROM transactions`）。
2. `unique_currencies = {tx.currency.upper() for tx in 本页 if != base}`（backend/app/api/transactions.py:218-222）。
3. 非空时发**一次**上游调用 `from=<BASE>&to=<C1,C2,...>`；捕到 `HTTPException` → `batch_rates = None`，本页全部换算字段为 null（backend/app/api/transactions.py:224-235）。
4. 逐条：按 §5.4 路径 B 换算；`tags` 懒加载（每行一条 `SELECT`）；构造 `TransactionResponse`（backend/app/api/transactions.py:238-273）。

```json
GET /api/v1/transactions   （base USD；本页有一笔 EUR）
-> 200
[
  {"id": "bd54a283-94e2-4511-88b2-9c7dd9e9d3ed", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9", "amount": "12.3400", "currency": "USD", "occurred_at": "2026-09-02", "description": null, "merchant": null, "transfer_pair_id": null, "created_at": "2026-09-03T05:51:46.008940", "converted_amount": null, "conversion_rate": null, "conversion_date": null, "tags": []},
  {"id": "5bc5962f-2469-42d1-8133-65741d2337ed", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9", "amount": "2500.0000", "currency": "USD", "occurred_at": "2026-09-01", "description": "Salary", "merchant": null, "transfer_pair_id": null, "created_at": "2026-09-03T05:51:46.017400", "converted_amount": null, "conversion_rate": null, "conversion_date": null, "tags": ["income"]},
  {"id": "f59f243d-3246-49ab-adb5-60761e061571", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9", "amount": "-45.5000", "currency": "EUR", "occurred_at": "2026-09-01", "description": "Groceries", "merchant": "Carrefour", "transfer_pair_id": null, "created_at": "2026-09-03T05:51:45.998347", "converted_amount": "-49.4565", "conversion_rate": "1.086957", "conversion_date": "2026-09-03", "tags": ["food", "groceries"]}
]
```

注意同一笔 EUR 交易在 `POST` / `GET /{id}` 中报 `"-49.4567"` / `"1.08696"`，而在列表里报 `"-49.4565"` / `"1.086957"`——两条代码路径的上游查询方向和舍入都不同（§5.4）。

实测以上示例这次调用（3 行）产生的 SQL：1 条 `SELECT users`（鉴权）+ 1 条 `SELECT transactions` + 3 条 `SELECT transaction_tags` = 5 条；一般地是 `2 + 行数` 条。上游调用恰好一次：`from=USD&to=EUR`。Frankfurter 不可达时列表照常返回 200，只是换算字段全为 null。

错误示例：

```json
GET /api/v1/transactions?from_date=2026/09/01 -> 400 {"detail": "Invalid from_date format. Use YYYY-MM-DD"}
GET /api/v1/transactions?limit=abc -> 422 {"detail": [{"type": "int_parsing", "loc": ["query", "limit"], "msg": "Input should be a valid integer, unable to parse string as an integer", "input": "abc"}]}
GET /api/v1/transactions?source_id=cd33fc5d-b177-4207-b351-96f4990af26a -> 404 {"detail": "Finance source cd33fc5d-b177-4207-b351-96f4990af26a not found"}
GET /api/v1/transactions?tag=FOOD -> 200 （匹配到标签 "food" 的那一笔）
```

### 4.14 `GET /api/v1/transactions/{transaction_id}`

鉴权：bearer。处理函数 `get_transaction`（backend/app/api/transactions.py:278-324）。按归属查询；不存在或属于别人 → 404 `"Transaction {transaction_id} not found"`（backend/app/api/transactions.py:289-298）。换算走路径 A（跨币种时两次上游调用，实测确认）（backend/app/api/transactions.py:301-305）。响应结构与 §4.12 完全一致（backend/app/api/transactions.py:307-322）。

```json
GET /api/v1/transactions/87ea7b2e-d78b-4fc8-9d33-6718f99c2557   （以另一个用户身份）
-> 404
{"detail": "Transaction 87ea7b2e-d78b-4fc8-9d33-6718f99c2557 not found"}
```

### 4.15 `PATCH /api/v1/transactions/{transaction_id}`

鉴权：bearer。处理函数 `update_transaction`（backend/app/api/transactions.py:327-413）。

请求体 `TransactionUpdate`（backend/app/schemas/transaction.py:57-86），全部可选：`amount`（Decimal，`decimal_places=4`）、`currency`（`CurrencyCode`）、`occurred_at`（date）、`description`（`max_length=500`）、`merchant`（`max_length=200`）、`tags`（list of str）。`source_id` 和 `transfer_pair_id` 不能改。

流程：

1. 按归属查询 → 404 `"Transaction {transaction_id} not found"`（backend/app/api/transactions.py:347-356）。
2. `update_data = model_dump(exclude_unset=True)`；把 `tags` 弹出来单独处理（backend/app/api/transactions.py:359-362）。
3. 对剩余每个键：`amount`、`currency`、`occurred_at` 三个非空列遇到 `None` 时跳过；`currency` 大写化；其他键即使为 `None` 也写入（所以 `"description": null` 会清空描述）（backend/app/api/transactions.py:365-371）。
4. 若请求里出现了 `tags`（包括 `[]`）：先批量 `DELETE FROM transaction_tags WHERE transaction_id = ?`，再逐个插入规范化后的标签（backend/app/api/transactions.py:374-384）。规范化后重复 → 未捕获的 `IntegrityError` → 500（实测）。
5. `commit`、`refresh`、路径 A 换算、构造响应（backend/app/api/transactions.py:386-413）。
6. 客户端：单笔更新成功后使 `transactions` 查询失效并返回（frontend/src/screens/TransactionFormScreen.tsx:118-124）。

```json
PATCH /api/v1/transactions/f59f243d-3246-49ab-adb5-60761e061571
{"amount": null, "description": null, "tags": []}
-> 200
{"id": "f59f243d-3246-49ab-adb5-60761e061571", "user_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876", "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9", "amount": "-45.5000", "currency": "EUR", "occurred_at": "2026-09-01", "description": null, "merchant": "Carrefour", "transfer_pair_id": null, "created_at": "2026-09-03T05:51:45.998347", "converted_amount": "-49.4567", "conversion_rate": "1.08696", "conversion_date": "2026-09-03", "tags": []}
```

（`amount` 未变，`description` 被清空，全部标签被删除。）小写的 `currency` 与创建时一样返回 422 `string_pattern_mismatch`。编辑转账时，前端先 PATCH 被编辑的那一腿（frontend/src/screens/TransactionFormScreen.tsx:249-255），再在缓存的列表里找 `transfer_pair_id` 相同的另一腿（frontend/src/screens/TransactionFormScreen.tsx:257-264），以相反符号的金额和相同的日期 / 描述 / 商户 / 标签 PATCH 它（frontend/src/screens/TransactionFormScreen.tsx:266-275）；API 对这种配对一无所知。

### 4.16 `DELETE /api/v1/transactions/{transaction_id}`

鉴权：bearer。处理函数 `delete_transaction`（backend/app/api/transactions.py:416-468）。没有 `response_model`；返回普通 dict。

流程：

1. 按归属查询 → 404 `"Transaction {transaction_id} not found"`（backend/app/api/transactions.py:435-444）。
2. 若 `transfer_pair_id` 非空：批量 `DELETE FROM transactions WHERE transfer_pair_id = ? AND user_id = ?`（删除数就是匹配到的行数——正常配对是 2，但凡是共享该 id 的行都会被删），commit，返回 `{"deleted_count": n, "message": "Transfer deleted successfully (n transactions)"}`（backend/app/api/transactions.py:447-459）。这是查询级删除：SQLAlchemy 不会执行 ORM 的 `tags` 级联；标签行只能靠数据库外键 `ON DELETE CASCADE`（backend/app/models/transaction_tag.py:13；迁移 backend/migrations/versions/e533c88884b7_initial_schema_users_accounts_.py:77）清理——PostgreSQL 会执行，SQLite 不开 `PRAGMA foreign_keys=ON` 就不会执行（`grep -rn PRAGMA backend/` 无命中）。实测 SQLite 下删除一对转账后，两条 `transfer` 标签行仍在。
3. 否则 `db.delete(transaction)`；ORM 级联 `all, delete-orphan`（backend/app/models/transaction.py:30）先加载并删除标签，再删主行；返回 `{"deleted_count": 1, "message": "Transaction deleted successfully"}`（backend/app/api/transactions.py:461-468）。
4. 客户端：TransactionsScreen 的删除 mutation 成功后使查询失效（frontend/src/screens/TransactionsScreen.tsx:29-31）；`deleteTransaction` 忽略响应体（frontend/src/api/transactions.ts:59-61）。

```json
DELETE /api/v1/transactions/<转账其中一腿的 id>
-> 200
{"deleted_count": 2, "message": "Transfer deleted successfully (2 transactions)"}

DELETE /api/v1/transactions/f59f243d-3246-49ab-adb5-60761e061571
-> 200
{"deleted_count": 1, "message": "Transaction deleted successfully"}

DELETE /api/v1/transactions/f59f243d-3246-49ab-adb5-60761e061571   （再删一次）
-> 404
{"detail": "Transaction f59f243d-3246-49ab-adb5-60761e061571 not found"}
```

交易的状态：

```
                    POST /transactions
  (不存在) --------------------------------------------> [存在]
                                                            |  PATCH（改字段，tags 整体替换）
                                                            |<---------------------------+
                                                            |                            |
                                                            +----------------------------+
                                                            |
        DELETE（transfer_pair_id 为 NULL）                  |      DELETE（transfer_pair_id 非空）
  [本行 + 其标签经 ORM 级联删除] <---------------------------+------------> [该用户所有带此 transfer_pair_id 的行被删；
                                                                           标签靠数据库级联]
```

---

## 5. 汇率服务（`backend/app/services/rates.py`）

### 5.1 上游端点与请求形状

| 函数 | 上游请求 | 超时 | 调用者 |
|---|---|---|---|
| `get_supported_currencies()`（backend/app/services/rates.py:18-53） | `GET {EXCHANGE_RATE_API_URL}/currencies` | 10.0 s | `GET /rates/currencies` |
| `fetch_latest_rates(base, symbols)`（backend/app/services/rates.py:56-99） | `GET {EXCHANGE_RATE_API_URL}/latest?from=<BASE>&to=<S1,S2,...>`（两者都 `.upper()`，backend/app/services/rates.py:80-84） | 10.0 s | `/rates/latest`、`/rates/convert`、`_build_conversion_fields`、`list_transactions`、`convert_amount` |
| `convert_amount(amount, from, to)`（backend/app/services/rates.py:102-139） | 经 `fetch_latest_rates(from, [to])` | — | `/rates/convert`、`_build_conversion_fields` |
| `get_multiple_rates(base, targets)`（backend/app/services/rates.py:142-157） | 经 `fetch_latest_rates` | — | 无人调用（`grep -rn get_multiple_rates backend/ --include=*.py` 只命中定义） |

请求用模块级 `httpx.get(...)`（没有共享 client、没有连接复用、没有自定义 `User-Agent`）。`EXCHANGE_RATE_API_URL` 默认 `https://api.frankfurter.app`；`infra/.env.example:28` 指向 `https://api.frankfurter.dev/v1`。

Frankfurter `/latest` 的响应形如 `{"amount":1.0,"base":"USD","date":"2026-09-02","rates":{"EUR":0.92,...}}`；代码只读 `rates`，每个浮点数经 `Decimal(str(rate))` 转成 Decimal（backend/app/services/rates.py:89-93）。上游的 `date` 被丢弃。

### 5.2 缓存

只缓存币种列表：进程级全局 `_SUPPORTED_CURRENCIES_CACHE`，首次成功后写入、永不失效（backend/app/services/rates.py:15, 37-38, 46）。汇率每次请求都现取，没有任何 memoization，所以一页交易列表花一次上游调用，单笔交易接口花两次。

### 5.3 错误映射与 retry 装饰器

两个 fetch 函数都用 `try/except httpx.HTTPError` 包住调用，抛 `HTTPException(503, "Failed to fetch exchange rates: <str(e)>")` 或 `"Failed to fetch supported currencies: <str(e)>"`（backend/app/services/rates.py:49-53, 95-99）。`httpx.HTTPError` 覆盖传输错误，也覆盖因为调了 `raise_for_status()` 而产生的 4xx / 5xx `HTTPStatusError`——所以未知币种（Frankfurter 返回 404）表现为 503 而不是 400。

两者都带装饰器 `@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10), retry=retry_if_exception_type(httpx.HTTPError), reraise=True)`（backend/app/services/rates.py:18-23, 56-61）。这个 retry 从不触发：`httpx.HTTPError` 在函数内部就被捕获并替换成 FastAPI 的 `HTTPException`，而它不匹配 `retry_if_exception_type(httpx.HTTPError)`。实测：让 `httpx.get` 抛 `ConnectError` 时，返回 503 之前只发生了一次上游调用。docstring 里"retries up to 3 times"（backend/app/services/rates.py:29, 66）描述的是意图，不是行为。

`convert_amount` 另外在上游 `rates` 里没有目标币种时抛 400 `"Exchange rate not available for {from_currency} to {to_currency}"`（backend/app/services/rates.py:129-133）。

### 5.4 换算算术——两条代码路径

记 `A` 为存储的金额（Decimal，4 位小数），`T` 为交易币种，`B` 为用户的 `base_currency`。Frankfurter 返回的 `r(X→Y)` 含义是"1 X = r Y"。`Decimal.quantize` 用默认上下文的舍入模式 `ROUND_HALF_EVEN`。

**路径 A——单笔交易接口**（`POST /transactions`、`GET /transactions/{id}`、`PATCH /transactions/{id}`），函数 `_build_conversion_fields`（backend/app/api/transactions.py:20-46）：

```
若 T == B（忽略大小写）:  返回 (None, None, None)                        # transactions.py:35-36
第 1 次调用: r1 = fetch_latest_rates(T, [B])[B]                         # convert_amount 内部，rates.py:127-135
             converted_amount = (A * r1).quantize(Decimal("0.0001"))    # rates.py:136-139
第 2 次调用: r2 = fetch_latest_rates(T, [B]).get(B)                     # transactions.py:41-42（与第 1 次完全相同的请求）
             conversion_rate = r2                                       # 不 quantize；就是 Decimal(str(上游浮点数))
conversion_date = date.today()                                          # 服务器本地日期，transactions.py:43
任何 HTTPException -> (None, None, None)                                # transactions.py:44-46
```

例（A = -45.5 EUR，B = USD，上游 EUR→USD = 1.08696）：`-45.5 × 1.08696 = -49.45668` → `converted_amount = "-49.4567"`；`conversion_rate = "1.08696"`。

**路径 B——列表接口**（`GET /transactions`）（backend/app/api/transactions.py:217-255）：

```
U = {T | 本页每行, T != B}
若 U 非空: rates = fetch_latest_rates(B, list(U))         # 一次调用，方向是 base -> 各交易币种
           捕到 HTTPException: rates = None（本页全部 null）
对每行（T != B 且 rates 不为 None）:
      r = rates.get(T)                                    # 1 B = r T
      若 r 不为 None:
          converted_amount = (A / r).quantize(Decimal("0.0001"))       # transactions.py:252
          conversion_rate  = (Decimal("1") / r).quantize(Decimal("0.000001"))  # transactions.py:254
          conversion_date  = date.today()                                # transactions.py:255
```

例（同一行，上游 USD→EUR = 0.92）：`-45.5 / 0.92 = -49.456521...` → `"-49.4565"`；`1 / 0.92 = 1.0869565...` → `"1.086957"`。

两条路径的差异：(1) 上游报价方向不同（T→B 与 B→T）——Frankfurter 对每个报价独立舍入，所以 `A×r1` 与 `A/r` 在末位不同；(2) `conversion_rate` 在 A 里是上游原始精度，在 B 里 quantize 到 6 位；(3) A 每笔两次上游调用，B 每页一次；(4) A 里币种缺失时 `convert_amount` 抛的 400 也是 `HTTPException`，同样被吞成 null。两条路径的 `conversion_date` 都是服务器本地 `date.today()`，而 `created_at` 是 `utcnow()`，两者可能落在不同日期。

---

## 6. 交易响应的组装方式

`TransactionResponse`（backend/app/schemas/transaction.py:89-124）虽然设了 `Config.from_attributes = True`（backend/app/schemas/transaction.py:123-124），但从来没有用 `from_attributes` 从 ORM 行直接生成过；四个处理函数都用关键字参数显式构造它：复制十个列值、`tags=[tag.tag for tag in tx.tags]`、三个换算字段（backend/app/api/transactions.py:124-139, 257-272, 307-322, 396-411）。FastAPI 随后按 `response_model` 重新校验该模型实例并以 JSON 模式序列化（Decimal 变字符串）。

标签加载：`Transaction.tags` 是普通 `relationship(...)`，取 SQLAlchemy 默认的 `lazy="select"`（`grep -rn "lazy=" backend/app` 无命中）。列表推导式里访问 `tx.tags` 会对每笔交易发一条 `SELECT ... FROM transaction_tags WHERE transaction_id = ?`，没有 `ORDER BY`（标签顺序由数据库决定）。在 `list_transactions` 里这是 N+1：鉴权查询之后是 `1 + 行数` 条 SELECT（实测 3 行 5 条；满页 100 行时 102 条）。没有用 `selectinload` / `joinedload`。

响应的可空性约定：`description`、`merchant`、`transfer_pair_id`、`converted_amount`、`conversion_rate`、`conversion_date` 可为 null；`tags` 永远是数组（可能为空）；`source_id` 永远有值（列是 `NOT NULL`，backend/app/models/transaction.py:18）。

---

## 7. 校验层

pydantic v2 模型都在 `backend/app/schemas/`；三个响应模型用基于类的 `Config` 设 `from_attributes = True`（backend/app/schemas/user.py:29-30；backend/app/schemas/finance_source.py:62-63；backend/app/schemas/transaction.py:123-124）。`Field(example=...)` 这种写法（backend/app/schemas/transaction.py:26, 31, 37, 43, 48）在导入时触发 `PydanticDeprecatedSince20` 警告（实测导入 `app.schemas.transaction` 出现 5 条："Using extra keyword arguments on `Field` is deprecated ... (Extra keys: 'example')"；backend/app/schemas/finance_source.py 的 9 处 `example=` 同理）。

| 规则 | 定义 | 效果 |
|---|---|---|
| `CurrencyCode = Annotated[str, Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]` | backend/app/schemas/currency.py:9 | 用于 `FinanceSourceCreate.default_currency`、`FinanceSourceResponse.default_currency`、`TransactionCreate.currency`、`TransactionUpdate.currency`、`TransactionResponse.currency`。小写输入 → 422 `string_pattern_mismatch`。**没有**用于 `UserCreate.base_currency`、`UserUpdate.base_currency`、`ConversionRequest` 的两个币种字段、`/rates/latest` 的 `base` 参数——这些只要求 3 个字符，依赖处理函数或服务层的 `.upper()` |
| 资金账户 `type` | backend/app/schemas/finance_source.py:21-26 | 正则四选一（原文见下方代码块）；不匹配 → 422 `string_pattern_mismatch` |
| 金额小数位 | `Field(decimal_places=4)`，`TransactionCreate.amount` 与 `TransactionUpdate.amount`（backend/app/schemas/transaction.py:19-23, 60-64） | 422 `decimal_max_places`；没有 `max_digits`，`Numeric(18,4)` 的总位数上限（backend/app/models/transaction.py:19）只由数据库把关；数字和数字字符串都接受；允许 0 和负数 |
| `ConversionRequest.amount` | `gt=0`（backend/app/schemas/currency.py:38） | 422 `greater_than` |
| 口令 | 仅注册时 `min_length=8`（backend/app/schemas/user.py:11） | 登录无约束 |
| 邮箱 | 注册与登录都用 `EmailStr`（backend/app/schemas/user.py:10, 16） | 422 `value_error`，msg 带 email-validator 的原因文本 |
| 长度 | `name` 1 到 100；`description` 最多 500；`merchant` 最多 200 | 422 `string_too_short` / `string_too_long` |
| 路径 / query 类型 | 路径参数 `UUID`；query 参数 `bool` / `int` | 422 `uuid_parsing`、`bool_parsing`、`int_parsing` |
| 日期 | `from_date` / `to_date` 是普通 `str`，手工解析（backend/app/api/transactions.py:188-208） | 400 且是自定义 detail，不是 422 |

资金账户 `type` 的正则原文（backend/app/schemas/finance_source.py:23）：

```
^(checking|savings|credit|other)$
```

标签规范化在处理函数里做而不在 schema 里：创建和更新时 `tag.strip().lower()`（backend/app/api/transactions.py:110, 382）；列表的 `tag` 过滤只 `.lower()`（backend/app/api/transactions.py:212）。空字符串会作为 `""` 标签存入。币种码在 `register`、`update_current_user`、`create_finance_source`、`create_transaction`、`update_transaction` 以及 `fetch_latest_rates` 内部都会被大写化。

部分更新统一用 `model_dump(exclude_unset=True)`（backend/app/api/auth.py:122；backend/app/api/finance_sources.py:127；backend/app/api/transactions.py:359），所以省略的键不动，而显式的 `null` 会被应用——除非处理函数专门跳过（§4.15 第 3 步）。

---

## 8. 并发模型

- 所有路由处理函数都是同步 `def`（backend/app/api/*.py 里全部 `@router.*` 函数，以及 backend/app/main.py:34, 44）。锁定的 Starlette 0.36.3 在 `request_response` 里对非 async 端点走 `run_in_threadpool`（starlette 0.36.3 `starlette/routing.py` 第 73-76 行：`if is_async_callable(func): ... else: response = await run_in_threadpool(func, request)`），即 `anyio.to_thread.run_sync`；anyio 4.11.0 的默认 `CapacityLimiter` 是 40 个令牌（anyio 4.11.0 `src/anyio/_backends/_asyncio.py` 第 2928 行 `CapacityLimiter(40)`）。依赖项 `get_db`、`get_current_user` 也是同步生成器 / 函数，跑在同一个线程池里。
- 一个 uvicorn 进程、一个事件循环、没有 `--workers`（infra/Dockerfile.api:78）。有效上限：每个容器同时执行 40 个请求；更多请求在 limiter 上排队。
- SQLAlchemy 连接池每进程允许 5 + 10 溢出 = 15 个 PostgreSQL 连接（backend/app/core/database.py:26-27），`QueuePool` 默认 `timeout=30` 秒；超过 15 个同时持有连接的请求要等待，等超过 30 秒的请求得到未处理的 `TimeoutError`（500）。数据库侧的 `max_connections=50`（infra/docker-compose.prod.yml:21-22）不是瓶颈。
- Frankfurter 调用是阻塞的 `httpx.get`，超时 10 秒，在工作线程上执行，此时该请求的数据库会话仍然打开（`get_db` 在处理函数之前创建会话、之后关闭，backend/app/core/database.py:53-57），所以上游变慢时一个池化连接最多被占用 10 秒（路径 A 两次调用则 20 秒）。
- 会话：`sessionmaker(autocommit=False, autoflush=False)`（backend/app/core/database.py:36-40）；处理函数在需要 id 的地方显式 `flush()`。`expire_on_commit` 取默认 `True`，因此每次 commit 之后都有 `db.refresh(...)`。
- `_SUPPORTED_CURRENCIES_CACHE` 是裸模块全局变量，工作线程写它时没有锁；竞态只会造成重复的上游调用。
- SQLite 模式（`DATABASE_URL=sqlite:...`）只设 `check_same_thread=False`，不调池参数（backend/app/core/database.py:28-30）；外键不被强制（§4.16）。

---

## 9. 测试

位置 `backend/tests/`；pytest 配置在 backend/pyproject.toml:47-52（`testpaths=["tests"]`、`python_files=["test_*.py"]`、`asyncio_mode="auto"`）。运行方式：`cd backend && poetry run pytest`（backend/README.md:127, 152）。README 还给出 `poetry run pytest --cov=app --cov-report=html`（backend/README.md:155，但 `pytest-cov` 不在 lock 里）和 `poetry run pytest tests/test_auth.py -v`（backend/README.md:158，该文件不存在）。六个文件共收集 36 个测试。

### 9.1 fixture（`backend/tests/conftest.py`）

- 在导入应用之前用 `os.environ.setdefault` 设 `DATABASE_URL=sqlite:///:memory:` 和 `SECRET_KEY=test-secret-key-for-tests-only`（backend/tests/conftest.py:10-11）；其他设置都没固定，所以 `backend/.env`（pytest 从 `backend/` 运行，因此会被读到）仍然提供 `DEBUG`、`ENVIRONMENT` 等值。
- 若 `psycopg2` 导入失败，用 `MagicMock` 模块顶替，让没有 PostgreSQL 驱动的环境也能导入 `app`（backend/tests/conftest.py:23-38）。
- 单独的内存 SQLite engine `_test_engine`（backend/tests/conftest.py:45-55）；session 级 autouse fixture `create_tables` 导入四个模型并执行 `Base.metadata.create_all` / `drop_all`（backend/tests/conftest.py:58-69）。应用自己的 engine（同样是 `sqlite:///:memory:`）在导入时创建，但测试从不使用它。
- `db_session`：打开连接、开启外层事务、yield 绑定到该连接的会话，teardown 时回滚，让每个测试从干净状态开始（backend/tests/conftest.py:72-83）。
- `client`：用一个 yield `db_session` 的生成器覆盖 `get_db`，在上下文管理器里包 `TestClient(app)`，结束后清空 overrides（backend/tests/conftest.py:86-104）。没有任何东西替换 Frankfurter；走 HTTP 的测试从不创建交易，所以不会发生网络调用。

### 9.2 文件

| 文件 | 测试数 | 类型 | 锁定的内容 |
|---|---|---|---|
| `test_auto_default_source.py` | 2 | 源码文本断言 | `finance_sources.py` 源码含 `default_source_id`、`.count()`、`== 1`，且赋值语句出现在 `db.refresh(new_source)` 之后（backend/tests/test_auto_default_source.py:11-32） |
| `test_config.py` | 4 | `Settings()` 单元测试 | `DEBUG` 默认 `False`；echo 开关 `ENVIRONMENT == "development" and DEBUG` 默认为关、开发环境下 `DEBUG=true` 时为开、生产环境下为关（backend/tests/test_config.py:6-40）。前两个测试读的是真实环境：本机 `backend/.env` 含 `DEBUG=True`（与 backend/env.example:12 一致）时它们失败（实测 2 failed / 34 passed）；导出 `DEBUG=False` 后 36 passed |
| `test_conversion.py` | 13 | 单元测试，`unittest.mock.patch("app.api.transactions.rates_service")` | `_build_conversion_fields`：同币种（任意大小写）返回 `(None, None, None)`（backend/tests/test_conversion.py:13-34）；跨币种返回 `convert_amount` 的结果、`fetch_latest_rates(FROM,[TO])[TO]` 的汇率和 `date.today()`，参数顺序为 `convert_amount(amount, FROM, TO)` 与 `fetch_latest_rates(FROM, [TO])`（backend/tests/test_conversion.py:37-123）；任一调用抛 `HTTPException` 都得到 null 三元组且不重新抛出（backend/tests/test_conversion.py:126-170） |
| `test_profile_structure.py` | 8 | schema 内省 + 源码文本 | `UserUpdate` 存在且 `base_currency`（长度 3）与 `default_source_id` 可选；`UserResponse` 暴露 `default_source_id`；`auth.py` 注册了 `@router.patch("/me"`、对 `base_currency` 调 `.upper()`、导入 `FinanceSource` 并按 `current_user.id` 过滤、使用 `model_dump(exclude_unset=True)`（backend/tests/test_profile_structure.py:20-77） |
| `test_session_persistence.py` | 3 | 经 `TestClient` 的端到端 | 注册 → GET /auth/me → PATCH base_currency → 再 GET 两次，全部 200 且币种已更新（backend/tests/test_session_persistence.py:17-68）；部分 PATCH 保留 `email`（backend/tests/test_session_persistence.py:71-100）；连续四轮 PATCH/GET 令牌始终有效（backend/tests/test_session_persistence.py:103-128）。注册的状态码接受 200 或 201（backend/tests/test_session_persistence.py:30, 79, 111） |
| `test_transactions_structure.py` | 6 | AST / 源码文本 | 恰有一个 `delete_transaction` 且带 `@router.delete`；恰有一个 `_build_conversion_fields` 定义且名字出现至少 4 次；源码含 `batch_rates`；不含 `TODO: Add conversion logic`（backend/tests/test_transactions_structure.py:8-81）。该模块只导入 `ast` 和 `Path`、没有 `import pytest`，所以 backend/tests/test_transactions_structure.py:78, 81 的 `pytest.fail(...)` 分支若被执行到会抛 `NameError` 而不是 pytest 失败 |

由上可见的覆盖范围：没有测试通过 HTTP 触碰资金账户或交易接口、汇率服务、`get_current_user` 的错误分支、Frankfurter 失败处理；`test_transactions_structure.py`、`test_profile_structure.py`、`test_auto_default_source.py` 断言的是源码文本而不是行为。前端 Jest 套件在 `frontend/__tests__/`，不在本文范围内。

---

## 另见

- [./README.md](./README.md) — 总览与文件索引
- [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域概念与端到端流程
- [./02-database.md](./02-database.md) — 表结构、迁移链、约束
- [./04-frontend.md](./04-frontend.md) — 前端如何调用这些接口、缓存与状态
- [./05-infra-and-ops.md](./05-infra-and-ops.md) — 容器、Caddy、compose、运维脚本
