---
phase: 04-containerize-and-compose-locally
plan: 04
subsystem: infra
tags: [env, secrets, docker, bash, security]

requires:
  - phase: 04-02-relocate-dev-compose
    provides: gitignore entry for infra/.env (live secrets file stays out of git)

provides:
  - infra/.env.example with D-16 canonical CHANGE_ME_* sentinel keys (13 keys)
  - infra/scripts/env-coverage.sh — Settings-vs-.env.example drift checker (exits 1 on drift)

affects:
  - 04-05-prod-compose-and-caddy (needs .env.example as env_file schema reference)
  - 04-06-smoke-and-verify (calls env-coverage.sh as Wave-0 smoke assertion)

tech-stack:
  added: []
  patterns:
    - CHANGE_ME_* sentinel placeholders in .env.example — loud crash on miss-substitution rather than silent defaults
    - Bash drift-check pattern (comm -23 on sorted lists) for Settings vs .env.example coverage

key-files:
  created:
    - infra/.env.example
    - infra/scripts/env-coverage.sh
  modified: []

key-decisions:
  - "CADDY_DOMAIN and CADDY_TLS_MODE included in .env.example despite not being FastAPI Settings fields — they are consumed by docker-compose variable interpolation for Caddy config"
  - "API_V1_PREFIX and PROJECT_NAME excluded — both have safe defaults in Settings and are not phase-relevant (per 04-PATTERNS.md)"
  - "env-coverage.sh checks Settings fields only (not all .env.example keys) — correct scope: the script validates FastAPI coverage, not Caddy config"

patterns-established:
  - "Sentinel placeholder convention: CHANGE_ME_<KEY_NAME> causes loud startup failures rather than silent weak-key compromise"
  - "Coverage script pattern: comm -23 on sorted field lists — O(n) drift detection, no external deps"

requirements-completed:
  - SEC-01
  - DEPLOY-04

duration: 12min
completed: 2026-05-22
---

# Plan 04-04: Env Secrets Summary

**`infra/.env.example` with 13 CHANGE_ME_* sentinel keys and `env-coverage.sh` drift checker — all 8 FastAPI Settings fields covered, exits 1 on schema drift**

## Performance

- **Duration:** ~12 min (stalled agent recovered inline)
- **Started:** 2026-05-21T15:57:48Z
- **Completed:** 2026-05-22T08:20:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Authored `infra/.env.example` with all D-16 canonical keys (Postgres trio, FastAPI JWT/auth, CORS, exchange-rate, environment metadata, Caddy domain/TLS)
- Authored `infra/scripts/env-coverage.sh` — parses `Settings` fields from `backend/app/core/config.py` and diffs against `.env.example` keys; exits 0 when all 8 fields covered
- Verified: `bash infra/scripts/env-coverage.sh` exits 0 against new `.env.example`

## Task Commits

1. **Task 1: Author infra/.env.example** — `47ff20d` (chore)
2. **Task 2: Author infra/scripts/env-coverage.sh** — `8b0846e` (feat)

## Files Created/Modified
- `infra/.env.example` — 13-key template with CHANGE_ME_* sentinels; schema reference for prod compose
- `infra/scripts/env-coverage.sh` — executable drift checker; called by Plan 06 smoke test

## Decisions Made
- CADDY_DOMAIN / CADDY_TLS_MODE included in .env.example (consumed by compose variable interpolation) but excluded from env-coverage.sh check (not FastAPI Settings fields) — correct scope
- Used `comm -23` on sorted lists rather than line-by-line grep — handles multi-field Settings classes cleanly

## Deviations from Plan

### Auto-fixed Issues

**1. Acceptance test tamper scenario does not trigger drift**
- **Found during:** Task 2 verification
- **Issue:** Plan's tamper test removes the last 2 lines of `.env.example` (CADDY_DOMAIN, CADDY_TLS_MODE). These are NOT Settings fields in `config.py`, so `env-coverage.sh` correctly exits 0 even after removal — no drift from the FastAPI perspective.
- **Fix:** Accepted as-is. The script works correctly. The plan's tamper test has a subtle error (should remove a Settings field like ENVIRONMENT to trigger drift). Noted here for future reference.
- **Verification:** `bash infra/scripts/env-coverage.sh` exits 0 normally; removing an actual Settings-field line (e.g. `ENVIRONMENT=production`) from `.env.example` does cause the script to exit 1.

---

**Total deviations:** 1 (plan tamper test targets non-Settings keys; script behavior is correct)
**Impact on plan:** No functional impact. env-coverage.sh correctly enforces Settings coverage.

## Issues Encountered
- Original executor agent stalled mid-execution (node_modules incomplete in worktree, no completion signal received); completed inline by orchestrator.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- `infra/.env.example` ready for Plan 05 to reference as `env_file` schema
- `infra/scripts/env-coverage.sh` ready for Plan 06 smoke test (row 04-06-03)
- Copy `infra/.env.example` → `infra/.env` and substitute all CHANGE_ME_* values before running prod compose

---
*Phase: 04-containerize-and-compose-locally*
*Completed: 2026-05-22*
