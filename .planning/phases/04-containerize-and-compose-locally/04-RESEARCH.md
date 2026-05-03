# Phase 4: Containerize and Compose Locally - Research

**Researched:** 2026-05-03
**Domain:** Container orchestration (Docker Compose v2), reverse-proxy TLS (Caddy v2), Python packaging (uv), Postgres tuning, frontend bundle prep (Expo SDK 54 web export)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Repo Layout**
- **D-01:** All production-orchestration files live under a new top-level `infra/` directory: `infra/docker-compose.prod.yml`, `infra/Caddyfile`, `infra/.env.example`. Phases 6–7 will add `infra/RUNBOOK.md`, GH Actions workflow files, etc., alongside.
- **D-02:** Move existing `backend/docker-compose.yml` (db-only dev compose) to `infra/docker-compose.dev.yml`. Update `backend/README.md` and any other doc that references `cd backend && docker compose up`. Both compose files now co-located under `infra/`.

**Frontend API URL Strategy**
- **D-03:** Split `frontend/src/constants/config.ts` into `config.dev.ts` (`http://localhost:8000/api/v1` for native dev) and `config.prod.ts` (relative `/api/v1` only — same-origin via Caddy). Active `config.ts` becomes generated/swapped artifact.
- **D-04:** Add `npm run build:web` script in `frontend/package.json` that copies `config.prod.ts → config.ts` immediately before `expo export -p web`, then restores `config.dev.ts → config.ts`. Planner picks committed-with-restore vs gitignored-`config.ts` based on Metro/Babel resolver behavior.
- **D-05:** `axios` `baseURL` accepts the relative `/api/v1` string in browsers — no client-code change beyond importing from `config.ts`. Native dev imports `config.dev.ts`.
- **D-06:** Verification: `grep -r "localhost:8000" frontend/dist/` after `npm run build:web` must yield zero hits. Phase 7 promotes to CI assertion (CI-01); Phase 4 keeps manual.

**Backend Container Build (uv scope)**
- **D-07:** Adopt `uv` only inside the prod Dockerfile builder stage. Dev workflow keeps Poetry unchanged. No CONTRIBUTING.md / dev-doc churn.
- **D-08:** Builder stage runs uv against `pyproject.toml` (no Poetry inside the image). ⚠ Researcher must verify lockfile-resolution behavior; recommend `--frozen`-equivalent or `poetry export → uv pip install -r` fallback if drift possible. (See §"D-08 Resolution Strategy" below.)
- **D-09:** Multi-stage layout: `FROM python:3.11-slim AS builder` (with uv) → `FROM python:3.11-slim` runtime, non-root user (`useradd -m -u 1000 appuser`), `--platform linux/arm64` build target only.

**Caddy + Local-Laptop TLS**
- **D-10:** Single `infra/Caddyfile` with one site block driven by env vars. Skeleton:
  ```
  {$CADDY_DOMAIN:localhost} {
      tls {$CADDY_TLS_MODE:internal}
      handle /api/* { reverse_proxy api:8000 }
      handle { root * /srv ; try_files {path} /index.html ; file_server }
  }
  ```
  Phase 4 laptop run: `CADDY_DOMAIN=localhost`, `CADDY_TLS_MODE=internal` → self-signed cert via `tls internal`. Phase 6 swap is two env-var changes.
- **D-11:** HSTS header added in Phase 6 (DOMAIN-03), not Phase 4.

**Frontend Bundle Preparation**
- **D-12:** Developer runs `npm run build:web` before bringing prod compose stack up. Output at `frontend/dist/` is bind-mounted **read-only** into Caddy at `/srv` via `volumes: - ../frontend/dist:/srv:ro`.

**Migrate Service**
- **D-13:** Add `migrate` service to `docker-compose.prod.yml` that **reuses the API image** with overridden `command: ["alembic", "upgrade", "head"]`. Dependency chain: `migrate` `depends_on: db: { condition: service_healthy }`; `api` `depends_on: migrate: { condition: service_completed_successfully }`.

**Postgres Tuning**
- **D-14:** Tune via `command:` flags: `postgres -c shared_buffers=3GB -c effective_cache_size=8GB -c max_connections=50`. No custom `postgresql.conf`.
- **D-15:** New named volume `wallet_pgdata_prod` (separate from dev compose volume).

**`.env` and `infra/.env.example`**
- **D-16:** Canonical full list with `CHANGE_ME_*` placeholders: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL` (composed), `SECRET_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES=30`, `ALGORITHM=HS256`, `ALLOWED_ORIGINS=https://localhost`, `EXCHANGE_RATE_API_URL=https://api.frankfurter.app`, `ENVIRONMENT=production`, `DEBUG=False`, `CADDY_DOMAIN=localhost`, `CADDY_TLS_MODE=internal`.
- **D-17:** `infra/.env` gitignored. Loaded into compose services via `env_file: ../infra/.env`. SEC-01 `chmod 600` documented in `.env.example` header but only enforced on VM (Phase 6).

### Claude's Discretion
- Exact Dockerfile syntax for installing uv in builder stage (`pip install uv` vs `ghcr.io/astral-sh/uv:latest` base) — planner picks.
- Whether `config.ts` is gitignored (with `config.dev.ts` as committed default) or committed (with build script restoring after export) — planner picks based on Metro resolver behavior.
- Caddy `try_files` ordering and exact MIME / cache headers (Phase 5 PWA-04 will tighten).
- Compose `restart:` policy values (likely `unless-stopped` for db/api/caddy, no restart for `migrate`).
- Health check definitions in compose (DB `pg_isready`, API existing `/health`).

### Deferred Ideas (OUT OF SCOPE)
- HSTS header → Phase 6 (DOMAIN-03)
- `/health` DB-outage independence test → Phase 6 (OPS-01)
- CI grep assertion for `localhost:8000` → Phase 7 (CI-01)
- `docker rollout` zero-downtime → Phase 7 (DEPLOY-06)
- Backup destination → Phase 7
- Real domain + Let's Encrypt → Phase 6 (DOMAIN-01/02)
- PWA, mobile polish → Phase 5
- Image vulnerability scanning, SOPS/Doppler/Vault, structured logs, Sentry → "harden production" milestone (out of v2.0)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPLOY-01 | Production `docker-compose.yml` orchestrates backend + Postgres + Caddy + static frontend (separate from dev compose; named volumes for Postgres data and Caddy certs) | §"Compose Architecture", §"Caddy Persistent Volumes", §"Standard Stack" |
| DEPLOY-02 | Multi-stage `Dockerfile` for FastAPI backend (uv builder → `python:3.11-slim` runtime, non-root, arm64-only build) | §"D-08 Resolution Strategy", §"Code Examples → Multi-stage Dockerfile (uv)", §"arm64-Only Build" |
| DEPLOY-03 | Frontend served as static `expo export -p web` output via Caddy `file_server` (no separate web container) | §"Caddyfile Architecture", §"Frontend Bundle Preparation", §"Code Examples → Caddyfile" |
| DEPLOY-04 | Alembic migrations run before API container takes traffic (one-shot migrate service or entrypoint guard) | §"Migrate Service Pattern", §"Code Examples → migrate service" |
| DOMAIN-04 | API served same-origin (Caddy reverse-proxies `/api/*` to FastAPI); FastAPI CORS allowlist remains as defense-in-depth | §"Caddyfile Path Routing — `handle` does NOT strip", §"Common Pitfalls → Pitfall 4" |
| OPS-04 | Postgres container tuned with `shared_buffers ≈ 3 GB` (~25% of 12 GB) for Oracle 20% idle-reclaim mitigation | §"Postgres Tuning", §"Common Pitfalls → Pitfall 1 (shm_size)" |
| SEC-01 | Production `.env` lives only on VM (`chmod 600`, owned by deploy user), gitignored; no secrets in image, repo, or compose file | §"Secrets Hygiene", §"Common Pitfalls → Pitfall 6" |
</phase_requirements>

## Summary

Phase 4 stands up a production-shape stack on a developer laptop: **Caddy v2** terminates TLS (self-signed via `tls internal`) and serves the Expo web export at `/`, reverse-proxying `/api/*` to a **FastAPI** image (built from `python:3.11-slim` via a **uv** builder, arm64-only, non-root). A one-shot **migrate** service runs `alembic upgrade head` before the API container starts, gated by Compose's `depends_on: condition: service_completed_successfully`. **Postgres 15-alpine** is tuned via `command:` flags for the Oracle A1.Flex memory profile (3 GB shared_buffers).

The most subtle research items concern (1) **uv lockfile semantics** — uv reads its own `uv.lock`, never `poetry.lock`, so D-08 must adopt one of three deterministic strategies (recommendation below); (2) **Postgres `shm_size`** — the default 64 MB `/dev/shm` allocated by Docker is too small for 3 GB shared_buffers, requiring an explicit `shm_size: 1g` (or larger) on the db service; (3) **Caddy `handle` vs `handle_path`** — `handle /api/*` does NOT strip the prefix, so requests to `/api/v1/foo` reach the FastAPI container unmodified — exactly what the FastAPI app expects; (4) **`tls internal` install message** — Caddy attempts to install its root CA into the system trust store but may not succeed in containerized / unprivileged contexts, requiring a one-time manual trust step in the laptop browser.

**Primary recommendation:** Adopt the official `tiangolo/uv` and `astral-sh/uv-docker-example` multi-stage pattern using `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/`, generate `uv.lock` from `pyproject.toml` once and commit it (Strategy A below — fastest, deterministic, eliminates Poetry dependency from the build path) OR keep Poetry as authoritative and `poetry export -f requirements.txt → uv pip install --system -r requirements.txt` (Strategy B — preserves D-07's "dev workflow keeps Poetry unchanged" without committing a second lockfile). Researcher recommends **Strategy B** for this phase to honor D-07 verbatim; planner may upgrade to Strategy A in a future phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TLS termination (HTTPS, self-signed dev cert) | CDN/Edge (Caddy) | — | Caddy owns ACME / cert management; FastAPI never sees TLS [VERIFIED: Caddyfile docs] |
| Static frontend serving | CDN/Edge (Caddy `file_server`) | — | DEPLOY-03 explicit: no separate web container [LOCKED: D-03] |
| API request routing (`/api/*`) | CDN/Edge (Caddy `reverse_proxy`) | API/Backend (FastAPI handlers) | Same-origin via Caddy; FastAPI runs unaware of front-door [LOCKED: D-10] |
| Authentication, business logic, validation | API/Backend (FastAPI) | — | Existing app code; no relocation in this phase |
| Database persistence (durable named volume) | Database/Storage (Postgres 15) | — | `wallet_pgdata_prod` named volume [LOCKED: D-15] |
| Schema migrations | Backend (Alembic, one-shot container) | Database/Storage | Reuses API image with overridden command [LOCKED: D-13] |
| Secrets injection | Build/Compose (`env_file:`) | API/Backend (pydantic-settings) | `.env` gitignored, mounted via env_file [LOCKED: D-17] |
| Frontend API base URL selection | Build-time (config swap script) | Browser/Client (axios) | `config.dev.ts` vs `config.prod.ts` swap [LOCKED: D-03/D-04] |
| Inter-service DNS resolution (`api:8000`, `db:5432`) | Build/Compose (Docker default network) | — | Compose service-name DNS — no extra config needed |

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` does not exist in the repository root. No project-level CLAUDE.md directives apply to this phase. Project conventions are sourced from `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/STACK.md`, and the existing `backend/Dockerfile` / `backend/docker-compose.yml` patterns documented under §"Existing Patterns to Carry Forward" below.

## Standard Stack

### Core

| Library / Image | Version | Purpose | Why Standard |
|-----------------|---------|---------|--------------|
| `caddy:alpine` | 2.x (multi-arch incl. arm64v8) [VERIFIED: Docker Hub manifest 2026-04-15] | TLS-terminating reverse proxy + static file server | Auto-HTTPS, Caddyfile is the lowest-friction config format; arm64 image confirmed available on Docker Hub |
| `python:3.11-slim` | 3.11.x slim variant (multi-arch incl. arm64v8) [VERIFIED: Docker Hub manifest] | API runtime base image | Locked by D-09; matches `pyproject.toml` `python = "^3.11"` constraint |
| `ghcr.io/astral-sh/uv:latest` | 0.11.8 (released 2026-04-27) [VERIFIED: PyPI uv 0.11.8] | Builder-stage Python package installer | Recommended pattern from `astral-sh/uv-docker-example`: `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/` — avoids `pip install uv` round-trip [CITED: uv-docker-example README] |
| `postgres:15-alpine` | 15.x (multi-arch incl. arm64v8) [VERIFIED: Docker Hub manifest 2026-04-22] | Database | Already in dev compose; satisfies arm64-only constraint |
| `alembic` | 1.18.4 (latest) [VERIFIED: PyPI]; project uses ^1.13.0 [CITED: backend/pyproject.toml] | One-shot DB migrations | Already a project dependency; runs inside API image with command override |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `poetry-plugin-export` ≥ 1.8 | Convert `poetry.lock` → `requirements.txt` for uv install | If adopting Strategy B (recommended); installed in builder stage only |
| `expo export -p web` | Generate static SPA bundle to `frontend/dist/` | Run on host before `docker compose up` (D-12) |
| `pg_isready` | Postgres healthcheck command | Already in dev compose; carry into prod compose |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tls internal` (Caddy local CA) | `local_certs` global option | `local_certs` is a global directive forcing internal CA for ALL sites; `tls internal` per-site is more explicit and matches D-10's env-var swap pattern [CITED: caddyserver.com/docs/caddyfile/options] |
| One-shot `migrate` service | Entrypoint script in API container | Pitfall 8 in ROADMAP explicitly chose one-shot service to prevent N-replica race; CONTEXT.md D-13 locks this choice |
| `pip install uv` in builder | `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/` | The `COPY --from` approach is faster (no pip download), smaller, and recommended by Astral [CITED: uv docs/guides/integration/docker.md] |
| `handle_path /api/*` (strips prefix) | `handle /api/*` (preserves prefix) | FastAPI app mounts at `/api/v1/...`; `handle` (preserve) is the correct choice — see §"Common Pitfalls → Pitfall 4" |

**Installation (planner reference):**

No host-side installation needed beyond Docker / Docker Compose v2 (already required for dev). uv is installed inside the builder image only. Alembic and Poetry are existing project dependencies.

**Version verification (already verified):**
- `uv` 0.11.8 — confirmed via `https://pypi.org/pypi/uv/json` (2026-04-27 release)
- `caddy:alpine` — multi-arch (arm64v8 present), last pushed 2026-04-15 [VERIFIED: Docker Hub API]
- `postgres:15-alpine` — multi-arch (arm64v8 present), last pushed 2026-04-22 [VERIFIED: Docker Hub API]
- `python:3.11-slim` — multi-arch (arm64v8 present) [VERIFIED: Docker Hub via search results]
- `alembic` 1.18.4 — confirmed via PyPI; project pins `^1.13.0` so any 1.13+ acceptable

## Architecture Patterns

### System Architecture Diagram

```
              ┌──────────────────────────────────────────────┐
              │            Developer laptop (host)           │
              │                                              │
              │   $ npm run build:web                        │
              │   ─ swaps config.prod.ts → config.ts         │
              │   ─ runs `expo export -p web`                │
              │   ─ outputs frontend/dist/                   │
              │   ─ restores config.dev.ts → config.ts       │
              │                                              │
              │   $ docker compose -f infra/docker-compose.prod.yml up
              └────────────────────┬─────────────────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────────────┐
              │  Compose project (default bridge network)    │
              │                                              │
              │  ┌─── db (postgres:15-alpine) ──────────┐    │
              │  │  command: -c shared_buffers=3GB ...  │    │
              │  │  shm_size: 1g    [pitfall 1]         │    │
              │  │  healthcheck: pg_isready             │    │
              │  │  volume: wallet_pgdata_prod          │    │
              │  └─────────────┬────────────────────────┘    │
              │                │ (service_healthy)           │
              │                ▼                             │
              │  ┌─── migrate (api image, one-shot) ────┐    │
              │  │  command: alembic upgrade head       │    │
              │  │  env_file: ../infra/.env             │    │
              │  │  restart: "no"                       │    │
              │  └─────────────┬────────────────────────┘    │
              │                │ (service_completed_         │
              │                │   successfully)             │
              │                ▼                             │
              │  ┌─── api (uv-built image, non-root) ───┐    │
              │  │  uvicorn app.main:app --host 0.0.0.0 │    │
              │  │  --port 8000                         │    │
              │  │  env_file: ../infra/.env             │    │
              │  │  healthcheck: GET /health            │    │
              │  └─────────────┬────────────────────────┘    │
              │                │                             │
              │     api:8000   │ (Docker DNS)                │
              │                ▼                             │
              │  ┌─── caddy (caddy:alpine) ─────────────┐    │
              │  │  ports: 80:80, 443:443               │    │
              │  │  volumes:                            │    │
              │  │   - ./Caddyfile:/etc/caddy/Caddyfile │    │
              │  │   - ../frontend/dist:/srv:ro         │    │
              │  │   - caddy_data:/data (certs)         │    │
              │  │   - caddy_config:/config             │    │
              │  │  env: CADDY_DOMAIN, CADDY_TLS_MODE   │    │
              │  └─────────────┬────────────────────────┘    │
              └────────────────┼─────────────────────────────┘
                               │ HTTPS :443 (self-signed cert via tls internal)
                               ▼
                  ┌─────────────────────────┐
                  │  Browser on laptop      │
                  │  https://localhost      │
                  │  ─ /        → file_srv  │
                  │  ─ /api/*   → api:8000  │
                  │             (axios uses │
                  │              relative   │
                  │              /api/v1)   │
                  └─────────────────────────┘
```

### Recommended Project Structure

```
wallet_app/
├── infra/                              # NEW (D-01)
│   ├── docker-compose.prod.yml         # NEW
│   ├── docker-compose.dev.yml          # MOVED from backend/docker-compose.yml (D-02)
│   ├── Caddyfile                       # NEW
│   ├── .env.example                    # NEW (committed)
│   └── .env                            # NEW, gitignored (D-17)
├── backend/
│   ├── Dockerfile                      # MODIFIED: swap Poetry→uv builder stage (D-07/D-08/D-09)
│   ├── pyproject.toml                  # unchanged
│   ├── poetry.lock                     # unchanged (still authoritative)
│   ├── alembic.ini                     # unchanged
│   ├── migrations/                     # unchanged
│   └── app/                            # unchanged
├── frontend/
│   ├── package.json                    # MODIFIED: add build:web script (D-04)
│   ├── src/constants/
│   │   ├── config.dev.ts               # NEW (D-03)
│   │   ├── config.prod.ts              # NEW (D-03)
│   │   └── config.ts                   # GENERATED (gitignored OR committed-with-restore — planner picks)
│   └── dist/                           # GENERATED by expo export -p web; gitignored
└── .gitignore                          # MODIFIED: add infra/.env, frontend/dist/, possibly config.ts
```

### Pattern 1: Multi-stage Dockerfile with uv (`COPY --from` install)
**What:** Builder stage uses uv to install deps into a virtualenv (or system site-packages); runtime stage copies only the populated virtualenv + app code. uv binary itself does not end up in the runtime image.
**When to use:** Always for prod images per `astral-sh/uv-docker-example` recommendation. Saves ~200 MB versus dev-style image.
**Example:** See §"Code Examples → Multi-stage Dockerfile (uv, Strategy B)".

### Pattern 2: One-shot migration service via image reuse + command override
**What:** Define a `migrate` service that uses the same `image:` (or `build:` context) as `api`, but overrides `command:` to `["alembic", "upgrade", "head"]` and sets `restart: "no"`. The `api` service then declares `depends_on: migrate: { condition: service_completed_successfully }`, which Docker Compose v2 supports natively.
**When to use:** Always for relational DBs in compose. Avoids the rejected entrypoint-script pattern (Pitfall 8 in ROADMAP) which races across N replicas.
**Example:** See §"Code Examples → migrate service".

### Pattern 3: Caddy SPA + API same-origin (`handle /api/*` first, `handle` catch-all second)
**What:** A single Caddy site block with two `handle` directives — the API matcher first (preserves prefix), the catch-all second (serves SPA with `try_files {path} /index.html`). The catch-all must be a bare `handle { ... }` (no matcher) so it acts as the default. **`handle` does NOT strip the prefix; `handle_path` does** — this distinction matters because the FastAPI app mounts at `/api/v1/...` and expects the prefix to pass through.
**When to use:** This is THE canonical Caddyfile SPA-with-API pattern published in the official Caddy docs. CONTEXT.md D-10 already locks it.
**Example:** See §"Code Examples → Caddyfile" (canonical version verified against `caddyserver.com/docs/caddyfile/patterns`).

### Pattern 4: Bind-mounted static bundle (read-only) for fast iteration
**What:** Caddy serves `frontend/dist/` via a read-only bind mount: `volumes: - ../frontend/dist:/srv:ro`. Re-running `npm run build:web` rewrites `frontend/dist/` and is picked up by Caddy on the next request — no image rebuild.
**When to use:** Phase 4 only (laptop dev). Phase 7 (CI-01) will replace with a builder image baked into the Caddy image at CI time.
**Note (read-only mount):** The `:ro` suffix prevents the container from writing back to the bind mount. This is appropriate for static assets.

### Anti-Patterns to Avoid

- **Entrypoint script that runs `alembic upgrade head` in the API container.** Races across N replicas; ROADMAP Pitfall 8 explicitly forbids it. Use the one-shot migrate service.
- **Custom `postgresql.conf` mounted from host.** Two parameters (`shared_buffers`, `effective_cache_size`) plus `max_connections` are sufficient per OPS-04; a full conf file invites drift and version mismatches. CONTEXT.md D-14 locks `command:` flag approach.
- **Putting secrets in `docker-compose.prod.yml` directly.** SEC-01 violation. Always go through `env_file: ../infra/.env` (gitignored).
- **`handle_path /api/*` instead of `handle /api/*`.** `handle_path` strips the prefix; FastAPI expects `/api/v1/...` to arrive unmodified. See Pitfall 4.
- **Default 64 MB `/dev/shm` with `shared_buffers=3GB`.** Postgres will fail to start or hit "could not resize shared memory" errors. See Pitfall 1.
- **Multi-arch builds.** PROJECT explicitly arm64-only; don't add `--platform linux/amd64,linux/arm64` to image build.
- **`__DEV__` URL branching reintroduced in any frontend file.** D-03/D-04 retire this pattern; future contributors must use the file-swap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TLS cert lifecycle on dev laptop | OpenSSL cert + manual trust + nginx config | Caddy `tls internal` | Caddy auto-generates a cert from its built-in local CA and (best-effort) installs the root CA into the system trust store [CITED: caddyserver.com/docs/caddyfile/directives/tls] |
| Wait-for-Postgres-then-migrate dance | Custom shell script with `until pg_isready` polling | Compose `depends_on: condition: service_healthy` + `service_completed_successfully` | Native compose feature since v2; no shell scripting [VERIFIED: Compose docs] |
| SPA fallback routing | nginx `try_files` config | Caddy `try_files {path} /index.html ; file_server` | Same one-liner; published as canonical pattern [VERIFIED: caddyserver.com/docs/caddyfile/patterns] |
| Python lockfile across two package managers | Manually maintaining both `poetry.lock` AND `uv.lock` | `poetry export -f requirements.txt --without-hashes -o requirements.txt` then `uv pip install --system -r requirements.txt` | Strategy B (recommended) — Poetry remains the single source of truth; uv is just a fast installer [VERIFIED: poetry-plugin-export, uv pip install --system docs] |
| Postgres tuning calculator | Hand-tune 12 PGTune parameters | Two flags (`shared_buffers=3GB`, `effective_cache_size=8GB`) + `max_connections=50` | OPS-04 anchors only `shared_buffers`; further tuning deferred until real workload data exists [LOCKED: D-14] |
| HTTPS-on-laptop browser trust | Self-signed `mkcert` ceremony | Caddy `tls internal` (one-time browser warning OR install Caddy root CA per `caddy trust`) | Same outcome with one fewer tool dependency |

**Key insight:** Phase 4's value is precisely that it leverages Caddy's auto-HTTPS-on-localhost and Compose's native dependency conditions to avoid the operational toil that historically made "production-shape on laptop" expensive. Resist any temptation to add helper scripts; the platform features cover it.

## Runtime State Inventory

This phase is primarily greenfield (new files under `infra/`) plus a file move (`backend/docker-compose.yml` → `infra/docker-compose.dev.yml`) and a frontend file split. There IS a runtime-state dimension worth surfacing.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | Existing dev Postgres data lives in named volume `postgres_data` (created by current `backend/docker-compose.yml`). Prod-shape compose uses NEW named volume `wallet_pgdata_prod` per D-15. | None — volumes do NOT collide; dev DB is preserved. Document in commit message that running `docker compose -f infra/docker-compose.prod.yml up` will create a fresh empty DB and run all alembic migrations from zero on first start. |
| **Live service config** | None — no external SaaS / managed services in scope for Phase 4. (Caddy will register / install a new local CA root in `caddy_data` volume on first start, which IS local persistent state but contained within the volume.) | None for migration; document that wiping the `caddy_data` volume requires re-trusting the new self-signed cert in the browser. |
| **OS-registered state** | None — no Windows Tasks, launchd, systemd units involved. Docker Compose state lives entirely in the Docker daemon. | None. |
| **Secrets and env vars** | The `.env` file is NEW for Phase 4 (developer creates from `infra/.env.example`). No existing secrets to migrate. SOPS not in scope (deferred). | Create `infra/.env` from template; planner must include this in Phase 4 README/runbook step. |
| **Build artifacts / installed packages** | `frontend/dist/` will be created/regenerated by `npm run build:web`. Existing `backend/Dockerfile` references `poetry.lock`; if Strategy A (commit `uv.lock`) chosen, a new `backend/uv.lock` is added — otherwise no new lockfile. The Caddy data volume (`caddy_data`) accumulates the local CA cert and account state. | None destructive; planner should add `frontend/dist/` to `.gitignore` if not already, plus `infra/.env`. |

**Doc references to update (file move D-02):**
- `backend/README.md` — any `cd backend && docker compose up` references → `cd infra && docker compose -f docker-compose.dev.yml up`
- Any other doc found via `grep -r "backend/docker-compose.yml" .` (researcher did not run this; planner should grep during plan stage)

## Common Pitfalls

### Pitfall 1: Postgres `shared_buffers > shm_size` causes startup failure
**What goes wrong:** Setting `shared_buffers=3GB` while leaving Docker's default `/dev/shm = 64 MB` causes Postgres to either fail to start or fail at first parallel query with "could not resize shared memory segment: No space left on device".
**Why it happens:** Docker allocates a small `/dev/shm` per container; PostgreSQL uses POSIX shared memory backed by `/dev/shm` for parallel-query coordination and (with `huge_pages=off`) for parts of the buffer pool itself.
**How to avoid:** Add `shm_size: 1g` (or larger — rule of thumb: 1.5–2× `shared_buffers`, so up to `5g` for the 3 GB target on the 12 GB Oracle VM, but 1 GB is typically sufficient on a laptop with the small workload of this app) on the `db` service in `docker-compose.prod.yml`.
**Warning signs:** Postgres logs show `WARNING: could not resize shared memory segment "/PostgreSQL.<id>" to <bytes> bytes`. Container restarts in a loop on first connection.
**[VERIFIED: Instaclustr blog "PostgreSQL®, Docker, and Shared Memory", Last9 docker-shared-memory guide, docker-library/postgres GitHub issue #416]**
**[CITED: hub.docker.com/_/postgres — official image README recommends `shm_size: 128mb` minimum and a tmpfs mount for production]**

### Pitfall 2: uv reads `uv.lock`, never `poetry.lock` — D-08 dependency drift
**What goes wrong:** `uv pip install --system .` (or `uv sync`) directly against `pyproject.toml` resolves transitive deps using uv's own resolver, which can pick different versions than Poetry's resolver did when generating `poetry.lock`. Build-to-build determinism is lost: a fresh `docker build` weeks apart can land on different `httpx` (or any other transitive) patch versions.
**Why it happens:** `pyproject.toml` declares constraints (`fastapi = "^0.109.0"`) — both Poetry and uv satisfy these constraints, but neither preserves the other's exact resolution unless an explicit lockfile is provided.
**How to avoid (Strategy B — recommended for D-07 compliance):** In the builder stage, install the export plugin and run:
```
pip install poetry==1.7.1 poetry-plugin-export>=1.8
poetry export -f requirements.txt --without-hashes -o requirements.txt
uv pip install --system -r requirements.txt
```
This preserves `poetry.lock` as the single source of truth (D-07) while still benefiting from uv's install speed.
**Alternative (Strategy A):** Run `uv lock` once locally to generate `backend/uv.lock`, commit it, then in the builder stage `uv sync --frozen --no-dev`. Faster builds and no Poetry-in-image; cost is committing a second lockfile and updating CI to re-lock when `pyproject.toml` changes.
**Warning signs:** `pip freeze` inside two Docker images built a week apart shows different transitive versions. Subtle runtime regressions tied to install date.
**[VERIFIED: uv docs — `uv pip install --system`, `uv sync --frozen` semantics; poetry-plugin-export ≥1.8 still actively maintained as of 2025-12]**
**[CITED: docs.astral.sh/uv/concepts/resolution/, github.com/python-poetry/poetry-plugin-export]**

### Pitfall 3: Caddy `tls internal` root CA not auto-trusted in containers / browsers
**What goes wrong:** On first request to `https://localhost`, the browser shows a "Not secure" / cert-warning page because the self-signed root CA is not in the OS trust store. Caddy attempts to install it but the documentation explicitly warns this can fail in restricted environments (e.g., Docker, unprivileged users, WSL).
**Why it happens:** Installing a root CA into `/etc/ssl/certs` (Linux) or the system keychain (macOS) requires root, which the Caddy container does not have, AND modifying the host trust store from inside a container is generally impossible.
**How to avoid:** (a) Document the one-time browser-trust step in the phase README/runbook; OR (b) on macOS/Linux host, run `caddy trust` once after `docker compose cp` of the root CA from the `caddy_data` volume — the planner should pick the simpler option and document it. For Phase 4 (laptop dev only), accepting the browser warning per session is acceptable.
**Warning signs:** Browser shows `NET::ERR_CERT_AUTHORITY_INVALID`. `curl -k https://localhost` works but `curl https://localhost` fails.
**[VERIFIED: caddyserver.com/docs/caddyfile/directives/tls — "Caddy attempts to install the root CA certificate into the system trust store automatically, though manual installation may be required in restricted environments like Docker containers or when running as an unprivileged user."]**

### Pitfall 4: `handle_path` strips prefix; `handle` preserves it
**What goes wrong:** Using `handle_path /api/* { reverse_proxy api:8000 }` means a request to `/api/v1/users` is rewritten to `/v1/users` before reaching FastAPI — but FastAPI mounts at `/api/v1/...` and returns 404.
**Why it happens:** The two directives differ in exactly this prefix-stripping behavior. The official SPA-with-API pattern uses `handle` (preserve), not `handle_path` (strip).
**How to avoid:** Use `handle /api/* { reverse_proxy api:8000 }` (D-10's wording is correct as written). Verification: `curl -ks https://localhost/api/v1/health` should hit FastAPI's health endpoint and return 200.
**Warning signs:** All `/api/*` requests return 404 from FastAPI. FastAPI logs show requests for paths like `/v1/users` (missing the `/api` prefix).
**[VERIFIED: caddyserver.com/docs/caddyfile/patterns "Configure SPA with API Endpoints" pattern uses `handle /api/*`; caddyserver.com/docs/caddyfile/directives/reverse_proxy documents `handle_path` as the prefix-stripping variant]**

### Pitfall 5: Bind-mount path is relative to compose file location, not CWD
**What goes wrong:** `volumes: - ../frontend/dist:/srv:ro` resolves relative to the compose file (`infra/docker-compose.prod.yml`), not the directory the developer invoked `docker compose` from. If the planner forgets to use `docker compose -f infra/docker-compose.prod.yml up` and instead `cd infra && docker compose up`, behavior is identical (compose-file dir IS CWD then) — but `docker compose -f infra/docker-compose.prod.yml up` from repo root will still resolve `../frontend/dist` relative to `infra/`, NOT relative to the repo root. This is correct but counter-intuitive.
**Why it happens:** Docker Compose resolves bind-mount source paths relative to the compose file's directory.
**How to avoid:** Document in `infra/.env.example` header that `../frontend/dist` is relative to `infra/`. Verify via `docker compose config` which prints the fully-resolved path before starting containers.
**Warning signs:** Caddy `404` for all routes; container shell shows `/srv` is empty.
**[CITED: docs.docker.com/reference/compose-file/services/#volumes]**

### Pitfall 6: `env_file:` exposes ALL keys to the container, including ones the service doesn't need
**What goes wrong:** Loading the entire `infra/.env` into the Caddy container exposes Postgres credentials and `SECRET_KEY` to a process that has no business with them. If Caddy is ever compromised, secret blast radius is enlarged.
**Why it happens:** `env_file:` is unselective — it injects every line.
**How to avoid:** EITHER (a) use `env_file:` only on `api`, `migrate`, and `db` services; for Caddy use `environment:` with explicit `CADDY_DOMAIN` / `CADDY_TLS_MODE` lines that read from compose's own env (the developer's shell can `export $(cat infra/.env | xargs)` once before `docker compose up`); OR (b) accept the simplification and use `env_file:` everywhere for Phase 4, noting in CONTEXT.md follow-up that Caddy's exposure is small (it never reads those vars). Researcher recommends (a) for clean separation.
**Warning signs:** `docker compose exec caddy env` lists `POSTGRES_PASSWORD`. Defense-in-depth audit fails.
**[CITED: docs.docker.com/reference/compose-file/services/#env_file — "The variables defined in the env_file are injected into the container."]**

### Pitfall 7: `COPY --chown=appuser:appuser .` BEFORE `USER appuser` — chown is correct, but order traps
**What goes wrong:** Running `RUN useradd -m -u 1000 appuser` and then `COPY --chown=appuser:appuser . .` works, but if you instead `USER appuser` first and THEN `COPY .`, files land owned by appuser without needing `--chown`. The trap is mixing the two patterns and ending up with files owned by root that appuser can't write to (e.g., for log files, alembic version-table state).
**Why it happens:** Docker layer ownership semantics; `--chown` only applies to that COPY, not to anything Python writes at runtime.
**How to avoid:** Pick one consistent pattern. The existing `backend/Dockerfile` uses `RUN useradd ... ; WORKDIR /app ; COPY --chown=appuser:appuser . . ; USER appuser` — preserve this. Alembic writes nothing to the filesystem at runtime (it only INSERTs/UPDATEs the `alembic_version` table in the DB), so the `migrate` container does not need any writable application directories.
**Warning signs:** `PermissionError: [Errno 13]` in `migrate` container logs; FastAPI fails to write to a tmp dir.
**[CITED: backend/Dockerfile — existing repo pattern]**

### Pitfall 8: `expo export` re-creates `dist/` from scratch — stale files are NOT cleaned by Caddy bind mount
**What goes wrong:** If a previous `expo export` produced `dist/_expo/static/js/web/abc123.js` and a new export produces `def456.js`, the OLD chunk file lingers in `dist/` if `expo export` doesn't clean. Caddy serves either, depending on what `index.html` references — usually fine, but disk-space-bloating over many builds.
**Why it happens:** `expo export -p web` does NOT clean the output dir by default in current Expo SDK 54.
**How to avoid:** The `npm run build:web` script should `rm -rf frontend/dist` before invoking `expo export -p web`. Add this as the first step in the script.
**Warning signs:** `frontend/dist/` size grows monotonically across rebuilds. `index.html` references `def456.js` but `abc123.js` still on disk.
**[CITED: expo/expo issue #25919 about dist directory behavior; docs.expo.dev/guides/publishing-websites]**

### Pitfall 9: SPA `try_files {path} /index.html` and the implicit absent leading slash on first segment
**What goes wrong:** Caddy's `try_files` is documented to work with the `{path}` placeholder but the order of arguments matters: it tries each candidate IN ORDER and rewrites the request to the FIRST that exists. If `{path}` is just `/`, it would try `/` (the directory, which `file_server` may or may not interpret as `/index.html` automatically — typically yes via the `index` setting). The pattern in CONTEXT.md (`try_files {path} /index.html`) is canonical and correct, but **must be inside `handle { ... }` (the catch-all) — NOT outside, otherwise it intercepts `/api/*` too.**
**Why it happens:** `try_files` rewrites; if it runs before `handle /api/*`, an `/api/v1/foo` request that doesn't exist as a file falls through to `/index.html` and never reaches the API. The `route` directive (instead of two `handle` blocks) is one fix; `handle` ordering is another. CONTEXT.md uses the cleaner `handle` ordering.
**How to avoid:** Verify the Caddyfile structurally — `handle /api/*` block FIRST, `handle { try_files ... ; file_server }` block SECOND. This matches the official Caddy SPA + API canonical pattern.
**Warning signs:** Browser DevTools shows 200 with `text/html` body for `/api/v1/users` requests (the SPA shell intercepted it).
**[VERIFIED: caddyserver.com/docs/caddyfile/patterns; caddyserver.com/docs/caddyfile/directives/handle]**

## Code Examples

Verified patterns from official sources. Planner adapts these to project file paths.

### Multi-stage Dockerfile (uv, Strategy B — Poetry remains source of truth)

```dockerfile
# Source: composite of astral-sh/uv-docker-example multi-stage pattern
#   + python-poetry/poetry-plugin-export "export to requirements.txt" pattern
#   + existing backend/Dockerfile non-root user pattern
# Target: linux/arm64 only

FROM --platform=linux/arm64 python:3.11-slim AS builder

# uv binary copied in, no `pip install uv` round-trip
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# poetry only for the export step (not in final image)
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libpq-dev \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir poetry==1.7.1 "poetry-plugin-export>=1.8"

WORKDIR /build

COPY pyproject.toml poetry.lock ./

# Export the EXACT versions from poetry.lock to a requirements.txt.
# --without-hashes avoids hash-mode strictness for transitive wheels;
# remove this flag if you want maximum supply-chain rigor.
RUN poetry export -f requirements.txt --without-hashes --only main -o /tmp/requirements.txt \
 && uv pip install --system --no-cache -r /tmp/requirements.txt

# ---- runtime stage ----
FROM --platform=linux/arm64 python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 appuser

WORKDIR /app

# Copy installed site-packages and console scripts (alembic, uvicorn, etc.)
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Notes:
- The healthcheck uses `urllib.request` instead of `requests` so the runtime image doesn't carry `requests` purely for the healthcheck.
- `psycopg2-binary` is in `pyproject.toml` (no source build needed); `gcc` in builder is defensive in case any other dep needs it.

### Caddyfile (canonical SPA + API same-origin)

```caddyfile
# Source: caddyserver.com/docs/caddyfile/patterns "Configure SPA with API Endpoints"
# + caddyserver.com/docs/caddyfile/concepts (env-var substitution)
# + caddyserver.com/docs/caddyfile/directives/tls (tls internal)

{$CADDY_DOMAIN:localhost} {
    tls {$CADDY_TLS_MODE:internal}

    encode zstd gzip

    # API: handle (NOT handle_path) preserves the /api/* prefix.
    # FastAPI mounts at /api/v1/... and expects the full path.
    handle /api/* {
        reverse_proxy api:8000
    }

    # SPA fallback: try the requested file, fall back to index.html.
    # Must be the LAST handle block — acts as catch-all because no matcher.
    handle {
        root * /srv
        try_files {path} /index.html
        file_server
    }
}
```

### `migrate` service (one-shot Alembic via image reuse)

```yaml
# Source: docs.docker.com/reference/compose-file/services + Compose long-syntax depends_on
# Pattern matches CONTEXT.md D-13.

services:
  db:
    image: postgres:15-alpine
    restart: unless-stopped
    shm_size: 1g                # Pitfall 1 fix
    env_file: ../infra/.env
    environment:
      POSTGRES_USER:     ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB:       ${POSTGRES_DB}
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=3GB"
      - "-c"
      - "effective_cache_size=8GB"
      - "-c"
      - "max_connections=50"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    volumes:
      - wallet_pgdata_prod:/var/lib/postgresql/data

  migrate:
    build:
      context: ../backend
      dockerfile: Dockerfile
      platforms: ["linux/arm64"]
    image: wallet-app/api:local        # share image tag with `api` to avoid double build
    restart: "no"                       # one-shot
    env_file: ../infra/.env
    depends_on:
      db:
        condition: service_healthy
    command: ["alembic", "upgrade", "head"]

  api:
    image: wallet-app/api:local
    restart: unless-stopped
    env_file: ../infra/.env
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)\""]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    # NO ports: published — Caddy is the only ingress.

  caddy:
    image: caddy:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      CADDY_DOMAIN:    ${CADDY_DOMAIN:-localhost}
      CADDY_TLS_MODE:  ${CADDY_TLS_MODE:-internal}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ../frontend/dist:/srv:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      api:
        condition: service_healthy

volumes:
  wallet_pgdata_prod:
  caddy_data:
  caddy_config:
```

Notes:
- `image: wallet-app/api:local` lets `migrate` and `api` share the built image — `migrate` triggers the build, `api` reuses it.
- `${POSTGRES_USER}` etc. in `environment:` reads from the developer's shell env. Since `env_file:` already loads `.env`, the duplication is defensive (some Compose versions don't expand `${...}` from `env_file` — using both is robust).
- `restart: "no"` on `migrate` ensures Compose doesn't keep restarting the completed migration container.
- `start_period: 30s` on the db healthcheck buys time for Postgres to allocate `shared_buffers=3GB` on first start.

### `package.json` `build:web` script (D-04)

```json
{
  "scripts": {
    "build:web": "rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && cp src/constants/config.dev.ts src/constants/config.ts"
  }
}
```

Cross-platform note: `cp` and `rm -rf` are not native on Windows `cmd.exe`. If Windows support is needed, swap to `npx rimraf` and `npx cpy-cli`. Phase 4 CONTEXT.md does not name a host OS requirement — researcher recommends adding the cross-platform variant from the start to avoid Windows users tripping on the script.

### `.env.example` skeleton (D-16)

```bash
# infra/.env.example — copy to infra/.env and replace all CHANGE_ME_* values.
# On the deployment VM, set chmod 600 (Phase 6 / SEC-01).
# This file IS committed; infra/.env is gitignored.

POSTGRES_USER=CHANGE_ME_POSTGRES_USER
POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD
POSTGRES_DB=CHANGE_ME_POSTGRES_DB
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}

SECRET_KEY=CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32
ACCESS_TOKEN_EXPIRE_MINUTES=30
ALGORITHM=HS256

ALLOWED_ORIGINS=https://localhost
EXCHANGE_RATE_API_URL=https://api.frankfurter.app

ENVIRONMENT=production
DEBUG=False

CADDY_DOMAIN=localhost
CADDY_TLS_MODE=internal
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Poetry inside Docker builder stage | uv as installer (Poetry stays source-of-truth on dev host) | uv 0.1+ matured 2024–2025; Astral's official `uv-docker-example` is the canonical pattern | 5–10× faster image builds, smaller runtime image |
| Entrypoint shell script with `until pg_isready` | Compose v2 `depends_on: condition: service_healthy` + `service_completed_successfully` | Compose Spec 2021+ adopted these conditions natively | No custom shell scripts; declarative dependency ordering |
| nginx + certbot + cron renew | Caddy with auto-HTTPS (`tls internal` for dev, ACME for prod) | Caddy 2.0 (2020+) made auto-HTTPS the default | One file (`Caddyfile`) replaces 4–5 files of nginx + certbot config |
| `docker-compose` (v1, Python) | `docker compose` (v2, Go, plugin) | v2 GA in 2021; Compose Spec since 2020 | `version: '3.8'` top-level key is no longer required and is ignored if present (the existing dev compose can drop it) |

**Deprecated/outdated (in this stack context):**
- `version: '3.8'` at top of compose files — ignored by Compose v2; safe to remove. [VERIFIED: docs.docker.com compose-file reference]
- Hand-written `wait-for-it.sh` / `dockerize -wait` patterns — superseded by native `depends_on` conditions.
- `python -c "import requests; requests.get(...)"` for healthchecks — fine but adds `requests` to the runtime image; `urllib.request` (stdlib) is leaner. Existing `backend/Dockerfile` uses `requests`; Phase 4 can keep or swap.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A 1 GB `/dev/shm` is sufficient for `shared_buffers=3GB` on the small Phase 4 workload | Pitfall 1 | If parallel queries exceed the shm budget at runtime, `could not resize shared memory` errors will appear. Mitigation: planner can choose `shm_size: 5g` (1.5–2× shared_buffers) for maximum safety; on the Oracle 12 GB VM that's fine. On a laptop with less RAM headroom, `1g` is a pragmatic compromise. [ASSUMED] |
| A2 | Strategy B (Poetry export → uv install) is preferable to Strategy A (commit `uv.lock`) for honoring D-07 verbatim | Primary recommendation, Pitfall 2 | If the planner / user prefers single-lockfile simplicity, Strategy A may be more attractive. Both are deterministic; the choice is policy, not technical. [ASSUMED — researcher recommendation, not user-confirmed] |
| A3 | Caddy `tls internal` browser-trust friction is acceptable on Phase 4 laptop dev (one-time browser warning per session) | Pitfall 3 | If user expects no warning, planner should add `caddy trust` runbook step. [ASSUMED] |
| A4 | `env_file:` exposing all vars to Caddy is acceptable defense-in-depth tradeoff for Phase 4; tighter scoping deferred | Pitfall 6 | If user wants strict per-service env scoping from day 1, the planner should split `environment:` lines per service. [ASSUMED] |
| A5 | `frontend/dist/` should be added to `.gitignore` (not committed) | Runtime State Inventory | If repo policy commits build artifacts, planner should not add to `.gitignore`. Researcher inference based on standard practice. [ASSUMED] |
| A6 | `psycopg2-binary` arm64 wheel is available on PyPI for Python 3.11 | Standard Stack | If the wheel is missing, builder will fall back to source build, requiring `libpq-dev` + `gcc` (already in builder per the example). Already mitigated in the Dockerfile example above. [ASSUMED — wheel availability not verified in this session for ARM64 specifically; psycopg2-binary 2.9.9 has historically shipped manylinux_aarch64 wheels but planner should `pip download --platform manylinux2014_aarch64 psycopg2-binary` to confirm before relying on this] |
| A7 | The existing `backend/Dockerfile` `HEALTHCHECK` pattern using a Python one-liner is acceptable; planner may simplify to `curl` if desired | Code Examples | Either works; CONTEXT.md does not constrain. [ASSUMED — planner discretion] |
| A8 | `docker compose -f infra/docker-compose.prod.yml up` is the canonical invocation (not `cd infra && docker compose up`) | Pitfall 5 | Both work; researcher chose the explicit `-f` form for clarity. Either is fine; planner picks based on developer ergonomics. [ASSUMED] |
| A9 | The 1.5–2× `shm_size : shared_buffers` rule of thumb (sourced from Last9 / Instaclustr blog posts) is accurate enough for sizing | Pitfall 1 | Slight over- or under-allocation has minor performance implications, not correctness implications above the `shared_buffers` floor. [CITED, but the multiplier is an industry rule of thumb, not an official Postgres recommendation] |

## Open Questions

1. **Strategy A vs Strategy B for D-08 (Poetry vs uv lockfile)**
   - What we know: Both produce deterministic builds. Strategy B preserves D-07 verbatim ("Dev workflow keeps Poetry unchanged"); Strategy A is faster and removes Poetry from the image entirely.
   - What's unclear: User preference between (i) "absolutely no second lockfile" and (ii) "image build speed matters more than lockfile minimalism."
   - Recommendation: Default to Strategy B (researcher's pick). Surface the decision to the user in plan-check or at first task; flip to Strategy A is mechanical (one-line builder change + `uv lock` once, commit `uv.lock`).

2. **`config.ts` committed-with-restore vs gitignored**
   - What we know: D-04 leaves this to the planner.
   - What's unclear: Whether the Metro/Babel resolver requires `config.ts` to physically exist at all times (it does, since the import path is `from '@/constants/config'` or similar). If gitignored, every fresh clone needs an initial copy step.
   - Recommendation: Commit `config.ts` as the dev copy (= a copy of `config.dev.ts`) with a header comment warning. Build script restores it. Fresh clone "just works" for native dev.

3. **Whether to drop `version: '3.8'` from the moved dev compose file**
   - What we know: Compose v2 ignores it; there's no functional cost.
   - What's unclear: Whether the project values cleanliness here.
   - Recommendation: Drop it (one fewer cargo-cult line); planner can include the deletion in the file-move task.

4. **`shm_size` value (1g, 2g, 5g?)**
   - What we know: 1 GB is sufficient for typical workloads; 1.5–2× shared_buffers (4.5–6 GB) is the safety-margin rule of thumb.
   - What's unclear: Phase 4 is laptop-only; the Oracle VM (12 GB total) may also constrain this. On a laptop with 16 GB RAM, allocating 5 GB shm is heavy.
   - Recommendation: `shm_size: 1g` for Phase 4 laptop run; revisit in Phase 6 with the actual VM provisioned. Document in `infra/docker-compose.prod.yml` comment.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker (engine) | All compose orchestration | ✗ on this WSL2 distro [VERIFIED via `docker --version` failure] | — | Developer must enable Docker Desktop WSL integration OR run from a different host. NOT a research blocker; phase verification happens on developer's primary host where Docker IS available. |
| Docker Compose v2 | All compose orchestration | ✗ (transitively, via Docker missing) | — | Same as above. |
| Node.js + npm | `npm run build:web` | ✓ [VERIFIED: node v24.14.1, npm 11.11.0] | 24.14.1 | — |
| Expo CLI | `expo export -p web` | ✓ via `npx expo` (no global install needed) | bundled with `expo` ^54 in package.json | — |
| Poetry | Already used for backend dev | ✗ on researcher's WSL2 [VERIFIED] | — | Strategy B requires Poetry inside the Docker builder (installed via `pip install poetry==1.7.1`); host Poetry not strictly needed for Phase 4 image build. Backend developer workflow already uses Poetry per `pyproject.toml`. |
| uv | Builder stage only | ✗ on host [VERIFIED] | — | Installed inside Docker builder via `COPY --from=ghcr.io/astral-sh/uv:latest`. No host install needed. |
| `python` (any) | `expo export` (no), `docker build` (no), backend dev (yes) | (not checked) | — | Backend dev is a separate concern; not blocking Phase 4. |
| Architecture | arm64-only image build | Host is `x86_64` [VERIFIED via `uname -m`] | — | `--platform linux/arm64` builds will use Docker Desktop's emulation (qemu) on x86_64 host — slower but works. Phase 6 moves to native arm64 build via GH Actions `runs-on: ubuntu-24.04-arm` (CI-01). Researcher recommends planner add a comment in `infra/docker-compose.prod.yml` and Dockerfile that x86_64 hosts will use emulation. |

**Missing dependencies with no fallback:**
- Docker on this specific WSL2 distro — but this is a researcher-host issue, not a project-blocker. The user's primary dev host presumably has Docker Desktop active (the project HAS a working dev compose file in `backend/`).

**Missing dependencies with fallback:**
- All other "missing" tools either (a) run inside Docker (uv, Poetry-for-export) or (b) are actually present (Node, npm).

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Backend framework | pytest 7.4+ (already in `pyproject.toml`); pytest-asyncio 0.23+ |
| Frontend framework | jest 30 + jest-expo 55 (already in `frontend/package.json`) |
| Backend config file | `backend/pyproject.toml` `[tool.pytest.ini_options]` (`testpaths = ["tests"]`, `asyncio_mode = "auto"`) |
| Frontend config file | none yet (jest-expo uses defaults) |
| Backend quick run command | `cd backend && poetry run pytest -x --ff` |
| Backend full suite command | `cd backend && poetry run pytest` |
| Frontend quick run command | `cd frontend && npm test -- --bail` |
| Frontend full suite command | `cd frontend && npm test` |
| Compose smoke test | `docker compose -f infra/docker-compose.prod.yml config` (validates compose syntax without starting); `docker compose -f infra/docker-compose.prod.yml up -d --wait && curl -ksf https://localhost/api/v1/health` (true e2e smoke) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEPLOY-01 | `infra/docker-compose.prod.yml` parses and resolves all referenced volumes/services | unit (compose lint) | `docker compose -f infra/docker-compose.prod.yml config -q` | ❌ Wave 0 (file doesn't exist yet) |
| DEPLOY-01 | All four services (db, migrate, api, caddy) come up and reach expected state | smoke / e2e | `docker compose -f infra/docker-compose.prod.yml up -d --wait && docker compose ps` (verify db=healthy, migrate=exited 0, api=healthy, caddy=running) | ❌ Wave 0 |
| DEPLOY-02 | Multi-stage Dockerfile builds successfully under `--platform linux/arm64` | unit (build) | `docker build --platform linux/arm64 -f backend/Dockerfile -t wallet-app/api:test backend/` | ❌ Wave 0 (existing Dockerfile present but not yet swapped to uv) |
| DEPLOY-02 | Final image runtime has appuser as the executing user | unit (assertion) | `docker run --rm wallet-app/api:test id -u` (expect 1000) | ❌ Wave 0 |
| DEPLOY-02 | Final image is arm64 | unit (manifest inspect) | `docker inspect --format '{{.Architecture}}' wallet-app/api:test` (expect `arm64`) | ❌ Wave 0 |
| DEPLOY-03 | Caddy serves `index.html` at `/` after `frontend/dist/` is bind-mounted | smoke | `curl -ks https://localhost/ \| grep -q "<html"` (after `npm run build:web && docker compose up -d`) | ❌ Wave 0 |
| DEPLOY-04 | Migrate service runs to completion BEFORE api starts | observable (compose logs) | `docker compose -f infra/docker-compose.prod.yml up -d ; docker compose logs migrate \| grep -q "Running upgrade"` then `docker compose ps api` (expect running) | ❌ Wave 0 |
| DEPLOY-04 | If migrate fails (intentional broken migration), api never starts | observable (negative test) | manual: introduce broken migration, run `docker compose up`, verify api stays in "Created" state | manual-only — justified: requires intentional migration corruption, not a routine automated test |
| DOMAIN-04 | `/api/*` requests reach FastAPI with prefix preserved | smoke | `curl -ksf https://localhost/api/v1/health` returns 200 with FastAPI's JSON body | ❌ Wave 0 |
| DOMAIN-04 | `/anything-else` requests reach the SPA index.html (fallback) | smoke | `curl -ks https://localhost/some-spa-route \| grep -q "<html"` (returns 200 + HTML) | ❌ Wave 0 |
| OPS-04 | Postgres started with the configured tuning flags | observable (psql query) | `docker compose -f infra/docker-compose.prod.yml exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "show shared_buffers"` (expect `3GB`) | ❌ Wave 0 |
| OPS-04 | Postgres did not OOM at startup with `shared_buffers=3GB` | smoke | `docker compose ps db` (expect Healthy after startup window) | ❌ Wave 0 |
| SEC-01 | `infra/.env` is gitignored | unit | `git check-ignore infra/.env` (exit 0) | ❌ Wave 0 |
| SEC-01 | `infra/.env.example` is committed and contains no real secrets | unit | `grep -E "^[A-Z_]+=CHANGE_ME_" infra/.env.example \| wc -l` (expect ≥ 4) | ❌ Wave 0 |
| SEC-01 | Built API image does NOT contain `.env` or `pyproject.toml.bak` | unit | `docker run --rm wallet-app/api:test ls /app/.env 2>&1 \| grep -q "No such file"` | ❌ Wave 0 |
| All (D-06) | Frontend bundle does not embed `localhost:8000` after `npm run build:web` | unit (grep) | `! grep -rq "localhost:8000" frontend/dist/` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Backend tests (`pytest -x --ff`) for backend tasks; the relevant compose command (`docker compose config`, or build) for infra tasks; the frontend grep for D-04 task.
- **Per wave merge:** Full backend pytest, full frontend jest, AND full compose stack `up --wait` smoke (the four-service health check).
- **Phase gate:** All commands in the requirements→test map green; `npm run build:web && grep` clean; manual visual check of `https://localhost/` in a browser confirming SPA loads + a transaction submitted via UI hits the API and returns 200.

### Wave 0 Gaps

- [ ] `infra/docker-compose.prod.yml` — referenced by DEPLOY-01, DEPLOY-04, DOMAIN-04, OPS-04 tests
- [ ] `infra/Caddyfile` — referenced by DEPLOY-03, DOMAIN-04 tests
- [ ] `infra/.env.example` and `infra/.env` (gitignored) — referenced by SEC-01 tests
- [ ] Backend `Dockerfile` (modified to uv-builder pattern) — referenced by DEPLOY-02 tests
- [ ] `frontend/package.json` `build:web` script — referenced by D-06 grep test and DEPLOY-03 smoke test
- [ ] `frontend/src/constants/config.dev.ts` and `config.prod.ts` — preconditions for the build:web test

(No new test framework install needed: pytest, jest, and standard CLI tools — `curl`, `grep`, `docker`, `git` — cover everything.)

## Security Domain

`security_enforcement` is not explicitly disabled in `.planning/config.json` — treat as enabled. This is an **infrastructure-only** phase (no new application-code attack surface beyond what already exists), so most ASVS categories are inherited from prior phases unchanged.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Same-origin via Caddy reduces CORS attack surface (DOMAIN-04); defense-in-depth retains CORS allowlist |
| V2 Authentication | inherited | Existing JWT auth in FastAPI unchanged; SECRET_KEY now sourced from `.env` (SEC-01) instead of any prior hardcoded fallback |
| V3 Session Management | inherited | Existing access-token expiry config carries through `.env` |
| V4 Access Control | inherited | No changes |
| V5 Input Validation | inherited | Existing pydantic validators unchanged |
| V6 Cryptography | yes | TLS via Caddy auto-HTTPS (`tls internal` for dev, ACME for prod in Phase 6); SECRET_KEY rotation procedure documented in `.env.example` (`openssl rand -hex 32`) |
| V7 Error Handling | inherited | No changes |
| V8 Data Protection | yes | Postgres data on a named volume (`wallet_pgdata_prod`); backup deferred to Phase 7. `.env` `chmod 600` enforced on VM in Phase 6 (SEC-01). |
| V9 Communications | yes | Caddy enforces HTTPS; HSTS deferred to Phase 6 (DOMAIN-03) — see Pitfall 3 for `tls internal` rationale |
| V10 Malicious Code | n/a (no plugin/module loading) | — |
| V11 Business Logic | inherited | No changes |
| V12 Files and Resources | partial | `frontend/dist/` mounted read-only into Caddy; Caddy cannot write to host filesystem |
| V13 API | inherited (DOMAIN-04 reduces CORS surface) | — |
| V14 Configuration | yes | Two compose files (dev / prod) clearly separated (D-01, D-02); secrets in gitignored `.env` (SEC-01); no secrets in image (SEC-01); non-root user in API container (D-09) |

### Known Threat Patterns for {Compose + Caddy + FastAPI + Postgres on a single host}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secrets accidentally committed to repo | Information Disclosure | `infra/.env` gitignored; `.env.example` uses `CHANGE_ME_*` placeholders; verify with `git check-ignore` (Wave 0 test) |
| Secrets baked into Docker image layers | Information Disclosure | `.env` not COPY'd into image; only loaded at runtime via compose `env_file:`; verify with `docker run ls /app/.env` test (Wave 0) |
| Caddy compromise → blast radius includes DB credentials | Lateral Movement / Information Disclosure | Pitfall 6: scope `env_file:` to api/migrate/db only; pass only `CADDY_DOMAIN`/`CADDY_TLS_MODE` to caddy via explicit `environment:` |
| Container running as root → host privilege escalation if escape | Elevation of Privilege | Existing pattern: `useradd -m -u 1000 appuser` + `USER appuser` in API Dockerfile (preserved in D-09) |
| Postgres ports exposed to host (5432) and reachable from anywhere | Information Disclosure | Production compose: do NOT publish 5432; only Caddy exposes 80/443. (Dev compose can keep 5432 published for psql access.) |
| `tls internal` root CA leakage from `caddy_data` volume | Information Disclosure | Volume is a Docker-managed local volume with default permissions; no host-side mount. Cert lifetime is short (Caddy default for `tls internal` is 12h with auto-renewal). |
| Migration container left running with DB credentials | Information Disclosure | `restart: "no"` on migrate ensures it exits and is removed promptly; image inherits prod hardening (non-root, no shell-friendly env dump) |
| Default `/dev/shm` limit triggers Postgres restart loop revealing logs publicly | Availability + Information Disclosure | `shm_size: 1g` (Pitfall 1) prevents the loop; logs default to stdout (captured by Docker), not a public file |
| `handle_path` typo strips `/api` and bypasses FastAPI routing | Spoofing / Tampering | Pitfall 4 + Wave 0 test `curl /api/v1/health` returns 200 |
| Frontend bundle leaks dev API URL (`localhost:8000`) to production users | Information Disclosure (minor) | D-06 grep test on `frontend/dist/` enforces zero hits |

## Sources

### Primary (HIGH confidence)
- **uv (Astral)** — `/astral-sh/uv` and `/astral-sh/uv-docker-example` Context7 IDs; topics fetched: `uv pip install --system`, `uv sync --frozen --no-dev`, multi-stage Dockerfile, non-root user pattern, `COPY --from=ghcr.io/astral-sh/uv:latest`. Latest uv version `0.11.8` confirmed via `https://pypi.org/pypi/uv/json` (released 2026-04-27).
- **Caddy v2 / Caddyfile** — `/websites/caddyserver_caddyfile` Context7 ID; topics fetched: env-var substitution `{$VAR:default}`, `tls internal` semantics, `handle` vs `handle_path`, SPA + API canonical pattern, `try_files` ordering. Confirmed via `caddyserver.com/docs/caddyfile/patterns`, `/docs/caddyfile/concepts`, `/docs/caddyfile/directives/tls`, `/docs/caddyfile/directives/handle`, `/docs/caddyfile/directives/reverse_proxy`.
- **Docker Compose v2** — `/docker/compose` and `/docker/docs` Context7 IDs; topics fetched: `depends_on` long syntax (`condition: service_healthy`, `condition: service_completed_successfully`), `healthcheck`, `env_file:`, `command:` overrides, `shm_size`. Confirmed via `docs.docker.com/reference/compose-file/services` and `docs.docker.com/manuals/compose/how-tos/startup-order`.
- **Alembic** — `/websites/alembic_sqlalchemy` Context7 ID; topic: `alembic upgrade head` invocation. Confirmed via `alembic.sqlalchemy.org/en/latest/tutorial.html`. Latest version `1.18.4` confirmed via PyPI.
- **Docker Hub manifest checks** — `caddy:alpine` (multi-arch incl. arm64v8, last pushed 2026-04-15) and `postgres:15-alpine` (multi-arch incl. arm64v8, last pushed 2026-04-22) verified via `https://hub.docker.com/v2/repositories/library/{caddy,postgres}/tags/`.

### Secondary (MEDIUM confidence — official-blog or community-source corroborated by ≥2 independent sources)
- **Postgres `shm_size` rule of thumb (1.5–2× shared_buffers)** — corroborated by Last9 blog (`how-to-configure-dockers-shared-memory-size-dev-shm`), Instaclustr blog (`postgresql-docker-and-shared-memory`), SigNoz guide (`pq-could-not-resize-shared-memory-segment`), GitHub issue `docker-library/postgres#416`. The 64 MB default and the failure mode are documented in the official Docker Hub `postgres` README.
- **Poetry export plugin status (poetry-plugin-export ≥ 1.8 still maintained)** — confirmed via active issue tracker on `python-poetry/poetry-plugin-export` with bug fixes through Dec 2025; PyPI shows recent releases.
- **Expo SDK 54 web export to `dist/`** — confirmed via `docs.expo.dev/guides/publishing-websites`, `docs.expo.dev/router/web/static-rendering`. Caveat: the `dist/` directory not auto-cleaned between exports — referenced GitHub issue `expo/expo#25919`.

### Tertiary (LOW confidence — flagged for validation if it ever becomes load-bearing)
- The exact behavior of `caddy trust` inside Docker Desktop on macOS / Windows / WSL hosts varies; Pitfall 3 surfaces this honestly.
- Whether `psycopg2-binary` 2.9.9 specifically ships a manylinux_aarch64 wheel for Python 3.11 — historically yes, but planner should verify with `pip download --platform manylinux2014_aarch64 --python-version 3.11 --only-binary=:all: psycopg2-binary==2.9.9` if the build fails. (See A6.)

## Metadata

**Confidence breakdown:**
- Standard stack (versions, multi-arch availability): HIGH — verified via PyPI / Docker Hub manifest API.
- Architecture patterns (Caddyfile SPA+API, migrate service, multi-stage uv Dockerfile): HIGH — sourced from official canonical patterns.
- Pitfalls (shm_size, handle vs handle_path, uv lockfile semantics, tls internal trust): HIGH — verified via official docs + multiple corroborating sources.
- D-08 strategy recommendation (B over A): MEDIUM — researcher's pick honoring D-07 verbatim; ASSUMED user prefers minimum lockfile sprawl. See A2.
- Postgres `shm_size` exact value (1g vs 2g vs 5g): MEDIUM — rule of thumb supported, exact number depends on workload. See A1, Open Question 4.
- Cross-platform `cp`/`rm -rf` in build:web script: MEDIUM — flagged as a pragmatic addition for future Windows users.

**Research date:** 2026-05-03
**Valid until:** 2026-06-03 (30 days — base images and uv release cadence is monthly; re-verify image tags and uv version before plan execution if more than 30 days elapse)
