---
phase: 04-containerize-and-compose-locally
verified: 2026-05-22T12:00:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Browser DevTools shows zero CORS preflight (OPTIONS) requests on /api/* calls"
    expected: "No OPTIONS rows appear in DevTools Network tab when logged in and browsing transactions at https://localhost"
    why_human: "Same-origin enforcement can only be confirmed by a real browser — there is no headless equivalent that proves the absence of OPTIONS preflights semantically"
  - test: "tls internal self-signed cert is accepted after clicking through browser warning"
    expected: "Browser shows 'Not Secure' warning; user clicks Advanced → Proceed; app loads and stays on HTTPS; no mixed-content errors"
    why_human: "First-time TLS UX requires a real browser session; curl -k bypasses the warning but does not exercise the user-facing code path"
---

# Phase 4: Containerize and Compose Locally — Verification Report

**Phase Goal:** Production-shape stack (Caddy + FastAPI + Postgres) runs end-to-end on the developer laptop, with migrations, secrets handling, and same-origin routing — verifiable before any cloud cost is incurred.
**Verified:** 2026-05-22T12:00:00Z
**Status:** human_needed (5/5 automated truths VERIFIED; 2 items require human browser testing)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `docker compose -f docker-compose.prod.yml up` brings up Caddy + FastAPI (arm64) + Postgres (tuned, shared_buffers≈3GB) + runs Alembic migrations before API takes traffic | VERIFIED | `infra/docker-compose.prod.yml` wires `db` → `migrate` (condition: `service_healthy`) → `api` (condition: `service_completed_successfully`) → `caddy` (condition: `service_healthy`); Postgres tuning: `shared_buffers=3GB`, `effective_cache_size=8GB`, `max_connections=50`, `shm_size: 1g`; migrate command: `["alembic", "upgrade", "head"]`; all 4 services present |
| SC-2 | Expo web export served by Caddy `file_server` at `/`; `/api/*` reverse-proxied to FastAPI same-origin (no separate web container) | VERIFIED | `infra/Caddyfile` has `handle /api/* { reverse_proxy api:8000 }` before `handle { root * /srv; try_files {path} /index.html; file_server }`; Caddy mounts `../frontend/dist:/srv:ro`; no standalone web container in compose |
| SC-3 | Frontend bundle does NOT contain literal `localhost:8000`; relative `/api/v1` drives prod build | VERIFIED | `frontend/src/constants/config.prod.ts` exports `API_BASE_URL = '/api/v1'`; `frontend/dist/` built and confirmed clean: `grep -r 'localhost:8000' frontend/dist/` returns 0 hits; `/api/v1` found in `dist/_expo/static/js/web/index-3aa11dba28e23b6e8f4f32af639dfc93.js` |
| SC-4 | `.env` with secrets loaded via `env_file:`, gitignored, documented in `infra/.env.example` with placeholder values; FastAPI CORS allowlist narrowed | VERIFIED | `infra/.env.example` has 13 keys with `CHANGE_ME_*` sentinels; `ALLOWED_ORIGINS=https://localhost`; `.gitignore` line 15 = `infra/.env`; `git check-ignore -q infra/.env` exits 0; `env_file: ./.env` present on `db`, `migrate`, `api` services; caddy gets only `CADDY_DOMAIN`/`CADDY_TLS_MODE` via explicit `environment:` (no env_file on caddy — T-04-15 mitigated); `infra/scripts/env-coverage.sh` exits 0 confirming all 8 Settings fields covered |
| SC-5 | Backend Dockerfile is multi-stage (uv builder → python:3.11-slim runtime), non-root container, arm64-only | VERIFIED | `infra/Dockerfile.api`: `FROM --platform=linux/arm64 python:3.11-slim AS builder` + `FROM --platform=linux/arm64 python:3.11-slim AS runtime`; non-root: `useradd -m -u 1000 appuser` + `USER appuser`; `backend/Dockerfile` deleted (commit `bc97cde`); Strategy B: Poetry exports lock → uv installs; Poetry stripped from runtime before cross-stage COPY |

**Score: 5/5 truths verified**

---

### Deferred Items

No truths deferred to later phases. All Phase 4 success criteria are verifiable in the current codebase.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `infra/Dockerfile.api` | Multi-stage arm64 uv Dockerfile | VERIFIED | 78 lines; two `FROM --platform=linux/arm64` stages; Strategy B (Poetry export → uv install); `useradd -m -u 1000 appuser`; `USER appuser`; urllib HEALTHCHECK; `uvicorn` CMD |
| `backend/.dockerignore` | Excludes `.env*`, dev artifacts from build context | VERIFIED | Present; excludes `.env`, `.env.*`, `*.pem`, `*.key`, `*.db`, `*.sqlite*`, `__pycache__/`, `tests/`, `.git/` |
| `backend/Dockerfile` | Retired (deleted) | VERIFIED | `test -f backend/Dockerfile` → absent; commit `bc97cde` confirms deletion |
| `infra/docker-compose.dev.yml` | Dev db-only compose at canonical location | VERIFIED | Renamed from `backend/docker-compose.yml` (100% git rename similarity preserved); no `version:` key; `postgres:15-alpine`; volume `postgres_data` preserved |
| `infra/docker-compose.prod.yml` | Four-service prod stack with depends_on chain | VERIFIED | 86 lines; db + migrate + api + caddy; `service_healthy` and `service_completed_successfully` conditions; `wallet_pgdata_prod` volume; `shm_size: 1g`; no published ports on db or api |
| `infra/Caddyfile` | Same-origin SPA + /api/* reverse-proxy | VERIFIED | 15 lines; `{$CADDY_DOMAIN:localhost}`; `tls {$CADDY_TLS_MODE:internal}`; `handle /api/*` precedes catch-all `handle`; `reverse_proxy api:8000`; `try_files {path} /index.html`; `file_server` |
| `infra/.env.example` | 13-key template with CHANGE_ME sentinels | VERIFIED | All D-16 keys present: POSTGRES_USER/PASSWORD/DB, DATABASE_URL, SECRET_KEY, ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, ALLOWED_ORIGINS, EXCHANGE_RATE_API_URL, ENVIRONMENT, DEBUG, CADDY_DOMAIN, CADDY_TLS_MODE; `CHANGE_ME_*` sentinels on sensitive fields |
| `infra/scripts/env-coverage.sh` | Settings-vs-.env.example drift checker | VERIFIED | 35 lines; `bash -n` syntax clean; executable (`-rwxr-xr-x`); `bash infra/scripts/env-coverage.sh` exits 0 with "OK: all 8 Settings fields...appear in infra/.env.example" |
| `infra/scripts/smoke.sh` | End-to-end Phase 4 verifier | VERIFIED | 116 lines; `bash -n` syntax clean; executable (`-rwxr-xr-x`); covers all 14 automated VALIDATION.md rows: preconditions, build:web, arm64 build, compose up, migrate exit, Postgres tuning, Caddy HTTPS |
| `frontend/src/constants/config.dev.ts` | Dev/native config (absolute localhost URL) | VERIFIED | Exports `API_BASE_URL = 'http://localhost:8000/api/v1'`; no `__DEV__` ternary |
| `frontend/src/constants/config.prod.ts` | Prod config (relative /api/v1) | VERIFIED | Exports `API_BASE_URL = '/api/v1'`; zero occurrences of `localhost:8000` |
| `frontend/src/constants/config.ts` | Auto-managed active config | VERIFIED | Currently byte-identical to `config.dev.ts` (correct at-rest state); `diff config.ts config.dev.ts` → identical |
| `frontend/package.json` `build:web` script | Config swap + expo export + restore | VERIFIED | `"build:web": "rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && cp src/constants/config.dev.ts src/constants/config.ts"` — correct POSIX cp chain |
| `frontend/dist/` | Built web export without localhost:8000 | VERIFIED | Exists with `index.html`, `_expo/`, `favicon.ico`; `grep -r 'localhost:8000' frontend/dist/` → 0 hits; `/api/v1` present in JS chunk |
| `.gitignore` | `infra/.env` and `frontend/dist/` entries | VERIFIED | Line 15: `infra/.env`; line 18: `frontend/dist/` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `migrate` service | `db` service | `depends_on: db: condition: service_healthy` | WIRED | Verified in `infra/docker-compose.prod.yml` lines 44-46 |
| `api` service | `migrate` service | `depends_on: migrate: condition: service_completed_successfully` | WIRED | Verified in `infra/docker-compose.prod.yml` lines 53-55; Pitfall 8 mitigation confirmed |
| `caddy` service | `api` service | `depends_on: api: condition: service_healthy` | WIRED | Verified in `infra/docker-compose.prod.yml` lines 78-80 |
| `Caddyfile` | `api:8000` | `reverse_proxy api:8000` | WIRED | Docker DNS resolves compose service name `api` |
| `Caddyfile` | `frontend/dist` | `root * /srv` + `file_server` | WIRED | Caddy volume mount `../frontend/dist:/srv:ro` confirmed |
| `migrate` service | `alembic.ini` | `command: ["alembic", "upgrade", "head"]` + WORKDIR /app | WIRED | `backend/alembic.ini` copied to `/app/` via `COPY . .`; `migrations/env.py` reads `DATABASE_URL` from `settings` which reads from `env_file:` |
| `frontend/src/api/client.ts` | `config.ts` | `import { API_BASE_URL } from '@/constants/config'` | WIRED | Line 3 of `client.ts`; resolves to active `config.ts` (dev=absolute, prod=relative) |
| `infra/docker-compose.prod.yml` | `infra/.env` | `env_file: ./.env` | WIRED | `db`, `migrate`, `api` services all have `env_file: ./.env`; path resolves to `infra/.env` relative to compose file location |
| `caddy` service | Caddyfile | `./Caddyfile:/etc/caddy/Caddyfile:ro` | WIRED | Read-only volume mount confirmed in compose |

---

### Data-Flow Trace (Level 4)

Not applicable — Phase 4 delivers infrastructure/build artifacts, not data-rendering components. No dynamic UI rendering is introduced in this phase; the config values are verified to flow correctly from source files through build:web into the dist/ bundle.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `infra/scripts/env-coverage.sh` exits 0 | `bash infra/scripts/env-coverage.sh` | `OK: all 8 Settings fields in .../config.py appear in .../infra/.env.example` | PASS |
| `infra/scripts/smoke.sh` syntax check | `bash -n infra/scripts/smoke.sh` | exit 0, no errors | PASS |
| `infra/scripts/env-coverage.sh` syntax check | `bash -n infra/scripts/env-coverage.sh` | exit 0, no errors | PASS |
| `frontend/dist/` contains no `localhost:8000` | `grep -r 'localhost:8000' frontend/dist/` | 0 matches | PASS |
| `frontend/dist/` JS chunk contains `/api/v1` | `grep -rl '/api/v1' frontend/dist/` | `dist/_expo/static/js/web/index-3aa11dba28e23b6e8f4f32af639dfc93.js` | PASS |
| `config.ts` == `config.dev.ts` at rest | `diff config.ts config.dev.ts` | identical | PASS |
| `infra/.env` is gitignored | `git check-ignore -v infra/.env` | `.gitignore:15:infra/.env` | PASS |
| `infra/.env.example` is tracked by git | `git ls-files infra/.env.example` | `infra/.env.example` | PASS |
| All 12 phase commits present in git log | `git log --oneline` | 2a0755f, bc97cde, 32a0f9e, 3ff28fb, 9245df5, 43fecb6, 789a7b3, 47ff20d, 8b0846e, d0ea64f, 29794e4, 6dd0cfa — all confirmed | PASS |

---

### Probe Execution

Phase 4 defines `infra/scripts/smoke.sh` as the acceptance probe. This probe requires Docker to be running (docker compose up, docker build) and is explicitly excluded from static-only verification per task instructions. The smoke.sh was syntax-checked and its logic verified structurally.

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `infra/scripts/smoke.sh` | `bash infra/scripts/smoke.sh full` | SKIPPED — requires Docker runtime (static checks only per task scope) | SKIP |

The smoke.sh logic was verified by code inspection to correctly cover all 14 VALIDATION.md automated rows. Running `bash infra/scripts/smoke.sh full` from a machine with Docker Desktop active and a populated `infra/.env` is the definitive acceptance gate.

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| DEPLOY-01 | Production docker-compose orchestrates backend + Postgres + Caddy + frontend export on single VM | SATISFIED | `infra/docker-compose.prod.yml` four-service stack; `infra/docker-compose.dev.yml` separate dev compose; named volumes `wallet_pgdata_prod`, `caddy_data`, `caddy_config` |
| DEPLOY-02 | Multi-stage Dockerfile (uv builder → python:3.11-slim runtime, non-root, arm64-only) | SATISFIED | `infra/Dockerfile.api` fully verified; `backend/Dockerfile` deleted |
| DEPLOY-03 | Frontend served as static expo export via Caddy file_server (no separate web container) | SATISFIED | `build:web` script produces `frontend/dist/`; Caddy mounts dist at `/srv`; no web container in compose |
| DEPLOY-04 | Alembic migrations run before API takes traffic (one-shot migrate service) | SATISFIED | `migrate` service with `command: ["alembic", "upgrade", "head"]`; `api` depends_on migrate `condition: service_completed_successfully` |
| DOMAIN-04 | API served same-origin via Caddy; FastAPI CORS narrowed to prod domain | SATISFIED | Caddyfile `handle /api/* { reverse_proxy api:8000 }`; `ALLOWED_ORIGINS=https://localhost` in `.env.example` |
| OPS-04 | Postgres tuned with shared_buffers≈3GB (Oracle 20% idle-reclaim mitigation) | SATISFIED | `command: ["postgres", "-c", "shared_buffers=3GB", ...]`; `shm_size: 1g` (required for 3GB shared_buffers on Linux) |
| SEC-01 | `.env` gitignored; no secrets in image/repo/compose; documented in `.env.example` | SATISFIED | `infra/.env` gitignored; `backend/.dockerignore` excludes `.env*`; `env_file:` at runtime only; CHANGE_ME sentinels; caddy uses explicit `environment:` not `env_file:` |

**Note:** `REQUIREMENTS.md` checkboxes for DEPLOY-01, DEPLOY-03, DEPLOY-04, DOMAIN-04, OPS-04, SEC-01 still show `[ ]` (not ticked). This is documentation drift — the implementations are complete and the ROADMAP correctly marks Phase 4 as complete. The checkboxes should be updated in a future docs pass.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `SPEC.md` | 102, 128 | Stale reference to `backend/docker-compose.yml` and `docker-compose.yml` | Info | SPEC.md is a living spec not used by tooling; noted in `deferred-items.md`; pre-existing modified state (`M SPEC.md` in git status); not a Phase 4 file |
| `REQUIREMENTS.md` | 22,24,25,34,56,67 | Requirement checkboxes not ticked for completed Phase 4 requirements | Info | Documentation drift only; no runtime impact; all implementations verified present |
| `.planning/phases/04-containerize-and-compose-locally/04-VALIDATION.md` | 39-58 | All task status cells show `⬜ pending` even though tasks are complete | Info | VALIDATION.md status column not updated post-execution; smoke.sh and all artifacts exist and pass static checks |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 4 created or modified files. No `TODO` or `PLACEHOLDER` markers in infra artifacts, config files, or scripts.

---

### Human Verification Required

#### 1. CORS Same-Origin Confirmation (DOMAIN-04 final gate)

**Test:** With the prod stack running (`bash infra/scripts/smoke.sh up` or `docker compose -f infra/docker-compose.prod.yml up -d --wait`), open `https://localhost` in a browser, accept the self-signed cert warning, log in, and navigate to the transactions screen. Open DevTools → Network tab → filter by `/api/`. Confirm zero rows show `OPTIONS` method (no CORS preflight).

**Expected:** Every `/api/v1/*` request is a direct `GET`/`POST` with no preceding `OPTIONS` request, confirming same-origin delivery.

**Why human:** The absence of CORS preflights is a browser-enforced behavior. There is no headless equivalent that can semantically confirm same-origin enforcement — `curl` bypasses the browser's CORS machinery entirely.

#### 2. TLS Internal Self-Signed Cert UX

**Test:** On first browser visit to `https://localhost` (using `tls internal` Caddy cert), verify: (a) browser shows "Not Secure" / cert warning; (b) clicking "Advanced → Proceed" loads the wallet app; (c) all subsequent `/api/v1/*` requests succeed with no mixed-content errors in DevTools console.

**Expected:** App fully functional over HTTPS via self-signed cert. This exercises the HTTPS code path and HSTS-readiness described in D-10 of the context document.

**Why human:** First-time TLS UX with a self-signed cert requires a real browser session. The `curl -sIk` check in smoke.sh confirms HTTP/2 200 but cannot confirm the human-facing browser warning flow or the absence of mixed-content console errors.

---

### Gaps Summary

No gaps. All five ROADMAP success criteria are fully implemented and pass static verification. The `human_needed` status reflects two browser-based checks that confirm same-origin CORS behavior and TLS self-signed cert UX — behaviors that are correctly coded but require a real browser session to observe.

The live `npm run build:web` + `grep -r 'localhost:8000' dist/` + `diff config.ts config.dev.ts` chain was partially deferred during plan 04-03 execution (worktree node_modules incomplete), but the `frontend/dist/` directory is present in the working tree, was built successfully, and passes the localhost grep check. The build:web script logic is statically correct.

---

*Verified: 2026-05-22T12:00:00Z*
*Verifier: Claude (gsd-verifier)*
