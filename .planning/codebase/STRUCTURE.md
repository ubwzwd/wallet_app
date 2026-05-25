# Codebase Structure

**Analysis Date:** 2026-05-24

## Directory Layout

```
wallet_app/                        # Monorepo root
├── backend/                        # Python FastAPI backend
│   ├── app/                        # Application package
│   │   ├── main.py                 # FastAPI app entry point
│   │   ├── __init__.py
│   │   ├── api/                    # Route handlers by domain
│   │   │   ├── __init__.py
│   │   │   ├── auth.py             # Register, login, me (get/patch)
│   │   │   ├── finance_sources.py  # CRUD for accounts/sources
│   │   │   ├── transactions.py     # CRUD for transactions + conversion logic
│   │   │   └── rates.py            # Exchange rate endpoints
│   │   ├── core/                   # Infrastructure & configuration
│   │   │   ├── config.py           # Settings from env (Pydantic)
│   │   │   ├── database.py         # SQLAlchemy engine, SessionLocal, get_db()
│   │   │   └── security.py         # JWT, password hashing, get_current_user()
│   │   ├── models/                 # SQLAlchemy ORM models
│   │   │   ├── __init__.py         # Imports all models (for Alembic)
│   │   │   ├── user.py             # User table
│   │   │   ├── finance_source.py   # FinanceSource table (accounts)
│   │   │   ├── transaction.py      # Transaction table
│   │   │   └── transaction_tag.py  # TransactionTag table
│   │   ├── schemas/                # Pydantic request/response schemas
│   │   │   ├── user.py             # UserCreate, UserLogin, UserResponse, Token
│   │   │   ├── finance_source.py   # FinanceSourceCreate, FinanceSourceResponse
│   │   │   └── transaction.py      # TransactionCreate, TransactionResponse
│   │   └── services/               # Business logic modules
│   │       └── rates.py            # fetch_rate() service calling Frankfurter API
│   ├── migrations/                 # Alembic schema migrations
│   │   ├── env.py                  # Alembic config (loads DATABASE_URL)
│   │   ├── script.py.mako          # Migration template
│   │   ├── README                  # Alembic instructions
│   │   └── versions/               # Timestamped migration files
│   │       ├── 026ee0aecb66_rename_accounts_to_finance_sources.py
│   │       ├── 5ca7fe6e37db_remove_exchange_rates_table_use_real_.py
│   │       ├── 76227e076393_add_default_source_to_users.py
│   │       ├── 8a4f4d66d893_add_transfer_pair_id_to_transactions.py
│   │       ├── d671e51094c8_rename_accounts_currency_to_default_.py
│   │       └── e533c88884b7_initial_schema_users_accounts_.py
│   ├── tests/                      # Pytest test suite
│   │   ├── conftest.py             # Fixtures (test DB session, etc.)
│   │   ├── test_auto_default_source.py
│   │   ├── test_config.py
│   │   ├── test_conversion.py
│   │   ├── test_profile_structure.py
│   │   ├── test_session_persistence.py
│   │   └── test_transactions_structure.py
│   ├── alembic.ini                 # Alembic configuration file
│   ├── pyproject.toml              # Poetry dependency manifest
│   ├── poetry.lock                 # Poetry lockfile (exact versions)
│   ├── env.example                 # Example environment variables
│   ├── wallet_dev.db               # SQLite dev database (gitignored)
│   └── README.md                   # Backend-specific documentation
│
├── frontend/                       # Expo React Native + Web application
│   ├── App.tsx                     # Root component (providers + Navigation)
│   ├── index.ts                    # Expo entry point
│   ├── app.json                    # Expo configuration (name, slug, plugins)
│   ├── src/                        # Source code
│   │   ├── api/                    # HTTP client and API method wrappers
│   │   │   ├── client.ts           # Axios instance with JWT interceptors
│   │   │   ├── auth.ts             # login(), register(), getCurrentUser()
│   │   │   ├── financeSources.ts   # getFinanceSources(), createFinanceSource()
│   │   │   ├── transactions.ts     # getTransactions(), createTransaction()
│   │   │   └── rates.ts            # getExchangeRate()
│   │   ├── screens/                # Full-screen views (navigation targets)
│   │   │   ├── index.ts            # Exports all screens
│   │   │   ├── LoginScreen.tsx     # Email + password form
│   │   │   ├── RegisterScreen.tsx  # New account creation
│   │   │   ├── HomeScreen.tsx      # Main dashboard (nav tabs)
│   │   │   ├── TransactionsScreen.tsx  # List transactions with React Query
│   │   │   ├── TransactionFormScreen.tsx # Create/edit with currency conversion
│   │   │   ├── FinanceSourcesScreen.tsx  # List sources
│   │   │   ├── FinanceSourceFormScreen.tsx # Create/edit source
│   │   │   └── ProfileScreen.tsx   # User settings (currency, default source)
│   │   ├── components/             # Reusable UI components (not full screens)
│   │   │   ├── Navigation.tsx      # Conditional routing (auth vs app)
│   │   │   ├── Screen.tsx          # Safe area wrapper, status bar
│   │   │   ├── Card.tsx            # Styled container
│   │   │   ├── Button.tsx          # Pressable with styling
│   │   │   └── Input.tsx           # Text input field
│   │   ├── store/                  # Global state (Context API)
│   │   │   └── AuthContext.tsx     # Auth state, login/logout, token persistence
│   │   ├── utils/                  # Utilities and helpers
│   │   │   └── queryClient.ts      # TanStack Query client configuration
│   │   ├── types/                  # TypeScript type definitions
│   │   │   └── api.ts              # API contract types (User, Transaction, etc.)
│   │   └── constants/              # App-wide constants
│   │       └── config.ts           # API_BASE_URL, STORAGE_KEYS, QUERY_KEYS
│   ├── __tests__/                  # Jest test files (co-located with source)
│   │   ├── CurrencyPicker.test.ts
│   │   ├── FinanceSourcesScreen.test.ts
│   │   ├── TransactionFormScreen.test.ts
│   │   └── TransactionsScreen.test.ts
│   ├── assets/                     # Image assets
│   │   ├── adaptive-icon.png
│   │   ├── icon.png
│   │   ├── splash-icon.png
│   │   └── favicon.png
│   ├── package.json                # NPM dependencies
│   ├── package-lock.json           # NPM lockfile
│   ├── tsconfig.json               # TypeScript configuration
│   ├── babel.config.js             # Babel transpiler config (for Expo)
│   ├── jest.config.js              # Jest test runner config
│   ├── jest.setup.js               # Jest setup (global mocks)
│   ├── tailwind.config.js          # Tailwind CSS config (via NativeWind)
│   ├── app.d.ts                    # Expo/type augmentations
│   ├── dist/                       # Output directory (after npm run build:web)
│   ├── START.md                    # Dev environment setup guide
│   └── README.md                   # Frontend-specific documentation
│
├── infra/                          # Infrastructure & Docker
│   ├── Dockerfile.api              # Multi-stage build: FastAPI + Alembic
│   │                               # Builder: Poetry export → uv install
│   │                               # Runtime: python:3.11-slim + app code
│   ├── docker-compose.dev.yml      # Development compose (db only, no containers for api/caddy)
│   │                               # Postgres on 5432:5432
│   ├── docker-compose.prod.yml     # Production compose (db, api, migrate, caddy)
│   │                               # Full stack with volume mounts, healthchecks
│   ├── Caddyfile                   # Caddy reverse proxy config
│   │                               # Serves /srv (frontend dist) at /
│   │                               # Proxies /api/*, /health, /docs to api:8000
│   ├── scripts/                    # Helper scripts
│   │   ├── env-coverage.sh         # Print env var list to .env.example
│   │   └── smoke.sh                # Smoke test (curl /health, /docs, etc.)
│   └── README.md                   # Infra-specific documentation (if exists)
│
├── .planning/                      # GSD phase planning & analysis
│   ├── config.json                 # GSD configuration
│   ├── phases/                     # Phase documents
│   │   ├── 01-*.md
│   │   ├── 02-*.md
│   │   ├── 03-*.md
│   │   └── 04-*.md
│   └── codebase/                   # Codebase map documents (generated by /gsd:map-codebase)
│       ├── ARCHITECTURE.md         # (this document)
│       ├── STRUCTURE.md            # (current file)
│       ├── STACK.md                # (if tech focus)
│       └── INTEGRATIONS.md         # (if tech focus)
│
├── .claude/                        # Claude agent skills and rules
│   └── skills/                     # (if exists)
│
├── .git/                           # Git repository
├── .gitignore                      # Git ignore patterns
├── README.md                       # Root-level project overview
├── SPEC.md                         # Detailed specification & decision record
└── wallet-ui-design.zip            # Figma or design export (v2 mockups)
```

## Directory Purposes

**`backend/`:**
- Purpose: RESTful API server, database models, business logic
- Contains: FastAPI routes, SQLAlchemy ORM, Pydantic schemas, Alembic migrations, pytest test suite
- Key files: `app/main.py` (app entry), `app/api/*.py` (routes), `app/models/*.py` (ORM), `migrations/versions/` (schema changes)

**`backend/app/`:**
- Purpose: Application code organized by concern (api, core, models, schemas, services)
- Contains: All route handlers, models, schemas, and core infrastructure
- Key files: `main.py` (router aggregation), `core/config.py` (settings), `core/database.py` (session management), `core/security.py` (auth)

**`backend/app/api/`:**
- Purpose: Route handlers grouped by domain (auth, transactions, finance_sources, rates)
- Contains: FastAPI `APIRouter` definitions with `@router.get()`, `@router.post()`, `@router.patch()`, `@router.delete()` decorators
- Naming: `{domain}.py` (e.g., `auth.py`, `transactions.py`)
- Responsibilities: Validate request schema, check auth, call business logic, return response schema

**`backend/app/core/`:**
- Purpose: Shared infrastructure — configuration, database connection, security
- Contains: `config.py` (Settings), `database.py` (engine, SessionLocal, get_db), `security.py` (JWT, password, auth)
- Usage: Imported by routes, models, and migrations

**`backend/app/models/`:**
- Purpose: SQLAlchemy ORM entity definitions (maps to database tables)
- Contains: User, FinanceSource, Transaction, TransactionTag classes with Column, relationship, foreign key definitions
- Naming: `{entity}.py` (singular; e.g., `user.py`, `transaction.py`)
- Key feature: `__init__.py` imports all models for Alembic autogenerate

**`backend/app/schemas/`:**
- Purpose: Pydantic schemas for request/response validation and OpenAPI documentation
- Contains: *Create, *Update, *Response variants for each entity
- Naming: `{domain}.py` (e.g., `user.py` has UserCreate, UserLogin, UserResponse, UserUpdate, Token)
- Key feature: Fields use type hints, Field(...), EmailStr, Decimal for validation

**`backend/migrations/`:**
- Purpose: Version-controlled schema changes via Alembic
- Contains: `env.py` (Alembic config), `versions/` (timestamped migration scripts)
- Workflow: Generate with `alembic revision --autogenerate -m "description"`, review, apply with `alembic upgrade head`
- Key file: `versions/` — each `.py` file is a migration step (up/downgrade)

**`backend/tests/`:**
- Purpose: Pytest test suite for business logic and API endpoints
- Contains: Fixtures in `conftest.py`, domain-specific test files (test_config.py, test_conversion.py)
- Naming: `test_*.py`
- Key pattern: Use fixtures to create test database session, mock external services

**`frontend/`:**
- Purpose: Expo React Native + Web UI
- Contains: App component, screens, components, API client, state management, types
- Build target: Expo Go (dev), native iOS/Android (EAS), web (Expo web export in `dist/`)

**`frontend/src/api/`:**
- Purpose: HTTP client and API method wrappers (thin layer over Axios)
- Contains: `client.ts` (Axios instance with JWT interceptors), `auth.ts`, `transactions.ts`, `financeSources.ts`, `rates.ts`
- Naming: `{domain}.ts` (export functions like `login(creds)`, `getTransactions()`)
- Key pattern: Each export is an async function that calls `apiClient` with endpoint path, params, body

**`frontend/src/screens/`:**
- Purpose: Full-screen views displayed by Navigation component
- Contains: LoginScreen, RegisterScreen, HomeScreen, TransactionsScreen, TransactionFormScreen, FinanceSourcesScreen, ProfileScreen
- Naming: `{Name}Screen.tsx` (PascalCase)
- Key pattern: Use `useQuery`/`useMutation` from React Query; layout with `Screen` wrapper component

**`frontend/src/components/`:**
- Purpose: Reusable UI components (not full screens)
- Contains: Navigation (conditional routing), Screen (safe area), Card, Button, Input
- Naming: `{Name}.tsx` (PascalCase)
- Key pattern: Accept props, return styled React Native elements (View, Text, etc.)

**`frontend/src/store/`:**
- Purpose: Global state via Context API
- Contains: `AuthContext.tsx` with AuthProvider, useAuth hook
- Key pattern: `useContext(AuthContext)` in any component to access `user`, `isLoading`, `isAuthenticated`, `login()`, `logout()`

**`frontend/src/utils/`:**
- Purpose: Shared utility functions and configurations
- Contains: `queryClient.ts` (TanStack Query client with cache options)
- Naming: `{topic}.ts`

**`frontend/src/types/`:**
- Purpose: TypeScript interface definitions (API contract)
- Contains: `api.ts` with User, LoginRequest, RegisterRequest, Transaction, FinanceSource types
- Naming: `api.ts` (single file) or domain-specific files if large

**`frontend/src/constants/`:**
- Purpose: App-wide constants (URLs, storage keys, query keys)
- Contains: `config.ts` with API_BASE_URL, STORAGE_KEYS, QUERY_KEYS
- Key pattern: Export const objects; import in api client and components

**`frontend/__tests__/`:**
- Purpose: Jest test suite (co-located organization)
- Contains: `*.test.ts` and `*.test.tsx` files
- Naming: `{Name}.test.ts` matching screen/component name
- Key pattern: Mock apiClient, use renderHook for custom hooks

**`infra/`:**
- Purpose: Docker, Caddy, compose files, and helper scripts
- Contains: Dockerfile.api (multi-stage), docker-compose.dev/prod.yml, Caddyfile, scripts/
- Key files: `Dockerfile.api` (build backend image), `docker-compose.prod.yml` (full stack)

**`infra/Dockerfile.api`:**
- Purpose: Multi-stage build for production-ready FastAPI image
- Stages: builder (Poetry → uv install), runtime (python:3.11-slim + app)
- Key feature: No Poetry/pip dev tools in final image; non-root `appuser`; healthcheck via urllib

**`infra/docker-compose.prod.yml`:**
- Purpose: Orchestrate production-shape stack (db, migrate, api, caddy)
- Services: `db` (postgres), `migrate` (alembic), `api` (fastapi), `caddy` (reverse proxy)
- Volumes: postgres_data, caddy_data, caddy_config, frontend/dist mounted as /srv in caddy
- Key orchestration: migrate runs before api; api service health-checks before caddy

**`infra/Caddyfile`:**
- Purpose: Reverse proxy and static file serving configuration
- Handlers: `/api/*` → `api:8000` (reverse proxy), `/` → `/srv` (static files), `/health` and `/docs` → `api:8000`
- Key feature: Same-origin routing — no separate web container needed

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md (this file), STACK.md, INTEGRATIONS.md (generated on-demand)
- Consumer: `/gsd:plan-phase` and `/gsd:execute-phase` read these to understand project layout and patterns

## Key File Locations

**Entry Points:**
- `backend/app/main.py` — FastAPI app initialization and router inclusion
- `frontend/App.tsx` — Expo root component with providers
- `frontend/index.ts` — Expo entry point (registers App)
- `infra/Caddyfile` — Gateway routing configuration
- `backend/migrations/env.py` — Alembic migration entry point

**Configuration:**
- `backend/app/core/config.py` — Environment-based settings (DATABASE_URL, SECRET_KEY, CORS)
- `backend/alembic.ini` — Alembic configuration file
- `frontend/app.json` — Expo app metadata (name, slug, plugins)
- `frontend/tsconfig.json` — TypeScript compiler options
- `frontend/babel.config.js` — Babel transpilation rules
- `frontend/tailwind.config.js` — Tailwind/NativeWind styling
- `infra/docker-compose.dev.yml` — Dev environment (db only)
- `infra/docker-compose.prod.yml` — Prod stack (db, api, caddy, migrate)

**Core Logic:**
- `backend/app/api/auth.py` — Register, login, me endpoints
- `backend/app/api/transactions.py` — CRUD + currency conversion logic
- `backend/app/api/finance_sources.py` — Account/source management
- `backend/app/core/security.py` — JWT, password hashing, get_current_user()
- `backend/app/core/database.py` — SQLAlchemy engine, session management
- `backend/app/services/rates.py` — Frankfurter API integration
- `frontend/src/api/client.ts` — Axios with JWT interceptors
- `frontend/src/store/AuthContext.tsx` — Global auth state and token persistence

**Database:**
- `backend/app/models/user.py` — User table
- `backend/app/models/finance_source.py` — FinanceSource table
- `backend/app/models/transaction.py` — Transaction table
- `backend/app/models/transaction_tag.py` — TransactionTag table
- `backend/migrations/versions/` — Timestamped schema change scripts

**Testing:**
- `backend/tests/conftest.py` — Pytest fixtures
- `backend/tests/test_*.py` — Test modules
- `frontend/__tests__/*.test.ts` — Jest test modules
- `frontend/jest.config.js` — Jest configuration

## Naming Conventions

**Python Files:**
- Package modules: lowercase with underscores (e.g., `finance_sources.py`, `transaction_tag.py`)
- Classes: PascalCase (e.g., `User`, `FinanceSource`)
- Functions/methods: snake_case (e.g., `get_current_user`, `create_access_token`)
- Constants: UPPER_CASE (e.g., `DATABASE_URL`, `ACCESS_TOKEN_EXPIRE_MINUTES`)

**TypeScript Files:**
- Screens: `{Name}Screen.tsx` (e.g., `TransactionsScreen.tsx`)
- Components: `{Name}.tsx` (e.g., `Navigation.tsx`, `Button.tsx`)
- API methods: `{domain}.ts` with exports like `login()`, `getTransactions()`
- Types: `api.ts` or `types.ts` with interfaces (e.g., `User`, `Transaction`)
- Constants: `config.ts` with exports (e.g., `API_BASE_URL`, `QUERY_KEYS`)
- Tests: `{Name}.test.ts` (e.g., `TransactionFormScreen.test.ts`)

**Directories:**
- Package directories: lowercase with underscores (e.g., `finance_sources/`, `transaction_tags/`)
- Feature directories: lowercase (e.g., `api/`, `screens/`, `components/`)
- Asset directories: lowercase (e.g., `assets/`, `icons/`)

**API Endpoints:**
- Routes: `/api/v1/{resource}` (e.g., `/api/v1/auth`, `/api/v1/transactions`)
- Actions: POST (create), GET (read), PATCH (update), DELETE (delete)
- Examples:
  - `POST /api/v1/auth/register` — create user account
  - `POST /api/v1/auth/login` — get JWT token
  - `GET /api/v1/auth/me` — get current user
  - `PATCH /api/v1/auth/me` — update user profile
  - `GET /api/v1/transactions?limit=50` — list transactions
  - `POST /api/v1/transactions` — create transaction
  - `PATCH /api/v1/transactions/{id}` — update transaction
  - `DELETE /api/v1/transactions/{id}` — delete transaction

## Where to Add New Code

**New Feature (e.g., Add Transaction Category):**

1. **Backend database schema:**
   - Create new ORM model: `backend/app/models/transaction_category.py`
   - Add relationship to `backend/app/models/transaction.py`: `category = relationship("TransactionCategory")`
   - Generate migration: `cd backend && alembic revision --autogenerate -m "add transaction categories"`
   - Review and apply: `alembic upgrade head`

2. **Backend API:**
   - Create Pydantic schema: `backend/app/schemas/transaction_category.py` with TransactionCategoryCreate, TransactionCategoryResponse
   - Create route handler: `backend/app/api/transaction_categories.py` with CRUD endpoints
   - Import router in `backend/app/main.py`: `from app.api import transaction_categories` and `app.include_router(transaction_categories.router, prefix="/api/v1")`

3. **Backend business logic:**
   - Add service methods if needed: `backend/app/services/transaction_category.py`

4. **Frontend API client:**
   - Create wrapper: `frontend/src/api/transactionCategories.ts` with `getCategories()`, `createCategory()`, etc.

5. **Frontend UI:**
   - Add screen: `frontend/src/screens/TransactionCategoriesScreen.tsx`
   - Add form component: `frontend/src/components/CategoryPicker.tsx` (reusable)
   - Update `frontend/src/store/AuthContext.tsx` or use React Query to manage category cache
   - Add types: `frontend/src/types/api.ts` — new `TransactionCategory` interface

6. **Tests:**
   - Backend: `backend/tests/test_transaction_categories.py`
   - Frontend: `frontend/__tests__/TransactionCategoriesScreen.test.ts`

**New Component (e.g., Reusable Currency Dropdown):**

1. Create component file: `frontend/src/components/CurrencyPicker.tsx`
2. Define props interface inline or in `frontend/src/types/api.ts`
3. Export from component and use in screens (e.g., `TransactionFormScreen.tsx`)
4. Add test: `frontend/__tests__/CurrencyPicker.test.ts`

**New Utility (e.g., Currency Formatter):**

1. Create utility file: `frontend/src/utils/currencyFormatter.ts`
2. Export functions (e.g., `formatCurrency(amount: Decimal, currency: string): string`)
3. Import in screens/components where needed
4. Add unit test: `frontend/__tests__/utils.test.ts` (or split by utility name)

**New Endpoint (e.g., GET /api/v1/statistics):**

1. Create route handler in existing or new file: `backend/app/api/statistics.py` (if new)
2. Define schema: `backend/app/schemas/statistics.py` — `StatisticsResponse` with computed fields
3. Add business logic if needed: `backend/app/services/statistics.py`
4. Import and include in `backend/app/main.py`: `app.include_router(statistics.router, prefix="/api/v1")`
5. Frontend: `frontend/src/api/statistics.ts` with `getStatistics()` function
6. Frontend screen: Use `useQuery([QUERY_KEYS.STATISTICS], getStatistics)` in a new or existing screen

**Database Migration:**

1. Make model changes (add field, change type, add relationship): `backend/app/models/*.py`
2. Generate: `cd backend && alembic revision --autogenerate -m "descriptive message"`
3. Review generated file: `backend/migrations/versions/{timestamp}_*.py`
4. Apply locally: `alembic upgrade head` (or via Alembic in FastAPI startup)
5. Production: `migrate` service in docker-compose.prod.yml runs `alembic upgrade head` before api service starts

**Docker/Deployment Change:**

1. Update `infra/Dockerfile.api` if changing build strategy, base image, or system dependencies
2. Update `infra/docker-compose.dev.yml` for local development changes
3. Update `infra/docker-compose.prod.yml` for production orchestration
4. Update `infra/Caddyfile` for gateway routing changes
5. Test locally: `docker compose -f infra/docker-compose.prod.yml up` and verify with `infra/scripts/smoke.sh`

## Special Directories

**`backend/migrations/`:**
- Purpose: Version-controlled schema evolution via Alembic
- Generated: No (committed to git)
- Committed: Yes (all versions/ files are tracked)
- Workflow: `alembic revision --autogenerate -m "..."` creates new file; review and commit

**`frontend/dist/`:**
- Purpose: Build output of `npm run build:web` (Expo web export)
- Generated: Yes (build artifact)
- Committed: No (in .gitignore)
- Used by: Caddy container mounts `../frontend/dist:/srv` to serve static assets

**`backend/wallet_dev.db`:**
- Purpose: SQLite database file for local development
- Generated: Yes (created by FastAPI on first connection)
- Committed: No (in .gitignore)
- Alternative: Use Postgres in docker-compose.dev.yml

**`.planning/`:**
- Purpose: GSD phase planning and codebase analysis
- Generated: Partially (config.json created by user; phase docs created by phases; codebase docs generated by `/gsd:map-codebase`)
- Committed: Yes (tracked in git; helps future developers understand architecture)

**`frontend/node_modules/` and `backend/.venv/`:**
- Purpose: Installed dependencies
- Generated: Yes (npm install, poetry install)
- Committed: No (in .gitignore)
- Lockfiles committed: Yes (package-lock.json, poetry.lock)

---

*Structure analysis: 2026-05-24*
