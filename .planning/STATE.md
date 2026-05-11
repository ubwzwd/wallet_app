---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: milestone
status: executing
last_updated: "2026-05-11T15:25:58Z"
last_activity: 2026-05-11
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 6
  completed_plans: 1
  percent: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-02)

**Core value:** Users can record and view financial activity across multiple sources in any currency, with automatic conversion to their preferred base currency.

**Current focus:** Phase 04 — containerize-and-compose-locally

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

Phase: 04 (containerize-and-compose-locally) — EXECUTING
Plan: 2 of 6 (next: 04-02-relocate-dev-compose)

- **Phase:** 4 (in progress)
- **Plan:** 04-01 complete; 04-02 next
- **Status:** Executing Phase 04
- **Last activity:** 2026-05-11

## Performance Metrics

- Phases planned: 4
- Phases completed: 0 / 4
- Plans completed: 1 / 6 (Phase 4)
- Overall progress: 17%

| Phase | Plan | Duration | Tasks | Files | Completed |
|-------|------|----------|-------|-------|-----------|
| 04 | 01-backend-dockerfile | ~15 min | 2 | 3 (1 new Dockerfile, 1 new .dockerignore, 1 deleted) | 2026-05-11 |

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

### Open Todos

- Execute plan 04-02 (relocate dev compose to infra/, update README docker paths)
- Execute plans 04-03..04-06 (frontend config split, env-secrets, prod compose+caddy, smoke)

### Blockers

- None

## Session Continuity

**Last session:** 2026-05-11 — Completed plan 04-01-backend-dockerfile. Image builds for linux/arm64, runs as uid 1000, no .env / no Poetry baked in, urllib healthcheck. Commits: 2a0755f (Task 1), bc97cde (Task 2).

**Next action:** Execute plan 04-02-relocate-dev-compose (move backend/docker-compose.yml to infra/docker-compose.dev.yml, update README docker paths).

**Files for reference:**

- `.planning/ROADMAP.md` — phase structure, success criteria, requirement mapping
- `.planning/REQUIREMENTS.md` — full requirement list with traceability table
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` — research context
