# Phase 4: Containerize and Compose Locally - Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 16 (9 NEW, 7 MODIFIED)
**Analogs found:** 14 / 16 (2 greenfield with no in-repo analog)

This phase is infrastructure-heavy (Docker, Compose, Caddy, shell scripts, env files) rather than application-code-heavy. "Role" maps to artifact type (Dockerfile, compose service, Caddyfile, env example, frontend constants, npm script, shell script). "Data flow" maps to build-time vs runtime semantics.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `infra/Dockerfile.api` (or replace `backend/Dockerfile`) | Dockerfile (multi-stage) | build-time | `backend/Dockerfile` | exact (same file, dependency installer swap) |
| `infra/docker-compose.prod.yml` | Compose orchestration | runtime | `backend/docker-compose.yml` | exact (db service is a direct template; api/migrate/caddy services are net-new) |
| `infra/docker-compose.dev.yml` | Compose orchestration (dev db only) | runtime | `backend/docker-compose.yml` | exact (file move + drop `version:` line) |
| `infra/Caddyfile` | Reverse-proxy + static-server config | runtime | none in repo | no analog (greenfield; copy from RESEARCH.md §"Code Examples → Caddyfile") |
| `infra/.env.example` | Env-var template | build/runtime config | `backend/env.example` | exact (template structure; key list expanded per D-16) |
| `infra/.env` (gitignored) | Secrets file | runtime | `backend/.env` (developer-local, untracked) | role-match (gitignored secrets file) |
| `infra/scripts/smoke.sh` | Bash smoke-test script | post-deploy verification | none in repo | no analog (greenfield; pattern from RESEARCH.md §"Phase Requirements → Test Map") |
| `infra/scripts/env-coverage.sh` | Bash env-var coverage script | static analysis | none in repo | no analog (greenfield; verifies `infra/.env.example` covers `Settings` fields in `backend/app/core/config.py`) |
| `frontend/src/constants/config.dev.ts` | Frontend constants module | build-time selection | `frontend/src/constants/config.ts` | exact (split source) |
| `frontend/src/constants/config.prod.ts` | Frontend constants module | build-time selection | `frontend/src/constants/config.ts` | exact (split source) |
| `frontend/src/constants/config.ts` (MODIFIED) | Generated artifact | build-time | itself (current `__DEV__` branch retired) | exact (becomes a copy of `config.dev.ts`) |
| `frontend/package.json` (MODIFIED) | npm script manifest | build orchestration | itself (`scripts:` block) | exact (add `build:web` next to existing `web` / `start`) |
| `frontend/src/api/client.ts` (verify) | Axios HTTP client | runtime request | itself | unchanged (D-05: no client edit needed) |
| `backend/Dockerfile` (MODIFIED or DELETED) | Dockerfile | build-time | itself | exact (Poetry → uv builder swap; or delete in favor of `infra/Dockerfile.api`) |
| `backend/README.md` (MODIFIED) | Docs (paths) | docs | itself | exact (update `docker-compose up` paths) |
| `.gitignore` (MODIFIED) | Git ignore list | source-control | itself | exact (append entries) |

## Pattern Assignments

### `infra/Dockerfile.api` (or modified `backend/Dockerfile`) — Dockerfile, build-time

**Analog:** `backend/Dockerfile` (verbatim — only the dependency-install steps swap from Poetry-direct to uv-via-poetry-export)

**Multi-stage layout pattern** (`backend/Dockerfile` lines 1-54):

```dockerfile
# Multi-stage build for production
FROM python:3.11-slim as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN pip install poetry==1.7.1

WORKDIR /app
COPY pyproject.toml poetry.lock* ./

RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi --no-root --only main

# Production stage
FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**What to KEEP from analog (carry forward verbatim):**
- Multi-stage `builder` → `runtime` separation (lines 1-2, 23-24).
- Runtime libpq5 install + cleanup (lines 27-29).
- Non-root user creation: `RUN useradd -m -u 1000 appuser` (line 32).
- `WORKDIR /app` (line 34).
- Cross-stage `COPY --from=builder /usr/local/lib/python3.11/site-packages ...` and `/usr/local/bin` (lines 37-38).
- App copy with chown: `COPY --chown=appuser:appuser . .` (line 41).
- `USER appuser` AFTER copy (line 44) — preserves Pitfall 7 (RESEARCH.md) avoidance.
- `EXPOSE 8000` (line 47).
- `HEALTHCHECK` block structure (lines 50-51) — replace `requests` one-liner with `urllib.request` per RESEARCH.md A7 / Pitfall recommendation to avoid carrying `requests` into runtime image purely for the healthcheck.
- `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` (line 54).

**What to CHANGE per CONTEXT.md D-07/D-08/D-09:**
- Add `--platform=linux/arm64` to BOTH `FROM` lines (D-09).
- Drop `postgresql-client` from builder install (only `gcc libpq-dev` needed for psycopg2-binary fallback per RESEARCH.md notes line 441).
- Replace `RUN pip install poetry==1.7.1` + `poetry install` block with the Strategy B sequence from RESEARCH.md §"Multi-stage Dockerfile (uv, Strategy B)" lines 386-437:
  - Add `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/`
  - `pip install poetry==1.7.1 "poetry-plugin-export>=1.8"` in builder
  - `poetry export -f requirements.txt --without-hashes --only main -o /tmp/requirements.txt`
  - `uv pip install --system --no-cache -r /tmp/requirements.txt`

**Healthcheck swap (RESEARCH.md State of the Art):**
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status == 200 else 1)"
```

---

### `infra/docker-compose.prod.yml` — Compose orchestration, runtime

**Analog:** `backend/docker-compose.yml` (db service block is the direct template; api / migrate / caddy services are new but follow the same compose grammar)

**db service template** (`backend/docker-compose.yml` lines 4-20):

```yaml
db:
  image: postgres:15-alpine
  container_name: wallet_db
  restart: unless-stopped
  environment:
    POSTGRES_USER: wallet_user
    POSTGRES_PASSWORD: wallet_password
    POSTGRES_DB: wallet_db
  ports:
    - "5432:5432"
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U wallet_user -d wallet_db"]
    interval: 10s
    timeout: 5s
    retries: 5
```

**Volume declaration pattern** (`backend/docker-compose.yml` lines 43-44):

```yaml
volumes:
  postgres_data:
```

**What to CARRY FORWARD verbatim into prod:**
- `image: postgres:15-alpine` (line 5).
- `restart: unless-stopped` (line 7).
- `pg_isready` healthcheck shape (lines 16-20) — change literal `wallet_user`/`wallet_db` to `$${POSTGRES_USER}` / `$${POSTGRES_DB}` (double `$$` escapes Compose interpolation so the shell expands the env var inside the container).
- Named-volume declaration grammar at file bottom.

**What to CHANGE per CONTEXT.md D-13/D-14/D-15/D-17 + RESEARCH.md Pitfall 1:**
- Drop `version: '3.8'` line — Compose v2 ignores it (RESEARCH.md State of the Art, Open Question 3).
- Drop literal credentials — load via `env_file: ../infra/.env` (D-17).
- Drop `ports: 5432` publication on prod (Caddy is sole ingress; RESEARCH.md Security Domain).
- Add `shm_size: 1g` on db (Pitfall 1).
- Add tuning `command:` block (D-14): `postgres -c shared_buffers=3GB -c effective_cache_size=8GB -c max_connections=50`.
- Add `start_period: 30s` to db healthcheck (allocation time for 3 GB shared_buffers, RESEARCH.md notes line 500).
- Rename volume `postgres_data` → `wallet_pgdata_prod` (D-15) so dev and prod-shape volumes coexist.
- Add `migrate` service (D-13, RESEARCH.md §"migrate service" lines 504-515): `image: wallet-app/api:local` + `restart: "no"` + `command: ["alembic", "upgrade", "head"]` + `depends_on: db: { condition: service_healthy }`.
- Add `api` service: `image: wallet-app/api:local`, `env_file: ../infra/.env`, `depends_on: migrate: { condition: service_completed_successfully }`, healthcheck against `/health`, NO published ports.
- Add `caddy` service: `image: caddy:alpine`, `ports: 80:80, 443:443`, mounts `./Caddyfile`, `../frontend/dist:/srv:ro`, `caddy_data` + `caddy_config` named volumes, `depends_on: api: { condition: service_healthy }`.
- Per RESEARCH.md Pitfall 6: scope `env_file:` to api/migrate/db only; pass only `CADDY_DOMAIN`/`CADDY_TLS_MODE` to caddy via explicit `environment:` block.

Reference the full canonical compose file in RESEARCH.md lines 477-554.

---

### `infra/docker-compose.dev.yml` — Compose orchestration (dev db only), runtime

**Analog:** `backend/docker-compose.yml` (this IS the moved file)

**Action:** `git mv backend/docker-compose.yml infra/docker-compose.dev.yml`. Optional cleanup:
- Drop `version: '3.8'` (line 1) — ignored by Compose v2.
- Update inline comment on line 22 (the commented `api:` service block) to point to `infra/docker-compose.prod.yml` for the real prod-shape API service.
- Keep volume name `postgres_data` (NOT renamed) so dev DB state survives the move.

---

### `infra/Caddyfile` — Reverse-proxy + static-server config, runtime

**Analog:** none in repo (greenfield).

**Pattern source:** RESEARCH.md §"Caddyfile (canonical SPA + API same-origin)" lines 446-468 — verbatim. Already locked by CONTEXT.md D-10. Key invariants:

```caddyfile
{$CADDY_DOMAIN:localhost} {
    tls {$CADDY_TLS_MODE:internal}

    encode zstd gzip

    handle /api/* {
        reverse_proxy api:8000
    }

    handle {
        root * /srv
        try_files {path} /index.html
        file_server
    }
}
```

**Critical constraints (RESEARCH.md Pitfall 4 + Pitfall 9):**
- Use `handle` (preserves prefix), NOT `handle_path` (strips prefix). FastAPI mounts at `/api/v1/...` and expects the full path.
- API `handle` block FIRST, catch-all `handle` (no matcher) SECOND. Reversing the order causes `/api/*` to fall into the SPA shell.
- No HSTS header (CONTEXT.md D-11; Phase 6 adds it).

---

### `infra/.env.example` — Env-var template, build/runtime config

**Analog:** `backend/env.example`

**Imports / structural pattern** (`backend/env.example` lines 1-22):

```bash
# Database Configuration
DATABASE_URL=postgresql://wallet_user:wallet_password@localhost:5432/wallet_db

# JWT Configuration
SECRET_KEY=your-secret-key-here-please-change-this-to-a-random-string
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# API Configuration
API_V1_PREFIX=/api/v1
PROJECT_NAME=Wallet App API
DEBUG=True

# CORS Configuration (comma-separated origins)
ALLOWED_ORIGINS=http://localhost:8081,http://localhost:19006,http://localhost:3000

# Exchange Rate API (Frankfurter - ECB data, no key required)
EXCHANGE_RATE_API_URL=https://api.frankfurter.app

# Environment
ENVIRONMENT=development
```

**What to CARRY FORWARD:**
- Section-header `# Foo Configuration` comment style with blank-line group separators.
- `KEY=value` syntax (no quotes unless value contains spaces).
- Comma-separated `ALLOWED_ORIGINS` convention (consumed by `Settings.allowed_origins_list` in `backend/app/core/config.py` line 41-43).
- `EXCHANGE_RATE_API_URL=https://api.frankfurter.app` (carry verbatim).

**What to CHANGE per CONTEXT.md D-16/D-17 + RESEARCH.md §".env.example skeleton" lines 577-598:**
- Add header comment: chmod 600 reminder + "this file IS committed; infra/.env is gitignored".
- Replace literal placeholders with `CHANGE_ME_*` sentinels so a missed substitution fails loudly: `POSTGRES_USER=CHANGE_ME_POSTGRES_USER`, etc.
- Split `DATABASE_URL` into composed form: `DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}` (host = compose service name `db`, NOT `localhost`).
- Add Postgres trio: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- Add `CADDY_DOMAIN=localhost` and `CADDY_TLS_MODE=internal` (Phase 4 defaults).
- Set `ALLOWED_ORIGINS=https://localhost` (Phase 4 default per D-16; defense-in-depth even with same-origin via Caddy).
- Set `ENVIRONMENT=production`, `DEBUG=False`.
- Drop `API_V1_PREFIX` and `PROJECT_NAME` — these have safe defaults in `backend/app/core/config.py` (lines 20-21) and are not phase-relevant.

**Settings coverage check** (verify `infra/.env.example` populates every required field of `backend/app/core/config.py` `Settings` class lines 11-31): `DATABASE_URL`, `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `DEBUG`, `ALLOWED_ORIGINS`, `EXCHANGE_RATE_API_URL`, `ENVIRONMENT` — all 8 must appear. (Used by `infra/scripts/env-coverage.sh`.)

---

### `infra/scripts/smoke.sh` — Bash smoke-test script, post-deploy verification

**Analog:** none in repo (greenfield).

**Pattern source:** RESEARCH.md §"Phase Requirements → Test Map" (lines 691-706) — synthesize the `curl`/`docker compose` commands listed there.

**Core pattern (assemble from research):**

```bash
#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"

echo "==> compose config lint"
docker compose -f "$COMPOSE_FILE" config -q

echo "==> stack up --wait"
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "==> service states"
docker compose -f "$COMPOSE_FILE" ps

echo "==> /api/v1/health (DOMAIN-04 prefix preserved)"
curl -ksf https://localhost/api/v1/health > /dev/null

echo "==> / (SPA fallback)"
curl -ks https://localhost/ | grep -q "<html"

echo "==> shared_buffers tuning (OPS-04)"
docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "show shared_buffers" | grep -q "3GB"

echo "==> migrate exited 0 (DEPLOY-04)"
docker compose -f "$COMPOSE_FILE" ps migrate --format json | grep -q '"State":"exited"'

echo "OK"
```

**Conventions to follow:**
- `set -euo pipefail` at top (defensive bash standard).
- `${VAR:-default}` for overridable inputs.
- `-T` flag on `docker compose exec` to disable TTY allocation in non-interactive contexts.
- Each check echoed with `==>` prefix for log scannability.

---

### `infra/scripts/env-coverage.sh` — Bash env-var coverage script, static analysis

**Analog:** none in repo (greenfield).

**Pattern (synthesize):** Parse `backend/app/core/config.py` for `Settings` field names; parse `infra/.env.example` for declared keys; diff.

```bash
#!/usr/bin/env bash
set -euo pipefail

CONFIG_PY="backend/app/core/config.py"
ENV_EXAMPLE="infra/.env.example"

# Extract uppercase Settings field names (excluding properties/dunders)
required=$(grep -E '^\s+[A-Z][A-Z_0-9]+:\s' "$CONFIG_PY" | sed -E 's/^\s+([A-Z_0-9]+):.*/\1/' | sort -u)

# Extract declared keys from .env.example
declared=$(grep -E '^[A-Z][A-Z_0-9]+=' "$ENV_EXAMPLE" | sed -E 's/=.*//' | sort -u)

missing=$(comm -23 <(echo "$required") <(echo "$declared"))

if [ -n "$missing" ]; then
  echo "MISSING in $ENV_EXAMPLE:" >&2
  echo "$missing" >&2
  exit 1
fi

echo "OK: all $CONFIG_PY Settings fields appear in $ENV_EXAMPLE"
```

---

### `frontend/src/constants/config.dev.ts` and `config.prod.ts` — Frontend constants, build-time selection

**Analog:** `frontend/src/constants/config.ts` (the source being split)

**Original pattern** (`frontend/src/constants/config.ts` lines 1-28):

```typescript
/**
 * Application configuration constants
 */

// API Base URL - will point to backend API
export const API_BASE_URL = __DEV__ 
  ? 'http://localhost:8000/api/v1'  // Local development
  : 'https://api.yourapp.com/api/v1';  // Production

// Storage keys for AsyncStorage
export const STORAGE_KEYS = {
  AUTH_TOKEN: '@wallet_app:auth_token',
  USER_DATA: '@wallet_app:user_data',
} as const;

// App metadata
export const APP_NAME = 'Wallet App';
export const APP_VERSION = '1.0.0';

// Query keys for TanStack Query
export const QUERY_KEYS = {
  USER: 'user',
  FINANCE_SOURCES: 'finance_sources',
  TRANSACTIONS: 'transactions',
  CURRENCIES: 'currencies',
  EXCHANGE_RATES: 'exchange_rates',
} as const;
```

**Split per CONTEXT.md D-03 / D-04:**

`config.dev.ts` — keeps absolute URL for native dev (iOS / Android emulator can't resolve relative paths):
```typescript
// AUTO-MANAGED: source for native dev + default committed config.ts
// Build script (npm run build:web) swaps in config.prod.ts before expo export -p web.
export const API_BASE_URL = 'http://localhost:8000/api/v1';
// ... rest identical to original config.ts (STORAGE_KEYS, APP_NAME, QUERY_KEYS, etc.)
```

`config.prod.ts` — relative path only (same-origin via Caddy in browser):
```typescript
// Web production via Caddy reverse-proxy. Browser-only — same-origin /api/v1 path.
// CRITICAL: must NOT contain "localhost:8000" (D-06 grep enforces zero hits in dist/).
export const API_BASE_URL = '/api/v1';
// ... rest identical
```

**What to CARRY FORWARD verbatim from `config.ts`:**
- `STORAGE_KEYS` (lines 11-14).
- `APP_NAME`, `APP_VERSION` (lines 17-18).
- `QUERY_KEYS` (lines 21-27).
- `as const` assertions on object literals (lines 14, 27).
- JSDoc-style file header comment (lines 1-3).

**What to RETIRE (D-03 anti-pattern, RESEARCH.md):**
- The `__DEV__` ternary (line 6-8). Future contributors must NOT reintroduce `__DEV__` URL branching — D-04 file-swap is now the only mechanism.

---

### `frontend/src/constants/config.ts` (MODIFIED) — Generated artifact, build-time

**Analog:** itself (current `__DEV__` branch retired)

**Action per Open Question 2 recommendation:** Commit `config.ts` as a copy of `config.dev.ts` (so a fresh clone "just works" for native dev with no extra setup). Build script restores it after `expo export`. Add a top-of-file warning header:

```typescript
/**
 * AUTO-MANAGED FILE — do not edit by hand.
 * Source files: config.dev.ts (committed default), config.prod.ts (web build).
 * `npm run build:web` swaps in config.prod.ts before expo export -p web,
 * then restores config.dev.ts after export.
 */
```

---

### `frontend/package.json` (MODIFIED) — npm script manifest, build orchestration

**Analog:** itself — append to `scripts:` block (lines 5-11)

**Existing pattern** (`frontend/package.json` lines 5-11):
```json
"scripts": {
  "start": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "web": "expo start --web",
  "test": "jest"
}
```

**Add `build:web` per CONTEXT.md D-04 + RESEARCH.md Pitfall 8 (clean dist first):**
```json
"build:web": "rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && cp src/constants/config.dev.ts src/constants/config.ts"
```

Cross-platform note (RESEARCH.md): `cp` and `rm -rf` are POSIX. If Windows host support is needed, swap to `npx rimraf dist` and `npx cpy-cli`. Phase 4 CONTEXT.md does not name a host OS requirement — planner picks.

---

### `frontend/src/api/client.ts` (verify only) — Axios HTTP client, runtime request

**Analog:** itself

**Status:** No edit needed (CONTEXT.md D-05). The import on line 3 already pulls from `@/constants/config`:
```typescript
import { API_BASE_URL, STORAGE_KEYS } from '@/constants/config';
```
Axios accepts a relative `baseURL` string in browsers (line 9: `baseURL: API_BASE_URL`). Phase 4 verification step is a static grep to confirm no other file hardcodes `localhost:8000`.

---

### `backend/Dockerfile` (MODIFIED or DELETED) — Dockerfile, build-time

**Decision per planner (CONTEXT.md D-07 ambient guidance):** Either edit in place (preferred — keeps `backend/` self-contained) OR add `infra/Dockerfile.api` and delete `backend/Dockerfile`. If kept in place, the Compose `build:` block in `infra/docker-compose.prod.yml` references it via `context: ../backend` + `dockerfile: Dockerfile` (matches RESEARCH.md migrate service example lines 506-508).

---

### `backend/README.md` (MODIFIED) — Docs, paths

**Analog:** itself

**Sections to update:**
- Line 50-54 (`### 4. Start PostgreSQL`): change `docker-compose up -d db` → `docker compose -f ../infra/docker-compose.dev.yml up -d db`.
- Lines 119 (Project Structure block): remove `docker-compose.yml` and `Dockerfile` from the tree if both moved/superseded; add a pointer to `../infra/`.
- Lines 134-141 (Docker Development): rewrite to point at `../infra/docker-compose.prod.yml`.
- Lines 192-198 (Troubleshooting `docker-compose ps` / `down -v`): qualify with `-f ../infra/docker-compose.dev.yml`.

Run `grep -rn "backend/docker-compose.yml\|cd backend && docker compose" .` during planning to catch additional doc references.

---

### `.gitignore` (MODIFIED) — Git ignore list, source-control

**Analog:** itself

**Existing pattern** (`.gitignore` lines 1-13):
```
# Editor and IDE
.cursor/
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local
```

**Append per CONTEXT.md D-17 + Runtime State Inventory A5:**
```
# Phase 4 infra
infra/.env

# Frontend web build artifacts
frontend/dist/
```

Note: `.env` is already globally ignored (line 12), which transitively covers `infra/.env`. Adding the explicit line makes the intent visible (`git check-ignore infra/.env` passes either way — Wave 0 SEC-01 test).

---

## Shared Patterns

### Multi-stage Docker non-root user

**Source:** `backend/Dockerfile` lines 31-44

**Apply to:** `infra/Dockerfile.api` (or modified `backend/Dockerfile`)

```dockerfile
RUN useradd -m -u 1000 appuser
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --chown=appuser:appuser . .
USER appuser
```

Carry forward verbatim. Pitfall 7 (RESEARCH.md): keep this exact ordering — `useradd` → `WORKDIR` → `COPY --chown` → `USER`. Do not flip `USER` before the final `COPY` (creates a partial-ownership mix bug).

### `pg_isready` healthcheck

**Source:** `backend/docker-compose.yml` lines 16-20

**Apply to:** `db` service in `infra/docker-compose.prod.yml`

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s   # ADDED for prod (3 GB shared_buffers allocation)
```

The `$${...}` (double-dollar) escapes Compose interpolation so the shell inside the container expands the env var at exec time.

### `env_file:` + pydantic-settings ingestion

**Source:** `backend/app/core/config.py` lines 33-38 (already wired)

```python
model_config = SettingsConfigDict(
    env_file=".env",
    env_file_encoding="utf-8",
    case_sensitive=True,
    extra="allow"
)
```

**Apply to:** `api` and `migrate` services in `infra/docker-compose.prod.yml` via `env_file: ../infra/.env`. Per RESEARCH.md Pitfall 6, do NOT apply `env_file:` to the `caddy` service — pass only `CADDY_DOMAIN` and `CADDY_TLS_MODE` via explicit `environment:` lines to avoid leaking DB credentials and `SECRET_KEY` into a process that has no business with them.

The `extra="allow"` setting on line 37 means `Settings` ignores extra keys (e.g., `POSTGRES_USER`, `CADDY_DOMAIN`) without error — useful for the prod `.env` which carries vars consumed by Postgres / Caddy too.

### Compose dependency conditions

**Source:** RESEARCH.md §"Architecture Patterns" (no in-repo precedent — current dev compose has only db).

**Apply to:** dependency chain in `infra/docker-compose.prod.yml`:

```yaml
migrate:
  depends_on:
    db:
      condition: service_healthy

api:
  depends_on:
    migrate:
      condition: service_completed_successfully

caddy:
  depends_on:
    api:
      condition: service_healthy
```

ROADMAP Pitfall 8 (referenced in CONTEXT.md): this declarative chain is THE alternative to entrypoint shell scripts — do not introduce `wait-for-it.sh` / `dockerize -wait` (RESEARCH.md State of the Art).

### Bash script header convention

**Source:** none in repo — greenfield convention to introduce.

**Apply to:** `infra/scripts/smoke.sh`, `infra/scripts/env-coverage.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
```

Standard defensive bash. `-e` exits on first error; `-u` errors on undefined vars; `-o pipefail` propagates pipe failures. Industry default.

## No Analog Found

| File | Role | Data Flow | Reason | Pattern Source |
|------|------|-----------|--------|----------------|
| `infra/Caddyfile` | reverse-proxy + static-server config | runtime | First Caddy config in repo | RESEARCH.md §"Caddyfile" (canonical Caddy SPA + API pattern from caddyserver.com docs) |
| `infra/scripts/smoke.sh` | bash smoke-test orchestrator | post-deploy verification | First infra-script in repo | RESEARCH.md §"Phase Requirements → Test Map" (assemble `docker compose` + `curl` checks) |
| `infra/scripts/env-coverage.sh` | bash env-coverage check | static analysis | First infra-script in repo | Synthesize from `backend/app/core/config.py` Settings class structure |

## Metadata

**Analog search scope:** `backend/`, `frontend/src/`, `.gitignore`, repo root for top-level files.
**Files scanned (read in full or targeted-extract):** `backend/Dockerfile`, `backend/docker-compose.yml`, `backend/env.example`, `backend/README.md`, `backend/app/main.py`, `backend/app/core/config.py`, `backend/alembic.ini`, `frontend/src/constants/config.ts`, `frontend/src/api/client.ts`, `frontend/package.json`, `.gitignore`.
**Pattern extraction date:** 2026-05-03
**Confidence:** HIGH — all critical analogs (`backend/Dockerfile`, `backend/docker-compose.yml`, `backend/env.example`, `frontend/src/constants/config.ts`) read in full and excerpted with line numbers. Three greenfield files (Caddyfile, two bash scripts) sourced directly from RESEARCH.md canonical patterns.
