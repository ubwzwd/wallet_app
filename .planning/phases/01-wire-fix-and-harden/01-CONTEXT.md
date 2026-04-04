# Phase 1: Wire, Fix, and Harden - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire currency conversion into all four transaction endpoints (`create_transaction`, `get_transaction`, `list_transactions`, `update_transaction`), replace hardcoded 6-currency pickers with a live `/rates/currencies` fetch (using a FlatList modal on native), and eliminate four known bugs: duplicate `delete_transaction` handler, missing native delete confirmation, missing native archive error feedback, and `DEBUG=True` default.

No new features. No transfer UI. No user profile changes. Strictly completing what's half-built.

</domain>

<decisions>
## Implementation Decisions

### Currency Conversion

- **D-01:** Use `rates_service.convert_amount()` in all four endpoints — it already exists and works. No new service code needed.
- **D-02:** Conversion rate freshness: use `/latest` (today's rate). `conversion_date = date.today()`. This is what `rates.py` already calls — no historical endpoint needed. Accurate enough for the display use case.
- **D-03:** If `tx.currency == user.base_currency`: skip conversion, return `converted_amount=None`, `conversion_rate=None`, `conversion_date=None`. Schema already documents this as the intended null case.
- **D-04:** If Frankfurter API is unreachable: catch the `HTTPException` from `rates_service`, fall back to `converted_amount=None` without re-raising. Endpoint returns 200, not 503.

### List Conversion Performance

- **D-05:** In `list_transactions`, batch by currency pair: collect all unique `tx.currency` values, call `fetch_latest_rates(user.base_currency, unique_currencies)` **once**, then apply rates to all transactions in memory. Result: at most 1 HTTP call per list request regardless of transaction count.
- **D-06:** Same fallback applies: if the batch rates call fails, return all `converted_amount=None` for that request — no 503 propagated.

### Currency Picker (Frontend)

- **D-07:** Replace hardcoded `const CURRENCIES = [...]` in both `TransactionFormScreen.tsx` and `FinanceSourceFormScreen.tsx` with a live fetch from `/rates/currencies` using TanStack Query (`useQuery`).
- **D-08:** On web: keep `<select>` populated from the fetched list (same UX, just more options).
- **D-09:** On native (iOS/Android): render a full-screen `Modal` containing a `FlatList` of currency options. Triggered by pressing the currency field. No new dependencies — uses React Native `Modal` and `FlatList` only.
- **D-10:** Loading state: show the existing 6-currency list (or a spinner) while currencies are fetching. Don't block the form from opening.

### Bug Fixes

- **D-11:** `delete_transaction` duplicate: delete the first two definitions (lines 106–158 and 301–353 in `transactions.py`), keep only the final definition. The final definition is the correct one — it handles both single and transfer-paired deletes.
- **D-12:** Native delete confirmation: in `TransactionsScreen.tsx` `handleDelete`, add an `else` branch for `Platform.OS !== 'web'` that calls `Alert.alert` with Confirm/Cancel buttons before calling `deleteMutation.mutate`.
- **D-13:** Native archive error: in `FinanceSourcesScreen.tsx` `archiveMutation.onError`, add a native `Alert.alert` branch alongside the existing `window.alert` web branch.
- **D-14:** DEBUG default: change `DEBUG: bool = True` to `DEBUG: bool = False` in `config.py`. Gate `echo=settings.DEBUG` in `database.py` on `settings.ENVIRONMENT == "development"` instead, so SQL logging is opt-in.

### Claude's Discretion

- Exact FlatList modal styling (keep consistent with existing screen styles)
- Whether to show currency name alongside code in the picker (e.g., "USD - United States Dollar")
- Exact wording of native delete/archive alert dialogs (match existing Alert.alert patterns in codebase)
- `conversion_date` field: use `date.today()` at the time of the API call

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend — Conversion wiring
- `backend/app/api/transactions.py` — The four endpoints to modify; contains the `# TODO: Add conversion logic` comment pattern and current `None` placeholders
- `backend/app/services/rates.py` — `convert_amount()`, `fetch_latest_rates()`, `get_supported_currencies()` — the full service API to call
- `backend/app/schemas/transaction.py` — `TransactionResponse` schema with `converted_amount`, `conversion_rate`, `conversion_date` fields and their null semantics
- `backend/app/core/config.py` — `DEBUG: bool = True` default to change; `ENVIRONMENT` field available

### Frontend — Currency picker
- `frontend/src/screens/TransactionFormScreen.tsx` — Hardcoded `CURRENCIES` array at line 18; `<select>` at lines 211–221
- `frontend/src/screens/FinanceSourceFormScreen.tsx` — Hardcoded `CURRENCIES` array at line 16
- `frontend/src/api/` — API client pattern to follow for the new `/rates/currencies` fetch
- `frontend/src/constants/config.ts` — `QUERY_KEYS` constants; add a key for currencies here

### Frontend — Bug fixes
- `frontend/src/screens/TransactionsScreen.tsx` — `handleDelete` at lines 42–53; missing `else` branch for native
- `frontend/src/screens/FinanceSourcesScreen.tsx` — `archiveMutation.onError` at lines 36–43; web-only alert

### Conventions
- `.planning/codebase/CONVENTIONS.md` — Error handling patterns, Alert.alert usage, TanStack Query mutation conventions
- `.planning/codebase/CONCERNS.md` — Full diagnosis of each bug with file:line references

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `rates_service.convert_amount(amount, from_currency, to_currency)` — ready to call, returns `Decimal`; wraps `fetch_latest_rates`
- `rates_service.fetch_latest_rates(base, symbols)` — accepts a list of target currencies; call once with all unique currencies for batching
- `rates_service.get_supported_currencies()` — returns `Dict[str, str]` (code → name); already cached in memory; backend `/rates/currencies` endpoint calls this
- `QUERY_KEYS` in `frontend/src/constants/config.ts` — add `CURRENCIES` key here to follow established pattern
- `Modal` and `FlatList` already used in the app (React Native built-ins) — no new imports needed for picker modal
- `Platform.OS` pattern: already used in `TransactionFormScreen.tsx` lines 211–221 and `TransactionsScreen.tsx` lines 48–53

### Established Patterns
- All four transaction endpoints follow the same response-construction pattern: build a `TransactionResponse(...)` with `converted_amount=None` — each is a localized change
- Error handling: `onError` in mutations always checks `Platform.OS === 'web'` before `window.alert`; native path needs `Alert.alert` added
- TanStack Query: currencies fetch should use `useQuery` with `staleTime: Infinity` (currencies rarely change) and `QUERY_KEYS.CURRENCIES`
- FastAPI route errors use `HTTPException`; rates_service raises `HTTPException(503)` on network failure — must catch this in transaction endpoints before it propagates

### Integration Points
- `TransactionResponse` already has conversion fields — no schema migration needed
- `delete_transaction` duplicate cleanup is purely subtractive (delete code, keep last definition)
- `database.py` `echo=settings.DEBUG` → change to `echo=(settings.ENVIRONMENT == "development" and settings.DEBUG)`

</code_context>

<specifics>
## Specific Ideas

No specific UI references provided — standard React Native patterns apply.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-wire-fix-and-harden*
*Context gathered: 2026-04-05*
