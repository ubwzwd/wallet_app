# Roadmap: Wallet App — Milestone 1

**Milestone:** M1 — Finish What's Started
**Goal:** Complete half-built features and fix known bugs
**Core Value:** Users can record and view their financial activity across multiple sources in any currency, with automatic conversion to their preferred base currency.

## Phases

- [ ] **Phase 1: Wire, Fix, and Harden** — Wire currency conversion into all transaction endpoints, replace hardcoded currency pickers with live API data, and eliminate four known bugs
- [ ] **Phase 2: Complete Transfer Transactions** — Build the two-step transfer creation UI and link paired transactions via `transfer_pair_id`
- [ ] **Phase 3: User Profile Management** — Add `PATCH /auth/me` endpoint, frontend profile screen for `base_currency`, and auto-set `default_source_id` on first source creation

---

## Phase Details

### Phase 1: Wire, Fix, and Harden

**Goal:** Transaction endpoints return real conversion data, currency pickers show all 31+ ECB currencies, and four known defects are eliminated
**Depends on:** —

**Plans:**
1. Currency Conversion Wiring — In `backend/app/api/transactions.py`, call `rates_service.convert_amount` inside `create_transaction`, `get_transaction`, `list_transactions`, and `update_transaction`; populate `converted_amount`, `conversion_rate`, `conversion_date` on `TransactionResponse`; catch `httpx.HTTPError` / service unavailability and fall back to `None` fields without raising 503
2. Live Currency Pickers and Bug Fixes — Add `GET /rates/currencies` fetch in `TransactionFormScreen.tsx` and `FinanceSourceFormScreen.tsx` (replacing hardcoded 6-item arrays); remove the duplicate `delete_transaction` handler from `transactions.py`; replace `window.confirm` in transaction delete with `Platform.OS`-guarded `Alert.alert`; add `Alert.alert` error feedback to finance source archive on native; set `DEBUG = False` as default in `backend/app/core/config.py` and gate SQLAlchemy echo on `ENVIRONMENT == "development"`

**Delivers:**
- CONV-01, CONV-02, CONV-03
- CURR-01, CURR-02, CURR-03
- BUG-01, BUG-02, BUG-03, BUG-04

**Verification:**
- `GET /api/v1/transactions` response includes non-null `converted_amount`, `conversion_rate`, and `conversion_date` when transaction currency differs from user `base_currency`
- Response returns 200 with `converted_amount: null` (not 503) when Frankfurter API is unreachable
- Currency picker in TransactionFormScreen and FinanceSourceFormScreen shows 31+ currencies after form load
- `transactions.py` contains exactly one `delete_transaction` route handler
- Deleting a transaction on iOS/Android shows a native confirmation dialog before the DELETE request is sent
- Archiving a finance source that fails on native shows a native error dialog
- Backend starts with `DEBUG=False` when `ENVIRONMENT` env var is absent

**UI hint**: yes

---

### Phase 2: Complete Transfer Transactions

**Goal:** Users can create a transfer between two finance sources through a functional two-step UI, with both legs persisted and linked in the database
**Depends on:** Phase 1

**Plans:**
1. Transfer Creation UI and API Integration — In `TransactionFormScreen.tsx`, enable the Transfer tab (remove disabled/coming-soon state); add step 1 (select destination `FinanceSource` from a picker) and step 2 (enter amount and confirm); call the existing `POST /api/v1/transactions` endpoint twice (debit leg then credit leg); pass the `transfer_pair_id` UUID (generated client-side or returned from first leg) in both payloads; update `frontend/src/types/api.ts` to include `transfer_pair_id` on `TransactionCreate` and `Transaction` if not already present

**Delivers:**
- XFER-01, XFER-02, XFER-03

**Verification:**
- Transfer tab in TransactionFormScreen is tappable and opens a two-step form
- Completing the form creates two transaction records in the database sharing the same `transfer_pair_id` UUID
- Both transactions appear in the transactions list for their respective source accounts
- `transfer_pair_id` is present and non-null on both records returned from `GET /api/v1/transactions`

**UI hint**: yes

---

### Phase 3: User Profile Management

**Goal:** Users can update their base currency from the app, and the system automatically assigns a default finance source on first creation
**Depends on:** Phase 1

**Plans:**
1. Profile Endpoint and Auto-Default Source — Add `PATCH /api/v1/auth/me` route in `backend/app/api/auth.py` accepting `base_currency` and `default_source_id` fields (new `UserUpdate` Pydantic schema in `backend/app/schemas/user.py`); in `backend/app/api/finance_sources.py` `create_finance_source` handler, detect when the user has no existing sources and set `current_user.default_source_id` to the new source's ID; update `frontend/src/types/api.ts` with `UserUpdate` type
2. Profile Settings Screen — Create `frontend/src/screens/ProfileScreen.tsx` with a `base_currency` picker (fetched from `/rates/currencies`); wire a `PATCH /auth/me` call via a new `updateMe` function in `frontend/src/api/auth.ts`; add `ProfileScreen` to `HomeScreen.tsx` `HomeView` union and navigation; call `refreshUser()` from `AuthContext` on successful save

**Delivers:**
- PROF-01, PROF-02, PROF-03

**Verification:**
- `PATCH /api/v1/auth/me` with `{"base_currency": "GBP"}` returns 200 and subsequent `GET /auth/me` returns `base_currency: "GBP"`
- Frontend profile screen renders a currency picker populated from `/rates/currencies` and saves successfully
- Creating the first finance source for a new user sets `default_source_id` on the user record (visible in `GET /auth/me` response)

**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Wire, Fix, and Harden | 0/2 | Not started | - |
| 2. Complete Transfer Transactions | 0/1 | Not started | - |
| 3. User Profile Management | 0/2 | Not started | - |

---

## Coverage

| Requirement | Phase | Plans |
|-------------|-------|-------|
| CONV-01 | 1 | Currency Conversion Wiring |
| CONV-02 | 1 | Currency Conversion Wiring |
| CONV-03 | 1 | Currency Conversion Wiring |
| CURR-01 | 1 | Live Currency Pickers and Bug Fixes |
| CURR-02 | 1 | Live Currency Pickers and Bug Fixes |
| CURR-03 | 1 | Live Currency Pickers and Bug Fixes |
| BUG-01 | 1 | Live Currency Pickers and Bug Fixes |
| BUG-02 | 1 | Live Currency Pickers and Bug Fixes |
| BUG-03 | 1 | Live Currency Pickers and Bug Fixes |
| BUG-04 | 1 | Live Currency Pickers and Bug Fixes |
| XFER-01 | 2 | Transfer Creation UI and API Integration |
| XFER-02 | 2 | Transfer Creation UI and API Integration |
| XFER-03 | 2 | Transfer Creation UI and API Integration |
| PROF-01 | 3 | Profile Endpoint and Auto-Default Source |
| PROF-02 | 3 | Profile Settings Screen |
| PROF-03 | 3 | Profile Endpoint and Auto-Default Source |

**v1 requirements:** 16 total
**Covered:** 16
**Gaps:** 0 ✓

---
*Roadmap created: 2026-04-05*
