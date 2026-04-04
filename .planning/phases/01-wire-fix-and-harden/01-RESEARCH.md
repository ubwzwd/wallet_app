# Phase 1: Wire, Fix, and Harden - Research

**Researched:** 2026-04-05
**Domain:** Backend currency conversion wiring, frontend currency picker, bug fixes
**Confidence:** HIGH

## Summary

Phase 1 is a completion and hardening phase -- no new features, no new libraries, no schema changes. All required infrastructure already exists in the codebase: `rates_service` with `convert_amount()` and `fetch_latest_rates()`, `TransactionResponse` schema with conversion fields, `QUERY_KEYS.CURRENCIES` constant, `CurrencyList` TypeScript type, and the `GET /rates/currencies` backend endpoint. The work is purely wiring existing pieces together and fixing four known bugs.

The backend changes center on four transaction endpoints in `transactions.py` where `converted_amount=None` placeholders need to be replaced with actual `rates_service` calls, plus removing two duplicate `delete_transaction` definitions and changing the `DEBUG` default. The frontend changes center on replacing hardcoded 6-currency arrays with live API fetches using TanStack Query, adding native `Alert.alert` branches where only web `window.alert`/`window.confirm` exists, and building a currency picker modal for native platforms.

**Primary recommendation:** Follow the locked decisions exactly. All code patterns, services, and types are already established in the codebase. No new dependencies needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Use `rates_service.convert_amount()` in all four endpoints -- already exists, no new service code
- D-02: Use `/latest` (today's rate), `conversion_date = date.today()`
- D-03: Skip conversion when `tx.currency == user.base_currency`, return all three fields as `None`
- D-04: Catch `HTTPException` from `rates_service`, fall back to `converted_amount=None`, return 200 not 503
- D-05: In `list_transactions`, batch by currency pair: call `fetch_latest_rates(user.base_currency, unique_currencies)` once, apply rates in memory
- D-06: Same fallback for batch: if rates call fails, all `converted_amount=None`
- D-07: Replace hardcoded `CURRENCIES` in both form screens with live fetch from `/rates/currencies` using `useQuery`
- D-08: On web: keep `<select>` populated from fetched list
- D-09: On native: full-screen `Modal` + `FlatList` for currency picker (no new deps)
- D-10: Loading state: show existing 6-currency list (or spinner) while fetching
- D-11: Delete first two `delete_transaction` definitions (lines 106-158 and 301-353), keep only the final definition (lines 436-488)
- D-12: Add `else` branch in `handleDelete` for native `Alert.alert` with Confirm/Cancel
- D-13: Add native `Alert.alert` branch in `archiveMutation.onError`
- D-14: Change `DEBUG: bool = True` to `DEBUG: bool = False`; gate SQL echo on `ENVIRONMENT == "development"`

### Claude's Discretion
- Exact FlatList modal styling (keep consistent with existing screen styles)
- Whether to show currency name alongside code in the picker
- Exact wording of native delete/archive alert dialogs (match existing Alert.alert patterns)
- `conversion_date` field: use `date.today()` at time of API call

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONV-01 | Transaction responses include `converted_amount`, `conversion_rate`, `conversion_date` when currency differs from `base_currency` | `rates_service.convert_amount()` and `fetch_latest_rates()` exist and work; `TransactionResponse` schema already has the fields |
| CONV-02 | All four endpoints populate conversion fields | Each endpoint has a `TransactionResponse(...)` construction block with `converted_amount=None` placeholder to replace |
| CONV-03 | Graceful fallback to `None` (no 503) when Frankfurter unreachable | `rates_service` raises `HTTPException(503)` -- must catch in transaction endpoints |
| CURR-01 | TransactionFormScreen fetches currencies from `/rates/currencies` | `QUERY_KEYS.CURRENCIES` already defined; `CurrencyList` type exists; `GET /rates/currencies` endpoint works |
| CURR-02 | FinanceSourceFormScreen fetches currencies from `/rates/currencies` | Same API client pattern as CURR-01 |
| CURR-03 | Both pickers display 31+ ECB currencies | Frankfurter API returns 31 currencies via `get_supported_currencies()` |
| BUG-01 | Duplicate `delete_transaction` removed | Three definitions at lines 106, 301, 436 -- delete first two |
| BUG-02 | Native delete confirmation via `Alert.alert` | `handleDelete` in `TransactionsScreen.tsx` has no `else` branch for native |
| BUG-03 | Native archive error feedback via `Alert.alert` | `archiveMutation.onError` in `FinanceSourcesScreen.tsx` needs native branch |
| BUG-04 | `DEBUG=False` default, SQL echo gated on `ENVIRONMENT` | `config.py` line 22, `database.py` line 16 |
</phase_requirements>

## Standard Stack

No new libraries are needed for this phase. Everything uses the existing stack.

### Core (Already Installed)
| Library | Purpose | Why Standard |
|---------|---------|--------------|
| FastAPI | Backend API framework | Already in use [VERIFIED: codebase] |
| SQLAlchemy | ORM and database engine | Already in use [VERIFIED: codebase] |
| httpx | HTTP client for Frankfurter API calls | Already in `rates_service` [VERIFIED: codebase] |
| tenacity | Retry logic for rate API calls | Already in `rates_service` [VERIFIED: codebase] |
| pydantic-settings | Configuration management | Already in `config.py` [VERIFIED: codebase] |
| @tanstack/react-query | Data fetching / caching | Already in all screen components [VERIFIED: codebase] |
| axios | HTTP client for frontend | Already in `api/client.ts` [VERIFIED: codebase] |
| React Native (Modal, FlatList, Alert, Platform) | Native UI components | Built-in, already imported across screens [VERIFIED: codebase] |

**Installation:** None required. Zero new dependencies.

## Architecture Patterns

### Backend: Conversion Wiring Pattern

Each of the four transaction endpoints follows the same response-construction pattern. The conversion logic should be extracted into a helper to avoid duplication. [VERIFIED: codebase inspection]

**Helper function pattern (recommended):**
```python
# In transactions.py, add near the top after imports
from datetime import date

def _build_transaction_response(
    tx: Transaction, 
    base_currency: str,
    rates: dict | None = None
) -> TransactionResponse:
    """Build TransactionResponse with optional conversion fields."""
    converted_amount = None
    conversion_rate = None
    conversion_date = None

    if tx.currency.upper() != base_currency.upper() and rates is not None:
        rate = rates.get(tx.currency.upper())
        if rate is not None:
            converted_amount = (tx.amount * rate).quantize(Decimal("0.0001"))
            conversion_rate = rate
            conversion_date = date.today()

    return TransactionResponse(
        id=tx.id,
        user_id=tx.user_id,
        source_id=tx.source_id,
        amount=tx.amount,
        currency=tx.currency,
        occurred_at=tx.occurred_at,
        description=tx.description,
        merchant=tx.merchant,
        transfer_pair_id=tx.transfer_pair_id,
        created_at=tx.created_at,
        tags=[tag.tag for tag in tx.tags],
        converted_amount=converted_amount,
        conversion_rate=conversion_rate,
        conversion_date=conversion_date,
    )
```

**Important note on conversion direction:** The user's `base_currency` is the TARGET. `fetch_latest_rates(base, symbols)` expects `base` as the FROM currency and `symbols` as the TO currencies. But we need rates FROM each `tx.currency` TO `base_currency`. There are two approaches:

1. Call `fetch_latest_rates(base_currency, [unique_tx_currencies])` -- this gives rates FROM `base_currency` TO each `tx.currency`. To convert `tx.amount` (in `tx.currency`) to `base_currency`, divide: `tx.amount / rate`. [VERIFIED: Frankfurter API semantics]
2. Call `convert_amount(tx.amount, tx.currency, base_currency)` for single transactions -- this handles direction internally.

For `list_transactions` batch (D-05): use approach 1 with a single `fetch_latest_rates` call and divide. For single endpoints (create, get, update): use `convert_amount()` directly (D-01).

### Backend: Error Handling for Conversion

`rates_service` functions raise `HTTPException(status_code=503)` on failure. Per D-04, catch this and return `None` fields. [VERIFIED: rates.py lines 48-53, 95-99]

```python
try:
    rates = fetch_latest_rates(current_user.base_currency, unique_currencies)
except HTTPException:
    rates = None  # Fallback: all conversions will be None
```

### Frontend: Currency Fetch Pattern

The API client pattern is well established. A new `rates.ts` API module is needed. [VERIFIED: codebase pattern in `api/transactions.ts`]

```typescript
// frontend/src/api/rates.ts
import { apiClient } from './client';
import type { CurrencyList } from '@/types/api';

export const getCurrencies = async (): Promise<CurrencyList> => {
  const response = await apiClient.get<CurrencyList>('/rates/currencies');
  return response.data;
};
```

Usage in form screens:
```typescript
const { data: currencyData } = useQuery({
  queryKey: [QUERY_KEYS.CURRENCIES],
  queryFn: () => ratesApi.getCurrencies(),
  staleTime: Infinity,  // Currencies rarely change
});

const currencies = currencyData
  ? Object.keys(currencyData.currencies).sort()
  : ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD'];  // Fallback while loading (D-10)
```

### Frontend: Native Currency Picker Modal Pattern

Use React Native `Modal` + `FlatList` with `Platform.OS` guard. Keep `<select>` for web. [VERIFIED: Modal and FlatList already used in codebase]

```typescript
// Pseudocode for the native picker
const [pickerVisible, setPickerVisible] = useState(false);

{Platform.OS === 'web' ? (
  <select value={currency} onChange={...}>
    {currencies.map(c => <option key={c} value={c}>{c}</option>)}
  </select>
) : (
  <>
    <TouchableOpacity onPress={() => setPickerVisible(true)}>
      <Text>{currency}</Text>
    </TouchableOpacity>
    <Modal visible={pickerVisible} animationType="slide">
      <FlatList
        data={currencies}
        keyExtractor={item => item}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => { setCurrency(item); setPickerVisible(false); }}>
            <Text>{item}</Text>
          </TouchableOpacity>
        )}
      />
    </Modal>
  </>
)}
```

### Anti-Patterns to Avoid
- **Calling `convert_amount()` per-transaction in list endpoint:** Would make N HTTP calls to Frankfurter. Use `fetch_latest_rates` batch approach per D-05. [VERIFIED: decision D-05]
- **Propagating 503 from rates service:** Must catch and return None, never let `HTTPException(503)` escape transaction endpoints. [VERIFIED: decision D-04]
- **Using `window.confirm` on native:** Does not exist on iOS/Android. Always branch on `Platform.OS`. [VERIFIED: codebase bug analysis]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Currency conversion | Custom rate math | `rates_service.convert_amount()` | Already handles same-currency check, rate fetching, Decimal precision [VERIFIED: rates.py] |
| Batch rate fetching | Per-transaction API calls | `rates_service.fetch_latest_rates(base, [symbols])` | Single HTTP call for all currencies [VERIFIED: rates.py] |
| Native alerts | Custom modal dialogs | `Alert.alert` from React Native | Standard cross-platform alert, already used in `FinanceSourceFormScreen` [VERIFIED: codebase] |
| Currency list fetch | Manual fetch/cache | `useQuery` with `QUERY_KEYS.CURRENCIES` | TanStack Query handles caching, loading, errors [VERIFIED: codebase pattern] |

## Common Pitfalls

### Pitfall 1: Conversion Rate Direction
**What goes wrong:** Calling `fetch_latest_rates(base_currency, [tx_currencies])` gives rates FROM base TO tx currencies. Multiplying `tx.amount * rate` would give the wrong direction -- it would convert FROM base TO tx currency, not the reverse.
**Why it happens:** The Frankfurter API `from` parameter is the base, and rates express "1 base = X target".
**How to avoid:** For batch conversion in `list_transactions`: call `fetch_latest_rates(base_currency, unique_tx_currencies)`, then for each tx: `converted_amount = tx.amount / rate`. For single endpoints: use `convert_amount(tx.amount, tx.currency, base_currency)` which handles direction internally.
**Warning signs:** Converted amounts that are absurdly large or small relative to the original.

### Pitfall 2: HTTPException vs httpx.HTTPError
**What goes wrong:** `rates_service` catches `httpx.HTTPError` internally and re-raises as `fastapi.HTTPException`. The transaction endpoints need to catch `HTTPException`, not `httpx.HTTPError`.
**Why it happens:** The retry decorator in `rates_service` handles `httpx.HTTPError`; after 3 retries fail, it raises `HTTPException(503)`.
**How to avoid:** In transaction endpoints, catch `HTTPException` specifically (or a broad `Exception` with logging).
**Warning signs:** Uncaught 503 errors in transaction responses.

### Pitfall 3: Decimal Precision in Batch Conversion
**What goes wrong:** `fetch_latest_rates` returns `Dict[str, Decimal]`. Division of `tx.amount` (Decimal) by rate (Decimal) works correctly but needs explicit quantization.
**Why it happens:** Python Decimal division can produce many decimal places.
**How to avoid:** Always quantize: `(tx.amount / rate).quantize(Decimal("0.0001"))` matching the precision in `convert_amount()`.
**Warning signs:** Conversion amounts with 20+ decimal places in API responses.

### Pitfall 4: Currency Key Case Mismatch
**What goes wrong:** `tx.currency` may be stored as lowercase while `fetch_latest_rates` returns uppercase keys.
**Why it happens:** Transaction creation calls `.upper()` but existing data might not be normalized.
**How to avoid:** Always use `.upper()` when looking up rates: `rates.get(tx.currency.upper())`.
**Warning signs:** Rates not found for currencies that should be supported.

### Pitfall 5: FlatList Modal Missing Close Button
**What goes wrong:** The native currency picker modal opens but the user has no way to dismiss it without selecting a currency.
**Why it happens:** `Modal` component has no built-in close button.
**How to avoid:** Add a "Cancel" or "X" button in the modal header that calls `setPickerVisible(false)`.
**Warning signs:** Users stuck in the modal on native.

## Code Examples

### Backend: Single Transaction Conversion (create, get, update)
```python
# Source: Codebase pattern + decision D-01, D-02, D-03, D-04
from datetime import date
from decimal import Decimal
from fastapi import HTTPException

# Inside create_transaction, after db.refresh(new_transaction):
converted_amount = None
conversion_rate = None
conversion_date = None

if new_transaction.currency.upper() != current_user.base_currency.upper():
    try:
        converted_amount = rates_service.convert_amount(
            new_transaction.amount,
            new_transaction.currency,
            current_user.base_currency
        )
        # Get the rate for the response field
        rates = rates_service.fetch_latest_rates(
            new_transaction.currency, [current_user.base_currency]
        )
        conversion_rate = rates.get(current_user.base_currency.upper())
        conversion_date = date.today()
    except HTTPException:
        # Frankfurter unavailable -- graceful fallback
        converted_amount = None
        conversion_rate = None
        conversion_date = None
```

### Backend: Batch Conversion in list_transactions (D-05)
```python
# Source: Decision D-05, D-06
# After fetching transactions, before building responses:
unique_currencies = set()
for tx in transactions:
    if tx.currency.upper() != current_user.base_currency.upper():
        unique_currencies.add(tx.currency.upper())

rates = None
if unique_currencies:
    try:
        # Fetch rates FROM each tx currency TO base_currency
        # Actually: fetch FROM base_currency TO each tx currency, then invert
        rates = rates_service.fetch_latest_rates(
            current_user.base_currency, list(unique_currencies)
        )
    except HTTPException:
        rates = None  # All conversions will be None

# Build responses
for tx in transactions:
    converted_amount = None
    conversion_rate = None
    conversion_date = None
    
    if tx.currency.upper() != current_user.base_currency.upper() and rates:
        rate = rates.get(tx.currency.upper())
        if rate:
            # rate = how many tx.currency per 1 base_currency
            # So: converted = tx.amount / rate
            converted_amount = (tx.amount / rate).quantize(Decimal("0.0001"))
            conversion_rate = (Decimal("1") / rate).quantize(Decimal("0.000001"))
            conversion_date = date.today()
    
    # ... build TransactionResponse with these values
```

### Frontend: Native Alert for Delete Confirmation (D-12)
```typescript
// Source: Existing pattern in FinanceSourcesScreen.tsx lines 51-72
import { Alert } from 'react-native';

const handleDelete = (transaction: Transaction) => {
  const isTransfer = !!transaction.transfer_pair_id;
  const title = isTransfer ? 'Delete Transfer' : 'Delete Transaction';
  const message = isTransfer
    ? 'This will delete BOTH sides of the transfer. Continue?'
    : 'Are you sure you want to delete this transaction?';

  if (Platform.OS === 'web') {
    const confirmed = window.confirm(`${title}\n\n${message}`);
    if (confirmed) {
      deleteMutation.mutate(transaction.id);
    }
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(transaction.id),
      },
    ]);
  }
};
```

### Backend: DEBUG Default Fix (D-14)
```python
# config.py
DEBUG: bool = False  # Changed from True

# database.py
echo=(settings.ENVIRONMENT == "development" and settings.DEBUG),
```

## State of the Art

No state-of-the-art changes relevant to this phase. All libraries are already in use and the patterns are stable.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `converted_amount=None` | Live conversion via `rates_service` | This phase | Users see real converted amounts |
| Hardcoded 6-currency list | Live 31+ currency fetch | This phase | Full ECB currency support |
| `DEBUG=True` default | `DEBUG=False` with env gating | This phase | Secure defaults |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fetch_latest_rates(base, symbols)` returns rates such that `1 base = rate target` (standard Frankfurter semantics) | Pitfall 1, Code Examples | Conversion amounts would be inverted -- critical bug |
| A2 | `tx.amount` is stored as `Decimal` in the database (matching the Pydantic schema) | Code Examples | Decimal arithmetic would fail with type errors |

**Note on A1:** The Frankfurter API documentation states rates are expressed as "1 base unit = X target units". This is standard FX convention. The `convert_amount()` function already works correctly for single conversions, confirming this. For batch: if we call `fetch_latest_rates("USD", ["EUR"])` and get `{"EUR": 0.92}`, that means 1 USD = 0.92 EUR. To convert 100 EUR to USD: `100 / 0.92 = 108.70 USD`. [ASSUMED -- direction logic should be verified with a test call]

## Open Questions

1. **Batch conversion rate direction**
   - What we know: `convert_amount()` handles direction internally for single conversions. For batch, we call `fetch_latest_rates(base_currency, tx_currencies)`.
   - What's unclear: Whether `base_currency` as the `from` parameter gives rates we should multiply or divide by.
   - Recommendation: Make a test API call to verify direction before implementing batch. Alternatively, for simplicity, the implementer could use `convert_amount()` per unique currency pair (at most ~30 calls for 31 currencies, but realistically 2-3 unique currencies per request) instead of manual batch math.

2. **Currency name display in picker**
   - What we know: `get_supported_currencies()` returns `{"USD": "United States Dollar", ...}` with both code and name.
   - What's unclear: Whether to show "USD" or "USD - United States Dollar" in the picker.
   - Recommendation: Show "CODE - Name" format. The data is available and it helps users identify less common currencies. This is Claude's discretion per CONTEXT.md.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `backend/app/api/transactions.py` -- all four endpoint patterns verified
- Codebase inspection: `backend/app/services/rates.py` -- `convert_amount`, `fetch_latest_rates`, `get_supported_currencies` signatures and error handling verified
- Codebase inspection: `backend/app/api/rates.py` -- `/rates/currencies` endpoint confirmed working
- Codebase inspection: `frontend/src/screens/*.tsx` -- all bug locations and patterns verified
- Codebase inspection: `frontend/src/api/client.ts` and `transactions.ts` -- API client pattern verified
- Codebase inspection: `frontend/src/constants/config.ts` -- `QUERY_KEYS.CURRENCIES` already defined
- Codebase inspection: `frontend/src/types/api.ts` -- `CurrencyList` type already defined
- `.planning/codebase/CONVENTIONS.md` -- naming, error handling, import conventions
- `.planning/codebase/CONCERNS.md` -- bug diagnoses with exact file:line references

### Tertiary (LOW confidence)
- Frankfurter API rate direction semantics (A1) -- based on standard FX convention, not verified with live call

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, everything already in codebase
- Architecture: HIGH -- patterns directly observed in existing code
- Pitfalls: HIGH -- bugs and edge cases identified from codebase inspection
- Conversion direction: MEDIUM -- standard FX convention but should be verified

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- no fast-moving dependencies)
