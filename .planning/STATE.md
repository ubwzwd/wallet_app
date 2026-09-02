---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: milestone
status: executing
last_updated: "2026-05-25T15:48:15.421Z"
last_activity: 2026-05-25
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 20
  completed_plans: 13
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-02)

**Core value:** Users can record and view financial activity across multiple sources in any currency, with automatic conversion to their preferred base currency.

**Current focus:** Phase 06 — provision-oracle-vm-domain-caddy-https

## Milestone

**v2.0 — Single-VPS Deployment + Mobile-Web Access**

## Phases

| # | Phase | Status | Requirements |
|---|-------|--------|--------------|
| 4 | Containerize and Compose Locally | Complete (2026-05-22) | DEPLOY-01..04, DOMAIN-04, OPS-04, SEC-01 (7) |
| 5 | PWA-ify Frontend + Mobile Polish | Complete (2026-05-25) | PWA-01..04, MOBUI-01..04 (8); MOBUI-05 remapped → Phase 6 |
| 6 | Provision Oracle VM + Domain + Caddy HTTPS | In Progress (4/7 plans) | DEPLOY-05, DOMAIN-01..03, SEC-02, OPS-01, OPS-02, MOBUI-05 (8) |
| 7 | CI/CD + Backups + Polish | Not started | CI-01..03, OPS-03, OPS-05, DEPLOY-06 (6) |

**Coverage:** 29/29 requirements mapped.

## Current Position

Phase: 06 (provision-oracle-vm-domain-caddy-https) — EXECUTING (4 of 7 plans complete)

- **Phase:** 6 (in progress)
- **Plan:** 06-04 complete; 06-05 next (operator-driven RUNBOOK §0-§13 — Oracle VM provision, Cloudflare domain register + A record, SSH/ufw/unattended-upgrades, Docker install, DNS propagation gate, first compose up with LE staging cert, SC4 DB-independence test, SC3 nmap scan)
- **Status:** Executing Phase 06
- **Last activity:** 2026-05-26 — M2 docs reconciled (REQUIREMENTS/ROADMAP/PROJECT/MILESTONES refreshed; scope refinements: Cloudflare Registrar + DNS-only, OPS-03 → R2 + 7d, MOBUI-05 → Phase 6 / 06-07)

## Performance Metrics

- Phases planned: 4
- Phases completed: 2 / 4
- Plans completed: 13 / 20 (Phase 4: 6/6 ✓ · Phase 5: 7/7 ✓ · Phase 6: 4/7 in progress · Phase 7: 0/0)
- Overall progress: 50% (phase-weighted) — Phase 4 + 5 shipped; Phase 6 mid-execution

| Phase | Plan | Completed |
|-------|------|-----------|
| 04 | 01-backend-dockerfile | 2026-05-11 |
| 04 | 02-relocate-dev-compose | 2026-05-21 |
| 04 | 03-frontend-config-split | 2026-05-22 |
| 04 | 04-env-secrets | 2026-05-22 |
| 04 | 05-prod-compose-and-caddy | 2026-05-22 |
| 04 | 06-smoke-and-verify | 2026-05-22 |
| 05 | 01-verification-harness | 2026-05-23 |
| 05 | 02-static-pwa-assets | 2026-05-24 |
| 05 | 03-workbox-sw-pipeline | 2026-05-24 |
| 05 | 04-touch-target-fixes | 2026-05-24 |
| 05 | 05-safe-area-wiring | 2026-05-25 |
| 05 | 06-input-modes | 2026-05-25 |
| 05 | 07-phase-verify-aggregator | 2026-05-25 |
| 06 | 01-caddyfile-acme-hsts | 2026-05-25 |
| 06 | 02-verify-phase6-scaffold | 2026-05-25 |
| 06 | 03-ssh-port-amend | 2026-05-25 |
| 06 | 04-runbook-authoring | 2026-05-26 |

## Accumulated Context

### Decisions

- **Phase numbering continues from v1.0**: first new phase is Phase 4, no reset.
- **Granularity: coarse** (4 phases, balanced grouping per requirement clusters).
- **Platform locked**: Oracle Cloud Always Free, A1.Flex (2 OCPU / 12 GB / Ubuntu 24.04 / ARM64).
- **Container builds: arm64-only** (no multi-arch — saves CI time).
- **Same-origin routing**: Caddy `file_server` serves Expo web export at `/`, reverse-proxies `/api/*` to FastAPI. No separate web container.
- **Postgres tuning** (`shared_buffers≈3GB`) for Oracle's 20%-idle-reclaim mitigation lives in Phase 4 (OPS-04), not a separate phase.
- **Domain layer (2026-05-26)**: Cloudflare Registrar + Cloudflare DNS in DNS-only mode (gray cloud). CF proxy/CDN/WAF deferred to "harden production" — keeps Caddy LE HTTP-01 working without extra plugins.
- **Backup destination (2026-05-26)**: Cloudflare R2 free tier (stays inside the CF stack). 7-day retention, no weekly rollups, no restore drill — defers restore drill to "harden production".
- **MOBUI-05 remapped Phase 5 → Phase 6 (2026-05-26)**: install-prompt + SW registration require the production LE cert; verified inside 06-07 alongside the UptimeRobot drill (per Phase 5 CONTEXT D-13).
- **(04-01) Poetry 1.8.5 in builder image**: plan's `poetry==1.7.1` + `poetry-plugin-export>=1.8` was unresolvable (plugin 1.8 requires Poetry≥1.8); minimum-drift bump preserves the plugin pin and the `poetry export` invocation.
- **(04-01) Strip Poetry/uv from builder /usr/local/bin before stage transition** so runtime image carries only resolved app deps + uvicorn (must_have: "no Poetry/dev tooling in runtime").
- **(04-01) backend/.dockerignore is mandatory companion to Dockerfile.api**: T-04-01 ("no .env in image") fails without it because `COPY . .` would sweep `backend/.env`.
- **(04-03) config.ts header differs from config.dev.ts at rest**: intentional — after `npm run build:web` the cp restore makes them byte-identical (diff -q passes post-build only, not pre-build).
- **(04-04) CADDY_DOMAIN/CADDY_TLS_MODE in .env.example are NOT FastAPI Settings fields**: env-coverage.sh correctly scopes to Settings fields only; these keys are consumed by compose variable interpolation for Caddy.
- **(04-04) env-coverage.sh tamper test nuance**: removing CADDY_* keys doesn't trigger drift; must remove a Settings field (e.g. ENVIRONMENT) to trigger exit 1.

### Open Todos

- Execute Phase 6 plan **06-05** (operator-driven RUNBOOK §0-§13): Oracle VM provision, Cloudflare domain register + A record, SSH/ufw/unattended-upgrades, Docker install, DNS propagation gate, first compose up with LE staging cert, SC4 DB-independence test, SC3 nmap scan
- Then 06-06 (LE staging → prod cert flip) and 06-07 (UptimeRobot + downtime drill + MOBUI-05 real-device install verification)
- Plan Phase 7 (CI/CD + Backups + Polish) once Phase 6 verifies

### Blockers

- None

## Session Continuity

**Last session:** 2026-05-25T14:07:08.517Z

**Next action:** Execute Phase 6 plan 06-05 (operator-driven Oracle VM provision + Cloudflare domain register + first compose up with LE staging cert).

**Files for reference:**

- `.planning/ROADMAP.md` — phase structure, success criteria, requirement mapping
- `.planning/REQUIREMENTS.md` — full requirement list with traceability table
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` — research context
