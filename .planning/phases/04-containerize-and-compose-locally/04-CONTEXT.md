# Phase 4: Containerize and Compose Locally - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Production-shape stack — Caddy reverse-proxy + FastAPI (arm64-only image) + Postgres (tuned for Oracle 20% idle-reclaim) — runs end-to-end on a developer laptop via `docker compose -f infra/docker-compose.prod.yml up`. Alembic migrations run via a one-shot `migrate` service before the API takes traffic. Frontend Expo web export is served same-origin by Caddy (`file_server` at `/`, `/api/*` reverse-proxied to FastAPI). Secrets ride through `env_file:` from a gitignored `.env` documented in `infra/.env.example`. Verifiable on the laptop before any cloud cost is incurred (Phase 6 takes it to Oracle).

**In scope:** infra layout under `infra/`, prod multi-stage Dockerfile (uv builder → `python:3.11-slim`, non-root, arm64-only), `docker-compose.prod.yml`, `Caddyfile`, `.env.example`, frontend dev/prod config split + build-script swap, Postgres tuning, migrate service.

**Out of scope (other phases):** real domain + Let's Encrypt (Phase 6), VM provisioning + hardening (Phase 6), `/health` DB-independence guarantee (OPS-01 → Phase 6), CI/CD + zero-downtime rollouts + backups (Phase 7), PWA manifest + service worker + mobile polish (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Repo Layout

- **D-01:** All production-orchestration files live under a new top-level `infra/` directory: `infra/docker-compose.prod.yml`, `infra/Caddyfile`, `infra/.env.example`. Phases 6–7 will add `infra/RUNBOOK.md`, GH Actions workflow files, etc., alongside.
- **D-02:** Move the existing `backend/docker-compose.yml` (db-only dev compose) to `infra/docker-compose.dev.yml`. Update `backend/README.md` and any other doc that references `cd backend && docker compose up`. Both compose files now co-located under `infra/`.

### Frontend API URL Strategy

- **D-03:** Split `frontend/src/constants/config.ts` into two source files: `config.dev.ts` (keeps `http://localhost:8000/api/v1` for native dev — relative paths can't work outside web) and `config.prod.ts` (uses relative `/api/v1` only — same-origin via Caddy). The active `config.ts` becomes a generated/swapped artifact.
- **D-04:** Add an `npm run build:web` script in `frontend/package.json` that copies `config.prod.ts → config.ts` immediately before invoking `expo export -p web`. After the export, restore `config.dev.ts → config.ts`. Commit `config.ts` as the dev copy with a header comment warning it is auto-managed; alternatively gitignore `config.ts` and commit only the `.dev`/`.prod` variants — planner picks based on what plays nicest with the Metro/Babel resolver.
- **D-05:** `axios` `baseURL` accepts the relative `/api/v1` string in browsers — no client-code change beyond importing from `config.ts`. Native dev imports `config.dev.ts` so its absolute URL still works on iOS simulator / Android emulator.
- **D-06:** Verification: `grep -r "localhost:8000" frontend/dist/` after `npm run build:web` must yield zero hits (success criterion 3). Phase 7 will promote this grep to a build-failing GH Actions assertion (CI-01); Phase 4 keeps it manual.

### Backend Container Build (uv scope)

- **D-07:** Adopt `uv` only inside the prod Dockerfile builder stage. Dev workflow keeps Poetry unchanged — `pyproject.toml` + `poetry.lock` remain authoritative for `poetry install`. No CONTRIBUTING.md / dev-doc churn in this phase.
- **D-08:** Builder stage runs `uv pip install --system .` (or `uv sync --no-dev` if the planner finds it more deterministic) directly against `pyproject.toml`. No intermediate `requirements.txt` and no Poetry inside the Docker image. ⚠ **Researcher must verify** whether uv reading `pyproject.toml` directly respects (or can be made to respect) Poetry's lockfile resolution; if it can drift on transitive versions, planner should add a `--frozen`-equivalent guard or a `poetry export → uv pip install -r` fallback.
- **D-09:** Multi-stage layout (locked by DEPLOY-02): `FROM python:3.11-slim AS builder` (with uv via `pip install uv` or astral-sh image) → `FROM python:3.11-slim` runtime, non-root user (`useradd -m -u 1000 appuser`), `--platform linux/arm64` build target only.

### Caddy + Local-Laptop TLS

- **D-10:** Single `infra/Caddyfile` with one site block driven by env vars. Skeleton:
  ```
  {$CADDY_DOMAIN:localhost} {
      tls {$CADDY_TLS_MODE:internal}
      handle /api/* { reverse_proxy api:8000 }
      handle { root * /srv ; try_files {path} /index.html ; file_server }
  }
  ```
  Phase 4 laptop run: `CADDY_DOMAIN=localhost`, `CADDY_TLS_MODE=internal` → Caddy issues a self-signed cert via `tls internal`, exercising HTTPS code paths (HSTS-readiness, secure cookies, service-worker registration prerequisites). Phase 6 swap is two env-var changes (`CADDY_DOMAIN=<domain>`, drop `CADDY_TLS_MODE` to fall through to default Let's Encrypt staging→prod).
- **D-11:** HSTS header is added in Phase 6 (DOMAIN-03), not Phase 4 — `tls internal` certs would trip HSTS pinning during dev. Caddy's site block in Phase 4 omits the HSTS header directive.

### Frontend Bundle Preparation

- **D-12:** Developer runs `npm run build:web` (which performs the config swap of D-04 then `expo export -p web`) before bringing the prod compose stack up. The output at `frontend/dist/` is bind-mounted **read-only** into the Caddy container at `/srv` via `volumes: - ../frontend/dist:/srv:ro`. Fast iteration loop: rebuild bundle without rebuilding any image. Phase 7 replaces this with a proper frontend builder image baked into CI (CI-01).

### Migrate Service

- **D-13:** Add a `migrate` service to `docker-compose.prod.yml` that **reuses the API image** with an overridden `command: ["alembic", "upgrade", "head"]`. Dependency chain: `migrate` `depends_on: db: { condition: service_healthy }`; `api` `depends_on: migrate: { condition: service_completed_successfully }`. Pitfall 8 mitigation (no entrypoint script in API container, no Alembic worker race) is preserved by construction.

### Postgres Tuning

- **D-14:** Tune via `command:` flags in `docker-compose.prod.yml`, two parameters only: `postgres -c shared_buffers=3GB -c effective_cache_size=8GB -c max_connections=50`. `shared_buffers=3GB` is the OPS-04 anchor (≈25% of 12 GB → memory utilization stays above Oracle's 20% idle-reclaim threshold). `effective_cache_size=8GB` reflects the OS cache available on the A1.Flex VM. `max_connections=50` caps a runaway client from exhausting the small VM. No custom `postgresql.conf`. Other PGTune parameters deferred until real workload data exists.
- **D-15:** New named volume `wallet_pgdata_prod` (separate from any volume the dev compose creates) so dev DB and prod-shape DB on the same laptop don't collide.

### `.env` and `infra/.env.example`

- **D-16:** Canonical full list with `CHANGE_ME_*` placeholders (so a missing replace fails loudly):
  - `POSTGRES_USER=CHANGE_ME_POSTGRES_USER`
  - `POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD`
  - `POSTGRES_DB=CHANGE_ME_POSTGRES_DB`
  - `DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}` (composed from the above)
  - `SECRET_KEY=CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32`
  - `ACCESS_TOKEN_EXPIRE_MINUTES=30`
  - `ALGORITHM=HS256`
  - `ALLOWED_ORIGINS=https://localhost` (Phase 4 default; Phase 6 narrows to real prod domain)
  - `EXCHANGE_RATE_API_URL=https://api.frankfurter.app`
  - `ENVIRONMENT=production`
  - `DEBUG=False`
  - `CADDY_DOMAIN=localhost`
  - `CADDY_TLS_MODE=internal`
- **D-17:** `infra/.env` is gitignored (add `infra/.env` to `.gitignore`). Loaded into compose services via `env_file: ../infra/.env`. SEC-01's `chmod 600` requirement is documented in `infra/.env.example` header comment but only enforced on the VM (Phase 6) — laptop-local `.env` is the developer's responsibility.

### Claude's Discretion

- Exact Dockerfile syntax for installing uv in the builder stage (e.g., `pip install uv` vs using the `ghcr.io/astral-sh/uv:latest` base) — planner picks the cleanest current pattern.
- Whether `config.ts` is gitignored (with `config.dev.ts` as committed default) or committed (with build script restoring after export). Planner picks based on Metro resolver behavior.
- Caddy `try_files` ordering and exact MIME / cache headers for static assets (no specific requirement in this phase; Phase 5 PWA-04 service worker will tighten cache headers).
- Compose `restart:` policy values (likely `unless-stopped` for db/api/caddy, no restart for `migrate`).
- Health check definitions in compose (DB `pg_isready`, API existing `/health`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements
- `.planning/ROADMAP.md` §"Phase 4" — Goal, success criteria, requirement list (DEPLOY-01..04, DOMAIN-04, OPS-04, SEC-01)
- `.planning/ROADMAP.md` §"Critical Pitfall Mitigations Baked Into Phase Ordering" — Caddy-DNS ordering, LE rate limit, SW stale-shell, **migrations-before-API ordering** (Pitfall 8), localhost-bake check, Postgres tuning rationale
- `.planning/REQUIREMENTS.md` §DEPLOY / §DOMAIN-04 / §OPS-04 / §SEC-01 — locked requirement statements
- `.planning/PROJECT.md` §Constraints — tech stack, API contract sync rule, "no new dependencies" preference (note: this phase necessarily adds Caddy + uv tooling per milestone scope)

### Existing Code (must be modified or moved)
- `backend/Dockerfile` — Existing Poetry-based multi-stage Dockerfile. Phase 4 replaces or supersedes it with the uv-based variant; planner decides whether to overwrite or to add a separate `infra/Dockerfile.api` and retire the old one.
- `backend/docker-compose.yml` — Move to `infra/docker-compose.dev.yml` (D-02). Update any docs referencing it.
- `backend/env.example` — Source of truth for current dev env vars; cross-reference when authoring `infra/.env.example` to avoid drift.
- `backend/app/main.py:33-40` — Existing `GET /health` endpoint (already DB-independent, returns 200 with status/environment/version). Phase 4 does not modify it; OPS-01 in Phase 6 formalizes the DB-outage independence test.
- `backend/app/core/config.py` — pydantic-settings `Settings` class; reads `DATABASE_URL`, `SECRET_KEY`, `ALLOWED_ORIGINS`, `ENVIRONMENT`, `DEBUG`, `EXCHANGE_RATE_API_URL`. Compose `env_file:` must populate every field this class requires.
- `backend/alembic.ini` + `backend/migrations/versions/*` — Alembic config and migrations the `migrate` service runs.
- `frontend/src/constants/config.ts` — File being split into `config.dev.ts` + `config.prod.ts` (D-03).
- `frontend/src/api/client.ts` — Axios instance reading `API_BASE_URL` from config; works unchanged if `config.ts` exports the right value.
- `frontend/package.json` — Add `build:web` script (D-04).

### Codebase Maps
- `.planning/codebase/STACK.md` — Tech stack (FastAPI 0.109+, SQLAlchemy 2, Alembic 1.13+, React 19/Expo SDK 54, Tailwind/NativeWind, axios). Confirms Poetry as the current package manager.
- `.planning/codebase/STRUCTURE.md` — Repo layout (referenced by D-01 placement decision)
- `.planning/codebase/CONVENTIONS.md` — Coding conventions

### Patterns to Carry Forward
- `.planning/phases/01-wire-fix-and-harden/01-CONTEXT.md` — `__DEV__` / platform branching pattern (relevant to D-03 config split)
- `.planning/phases/02-complete-transfer-transactions/02-CONTEXT.md` — Pydantic schema partial-update pattern (not directly used here but documents schema conventions)
- `.planning/phases/03-user-profile-management/03-CONTEXT.md` — Most recent context patterns

### External Documentation (researcher to fetch via Context7)
- **Caddy v2** — Caddyfile syntax, `tls internal`, `handle` blocks, `reverse_proxy`, env-var substitution semantics
- **uv (astral-sh)** — `uv pip install --system pyproject.toml` semantics, lockfile interaction with non-uv-managed projects (D-08 ⚠ research item), arm64 prebuilt wheels
- **Docker Compose v2** — `depends_on: condition: service_completed_successfully`, `env_file:`, `command:` overrides, healthcheck definitions
- **PostgreSQL 15** — `shared_buffers` / `effective_cache_size` flag interaction with the official `postgres:15-alpine` image, `command:` arg passthrough
- **Alembic** — One-shot `alembic upgrade head` invocation in container

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/Dockerfile` (current Poetry/multi-stage, non-root, healthcheck) — structure is correct, only the dependency-install steps need to swap from Poetry to uv. Healthcheck `python -c "import requests; requests.get..."` works as-is (or planner may simplify with `curl`).
- `backend/docker-compose.yml` Postgres service (15-alpine, named volume, `pg_isready` healthcheck, env vars) — direct template for the prod-compose db service; only `command:` flags and volume name change.
- `backend/app/main.py` `GET /health` — already DB-independent (no DB call); satisfies the spirit of OPS-01 even though OPS-01 is formally Phase 6.
- `backend/app/core/config.py` Settings — already reads everything via pydantic-settings/`.env`; no code change needed for SEC-01, only filesystem-side `.env` setup.
- `frontend/src/api/client.ts` axios instance — reads `API_BASE_URL` from `config.ts`, will pick up the swapped value transparently.

### Established Patterns
- Multi-stage Dockerfile pattern (builder + runtime, non-root user via `useradd -m -u 1000 appuser`, `COPY --chown`) — preserve.
- `env_file:` + pydantic-settings `Settings` class — already the v1 pattern; just add the prod-only env vars.
- `__DEV__` branching in frontend config — being replaced by file-swap in this phase (D-03/D-04). One-time migration; document in phase plan so future contributors don't reintroduce `__DEV__` URL branches.

### Integration Points
- `infra/docker-compose.prod.yml` services: `db` (postgres:15-alpine, tuned), `migrate` (api image, alembic command), `api` (uv-built image, depends on migrate completion), `caddy` (caddy:alpine, mounts Caddyfile + `frontend/dist` + named volume for certs).
- `infra/Caddyfile` `handle /api/*` → `reverse_proxy api:8000` (compose service name resolves via Docker DNS).
- `frontend/package.json` `build:web` script orchestrates the config swap + `expo export -p web` + restore.
- `.gitignore` additions: `infra/.env`, `frontend/dist/` (if not already), possibly `frontend/src/constants/config.ts` (depending on D-04 resolution).
- Backend `ALLOWED_ORIGINS` defaults to `https://localhost` for Phase 4; Phase 6 narrows to real prod domain. Even with same-origin Caddy, the FastAPI CORS allowlist remains as defense-in-depth (DOMAIN-04).

</code_context>

<specifics>
## Specific Ideas

- "Use different config file in dev and prd" (user, verbatim, on Area 2) — drove D-03/D-04 file-split decision over Babel inline-env-vars or Metro custom resolver. The intent is **literal**: prod build must not transitively import dev source, so `localhost:8000` cannot appear in the bundle even before grep verification.
- `tls internal` on the laptop is intentional — the user wants the HTTPS code path exercised on dev, not deferred until first cloud deploy.

</specifics>

<deferred>
## Deferred Ideas

- **HSTS header** → Phase 6 (DOMAIN-03). Adding it under `tls internal` self-signed certs would pin the laptop to a self-signed cert and break browser access.
- **`/health` DB-outage independence test** → Phase 6 (OPS-01). The endpoint is already DB-independent; the formal "stop Postgres, observe /health still 200" verification belongs with the deployed VM.
- **CI grep assertion for `localhost:8000`** → Phase 7 (CI-01). Phase 4 verifies manually.
- **`docker rollout` zero-downtime** → Phase 7 (DEPLOY-06).
- **Backup destination (R2 vs B2 vs S3)** → Phase 7 planning (explicitly TBD per ROADMAP).
- **Real domain + Let's Encrypt staging→prod** → Phase 6 (DOMAIN-01 / DOMAIN-02).
- **PWA manifest, service worker, mobile polish** → Phase 5.
- **Image vulnerability scanning, SOPS/Doppler/Vault, structured logs, Sentry** → "harden production" milestone (out of v2.0 per REQUIREMENTS.md).

</deferred>

---

*Phase: 04-containerize-and-compose-locally*
*Context gathered: 2026-05-03*
