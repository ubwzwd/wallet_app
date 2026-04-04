# Codebase Structure

**Analysis Date:** 2026-04-05

## Directory Layout

```
wallet_app/                          # Monorepo root
├── backend/                         # Python FastAPI backend
│   ├── app/
│   │   ├── api/                     # HTTP route handlers (one file per resource)
│   │   │   ├── auth.py
│   │   │   ├── finance_sources.py
│   │   │   ├── transactions.py
│   │   │   └── rates.py
│   │   ├── core/                    # Infrastructure (config, DB, security)
│   │   │   ├── config.py
│   │   │   ├── database.py
│   │   │   └── security.py
│   │   ├── models/                  # SQLAlchemy ORM models
│   │   │   ├── __init__.py          # Imports all models (required for Alembic)
│   │   │   ├── user.py
│   │   │   ├── finance_source.py
│   │   │   ├── transaction.py
│   │   │   └── transaction_tag.py
│   │   ├── schemas/                 # Pydantic request/response schemas
│   │   │   ├── user.py
│   │   │   ├── finance_source.py
│   │   │   ├── transaction.py
│   │   │   └── currency.py
│   │   ├── services/                # External integrations and business logic
│   │   │   └── rates.py             # Frankfurter API client
│   │   └── main.py                  # FastAPI app creation and router registration
│   ├── migrations/                  # Alembic migration scripts
│   │   └── versions/                # Individual migration files
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── alembic.ini
│   ├── pyproject.toml               # Poetry dependencies
│   └── env.example                  # Environment variable template
│
├── frontend/                        # React Native / Expo frontend
│   ├── src/
│   │   ├── api/                     # Typed HTTP client modules (one per resource)
│   │   │   ├── client.ts            # Axios instance with interceptors
│   │   │   ├── auth.ts
│   │   │   ├── transactions.ts
│   │   │   └── financeSources.ts
│   │   ├── components/              # Reusable UI primitives
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Screen.tsx
│   │   │   ├── Navigation.tsx       # Top-level navigation (auth gate)
│   │   │   └── index.ts             # Barrel export
│   │   ├── constants/
│   │   │   └── config.ts            # API base URL, storage keys, query keys
│   │   ├── screens/                 # Full-page screen components
│   │   │   ├── HomeScreen.tsx       # Root screen; owns in-app navigation state
│   │   │   ├── LoginScreen.tsx
│   │   │   ├── RegisterScreen.tsx
│   │   │   ├── FinanceSourcesScreen.tsx
│   │   │   ├── FinanceSourceFormScreen.tsx
│   │   │   ├── TransactionsScreen.tsx
│   │   │   ├── TransactionFormScreen.tsx
│   │   │   └── index.ts             # Barrel export
│   │   ├── store/
│   │   │   └── AuthContext.tsx       # Auth state, login/logout/register actions
│   │   ├── types/
│   │   │   └── api.ts               # TypeScript interfaces matching backend schemas
│   │   └── utils/
│   │       └── queryClient.ts       # TanStack Query client singleton
│   ├── assets/                      # Static assets (fonts, images)
│   ├── App.tsx                      # Root component; mounts providers
│   ├── index.ts                     # Expo entry point
│   ├── app.json                     # Expo app configuration
│   ├── tsconfig.json                # TypeScript config with `@/*` alias
│   ├── babel.config.js
│   └── package.json
│
├── .planning/                       # GSD planning documents
│   └── codebase/
├── PLAN.md                          # Feature planning document
├── SPEC.md                          # Product specification
└── README.md
```

## Directory Purposes

**`backend/app/api/`:**
- Purpose: FastAPI `APIRouter` modules — one per resource domain
- Contains: Route handlers, HTTP status codes, dependency injection
- Key files: `auth.py` (register, login, me), `transactions.py` (CRUD + filter), `finance_sources.py` (CRUD + archive), `rates.py` (currencies, convert)
- Pattern: Each file creates one `router = APIRouter(prefix="/<resource>")`, registered in `main.py`

**`backend/app/core/`:**
- Purpose: Shared infrastructure used across the entire backend
- Contains: App settings, database session factory, JWT/password utilities
- Key files: `config.py` (all env vars), `database.py` (`get_db` dependency + `Base`), `security.py` (`get_current_user` dependency)

**`backend/app/models/`:**
- Purpose: SQLAlchemy ORM table definitions
- Contains: One file per DB table; `__init__.py` imports all models so Alembic auto-detects them
- Key files: `user.py`, `finance_source.py`, `transaction.py`, `transaction_tag.py`

**`backend/app/schemas/`:**
- Purpose: Pydantic validation schemas for API request bodies and response shapes
- Contains: `Create`, `Update`, and `Response` classes per resource
- Key files: `transaction.py` (most complex schema with conversion fields), `currency.py` (ISO 4217 type alias)

**`backend/app/services/`:**
- Purpose: Reusable logic and external API calls not tied to a single route
- Contains: `rates.py` — Frankfurter API calls, currency cache, conversion logic with `tenacity` retry

**`backend/migrations/versions/`:**
- Purpose: Alembic auto-generated migration scripts
- Generated: Yes (by Alembic)
- Committed: Yes

**`frontend/src/api/`:**
- Purpose: Thin wrappers over `apiClient` providing typed functions per endpoint
- Contains: Named exports for every API operation matching backend route methods
- Key files: `client.ts` (shared axios instance — the only file that touches axios directly)

**`frontend/src/components/`:**
- Purpose: Shared primitive UI components used across multiple screens
- Contains: Layout (`Screen`), form (`Input`), display (`Card`), action (`Button`), routing (`Navigation`)
- Exports via: `index.ts` barrel — import as `import { Button, Card } from '@/components'`

**`frontend/src/screens/`:**
- Purpose: Full-page views that own data fetching and business logic
- Contains: Screen components receiving callback props for navigation
- Exports via: `index.ts` barrel

**`frontend/src/store/`:**
- Purpose: Global React state
- Contains: `AuthContext.tsx` only — a single context provider + `useAuth()` custom hook

**`frontend/src/types/`:**
- Purpose: TypeScript type definitions mirroring backend Pydantic schemas
- Contains: `api.ts` — all request/response interfaces
- Note: Must be kept in sync with backend schemas manually

**`frontend/src/constants/`:**
- Purpose: App-wide constants (no magic strings/values in components)
- Contains: `config.ts` — `API_BASE_URL`, `STORAGE_KEYS`, `QUERY_KEYS`, `APP_NAME`

**`frontend/src/utils/`:**
- Purpose: Utility singletons and helpers
- Contains: `queryClient.ts` — TanStack Query singleton configuration

## Key File Locations

**Entry Points:**
- `frontend/App.tsx`: React Native root; mounts providers and `Navigation`
- `frontend/index.ts`: Expo entry point (registers `App`)
- `backend/app/main.py`: FastAPI app instance; CORS, router registration

**Configuration:**
- `backend/app/core/config.py`: All backend env vars (Pydantic Settings)
- `backend/env.example`: Required environment variable template
- `frontend/src/constants/config.ts`: Frontend constants including `API_BASE_URL`
- `frontend/tsconfig.json`: TypeScript paths (`@/*` → `src/*`)
- `frontend/app.json`: Expo app metadata and build config

**Core Logic:**
- `backend/app/core/security.py`: JWT creation/validation, `get_current_user` dependency
- `backend/app/core/database.py`: SQLAlchemy engine, `get_db` dependency
- `backend/app/services/rates.py`: Frankfurter exchange rate service
- `frontend/src/api/client.ts`: Axios instance, JWT injection, 401 handling
- `frontend/src/store/AuthContext.tsx`: Auth state, token persistence

**Data Models:**
- `backend/app/models/__init__.py`: Central import of all ORM models (Alembic target)
- `frontend/src/types/api.ts`: Shared TypeScript interfaces for all API types

**Testing:**
- Not present (no test files or test config found)

## Naming Conventions

**Backend Files:**
- Snake case: `finance_source.py`, `transaction_tag.py`
- One file per resource/concern; name matches the domain noun

**Backend Classes:**
- ORM Models: PascalCase noun matching table noun — `FinanceSource`, `Transaction`, `TransactionTag`
- Pydantic Schemas: `{Noun}Create`, `{Noun}Update`, `{Noun}Response` — e.g., `TransactionCreate`
- Router prefix: lowercase kebab matching REST path — `prefix="/finance-sources"`

**Frontend Files:**
- PascalCase for components and screens: `HomeScreen.tsx`, `Button.tsx`
- camelCase for non-component modules: `client.ts`, `queryClient.ts`, `config.ts`
- Suffix `Screen` on all full-page views: `TransactionsScreen.tsx`
- Suffix `Context` on context providers: `AuthContext.tsx`

**Frontend Exports:**
- Named exports only (no default exports from screens/components)
- Barrel files (`index.ts`) in `components/` and `screens/` for clean imports

**Path Aliases:**
- `@/*` maps to `frontend/src/*` (configured in `tsconfig.json` and `babel.config.js`)
- Use `@/components`, `@/api/client`, `@/types/api` — never relative paths across directories

## Where to Add New Code

**New Backend Resource (e.g., `budgets`):**
1. ORM model: `backend/app/models/budget.py` + add import to `backend/app/models/__init__.py`
2. Pydantic schemas: `backend/app/schemas/budget.py` — define `BudgetCreate`, `BudgetUpdate`, `BudgetResponse`
3. API router: `backend/app/api/budgets.py` — create `router = APIRouter(prefix="/budgets")`
4. Register router: add to `backend/app/main.py` — `app.include_router(budgets.router, prefix="/api/v1")`
5. Migration: `alembic revision --autogenerate -m "add_budgets_table"` then `alembic upgrade head`

**New Frontend Screen:**
1. Create `frontend/src/screens/{FeatureName}Screen.tsx` — named export, accept callback props
2. Add export to `frontend/src/screens/index.ts`
3. Add view state entry to `HomeScreen.tsx` `HomeView` type union
4. Add conditional render block in `HomeScreen.tsx`

**New Frontend API Module:**
1. Create `frontend/src/api/{resource}.ts` — functions using `apiClient` from `./client`
2. Add TypeScript types to `frontend/src/types/api.ts`
3. Add query key constant to `frontend/src/constants/config.ts` → `QUERY_KEYS`

**New Reusable Component:**
1. Create `frontend/src/components/{ComponentName}.tsx` — named export
2. Add export to `frontend/src/components/index.ts`

**New Backend Service:**
- Add to existing `backend/app/services/rates.py` if currency-related, or create `backend/app/services/{domain}.py`

**Utilities (frontend):**
- Stateless helpers: add to relevant `frontend/src/utils/` file or create new file there
- Constants: add to `frontend/src/constants/config.ts`

## Special Directories

**`.planning/`:**
- Purpose: GSD planning and codebase analysis documents
- Generated: No (human/AI authored)
- Committed: Yes

**`backend/migrations/versions/`:**
- Purpose: Alembic auto-generated database migration scripts
- Generated: Yes (via `alembic revision --autogenerate`)
- Committed: Yes — migrations are source of truth for schema history

**`frontend/assets/`:**
- Purpose: Static asset files (images, fonts) bundled by Expo
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-04-05*
