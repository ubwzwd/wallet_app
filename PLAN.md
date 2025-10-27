# Wallet App - M1 Implementation Plan

Version: 1.0  
Created: 2025-10-26  
Target: M1 Web Core (Auth, Accounts, Transactions, Multi-Currency)

---

## Overview

This plan covers the complete implementation of M1 milestone:
- Multi-user authentication (email + password, JWT)
- Account management (multi-account, multi-currency)
- Transaction CRUD with tags
- Real-time currency conversion using exchangerate.host
- Web UI (Expo Web)
- Local development with Docker Compose
- AWS deployment ready

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
- [ ] Test: `docker-compose up` should start PostgreSQL (requires Docker Desktop WSL2 integration)

**Deliverable**: Working Docker environment with PostgreSQL (ready to test when Docker is configured)

---

### 1.2 Database Models & Migrations

- [ ] Setup Alembic in `backend/migrations/`
- [ ] Create SQLAlchemy base and database session management
- [ ] Implement models in `backend/app/models/`:
  - `User` (id, email, password_hash, base_currency, created_at)
  - `Account` (id, user_id, name, type, currency, archived, created_at)
  - `Transaction` (id, user_id, account_id, amount, currency, occurred_at, description, merchant, created_at)
  - `TransactionTag` (transaction_id, tag) - many-to-many
  - `ExchangeRate` (id, source, base, symbol, rate, date, unique constraint)
- [ ] Create initial migration: `alembic revision --autogenerate -m "Initial schema"`
- [ ] Run migration: `alembic upgrade head`
- [ ] Test: PostgreSQL tables created successfully

**Deliverable**: Database schema with all tables

---

### 1.3 Core Security & Auth

- [ ] Create `backend/app/core/security.py`:
  - Password hashing functions (bcrypt)
  - JWT token generation and verification
  - Current user dependency (extract from Bearer token)
- [ ] Create `backend/app/core/config.py`:
  - Pydantic Settings for environment variables
  - Database URL, JWT secret, etc.
- [ ] Create Pydantic schemas in `backend/app/schemas/`:
  - `UserCreate`, `UserLogin`, `UserResponse`
  - `Token`, `TokenData`
- [ ] Implement auth router in `backend/app/api/auth.py`:
  - `POST /auth/register` - create user with hashed password
  - `POST /auth/login` - verify credentials, return JWT
  - `GET /auth/me` - get current user (protected)
- [ ] Test auth endpoints with curl/httpie

**Deliverable**: Working authentication system

---

### 1.4 Currency & Exchange Rate Service

- [ ] Create `backend/app/services/rates.py`:
  - `fetch_rates_from_api(date: str)` - call exchangerate.host API
  - `store_rates(date: str, rates: dict)` - save to database
  - `get_rate(base: str, symbol: str, date: str)` - query with fallback to prior date
  - `sync_latest_rates()` - fetch and store today's rates
- [ ] Create Pydantic schemas:
  - `CurrencyList`, `ExchangeRateResponse`
- [ ] Implement rates router in `backend/app/api/rates.py`:
  - `GET /currencies` - return supported ISO 4217 list (hardcoded or from DB)
  - `GET /rates?date=YYYY-MM-DD` - get rates for date
  - `POST /rates/refresh` - trigger manual sync (rate limited)
- [ ] Test: Fetch rates from exchangerate.host manually
- [ ] Verify rates stored in database

**Deliverable**: Exchange rate fetching and storage working

---

### 1.5 Account Management

- [ ] Create Pydantic schemas in `backend/app/schemas/account.py`:
  - `AccountCreate` (name, type, currency)
  - `AccountUpdate` (name?, archived?)
  - `AccountResponse` (id, user_id, name, type, currency, archived, created_at)
- [ ] Implement accounts router in `backend/app/api/accounts.py`:
  - `POST /accounts` - create account (user-scoped)
  - `GET /accounts` - list user's accounts
  - `GET /accounts/{id}` - get single account (owner check)
  - `PATCH /accounts/{id}` - update account (owner check)
- [ ] Add user_id filtering on all queries (security)
- [ ] Test: CRUD operations for accounts

**Deliverable**: Account management endpoints working

---

### 1.6 Transaction Management

- [ ] Create Pydantic schemas in `backend/app/schemas/transaction.py`:
  - `TransactionCreate` (account_id, amount, currency, occurred_at, description?, merchant?, tags?)
  - `TransactionUpdate` (partial fields)
  - `TransactionResponse` (all fields + converted_amount_base, conversion_rate)
- [ ] Implement transactions router in `backend/app/api/transactions.py`:
  - `POST /transactions` - create transaction with tags
  - `GET /transactions` - list with filters (account_id, from/to date, tag, pagination)
  - `GET /transactions/{id}` - get single transaction (owner check)
  - `PATCH /transactions/{id}` - update transaction
- [ ] Add currency conversion logic:
  - Query exchange rate for (user.base_currency, tx.currency, tx.occurred_at)
  - Calculate converted amount
  - Return in response with flag if rate is approximate
- [ ] Implement pagination (offset/limit or cursor-based)
- [ ] Test: CRUD operations with conversion

**Deliverable**: Transaction CRUD with currency conversion

---

### 1.7 Main App & API Router

- [ ] Create `backend/app/main.py`:
  - Initialize FastAPI app
  - Add CORS middleware (allow localhost for dev)
  - Include all routers (auth, accounts, transactions, rates)
  - Add health check endpoint: `GET /health`
  - Add startup event to test DB connection
- [ ] Create `backend/app/api/__init__.py` to aggregate routers
- [ ] Test: Run locally with `uvicorn app.main:app --reload`
- [ ] Verify all endpoints accessible via OpenAPI docs at `/docs`

**Deliverable**: Complete backend API running locally

---

## Phase 2: Frontend Foundation

### 2.1 Expo Project Setup

- [ ] Initialize Expo project: `npx create-expo-app@latest frontend --template blank-typescript`
- [ ] Install dependencies:
  - NativeWind (Tailwind CSS): `nativewind`, `tailwindcss`
  - React Navigation: `@react-navigation/native`, `@react-navigation/native-stack`
  - TanStack Query: `@tanstack/react-query`
  - Form handling: `react-hook-form`, `@hookform/resolvers`
  - Validation: `zod`
  - HTTP client: `axios`
  - Async Storage: `@react-native-async-storage/async-storage`
- [ ] Setup NativeWind:
  - Create `tailwind.config.js`
  - Configure `babel.config.js` for NativeWind
  - Create `app.d.ts` for TypeScript types
- [ ] Setup folder structure:
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
- [ ] Test: `npm start` and open in web browser

**Deliverable**: Expo project with dependencies installed

---

### 2.2 API Client & Authentication Context

- [ ] Create `src/api/client.ts`:
  - Axios instance with base URL
  - Request interceptor to add JWT token from storage
  - Response interceptor for error handling
- [ ] Create `src/types/api.ts`:
  - TypeScript interfaces for all API responses (User, Account, Transaction, etc.)
- [ ] Create `src/api/auth.ts`:
  - `register(email, password, baseCurrency)`
  - `login(email, password)`
  - `getCurrentUser()`
- [ ] Create `src/contexts/AuthContext.tsx`:
  - Manage user state and token
  - Store token in AsyncStorage
  - Provide login/logout/register functions
- [ ] Wrap App in AuthProvider
- [ ] Test: Login and token persistence

**Deliverable**: API client with authentication

---

### 2.3 UI Components Library

- [ ] Create base components in `src/components/`:
  - `Button.tsx` (primary, secondary, danger variants)
  - `Input.tsx` (text, email, password, number, date)
  - `Card.tsx` (container with shadow)
  - `LoadingSpinner.tsx`
  - `ErrorMessage.tsx`
  - `EmptyState.tsx`
  - `Badge.tsx` (for tags)
  - `Select.tsx` / `Picker.tsx` (for currency/account selection)
- [ ] Use NativeWind classes for styling
- [ ] Create a simple design system in `src/constants/theme.ts`:
  - Colors (primary, secondary, danger, etc.)
  - Spacing, typography
- [ ] Test: Storybook or simple test screen with all components

**Deliverable**: Reusable UI component library

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

### 3.2 Exchange Rate Sync & Backfill

- [ ] Add a cron job or scheduled task to sync rates daily:
  - Option 1: Simple `while True` loop in FastAPI startup with `asyncio.sleep`
  - Option 2: Separate script run by cron/systemd timer
  - Option 3: AWS EventBridge (for production)
- [ ] Implement on-demand backfill logic:
  - When querying a transaction, if rate is missing for that date, fetch it
- [ ] Add admin endpoint (optional): `POST /admin/sync-rates-range?from=YYYY-MM-DD&to=YYYY-MM-DD`
- [ ] Test: Missing rate triggers backfill

**Deliverable**: Automated rate syncing

---

### 3.3 Testing

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

### 3.4 Documentation & README Updates

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

