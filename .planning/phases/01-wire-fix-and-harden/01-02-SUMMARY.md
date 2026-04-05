---
phase: 01-wire-fix-and-harden
plan: 02
subsystem: frontend, backend
tags: [currency-picker, alert-native, bug-fix, security-hardening, rates-api]
dependency_graph:
  requires: []
  provides: [native-delete-confirmation, live-currency-picker, debug-false-default]
  affects: [TransactionsScreen, TransactionFormScreen, FinanceSourceFormScreen, backend-config]
tech_stack:
  added: []
  patterns: [platform-branching, useQuery-with-staleTime, modal-flatlist, fallback-while-loading]
key_files:
  created:
    - frontend/src/api/rates.ts
  modified:
    - frontend/src/screens/TransactionsScreen.tsx
    - frontend/src/screens/FinanceSourcesScreen.tsx
    - frontend/src/screens/TransactionFormScreen.tsx
    - frontend/src/screens/FinanceSourceFormScreen.tsx
    - backend/app/core/config.py
    - backend/app/core/database.py
decisions:
  - "staleTime: Infinity for currency list — ECB currencies change infrequently, one fetch per session is sufficient"
  - "Fallback to 6-item hardcoded list while loading — prevents empty picker on first render before query resolves"
  - "Platform.OS === 'web' branch uses existing horizontal button row; native gets FlatList modal"
  - "DEBUG=False as default — SQL logging only enabled when ENVIRONMENT=development AND DEBUG=True both set"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-05"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 6
---

# Phase 01 Plan 02: Bug Fixes and Currency Picker Wiring Summary

**One-liner:** Added native Alert.alert confirmation dialogs for delete and archive actions, replaced hardcoded 6-currency arrays with live ECB fetch via new rates.ts module with FlatList modal for native and horizontal scroll for web, and hardened backend by defaulting DEBUG to False with environment-gated SQL echo.

## What Was Built

### Task 1: BUG-02 and BUG-03 Fixes

**TransactionsScreen.tsx:**
- Added `Alert` to react-native import
- Replaced the no-op `handleDelete` (which had only a web branch) with a full Platform-branched version
- On web: `window.confirm` with `${title}\n\n${message}` format
- On native: `Alert.alert(title, message, buttons)` with:
  - Cancel: `{ text: cancelLabel, style: 'cancel' }` ("Keep Transaction" or "Keep Transfer")
  - Confirm: `{ text: confirmLabel, style: 'destructive', onPress: () => deleteMutation.mutate(id) }` ("Delete Transaction" or "Delete Transfer")
  - Labels branch on `isTransfer` per UI-SPEC.md copywriting contract

**FinanceSourcesScreen.tsx:**
- Native Alert.alert branch in `archiveMutation.onError` was already present; updated fallback message to include "Check your connection and try again." per UI-SPEC.md

### Task 2: CURR-01/02/03 — Live Currency Picker

**frontend/src/api/rates.ts** (new file):
- Exports `getCurrencies(): Promise<CurrencyList>` calling `GET /rates/currencies` via `apiClient`
- Returns the full `CurrencyList` type (`{ currencies: Record<string, string> }`)

**TransactionFormScreen.tsx:**
- Added `Modal`, `TouchableOpacity`, `FlatList` to react-native imports
- Added `* as ratesApi from '@/api/rates'` import
- Removed `const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD']`
- Added `currencyPickerVisible` state
- Added `useQuery({ queryKey: [QUERY_KEYS.CURRENCIES], queryFn: ratesApi.getCurrencies, staleTime: Infinity })`
- Derives `currencies` from `Object.keys(currencyData.currencies).sort()` with 6-item fallback
- Platform-branched currency picker: web = horizontal ScrollView of Buttons; native = TouchableOpacity trigger + full-screen Modal with FlatList
- Modal: title "Select Currency", "Close" button, items formatted as "CODE - Full Name", selected item background `#eff6ff`
- Added 12 new styles for modal components

**FinanceSourceFormScreen.tsx:**
- Same pattern applied: `Modal`, `TouchableOpacity`, `FlatList`, `Platform` added to imports
- Added `useQuery` to tanstack-query imports
- Added `* as ratesApi` import
- Removed `const CURRENCIES` array
- Added currencies query with same `staleTime: Infinity` and fallback
- Same Platform-branched picker UI as TransactionFormScreen
- Added same 12 modal styles

### Task 3: BUG-04 — Backend Config Hardening

**backend/app/core/config.py:**
- Changed `DEBUG: bool = True` to `DEBUG: bool = False`

**backend/app/core/database.py:**
- Changed `echo=settings.DEBUG` to `echo=(settings.ENVIRONMENT == "development" and settings.DEBUG)`
- SQL query logging now requires both ENVIRONMENT=development AND DEBUG=True to be active

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix BUG-02 (native delete confirmation) and BUG-03 (archive error fallback) | 434729e | TransactionsScreen.tsx, FinanceSourcesScreen.tsx |
| 2 | Create rates.ts API module and replace hardcoded currency pickers | bb64f4b | rates.ts (new), TransactionFormScreen.tsx, FinanceSourceFormScreen.tsx |
| 3 | Fix BUG-04 — DEBUG defaults to False, SQL echo gated on ENVIRONMENT | 96f6bec | config.py, database.py |

## Verification Results

```
BUG-02 Alert.alert in TransactionsScreen:     OK
Keep Transaction / Keep Transfer labels:       OK (in ternary on same line)
Delete Transaction / Delete Transfer labels:   OK
style: 'destructive' on confirm:              OK
style: 'cancel' on cancel:                    OK
BUG-03 Alert.alert('Error') in FinanceSources: OK
rates.ts exists:                               OK
getCurrencies export:                          OK
QUERY_KEYS.CURRENCIES in TransactionForm:     OK
QUERY_KEYS.CURRENCIES in FinanceSourceForm:   OK
No const CURRENCIES in TransactionForm:       0 (removed)
No const CURRENCIES in FinanceSourceForm:     0 (removed)
Modal in both form screens:                   OK
Select Currency modal title in both:          OK
staleTime: Infinity in both:                  OK
DEBUG: bool = False in config.py:             OK
echo=(ENVIRONMENT == 'development' and DEBUG): OK
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated FinanceSourcesScreen fallback error message**
- **Found during:** Task 1
- **Issue:** The `archiveMutation.onError` fallback `'Failed to update finance source'` did not include the UI-SPEC.md mandated suffix "Check your connection and try again."
- **Fix:** Updated to `'Failed to update finance source. Check your connection and try again.'`
- **Files modified:** frontend/src/screens/FinanceSourcesScreen.tsx
- **Commit:** 434729e

## Known Stubs

None. All currency arrays replaced with live data. Fallback arrays are intentional loading-state behavior, not stubs — the query will resolve and repopulate the list.

## Threat Flags

T-02-01 (DEBUG=True default) mitigated: `config.py` now has `DEBUG: bool = False`. SQL echo gated on both ENVIRONMENT and DEBUG per threat model mitigation plan.

No new network endpoints or auth paths introduced beyond the frontend-to-existing-backend `/rates/currencies` call (already exists, already authenticated via apiClient).

## Self-Check: PASSED

- `frontend/src/api/rates.ts` exists: YES
- `frontend/src/screens/TransactionsScreen.tsx` modified: YES
- `frontend/src/screens/FinanceSourcesScreen.tsx` modified: YES
- `frontend/src/screens/TransactionFormScreen.tsx` modified: YES
- `frontend/src/screens/FinanceSourceFormScreen.tsx` modified: YES
- `backend/app/core/config.py` modified: YES
- `backend/app/core/database.py` modified: YES
- Commit `434729e` in git log: YES
- Commit `bb64f4b` in git log: YES
- Commit `96f6bec` in git log: YES
