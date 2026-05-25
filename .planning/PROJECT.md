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
- ✓ Currency conversion wired into transaction responses (converted_amount, conversion_rate, conversion_date populated) — v1.0
- ✓ Transfer transaction creation UI complete (two-step form, transfer_pair_id linking) — v1.0
- ✓ Frontend currency picker fetches live list from /rates/currencies instead of hardcoded 6 — v1.0
- ✓ Duplicate delete_transaction route handler cleaned up (dead code removed) — v1.0
- ✓ Native platform delete confirmation (Alert.alert for iOS/Android, not just window.confirm) — v1.0
- ✓ PATCH /auth/me endpoint for updating profile (base_currency, default_source_id) — v1.0
- ✓ DEBUG=False as default; ENVIRONMENT-gated debug features — v1.0

### Validated — v2.0

Phase 4 (Containerize and Compose Locally, shipped 2026-05-22):

- ✓ DEPLOY-01 — production docker-compose stack (separate from dev)
- ✓ DEPLOY-02 — multi-stage arm64 backend Dockerfile (non-root, uv builder)
- ✓ DEPLOY-03 — frontend served as `expo export -p web` via Caddy `file_server`
- ✓ DEPLOY-04 — Alembic one-shot migrate service before API takes traffic
- ✓ DOMAIN-04 — same-origin routing via Caddy (`/api/*` → FastAPI)
- ✓ OPS-04 — Postgres tuned `shared_buffers≈3GB` for Oracle idle-reclaim mitigation
- ✓ SEC-01 — `.env` gitignored + `infra/.env.example` + `env-coverage.sh` drift check

Phase 5 (PWA + Mobile Polish, shipped 2026-05-25):

- ✓ PWA-01 — `manifest.json` with name/short_name/start_url/display=standalone/theme+background_color/192+512 maskable icons
- ✓ PWA-02 — iOS meta tags + apple-touch-icon (180×180)
- ✓ PWA-03 — viewport meta with `viewport-fit=cover`
- ✓ PWA-04 — Workbox SW (cache-first JS/CSS/fonts/img; network-first `/index.html` + `/api/*`)
- ✓ MOBUI-01 — touch targets ≥44×44 (single-point fix in `Button.tsx` + spot fixes)
- ✓ MOBUI-02 — safe-area-inset wiring via `react-native-safe-area-context`
- ✓ MOBUI-03 — global `font-size: 16px` on inputs (no iOS zoom-on-focus)
- ✓ MOBUI-04 — `inputMode="decimal"` on amount; `type="email"` on auth forms

### Active — v2.0 (remaining)

Phase 6 (Provision Oracle VM + Domain + Caddy HTTPS, in execution — 4 of 7 plans done):

- [ ] DEPLOY-05, DOMAIN-01, DOMAIN-02, DOMAIN-03, SEC-02, OPS-01, OPS-02, MOBUI-05 (deferred from Phase 5; verified post 06-06 cert flip)

Phase 7 (CI/CD + Backups + Polish, not started):

- [ ] CI-01, CI-02, CI-03, OPS-03 (downgraded to R2 free tier / 7-day / no restore drill), OPS-05 (P2), DEPLOY-06 (P2)

## Current Milestone: v2.0 Single-VPS Deployment + Mobile-Web Access

**Goal:** Get the wallet app running publicly on a single VPS so it's usable from PC and phone (via mobile browser / installable PWA), with custom domain and HTTPS.

**Target features:**
- Containerize FastAPI backend + Postgres for production (Docker images, env-based config)
- Single `docker-compose.yml` orchestrating frontend (Expo web export) + backend + Postgres on one VM
- Caddy/Nginx reverse proxy with auto-HTTPS via Let's Encrypt
- Custom domain registered via Cloudflare Registrar + Cloudflare DNS (DNS-only / gray cloud) pointed at Oracle VM
- VM provisioned on **Oracle Cloud Always Free, VM.Standard.A1.Flex (Ampere ARM64), 2 OCPU / 12 GB RAM, Ubuntu 24.04** (user has the account; Singapore-region or whichever region had Ampere capacity)
- Container images built **arm64-only** (no multi-arch — saves CI time; rebuild if platform ever changes)
- Postgres tuned with `shared_buffers ≈ 3 GB` (~25% of 12 GB) so memory utilization stays comfortably above Oracle's 20% idle-reclaim threshold
- PWA-flavored web build — manifest + service worker so the deployed URL is "Add to Home Screen"-installable
- Mobile-responsive layout verified on real phone screens
- Daily `pg_dump` cron pushing backups to Cloudflare R2 free tier (7-day retention, no restore drill for v2.0)
- Minimal CI/CD: GitHub Actions builds on push to `main`, pushes to GHCR, SSH-deploys
- Health endpoint + free uptime monitor
- Production secrets handling (env file on VM, not in git)

**Out of milestone scope:** native EAS builds (deferred to M2 Android / M6 iOS), Sentry/Loki/Grafana, log aggregation, DB replication, multi-region.

### Out of Scope

- Budgets / spending limits — deferred to future milestone
- Analytics / reports / charts — deferred to future milestone
- Recurring transactions — deferred to future milestone
- Multi-user / shared wallets — deferred to future milestone
- Push notifications — deferred to future milestone
- OAuth / social login — email+password sufficient for M1

## Context

**Shipped v1.0** (2026-04-21): 3 phases, 7 plans, ~14,000 LOC (Python/TypeScript/TSX combined)

**What was delivered:**
- Backend: Currency conversion wiring into all 4 transaction endpoints (create, get, update, list) with graceful Frankfurter API failure handling
- Frontend: Live 31+ ECB currency picker (replacing hardcoded 6) with platform-specific modals (FlatList on native, ScrollView on web)
- Transfer UI: Complete two-step form wizard (select FROM/TO sources, enter amount/date/description) with transfer_pair_id linking
- User Profile: PATCH /auth/me endpoint + ProfileScreen for base_currency updates; auto-default_source_id on first source creation
- Security: DEBUG=False default; SQL echo gated on ENVIRONMENT; native Alert.alert dialogs for delete/archive errors
- Bug Fixes: Removed duplicate delete_transaction route handler (was defined twice)

**Tech stack:** FastAPI 0.104+ (backend), React Native 0.75+/Expo SDK 54 (frontend), SQLAlchemy 2, PostgreSQL 15, TypeScript 5.9

**Known gaps (for v1.1+):** 
- 13 human verification items pending (native platform testing, live PostgreSQL backend, device-specific alert behavior)
- No test automation for transfer UI or profile updates (Jest config added, tests follow)
- Session persistence edge cases on live PostgreSQL (Phase 3-03 fix validated against SQLite in-memory)

## Constraints

- **Tech Stack**: FastAPI backend (Python 3.11, SQLAlchemy 2, PostgreSQL 15), React Native frontend (Expo SDK 54, TypeScript ~5.9)
- **API Contract**: Frontend `src/types/api.ts` mirrors backend Pydantic schemas — both must be updated in sync
- **Platform**: App targets iOS, Android, and Web; any UI additions must handle platform differences (no raw `<select>` / `<input>` without `Platform.OS` guards)
- **Auth**: Stateless JWT; no server-side sessions; token stored in AsyncStorage
- **No new dependencies**: Prefer wiring existing infrastructure over adding libraries

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Brownfield init — no codebase mapping needed | Codebase map already existed from prior /gsd-map-codebase run | ✓ Good — saved context window |
| Milestone 1 scope: finish what's started | User chose to complete existing half-built features before adding new ones | ✓ Good — delivered all v1.0 items |
| Coarse granularity (3 phases) | Fewer broader phases preferred for this milestone | ✓ Good — reduced planning overhead, natural feature boundaries |
| YOLO mode | Auto-approve execution | ✓ Good — rapid iteration; audit caught gaps early |
| Phase 2 VERIFICATION.md created late | Phase 2 code was complete but lacking formal verification; added on 2026-04-21 before milestone closure | ✓ Good — documentation backfill prevented milestone blocker |
| Human verification deferred to UAT | 13 items require native device/platform testing; documented in VERIFICATION.md | — Pending — allocate 4-6 hours for QA testing |

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
*Last updated: 2026-05-26 — v2.0 in progress; Phase 4 (containerize) + Phase 5 (PWA + mobile polish) shipped; Phase 6 (Oracle VM + Cloudflare domain + Caddy HTTPS) in execution at 4/7 plans; Phase 7 (CI/CD + backups + polish) not started. Scope refinements: Cloudflare Registrar + DNS-only added to DOMAIN-01; MOBUI-05 remapped Phase 5 → Phase 6; OPS-03 downgraded to R2 free tier + 7-day retention + no restore drill.*
