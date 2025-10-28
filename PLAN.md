# Wallet App - M1 Implementation Plan

Version: 1.1  
Created: 2025-10-26  
Updated: 2025-10-28 (Design clarifications)
Target: M1 Web Core (Auth, Finance Sources, Transactions, Multi-Currency)

---

## Overview

This plan covers the complete implementation of M1 milestone:
- Multi-user authentication (email + password, JWT)
- Finance source management (payment sources: cards, bank accounts, e-wallets)
- Transaction CRUD with tags (positive = income, negative = expense)
- Real-time currency conversion using Frankfurter API (ECB data)
- Web UI (Expo Web)
- Local development with Docker Compose
- AWS deployment ready

### Key Design Decisions
1. **finance_sources** (not "accounts"): Represents payment methods/sources
2. **default_source_id** in users table: Auto-selected for transactions
3. **Positive/negative amounts**: Income (positive) vs Expense (negative)
4. **Transfers**: Two separate transactions with "transfer" tag
5. **Real-time FX rates**: No persistent rate storage, query-time conversion

---

## Phase 1: Backend Foundation

### 1.1 Project Setup & Docker Environment
- [x] Create `backend/` directory structure
- [x] Initialize Python project with `pyproject.toml` (Poetry or pip)
- [x] Setup dependencies:
  - FastAPI, Uvicorn
  - SQLAlchemy 2.0, Alembic
  - Pydantic v2
  - python-jose[cryptography] (JWT)
  - passlib[bcrypt] (password hashing)
  - httpx (for API calls)
  - psycopg2-binary (PostgreSQL driver)
  - python-multipart (file upload support)
- [x] Create `Dockerfile` for FastAPI app
- [x] Create `docker-compose.yml` with PostgreSQL service
- [x] Create `env.example` with required environment variables:
  ```
  DATABASE_URL=postgresql://user:password@localhost:5432/wallet_db
  SECRET_KEY=your-secret-key-here
  ALGORITHM=HS256
  ACCESS_TOKEN_EXPIRE_MINUTES=30
  ```
- [x] Add `.gitignore` for Python (.env, __pycache__, .venv, etc.)
- [x] Test: `docker-compose up` should start PostgreSQL (requires Docker Desktop WSL2 integration)

**Deliverable**: ✅ Working Docker environment with PostgreSQL

---

### 1.2 Database Models & Migrations

- [x] Setup Alembic in `backend/migrations/`
- [x] Create SQLAlchemy base and database session management
- [x] Implement models in `backend/app/models/`:
  - `User` (id, email, password_hash, base_currency, default_source_id, created_at)
  - `FinanceSource` (id, user_id, name, type, default_currency, archived, created_at)
  - `Transaction` (id, user_id, source_id, amount, currency, occurred_at, description, merchant, created_at)
  - `TransactionTag` (transaction_id, tag) - many-to-many
- [x] Create initial migration: `alembic revision --autogenerate -m "Initial schema"`
- [x] Rename accounts → finance_sources: Migration 026ee0aecb66
- [x] Add default_source_id to users: Migration 76227e076393
- [x] Run migrations: `alembic upgrade head`
- [x] Test: PostgreSQL tables created successfully

**Deliverable**: ✅ Database schema with 4 core tables (users, finance_sources, transactions, transaction_tags)

**Note**: Removed `exchange_rates` table - using real-time API calls instead

---

### 1.3 Core Security & Auth

- [x] Create `backend/app/core/security.py`:
  - Password hashing functions (bcrypt)
  - JWT token generation and verification
  - Current user dependency (extract from Bearer token)
- [x] Create `backend/app/core/config.py`:
  - Pydantic Settings for environment variables
  - Database URL, JWT secret, etc.
- [x] Create Pydantic schemas in `backend/app/schemas/`:
  - `UserCreate`, `UserLogin`, `UserResponse`
  - `Token`, `TokenData`
- [x] Implement auth router in `backend/app/api/auth.py`:
  - `POST /auth/register` - create user with hashed password
  - `POST /auth/login` - verify credentials, return JWT
  - `GET /auth/me` - get current user (protected)
- [x] Test auth endpoints with curl/httpie

**Deliverable**: ✅ Working authentication system (tested with register, login, and protected endpoint)

---

### 1.4 Currency & Real-time Exchange Rate Service

- [x] Create `backend/app/services/rates.py`:
  - `fetch_latest_rates(base: str, symbols: list[str])` - call Frankfurter `/latest` API
  - `convert_amount(amount: Decimal, from_currency: str, to_currency: str)` - convert using live rates
  - Currency list caching to reduce API calls
- [x] Create Pydantic schemas:
  - `CurrencyList`, `ExchangeRateResponse`, `ConversionResult`, `ConversionRequest`
- [x] Implement rates router in `backend/app/api/rates.py`:
  - `GET /currencies` - return supported ISO 4217 list (31 currencies from ECB)
  - `GET /rates/latest?base=USD&symbols=EUR,GBP` - real-time rates from Frankfurter
  - `POST /convert` - currency conversion with rate info
- [x] Test: Fetch real-time rates from Frankfurter API
- [x] Verify conversion logic works correctly (tested: 100 USD = 710.75 CNY)

**Deliverable**: ✅ Real-time exchange rate service working (all 3 endpoints tested successfully)

---

### 1.5 Finance Source Management

- [x] Create Pydantic schemas in `backend/app/schemas/finance_source.py`:
  - `FinanceSourceCreate` (name, type, default_currency)
  - `FinanceSourceUpdate` (name?, archived?)
  - `FinanceSourceResponse` (id, user_id, name, type, default_currency, archived, created_at)
- [x] Implement finance_sources router in `backend/app/api/finance_sources.py`:
  - `POST /finance-sources` - create finance source (user-scoped)
  - `GET /finance-sources?include_archived=false` - list user's sources with filter
  - `GET /finance-sources/{id}` - get single source (owner check)
  - `PATCH /finance-sources/{id}` - update source (owner check)
- [x] Add user_id filtering on all queries (security)
- [x] Test: CRUD operations for finance sources
  - Created 3 sources (checking, credit, savings)
  - Updated source name
  - Archived source
  - Verified filtering works

**Deliverable**: ✅ Finance source management endpoints working (all tests passed)

**Implementation Notes**:
- Renamed from "accounts" to "finance_sources" for clarity (payment sources/methods)
- First finance source auto-set as default (can be implemented in Phase 1.6)
- Users can update default via `PATCH /users/me` (future enhancement)

---

### 1.6 Transaction Management

- [x] Create Pydantic schemas in `backend/app/schemas/transaction.py`:
  - `TransactionCreate` (source_id?, amount, currency, occurred_at, description?, merchant?, tags?)
    - `source_id` optional: uses `user.default_source_id` if omitted
    - `amount`: Positive for income, negative for expense
  - `TransactionUpdate` (partial fields)
  - `TransactionResponse` (all fields + converted_amount, conversion_rate, conversion_date)
- [x] Implement transactions router in `backend/app/api/transactions.py`:
  - `POST /transactions` - create transaction with tags
    - Auto-use default_source_id if source_id not provided
    - Validate source belongs to user
    - Support `transfer_pair_id` for linking transfer transactions
  - `GET /transactions` - list with filters (source_id, from/to date, tag, pagination)
  - `GET /transactions/{id}` - get single transaction (owner check)
  - `PATCH /transactions/{id}` - update transaction
  - `DELETE /transactions/{id}` - delete transaction
    - Single transaction: delete 1 record
    - Transfer transaction (has `transfer_pair_id`): delete all paired records
- [x] Implement pagination (offset/limit, max 100)
- [x] Test: CRUD operations
  - Created income transaction (+$5000, positive amount) ✅
  - Created expense transaction (-$50, negative amount) ✅
  - Listed all transactions (2 records, date ordered) ✅
  - Retrieved single transaction ✅
  - Updated transaction (description and tags) ✅
  - Created transfer (2 paired transactions with shared `transfer_pair_id`) ✅
  - Deleted transfer (automatically deleted both paired transactions) ✅
  - Deleted single transaction (only 1 deleted) ✅
- [ ] Add real-time currency conversion logic (TODO for future):
  - Fetch current exchange rate from Frankfurter API
  - Convert `tx.amount` (in `tx.currency`) to `user.base_currency`
  - Return `converted_amount`, `conversion_rate`, `conversion_date` in response

**Deliverable**: ✅ Transaction CRUD complete (currency conversion marked as future enhancement)

**Design Notes**:
- Amount sign determines income/expense (no separate `type` field)
- Transfers = two transactions with "transfer" tag + shared `transfer_pair_id`
  - Deleting one transfer transaction automatically deletes all paired transactions
  - Database has indexed `transfer_pair_id` column for efficient queries
- Tags normalized (lowercase, trimmed)
- Conversion fields present in schema (currently null, to be implemented)
- Default source handling working correctly

---

### 1.7 Main App & API Router

- [x] Create `backend/app/main.py`:
  - Initialize FastAPI app
  - Add CORS middleware (allow localhost for dev)
  - Include all routers (auth, finance_sources, transactions, rates)
  - Add health check endpoint: `GET /health`
  - Add startup event to test DB connection
- [x] Create `backend/app/api/__init__.py` to aggregate routers
- [x] Test: Run locally with `uvicorn app.main:app --reload`
- [x] Verify all endpoints accessible via OpenAPI docs at `/docs`

**Deliverable**: ✅ Complete backend API running locally (auth, finance_sources, rates working)

---

## Phase 2: Frontend Foundation

### 2.1 Expo Project Setup

- [x] Initialize Expo project: `npx create-expo-app@latest frontend --template blank-typescript`
- [x] Install dependencies:
  - NativeWind (Tailwind CSS): `nativewind`, `tailwindcss`
  - React Navigation: `@react-navigation/native`, `@react-navigation/native-stack`
  - TanStack Query: `@tanstack/react-query`
  - Form handling: `react-hook-form`, `@hookform/resolvers`
  - Validation: `zod`
  - HTTP client: `axios`
  - Async Storage: `@react-native-async-storage/async-storage`
- [x] Setup NativeWind:
  - Create `tailwind.config.js`
  - Configure `babel.config.js` for NativeWind
  - Create `app.d.ts` for TypeScript types
- [x] Setup folder structure:
  ```
  frontend/
    src/
      api/          # API client and endpoints
      components/   # Reusable UI components
      screens/      # Page components
      hooks/        # Custom hooks
      store/        # Global state (if needed)
      types/        # TypeScript types
      utils/        # Helpers
      constants/    # Config, colors, etc.
    App.tsx
  ```
- [x] Create configuration files:
  - `src/constants/config.ts` (API URLs, storage keys, query keys)
  - `src/types/api.ts` (TypeScript interfaces for backend API)
  - `frontend/README.md` (development guide)
- [x] Update `App.tsx` with NativeWind test component
- [x] Test: Ready to run with `npm run web`

**Deliverable**: ✅ Expo project with all dependencies installed and configured

---

### 2.2 API Client & Authentication Context

- [x] Create `src/api/client.ts`:
  - Axios instance with base URL
  - Request interceptor to add JWT token from storage
  - Response interceptor for error handling (401 → clear token)
- [x] Create `src/types/api.ts`:
  - TypeScript interfaces for all API responses (User, FinanceSource, Transaction, etc.)
- [x] Create `src/api/auth.ts`:
  - `register(email, password, baseCurrency)`
  - `login(email, password)`
  - `getCurrentUser()`
- [x] Create `src/store/AuthContext.tsx`:
  - Manage user state and token
  - Store token in AsyncStorage
  - Provide login/logout/register functions
  - Auto-load user on app start
- [x] Wrap App in AuthProvider + QueryClientProvider
- [x] Configure path aliases (@/* => src/*)
- [x] Test: Compilation successful (314 modules)

**Deliverable**: ✅ API client with authentication complete

---

### 2.3 UI Components Library

- [x] Create base components in `src/components/`:
  - `Button.tsx` (primary, secondary, danger variants + loading state)
  - `Input.tsx` (text input with label, error, hint, password toggle)
  - `Card.tsx` (default, outlined, elevated variants)
  - `Screen.tsx` (SafeAreaView wrapper with scroll support)
- [x] Use StyleSheet for styling (NativeWind deferred for stability)
- [x] Create `src/components/index.ts` for unified exports
- [x] Test: Component demo in App.tsx
  - Interactive inputs (email, password)
  - Button variants (primary, secondary, danger)
  - Card variants display
  - Auth status display

**Deliverable**: ✅ Core UI component library complete

**Future Enhancements** (as needed):
- LoadingSpinner, ErrorMessage, EmptyState
- Badge component for tags
- Select/Picker for currency selection
- Design system constants

---

### 2.4 Authentication Screens

- [ ] Create `src/screens/LoginScreen.tsx`:
  - Email/password form with validation (Zod + react-hook-form)
  - Call login API
  - Navigate to main app on success
  - Link to register screen
- [ ] Create `src/screens/RegisterScreen.tsx`:
  - Email, password, confirm password, base currency
  - Validation rules (email format, password strength)
  - Call register API
  - Auto-login on success
- [ ] Setup React Navigation:
  - `AuthStack` (Login, Register)
  - `MainStack` (Home, Accounts, Transactions, Settings)
  - Conditional rendering based on auth state
- [ ] Test: Register → Login → Access protected screens

**Deliverable**: Working auth flow

---

### 2.5 Account Management Screens

- [ ] Create `src/api/accounts.ts`:
  - `getAccounts()`, `createAccount()`, `updateAccount()`
- [ ] Create `src/screens/AccountsScreen.tsx`:
  - List all user accounts (use TanStack Query)
  - Show account name, type, currency
  - "Add Account" button
  - Pull-to-refresh
  - Navigate to account details
- [ ] Create `src/screens/AddAccountScreen.tsx`:
  - Form: name, type (dropdown: checking/savings/credit), currency (searchable picker)
  - Submit and navigate back
- [ ] Create `src/screens/AccountDetailScreen.tsx`:
  - Show account info
  - Edit button (modal or navigation)
  - Archive button
  - List recent transactions for this account
- [ ] Test: Create, view, edit accounts

**Deliverable**: Account management UI

---

### 2.6 Transaction Management Screens

- [ ] Create `src/api/transactions.ts`:
  - `getTransactions(filters)`, `createTransaction()`, `updateTransaction()`, `deleteTransaction()`
- [ ] Create `src/screens/TransactionsScreen.tsx`:
  - List transactions with filters (account, date range, tag)
  - Show: date, merchant/description, amount (original + converted to base currency)
  - Color-code by type (expense/income)
  - Pagination or infinite scroll
  - "Add Transaction" FAB (Floating Action Button)
- [ ] Create `src/screens/AddTransactionScreen.tsx`:
  - Form fields:
    - Account (dropdown)
    - Amount (number input)
    - Currency (defaults to account currency, changeable)
    - Date (date picker, defaults to today)
    - Merchant (optional)
    - Description (optional)
    - Tags (multi-select or chip input)
  - Real-time conversion preview (show amount in base currency)
  - Submit and navigate back
- [ ] Create `src/screens/TransactionDetailScreen.tsx`:
  - Show all transaction details
  - Edit button
  - Delete button (with confirmation)
- [ ] Add filter modal/sheet for TransactionsScreen:
  - Filter by account, date range, tag
- [ ] Test: Create, view, edit, delete transactions

**Deliverable**: Transaction management UI

---

### 2.7 Settings & Currency Management

- [ ] Create `src/screens/SettingsScreen.tsx`:
  - Display current user info (email, base currency)
  - "Change Base Currency" button
  - Logout button
- [ ] Create `src/api/currencies.ts`:
  - `getCurrencies()` - fetch supported currencies
- [ ] Add currency change functionality:
  - Show picker with all currencies
  - Update user base_currency via API (might need new endpoint: `PATCH /auth/me`)
  - Refresh transactions to show new conversions
- [ ] Test: Change base currency and verify conversions update

**Deliverable**: Settings and currency management

---

### 2.8 Home Dashboard (Optional for M1)

- [ ] Create `src/screens/HomeScreen.tsx`:
  - Welcome message
  - Quick stats: total balance (sum across accounts in base currency)
  - Recent transactions (last 5)
  - Quick actions: Add Transaction, Add Account
- [ ] Make it the default screen after login
- [ ] Test: Navigate around app

**Deliverable**: Simple home dashboard

---

## Phase 3: Integration & Polish

### 3.1 Error Handling & Loading States

- [ ] Add global error boundary in frontend
- [ ] Implement loading spinners for all async operations
- [ ] Add error messages for failed API calls
- [ ] Add form validation feedback (inline errors)
- [ ] Add success toasts/notifications after actions
- [ ] Test: Simulate API errors (disconnect backend)

**Deliverable**: Robust error handling

---

### 3.2 Testing

- [ ] Backend unit tests (pytest):
  - Test auth: register, login, JWT validation
  - Test accounts: CRUD with user isolation
  - Test transactions: CRUD with conversion
  - Test rates: fetch, store, query with fallback
- [ ] Frontend tests (Jest + React Native Testing Library):
  - Test components render correctly
  - Test auth flow (login, register)
  - Test API client (mock axios)
- [ ] E2E tests (optional, Playwright or Detox):
  - Full user journey: register → create account → add transaction → view converted amount
- [ ] Aim for >70% code coverage on critical paths

**Deliverable**: Test suite with good coverage

---

### 3.3 Documentation & README Updates

- [ ] Update main README.md:
  - Add "Getting Started" section
  - Local development setup instructions
  - Environment variables documentation
  - API documentation link (FastAPI /docs)
- [ ] Create `backend/README.md`:
  - How to run locally
  - How to run migrations
  - How to run tests
- [ ] Create `frontend/README.md`:
  - How to run on Web, Android (Expo Go)
  - Environment configuration
- [ ] Document API endpoints in SPEC.md or separate API.md
- [ ] Add screenshots to README (optional)

**Deliverable**: Complete documentation

---

## Phase 4: Deployment Preparation

### 4.1 Backend Deployment (AWS ECS Fargate)

- [ ] Create production Dockerfile (multi-stage build)
- [ ] Setup AWS resources (manual or Terraform):
  - RDS PostgreSQL instance (db.t4g.micro)
  - ECS Cluster
  - ECR repository for Docker images
  - Application Load Balancer
  - Security groups (ALB → ECS → RDS)
  - Secrets Manager for DB credentials and JWT secret
- [ ] Create ECS Task Definition:
  - Reference ECR image
  - Environment variables from Secrets Manager
  - Health check endpoint: `/health`
- [ ] Create ECS Service with ALB
- [ ] Setup CI/CD (GitHub Actions):
  - Build Docker image
  - Push to ECR
  - Update ECS service
- [ ] Run database migrations on production
- [ ] Test: API accessible via ALB URL

**Deliverable**: Backend running on AWS

---

### 4.2 Frontend Deployment (S3 + CloudFront)

- [ ] Build Expo Web: `npx expo export:web`
- [ ] Create S3 bucket for static hosting
- [ ] Upload `web-build/` to S3
- [ ] Create CloudFront distribution:
  - Origin: S3 bucket
  - Default root object: `index.html`
  - Error pages: redirect to `index.html` (SPA routing)
  - SSL certificate via ACM (optional, for custom domain)
- [ ] Setup CI/CD (GitHub Actions):
  - Build web app
  - Sync to S3
  - Invalidate CloudFront cache
- [ ] Update frontend API base URL to production backend
- [ ] Test: Access via CloudFront URL

**Deliverable**: Frontend accessible via CloudFront

---

### 4.3 Domain & SSL (Optional)

- [ ] Purchase domain (or use existing)
- [ ] Request SSL certificate in ACM (us-east-1 for CloudFront)
- [ ] Add custom domain to CloudFront distribution
- [ ] Update Route 53 DNS records (or external DNS provider)
- [ ] Update backend CORS to allow custom domain
- [ ] Test: Access via custom domain with HTTPS

**Deliverable**: Production URLs with SSL

---

## Phase 5: M1 Completion Checklist

### 5.1 Acceptance Criteria Verification

- [ ] Multi-user isolation: Create 2 users, verify data separation
- [ ] Account creation: Create accounts with different currencies
- [ ] Transaction creation: Add transactions in various currencies
- [ ] Currency conversion: Verify correct rates and conversion display
- [ ] Base currency change: Change user base currency, verify all amounts update
- [ ] Filters: Test account filter, date range filter, tag filter
- [ ] Pagination: Verify large transaction lists load correctly
- [ ] Auth: Test login, logout, token expiration
- [ ] Mobile web: Test on mobile browser (responsive design)
- [ ] Performance: Transaction creation < 400ms (P95)

**Deliverable**: M1 acceptance criteria met

---

### 5.2 Known Limitations & Future Work

Document these in SPEC.md or separate TODO.md:
- [ ] No offline support (defer to later milestone)
- [ ] No PWA service worker (defer to later milestone)
- [ ] No rate limiting on endpoints (add in production)
- [ ] No advanced analytics/charts (M4)
- [ ] No OCR/LLM ingestion (M3)
- [ ] No native Android app yet (M2)

**Deliverable**: Clear roadmap for M2+

---

## Phase 6: M2 Preparation

### 6.1 Android App Setup

- [ ] Test app on Android emulator
- [ ] Setup EAS Build: `npx eas init`
- [ ] Create `eas.json` for build profiles
- [ ] Configure app.json/app.config.js:
  - Package name (e.g., com.yourname.walletapp)
  - Version
  - Icons, splash screen
- [ ] First internal build: `npx eas build --platform android --profile preview`
- [ ] Test APK on physical device
- [ ] Document any platform-specific issues

**Deliverable**: M2 kickoff ready

---

## Estimated Timeline

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| Phase 1: Backend Foundation | 1.1 - 1.7 | 3-5 days |
| Phase 2: Frontend Foundation | 2.1 - 2.8 | 4-6 days |
| Phase 3: Integration & Polish | 3.1 - 3.4 | 2-3 days |
| Phase 4: Deployment | 4.1 - 4.3 | 2-3 days |
| Phase 5: Testing & Validation | 5.1 - 5.2 | 1-2 days |
| **Total** | | **12-19 days** |

*Assumes ~4-6 hours/day of focused work*

---

## Success Metrics (M1)

- [ ] 2+ test users can register and use independently
- [ ] 3+ accounts created per user
- [ ] 10+ transactions logged with accurate conversions
- [ ] API response time < 400ms (P95)
- [ ] Zero data leakage between users
- [ ] Exchange rate coverage > 99% for major currencies
- [ ] Mobile web usable on Chrome/Safari mobile browsers

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| exchangerate.host API downtime | Cache rates for 7 days, implement retry logic, have backup API ready (frankfurter.app) |
| PostgreSQL connection issues | Use connection pooling, implement health checks, retry logic |
| JWT token security | Use strong secrets, short expiration (30 min), secure storage in frontend |
| CORS issues | Configure properly, test from deployed frontend |
| AWS costs exceed budget | Monitor with AWS Budgets, use free tier where possible, consider scaling down resources |

---

## Next Steps After M1

1. Gather feedback from initial users (yourself + 1-2 friends)
2. Fix any critical bugs
3. Begin M2: Android native app with EAS Build
4. Plan M3: OCR/LLM integration architecture
5. Consider basic analytics (user engagement, transaction patterns)

---

## Notes

- This plan is a living document. Update progress by checking off completed items.
- If a task takes significantly longer than estimated, re-evaluate the approach.
- Commit code frequently (at least after each major task).
- Write tests as you go, not at the end.
- Deploy early and often to catch integration issues.

---

**Last Updated**: 2025-10-26  
**Status**: Ready to begin Phase 1

