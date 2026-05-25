# Milestones

## v1.0 — Finish What's Started (Shipped 2026-04-21)

**Goal:** Complete half-built features and fix known bugs in the wallet app.

**Scope:** 3 phases, 7 plans, 16 requirements (CONV / CURR / BUG / XFER / PROF), ~14,000 LOC (Python + TypeScript + TSX).

**Delivered:**

- **Phase 1 — Wire, Fix, and Harden**
  - Currency conversion wired into all 4 transaction endpoints (create, get, update, list) with graceful fallback when Frankfurter is unreachable (CONV-01..03).
  - Live 31+ ECB currency picker replacing the hardcoded 6 in TransactionFormScreen + FinanceSourceFormScreen (CURR-01..03).
  - Bug fixes: removed duplicate `delete_transaction` handler, native delete-confirmation Alert on iOS/Android, native archive-error alert, `DEBUG=False` as default (BUG-01..04).
- **Phase 2 — Complete Transfer Transactions**
  - Two-step transfer wizard (FROM/TO source selection → amount/date/description) creating paired transactions linked by `transfer_pair_id` UUID (XFER-01..03).
  - Transfer edit mode with cache-aware paired-leg update.
- **Phase 3 — User Profile Management**
  - `PATCH /auth/me` endpoint + `UserUpdate` Pydantic schema for `base_currency` updates (PROF-01).
  - Frontend ProfileScreen with currency picker + HomeScreen Quick Actions wiring (PROF-02).
  - Auto-set `default_source_id` on first finance source creation for new users (PROF-03).

**Tech stack at v1.0 ship:** FastAPI 0.104+, SQLAlchemy 2, PostgreSQL 15, React Native / Expo SDK 54, TypeScript 5.9.

**Known limitations carried into v2.0:**

- 13 human verification items deferred to live UAT (native delete/archive alerts, live Frankfurter conversion, live PostgreSQL session persistence) — documented in [v1-MILESTONE-AUDIT.md](v1-MILESTONE-AUDIT.md).
- No automated test coverage for the transfer wizard or profile updates beyond Jest config scaffolding.

**Archived planning artifacts:** [milestones/1.0-REQUIREMENTS.md](milestones/1.0-REQUIREMENTS.md), [milestones/1.0-ROADMAP.md](milestones/1.0-ROADMAP.md).

---

<!--
v2.0 entry will be appended here by /gsd-complete-milestone once Phase 6 + Phase 7 ship.
Currently v2.0 is in progress; active planning lives in .planning/REQUIREMENTS.md + .planning/ROADMAP.md.
-->
