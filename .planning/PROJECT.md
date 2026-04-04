# Wallet App

## What This Is

A personal finance wallet application for tracking transactions across multiple finance sources (accounts, wallets, cards) with multi-currency support. Built as a full-stack monorepo: FastAPI + PostgreSQL backend with a React Native / Expo frontend targeting iOS, Android, and Web.

## Core Value

Users can record and view their financial activity across multiple sources in any currency, with automatic conversion to their preferred base currency.

## Requirements

### Validated

- ✓ User registration and login with JWT authentication — existing
- ✓ Finance source management (create, archive, list) — existing
- ✓ Transaction CRUD (income, expense, transfer skeleton) — existing
- ✓ Multi-currency support via Frankfurter ECB rates API — existing
- ✓ Transaction tagging — existing
- ✓ Transaction filtering by date range, source, type — existing

### Active

- [ ] Currency conversion wired into transaction responses (converted_amount, conversion_rate, conversion_date populated)
- [ ] Transfer transaction creation UI complete (two-step form, transfer_pair_id linking)
- [ ] Frontend currency picker fetches live list from /rates/currencies instead of hardcoded 6
- [ ] Duplicate delete_transaction route handler cleaned up (dead code removed)
- [ ] Native platform delete confirmation (Alert.alert for iOS/Android, not just window.confirm)
- [ ] PATCH /auth/me endpoint for updating profile (base_currency, default_source_id)
- [ ] DEBUG=False as default; ENVIRONMENT-gated debug features

### Out of Scope

- Budgets / spending limits — deferred to future milestone
- Analytics / reports / charts — deferred to future milestone
- Recurring transactions — deferred to future milestone
- Multi-user / shared wallets — deferred to future milestone
- Push notifications — deferred to future milestone
- OAuth / social login — email+password sufficient for M1
- CI/CD pipeline — not in current scope

## Context

The backend has a complete `rates_service` with `convert_amount` and `fetch_latest_rates` functions, but the four transaction endpoints never call it — `converted_amount` is hardcoded to `None` in every response. The wiring step was skipped.

Transfer transactions have a full backend data model (`transfer_pair_id` on `Transaction`, delete cascade logic) but the creation UI is permanently disabled with "coming soon" text. The two-step form needs to be built.

The frontend currency picker in both `TransactionFormScreen` and `FinanceSourceFormScreen` hardcodes 6 currencies; the backend already exposes `/rates/currencies` returning 31+ options.

There are no tests anywhere. Dev dependencies (`pytest`, `pytest-asyncio`) are declared in `pyproject.toml` but no test files exist.

Security risks to address before production: insecure `SECRET_KEY` default, `DEBUG=True` default, no rate limiting on auth endpoints, `python-jose` CVE exposure.

## Constraints

- **Tech Stack**: FastAPI backend (Python 3.11, SQLAlchemy 2, PostgreSQL 15), React Native frontend (Expo SDK 54, TypeScript ~5.9)
- **API Contract**: Frontend `src/types/api.ts` mirrors backend Pydantic schemas — both must be updated in sync
- **Platform**: App targets iOS, Android, and Web; any UI additions must handle platform differences (no raw `<select>` / `<input>` without `Platform.OS` guards)
- **Auth**: Stateless JWT; no server-side sessions; token stored in AsyncStorage
- **No new dependencies**: Prefer wiring existing infrastructure over adding libraries

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Brownfield init — no codebase mapping needed | Codebase map already existed from prior /gsd-map-codebase run | — Pending |
| Milestone 1 scope: finish what's started | User chose to complete existing half-built features before adding new ones | — Pending |
| Coarse granularity | Fewer broader phases preferred for this milestone | — Pending |
| YOLO mode | Auto-approve execution | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-05 after initialization*
