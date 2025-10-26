# Wallet App — Product Spec + Engineering Spec

Version: 0.1 (Draft)
Date: 2025-10-26
Owner: You
Status: Draft for MVP (M1–M2)

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
- M1 Web Core: Auth, accounts, transactions (multi-currency), day-rate conversion, tags, filters.
- M2 Android: Same as M1, mobile UX polish, internal test build.
- M3 LLM Auto-Book: Upload photo/PDF → synchronous OCR + LLM parse → user confirms/edits → insert (no file storage).
- M4 Charts & Tags: Manual tags + LLM auto-categorization; monthly/weekly/yearly charts.
- M5 LLM Insights: Habit analysis, suggestions, anomaly detection.
- M6 iOS & Windows: iOS via EAS; Windows via PWA (optional Electron wrapper).

### 1.6 MVP Scope (M1)
- R1 Auth: Email + password, JWT session; per-user data isolation.
- R2 Accounts: Create/list/update/archive; type (checking/credit/other); account currency.
- R3 Transactions: Create/list/edit; amount, currency, account, occurred_at, description, merchant, tags[].
- R4 Currency: User base_currency; display by transaction-day rate.
- R5 Rates: Daily sync from exchangerate.host; cached in DB; on-demand backfill.
- R6 Filters: By account, date range, tag; pagination.
- R7 Web PWA: Mobile-friendly layout; optional basic read cache.
- R8 Security: Password hashing; JWT expiration/refresh; basic rate limiting.

### 1.7 Tagging & Categories
- Tags are free-form, with a recommended high-level mapping: Clothing, Food, Housing, Transport, Entertainment, Healthcare, Education, Utilities, Travel, Other.
- Later LLM auto-tagging suggests a primary tag; user can override.

### 1.8 Currency & Conversion Policy
- Store original amount and currency for every transaction.
- Display in base currency using the exchange rate of occurred_at (UTC date).
- If the exact date rate is missing, fall back to the latest prior available date (ECB convention).
- Changing base_currency affects display only; stored values remain unchanged.

### 1.9 Success Metrics
- T1 Time-to-first-transaction < 3 minutes for a new user.
- T2 Transaction creation p95 < 400 ms server-side.
- T3 Daily rate coverage ≥ 99% for major currencies.
- T4 Post-M2 retention: weekly logged transactions trend upward.

### 1.10 Risks & Mitigations
- FX source downtime → cache last known, retry/backoff, allow user refresh.
- OCR variability → human-in-the-loop confirmation flow, quick inline edits.
- PWA offline complexity → scope to read cache initially, write-through later.

---

## 2. Engineering Spec

### 2.1 Decisions Recap
- Frontend: Expo (React Native + React Native Web) with TypeScript.
- Backend: Python FastAPI.
- Users: Multi-user auth (email+password, JWT). [Chosen: 1a]
- FX Source: Free API with caching; primary = exchangerate.host. [Chosen: 2a]

Notes on FX providers:
- Google/Bing have no official, stable free FX APIs. Scraping/unofficial endpoints are fragile and risky.
- Recommended: exchangerate.host (free, no key, ECB-based, supports history). Alternatives: Frankfurter.app (ECB), OpenExchangeRates (free tier limits apply).

### 2.2 Tech Stack
- Frontend: Expo, TypeScript, NativeWind (Tailwind-like), TanStack Query, Zod.
- Backend: FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, httpx.
- Database: PostgreSQL (local: Docker; production: AWS RDS PostgreSQL).
- LLM (M3+): OpenAI/Gemini via LiteLLM or provider SDK; OCR via Tesseract/PaddleOCR; PDFs via pdfplumber/pypdf.
- OCR/LLM Processing (M3+): Synchronous request/response (user waits for parsing result, no file storage needed).

### 2.3 Repository Structure (proposed)
```
wallet_app/
  SPEC.md
  frontend/               # Expo app (Web + Android)
    app/                  # routes (Expo Router if used)
    src/
    package.json
  backend/
    app/
      api/                # FastAPI routers
      core/               # config, security, dependencies
      models/             # SQLAlchemy models
      schemas/            # Pydantic models
      services/           # rates, llm (M3+), ocr (M3+)
    migrations/           # Alembic migrations
    pyproject.toml
    Dockerfile
    docker-compose.yml    # postgres for local development
  infra/
    env.example
    aws/                  # AWS deployment configs (ECS task definitions, etc.)
```

### 2.4 Data Model (DDL sketch)
```sql
-- users
id uuid pk, email text unique not null, password_hash text not null,
base_currency char(3) not null, created_at timestamptz not null default now()

-- accounts
id uuid pk, user_id uuid not null references users(id), name text not null,
type varchar(32) not null, currency char(3) not null,
archived boolean not null default false, created_at timestamptz not null default now()

-- transactions
id uuid pk, user_id uuid not null references users(id),
account_id uuid not null references accounts(id),
amount numeric(18,4) not null, currency char(3) not null,
occurred_at date not null, description text, merchant text,
created_at timestamptz not null default now()

-- transaction_tags
transaction_id uuid not null references transactions(id) on delete cascade,
tag varchar(64) not null, primary key (transaction_id, tag)

-- exchange_rates (daily snapshot)
id bigserial primary key, source varchar(32) not null,
base char(3) not null, symbol char(3) not null,
rate numeric(18,8) not null, date date not null,
unique (base, symbol, date)
```

### 2.5 API Surface (M1)

Auth
- POST /auth/register { email, password, base_currency }
- POST /auth/login { email, password } → { access_token, token_type }
- GET /auth/me → current user

Currency & Rates
- GET /currencies → supported ISO 4217 list
- GET /rates?date=YYYY-MM-DD → daily rates (from DB)
- POST /rates/refresh → trigger refresh (rate limited)

Accounts
- POST /accounts { name, type, currency }
- GET /accounts
- PATCH /accounts/:id { name?, archived? }

Transactions
- POST /transactions { amount, currency, account_id, occurred_at, description?, merchant?, tags?[] }
- GET /transactions?account_id&from&to&tag&page&size
- GET /transactions/:id
- PATCH /transactions/:id { fields… }

Stats (M4)
- GET /stats/summary?from&to  // totals in base currency
- GET /stats/by-category?from&to
- GET /stats/time-series?granularity=day|week|month&from&to

OCR/LLM (M3)
- POST /ingest/parse-receipt { file: multipart/form-data } → { parsed_transactions: [...] }
  - Synchronously processes uploaded image/PDF
  - Returns structured transaction data for user confirmation
  - File is not persisted (temporary processing only)
- POST /transactions/batch → bulk create confirmed transactions

### 2.6 Conversion Logic (Server)
1) Persist original amount/currency.
2) To display: find daily rate for (base, tx.currency, tx.occurred_at).
3) If missing: backfill nearest prior day; if still missing, use most recent and flag approximation in response.
4) Optional cache: store converted_amount_base at write-time for faster reads.

### 2.7 Security
- Password hashing (bcrypt/argon2), JWT with exp/iat, refresh strategy (simple re-login for MVP).
- Per-user row scoping on all queries.
- Basic rate limiting on auth and refresh endpoints.

### 2.8 FX Sync Strategy
- Cron (e.g., daily 00:30 UTC) to pull latest day rates, insert into exchange_rates.
- On-demand backfill when querying a date with missing rate.
- Source attribution stored in table (`source = exchangerate.host`).

### 2.9 AWS Deployment Architecture

#### Local Development
- Backend: Docker Compose with PostgreSQL container
- Frontend: Expo CLI with local dev server
- Database: PostgreSQL 15+ in Docker

#### Production (AWS)
- **Backend API**: ECS Fargate
  - Docker images built locally or via CI/CD
  - Pushed to ECR (Elastic Container Registry)
  - ECS Task Definition references ECR image
  - Auto-scaling based on CPU/memory
  - Application Load Balancer for HTTPS traffic
  
- **Database**: RDS PostgreSQL
  - Managed PostgreSQL instance
  - Automated backups (point-in-time recovery)
  - Security group restricts access to ECS tasks only
  - Connection pooling via SQLAlchemy
  
- **Frontend (Web)**: S3 + CloudFront
  - Expo Web build output (`npx expo export:web`) uploaded to S3
  - CloudFront CDN for global distribution
  - Custom domain with ACM SSL certificate
  - Cache invalidation on deployment

- **Secrets Management**: AWS Secrets Manager or Parameter Store
  - Database credentials
  - JWT secret keys
  - LLM API keys (M3+)

- **CI/CD Pipeline** (optional, recommended):
  - GitHub Actions or AWS CodePipeline
  - Automated Docker build → ECR push → ECS task update
  - Frontend build → S3 sync → CloudFront invalidation

#### Cost Considerations (M1-M2, single user)
- RDS: db.t4g.micro (free tier eligible for 12 months, then ~$15/month)
- ECS Fargate: 0.25 vCPU, 0.5GB RAM (~$10-15/month for low traffic)
- S3 + CloudFront: ~$1-5/month for low traffic
- **Total estimated**: ~$20-35/month after free tier expires

### 2.10 Frontend (M1–M2) Screens
- Auth (login/register), Accounts (list/create), Transactions (list with filters/pagination, create/edit), Settings (base currency),
- M4: Stats dashboard (category pie, time-series line/bar; tag filters)
- M3: Receipt Upload (upload image/PDF, loading state, review parsed transactions, edit & confirm)

### 2.10 Acceptance (M1)
- Multi-user isolation verified.
- Create account with chosen currency; add transactions in any currency; view list and details.
- Changing base_currency updates displayed totals and details using tx-day rate.
- Web usable on desktop and mobile browsers (PWA). Optional basic offline read cache.

### 2.11 Rollout Plan
- M1: Develop locally (Dockerized Postgres), deploy backend to AWS ECS Fargate, RDS PostgreSQL, frontend to S3+CloudFront.
- M2: Expo EAS for Android internal testing (Closed track), gather feedback.
- M3–M5: Integrate OCR/LLM services (synchronous processing), add stats dashboard, LLM insights.
- M6: EAS iOS build; Windows via PWA/Electron if needed.

### 2.12 Open Questions (track)
- Which charting lib on Web/Expo Web? (e.g., Victory, Recharts for Web, react-native-svg based)
- Which tag set defaults and localization strategy?
- Any data export/import format (CSV/JSON) for power users?


