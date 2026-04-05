---
phase: 01
slug: wire-fix-and-harden
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-05
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Frankfurter API → rates_service | External HTTP call for currency rates | Rate floats (public ECB data) |
| rates_service → transactions.py | Internal function call | Decimal amounts, currency codes |
| Transaction response → client | JSON serialization | Decimal conversion fields (nullable) |
| .env → config.py DEBUG | Environment variable controls debug/logging behavior | Boolean flag |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-01-01 | Denial of Service | `_build_conversion_fields` in create/get/update | mitigate | `except HTTPException` catches Frankfurter failures; returns `(None, None, None)` — endpoints always return 200 | closed |
| T-01-02 | Denial of Service | `list_transactions` batch fetch | mitigate | Single `fetch_latest_rates` call per list request (not N calls); HTTPException caught → all conversions null rather than 503 | closed |
| T-01-03 | Information Disclosure | `conversion_rate` field in response | accept | Rate data is publicly available from ECB/Frankfurter; no sensitive information disclosed | closed |
| T-01-04 | Tampering | Rate direction math (division vs multiplication) | mitigate | `tx.amount / rate` direction documented in RESEARCH.md Pitfall 1 and code comments; `Decimal("0.0001")` quantize prevents float drift | closed |
| T-01-05 | Spoofing | Transaction endpoint owner check | accept | Existing `Transaction.user_id == current_user.id` filter on every query — unchanged in this plan | closed |
| T-02-01 | Information Disclosure | `DEBUG=True` default in production | mitigate | `DEBUG: bool = False` in config.py; SQL echo gated on `ENVIRONMENT == "development" and settings.DEBUG` | closed |
| T-02-02 | Denial of Service | `/rates/currencies` called on every form open | accept | `staleTime: Infinity` in useQuery — one HTTP call per app session; currencies are static ECB data | closed |
| T-02-03 | Spoofing | `window.confirm` on web (existing behavior retained) | accept | Web confirm is an existing pattern; no regression introduced; this plan adds native Alert.alert only | closed |
| T-02-04 | Tampering | Currency list from API used as-is in picker | accept | Currencies are read-only display data; backend validates currency codes on transaction creation | closed |
| T-02-05 | Denial of Service | Missing else branch in `handleDelete` silently swallowing native delete intent | mitigate | Explicit `else` branch added so native delete fires `Alert.alert` correctly — improves availability of delete feature on native | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-03 | ECB/Frankfurter rate data is publicly available; exposing conversion_rate in API response does not disclose sensitive information | plan author | 2026-04-05 |
| AR-02 | T-01-05 | Owner check (`user_id == current_user.id`) is an existing control unchanged by this plan; re-acceptance documents scope boundary | plan author | 2026-04-05 |
| AR-03 | T-02-02 | `staleTime: Infinity` limits `/rates/currencies` to one call per session; currency list is static ECB data that rarely changes | plan author | 2026-04-05 |
| AR-04 | T-02-03 | `window.confirm` on web is an existing pattern; this plan's scope is native Alert.alert — no regression introduced | plan author | 2026-04-05 |
| AR-05 | T-02-04 | Currency list is display-only; selection writes only the currency code string to the form; backend validates on save | plan author | 2026-04-05 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-05 | 10 | 10 | 0 | gsd-secure-phase (static — all mitigations confirmed by phase verifier) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter
