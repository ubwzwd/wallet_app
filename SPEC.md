# Wallet App — Product Spec + Engineering Spec

Version: 1.0
Date: 2026-04-27
Owner: Wallet App Dev
Status: M1 Shipped (2026-04-20) — living document

## 1. Product Spec

### 1.1 Overview

- Cross-platform bookkeeping app. Phase 1 targets Web (PWA) and Android, later iOS and Windows.
- Multi-account (including credit cards), multi-currency, per-day FX conversion to user base currency.
- Later milestones add OCR/LLM ingestion, charts with tags, and LLM insights.

### 1.2 Goals

- Log expenses/incomes across accounts/credit cards quickly.
- Persist original amount and currency; display in user base currency using transaction-day rate.
- Reliable sync, privacy-first, smooth mobile/web UX.
- AI-assisted ingestion and insights in later milestones.

### 1.3 Non-Goals (MVP)

- Budgeting/envelope planning.
- Bank aggregation integrations.
- Team/workspace sharing.

### 1.4 Personas

- Individual tracking daily spend across currencies (e.g., frequent traveler).
- Power user needing high-level categories/tags and trends.

### 1.5 Milestones

- **M1 Web Core (Shipped 2026-04-20)**: Auth, finance sources, transactions (multi-currency), real-time FX conversion, tags, filters, transfers.
- M2 Android: Same as M1, mobile UX polish, internal test build.
- M3 LLM Auto-Book: Upload photo/PDF → synchronous OCR + LLM parse → user confirms/edits → insert (no file storage).
- M4 Charts & Tags: Manual tags + LLM auto-categorization; monthly/weekly/yearly charts.
- M5 LLM Insights: Habit analysis, suggestions, anomaly detection.
- M6 iOS & Windows: iOS via EAS; Windows via PWA (optional Electron wrapper).

### 1.6 MVP Scope (M1) — Implemented

- R1 Auth: Email + password, JWT session; per-user data isolation. ✅
- R2 Finance Sources: Create/list/update/archive; type (checking/savings/credit/other); default currency. ✅
- R3 Transactions: Create/list/edit/delete; amount, currency, source, occurred_at, description, merchant, tags[]. ✅
- R4 Currency: User base_currency; on-the-fly conversion via real-time rates. ✅
- R5 Rates: Real-time fetch from Frankfurter API (ECB data); no local persistence; retry with exponential backoff. ✅
- R6 Filters: By source, date range, tag; pagination (limit/offset). ✅
- R7 Web PWA: Mobile-friendly layout via Expo Web (React Native Web). ✅
- R8 Security: bcrypt password hashing; JWT HS256 (30-min expiry); per-user row scoping. ✅
- R9 Transfers: Paired transactions linked via `transfer_pair_id`; coordinated deletion. ✅
- R10 User profile: Editable base currency and default finance source. ✅

### 1.7 Tagging & Categories

- Tags are free-form, normalized to lowercase server-side.
- Recommended high-level mapping: Clothing, Food, Housing, Transport, Entertainment, Healthcare, Education, Utilities, Travel, Other.
- Reserved tag: `transfer` (auto-applied to paired transfer transactions).
- Later LLM auto-tagging suggests a primary tag; user can override.

### 1.8 Currency & Conversion Policy

- Store original amount and currency for every transaction.
- Display in base currency using **latest available rate** at query time (M1 implementation).
  - *Future*: switch to occurred_at-day rate when historical rate caching is added.
- If `tx.currency == user.base_currency`, conversion fields are `null` (no conversion needed).
- If Frankfurter API is unreachable, conversion fields gracefully degrade to `null` — endpoint still returns 200 with original amounts. (Decision D-04, D-06)
- Changing base_currency affects display only; stored values remain unchanged.

### 1.9 Success Metrics

- T1 Time-to-first-transaction < 3 minutes for a new user.
- T2 Transaction creation p95 < 400 ms server-side.
- T3 Daily rate coverage ≥ 99% for major currencies.
- T4 Post-M2 retention: weekly logged transactions trend upward.

### 1.10 Risks & Mitigations

- FX source downtime → tenacity retry (3 attempts, exponential backoff); graceful fallback to null conversion.
- OCR variability → human-in-the-loop confirmation flow, quick inline edits.
- PWA offline complexity → scope to read cache initially, write-through later.

---

## 2. Engineering Spec

### 2.1 Tech Stack (Implemented)

#### Backend (Python 3.11+, Poetry)

- Web framework: FastAPI 0.x
- ORM: SQLAlchemy 2.0
- Migrations: Alembic
- Validation: Pydantic v2 + pydantic-settings
- Database: PostgreSQL 15+ (production), SQLite (`wallet_dev.db`, local dev fallback)
- Auth: `bcrypt` (password hashing), `python-jose[cryptography]` (JWT HS256)
- HTTP client: `httpx` (FX provider calls)
- Resilience: `tenacity` (retry with exponential backoff)
- Email validation: `email-validator` (via Pydantic `EmailStr`)
- Container: Docker + docker-compose (local Postgres)

#### Frontend (TypeScript, Node)

- Framework: Expo SDK 54 (React Native 0.81 + React Native Web 0.21)
- React: 19.1
- Navigation: `@react-navigation/native` + `native-stack`
- Data fetching: `@tanstack/react-query` 5.x
- HTTP: `axios`
- Forms: `react-hook-form` + `@hookform/resolvers` + `zod`
- Styling: NativeWind 4 (Tailwind 3 for RN)
- Storage: `@react-native-async-storage/async-storage` (JWT persistence)
- Animation: `react-native-reanimated`, `react-native-gesture-handler`

#### External services

- Exchange rates: `api.frankfurter.app` (ECB data, no API key, 31 currencies)

### 2.2 Repository Structure (Actual)

```text
wallet_app/
├── README.md
├── SPEC.md
├── backend/
│   ├── Dockerfile
│   ├── docker-compose.yml             # local Postgres
│   ├── pyproject.toml                 # Poetry deps
│   ├── alembic.ini
│   ├── env.example
│   ├── app/
│   │   ├── main.py                    # FastAPI entry, CORS, router mounting
│   │   ├── api/                       # routers
│   │   │   ├── auth.py                # /auth/register, /login, /me
│   │   │   ├── finance_sources.py     # /finance-sources/*
│   │   │   ├── transactions.py        # /transactions/*
│   │   │   └── rates.py               # /rates/*
│   │   ├── core/
│   │   │   ├── config.py              # Pydantic Settings
│   │   │   ├── database.py            # SQLAlchemy session + Base
│   │   │   └── security.py            # bcrypt, JWT, get_current_user
│   │   ├── models/                    # SQLAlchemy ORM
│   │   │   ├── user.py
│   │   │   ├── finance_source.py
│   │   │   ├── transaction.py
│   │   │   └── transaction_tag.py
│   │   ├── schemas/                   # Pydantic request/response models
│   │   │   ├── user.py
│   │   │   ├── finance_source.py
│   │   │   ├── transaction.py
│   │   │   └── currency.py
│   │   └── services/
│   │       └── rates.py               # Frankfurter client + conversion
│   ├── migrations/                    # Alembic
│   │   └── versions/
│   └── tests/
└── frontend/
    ├── App.tsx                        # root navigator
    ├── package.json
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── app.json                       # Expo config
    ├── src/
    │   ├── api/                       # axios clients per resource
    │   │   ├── client.ts              # axios instance + auth interceptor
    │   │   ├── auth.ts
    │   │   ├── financeSources.ts
    │   │   ├── transactions.ts
    │   │   └── rates.ts
    │   ├── components/                # Button, Card, Input, Navigation, Screen
    │   ├── constants/config.ts        # API base URL, etc.
    │   ├── screens/
    │   │   ├── LoginScreen.tsx
    │   │   ├── RegisterScreen.tsx
    │   │   ├── HomeScreen.tsx
    │   │   ├── ProfileScreen.tsx
    │   │   ├── FinanceSourcesScreen.tsx
    │   │   ├── FinanceSourceFormScreen.tsx
    │   │   ├── TransactionsScreen.tsx
    │   │   └── TransactionFormScreen.tsx
    │   ├── store/
    │   │   └── AuthContext.tsx        # JWT state + AsyncStorage
    │   ├── types/api.ts               # shared API types
    │   └── utils/queryClient.ts       # TanStack Query config
    └── __tests__/
```

### 2.3 Database Schema (Source of Truth: Alembic Migrations)

Engine: PostgreSQL 15+ (also runs on SQLite for dev). All UUIDs are `uuid_generate_v4()` server-side or `uuid.uuid4()` ORM-side.

#### 2.3.1 Table: `users`

| Column              | Type           | Constraints                                      | Notes                                  |
|---------------------|----------------|--------------------------------------------------|----------------------------------------|
| `id`                | `uuid`         | PK                                               | Generated client-side via `uuid.uuid4` |
| `email`             | `text`         | NOT NULL, UNIQUE                                 | Normalized lowercase by Pydantic       |
| `password_hash`     | `text`         | NOT NULL                                         | bcrypt hash                            |
| `base_currency`     | `varchar(3)`   | NOT NULL, DEFAULT `'USD'`                        | ISO 4217, uppercase                    |
| `default_source_id` | `uuid`         | NULL, FK → `finance_sources(id)` ON DELETE SET NULL | User's default payment source       |
| `created_at`        | `timestamp`    | NOT NULL, DEFAULT now()                          |                                        |

**Indices:**

- `ix_users_email` on `(email)` — UNIQUE; supports login lookup

#### 2.3.2 Table: `finance_sources`

| Column              | Type          | Constraints                       | Notes                                   |
|---------------------|---------------|-----------------------------------|-----------------------------------------|
| `id`                | `uuid`        | PK                                |                                         |
| `user_id`           | `uuid`        | NOT NULL, FK → `users(id)`        | Owner                                   |
| `name`              | `text`        | NOT NULL                          | e.g. "Chase Checking"                   |
| `type`              | `varchar(32)` | NOT NULL                          | Domain values: `checking`, `savings`, `credit`, `other` |
| `default_currency`  | `varchar(3)`  | NOT NULL                          | ISO 4217, uppercase                     |
| `archived`          | `boolean`     | NOT NULL, DEFAULT `false`         | Soft-delete                             |
| `created_at`        | `timestamp`   | NOT NULL, DEFAULT now()           |                                         |

**Indices:**

- `ix_finance_sources_user_id` on `(user_id)` — supports per-user listing

**Notes:**

- Renamed from `accounts` in migration `026ee0aecb66`.
- Column renamed from `currency` to `default_currency` in `d671e51094c8`.

#### 2.3.3 Table: `transactions`

| Column              | Type            | Constraints                              | Notes                                       |
|---------------------|-----------------|------------------------------------------|---------------------------------------------|
| `id`                | `uuid`          | PK                                       |                                             |
| `user_id`           | `uuid`          | NOT NULL, FK → `users(id)`               | Owner                                       |
| `source_id`         | `uuid`          | NOT NULL, FK → `finance_sources(id)`     | Where money flowed in/out                   |
| `amount`            | `numeric(18,4)` | NOT NULL                                 | `> 0` income, `< 0` expense                 |
| `currency`          | `varchar(3)`    | NOT NULL                                 | ISO 4217, uppercase                         |
| `occurred_at`       | `date`          | NOT NULL                                 | Transaction date (no time component)        |
| `description`       | `text`          | NULL                                     | Max 500 chars (enforced at API layer)       |
| `merchant`          | `text`          | NULL                                     | Max 200 chars (enforced at API layer)       |
| `transfer_pair_id`  | `uuid`          | NULL                                     | Links paired transfer rows; not a FK        |
| `created_at`        | `timestamp`     | NOT NULL, DEFAULT now()                  |                                             |

**Indices:**

- `ix_transactions_user_id` on `(user_id)` — per-user list
- `ix_transactions_source_id` on `(source_id)` — filter by source
- `ix_transactions_occurred_at` on `(occurred_at)` — date-range filter, sort
- `idx_transactions_transfer_pair` on `(transfer_pair_id)` — fast paired-deletion lookup

**Notes:**

- `transfer_pair_id` added in migration `8a4f4d66d893`. Both rows of a transfer share the same UUID. Deleting either row deletes all rows with that pair id (scoped to the same user).
- Column renamed from `account_id` to `source_id` in `026ee0aecb66`.

#### 2.3.4 Table: `transaction_tags`

| Column           | Type          | Constraints                                       | Notes                                  |
|------------------|---------------|---------------------------------------------------|----------------------------------------|
| `transaction_id` | `uuid`        | NOT NULL, FK → `transactions(id)` ON DELETE CASCADE |                                      |
| `tag`            | `varchar(64)` | NOT NULL                                          | Lowercased server-side                 |

**Constraints:**

- Composite PRIMARY KEY `(transaction_id, tag)` — implicit unique; prevents duplicate tags

**Cascades:**

- Deleting a transaction cascades and removes its tags.

#### 2.3.5 Migration History

| Revision        | Description                                                     |
|-----------------|-----------------------------------------------------------------|
| `e533c88884b7`  | Initial schema: users, accounts, transactions, tags, exchange_rates |
| `026ee0aecb66`  | Rename `accounts` → `finance_sources`; `account_id` → `source_id` |
| `d671e51094c8`  | Rename `accounts.currency` → `default_currency`                 |
| `5ca7fe6e37db`  | Drop `exchange_rates` table — switched to real-time API         |
| `76227e076393`  | Add `users.default_source_id` (FK with ON DELETE SET NULL)      |
| `8a4f4d66d893`  | Add `transactions.transfer_pair_id` + index                     |

### 2.4 ORM Relationships (SQLAlchemy)

```text
User
 ├─ finance_sources : List[FinanceSource]   (one-to-many, cascade delete-orphan, FK=FinanceSource.user_id)
 ├─ default_source  : FinanceSource | None  (uselist=False, FK=User.default_source_id)
 └─ transactions    : List[Transaction]     (one-to-many, cascade delete-orphan)

FinanceSource
 ├─ user            : User
 └─ transactions    : List[Transaction]     (one-to-many, cascade delete-orphan)

Transaction
 ├─ user            : User
 ├─ source          : FinanceSource
 └─ tags            : List[TransactionTag]  (one-to-many, cascade delete-orphan)

TransactionTag
 └─ transaction     : Transaction
```

Note: `User.finance_sources` and `User.default_source` both reference `FinanceSource`; the `foreign_keys` arg disambiguates which FK each relationship uses.

### 2.5 API Surface — All routes mounted under `/api/v1`

#### 2.5.1 Auth

| Method | Path             | Auth | Body                                                       | Response                                  |
|--------|------------------|------|------------------------------------------------------------|-------------------------------------------|
| POST   | `/auth/register` | No   | `{ email, password (≥8), base_currency (3 chars) }`        | `201 { access_token, token_type }`        |
| POST   | `/auth/login`    | No   | `{ email, password }`                                      | `200 { access_token, token_type }`        |
| GET    | `/auth/me`       | Yes  | —                                                          | `UserResponse`                            |
| PATCH  | `/auth/me`       | Yes  | `{ base_currency?, default_source_id? }`                   | `UserResponse`                            |

`UserResponse`: `{ id, email, base_currency, default_source_id, created_at }`

Error cases:

- Duplicate email on register → `400`
- Bad credentials → `401` with `WWW-Authenticate: Bearer`
- `default_source_id` not owned by user → `404`

#### 2.5.2 Finance Sources

| Method | Path                       | Auth | Body / Query                                | Response                          |
|--------|----------------------------|------|---------------------------------------------|-----------------------------------|
| POST   | `/finance-sources`         | Yes  | `{ name, type, default_currency }`          | `201 FinanceSourceResponse`       |
| GET    | `/finance-sources`         | Yes  | `?include_archived=false`                   | `List[FinanceSourceResponse]`     |
| GET    | `/finance-sources/{id}`    | Yes  | —                                           | `FinanceSourceResponse`           |
| PATCH  | `/finance-sources/{id}`    | Yes  | `{ name?, archived? }`                      | `FinanceSourceResponse`           |

Side-effect: when a user's first finance source is created, `users.default_source_id` is auto-set to it (PROF-03 / D-09).

`FinanceSourceResponse`: `{ id, user_id, name, type, default_currency, archived, created_at }`

#### 2.5.3 Transactions

| Method | Path                    | Auth | Body / Query                                                                    | Response                              |
|--------|-------------------------|------|---------------------------------------------------------------------------------|---------------------------------------|
| POST   | `/transactions`         | Yes  | `{ source_id?, amount, currency, occurred_at, description?, merchant?, tags?[], transfer_pair_id? }` | `201 TransactionResponse`             |
| GET    | `/transactions`         | Yes  | `?source_id&from_date&to_date&tag&limit=50&offset=0` (limit capped at 100)      | `List[TransactionResponse]`           |
| GET    | `/transactions/{id}`    | Yes  | —                                                                               | `TransactionResponse`                 |
| PATCH  | `/transactions/{id}`    | Yes  | `{ amount?, currency?, occurred_at?, description?, merchant?, tags? }`          | `TransactionResponse`                 |
| DELETE | `/transactions/{id}`    | Yes  | —                                                                               | `{ deleted_count, message }`          |

`TransactionResponse`:

```text
{
  id, user_id, source_id,
  amount, currency, occurred_at,
  description, merchant,
  transfer_pair_id, created_at,
  tags: string[],
  converted_amount: decimal | null,
  conversion_rate:  decimal | null,
  conversion_date:  date    | null
}
```

Behavior:

- If `source_id` omitted on create, falls back to `user.default_source_id`. If neither exists → `400`.
- Source must be owned by the caller; otherwise `404`.
- `tags` are normalized: trimmed and lowercased.
- PATCH `tags`: replaces all existing tags atomically (delete + re-insert).
- Transfer deletion: deleting any row with a `transfer_pair_id` deletes ALL rows sharing that pair id (scoped to caller). Response includes `deleted_count` (1 for regular, 2+ for transfers).
- List ordering: `ORDER BY occurred_at DESC, created_at DESC`.

#### 2.5.4 Currency & Rates

| Method | Path                | Auth | Query / Body                                              | Response                                           |
|--------|---------------------|------|-----------------------------------------------------------|----------------------------------------------------|
| GET    | `/rates/currencies` | No   | —                                                         | `{ currencies: { CODE: name, ... } }` (31 entries) |
| GET    | `/rates/latest`     | No   | `?base=USD&symbols=EUR,GBP,CNY`                           | `{ base, date, rates: { CODE: rate } }`            |
| POST   | `/rates/convert`    | No   | `{ amount, from_currency, to_currency }`                  | `{ amount, from_currency, to_currency, converted_amount, rate, date }` |

Notes: supported-currencies list is cached in memory after first fetch (`_SUPPORTED_CURRENCIES_CACHE`).

#### 2.5.5 Health

| Method | Path     | Response                                  |
|--------|----------|-------------------------------------------|
| GET    | `/`      | `{ message, version, docs, health }`      |
| GET    | `/health`| `{ status, environment, version }`        |

OpenAPI docs: `GET /docs` (Swagger UI), `GET /redoc`.

### 2.6 Currency Conversion Logic (Server)

**Single-transaction path** (POST/GET-by-id/PATCH `/transactions/*`)

1. If `tx.currency == user.base_currency` → return `null` for all conversion fields. (D-03)
2. Else call `convert_amount(amount, FROM=tx.currency, TO=base_currency)` and `fetch_latest_rates(tx.currency, [base_currency])` from Frankfurter.
3. On `HTTPException` (Frankfurter unavailable) → return `null` for conversion fields, do NOT propagate `503`. (D-04)

**List path** (GET `/transactions`) — batched

1. Collect unique `tx.currency` values that differ from `base_currency`.
2. Single Frankfurter call: `fetch_latest_rates(FROM=base_currency, TO=[unique_currencies])`. (D-05)
3. Returned rate semantics: `1 base = rate tx_currency`. To convert: `converted = tx.amount / rate`.
4. Inverse rate stored on response: `conversion_rate = 1 / rate`, quantized to 6 decimal places.
5. Converted amount quantized to 4 decimal places.
6. Frankfurter unreachable → all conversions `null` for the request. (D-06)

**Retry policy** (`tenacity`, applied to `get_supported_currencies` and `fetch_latest_rates`):

- 3 attempts total.
- Exponential backoff: multiplier=1, min=1s, max=10s → ~1s, 2s, 4s.
- Retries only on `httpx.HTTPError`.
- Final failure raises `HTTPException(503)`.

### 2.7 Security

- **Password hashing**: `bcrypt` with per-password salt (`bcrypt.gensalt()`).
- **JWT**: HS256, secret from `SECRET_KEY` env var. Claims: `sub` (user id as string), `iat`, `exp`. Default expiry: **30 minutes** (`ACCESS_TOKEN_EXPIRE_MINUTES`).
- **Refresh strategy**: simple re-login (no refresh tokens in M1).
- **Bearer auth**: `HTTPBearer` security scheme; token in `Authorization: Bearer <jwt>`.
- **Per-user row scoping**: every protected query joins on `user_id = current_user.id`. Cross-user access returns `404`, never `403` (avoids existence leak).
- **CORS**: configured via `ALLOWED_ORIGINS` env var (comma-separated). Defaults to `http://localhost:8081, :19006, :3000`.
- **Rate limiting**: not yet implemented — planned for production deployment via gateway/middleware.

### 2.8 FX Rate Strategy

- Provider: **api.frankfurter.app** (ECB official rates).
- 31 currencies (USD, EUR, GBP, CNY, JPY, SGD, HKD, ...).
- No persistent storage of rates (the original `exchange_rates` table was dropped in migration `5ca7fe6e37db`).
- Currency list cached in process memory (warmed on first request).
- Optional future: short-lived in-memory cache (5–15 min TTL) for `/latest` responses to reduce upstream calls.
- No API key, no published rate limits for reasonable usage.

### 2.9 Frontend Architecture (M1)

#### 2.9.1 Provider Tree

`App.tsx` wraps the app in two providers, in this order:

```text
QueryClientProvider (TanStack Query)
  └─ AuthProvider (custom React Context)
       └─ AppContent
            ├─ (isLoading) → loading spinner
            └─ Navigation
```

#### 2.9.2 Navigation (Custom, NOT React Navigation)

Despite `@react-navigation/*` being in `package.json`, the app does **not** use it. Navigation is a custom hand-rolled router via local component state:

- [src/components/Navigation.tsx](frontend/src/components/Navigation.tsx) — top-level switch:
  - `isAuthenticated === false` → tab UI between `LoginScreen` / `RegisterScreen`.
  - `isAuthenticated === true` → renders `HomeScreen`.
- [src/screens/HomeScreen.tsx](frontend/src/screens/HomeScreen.tsx) — acts as the inner router using `useState<HomeView>` with eight discriminated states:
  - `'main'`, `'finance-sources'`, `'add-source'`, `'edit-source'`, `'transactions'`, `'add-transaction'`, `'edit-transaction'`, `'profile'`.
  - Selected entity (e.g., source/transaction being edited) held in sibling state and passed as props.
  - Sub-screens receive `onSuccess` / `onCancel` / `onBackPress` callbacks; no URL routing, no deep-linking, no browser history.

**Implication**: refresh on web returns to `'main'` view; back button is unavailable. This is a known M1 limitation; consider adopting React Navigation in a later phase.

#### 2.9.3 Auth State (`AuthContext`)

[src/store/AuthContext.tsx](frontend/src/store/AuthContext.tsx) exposes:

```ts
{
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean      // !!user
  login(creds): Promise<void>
  register(data): Promise<void>
  logout(): Promise<void>
  refreshUser(): Promise<void>
}
```

Lifecycle:

1. On mount, `loadUser()` reads JWT from `AsyncStorage` (`@wallet_app:auth_token`).
2. If present, calls `GET /auth/me` to validate and hydrate `user`.
3. On any failure during hydration, JWT is cleared and `user = null`.
4. `login`/`register` call API → store token via `setAuthToken` → fetch `/auth/me` → cache user JSON to `@wallet_app:user_data`.
5. `logout` calls `clearAuthToken` (removes both keys) and clears in-memory user.

Storage keys (from [src/constants/config.ts](frontend/src/constants/config.ts)):

- `@wallet_app:auth_token`
- `@wallet_app:user_data`

#### 2.9.4 HTTP Layer (`apiClient`)

[src/api/client.ts](frontend/src/api/client.ts) — single `axios` instance.

- Base URL: `__DEV__` ? `http://localhost:8000/api/v1` : `https://api.yourapp.com/api/v1` (placeholder; needs update before production).
- Timeout: 10s.
- **Request interceptor**: reads JWT from `AsyncStorage` on every request; injects `Authorization: Bearer <token>`.
- **Response interceptor**:
  - `401` on most endpoints → clears token + user data, signals logout.
  - `401` on **GET `/auth/me` specifically** → does NOT clear token (treated as transient). This prevents flicker-logout right after a successful PATCH. (See lines 50–63 of `client.ts`.)
  - Network errors → `"Network error. Please check your connection."`
  - Other server errors → throws `Error` with `response.data.detail` if present.

Resource clients (one file per backend router):

- `auth.ts`, `financeSources.ts`, `transactions.ts`, `rates.ts` — thin typed wrappers over `apiClient.{get,post,patch,delete}`.

#### 2.9.5 Server State (`TanStack Query`)

[src/utils/queryClient.ts](frontend/src/utils/queryClient.ts):

```ts
{
  queries: {
    retry: 1,
    staleTime: 5 * 60_000,    // 5 min
    gcTime:    10 * 60_000,   // 10 min
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  },
  mutations: { retry: 0 }
}
```

Query keys (from `constants/config.ts`):

- `'user'`, `'finance_sources'`, `'transactions'`, `'currencies'`, `'exchange_rates'`

Each list/detail screen issues a `useQuery`; mutating screens use `useMutation` and invalidate the relevant key on success.

#### 2.9.6 Screens

| Screen                          | Purpose                                                       |
|---------------------------------|---------------------------------------------------------------|
| `LoginScreen` (151 LOC)         | Email/password login; manual `useState` validation; demo creds shown in footer |
| `RegisterScreen` (220 LOC)      | Email/password/base_currency registration                     |
| `HomeScreen` (253 LOC)          | Inner router + landing page (welcome, account info, quick actions, logout) |
| `ProfileScreen` (351 LOC)       | Edit `base_currency` and `default_source_id`; calls `PATCH /auth/me` |
| `FinanceSourcesScreen` (302)    | List sources (toggle archived); navigate to add/edit          |
| `FinanceSourceFormScreen` (383) | Create/edit source; currency picker; archive toggle           |
| `TransactionsScreen` (414)      | Paginated list, filters (source/date/tag), pull-to-refresh    |
| `TransactionFormScreen` (1019)  | Largest screen — create/edit incl. transfer mode (creates two paired rows with same `transfer_pair_id`); searchable currency picker; tag input |

#### 2.9.7 Form Strategy (NOT react-hook-form)

Despite `react-hook-form` + `zod` + `@hookform/resolvers` being in dependencies, screens use **plain `useState` + hand-rolled validation**. Example pattern (from `LoginScreen`):

```tsx
const [email, setEmail] = useState('');
const [errors, setErrors] = useState<{email?: string; password?: string}>({});

const validate = () => {
  const e: typeof errors = {};
  if (!email) e.email = 'Email is required';
  else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Email is invalid';
  // ...
  setErrors(e);
  return Object.keys(e).length === 0;
};
```

Validation is per-screen and inconsistent (e.g., LoginScreen accepts password ≥6 chars while backend requires ≥8). Migrating to RHF + zod is recommended in a future phase to dedupe and align with backend Pydantic rules.

#### 2.9.8 Styling Strategy (NOT NativeWind in practice)

NativeWind 4 + `tailwind.config.js` are configured, but components use **`StyleSheet.create()` with hardcoded hex colors** throughout. No `className` props are used in any screen or component file. Common palette extracted by inspection:

| Token         | Hex       | Usage                              |
|---------------|-----------|------------------------------------|
| Primary       | `#0ea5e9` | Primary buttons, active tab, links |
| Danger        | `#ef4444` | Destructive buttons, error text    |
| Text strong   | `#1f2937` | Headings, body text                |
| Text muted    | `#6b7280` | Secondary text, labels             |
| Border        | `#e5e7eb` | Card outlines, separators          |
| Surface       | `#ffffff` | Cards, inputs                      |
| Bg            | `#f9fafb` | Screen background                  |

Layout: corners `borderRadius: 8` (buttons), `12` (cards). Spacing on a 4-px grid (8/16/24/32).

A future cleanup phase should either fully adopt NativeWind (and remove `StyleSheet`) or remove unused NativeWind config — current state is a half-migration.

#### 2.9.9 Component Library

[src/components/](frontend/src/components/) — five primitives:

- **`Screen`** ([Screen.tsx](frontend/src/components/Screen.tsx)): `SafeAreaView` + `KeyboardAvoidingView` (iOS=padding, Android=height) + optional `ScrollView`; default 16-px padding.
- **`Card`** ([Card.tsx](frontend/src/components/Card.tsx)): `default | outlined | elevated` variants. `elevated` uses `boxShadow` (web) + `elevation: 3` (Android).
- **`Button`** ([Button.tsx](frontend/src/components/Button.tsx)): `primary | secondary | danger` × `small | medium | large`; `loading` shows `ActivityIndicator`; `disabled` = opacity 0.5.
- **`Input`** ([Input.tsx](frontend/src/components/Input.tsx)): label + error + optional `isPassword` flag.
- **`Navigation`** ([Navigation.tsx](frontend/src/components/Navigation.tsx)): top-level auth-gated router (see §2.9.2).

#### 2.9.10 Numeric Type Handling

Backend returns `Decimal` fields (`amount`, `converted_amount`, `conversion_rate`) as **JSON strings** to preserve precision. Frontend types reflect this:

```ts
interface Transaction {
  amount: string;            // not number!
  converted_amount: string | null;
  conversion_rate:  string | null;
  // ...
}
```

For form input, `TransactionCreate.amount` is typed as `number` — the form serializes `parseFloat`/`Number` on submit. Display must handle string→number formatting (the form/list screens do this locally).

#### 2.9.11 Logout & Confirmation Pattern

Destructive actions use `Alert.alert(...)` with native iOS/Android dialogs (HomeScreen logout, transaction/source delete confirmations). On Web, this falls back to the browser confirm dialog via React Native Web.

#### 2.9.12 Path Aliases

[tsconfig.json](frontend/tsconfig.json) + [babel.config.js](frontend/babel.config.js) define `@/*` → `src/*` via `babel-plugin-module-resolver`. All internal imports use `@/...`.

#### 2.9.13 Known Frontend Tech Debt

1. **Custom navigation** — adopt React Navigation for proper stack history, deep-linking, web URL support.
2. **No form library in use** — migrate to RHF + zod (already installed) for consistent validation aligned with backend.
3. **Half-finished NativeWind migration** — pick one styling approach and remove the other.
4. **HomeScreen as router** — split routing concerns out of the screen (~250 LOC of view switching).
5. **TransactionFormScreen at 1019 LOC** — split into smaller composable components (transfer mode, currency picker, tag input).
6. **Production API URL placeholder** — `https://api.yourapp.com/api/v1` in `config.ts` must be replaced before deploy.

### 2.10 Configuration & Environment

Backend env vars (see [backend/env.example](backend/env.example)):

| Variable                      | Default                                               | Notes                              |
|-------------------------------|-------------------------------------------------------|------------------------------------|
| `DATABASE_URL`                | `postgresql://wallet_user:wallet_password@localhost:5432/wallet_db` | SQLAlchemy URL          |
| `SECRET_KEY`                  | `your-secret-key-change-this-in-production`           | **Must change** in production      |
| `ALGORITHM`                   | `HS256`                                               | JWT signing                        |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30`                                                  |                                    |
| `API_V1_PREFIX`               | `/api/v1`                                             |                                    |
| `PROJECT_NAME`                | `Wallet App API`                                      |                                    |
| `DEBUG`                       | `false`                                               |                                    |
| `ALLOWED_ORIGINS`             | `http://localhost:8081,...:19006,...:3000`            | CSV                                |
| `EXCHANGE_RATE_API_URL`       | `https://api.frankfurter.app`                         |                                    |
| `ENVIRONMENT`                 | `development`                                         |                                    |

### 2.11 Local Development

```bash
# Backend
cd backend
docker compose up -d                      # starts Postgres
poetry install
poetry run alembic upgrade head           # apply migrations
poetry run uvicorn app.main:app --reload  # http://localhost:8000

# Frontend
cd frontend
npm install
npm run web                               # Expo Web on http://localhost:8081
```

OpenAPI UI: <http://localhost:8000/docs>

### 2.12 AWS Deployment Architecture (Planned)

#### Production Topology

- **Backend API**: ECS Fargate
  - Docker images built locally or via CI/CD; pushed to ECR.
  - ECS Task Definition references ECR image; auto-scaling on CPU/memory.
  - Application Load Balancer for HTTPS.
- **Database**: RDS PostgreSQL — managed, automated backups, security group restricts to ECS tasks; SQLAlchemy connection pooling.
- **Frontend (Web)**: Expo Web build (`npx expo export:web`) → S3 + CloudFront with ACM SSL; cache invalidation on deploy.
- **Secrets**: AWS Secrets Manager / Parameter Store (DB creds, JWT key, future LLM keys).
- **CI/CD**: GitHub Actions or CodePipeline — Docker build → ECR push → ECS task update; frontend → S3 sync → CloudFront invalidation.

#### Cost Estimate (M1–M2, single user)

- RDS db.t4g.micro: free tier 12mo, then ~$15/mo
- ECS Fargate (0.25 vCPU, 0.5 GB RAM): ~$10–15/mo
- S3 + CloudFront: ~$1–5/mo
- **Total**: ~$20–35/mo post-free-tier

### 2.13 Acceptance (M1 — Met)

- [x] Multi-user isolation verified (per-user `user_id` filter on every query).
- [x] Create finance source with chosen currency; add transactions in any of 31 currencies.
- [x] List/detail views show converted amount in user's `base_currency`.
- [x] Changing `base_currency` updates displayed totals via real-time rates.
- [x] Web usable on desktop and mobile browsers (PWA via Expo Web).
- [x] Transfers create paired rows; deleting either removes the pair atomically.
- [x] Frankfurter outage degrades gracefully (conversions null, not 503).

### 2.14 Key Decisions Log

| ID    | Decision                                                                        |
|-------|---------------------------------------------------------------------------------|
| D-01  | Compute conversion fields at query time, not at write time.                     |
| D-03  | When `tx.currency == base_currency`, return `null` conversion fields (not echo). |
| D-04  | Frankfurter failure on single-tx endpoints → graceful null fallback, never 503. |
| D-05  | List endpoint batches all unique currencies into one Frankfurter call.          |
| D-06  | List endpoint failure of Frankfurter → all rows return null conversions, 200 OK. |
| D-07  | `PATCH /auth/me` validates `default_source_id` ownership.                       |
| D-08  | `base_currency` normalized to uppercase on write.                               |
| D-09  | First finance source auto-becomes user's `default_source_id`.                   |

### 2.15 Rollout Plan

- M1: Local Docker Postgres → AWS ECS Fargate + RDS + S3/CloudFront. ✅ Ready to deploy.
- M2: Expo EAS for Android internal testing (Closed track).
- M3–M5: Integrate OCR/LLM (synchronous), stats dashboards, LLM insights.
- M6: EAS iOS build; Windows via PWA/Electron if needed.

### 2.16 Open Questions

- Charting library on Web/Expo Web (Victory, Recharts, react-native-svg-based)?
- Default tag set + localization strategy?
- Data export/import format (CSV/JSON)?
- Refresh-token strategy for production (vs. silent re-login)?
- Whether to reintroduce a rate cache table for historical-day-rate conversion (ECB convention).
