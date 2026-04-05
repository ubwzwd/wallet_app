---
phase: 01
slug: wire-fix-and-harden
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-05
---

# Phase 01 — Validation Strategy

> Retroactively reconstructed from 01-01-SUMMARY.md and 01-02-SUMMARY.md (State B).
> All gaps filled via /gsd-validate-phase on 2026-04-05.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (backend)** | pytest 9.0 |
| **Config file (backend)** | `backend/pyproject.toml` — `[tool.pytest.ini_options]` |
| **Quick run command** | `cd backend && python3 -m pytest tests/ -q` |
| **Full suite command** | `cd backend && python3 -m pytest tests/ -v` |
| **Framework (frontend)** | jest 30 + jest-expo |
| **Config file (frontend)** | `frontend/jest.config.js` |
| **Frontend run command** | `cd frontend && npm test` |
| **Estimated runtime** | ~2s backend · ~10s frontend |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && python3 -m pytest tests/ -q`
- **After every plan wave:** Run full backend + frontend suites
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | BUG-01 | T-01-05 | Exactly one delete_transaction handler (no shadowed route) | static AST | `python3 -m pytest tests/test_transactions_structure.py::test_exactly_one_delete_transaction_handler -v` | ✅ | ✅ green |
| 01-01-T2 | 01 | 1 | CONV-01 | T-01-04 | cross-currency tx returns non-null converted_amount, rate, date | unit | `python3 -m pytest tests/test_conversion.py::TestBuildConversionFieldsCrossCurrency -v` | ✅ | ✅ green |
| 01-01-T2 | 01 | 1 | CONV-02 | T-01-04 | _build_conversion_fields called in create/get/update; batch fetch in list | static + unit | `python3 -m pytest tests/test_transactions_structure.py tests/test_conversion.py -v` | ✅ | ✅ green |
| 01-01-T2 | 01 | 1 | CONV-03 | T-01-01 / T-01-02 | HTTPException from rates_service → 200 with null fields, never 503 | unit | `python3 -m pytest tests/test_conversion.py::TestBuildConversionFieldsAPIFailure -v` | ✅ | ✅ green |
| 01-02-T1 | 02 | 1 | BUG-02 | T-02-05 | handleDelete fires Alert.alert on native with correct title/buttons | source + unit | `cd frontend && npm test -- --testPathPattern=TransactionsScreen` | ✅ | ✅ green |
| 01-02-T1 | 02 | 1 | BUG-03 | — | archiveMutation.onError calls Alert.alert('Error') on native | source | `cd frontend && npm test -- --testPathPattern=FinanceSourcesScreen` | ✅ | ✅ green |
| 01-02-T2 | 02 | 1 | CURR-01 | T-02-02 | TransactionFormScreen fetches currencies via QUERY_KEYS.CURRENCIES | source | `cd frontend && npm test -- --testPathPattern=CurrencyPicker` | ✅ | ✅ green |
| 01-02-T2 | 02 | 1 | CURR-02 | T-02-02 | FinanceSourceFormScreen fetches currencies via QUERY_KEYS.CURRENCIES | source | `cd frontend && npm test -- --testPathPattern=CurrencyPicker` | ✅ | ✅ green |
| 01-02-T2 | 02 | 1 | CURR-03 | T-02-04 | Native: Modal+FlatList; Web: horizontal scroll | source | `cd frontend && npm test -- --testPathPattern=CurrencyPicker` | ✅ | ✅ green |
| 01-02-T3 | 02 | 1 | BUG-04 | T-02-01 | DEBUG=False by default; SQL echo off unless ENVIRONMENT=development AND DEBUG=True | unit | `python3 -m pytest tests/test_config.py -v` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All test infrastructure was created retroactively during /gsd-validate-phase:

- [x] `backend/tests/__init__.py` — package marker
- [x] `backend/tests/conftest.py` — mocks psycopg2/jose/passlib for dependency-free unit tests
- [x] `backend/tests/test_config.py` — BUG-04 coverage
- [x] `backend/tests/test_conversion.py` — CONV-01/02/03 coverage (16 tests)
- [x] `backend/tests/test_transactions_structure.py` — BUG-01/CONV-02 static AST checks (7 tests)
- [x] `frontend/jest.config.js` — jest-expo preset with @/ alias mapping
- [x] `frontend/__tests__/TransactionsScreen.test.ts` — BUG-02 (12 assertions)
- [x] `frontend/__tests__/FinanceSourcesScreen.test.ts` — BUG-03 (5 assertions)
- [x] `frontend/__tests__/CurrencyPicker.test.ts` — CURR-01/02/03 + rates.ts (20 assertions)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Audit 2026-04-05

| Metric | Count |
|--------|-------|
| Gaps found | 10 |
| Resolved (automated) | 10 |
| Escalated (manual-only) | 0 |

### Test Counts

| Suite | Tests | Result |
|-------|-------|--------|
| `backend/tests/test_config.py` | 4 | ✅ all green |
| `backend/tests/test_conversion.py` | 16 | ✅ all green |
| `backend/tests/test_transactions_structure.py` | 7 | ✅ all green |
| `frontend/__tests__/TransactionsScreen.test.ts` | 12 assertions | ✅ all green |
| `frontend/__tests__/FinanceSourcesScreen.test.ts` | 5 assertions | ✅ all green |
| `frontend/__tests__/CurrencyPicker.test.ts` | 20 assertions | ✅ all green |
| **Total** | **64** | **✅ 64/64** |

---

## Validation Sign-Off

- [x] All tasks have automated verification
- [x] Sampling continuity: no task without automated verify
- [x] All MISSING gaps resolved — no manual-only required
- [x] No watch-mode flags in any test command
- [x] Feedback latency < 15s (backend ~2s, frontend ~10s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-05
