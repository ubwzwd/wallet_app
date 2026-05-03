# Phase 4: Containerize and Compose Locally - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 04-containerize-and-compose-locally
**Areas discussed:** Repo layout, Frontend API URL strategy, uv vs Poetry scope, Caddy local-laptop TLS, Frontend build flow, Postgres tuning mechanism, `.env.example` field list, Migrate service Dockerfile, Caddyfile structure

---

## Repo Layout for Prod Infra

### Where should production infra files live?

| Option | Description | Selected |
|--------|-------------|----------|
| `infra/` dir at repo root | New top-level `infra/` containing `docker-compose.prod.yml`, `Caddyfile`, `.env.example`. Matches roadmap's `infra/.env.example` reference. | ✓ |
| Repo root (no infra dir) | Files at repo root next to `README.md`. Discoverable but clutters root. | |
| Nested under `backend/` | Extend existing `backend/docker-compose.yml` location. Conflates prod orchestration with backend app. | |

**User's choice:** `infra/` dir at repo root

### What about the existing `backend/docker-compose.yml`?

| Option | Description | Selected |
|--------|-------------|----------|
| Leave it untouched | Two compose files in different locations, two purposes. | |
| Move to `infra/docker-compose.dev.yml` | Co-locate dev and prod compose under `infra/`. | ✓ |
| Replace with compose profiles | Single file with `profiles: [dev, prod]`. Roadmap calls for separate prod compose. | |

**User's choice:** Move to `infra/docker-compose.dev.yml`

---

## Frontend API URL Strategy

### How should the frontend resolve the API base URL?

| Option | Description | Selected |
|--------|-------------|----------|
| Relative `/api/v1` in prod, `EXPO_PUBLIC_API_URL` for dev | Removes hardcoded `localhost:8000` entirely; axios accepts relative `baseURL` on web. | ✓ |
| `EXPO_PUBLIC_API_URL` always required | Always read from env at build time. Most explicit but easy to forget in CI. | |
| Keep `__DEV__` branch but swap prod URL | Minimal change; still has `__DEV__` branching with hardcoded dev URL. | |

**User's choice:** Relative `/api/v1` in prod, `EXPO_PUBLIC_API_URL` for dev

### How to enforce that prod bundles never contain `localhost:8000`?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 4 grep check only | Manual `grep` on built JS per success criterion 3; promote to CI in Phase 7. | |
| Shell-script assertion in build pipeline | `scripts/check-bundle.sh` fails non-zero on `localhost:8000` match. | |
| Build-time error if `__DEV__` false but env unset | Runtime guard in `config.ts`. | |
| **Other (user free-text):** "use different config file in dev and prd, so that prd will only read prd config" | Split source into two files; prod build cannot transitively import dev string. | ✓ |

**User's choice:** Different config files for dev/prod (free-text)
**Notes:** User's intent is structural — prod source must not import dev source, so `localhost:8000` cannot appear in the bundle even before any grep check.

### How should the dev/prod config file get selected at build time?

| Option | Description | Selected |
|--------|-------------|----------|
| Build script swaps the file | Two files (`config.dev.ts`, `config.prod.ts`); npm script copies the right one to `config.ts` before `expo export -p web`. Simple, no Metro config tweaks. | ✓ |
| Metro custom resolver / source extensions | `metro.config.js` resolves `@/constants/config` to dev or prod variant by env. | |
| Babel `transform-inline-environment-variables` + dead-code branch | Single `config.ts` with `process.env.NODE_ENV` branch; minifier drops dev branch. | |

**User's choice:** Build script swaps the file

---

## uv vs Poetry Scope

### How wide should the uv adoption be?

| Option | Description | Selected |
|--------|-------------|----------|
| uv only in prod Dockerfile builder | Dev keeps Poetry; prod builder uses uv against `pyproject.toml`. No dev workflow change. | ✓ |
| Full migration to uv (dev + prod) | Replace Poetry entirely; regenerate `uv.lock`, delete `poetry.lock`. Sizable migration. | |
| Skip uv — pip + requirements.txt | Generate requirements.txt via `poetry export`, then `pip install`. Diverges from DEPLOY-02. | |

**User's choice:** uv only in prod Dockerfile builder

### How does the prod Dockerfile get the dependency list?

| Option | Description | Selected |
|--------|-------------|----------|
| `uv pip install --system pyproject.toml` directly | uv reads `pyproject.toml` natively; no intermediate file. | ✓ |
| Poetry export → requirements.txt → uv install | Adds Poetry to builder image just for export; pins to Poetry's resolution. | |
| Commit `requirements.txt`, regenerate via Makefile | Two lockfiles; risk of drift. | |

**User's choice:** `uv pip install --system pyproject.toml` directly
**Notes:** Researcher must verify whether uv reading pyproject.toml directly respects (or can be made to respect) Poetry's lockfile resolution; if drift on transitive versions is possible, planner should add a `--frozen`-equivalent guard.

---

## Caddy Local-Laptop TLS + Frontend Build Flow

### How should Caddy handle TLS when running compose on a laptop?

| Option | Description | Selected |
|--------|-------------|----------|
| `tls internal` self-signed | Exercises HTTPS code path on laptop (HSTS, secure cookies, SW). Browser warns once. | ✓ |
| `auto_https off` HTTP-only | Simplest; no cert prompts. Prod-only behaviors not exercised on laptop. | |
| Templated Caddyfile via env vars | Single file with placeholders; same file works for laptop and prod. | |

**User's choice:** `tls internal` self-signed
**Notes:** Implementation actually combines this with templated env vars — the chosen Caddyfile uses `{$CADDY_DOMAIN:localhost}` and `{$CADDY_TLS_MODE:internal}`, defaulting to `tls internal` on laptop and swapped to default LE in Phase 6.

### How is the Expo web bundle prepared for Caddy in Phase 4?

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-build on host, bind-mount `frontend/dist` | Developer runs `npm run build:web`; compose mounts `../frontend/dist` read-only into Caddy. | ✓ |
| One-shot frontend builder service in compose | Node container builds bundle into shared volume. Self-contained but slower iteration. | |
| Frontend builder image (proper container) | Multi-stage frontend Dockerfile; Caddy image IS the frontend image. Closest to Phase 7 CI shape. | |

**User's choice:** Pre-build on host, bind-mount

---

## Postgres Tuning Mechanism

### Mechanism and breadth of tuning?

| Option | Description | Selected |
|--------|-------------|----------|
| `command:` flags, `shared_buffers` + `effective_cache_size` only | Two parameters that move the Oracle 20% reclaim needle + sane connection cap. | ✓ |
| `command:` flags with full tuning suite | PGTune-style: `work_mem`, `maintenance_work_mem`, `random_page_cost`, etc. More to maintain without workload data. | |
| Mount custom `postgresql.conf` | Cleaner config-as-file; survives compose edits. Adds a file. | |

**User's choice:** `command:` flags, `shared_buffers` + `effective_cache_size` only

---

## `.env.example` Field List

### What goes in `infra/.env.example`?

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical full list with `CHANGE_ME` placeholders | Every var the prod stack reads, with explicit `CHANGE_ME_*` placeholders that fail loudly. | ✓ |
| Minimum required only | Just secrets without safe defaults; defaults baked into compose. | |
| Split: `.env.example` (secrets) + `infra/compose.env` (defaults) | Two files; clean separation but more to reason about. | |

**User's choice:** Canonical full list with `CHANGE_ME` placeholders

---

## Migrate Service Dockerfile

### Migrate service image strategy?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse API image with override `command` | Same backend image; `command: alembic upgrade head`. One image, one build cache. | ✓ |
| Separate slim migrate image | Smaller, faster cold start. Two images to keep version-aligned. | |
| Init container with entrypoint script | Reuse API image with shell script; flexible but adds maintenance. | |

**User's choice:** Reuse API image with override `command`

---

## Caddyfile Structure

### Caddyfile organisation?

| Option | Description | Selected |
|--------|-------------|----------|
| Single site block, env-var driven | One Caddyfile with `{$CADDY_DOMAIN:localhost}` / `{$CADDY_TLS_MODE:internal}`. Phase 6 swap = two env vars. | ✓ |
| Split via `import` directives | `import api.caddy`, `import static.caddy`, etc. Modular but more files. | |
| Two Caddyfiles (local + prod) | `Caddyfile.local` + `Caddyfile.prod`; explicit but parallel maintenance. | |

**User's choice:** Single site block, env-var driven

---

## Claude's Discretion

- Exact Dockerfile syntax for installing uv in the builder stage (`pip install uv` vs `ghcr.io/astral-sh/uv` base image).
- Whether `frontend/src/constants/config.ts` is gitignored (with `config.dev.ts` as committed default and build script restoring) or committed (with build script swapping in/out).
- Caddy `try_files` ordering and exact MIME / cache headers for static assets.
- Compose `restart:` policy values (likely `unless-stopped` for db/api/caddy, no restart for `migrate`).
- Compose healthcheck definitions (DB `pg_isready`, API existing `/health`).
- Whether to retire/overwrite `backend/Dockerfile` outright or co-exist with new `infra/Dockerfile.api`.

## Deferred Ideas

- HSTS header → Phase 6 (DOMAIN-03)
- `/health` DB-outage independence formal test → Phase 6 (OPS-01)
- CI grep assertion for `localhost:8000` → Phase 7 (CI-01)
- `docker rollout` zero-downtime → Phase 7 (DEPLOY-06)
- Backup destination (R2 vs B2 vs S3) → Phase 7 planning
- Real domain + Let's Encrypt staging→prod → Phase 6 (DOMAIN-01/02)
- PWA manifest, service worker, mobile polish → Phase 5
- Image vulnerability scanning, SOPS/Doppler/Vault, structured logs, Sentry → "harden production" milestone (out of v2.0)
