# Architecture

**Analysis Date:** 2026-04-05

## Pattern Overview

**Overall:** Full-stack monorepo with a layered REST API backend and a React Native mobile/web frontend. The two sub-projects are independently structured but share a contract via matching TypeScript types and Pydantic schemas.

**Key Characteristics:**
- Backend uses a strict 4-layer architecture: API → Models → Schemas → Services
- Frontend separates concerns across: Screens → Components → API clients → State
- No shared code between frontend and backend; contract is maintained manually via `frontend/src/types/api.ts` mirroring backend Pydantic schemas
- All API routes are prefixed `/api/v1` and versioned
- Authentication is stateless JWT (Bearer token); no server-side sessions

## Layers

### Backend

**API Layer:**
- Purpose: HTTP routing, request validation, response serialization
- Location: `backend/app/api/`
- Contains: FastAPI `APIRouter` modules — `auth.py`, `finance_sources.py`, `transactions.py`, `rates.py`
- Depends on: Core (database session, security), Models, Schemas, Services
- Used by: FastAPI app registered in `backend/app/main.py`

**Models Layer:**
- Purpose: SQLAlchemy ORM table definitions and relationships
- Location: `backend/app/models/`
- Contains: `user.py`, `finance_source.py`, `transaction.py`, `transaction_tag.py`
- Depends on: `backend/app/core/database.py` (`Base`)
- Used by: API layer (direct ORM queries), Alembic migrations

**Schemas Layer:**
- Purpose: Pydantic request/response validation and serialization contracts
- Location: `backend/app/schemas/`
- Contains: `user.py`, `finance_source.py`, `transaction.py`, `currency.py`
- Depends on: Nothing internal (pure Pydantic)
- Used by: API layer (function signatures, `response_model=`)

**Services Layer:**
- Purpose: External integrations and reusable business logic
- Location: `backend/app/services/`
- Contains: `rates.py` — Frankfurter API calls with retry logic via `tenacity`
- Depends on: `backend/app/core/config.py`
- Used by: API layer (`transactions.py` and `rates.py` import from it)

**Core Layer:**
- Purpose: Cross-cutting infrastructure (config, database, security)
- Location: `backend/app/core/`
- Contains: `config.py` (Pydantic Settings), `database.py` (SQLAlchemy engine + `get_db`), `security.py` (JWT + bcrypt + `get_current_user` dependency)
- Depends on: Nothing internal
- Used by: All other layers

### Frontend

**Screens Layer:**
- Purpose: Full-page views with business logic and data fetching
- Location: `frontend/src/screens/`
- Contains: `HomeScreen.tsx`, `LoginScreen.tsx`, `RegisterScreen.tsx`, `TransactionsScreen.tsx`, `TransactionFormScreen.tsx`, `FinanceSourcesScreen.tsx`, `FinanceSourceFormScreen.tsx`
- Depends on: Components, API clients, store, types
- Used by: Navigation component

**Components Layer:**
- Purpose: Reusable UI primitives
- Location: `frontend/src/components/`
- Contains: `Button.tsx`, `Input.tsx`, `Card.tsx`, `Screen.tsx`, `Navigation.tsx`, `index.ts` (barrel)
- Depends on: React Native, store (Navigation only)
- Used by: Screens

**API Layer:**
- Purpose: Typed wrappers around HTTP calls via the shared axios client
- Location: `frontend/src/api/`
- Contains: `client.ts` (axios instance + interceptors), `auth.ts`, `transactions.ts`, `financeSources.ts`
- Depends on: `frontend/src/constants/config.ts`, `frontend/src/types/api.ts`
- Used by: Screens (directly) and AuthContext

**Store Layer:**
- Purpose: Global auth state management via React Context
- Location: `frontend/src/store/`
- Contains: `AuthContext.tsx` — provides `useAuth()` hook with `user`, `login`, `register`, `logout`, `refreshUser`
- Depends on: `frontend/src/api/auth.ts`, AsyncStorage
- Used by: `App.tsx`, Navigation, all screens requiring auth state

**Types Layer:**
- Purpose: Single source of truth for TypeScript interfaces mirroring backend Pydantic schemas
- Location: `frontend/src/types/api.ts`
- Contains: `User`, `FinanceSource`, `Transaction`, `AuthResponse`, request/response types
- Used by: All API modules and screens

## Data Flow

**Authentication Flow:**

1. `App.tsx` mounts `QueryClientProvider` → `AuthProvider` → `AppContent`
2. `AuthProvider` runs `loadUser()` on mount — reads token from AsyncStorage, calls `GET /api/v1/auth/me`
3. If valid, populates `user` state; `isAuthenticated` becomes `true`
4. `Navigation` component reads `isAuthenticated` and renders either auth tabs or `HomeScreen`
5. On login: `AuthContext.login()` → `POST /api/v1/auth/login` → stores JWT in AsyncStorage → fetches user profile
6. On 401 response: axios interceptor in `client.ts` clears AsyncStorage tokens automatically

**Authenticated Data Flow (example: Transactions):**

1. Screen mounts, calls `useQuery({ queryKey: [QUERY_KEYS.TRANSACTIONS], queryFn: getTransactions })`
2. `transactionsApi.getTransactions()` calls `apiClient.get('/transactions')`
3. Axios request interceptor reads JWT from AsyncStorage and sets `Authorization: Bearer <token>`
4. FastAPI receives request → `get_current_user` dependency decodes JWT → returns `User` ORM object
5. Route handler queries DB via SQLAlchemy session (`Depends(get_db)`)
6. Response serialized through Pydantic `TransactionResponse` schema → JSON
7. TanStack Query caches result with 5-minute stale time; mutations call `queryClient.invalidateQueries()` to refresh

**In-App Navigation Flow:**

1. `HomeScreen` owns a `currentView` state (`HomeView` union type)
2. Navigation between sub-screens is done by switching `currentView` — no router library used
3. Sub-screens receive callback props (`onBackPress`, `onSuccess`, `onCancel`) to trigger view changes
4. `HomeScreen` manages selected item state (`selectedSource`, `selectedTransaction`) for edit flows

**State Management:**
- Auth state: React Context (`AuthContext`) — persisted to AsyncStorage
- Server state: TanStack Query with 5-minute `staleTime`, 10-minute `gcTime`
- Navigation state: Local `useState` in `HomeScreen` (`currentView`)
- No Redux or Zustand; no global UI state outside auth

## Key Abstractions

**`get_current_user` FastAPI Dependency:**
- Purpose: Extracts and validates JWT, fetches the `User` ORM object, makes it available to route handlers
- File: `backend/app/core/security.py`
- Pattern: FastAPI `Depends()` — injected into every protected route as `current_user: User = Depends(get_current_user)`

**`get_db` FastAPI Dependency:**
- Purpose: Yields a SQLAlchemy session per request with guaranteed cleanup
- File: `backend/app/core/database.py`
- Pattern: Generator-based dependency; session closed in `finally` block

**`apiClient` Axios Instance:**
- Purpose: Pre-configured HTTP client with JWT injection and 401 auto-logout
- File: `frontend/src/api/client.ts`
- Pattern: Single shared instance; request interceptor reads AsyncStorage for token

**`AuthContext` / `useAuth` Hook:**
- Purpose: Provides auth state and actions across the entire app
- File: `frontend/src/store/AuthContext.tsx`
- Pattern: React Context + custom hook; wraps the entire app in `App.tsx`

**`queryClient`:**
- Purpose: TanStack Query cache configuration shared across all `useQuery`/`useMutation` calls
- File: `frontend/src/utils/queryClient.ts`
- Pattern: Singleton created outside React tree and passed to `QueryClientProvider`

**Pydantic Schemas ↔ TypeScript Types Contract:**
- Purpose: Backend schemas define API shape; frontend types must match manually
- Backend: `backend/app/schemas/transaction.py` → `TransactionCreate`, `TransactionResponse`
- Frontend: `frontend/src/types/api.ts` → `TransactionCreate`, `Transaction`

## Entry Points

**Backend:**
- Location: `backend/app/main.py`
- Triggers: Uvicorn ASGI server (`uvicorn app.main:app`)
- Responsibilities: Creates FastAPI app instance, attaches CORS middleware, registers all routers under `/api/v1`

**Frontend:**
- Location: `frontend/App.tsx`
- Triggers: Expo runtime (`expo start`)
- Responsibilities: Mounts global providers (`QueryClientProvider`, `AuthProvider`), renders `AppContent` which renders `Navigation`

**Database Migrations:**
- Location: `backend/migrations/versions/`
- Triggers: `alembic upgrade head`
- Key migrations: Initial schema, rename accounts→finance_sources, add `default_source_id` to users, add `transfer_pair_id` to transactions

## Error Handling

**Strategy:** Errors bubble up to the caller; no global error boundary on frontend.

**Patterns:**
- Backend: `HTTPException` raised in route handlers with appropriate HTTP status codes; 404 for missing resources, 400 for validation, 401 for auth failures
- Backend service layer: `httpx.HTTPError` → converted to `HTTP_503_SERVICE_UNAVAILABLE`; retried up to 3 times via `tenacity` with exponential backoff
- Frontend API: Axios response interceptor normalizes error shape — extracts `detail` field from FastAPI errors, creates `new Error(message)` for uniform handling
- Frontend screens: `try/catch` in mutations; errors displayed via `Alert.alert()` (native) or `window.alert()` (web)
- 401 auto-clear: Axios interceptor removes tokens from AsyncStorage on 401, triggering re-auth via `AuthContext`

## Cross-Cutting Concerns

**Logging:** `console.error()` for errors in frontend; SQLAlchemy query logging enabled when `DEBUG=True` in backend
**Validation:** Pydantic schemas on backend; no client-side schema validation library (forms use local state)
**Authentication:** JWT Bearer tokens; `get_current_user` dependency enforced on all non-public routes; owner-check pattern on every data access (`Transaction.user_id == current_user.id`)
**Currency:** ISO 4217 codes normalized to uppercase at write time; all amounts stored as `Numeric(18, 4)`
**CORS:** Configured in `backend/app/main.py`; allowed origins loaded from `ALLOWED_ORIGINS` env var (comma-separated)

---

*Architecture analysis: 2026-04-05*
