# Codebase Concerns

**Analysis Date:** 2026-05-24

## Tech Debt

### Large, Multi-Concern Screen Components

**Area:** Frontend screen components

**Issue:** Several screen components bundle form logic, API interaction, state management, and validation in single files without compositional separation.

**Files:** 
- `frontend/src/screens/TransactionFormScreen.tsx` (1019 lines)
- `frontend/src/screens/FinanceSourceFormScreen.tsx` (383 lines)
- `frontend/src/screens/TransactionsScreen.tsx` (414 lines)
- `frontend/src/screens/ProfileScreen.tsx` (351 lines)

**Impact:** 
- High cognitive load during changes
- Difficult to unit test individual form behaviors
- Rollback/error recovery logic (e.g., transfer pair sequential creation with rollback in `TransactionFormScreen.tsx` lines 160–234) is tightly coupled to UI concerns
- Parallel testing harness in Phase 5 (05-01-PLAN.md) will struggle to isolate verifiable behavior

**Fix approach:** 
1. Extract form validation logic into separate hook files (e.g., `useTransactionFormValidation.ts`)
2. Extract mutation/API interaction into custom hooks (e.g., `useCreateTransactionWithRollback.ts`)
3. Keep component file focused on rendering and event binding
4. Phase 5 PWA verification (05-01-PLAN.md) gates on this decomposition: move transfer rollback logic to a testable utility before Phase 5 plans can pass

---

### Hardcoded Environment Defaults in config.py

**Area:** Backend configuration

**Issue:** Sensitive defaults left in source code as placeholders that could be accidentally deployed.

**Files:** `backend/app/core/config.py` (lines 12, 15, 25)

**Current state:**
- Line 12: `DATABASE_URL` hardcoded to `"postgresql://wallet_user:wallet_password@localhost:5432/wallet_db"` — matches `docker-compose.dev.yml` but must be overridden in production via `.env`
- Line 15: `SECRET_KEY` set to `"your-secret-key-change-this-in-production"` — not actually a real secret
- Line 25: `ALLOWED_ORIGINS` has localhost origins baked in

**Risk:** If `.env` is missing or incomplete, the app will use these placeholders, creating security exposure (weak JWT secret, exposed DB creds).

**Workaround:** `infra/.env.example` (lines 1–9) documents the template; all CHANGE_ME_* placeholders are sentinels that fail loudly. Phase 4 smoke test catches missing env vars via `infra/scripts/env-coverage.sh`.

**Fix approach:** 
1. In Phase 6 (runbook generation), add a pre-start safety check: `if SECRET_KEY contains 'change-this', exit 1 with error message`
2. Consider pydantic validator: `@field_validator('SECRET_KEY') def validate_secret_key(cls, v) -> str: assert 'change' not in v.lower(), "SECRET_KEY must be set in .env"`
3. This prevents accidental deployments with placeholder secrets

---

### No Rate Limiting or Request Throttling

**Area:** Backend API

**Issue:** No per-user or global rate limiting implemented on any endpoints.

**Files:** `backend/app/main.py`, all router files in `backend/app/api/`

**Impact:**
- Malicious actor could spam API requests (auth, transaction creation, rates lookups)
- External Frankfurter API calls in `backend/app/services/rates.py` (lines 24–54, 62–99) have retry logic (up to 3 attempts, exponential backoff) but no rate limiting on client side — if Frankfurter rate-limits us, all transaction creation requests fail until cool-off
- No DOS mitigation

**Current state:** 
- Tenacity retry decorator used for Frankfurter API resilience but client does not implement backoff or circuit breaker
- `frontend/src/api/transactions.ts` accepts `limit: number` parameter for list pagination but no global per-user request rate enforcement

**Fix approach:** 
1. Phase 7 (CI/CD + Polish) or Phase 6 (after VM deployment): add `slowapi` middleware for rate limiting
2. Example: `@limiter.limit("100/minute")` on auth endpoints, `"1000/minute"` on data endpoints
3. Implement circuit breaker in rates service: if 3 consecutive fetch_latest_rates calls fail, backoff for 60s before retrying
4. Document in Phase 6 runbook: "If Frankfurter is down, disable transaction creation until rates recover"

---

### Incomplete Error Handling for External API Failures

**Area:** Exchange rate API integration

**Issue:** Frankfurter API failures degrade gracefully at transaction creation time but responses may expose raw error details to frontend.

**Files:**
- `backend/app/api/transactions.py` (lines 20–46)
- `backend/app/services/rates.py` (lines 49–53, 95–99)
- `frontend/src/api/client.ts` (lines 43–76)

**Current state:**
- When Frankfurter API is unavailable, `_build_conversion_fields()` returns `(None, None, None)` and transaction is created without conversion
- This is correct per D-04 (graceful fallback) but error messages may leak API URLs or internal state
- Frontend axios interceptor catches AxiosError but passes raw error.message back to Alert dialog — could expose backend stack traces if not careful

**Risk:** User-facing error dialogs reveal implementation details; verbose HTTP status codes could aid reconnaissance.

**Fix approach:**
1. Add response sanitization: never return raw exception details in API responses
2. In `rates_service`, log full error internally but return generic "Exchange rate service unavailable" to clients
3. Frontend should display friendly messages like "Exchange rate service temporarily down; transactions saved in local currency" rather than raw API errors
4. Implement per-user audit logging (Phase 6 hardening): log all failed API requests with sanitized details to separate log stream

---

## Known Issues

### Transfer Pair Partial Failure Scenario

**Issue:** When creating a transfer, if the second POST succeeds but the rollback DELETE fails, the transaction is left in an incomplete state.

**Description:** 
In `frontend/src/screens/TransactionFormScreen.tsx` (lines 160–234), transfer creation is a two-phase operation:
1. POST expense leg (e.g., -100 from source A)
2. POST income leg (e.g., +100 to source B) — if this fails, delete phase 1

If step 2 succeeds but the DELETE of step 1 fails, the user sees "Transfer partially created" alert and must manually delete the orphaned transaction. This is documented in the code (line 218) but represents unrecovered data inconsistency.

**Files:** `frontend/src/screens/TransactionFormScreen.tsx` (lines 212–224)

**Trigger:** Network interruption during second transaction creation, then network failure during rollback attempt

**Current mitigation:** User alert at line 218 directs manual cleanup. Phase 5 PWA work should surface this in UI as a pending-rollback notification.

**Fix approach:** 
1. Phase 6: Add server-side repair endpoint `DELETE /api/v1/transfers/{pair_id}/rollback-failed` that atomically cleans up incomplete pairs older than 24h
2. Phase 7 CI/CD: Add hourly cron job querying for orphaned transfer pairs and auto-cleanup after 48h
3. Document in runbook under "Monitoring" section

---

### Frontend Config Swap Timing Issue

**Issue:** During web build, `config.prod.ts` is swapped into `config.ts` but the swap is not atomic or version-controlled.

**Description:**
- Before build: `config.ts` contains dev localhost URL
- During build (`npm run build:web` in `frontend/package.json` line 11): copies `config.prod.ts` over `config.ts`, then runs `expo export -p web`, then restores `config.dev.ts` back to `config.ts`
- If build process crashes mid-export, `config.ts` may be left with production URL in git working directory (caught by pre-commit but risky)
- Phase 4 success criterion 3 verifies no `localhost:8000` in built bundle, but the build script itself could be fragile

**Files:** 
- `frontend/package.json` (line 11)
- `frontend/src/constants/config.ts` (header comment line 4 notes this is intentional per 04-CONTEXT.md D-05)
- `frontend/src/constants/config.prod.ts` vs `config.dev.ts` byte-differ pre-build

**Impact:** Accidental commit of production URLs to git if build interrupted

**Fix approach:**
1. Phase 5: Rewrite build script to use environment variable substitution instead of file swap
   - Define `EXPO_PUBLIC_API_URL` as env var in `app.json` or `.env.production`
   - Remove the explicit cp/restore pattern
2. Alternative (simpler): Add git pre-commit hook that rejects commits with `config.ts` containing `localhost:8000`
3. Phase 5 PWA verification gate should include a build-abort test: corrupt `config.ts` mid-build and verify script recovers

---

### Postgres Shared Buffers Tuning May Be Insufficient for Heavy Load

**Issue:** `shared_buffers=3GB` set in `infra/docker-compose.prod.yml` (line 18) is a best-effort Oracle idle-reclaim mitigation but not validated against actual workload.

**Description:**
- Oracle Cloud Always Free VM has 12 GB RAM; tuning keeps 3GB for Postgres, leaving 9GB for other processes
- This 3GB target was chosen to stay under Oracle's 20% idle memory reclaim threshold (Phase 4 ROADMAP line 17)
- However, no load testing has been done to validate this is sufficient for:
  - 100 concurrent users
  - Heavy transaction import workloads
  - Concurrent exchange rate API calls under peak demand

**Files:** `infra/docker-compose.prod.yml` (lines 15–22)

**Impact:** 
- If shared_buffers too small, Postgres will evict pages frequently → IO contention → slow queries
- If shared_buffers too large, we risk pushing past Oracle's 20% threshold and triggering memory reclaim → OOM kill
- No monitoring currently in place to track cache hit ratio or memory pressure

**Fix approach:**
1. Phase 6 runbook: add post-deployment monitoring checklist
   - Query `pg_stat_database` to track cache hit ratio (target >99%)
   - Monitor OS free memory; if <30% sustained, reduce other services or scale up
2. Phase 7 CI/CD: add synthetic load test during canary deploy
   - Simulate 50 concurrent users making transactions + rates lookups for 5 min
   - Verify response times <500ms and Postgres memory stable
3. Document tuning adjustment procedure in runbook: "If cache_hit_ratio <95%, increase shared_buffers to 4GB and test; if OOM risk, reduce to 2.5GB"

---

## Security Considerations

### Permissive CORS Configuration Will Remain Until Phase 6

**Issue:** CORS is currently permissive; narrowing is deferred to Phase 6.

**Files:** 
- `backend/app/main.py` (lines 18–24)
- `backend/app/core/config.py` (line 25)
- `infra/.env.example` (line 24–25, note says "defense-in-depth; same-origin Caddy makes browser CORS moot")

**Current state:**
- FastAPI CORS middleware loads `allowed_origins_list` from `ALLOWED_ORIGINS` env var (default: `http://localhost:8081,http://localhost:19006,http://localhost:3000`)
- Phase 4: deployed behind Caddy reverse-proxy at same origin (e.g., `https://domain.com` serves frontend + proxies `/api/*` to FastAPI)
- Same-origin means browser CORS preflight is bypassed; however, FastAPI still enforces the allowlist for non-browser clients (curl, scripts, third-party apps)

**Risk:** 
- If someone misconfigures `.env` and sets `ALLOWED_ORIGINS=*`, FastAPI becomes open to cross-origin requests from any domain
- Caddy same-origin routing makes this low-risk in practice but defense-in-depth recommends narrowing

**Mitigation in place:**
- Phase 4 success criterion 4 (ROADMAP line 42): "CORS allowlist is narrowed to the prod domain even though same-origin makes it moot"
- Phase 6 requirement DOMAIN-04 explicitly calls for narrowing

**Fix approach:**
- Phase 6 runbook: after DNS verified, update `.env` with `ALLOWED_ORIGINS=https://<domain>` before first Caddy start
- Phase 7 CI/CD: add post-deploy audit step to confirm `ALLOWED_ORIGINS` in running container matches expected domain

---

### HTTPS Not Yet Implemented

**Issue:** Phase 4 produces a local compose stack with `tls internal` (self-signed certs). Real HTTPS arrives in Phase 6.

**Files:** 
- `infra/Caddyfile` (line 2)
- `infra/.env.example` (line 35–36)

**Current state:**
- Caddy configured with `tls {$CADDY_TLS_MODE:internal}` — defaults to self-signed certs
- Phase 4 success criterion requires no hardcoded `localhost:8000` in frontend bundle, ensuring same-origin routing works
- Phase 6 ROADMAP (lines 75–81) handles Let's Encrypt integration with staging endpoint first

**Risk (Phase 4):**
- Running over HTTP or self-signed HTTPS on localhost is fine for development
- On Oracle VM in Phase 6, must switch to real certificate before going live (covered in Phase 6 runbook)

**No action needed for Phase 4.** Phase 6 explicitly handles this.

---

### JWT Secret Not Entropy-Validated

**Issue:** No validation that `SECRET_KEY` env var has sufficient entropy.

**Files:** `backend/app/core/config.py` (line 15), `infra/.env.example` (line 20)

**Current state:**
- `.env.example` comment instructs: `CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32`
- If operator uses weak secret (e.g., password instead of random bytes), JWT becomes forgeable
- No pydantic validator enforces minimum key length or entropy

**Risk:** Low in practice (runbook will guide correct generation) but not hardened.

**Fix approach:** 
1. Add pydantic validator in `backend/app/core/config.py`:
   ```python
   @field_validator('SECRET_KEY')
   @classmethod
   def validate_secret_key(cls, v: str) -> str:
       if len(v) < 32:
           raise ValueError('SECRET_KEY must be at least 32 characters (generate with: openssl rand -hex 32)')
       return v
   ```
2. Phase 6 runbook: add validation step after `.env` creation: `python -c "from app.core.config import settings; print(f'SECRET_KEY length: {len(settings.SECRET_KEY)}')"` — must show ≥32

---

### Frankfurter API Has No Fallback Provider

**Issue:** If Frankfurter (ECB exchange rates) becomes unavailable, there is no secondary rate provider.

**Files:** `backend/app/services/rates.py` (lines 41, 80)

**Current state:**
- `EXCHANGE_RATE_API_URL` hardcoded to Frankfurter endpoint in config
- Retry logic handles transient failures (up to 3 attempts) but if service is down, all rate-dependent operations fail
- Transaction creation degrades gracefully (returns None for conversion fields per D-04) but user cannot create transactions in other currencies

**Risk:** 
- Frankfurter is maintained by Bundesbank (stable) but not a contractual SLA
- Extended outage blocks transaction functionality for multi-currency users

**Fix approach:** 
1. Phase 6: add second rate provider (e.g., OpenExchangeRates free tier or fallback to Open-Metaels)
2. Implement provider abstraction:
   ```python
   class ExchangeRateProvider(ABC):
       def fetch_rates(base: str, targets: List[str]) -> Dict[str, Decimal]: ...
   ```
3. Try Frankfurter first, fall back to secondary on all-retries-exhausted
4. Phase 7 CI/CD: add monthly health check job to ensure fallback provider is accessible

---

## Performance Bottlenecks

### TransactionFormScreen State Management May Trigger Excessive Re-renders

**Issue:** Screen component manages 10+ state variables independently; each form input triggers separate state update, potentially causing re-render cascades.

**Files:** `frontend/src/screens/TransactionFormScreen.tsx` (lines 24–40)

**Current state:**
- `type`, `sourceId`, `amount`, `currency`, `date`, `description`, `merchant`, `tagsInput`, `errors`, `currencyPickerVisible`, `currencySearch`, `step`, `destinationSourceId`, `destPickerVisible`, `isSubmitting` — 15 state variables
- Form fields use individual `onChange` handlers → setState → re-render
- No memoization or derived state optimization

**Impact:**
- Typing in amount field triggers 1 re-render
- Typing in description field triggers another re-render
- Currency picker toggling triggers re-render
- On slow devices or with many transactions loaded, UI may feel sluggish

**Measurement:** Not profiled yet; potential rather than confirmed.

**Fix approach:**
1. Phase 5 PWA polish: use `useReducer` to consolidate form state into single object
2. Memoize currency picker rendering with `useMemo`
3. Profile with React DevTools on real phone (Phase 5 smoke test includes performance checkpoint)
4. Target: screen should remain responsive (<16ms per frame) when 1000 historical transactions in query cache

---

### No Database Query Optimization / N+1 Prevention

**Issue:** Several endpoints may execute multiple queries in sequence without explicit optimization.

**Files:**
- `backend/app/api/transactions.py` (lines 144–215): list_transactions fetches transactions, then for each unique currency, makes a batch rates call (optimized per D-05)
- `backend/app/api/finance_sources.py`: likely fetches sources without pre-joining user relationships

**Current state:**
- Transactions endpoint uses batch rates fetch (good) — one API call for all unique currencies
- Finance sources endpoint not reviewed but likely no N+1 issue since sources cardinality is low (<50 per user)
- No index analysis has been done; Alembic migrations don't include index definitions

**Risk:** 
- As transaction count grows (1000s), list performance degrades
- Joining transaction → tags creates Cartesian product if not careful

**Fix approach:**
1. Phase 7 CI/CD: add database query profiling to canary deploy
   - Enable Postgres `log_statement = 'all'` during canary
   - Analyze logs for sequential queries on same resource
2. Add SQLAlchemy eager loading: use `selectinload()` or `joinedload()` in list_transactions to pre-fetch tags
3. Create index on `transactions(user_id, occurred_at DESC)` and `transaction_tags(transaction_id, tag)` in a new migration
4. Benchmark: list_transactions with 10k transactions should complete in <200ms

---

## Fragile Areas

### Transfer Logic Lacks Atomic Guarantee

**Files:** 
- `frontend/src/screens/TransactionFormScreen.tsx` (lines 160–234 for creation, 236–294 for update)
- `backend/app/api/transactions.py` (lines 52–141)

**Why fragile:**
- Transfer creation is two separate POST requests joined by `transfer_pair_id` UUID
- If network fails between requests, one leg exists without a pair
- Rollback attempt at frontend layer (line 214) can itself fail, leaving partial state
- Backend has no transaction-level guarantee that both legs are created atomically

**Safe modification:**
1. Do NOT manually edit transfer_pair_id in database; this orphans balances
2. Do NOT delete one leg without deleting the pair (use admin endpoint if needed)
3. When refactoring, keep the rollback logic in frontend; do NOT move it to backend without implementing atomic stored procedure
4. Phase 5 PWA feature gate requires adding a "Pending Cleanup" UI notification for orphaned pairs older than 24h

**Test coverage:**
- `frontend/__tests__/TransactionFormScreen.test.ts` (121 lines) exists but does not cover transfer rollback scenario
- No integration tests for two-POST failure mode

**Improvement:** Phase 6 or later, add server-side transfer creation endpoint that atomically creates both legs in a database transaction

---

### CORS Config Easy to Misconfigure

**Files:** `backend/app/core/config.py` (line 25), `infra/.env.example` (line 24–25)

**Why fragile:**
- `ALLOWED_ORIGINS` is a comma-separated string; trailing/leading spaces cause parsing errors
- No validation that origins are valid URLs
- If operator sets `ALLOWED_ORIGINS=*`, FastAPI silently accepts it even though it defeats security

**Safe modification:**
- Always add comment when editing `.env.example`: "Comma-separated, no spaces"
- Phase 6 runbook: add manual test step: `curl -H 'Origin: https://wrong-domain.com' https://<domain>/api/v1/health` — should 403

**Test coverage:** No unit tests for `allowed_origins_list` property parsing

**Improvement:** Add pydantic validator:
```python
@field_validator('ALLOWED_ORIGINS')
@classmethod
def validate_origins(cls, v: str) -> str:
    if v.strip() == '*':
        raise ValueError('ALLOWED_ORIGINS=* is not permitted; list specific domains')
    for origin in v.split(','):
        origin = origin.strip()
        if not origin.startswith('http'):
            raise ValueError(f'Invalid origin format: {origin}')
    return v
```

---

### Missing Validation of Finance Source Ownership

**Issue:** Some endpoints accept `source_id` parameter but may not validate it belongs to the current user consistently.

**Files:** 
- `backend/app/api/transactions.py` (lines 78–88, 175–186): checks ownership
- `backend/app/api/finance_sources.py`: review needed

**Current state:**
- Transaction create/list/delete all check source ownership
- But if a new endpoint is added later, it's easy to forget this check

**Safe modification:**
- Always use the pattern:
  ```python
  source = db.query(FinanceSource).filter(
      FinanceSource.id == source_id,
      FinanceSource.user_id == current_user.id
  ).first()
  if not source:
      raise HTTPException(status_code=404, detail="...")
  ```
- Never silently ignore a missing source; always raise an exception

**Test coverage:** `backend/tests/` has no explicit ownership violation tests; add a test that verifies user B cannot access user A's finance sources

---

## Scaling Limits

### Single Postgres Instance; No Replication

**Issue:** All data lives in one Postgres container on the Oracle VM. No hot backup, no read replicas.

**Files:** `infra/docker-compose.prod.yml` (lines 6–31)

**Current capacity:**
- Postgres 15 Alpine with 3GB shared_buffers on 12GB VM
- Typical workload: hundreds of transactions per user, thousands of users
- Bottleneck: as concurrent connections grow, `max_connections=50` (line 22) will throttle

**Scaling path:**
1. Phase 7: implement daily backups to off-site storage (R2 / B2 / S3 per ROADMAP line 89)
2. Post-v2.0: if user base grows, implement read replicas on separate VM
3. For now, single instance is acceptable given Always Free tier constraints

---

### Caddy Memory Usage Unbounded

**Issue:** Caddy caches reverse-proxy connections and compiled config; no memory limits set in compose.

**Files:** `infra/docker-compose.prod.yml` (lines 61–78)

**Current state:**
- Caddy container has no `deploy.resources.limits.memory` set
- Could theoretically consume all 12GB VM memory
- On Oracle Always Free, this might trigger memory reclaim

**Scaling path:**
1. Phase 6 runbook: add resource limits to compose: `deploy.resources.limits.memory: 1g`
2. Monitor Caddy memory weekly; if consistently >500MB, consider config optimization

---

## Dependencies at Risk

### Deprecated or Slow-Moving Libraries

**Issue:** Some dependencies may be at risk of abandonment or version lag.

**Files:** 
- `backend/pyproject.toml` (package list)
- `frontend/package.json` (package list)

**Identified risks:**
1. **passlib** (Python) — Last major release was 2021; uses `bcrypt` under the hood. OK for now but consider migrating directly to `bcrypt` in future.
2. **tenacity** (Python) — Stable and maintained but low popularity. Retry logic is simple; consider built-in implementation in Phase 7 if tenacity falls behind.
3. **axios** (JavaScript) — Well-maintained but consider `fetch` API for smaller bundle size if needed.

**No immediate action needed for Phase 4.** Phase 7 CI/CD should include a `pip-audit` / `npm audit` step to catch critical vulnerabilities.

---

## Missing Critical Features

### No Request Validation Schemas for All Endpoints

**Issue:** Some endpoints lack explicit request validation beyond pydantic models.

**Files:** `backend/app/api/transactions.py`, `backend/app/api/finance_sources.py`

**Current state:**
- Transaction creation validates amount > 0 (line 141)
- But no validation that tags don't exceed a maximum count (DoS vector)
- No validation that description length is bounded (could allocate unbounded storage)

**Impact:** Malicious user could submit transaction with 1000 tags or 1MB description, bloating database

**Fix approach:**
1. Phase 6: add max field sizes to all schemas
   ```python
   class TransactionCreate(BaseModel):
       tags: List[str] = Field(..., max_length=10)  # Max 10 tags
       description: str = Field(..., max_length=500)  # Max 500 chars
   ```
2. Phase 7 CI/CD: add fuzz testing to verify API rejects invalid payloads

---

### No Audit Logging for Sensitive Operations

**Issue:** No log trail for:
- Auth attempts (successful + failed)
- Finance source creation/deletion
- Transaction deletion
- Password changes

**Files:** Entire `backend/app/api/` directory

**Current state:**
- `backend/app/core/security.py` (line 116) logs JWT decode failures, which is good
- But create/delete operations have no corresponding audit events

**Risk:** If user account is compromised, no way to detect what data was deleted

**Fix approach:**
1. Phase 6: add audit middleware that logs all DELETE/POST/PUT requests with user_id, endpoint, and result
2. Store audit logs in separate table: `audit_events(id, user_id, action, endpoint, timestamp, result)`
3. Phase 7: expose audit log endpoint for users to review their own activity

---

## Test Coverage Gaps

### Frontend: No E2E Tests for Multi-Step Flows

**What's not tested:** 
- Transfer creation success path (both legs created)
- Transfer creation + partial rollback scenario
- Currency picker → amount update → conversion display

**Files:** `frontend/__tests__/` — 4 test files found but no E2E framework

**Risk:**
- Regression in transfer logic goes undetected
- If refactoring form state, collateral changes to validation may silently break

**Priority:** High (transfers are core feature)

**Improvement:**
1. Phase 5 PWA harness (05-01-PLAN.md) includes Playwright or similar for E2E
2. Add tests:
   - `e2e/transfer-success.spec.ts` — create transfer, verify both legs in list
   - `e2e/transfer-partial-failure.spec.ts` — intercept second POST, verify rollback

---

### Backend: No Coverage for Concurrent User Access

**What's not tested:**
- Two users updating the same finance source (race condition on name, currency)
- Concurrent transaction creation from multiple devices / sessions

**Files:** `backend/tests/` — 6 test files but all single-user workflows

**Risk:** If two transactions with same transfer_pair_id are created in parallel, UUID collision is theoretically possible but extremely low probability. Higher risk: concurrent profile updates (e.g., base currency change) could leave inconsistent state.

**Priority:** Medium

**Improvement:**
1. Phase 7: add pytest-asyncio tests with concurrent API calls
   - Mock two simultaneous requests to update user.base_currency
   - Verify last-write-wins or optimistic locking prevents rollover

---

### Frontend: No Tests for Offline Scenarios

**What's not tested:**
- Form data loss if network drops mid-submit
- Service worker update flow (PWA-04 test, deferred to Phase 5)

**Files:** `frontend/__tests__/` — no offline test fixtures

**Risk:**
- Phase 5 PWA feature depends on network-first strategy for `/index.html` and `/api/*`; no test harness exists yet
- Phase 4 does not include offline support, so this is not a gap

**Priority:** Deferred to Phase 5

---

## Security Considerations (Additional)

### API Exposes GraphQL Playground / OpenAPI Docs in Production

**Issue:** Swagger/OpenAPI documentation is served at `/docs` and `/openapi.json` in production.

**Files:** `backend/app/main.py` (line 11: `debug=settings.DEBUG`)

**Current state:**
- FastAPI automatically exposes docs when app is created
- Phase 4 env defaults to `DEBUG=False` but if misconfigured, docs would be public
- Caddy config (lines 14–20) explicitly proxies `/docs` and `/openapi.json` to FastAPI

**Risk:** Low in practice (documentation helps attackers reconnaissance) but best practice is to disable in production

**Fix approach:**
1. Phase 6 runbook: verify `docs_url=None` in FastAPI app initialization if `not settings.DEBUG`
2. Alternatively, add Caddy rule to block `/docs` at reverse-proxy level

---

## Summary by Priority

| Issue | Area | Severity | Phase to Fix |
|-------|------|----------|-------------|
| Large screen components (1000+ LOC) | Frontend Arch | Medium | Phase 5 PWA |
| Transfer pair partial failure | Data Consistency | High | Phase 6 |
| Hardcoded config defaults | Sec | Medium | Phase 6 Runbook |
| No rate limiting | Sec/Perf | Medium | Phase 7 CI/CD |
| Frankfurter fallback | Resilience | Medium | Phase 6+ |
| Postgres tuning validation | Ops | Medium | Phase 6 Runbook |
| CORS config permissive | Sec | Low | Phase 6 |
| No audit logging | Sec | Medium | Phase 6 Runbook |
| Transfer state management | Quality | Medium | Phase 5 PWA |
| No E2E tests | Testing | High | Phase 5 Harness |

---

*Concerns audit: 2026-05-24*
