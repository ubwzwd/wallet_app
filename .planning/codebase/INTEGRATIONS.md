# External Integrations

**Analysis Date:** 2026-04-05

## APIs & External Services

**Currency Exchange Rates:**
- Frankfurter API (https://api.frankfurter.app) - ECB (European Central Bank) exchange rate data
  - SDK/Client: `httpx` (sync GET requests)
  - Auth: No API key required (free, no auth)
  - Implementation: `backend/app/services/rates.py`
  - Endpoints used: `/currencies` (list supported currencies), `/latest` (fetch current rates)
  - Retry strategy: `tenacity` with up to 3 attempts, exponential backoff (1s, 2s, 4s)
  - Cache: In-memory module-level cache for currency list (`_SUPPORTED_CURRENCIES_CACHE`)
  - Config key: `EXCHANGE_RATE_API_URL` (default: `https://api.frankfurter.app`)

## Data Storage

**Databases:**
- PostgreSQL 15 (primary datastore)
  - Connection: `DATABASE_URL` env var (format: `postgresql://user:pass@host:port/db`)
  - Client: SQLAlchemy 2.0 synchronous engine via `psycopg2-binary`
  - Engine config: `backend/app/core/database.py` (pool_size=5, max_overflow=10, pool_pre_ping=True)
  - ORM: SQLAlchemy declarative base; models in `backend/app/models/`
  - Migrations: Alembic; config at `backend/alembic.ini`; versions in `backend/migrations/versions/`
  - Dev setup: Docker Compose at `backend/docker-compose.yml` (container name: `wallet_db`, port 5432)

**File Storage:**
- Not used; no object storage integration detected

**Caching:**
- In-memory only; module-level dict in `backend/app/services/rates.py` for currency list
- No Redis or external cache layer

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication (no third-party auth provider)
  - Implementation: `backend/app/core/security.py`
  - Token type: Bearer JWT (HS256 algorithm)
  - Token issuance: `/api/v1/auth/register` and `/api/v1/auth/login` endpoints (`backend/app/api/auth.py`)
  - Token validation: FastAPI `HTTPBearer` dependency via `get_current_user()` in `backend/app/core/security.py`
  - Password hashing: bcrypt via `passlib[bcrypt]` and `bcrypt` packages
  - Config keys: `SECRET_KEY`, `ALGORITHM` (HS256), `ACCESS_TOKEN_EXPIRE_MINUTES` (30 default)

**Frontend Auth Storage:**
- JWT token persisted in `AsyncStorage` via `@react-native-async-storage/async-storage`
  - Token key: `@wallet_app:auth_token`
  - User data key: `@wallet_app:user_data`
  - Managed in: `frontend/src/store/AuthContext.tsx` and `frontend/src/api/client.ts`
  - Axios interceptor auto-attaches token to all requests; clears on 401 response

## Monitoring & Observability

**Error Tracking:**
- Not detected; no Sentry, Datadog, or similar SDK present

**Logs:**
- Backend: SQLAlchemy query logging enabled when `DEBUG=True` (via `echo=settings.DEBUG` in `backend/app/core/database.py`)
- Backend: Python `print`/standard logging (no structured logging library configured)
- Frontend: `console.error()` used in catch blocks throughout `frontend/src/store/AuthContext.tsx` and `frontend/src/api/client.ts`

**Health Check:**
- Backend exposes `GET /health` returning status, environment, and version (`backend/app/main.py`)
- Docker `HEALTHCHECK` in `backend/Dockerfile` pings `/health` every 30s

## CI/CD & Deployment

**Hosting:**
- Backend: Docker container (multi-stage `backend/Dockerfile`); runs Uvicorn on port 8000
- Frontend: Expo build system targeting iOS, Android, and Web; production URL placeholder `https://api.yourapp.com/api/v1` in `frontend/src/constants/config.ts`

**CI Pipeline:**
- Not detected; no GitHub Actions, CircleCI, or similar config files present

## Environment Configuration

**Required backend env vars** (see `backend/env.example`):
- `DATABASE_URL` - PostgreSQL connection string
- `SECRET_KEY` - JWT signing secret (must be changed in production)
- `ALGORITHM` - JWT algorithm (default: HS256)
- `ACCESS_TOKEN_EXPIRE_MINUTES` - Token TTL in minutes (default: 30)
- `API_V1_PREFIX` - API prefix (default: `/api/v1`)
- `ALLOWED_ORIGINS` - Comma-separated CORS origins
- `EXCHANGE_RATE_API_URL` - Frankfurter base URL
- `ENVIRONMENT` - Runtime environment name

**Secrets location:**
- `.env` file at `backend/.env` (not committed; listed in root `.gitignore`)
- `.env.example` committed at `backend/env.example` as reference template

## Webhooks & Callbacks

**Incoming:**
- Not detected; no webhook receiver endpoints present

**Outgoing:**
- Not detected; no outgoing webhook calls; only outbound integration is the Frankfurter rate API

---

*Integration audit: 2026-04-05*
