# External Integrations

**Analysis Date:** 2026-05-24

## APIs & External Services

**Frankfurter ECB Exchange Rates API:**
- Service: https://api.frankfurter.dev/v1 (European Central Bank rates)
- What it's used for: Real-time currency exchange rates for multi-currency transaction conversions
- SDK/Client: `httpx` async HTTP client
- Auth: None (public API, no key required)
- Implementation: `backend/app/services/rates.py`
  - Endpoints: `/currencies` (supported currency list), `/latest` (current rates)
  - Retry strategy: tenacity library, 3 attempts with exponential backoff (1-10s)
  - Rate conversion: `convert_amount()` function with Decimal precision
  - Caching: In-memory module-level cache for currencies (`_SUPPORTED_CURRENCIES_CACHE`)

## Data Storage

**Databases:**
- **PostgreSQL 15-alpine** (production)
  - Connection: `DATABASE_URL` env var, host=`db` (compose service name)
  - Client: SQLAlchemy 2.0 ORM
  - Connection pooling: pool_size=5, max_overflow=10, pool_pre_ping=True, pool_recycle=3600s
  - Schema management: Alembic migrations (`backend/alembic.ini`, `backend/migrations/versions/`)
  - Tables: User, Account, FinanceSource, Transaction, TransactionTag (defined in `backend/app/models/`)

- **SQLite** (development fallback)
  - Connection: `sqlite:///wallet_dev.db`
  - Client: SQLAlchemy 2.0 ORM (with check_same_thread=False)
  - No connection pooling (SQLite limitation)

**File Storage:**
- Local filesystem only - No cloud storage integration
- Frontend build output: `frontend/dist/` (served via Caddy)
- Backend code: containerized (no external artifact storage)

**Caching:**
- In-memory: Module-level Python variables (e.g., `_SUPPORTED_CURRENCIES_CACHE` in `backend/app/services/rates.py`)
- Client-side: AsyncStorage for auth token and user data (`@react-native-async-storage/async-storage`)
- TanStack Query: Server-side cache invalidation and background sync (`frontend/src/utils/queryClient.ts`)

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication
  - Implementation: `backend/app/core/security.py`
  - Algorithm: HS256 (symmetric)
  - Token claims: `sub` (user ID), `exp` (expiration), `iat` (issued-at)
  - Expiration: configurable via `ACCESS_TOKEN_EXPIRE_MINUTES` env var (default 30 min)
  - Secret: `SECRET_KEY` env var (must be unique per environment)

**Password Management:**
- Bcrypt hashing (`passlib` + `bcrypt` libraries)
- Verification in `backend/app/core/security.py::verify_password()`
- Hash function: `backend/app/core/security.py::get_password_hash()`

**Frontend Auth Flow:**
- Token storage: AsyncStorage under key `@wallet_app:auth_token`
- Token injection: Axios request interceptor in `frontend/src/api/client.ts`
- Token refresh: Not implemented; relies on 30-min TTL
- 401 handling: Clears token except on GET `/auth/me` (transient failures excepted)

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry, Datadog, or equivalent integration

**Logs:**
- FastAPI/Uvicorn: stdout to console (production-grade, captured by Docker)
- Backend diagnostics: Custom `DIAG_*` logging in `backend/app/core/security.py`
  - Examples: `DIAG_CREDENTIALS_EXCEPTION`, `DIAG_TOKEN_DECODE`, `DIAG_USER_LOOKUP`, `DIAG_DB_ERROR`
- Frontend: console.error/warn (standard React Native/browser console)

**Health Checks:**
- Backend: `GET /health` endpoint in `backend/app/main.py` (JSON status response)
- Docker Compose: Healthchecks on db, api, caddy services
  - Postgres: `pg_isready` CLI check every 10s
  - API: Python urllib check every 15s (no external requests package)
  - Caddy: Implicit (depends on api healthcheck)

## CI/CD & Deployment

**Hosting:**
- Docker Compose on local development machine
- Docker containers (multi-stage for backend) targeted for Oracle A1.Flex (ARM64)
- Production deployment: TBD (Phase 6 plan for real domain + ACME)

**CI Pipeline:**
- None currently implemented
- Smoke test suite: `infra/scripts/smoke.sh` (validates Phase 4 deliverables)
  - Checks: Dockerfile builds, image architecture (arm64), non-root user (uid 1000)
  - Checks: Compose stack health, Postgres tuning, Caddy reverse proxy
  - Checks: Frontend build artifact, no hardcoded localhost:8000 in dist/
  - Checks: Migration exit code, schema migrations execute successfully

**Build Process:**
- Backend: Multi-stage Docker build (`infra/Dockerfile.api`)
  - Builder: Poetry export + uv pip install (no Poetry in runtime image)
  - Runtime: python:3.11-slim + resolved deps, non-root appuser
  - Image naming: `wallet-app/api:local`
- Frontend: `npm run build:web` (expo export -p web)
  - Config swap: dev → prod (localhost:8000 → /api/v1)
  - Output: `frontend/dist/` served by Caddy at `/`

## Environment Configuration

**Required env vars:**
- `POSTGRES_USER` - Database user name (no default, CHANGE_ME sentinel)
- `POSTGRES_PASSWORD` - Database password (no default, CHANGE_ME sentinel)
- `POSTGRES_DB` - Database name (no default, CHANGE_ME sentinel)
- `DATABASE_URL` - SQLAlchemy connection string (composed from above + host=db:5432)
- `SECRET_KEY` - JWT signing key (no default, CHANGE_ME sentinel, ~256 bits recommended)
- `ALGORITHM` - JWT algorithm (default HS256, env-configurable)
- `ACCESS_TOKEN_EXPIRE_MINUTES` - Token TTL (default 30 min)
- `ALLOWED_ORIGINS` - CORS allowlist (comma-separated, e.g., https://localhost)
- `EXCHANGE_RATE_API_URL` - Frankfurter base URL (default https://api.frankfurter.dev/v1)
- `ENVIRONMENT` - deployment mode (development|production, affects logging)
- `DEBUG` - Enable FastAPI debug mode (False in production)
- `CADDY_DOMAIN` - TLS domain/wildcard (localhost for dev, real domain for Phase 6)
- `CADDY_TLS_MODE` - TLS source (internal for self-signed, acme for Let's Encrypt)

**Secrets location:**
- Development: `.env` file (git-ignored, never committed)
- Production: `infra/.env` (git-ignored per `smoke.sh` verification)
- Template: `infra/.env.example` (committed, all keys present with CHANGE_ME_ placeholders)
- Validation: `infra/scripts/env-coverage.sh` ensures .env.example covers all Settings fields

## Webhooks & Callbacks

**Incoming:**
- None - API is REST-based, no webhook receivers

**Outgoing:**
- None - No external integrations that require outbound webhooks
- Frankfurter API: Request-response only (no callbacks)

## Infrastructure Stack

**Reverse Proxy & TLS:**
- Caddy alpine - Configurable reverse proxy and TLS terminator (`infra/docker-compose.prod.yml`)
  - Config: `infra/Caddyfile` (environment-templated domain, TLS mode)
  - Routes: `/api/*` → api:8000 (FastAPI), `/` → /srv (frontend SPA)
  - TLS: `{$CADDY_TLS_MODE:internal}` (self-signed for Phase 4 dev, ACME for Phase 6 prod)
  - Encoding: zstd + gzip compression

**Database Tuning (Production):**
- Shared buffers: 3GB (OPS-04 requirement, set via postgres command flags)
- Effective cache size: 8GB (query planner hint)
- Max connections: 50 (connection pool ceiling)
- Shared memory: 1GB minimum (`shm_size: 1g`)

**Service Orchestration:**
- Docker Compose v3 format
- Dev stack (`infra/docker-compose.dev.yml`): db only
- Prod stack (`infra/docker-compose.prod.yml`): db + migrate + api + caddy
- Volumes: Postgres data persistence, Caddy TLS cert/config persistence
- Healthchecks: Ensure startup order and liveness

---

*Integration audit: 2026-05-24*
