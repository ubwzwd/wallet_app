<!-- refreshed: 2026-05-24 -->
# Architecture

**Analysis Date:** 2026-05-24

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    Client Layer: Expo React Native App                   │
│                              `frontend/App.tsx`                          │
│  Screens │ Components │ Store (AuthContext) │ API Client (Axios)        │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │
                           │ HTTPS / HTTP (dev)
                           │ POST/PATCH /api/v1/auth, GET /api/v1/auth/me
                           │ GET /api/v1/transactions, POST /api/v1/transactions
                           │ GET /api/v1/finance-sources, etc.
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Gateway: Caddy Reverse Proxy                          │
│                      `infra/Caddyfile` (port 80/443)                    │
│  ✓ Serves Expo web export at `/` from `frontend/dist`                   │
│  ✓ Reverse-proxies `/api/*`, `/health`, `/docs` → FastAPI (api:8000)   │
│  ✓ Same-origin routing (no separate web container needed, Phase 4)      │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           │ HTTP internal network
                           │ Caddy → api:8000
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   API Server: FastAPI Application                        │
│                      `backend/app/main.py` (port 8000)                   │
│  Routes (v1):                                                            │
│  • /auth - register, login, me (get/patch)                              │
│  • /finance-sources - CRUD operations                                    │
│  • /transactions - CRUD operations with currency conversion             │
│  • /rates - exchange rate queries                                        │
│  • /health - healthcheck                                                │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           │ SQLAlchemy ORM
                           │ Psycopg2 driver (PostgreSQL)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Data Layer: PostgreSQL Database                        │
│  Container: `wallet_db_prod` / `wallet_db` (port 5432, internal)        │
│  Schema (Alembic migrations in `backend/migrations/versions/`)          │
│  Tables: users, finance_sources, transactions, transaction_tags        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **App Root** | Initialize providers (QueryClient, AuthContext) | `frontend/App.tsx` |
| **Navigation** | Route between Auth screens and Home, condition on isAuthenticated | `frontend/src/components/Navigation.tsx` |
| **Auth Context** | Global auth state, token management, user persistence | `frontend/src/store/AuthContext.tsx` |
| **API Client** | Axios instance with JWT interceptors, error handling, token refresh logic | `frontend/src/api/client.ts` |
| **Screens** | UI views: Login, Register, Home, Transactions, FinanceSources, Profile | `frontend/src/screens/` |
| **FastAPI App** | HTTP listener, router aggregation, CORS, middleware setup | `backend/app/main.py` |
| **Routes** | Endpoint handlers for auth, transactions, sources, rates | `backend/app/api/{auth,transactions,finance_sources,rates}.py` |
| **Models** | SQLAlchemy ORM entities: User, FinanceSource, Transaction, TransactionTag | `backend/app/models/{user,finance_source,transaction,transaction_tag}.py` |
| **Services** | Business logic: rate fetching from Frankfurter API | `backend/app/services/rates.py` |
| **Security** | JWT creation/validation, password hashing (bcrypt), get_current_user dependency | `backend/app/core/security.py` |
| **Database** | Engine, session factory, dependency injection | `backend/app/core/database.py` |
| **Config** | Environment variables, CORS origins, API URLs | `backend/app/core/config.py` |
| **Migrations** | Alembic migration system, version control for schema changes | `backend/migrations/{env.py,versions/}` |
| **Caddy Gateway** | Routing config, TLS termination, static file serving | `infra/Caddyfile` |
| **Docker Compose** | Service orchestration (db, api, caddy, migrate) | `infra/docker-compose.prod.yml` |

## Pattern Overview

**Overall:** Monorepo with layered architecture across three domains:
1. **Backend (Python/FastAPI):** RESTful API with database
2. **Frontend (Expo React Native):** Mobile/web UI with client-side state
3. **Infrastructure (Docker/Caddy):** Containerization and gateway

**Key Characteristics:**
- **API-first:** Backend exposes `/api/v1/*` endpoints; frontend communicates via HTTP/HTTPS
- **Token-based auth:** JWT tokens issued at registration/login; stored in AsyncStorage
- **Same-origin gateway:** Caddy serves both static web export and proxies API calls
- **Request/response with interceptors:** Axios automatically attaches JWT; handles 401 gracefully
- **Async task patterns:** React Query for data fetching, mutations; FastAPI async endpoints
- **Database-centric:** All user data flows through PostgreSQL via SQLAlchemy ORM

## Layers

**Frontend (Client):**
- Purpose: Present UI, collect user input, manage local auth state
- Location: `frontend/src/`
- Contains: React Native components, screens, API client, store (AuthContext), types
- Depends on: Expo, React Query, Axios, AsyncStorage
- Used by: End users (mobile app via Expo, web via browser)

**Gateway (Caddy):**
- Purpose: Route HTTP traffic, terminate TLS, serve static assets, reverse-proxy to API
- Location: `infra/Caddyfile`, `infra/docker-compose.prod.yml`
- Contains: Server block for `:80`/`:443`, handlers for `/` (static files), `/api/*` and `/health/*` (reverse proxy)
- Depends on: Caddy image, Expo web export in `frontend/dist/`
- Used by: Clients (browsers, mobile apps)

**Backend API (FastAPI):**
- Purpose: Process business logic, validate data, manage database queries
- Location: `backend/app/`
- Contains: Route handlers, models, schemas, services, security
- Depends on: FastAPI, SQLAlchemy, PostgreSQL driver, Frankfurter API
- Used by: Frontend via HTTP, Caddy via reverse proxy

**Database (PostgreSQL):**
- Purpose: Persist user accounts, finance sources, transactions, transaction tags
- Location: Docker container `wallet_db_prod`, data volume `wallet_pgdata_prod`
- Contains: SQL tables with foreign key relationships, indexes
- Depends on: None (leaf layer)
- Used by: FastAPI via SQLAlchemy ORM

## Data Flow

### Primary Request Path: Fetch Transactions

1. **UI initiates query** (`frontend/src/screens/TransactionsScreen.tsx`, line ~20)
   - `useQuery([QUERY_KEYS.TRANSACTIONS], () => transactionsApi.getTransactions({ limit }))`
   - React Query triggers the API call

2. **API client prepares request** (`frontend/src/api/client.ts`, line ~19-34)
   - Request interceptor reads JWT token from `AsyncStorage`
   - Adds `Authorization: Bearer {token}` header
   - Axios POSTs to `http://localhost:8000/api/v1/transactions` (dev) or through Caddy (prod)

3. **Gateway routes request** (`infra/Caddyfile`, line ~6-8)
   - Caddy receives request on port 80/443
   - Matches `handle /api/*` block
   - Reverse-proxies to `api:8000` (internal Docker network)

4. **FastAPI receives request** (`backend/app/main.py`, line ~29)
   - Router includes `transactions.router` at `/api/v1`
   - Request dispatches to `backend/app/api/transactions.py`

5. **Route handler validates auth** (`backend/app/api/transactions.py`, line ~GET handler)
   - `get_current_user` dependency runs (from `backend/app/core/security.py`, line ~83-144)
   - JWT token decoded, `sub` claim extracted, User object fetched from DB

6. **Route handler queries database** (`backend/app/api/transactions.py`, line ~GET handler)
   - SQLAlchemy filters: `Transaction.owner_id == current_user.id`
   - Loads related FinanceSource and TransactionTag via ORM relationships
   - Converts DecimalField amounts to JSON serializable strings

7. **Response returns to client** (`frontend/src/api/client.ts`, line ~39-79)
   - Response interceptor checks status (200 OK expected)
   - React Query caches result in `queryClient`
   - Component re-renders with transaction list

### Secondary Flow: Create Transaction with Currency Conversion

1. **User submits form** (`frontend/src/screens/TransactionFormScreen.tsx`)
   - Collects: amount (Decimal), currency (string), source_id, tags
   - POST to `/api/v1/transactions`

2. **Frontend interceptor adds JWT** (`frontend/src/api/client.ts`, line ~19-34)

3. **Caddy routes to FastAPI** (`infra/Caddyfile`, line ~6-8)

4. **FastAPI validates schema and auth** (`backend/app/api/transactions.py`, POST handler)
   - Pydantic validates `TransactionCreate` schema
   - `get_current_user` returns authenticated User

5. **Service computes conversion** (`backend/app/api/transactions.py`, line ~_build_conversion_fields)
   - If `tx_currency != user.base_currency`:
     - Call `rates.service.fetch_rate(tx_currency, user.base_currency)`
     - Frankfurter API returns rate; compute `converted_amount = amount * rate`
   - If same currency or API unreachable: `converted_amount = None`

6. **ORM persists transaction** (`backend/app/api/transactions.py`, POST handler)
   - `db.add(transaction_object)` and `db.commit()`
   - Returns `TransactionResponse` schema (includes conversion_rate, conversion_date)

7. **Response interceptor handles result** (`frontend/src/api/client.ts`, line ~39-79)
   - On 201 Created: React Query invalidates `QUERY_KEYS.TRANSACTIONS`
   - UI refetches and displays updated list

### Error Flow: 401 Unauthorized

1. **Request fails auth** (e.g., expired token, invalid signature)
   - FastAPI `get_current_user` raises `HTTPException(401)`
   - Response: `{"detail": "Could not validate credentials"}`

2. **Response interceptor checks status** (`frontend/src/api/client.ts`, line ~48-64)
   - If request was `GET /auth/me` (status-check): **preserve token** (might be transient DB issue)
   - If request was real protected resource (e.g., `POST /transactions`): **clear token** from AsyncStorage
   - AuthContext notices token is cleared, triggers logout

3. **AuthContext re-renders Navigation** (`frontend/src/store/AuthContext.tsx`)
   - `isAuthenticated = false`
   - UI shows Login/Register screens

**State Management:**
- **Frontend:** Synchronous: AuthContext holds `user`, `isAuthenticated`, `isLoading`
- **Frontend:** Async queries: React Query `useQuery` hooks with automatic refetch on focus
- **Backend:** Stateless API; all state in PostgreSQL; session created per-request via `get_db()` dependency
- **Persistence:** Frontend stores JWT in `AsyncStorage` (survives app restart); user data optional cache

## Key Abstractions

**JWT Token:**
- Purpose: Stateless, tamper-proof authentication ticket
- Examples: Created in `backend/app/core/security.py` line ~40; decoded line ~63; stored in `frontend/src/store/AuthContext.tsx`
- Pattern: HS256 signed with `settings.SECRET_KEY`; expires after 30 minutes

**FastAPI Dependency Injection:**
- Purpose: Reusable, composable business logic (auth, DB session, validation)
- Examples: `get_current_user` in `backend/app/core/security.py` line ~83; `get_db` in `backend/app/core/database.py` line ~46
- Pattern: Defined as functions with type hints; injected via `Depends()` in route handlers

**SQLAlchemy ORM Relationship:**
- Purpose: Navigate foreign keys as Python object attributes
- Examples: `user.finance_sources` traverses `User.id → FinanceSource.owner_id`
- Pattern: Declared in model files (e.g., `backend/app/models/user.py`); loaded eagerly or lazily per route

**React Query (TanStack Query):**
- Purpose: Client-side caching and synchronization of server state
- Examples: `useQuery([QUERY_KEYS.TRANSACTIONS], ...)` in `frontend/src/screens/TransactionsScreen.tsx` line ~20
- Pattern: Query keys namespace data; hooks auto-refetch on focus, stale time, retry logic

**Pydantic Schemas:**
- Purpose: Define request/response contracts with validation
- Examples: `UserCreate`, `TransactionCreate`, `TransactionResponse` in `backend/app/schemas/`
- Pattern: Inherit `BaseModel`; declare fields with type hints and optional `Field(...)`; FastAPI auto-generates OpenAPI docs

**Exchange Rate Service:**
- Purpose: Fetch live rates from Frankfurter API; gracefully degrade if unreachable
- Examples: `backend/app/services/rates.py`
- Pattern: Synchronous HTTP call; catches network errors; returns `Decimal` or `None`

## Entry Points

**Frontend (Expo):**
- Location: `frontend/App.tsx`
- Triggers: App launch (iOS/Android simulator, web browser, or native build)
- Responsibilities: Mount QueryClientProvider, AuthProvider, Navigation; manage app-level styling

**Frontend Web (Expo Export):**
- Location: `frontend/dist/index.html` (after `npm run build:web`)
- Triggers: Browser request to `http://localhost/` (Caddy serves from `/srv` volume)
- Responsibilities: Embed React Native Web runtime; bootstrap App.tsx

**Backend API:**
- Location: `backend/app/main.py`
- Triggers: `uvicorn app.main:app --host 0.0.0.0 --port 8000` (in container or dev)
- Responsibilities: Create FastAPI instance, attach CORS, include routers, expose `/health` and `/docs`

**Database Migration:**
- Location: `backend/migrations/env.py` (Alembic entry point)
- Triggers: `alembic upgrade head` (run manually or via `migrate` container service in docker-compose.prod.yml)
- Responsibilities: Execute SQL migration scripts from `backend/migrations/versions/` to advance schema version

**Caddy Gateway:**
- Location: `infra/Caddyfile`
- Triggers: `caddy` binary starts; reads Caddyfile from volume mount (docker-compose.prod.yml, line ~72)
- Responsibilities: Listen on 0.0.0.0:80/443; serve static assets; proxy `/api/*` to FastAPI

## Architectural Constraints

- **Threading:** Expo frontend is single-threaded event loop (JavaScript/TypeScript). FastAPI uses async/await; can run multiple worker processes. PostgreSQL handles concurrent connections with connection pooling (FastAPI `pool_size=5`, `max_overflow=10` in `backend/app/core/database.py` line ~26-27).

- **Global state:** Frontend: `AuthContext` is app-level singleton providing auth state to all descendants. Backend: `settings` singleton read from environment in `backend/app/core/config.py` line ~47; `queryClient` singleton in `frontend/src/utils/queryClient`.

- **Circular imports:** None detected. Models import from `app.core.database` (Base); routes import from models/schemas; security imports from models/database. Dependency graph is acyclic.

- **Same-origin constraint:** Frontend and API must have same hostname/port in production (Caddy on 80/443). Dev environment allows `CORS` from localhost:8000 (API) and localhost:3000 (Expo), defined in `backend/app/core/config.py` line ~25.

- **Database connection pooling:** PostgreSQL connections are pooled with `pool_size=5`, `max_overflow=10`, `pool_recycle=3600` (see `backend/app/core/database.py` line ~26-27). SQLite dev builds skip pooling (line ~28-30). Prevents connection exhaustion.

- **Token expiration:** JWT tokens expire after 30 minutes (configurable via `ACCESS_TOKEN_EXPIRE_MINUTES` in config). Frontend must handle 401 and re-login. No automatic token refresh implemented (Phase 4 state).

- **Request timeout:** Axios client sets `timeout: 10000` (10 seconds) for all requests; enforced by frontend (see `frontend/src/api/client.ts` line ~10).

- **Static asset serving:** Expo web export must be built and copied to volume before Caddy container starts. Docker Compose prod references `../frontend/dist:/srv:ro` (read-only mount). Requires `npm run build:web` before compose up.

## Anti-Patterns

### Global Settings Accessed Without Dependency

**What happens:** `backend/app/core/config.py` line ~47 creates a module-level singleton `settings = Settings()`. Routes and middleware directly reference `settings.ENVIRONMENT`, `settings.ALLOWED_ORIGINS`, etc., without dependency injection.

**Why it's wrong:** Makes tests harder to parameterize; environment overrides only work if `.env` file exists at runtime; no way to inject test-specific config without mocking the module.

**Do this instead:** For critical config (database URL, secrets), consider passing via `Depends(get_config)`. For non-critical config (debug flags, timeouts), current module-level singleton is acceptable. No changes planned for Phase 4.

### 401 Response Clears Token Without Distinguishing Request Type

**What happens:** Original frontend code (before fix) cleared JWT token on ANY 401 response, including transient failures from `GET /auth/me` status-check calls. If the status-check failed due to a temporary DB connection pool issue, the user was logged out even though their PATCH request succeeded.

**Why it's wrong:** Conflates real auth failures (token expired, signature invalid) with transient application errors (database pool exhausted). Leads to unexpected logouts.

**Do this instead:** `frontend/src/api/client.ts` line ~56 now checks `if (!isAuthMeGet)` before clearing token. Only clear token on real protected resource failures, not on status-check calls. Additionally, backend `backend/app/core/database.py` line ~25 adds `pool_recycle=3600` defense-in-depth to prevent stale connections.

### Missing Automatic JWT Token Refresh

**What happens:** Tokens expire after 30 minutes; frontend has no mechanism to refresh them silently. User must re-login manually.

**Why it's wrong:** Poor UX; interrupts long sessions. Other financial apps (Stripe, Plaid) use refresh tokens for seamless renewal.

**Do this instead:** Implement refresh-token flow: issue short-lived access token + long-lived refresh token at login; on 401, POST `/api/v1/auth/refresh` with refresh token to get new access token. Plan for Phase 5+.

## Error Handling

**Strategy:** Layered error responses with JSON payloads containing `detail` or `message` field.

**Patterns:**

1. **Validation error (422):** Pydantic schema mismatch
   - Example: `POST /auth/register` with `password: "short"` returns 422 with field-level errors
   - Frontend: Axios error handler (line ~68 in client.ts) extracts `error.response.data.detail`

2. **Authentication error (401):** JWT invalid, expired, or missing
   - Example: `GET /finance-sources` without token or with corrupted token
   - Handler: `backend/app/core/security.py` line ~105-144 raises `HTTPException(401, "Could not validate credentials")`
   - Frontend: Response interceptor checks method/URL; clears token if not status-check call

3. **Business logic error (400):** Invalid request but well-formed
   - Example: `POST /transactions` with negative amount
   - Handler: Route validates and raises `HTTPException(400, "Amount must be positive")`
   - Frontend: User sees error message in Alert dialog

4. **Not found (404):** Resource doesn't exist
   - Example: `GET /transactions/invalid-uuid`
   - Handler: Route checks `if transaction is None: raise HTTPException(404)`
   - Frontend: Navigates back or shows "Deleted" message

5. **Server error (500):** Unexpected exception in handler
   - Example: Database constraint violation, service timeout
   - Handler: FastAPI catches unhandled exceptions; logs them; returns 500 with generic message
   - Frontend: User sees "An error occurred"; can retry

6. **External API error (graceful fallback):** Frankfurter API unreachable
   - Example: `backend/app/services/rates.py` catches network timeout
   - Handler: Returns `None` for `converted_amount` instead of raising
   - Behavior: Transaction created without conversion; frontend displays "Rate unavailable"

## Cross-Cutting Concerns

**Logging:** Backend uses Python `logging` module; routes call `logger.info()` and `logger.exception()` with diagnostic context (e.g., `f"DIAG_TOKEN_DECODE user_id={user_id}"`). Frontend uses `console.error()` and `console.log()` (Expo logs visible in DevTools). No centralized log aggregation in Phase 4.

**Validation:** Frontend: Pydantic `BaseModel` enforces type hints and constraints (e.g., `EmailStr`, `min_length`). Type hints are declarative; no custom validators. Backend: Pydantic validates schema on route entry. Frontend: React Hook Form or manual checks in form handlers (e.g., `TransactionFormScreen.tsx` validates amount before submit).

**Authentication:** JWT-based. Issued at `/api/v1/auth/register` and `/api/v1/auth/login`. Stored in frontend `AsyncStorage[STORAGE_KEYS.AUTH_TOKEN]`. Validated on every protected endpoint via `get_current_user` dependency. No session cookies; no CSRF tokens (not applicable for stateless API).

**CORS:** Configured in `backend/app/main.py` line ~18-24 via `CORSMiddleware`. Allows origins from `settings.ALLOWED_ORIGINS` (dev: `localhost:8081`, `localhost:19006`, `localhost:3000`; prod: same-origin via Caddy). Allows credentials, all methods, all headers.

**Rate limiting:** Not implemented. External Frankfurter API is free tier; assumes low request volume.

---

*Architecture analysis: 2026-05-24*
