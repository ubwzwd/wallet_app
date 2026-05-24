---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: milestone
status: executing
last_updated: "2026-05-24T16:58:58.858Z"
last_activity: 2026-05-24
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 13
  completed_plans: 6
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-02)

**Core value:** Users can record and view financial activity across multiple sources in any currency, with automatic conversion to their preferred base currency.

**Current focus:** Phase 05 — pwa-ify-frontend-mobile-polish

## Milestone

**v2.0 — Single-VPS Deployment + Mobile-Web Access**

## Phases

| # | Phase | Status | Requirements |
|---|-------|--------|--------------|
| 4 | Containerize and Compose Locally | Not started | DEPLOY-01..04, DOMAIN-04, OPS-04, SEC-01 (7) |
| 5 | PWA-ify Frontend + Mobile Polish | Not started | PWA-01..04, MOBUI-01..05 (9) |
| 6 | Provision Oracle VM + Domain + Caddy HTTPS | Not started | DEPLOY-05, DOMAIN-01..03, SEC-02, OPS-01, OPS-02 (7) |
| 7 | CI/CD + Backups + Polish | Not started | CI-01..03, OPS-03, OPS-05, DEPLOY-06 (6) |

**Coverage:** 29/29 requirements mapped.

## Current Position

Phase: 05 (pwa-ify-frontend-mobile-polish) — EXECUTING
Plan: 1 of 7

- **Phase:** 4 (in progress)
- **Plan:** All 6 plans complete
- **Status:** Executing Phase 05
- **Last activity:** 2026-05-24

## Performance Metrics

- Phases planned: 4
- Phases completed: 0 / 4
- Plans completed: 6 / 6 (Phase 4)
- Overall progress: 100% of Phase 4

| Phase | Plan | Duration | Tasks | Files | Completed |
|-------|------|----------|-------|-------|-----------|
| 04 | 01-backend-dockerfile | ~15 min | 2 | 3 (1 new Dockerfile, 1 new .dockerignore, 1 deleted) | 2026-05-11 |
| 04 | 02-relocate-dev-compose | ~10 min | 2 | 4 (compose moved, README updated, .gitignore) | 2026-05-21 |
| 04 | 03-frontend-config-split | ~15 min | 2 | 4 (config.dev.ts, config.prod.ts, config.ts, package.json) | 2026-05-22 |
| 04 | 04-env-secrets | ~12 min | 2 | 2 (infra/.env.example, infra/scripts/env-coverage.sh) | 2026-05-22 |
| 04 | 05-prod-compose-and-caddy | ~2 min | 2 | 2 (infra/docker-compose.prod.yml, infra/Caddyfile) | 2026-05-22 |
| 04 | 06-smoke-and-verify | ~8 min | 1 | 1 (infra/scripts/smoke.sh) | 2026-05-22 |

## Accumulated Context

### Decisions

- **Phase numbering continues from v1.0**: first new phase is Phase 4, no reset.
- **Granularity: coarse** (4 phases, balanced grouping per requirement clusters).
- **Platform locked**: Oracle Cloud Always Free, A1.Flex (2 OCPU / 12 GB / Ubuntu 24.04 / ARM64).
- **Container builds: arm64-only** (no multi-arch — saves CI time).
- **Same-origin routing**: Caddy `file_server` serves Expo web export at `/`, reverse-proxies `/api/*` to FastAPI. No separate web container.
- **Postgres tuning** (`shared_buffers≈3GB`) for Oracle's 20%-idle-reclaim mitigation lives in Phase 4 (OPS-04), not a separate phase.
- **Backup destination (R2 vs B2 vs S3)**: deferred to Phase 7 planning step.
- **(04-01) Poetry 1.8.5 in builder image**: plan's `poetry==1.7.1` + `poetry-plugin-export>=1.8` was unresolvable (plugin 1.8 requires Poetry≥1.8); minimum-drift bump preserves the plugin pin and the `poetry export` invocation.
- **(04-01) Strip Poetry/uv from builder /usr/local/bin before stage transition** so runtime image carries only resolved app deps + uvicorn (must_have: "no Poetry/dev tooling in runtime").
- **(04-01) backend/.dockerignore is mandatory companion to Dockerfile.api**: T-04-01 ("no .env in image") fails without it because `COPY . .` would sweep `backend/.env`.
- **(04-03) config.ts header differs from config.dev.ts at rest**: intentional — after `npm run build:web` the cp restore makes them byte-identical (diff -q passes post-build only, not pre-build).
- **(04-04) CADDY_DOMAIN/CADDY_TLS_MODE in .env.example are NOT FastAPI Settings fields**: env-coverage.sh correctly scopes to Settings fields only; these keys are consumed by compose variable interpolation for Caddy.
- **(04-04) env-coverage.sh tamper test nuance**: removing CADDY_* keys doesn't trigger drift; must remove a Settings field (e.g. ENVIRONMENT) to trigger exit 1.

### Open Todos

- Run `/gsd-verify-work` against Phase 4 (execute `bash infra/scripts/smoke.sh full` after populating `infra/.env`)
- Begin Phase 05 (PWA-ify Frontend + Mobile Polish)

### Blockers

- None

## Session Continuity

**Last session:** 2026-05-22T18:41:20.372Z

**Next action:** Run `bash infra/scripts/smoke.sh full` (requires `infra/.env` with real values + Docker running) to verify all 5 Phase 4 ROADMAP success criteria.

**Files for reference:**

- `.planning/ROADMAP.md` — phase structure, success criteria, requirement mapping
- `.planning/REQUIREMENTS.md` — full requirement list with traceability table
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` — research context
