---
phase: 01-wire-fix-and-harden
plan: 01
subsystem: backend
tags: [currency-conversion, rates-service, transactions, bug-fix]
dependency_graph:
  requires: []
  provides: [live-conversion-fields-in-all-transaction-endpoints]
  affects: [frontend-transaction-display]
tech_stack:
  added: []
  patterns: [helper-function-extraction, batch-http-call, decimal-quantization, graceful-fallback]
key_files:
  created: []
  modified:
    - backend/app/api/transactions.py
decisions:
  - "Use _build_conversion_fields helper for single-tx endpoints (create/get/update) to avoid code duplication"
  - "Use batch fetch_latest_rates for list_transactions to avoid N HTTP calls per list request"
  - "Catch HTTPException (not httpx.HTTPError) — rates_service re-raises as HTTPException after retries"
  - "Division direction: tx.amount / rate where rate = 1 base = rate tx_currency (Pitfall 1 from RESEARCH)"
  - "Keep only the third delete_transaction definition (line 436 original); delete the first two"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-05"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 1
---

# Phase 01 Plan 01: Currency Conversion Wiring Summary

**One-liner:** Wired live Frankfurter ECB rates into all four transaction endpoints using a `_build_conversion_fields` helper and batch `fetch_latest_rates` for list, with graceful 200 fallback on API failure.

## What Was Built

`backend/app/api/transactions.py` now calls `rates_service` in all four transaction endpoints:

- `_build_conversion_fields(tx_currency, tx_amount, base_currency)` helper: calls `convert_amount` for the converted value, then `fetch_latest_rates` for the rate field, returns `(None, None, None)` on same-currency or HTTPException
- `create_transaction`, `get_transaction`, `update_transaction`: each calls `_build_conversion_fields` after `db.refresh()`
- `list_transactions`: single batch `fetch_latest_rates(base_currency, unique_currencies)` call, then divides `tx.amount / rate` with `Decimal("0.0001")` quantization
- Two dead duplicate `delete_transaction` definitions removed; single canonical handler retained

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove duplicate delete handlers and add conversion helper | c66fa33 | backend/app/api/transactions.py |
| 2 | Wire conversion into all four transaction endpoints | c66fa33 | backend/app/api/transactions.py |

Note: Both tasks were implemented in a single atomic rewrite since they are tightly coupled changes to the same file.

## Verification Results

```
syntax check:         OK
delete_transaction:   1  (was 3)
TODO placeholders:    0  (was 4)
_build_conversion_fields: 4  (1 def + 3 calls)
batch_rates in list:  present
except HTTPException: 2  (helper + batch)
```

## Deviations from Plan

None — plan executed exactly as written. Tasks 1 and 2 were combined into a single commit since the structural cleanup and conversion wiring were implemented together in one file rewrite, which is more atomic than splitting across two commits on the same file.

## Known Stubs

None. All four `converted_amount=None` / `conversion_rate=None` / `conversion_date=None` placeholders replaced with live computation. Same-currency and API-failure paths intentionally return null per schema contract.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced. The `_build_conversion_fields` helper catches `HTTPException` from the Frankfurter API call path, satisfying T-01-01 and T-01-02 from the threat model. Rate direction math uses division with explicit quantization per T-01-04 mitigation.

## Self-Check: PASSED

- `backend/app/api/transactions.py` exists and is modified
- Commit `c66fa33` exists in git log
- Syntax check passes
- All acceptance criteria met
