---
phase: 04-containerize-and-compose-locally
plan: 05
type: execute
wave: 2
depends_on:
  - "04-01"
  - "04-02"
  - "04-04"
files_modified:
  - infra/docker-compose.prod.yml
  - infra/Caddyfile
autonomous: true
requirements:
  - DEPLOY-01
  - DEPLOY-04
  - DOMAIN-04
  - OPS-04
tags:
  - docker-compose
  - caddy
  - postgres
  - migrations
must_haves:
  truths:
    - "`docker compose -f infra/docker-compose.prod.yml up` brings up db -> migrate (exits 0) -> api -> caddy in that order"
    - "Alembic migrations run via the one-shot `migrate` service BEFORE the api container accepts traffic (depends_on: condition: service_completed_successfully)"
    - "Postgres is tuned with shared_buffers=3GB, effective_cache_size=8GB, max_connections=50 and shm_size>=1g"
    - "Caddy serves frontend/dist at `/` via file_server and reverse-proxies `/api/*` to `api:8000` on the same origin"
    - "tls internal serves a self-signed cert at https://localhost so HTTPS code paths are exercised on the laptop"
  artifacts:
    - path: "infra/docker-compose.prod.yml"
      provides: "Four services: db, migrate, api, caddy with depends_on chain and OPS-04 tuning"
      contains: "condition: service_completed_successfully"
    - path: "infra/Caddyfile"
      provides: "Same-origin SPA + API reverse-proxy"
      contains: "reverse_proxy api:8000"
  key_links:
    - from: "infra/docker-compose.prod.yml api service"
      to: "infra/docker-compose.prod.yml migrate service"
      via: "depends_on: migrate: condition: service_completed_successfully"
      pattern: "service_completed_successfully"
    - from: "infra/Caddyfile /api/* handle block"
      to: "api:8000 (Docker DNS)"
      via: "reverse_proxy"
      pattern: "reverse_proxy api:8000"
    - from: "infra/docker-compose.prod.yml caddy service"
      to: "frontend/dist/"
      via: "read-only bind mount"
      pattern: "../frontend/dist:/srv:ro"
---

<objective>
Author the production-shape compose stack (`infra/docker-compose.prod.yml`) and the same-origin Caddy site config (`infra/Caddyfile`). Four services: `db` (tuned Postgres), `migrate` (one-shot Alembic), `api` (uv-built image from Plan 01), `caddy` (serves frontend bundle + reverse-proxies `/api/*`). Dependency chain enforces migrations-before-traffic via `depends_on: condition: service_completed_successfully` (Pitfall 8 mitigation).

Purpose: The core of Phase 4 — DEPLOY-01 (orchestration), DEPLOY-04 (migrations-first), OPS-04 (Postgres tuning ≈3 GB shared_buffers), DOMAIN-04 (same-origin via Caddy).
Output: Compose + Caddyfile; together they satisfy 4 of the 5 ROADMAP success criteria for this phase.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md
@.planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md
@.planning/phases/04-containerize-and-compose-locally/04-RESEARCH.md
@.planning/phases/04-containerize-and-compose-locally/04-01-SUMMARY.md
@.planning/phases/04-containerize-and-compose-locally/04-02-SUMMARY.md
@.planning/phases/04-containerize-and-compose-locally/04-04-SUMMARY.md
@infra/Dockerfile.api
@infra/docker-compose.dev.yml
@infra/.env.example
@backend/alembic.ini
</context>

<interfaces>
<!-- Canonical compose service shape (see 04-PATTERNS.md and 04-RESEARCH.md lines 477-554): -->
<!-- -->
<!-- services: -->
<!--   db: -->
<!--     image: postgres:15-alpine -->
<!--     restart: unless-stopped -->
<!--     env_file: ./.env -->
<!--     command: ["postgres","-c","shared_buffers=3GB","-c","effective_cache_size=8GB","-c","max_connections=50"] -->
<!--     shm_size: 1g -->
<!--     volumes: [wallet_pgdata_prod:/var/lib/postgresql/data] -->
<!--     healthcheck: pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}  (start_period: 30s) -->
<!-- -->
<!--   migrate: -->
<!--     build: { context: ../backend, dockerfile: ../infra/Dockerfile.api } -->
<!--     image: wallet-app/api:local -->
<!--     env_file: ./.env -->
<!--     command: ["alembic","upgrade","head"] -->
<!--     restart: "no" -->
<!--     depends_on: { db: { condition: service_healthy } } -->
<!-- -->
<!--   api: -->
<!--     image: wallet-app/api:local -->
<!--     env_file: ./.env -->
<!--     depends_on: { migrate: { condition: service_completed_successfully } } -->
<!--     healthcheck against /health -->
<!--     NO ports published -->
<!-- -->
<!--   caddy: -->
<!--     image: caddy:alpine -->
<!--     ports: ["80:80","443:443"] -->
<!--     environment: { CADDY_DOMAIN, CADDY_TLS_MODE }   <-- explicit; NO env_file -->
<!--     volumes: -->
<!--       - ./Caddyfile:/etc/caddy/Caddyfile:ro -->
<!--       - ../frontend/dist:/srv:ro -->
<!--       - caddy_data:/data -->
<!--       - caddy_config:/config -->
<!--     depends_on: { api: { condition: service_healthy } } -->
<!-- -->
<!-- volumes: wallet_pgdata_prod, caddy_data, caddy_config -->
<!-- -->
<!-- Caddyfile (D-10, 04-PATTERNS.md): -->
<!-- {$CADDY_DOMAIN:localhost} { -->
<!--     tls {$CADDY_TLS_MODE:internal} -->
<!--     encode zstd gzip -->
<!--     handle /api/* { reverse_proxy api:8000 } -->
<!--     handle { root * /srv ; try_files {path} /index.html ; file_server } -->
<!-- } -->
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Author infra/Caddyfile (same-origin SPA + /api/* reverse-proxy)</name>
  <files>infra/Caddyfile</files>
  <read_first>
    - .planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md (D-10, D-11 — exact Caddyfile skeleton + HSTS exclusion)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 181-209 — Caddyfile constraints: handle vs handle_path, ordering invariant)
    - .planning/phases/04-containerize-and-compose-locally/04-RESEARCH.md (search "Caddyfile (canonical SPA + API same-origin)")
  </read_first>
  <action>
    Create `infra/Caddyfile` with exactly this content:

    ```
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

    Invariants (per D-10 / 04-PATTERNS.md):
    - Use `handle` (preserves path prefix) — NOT `handle_path` (would strip `/api`, breaking FastAPI which mounts at `/api/v1/...`). Pitfall 4.
    - `handle /api/*` MUST come BEFORE the catch-all `handle` block. Reversing the order routes `/api/*` into the SPA fallback. Pitfall 9.
    - NO `header Strict-Transport-Security ...` directive — HSTS is deferred to Phase 6 (D-11) because `tls internal` self-signed certs would pin browsers to a dev cert.
    - Env-var substitution syntax `{$NAME:default}` — `CADDY_DOMAIN` defaults to `localhost`, `CADDY_TLS_MODE` defaults to `internal`. Compose passes them via the `caddy` service's `environment:` block (NOT `env_file:` — see Plan 02 + 04-RESEARCH.md Pitfall 6).
    - The site address is the bare `{$CADDY_DOMAIN:localhost}` (no scheme prefix) — Caddy auto-selects HTTPS when `tls` is configured.
  </action>
  <verify>
    <automated>test -f infra/Caddyfile && docker run --rm -v "$(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:alpine caddy validate --config /etc/caddy/Caddyfile</automated>
  </verify>
  <acceptance_criteria>
    - `test -f infra/Caddyfile` exits 0
    - `grep -c '{$CADDY_DOMAIN:localhost}' infra/Caddyfile` returns 1
    - `grep -c 'tls {$CADDY_TLS_MODE:internal}' infra/Caddyfile` returns 1
    - `grep -c 'reverse_proxy api:8000' infra/Caddyfile` returns 1
    - `grep -c 'try_files {path} /index.html' infra/Caddyfile` returns 1
    - `grep -c 'root \* /srv' infra/Caddyfile` returns 1
    - `grep -c 'file_server' infra/Caddyfile` returns 1
    - `grep -c 'handle_path' infra/Caddyfile` returns 0 (NOT handle_path)
    - `grep -c 'Strict-Transport-Security' infra/Caddyfile` returns 0 (HSTS deferred to Phase 6)
    - Block-ordering check: `awk '/handle \/api\/\*/ {api=NR} /handle \{/ {catchall=NR} END {exit !(api < catchall)}' infra/Caddyfile` exits 0 (api handle precedes catch-all)
    - `docker run --rm -v "$(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:alpine caddy validate --config /etc/caddy/Caddyfile` exits 0
  </acceptance_criteria>
  <done>Caddyfile validates; `/api/*` proxies to `api:8000`; catch-all serves SPA from `/srv`.</done>
</task>

<task type="auto">
  <name>Task 2: Author infra/docker-compose.prod.yml (db + migrate + api + caddy with full dependency chain)</name>
  <files>infra/docker-compose.prod.yml</files>
  <read_first>
    - infra/Dockerfile.api (just-built — referenced by `build:` blocks)
    - infra/docker-compose.dev.yml (sibling — share `infra/` directory)
    - infra/.env.example (env keys must match what `env_file:` references at runtime)
    - backend/alembic.ini (verify Alembic is invoked simply as `alembic upgrade head`)
    - .planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md (D-13, D-14, D-15, D-17 — exact tuning flags, volume name, env_file scope)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 114-167 — full compose service templates)
    - .planning/phases/04-containerize-and-compose-locally/04-RESEARCH.md (search "Multi-stage Dockerfile (uv, Strategy B)" and "migrate service")
  </read_first>
  <action>
    Create `infra/docker-compose.prod.yml`. Exact content:

    ```yaml
    # infra/docker-compose.prod.yml — Phase 4 production-shape stack (DEPLOY-01, OPS-04, DOMAIN-04)
    # Bring up:   docker compose -f infra/docker-compose.prod.yml up -d --wait
    # Tear down:  docker compose -f infra/docker-compose.prod.yml down -v

    services:
      db:
        image: postgres:15-alpine
        container_name: wallet_db_prod
        restart: unless-stopped
        env_file: ./.env
        environment:
          POSTGRES_USER: ${POSTGRES_USER}
          POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
          POSTGRES_DB: ${POSTGRES_DB}
        command:
          - "postgres"
          - "-c"
          - "shared_buffers=3GB"
          - "-c"
          - "effective_cache_size=8GB"
          - "-c"
          - "max_connections=50"
        shm_size: 1g
        volumes:
          - wallet_pgdata_prod:/var/lib/postgresql/data
        healthcheck:
          test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
          interval: 10s
          timeout: 5s
          retries: 5
          start_period: 30s

      migrate:
        build:
          context: ../backend
          dockerfile: ../infra/Dockerfile.api
          platforms:
            - linux/arm64
        image: wallet-app/api:local
        container_name: wallet_migrate_prod
        env_file: ./.env
        command: ["alembic", "upgrade", "head"]
        restart: "no"
        depends_on:
          db:
            condition: service_healthy

      api:
        image: wallet-app/api:local
        container_name: wallet_api_prod
        restart: unless-stopped
        env_file: ./.env
        depends_on:
          migrate:
            condition: service_completed_successfully
        healthcheck:
          test: ["CMD", "python", "-c", "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status == 200 else 1)"]
          interval: 15s
          timeout: 3s
          retries: 5
          start_period: 10s

      caddy:
        image: caddy:alpine
        container_name: wallet_caddy_prod
        restart: unless-stopped
        environment:
          CADDY_DOMAIN: ${CADDY_DOMAIN:-localhost}
          CADDY_TLS_MODE: ${CADDY_TLS_MODE:-internal}
        ports:
          - "80:80"
          - "443:443"
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

    Critical invariants (verify on every line you write):
    - NO `version:` top-level key (Compose v2 ignores it).
    - NO published port on `db` or `api` — Caddy is sole ingress (Pitfall: production must not expose 5432 or 8000).
    - `env_file: ./.env` applied ONLY to `db`, `migrate`, `api`. NEVER to `caddy` — Caddy gets only `CADDY_DOMAIN` and `CADDY_TLS_MODE` via explicit `environment:` (Pitfall 6 — blast-radius scoping; T-04-15 below).
    - `command:` on db is an EXEC-form array (not shell string) so each `-c flag=value` is its own argv entry.
    - `shm_size: 1g` on db (3 GB shared_buffers requires ≥1 GB shared memory; Pitfall 1).
    - Volume name `wallet_pgdata_prod` (NOT `postgres_data`) — D-15, prevents collision with the dev compose's `postgres_data` volume on the same laptop.
    - `migrate` uses `restart: "no"` (one-shot) and the API image (rebuilt via `build:` block on first compose-up; tagged `wallet-app/api:local` so `api` and `migrate` share it without rebuilding).
    - `depends_on: condition: service_completed_successfully` for `api -> migrate` is THE Pitfall-8 mitigation (no entrypoint wait-script, no Alembic worker race).
    - `start_period: 30s` on db healthcheck (3 GB shared_buffers allocation needs the runway).
    - `$${POSTGRES_USER}` (double-$ ) in pg_isready test — escapes Compose interpolation so the shell-inside-container expands the env var at exec time.
    - `caddy` healthcheck not required (it's the ingress; if it's down the user can't reach anything anyway — failure is visible).
    - Both `caddy:alpine` and `postgres:15-alpine` ship arm64 manifests (verified in RESEARCH.md sources).
  </action>
  <verify>
    <automated>docker compose -f infra/docker-compose.prod.yml config -q</automated>
  </verify>
  <acceptance_criteria>
    - `test -f infra/docker-compose.prod.yml` exits 0
    - `grep -c '^version:' infra/docker-compose.prod.yml` returns 0
    - `grep -c 'image: postgres:15-alpine' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'image: caddy:alpine' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'shared_buffers=3GB' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'effective_cache_size=8GB' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'max_connections=50' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'shm_size: 1g' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'wallet_pgdata_prod' infra/docker-compose.prod.yml` returns at least 2 (volume defined + mounted)
    - `grep -c 'condition: service_completed_successfully' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'condition: service_healthy' infra/docker-compose.prod.yml` returns 2 (migrate->db, caddy->api)
    - `grep -c 'command: \["alembic", "upgrade", "head"\]' infra/docker-compose.prod.yml` returns 1
    - `grep -c 'restart: "no"' infra/docker-compose.prod.yml` returns 1 (migrate is one-shot)
    - `grep -c '../frontend/dist:/srv:ro' infra/docker-compose.prod.yml` returns 1
    - `grep -c '../infra/Dockerfile.api' infra/docker-compose.prod.yml` returns 1
    - `grep -c '5432:5432' infra/docker-compose.prod.yml` returns 0 (no db port publication)
    - `grep -c '8000:8000' infra/docker-compose.prod.yml` returns 0 (no api port publication)
    - Caddy scope check: `awk '/^  caddy:/,/^  [a-z]/' infra/docker-compose.prod.yml | grep -c 'env_file:' ` returns 0 (caddy has NO env_file)
    - `docker compose -f infra/docker-compose.prod.yml config -q` exits 0
    - `docker compose -f infra/docker-compose.prod.yml config | grep -A1 'caddy:' | grep -q 'env_file' && exit 1 || true` (caddy has no env_file in rendered config)
  </acceptance_criteria>
  <done>Compose config lints clean; all four services declared with full dependency chain and OPS-04 tuning.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser -> caddy (port 443) | Untrusted HTTPS request, TLS terminated by Caddy |
| caddy -> api (port 8000, docker network) | Trusted internal hop on user-defined bridge network |
| caddy -> /srv read-only mount | Caddy serves files; cannot write back to host frontend/dist |
| api -> db (port 5432, docker network) | Internal Postgres connection over compose network only |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-15 | Information Disclosure / Lateral Movement | Caddy compromise leaks DB credentials because `env_file: .env` covers all services | mitigate | `env_file: ./.env` is applied ONLY to db/migrate/api. Caddy receives only `CADDY_DOMAIN` and `CADDY_TLS_MODE` via explicit `environment:` (Pitfall 6). Acceptance test greps caddy block for env_file == 0. |
| T-04-16 | Information Disclosure | Postgres port 5432 published to host -> reachable from LAN / other dev VMs | mitigate | No `ports:` declaration on `db`. Acceptance test `grep -c '5432:5432' compose == 0`. |
| T-04-17 | Information Disclosure | API port 8000 published to host -> bypasses Caddy auth/TLS | mitigate | No `ports:` declaration on `api`. Acceptance test `grep -c '8000:8000' compose == 0`. |
| T-04-18 | Tampering | Migrations run AFTER API accepts traffic -> requests hit unmigrated schema -> data corruption | mitigate | `depends_on: migrate: condition: service_completed_successfully` on api (Pitfall 8). Acceptance grep enforces. |
| T-04-19 | Spoofing / Tampering | `handle_path /api/*` typo strips prefix; user-controlled path data routed incorrectly | mitigate | Caddyfile uses `handle` (not `handle_path`). Acceptance test `grep -c handle_path == 0`. |
| T-04-20 | Denial of Service | Default `/dev/shm = 64MB` triggers Postgres restart loop with 3 GB shared_buffers | mitigate | `shm_size: 1g` set on db service (Pitfall 1). |
| T-04-21 | Tampering | Read-write bind mount of `frontend/dist` lets a compromised Caddy write attacker-controlled assets to host | mitigate | Mount is `:ro` (read-only). Acceptance test verifies `../frontend/dist:/srv:ro` literal. |
| T-04-22 | Information Disclosure | `tls internal` root CA leakage from `caddy_data` volume | accept | Dev-only laptop scenario; volume is local Docker-managed, no host mount. Phase 6 swaps to ACME for real prod cert. |
| T-04-23 | Spoofing | Cross-arch image accidentally built (amd64) on amd64 dev machine -> doesn't match Oracle arm64 target | mitigate | `platforms: [linux/arm64]` under `build:`; Plan 01 Dockerfile pins `--platform=linux/arm64` on both FROM lines. |
</threat_model>

<verification>
- `docker compose -f infra/docker-compose.prod.yml config -q` exits 0.
- `docker compose -f infra/docker-compose.prod.yml up -d --wait` brings up all four services with no manual orchestration. (End-to-end verification belongs to Plan 06.)
- Caddy proxies `/api/*` to api:8000; `tls internal` serves https://localhost.
</verification>

<success_criteria>
- DEPLOY-01: docker-compose.prod.yml orchestrates db + migrate + api + caddy on a single VM with separate dev compose.
- DEPLOY-04: Alembic migrations run via depends_on: service_completed_successfully before api takes traffic.
- DOMAIN-04: Caddy reverse-proxies `/api/*` to api:8000 (same-origin); CORS becomes a non-issue.
- OPS-04: Postgres tuned with shared_buffers=3GB and shm_size=1g.
</success_criteria>

<output>
After completion, create `.planning/phases/04-containerize-and-compose-locally/04-05-SUMMARY.md`.
</output>
