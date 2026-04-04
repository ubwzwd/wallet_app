# Codebase Concerns

**Analysis Date:** 2026-04-05

## Tech Debt

**Currency Conversion Unimplemented Despite Full Infrastructure:**
- Issue: Four transaction endpoints return `converted_amount=None`, `conversion_rate=None`, `conversion_date=None` even though the `TransactionResponse` schema defines these fields and a complete `rates_service` (`convert_amount`, `fetch_latest_rates`) already exists and works. The infrastructure is built; the wiring step was skipped.
- Files: `backend/app/api/transactions.py` lines 98, 249, 293, 428
- Impact: Multi-currency users see no converted amounts anywhere in the app. The `base_currency` field on `User` has no practical effect on transaction display.
- Fix approach: In each `TransactionResponse` construction block, call `rates_service.convert_amount(tx.amount, tx.currency, current_user.base_currency)` and populate the three conversion fields when currencies differ.

**Duplicate `delete_transaction` Function Defined Three Times:**
- Issue: `backend/app/api/transactions.py` defines the `delete_transaction` route handler three times (lines 106, 301, 436). Python silently uses the last definition; the first two are dead code that will never execute. This happened due to copy-paste during development.
- Files: `backend/app/api/transactions.py`
- Impact: Confusing to maintain; any changes made to the first two copies are silently ignored. The router only registers the last definition.
- Fix approach: Delete lines 106–158 and 301–353, keeping only the final definition at line 436.

**In-Process Memory Cache for Currencies Never Expires:**
- Issue: `_SUPPORTED_CURRENCIES_CACHE` in `backend/app/services/rates.py` is a module-level dict set once and never invalidated. In a multi-worker deployment (uvicorn with `--workers N`), each worker holds its own cache so they can diverge. Cache is also lost on restart with no TTL.
- Files: `backend/app/services/rates.py` lines 15–46
- Impact: Low severity for this data (ECB currencies rarely change), but the pattern is fragile and won't extend to rate caching.
- Fix approach: Add a TTL with `time.time()` check, or replace with a proper cache (Redis, `cachetools.TTLCache`).

**Frontend Currency Picker is a Hardcoded Six-Item List:**
- Issue: Both `TransactionFormScreen.tsx` and `FinanceSourceFormScreen.tsx` hardcode `const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD']`. The backend exposes a `/rates/currencies` endpoint returning all 31+ supported currencies. The frontend never fetches it.
- Files: `frontend/src/screens/TransactionFormScreen.tsx` line 18, `frontend/src/screens/FinanceSourceFormScreen.tsx` line 16
- Impact: Users cannot select currencies outside the six listed. Registration `base_currency` field accepts free text, creating a mismatch.
- Fix approach: Query `QUERY_KEYS.CURRENCIES` from `/rates/currencies` at form load and populate a scrollable picker from the result.

**Transfer Transactions Are UI-Dead but Data Model Exists:**
- Issue: The Transfer button in `TransactionFormScreen` is `disabled` and shows "Transfer support coming soon". The data model (`transfer_pair_id` on `Transaction`) and delete logic for paired transfers already exist in the backend. Only the creation UI is missing.
- Files: `frontend/src/screens/TransactionFormScreen.tsx` lines 196–203, `backend/app/api/transactions.py` lines 137–148
- Impact: Feature is half-built. Users see a visible but permanently disabled button. Transfer transactions that somehow exist in the DB are displayed correctly but cannot be created from the app.
- Fix approach: Implement a two-step transfer form that creates two linked transactions and links them via a shared `transfer_pair_id` UUID.

**`DEBUG=True` Default and SQL Echo in Production Path:**
- Issue: `backend/app/core/config.py` sets `DEBUG: bool = True` as the default. The database engine passes `echo=settings.DEBUG` to SQLAlchemy, meaning all SQL is logged by default. If the `.env` file is missing or incomplete in production, SQL query logs are emitted.
- Files: `backend/app/core/config.py` line 22, `backend/app/core/database.py` line 16
- Impact: Performance overhead from SQL logging in production, potential log-based information leakage.
- Fix approach: Change the default to `DEBUG: bool = False`. Use `ENVIRONMENT` field to gate debug features explicitly.

**`default_source_id` Never Set via API:**
- Issue: `User.default_source_id` exists in the schema and frontend `User` type (`src/types/api.ts` line 11), but there is no API endpoint to set or update it. It is only set to `NULL` on `SET NULL` cascade when a finance source is deleted. The `create_transaction` endpoint falls back to it when no `source_id` is provided, but users have no way to configure it.
- Files: `backend/app/models/user.py` line 21, `backend/app/api/auth.py` (no PATCH /me endpoint)
- Impact: The fallback logic in `create_transaction` (lines 38–44) that uses `default_source_id` will always raise a 400 error for new users who don't pass `source_id` explicitly, since `default_source_id` is always null.
- Fix approach: Add a `PATCH /auth/me` endpoint accepting `default_source_id`, or auto-set `default_source_id` when the first finance source is created.

## Known Bugs

**Delete Confirmation Skipped on Native Platforms:**
- Symptoms: On iOS/Android, pressing Delete on a transaction in `TransactionsScreen` silently does nothing. No confirmation dialog appears and no deletion occurs.
- Files: `frontend/src/screens/TransactionsScreen.tsx` lines 42–53
- Trigger: `handleDelete` checks `if (Platform.OS === 'web')` and only calls `window.confirm` inside that branch. No `else` branch exists. Native `Alert.alert` is never called for this action.
- Workaround: Web-only users are unaffected.

**Finance Source Archive Error on Web Shows Alert but No Native Fallback:**
- Symptoms: On web, archive errors show via `window.alert`. On native, errors from `archiveMutation` are swallowed (native `Alert.alert` is handled, but the success path for `archiveMutation.onError` on web calls `window.alert` then falls through without stopping execution).
- Files: `frontend/src/screens/FinanceSourcesScreen.tsx` lines 36–43
- Trigger: Network failure during archive toggle on native platform.

## Security Considerations

**JWT Tokens Have No Revocation Mechanism:**
- Risk: Issued tokens are valid for 30 minutes (`ACCESS_TOKEN_EXPIRE_MINUTES=30`) with no server-side revocation. If a token is stolen or a user logs out, the token remains valid until expiry. Logout only removes the token from `AsyncStorage` on device.
- Files: `backend/app/core/security.py`, `frontend/src/api/client.ts` lines 48–52
- Current mitigation: Short 30-minute expiry limits the window.
- Recommendations: Implement a token denylist (Redis set) checked on each request, or use short-lived tokens with refresh token rotation.

**No Rate Limiting on Authentication Endpoints:**
- Risk: `POST /auth/login` and `POST /auth/register` have no brute-force protection. An attacker can attempt unlimited password guesses.
- Files: `backend/app/api/auth.py`
- Current mitigation: None detected.
- Recommendations: Add `slowapi` or similar rate-limiting middleware. Lock accounts after N failed attempts.

**Insecure Default `SECRET_KEY` in Config:**
- Risk: `SECRET_KEY` defaults to `"your-secret-key-change-this-in-production"` if not overridden. A deployment without a `.env` file will use this literal string, allowing any attacker who knows the default to forge valid JWTs.
- Files: `backend/app/core/config.py` line 15
- Current mitigation: `env.example` warns to change it, but there is no runtime check that enforces it.
- Recommendations: Add a startup check: `if settings.SECRET_KEY == "your-secret-key-change-this-in-production" and settings.ENVIRONMENT != "development": raise RuntimeError(...)`.

**`CurrencyCode` Regex Validation Only on Backend Schema, Not Enforced for `base_currency` at Registration:**
- Risk: `UserCreate.base_currency` in `backend/app/schemas/user.py` uses `str` with `min_length=3, max_length=3` but no `pattern` constraint. Any 3-character string is accepted (e.g., `"XYZ"`, `"123"`). This differs from `TransactionCreate.currency` which uses the validated `CurrencyCode` type.
- Files: `backend/app/schemas/user.py` line 12
- Current mitigation: None.
- Recommendations: Change `base_currency: str = Field(..., min_length=3, max_length=3)` to `base_currency: CurrencyCode` using the existing type alias from `app/schemas/currency.py`.

**`extra="allow"` in Pydantic Settings:**
- Risk: `backend/app/core/config.py` sets `extra="allow"` on `Settings`. Any unexpected environment variable is silently accepted and stored in the settings object, including typos of critical settings (e.g., `SECERT_KEY` would be accepted without error, and the default insecure `SECRET_KEY` would be used silently).
- Files: `backend/app/core/config.py` line 37
- Recommendations: Change to `extra="ignore"` or `extra="forbid"`.

## Performance Bottlenecks

**N+1 Query Pattern When Building Transaction Lists:**
- Problem: In `list_transactions`, the query fetches all `Transaction` objects, then for each, `tx.tags` triggers a separate `SELECT` from `transaction_tags`. With 50 transactions (the default limit), this produces 51 database queries per request.
- Files: `backend/app/api/transactions.py` lines 232–253
- Cause: SQLAlchemy lazy-loads the `tags` relationship by default. No `joinedload` or `selectinload` option is specified.
- Improvement path: Add `.options(selectinload(Transaction.tags))` to the query at line 232. Apply the same fix to `get_transaction` and `create_transaction` response construction.

**Synchronous HTTP Calls to External Rate API Block Worker Thread:**
- Problem: `httpx.get()` (synchronous) is used in `backend/app/services/rates.py`. FastAPI is async-capable; blocking synchronous network calls inside route handlers tie up the thread pool and degrade throughput under concurrent load.
- Files: `backend/app/services/rates.py` lines 86, 42
- Cause: `httpx.get` (sync) was used instead of `httpx.AsyncClient` with `await`.
- Improvement path: Convert `get_supported_currencies` and `fetch_latest_rates` to async functions using `async with httpx.AsyncClient() as client: response = await client.get(...)`. Mark route handlers that call them with `async def`.

**No Database Indices on Transaction Date Range Queries:**
- Problem: The `from_date`/`to_date` filter in `list_transactions` runs `Transaction.occurred_at >= from_dt`. While `occurred_at` has an `index=True` on the column definition, the composite query `WHERE user_id = X AND occurred_at >= Y` may not use it efficiently without a composite index.
- Files: `backend/app/models/transaction.py` lines 18–22, `backend/app/api/transactions.py` lines 205–225
- Improvement path: Add a composite index `Index('ix_transactions_user_date', 'user_id', 'occurred_at')` in a new Alembic migration.

## Fragile Areas

**`HomeScreen` Custom Navigation Stack (State Machine):**
- Files: `frontend/src/screens/HomeScreen.tsx`
- Why fragile: Navigation is implemented as a `useState<HomeView>` string with a series of `if` blocks rendering different screen components. There is no history stack, no browser back-button support on web, and no deep-link capability. Adding a new screen requires editing the `HomeView` union type and inserting a new `if` block in `HomeScreen`. The state also holds `selectedSource` and `selectedTransaction` which must be manually cleared on every navigation path.
- Safe modification: When adding new views, add the type to the `HomeView` union and add the corresponding `if` block before the final `return`. Always clear selected state in both `onSuccess` and `onCancel` callbacks.
- Test coverage: None.

**`TransactionFormScreen` Uses Raw HTML Elements (`<select>`, `<input type="date">`):**
- Files: `frontend/src/screens/TransactionFormScreen.tsx` lines 211–221, 262–270
- Why fragile: Native `<select>` and `<input type="date">` are DOM elements that only work on web. The entire finance-source dropdown and date picker are non-functional on iOS/Android. These are cast with `as any` to suppress TypeScript errors, hiding the platform incompatibility.
- Safe modification: Only add additional `<select>` or `<input>` elements behind `Platform.OS === 'web'` guards, and always provide a native fallback using React Native Picker or a date picker library.
- Test coverage: None.

**Exchange Rate Service Has No Fallback When Frankfurter API Is Down:**
- Files: `backend/app/services/rates.py`
- Why fragile: If `api.frankfurter.app` is unreachable after 3 retries, all transaction creation/listing routes that attempt conversion will return HTTP 503. Currently conversion is stubbed out, so this is dormant — but enabling conversion (the main TODO item) will make the entire transactions API dependent on a third-party service.
- Safe modification: Wrap conversion calls in a try/except and return `converted_amount=None` on failure rather than propagating the 503. Cache the last known rate.
- Test coverage: None.

## Scaling Limits

**In-Process Currency Cache (Single Instance Only):**
- Current capacity: One process.
- Limit: Does not share across uvicorn workers or multiple instances. Each worker fetches currencies independently on first request.
- Scaling path: Move cache to Redis; use `fastapi-cache2` or similar.

**No Pagination on Finance Sources:**
- Current capacity: Returns all of a user's finance sources in a single query.
- Limit: Will degrade for users with many archived sources as no `limit`/`offset` is applied.
- Files: `backend/app/api/finance_sources.py` lines 46–63
- Scaling path: Add `limit` and `offset` query parameters matching the pattern used in `list_transactions`.

## Dependencies at Risk

**`python-jose` (JWT Library):**
- Risk: `python-jose` has had known CVEs and is considered unmaintained by parts of the community. The recommended replacement is `PyJWT`.
- Files: `backend/pyproject.toml` line 17, `backend/app/core/security.py` line 8
- Impact: Security vulnerability exposure for JWT operations.
- Migration plan: Replace `from jose import JWTError, jwt` with `import jwt` from `PyJWT`. The API is similar; `jwt.encode`/`jwt.decode` signatures require minor adjustments.

**`passlib` + `bcrypt` Double Dependency:**
- Risk: `passlib` is listed as a dependency (`passlib[bcrypt]`) but `bcrypt` is also directly depended on and used directly in `security.py`. `passlib` is not actually used in any source file. This creates two separate bcrypt implementations as potential dependencies.
- Files: `backend/pyproject.toml` lines 21, 23, `backend/app/core/security.py` lines 7–26
- Impact: Unnecessary dependency bloat; `passlib` maintenance has slowed.
- Migration plan: Remove `passlib` from `pyproject.toml`. The codebase already calls `bcrypt` directly.

## Missing Critical Features

**No Token Refresh:**
- Problem: Access tokens expire after 30 minutes with no refresh mechanism. Users are silently logged out when their token expires mid-session. The `AuthContext` only clears the token on 401 response but does not attempt renewal.
- Files: `frontend/src/api/client.ts` lines 48–52, `backend/app/api/auth.py`
- Blocks: Acceptable UX for any session longer than 30 minutes.

**No `PATCH /auth/me` Endpoint:**
- Problem: Users cannot update their profile (email, base currency, default source) after registration. The frontend has no settings screen.
- Files: `backend/app/api/auth.py`
- Blocks: Setting `default_source_id`, changing `base_currency` after onboarding.

**No Soft Delete or Audit Trail for Transactions:**
- Problem: Transactions are hard-deleted. There is no recovery path and no audit log.
- Files: `backend/app/api/transactions.py` lines 152–158, `backend/app/models/transaction.py`
- Blocks: Financial record integrity requirements; ability to recover accidental deletions.

## Test Coverage Gaps

**No Tests Exist — Anywhere:**
- What's not tested: Every backend route, every service function, every frontend component and screen.
- Files: `backend/` (no `tests/` directory despite `pyproject.toml` configuring `pytest`), `frontend/` (no `.test.tsx` or `.spec.tsx` files found)
- Risk: All behaviour changes are validated only through manual testing. Regressions go undetected. The duplicate `delete_transaction` function bug, the N+1 query, and the missing native delete confirmation are examples of defects that automated tests would catch.
- Priority: High. Start with backend route tests using `httpx.AsyncClient` and `pytest-asyncio`. The dev dependencies (`pytest`, `pytest-asyncio`) are already declared in `pyproject.toml`.

---

*Concerns audit: 2026-04-05*
