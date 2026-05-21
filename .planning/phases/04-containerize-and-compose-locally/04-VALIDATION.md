---
phase: 4
slug: containerize-and-compose-locally
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-03
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (backend, existing) + shell smoke tests (infra) |
| **Config file** | backend/pyproject.toml (pytest config), infra/scripts/smoke.sh (Wave 0) |
| **Quick run command** | `bash infra/scripts/smoke.sh` |
| **Full suite command** | `cd backend && poetry run pytest && bash infra/scripts/smoke.sh` |
| **Estimated runtime** | ~120 seconds (compose up cold + grep + curl) |

---

## Sampling Rate

- **After every task commit:** Run `bash infra/scripts/smoke.sh`
- **After every plan wave:** Run full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | DEPLOY-02 | — | uv builder produces deterministic deps from poetry.lock (no drift) | smoke | `docker build --platform linux/arm64 -f infra/Dockerfile.api backend/ -t wallet-api:test` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | DEPLOY-02 / SEC-01 | — | Container runs as non-root uid 1000 | smoke | `docker run --rm wallet-api:test id -u | grep -q '^1000$'` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | DEPLOY-02 | — | Image is arm64-only (single-platform manifest) | smoke | `docker image inspect wallet-api:test --format '{{.Architecture}}' | grep -q '^arm64$'` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | DEPLOY-04 | — | docker-compose.dev.yml moved from backend/, dev workflow still boots | smoke | `docker compose -f infra/docker-compose.dev.yml config -q` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | DEPLOY-01 / OPS-04 | — | Compose up brings db→migrate→api→caddy in order, migrations run before API | smoke | `bash infra/scripts/smoke.sh up` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | OPS-04 | — | Postgres tuned: shared_buffers=3GB, effective_cache_size=8GB, max_connections=50 | smoke | `docker compose -f infra/docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER" -tAc "SHOW shared_buffers" | grep -q '3GB'` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 2 | DEPLOY-01 | — | Postgres has shm_size>=1g (3GB shared_buffers fits) | smoke | `docker inspect $(docker compose -f infra/docker-compose.prod.yml ps -q db) --format '{{.HostConfig.ShmSize}}' | awk '{exit !($1>=1073741824)}'` | ❌ W0 | ⬜ pending |
| 04-03-04 | 03 | 2 | DEPLOY-01 | — | migrate service exits 0 before api starts (depends_on: service_completed_successfully) | smoke | `docker compose -f infra/docker-compose.prod.yml ps migrate --format json | jq -e '.[0].State == "exited" and .[0].ExitCode == 0'` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 2 | DOMAIN-04 | T-04-01 | Caddy serves `/` from /srv (file_server), proxies `/api/*` to api:8000 same-origin | smoke | `curl -fsk https://localhost/api/v1/health \| jq -e '.status == "healthy"'` | ❌ W0 | ⬜ pending |
| 04-04-02 | 04 | 2 | DOMAIN-04 | — | Caddy uses tls internal (self-signed, dev-only); HTTPS code path exercised | smoke | `curl -sIk https://localhost \| grep -qi '^HTTP/2 200'` | ❌ W0 | ⬜ pending |
| 04-04-03 | 04 | 2 | DOMAIN-04 | — | No CORS preflight from same-origin browser request (response lacks Access-Control-Allow-Origin echo) | manual | DevTools Network tab on first transaction list load — see manual-only table | N/A | ⬜ pending |
| 04-05-01 | 05 | 1 | DEPLOY-03 | — | Frontend bundle does NOT contain `localhost:8000` after build:web | smoke | `cd frontend && npm run build:web && ! grep -rq 'localhost:8000' dist/` | ❌ W0 | ⬜ pending |
| 04-05-02 | 05 | 1 | DEPLOY-03 | — | config.dev.ts and config.prod.ts both exist; client.ts imports from config.ts | smoke | `test -f frontend/src/constants/config.dev.ts && test -f frontend/src/constants/config.prod.ts && grep -q "from '\.\./constants/config'" frontend/src/api/client.ts` | ❌ W0 | ⬜ pending |
| 04-05-03 | 05 | 1 | DEPLOY-03 | — | After build:web restore, config.ts equals config.dev.ts (no leak of prod config) | smoke | `cd frontend && npm run build:web >/dev/null && diff -q src/constants/config.ts src/constants/config.dev.ts` | ❌ W0 | ⬜ pending |
| 04-06-01 | 06 | 1 | SEC-01 | T-04-02 | infra/.env is gitignored | smoke | `git check-ignore -q infra/.env` | ❌ W0 | ⬜ pending |
| 04-06-02 | 06 | 1 | SEC-01 | — | infra/.env.example contains all required CHANGE_ME placeholders | smoke | `for k in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB SECRET_KEY ALLOWED_ORIGINS CADDY_DOMAIN CADDY_TLS_MODE; do grep -q "^${k}=" infra/.env.example || exit 1; done` | ❌ W0 | ⬜ pending |
| 04-06-03 | 06 | 1 | SEC-01 / DEPLOY-04 | — | All Settings fields in backend/app/core/config.py have a corresponding key in infra/.env.example (no missing var crashes API) | smoke | `bash infra/scripts/env-coverage.sh` (Wave 0) | ❌ W0 | ⬜ pending |
| 04-07-01 | 07 | 3 | DEPLOY-01 | — | Full prod compose stack passes end-to-end smoke (cold up, /api/v1/health, /, teardown) | smoke | `bash infra/scripts/smoke.sh full` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `infra/scripts/smoke.sh` — orchestrates compose up, runs all `smoke` automated commands above, tears down on success or failure
- [ ] `infra/scripts/env-coverage.sh` — diffs `Settings` fields in `backend/app/core/config.py` against keys in `infra/.env.example`, exits 1 on drift
- [ ] No new pytest fixtures required — backend tests already pass and are not modified by this phase

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser DevTools shows zero CORS preflight (OPTIONS) requests on `/api/*` calls | DOMAIN-04 | Requires real browser; no headless equivalent that proves "same-origin" semantically | 1) `bash infra/scripts/smoke.sh up`. 2) Open `https://localhost` in browser, accept self-signed cert. 3) Login, navigate to transactions. 4) DevTools → Network → filter `/api/`. Confirm zero rows with method `OPTIONS`. |
| `tls internal` self-signed cert browser-warning ceremony | DOMAIN-04 | First-time UX only; documented in infra/RUNBOOK.md (Phase 6 formalizes) | Browser shows "Not Secure" warning; user clicks Advanced → Proceed. One-time per browser profile. Optional: run `caddy trust` from container to install local CA. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`smoke.sh`, `env-coverage.sh`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
