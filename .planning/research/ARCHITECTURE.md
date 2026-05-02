# Architecture Research — v2.0 Single-VPS Deployment

**Domain:** Production deployment of an existing FastAPI + Expo web monorepo onto one VM
**Researched:** 2026-05-02
**Confidence:** HIGH (existing arch verified from source; deployment patterns standard for this scope)

---

## 0. Existing Architecture (Recap, Not Re-Researched)

Verified from source files:

- `backend/app/main.py` — registers all routers under `/api/v1`; CORS middleware reads `settings.allowed_origins_list`; exposes `GET /health`.
- `backend/app/core/config.py` — Pydantic Settings; reads `DATABASE_URL`, `SECRET_KEY`, `ALLOWED_ORIGINS` (CSV), `ENVIRONMENT`, `EXCHANGE_RATE_API_URL`. `.env` file loader configured.
- `backend/app/core/database.py` — `pool_size=5`, `max_overflow=10`, `pool_pre_ping=True`, `pool_recycle=3600` already set for non-SQLite engines. Total capacity: 15 connections per backend container.
- `backend/Dockerfile` — multi-stage Python 3.11-slim + Poetry; non-root `appuser`; `EXPOSE 8000`; healthcheck baked in (uses `requests`, must verify `requests` is in deps or replace with `urllib`).
- `backend/docker-compose.yml` — only `db` service active; `api` block is commented stub.
- `frontend/src/constants/config.ts` — `API_BASE_URL` is hardcoded ternary on `__DEV__`: dev → `http://localhost:8000/api/v1`, prod → `https://api.yourapp.com/api/v1`. **No env var support today.**
- `frontend/src/api/client.ts` — single import site for `API_BASE_URL`; flipping the constant flips the whole app.
- `frontend/app.json` — Expo SDK 54; `newArchEnabled: true`; **no `web.output` key set** (defaults to `single` page app, not static export).

Key implication: the prod URL is currently `https://api.yourapp.com/...` (placeholder). The frontend was always intended to call a separate API host. We will revisit this decision in §1 and §4.

---

## 1. Network Topology — Request Path on the VM

### Decision: same-origin subpath (`/api/*`), NOT subdomain

```
                                 Internet
                                     │
   ┌─────────────────────────────────┼─────────────────────────────────┐
   │                                 │                                 │
   │  Phone browser                  │   Desktop browser               │
   │  https://wallet.example.com     │   https://wallet.example.com    │
   │                                 │                                 │
   └─────────────────────────────────┼─────────────────────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────┐
                    │  Cloudflare DNS (proxy OFF)     │   ← orange-cloud OFF;
                    │  A wallet.example.com → VM_IP   │     Caddy issues its
                    └────────────────┬────────────────┘     own LE cert.
                                     │
                                     ▼ :443 / :80
   ╔═════════════════════════════════╪═════════════════════════════════╗
   ║  VM (Hetzner SG ARM or Oracle Free Ampere)                        ║
   ║                                 │                                 ║
   ║   ┌─────────────────────────────▼──────────────────────────────┐  ║
   ║   │ Caddy container (host port 80/443 → container 80/443)      │  ║
   ║   │                                                            │  ║
   ║   │   wallet.example.com {                                     │  ║
   ║   │     handle /api/* {                                        │  ║
   ║   │       reverse_proxy backend:8000                           │  ║
   ║   │     }                                                      │  ║
   ║   │     handle /health {                                       │  ║
   ║   │       reverse_proxy backend:8000                           │  ║
   ║   │     }                                                      │  ║
   ║   │     handle /* {                                            │  ║
   ║   │       root * /srv/web                                      │  ║
   ║   │       try_files {path} /index.html                         │  ║
   ║   │       file_server                                          │  ║
   ║   │       header Cache-Control "public, max-age=31536000,      │  ║
   ║   │              immutable" /static/*                          │  ║
   ║   │       header /sw.js Cache-Control "no-cache"               │  ║
   ║   │     }                                                      │  ║
   ║   │   }                                                        │  ║
   ║   └────────┬───────────────────────────────────────┬───────────┘  ║
   ║            │ (docker network: walletnet)           │              ║
   ║            ▼                                       ▼              ║
   ║   ┌──────────────────┐                ┌────────────────────────┐  ║
   ║   │ backend (FastAPI)│                │ Static files volume    │  ║
   ║   │ uvicorn :8000    │                │ /srv/web (read-only    │  ║
   ║   │ NOT port-exposed │                │ bind from host or      │  ║
   ║   │                  │                │ named volume populated │  ║
   ║   └────────┬─────────┘                │ by frontend image)     │  ║
   ║            │                          └────────────────────────┘  ║
   ║            ▼                                                      ║
   ║   ┌──────────────────┐                ┌────────────────────────┐  ║
   ║   │ postgres:15-alp. │ ◄── pg_dump ── │ backup-cron sidecar    │  ║
   ║   │ NOT port-exposed │                │ → B2/R2 via rclone      │  ║
   ║   │ vol postgres-data│                └────────────────────────┘  ║
   ║   └──────────────────┘                                            ║
   ╚═══════════════════════════════════════════════════════════════════╝

External ports: 80, 443, 22 (SSH). Everything else internal-only.
```

### Subpath vs Subdomain — decision matrix

| Concern | Same-origin subpath `/api/*` | Subdomain `api.example.com` |
|---|---|---|
| **CORS** | None needed (same origin) | Required; `ALLOWED_ORIGINS` must include `https://wallet.example.com` |
| **PWA scope** | Service worker scope is `/`; both static + API live under it. Clean. | SW only covers static origin; API calls cross-origin (don't matter for SW caching of API anyway, but more nuance) |
| **Cookie auth** (future) | First-party cookies, no `SameSite` gymnastics, no third-party cookie depredecation problems | Cross-site cookies; needs `SameSite=None; Secure`; Cloudflare blocks etc |
| **Caddy config** | One site block, two `handle` directives | Two site blocks, two LE certs |
| **DNS records** | Single `A wallet → IP` | Two records (`wallet`, `api`) |
| **Local dev parity** | Need a proxy or rewrite in Expo dev (or keep `localhost:8000` for dev only) | Dev uses `localhost:8000`, prod uses `api.example.com`; same env-var pattern works |
| **Documentation** | Hides API surface (less obvious where API is) | Discoverable: `api.example.com/docs` |

**Recommendation: subpath `/api/*`.** Reasons:
1. JWT auth today is `Authorization: Bearer` header in `AsyncStorage`, not cookies — but session refresh tokens via cookies are a likely v2.x evolution; same-origin makes that trivial.
2. The frontend already prefixes all calls with `/api/v1` (verified in `main.py` and `client.ts` baseURL pattern). Setting `EXPO_PUBLIC_API_URL=https://wallet.example.com` and keeping the `/api/v1` suffix on each call costs zero refactor.
3. PWA scope=`/` is what Expo's static export expects; one origin = one manifest, no `start_url` cross-origin warnings.
4. Less DNS, less TLS, less moving parts for a single-VPS POC.

**When to revisit:** if a separate marketing site goes on `wallet.example.com` and the app moves to `app.example.com` while API moves to `api.example.com`. Not relevant for v2.0.

---

## 2. Compose Service Layout

`docker-compose.prod.yml` (NEW; the existing `backend/docker-compose.yml` stays for local dev).

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"          # HTTP/3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data       # ACME certs, persisted
      - caddy-config:/config
      - web-static:/srv/web:ro # frontend dist served from here
    depends_on:
      - backend
    networks: [walletnet]

  backend:
    image: ghcr.io/<owner>/wallet-backend:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: .env             # NEVER committed
    expose: ["8000"]           # internal only — NO `ports:` mapping
    depends_on:
      db:        { condition: service_healthy }
      migrate:   { condition: service_completed_successfully }
    networks: [walletnet]
    healthcheck:
      test: ["CMD", "python", "-c",
             "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"]
      interval: 30s
      timeout: 5s
      retries: 3

  migrate:
    image: ghcr.io/<owner>/wallet-backend:${IMAGE_TAG:-latest}
    env_file: .env
    command: ["alembic", "upgrade", "head"]
    depends_on:
      db: { condition: service_healthy }
    restart: "no"              # one-shot
    networks: [walletnet]

  frontend-publish:
    # one-shot: copies pre-built dist from image into a shared volume.
    # Caddy serves directly from web-static; this container exits.
    image: ghcr.io/<owner>/wallet-frontend:${IMAGE_TAG:-latest}
    command: ["sh", "-c", "rm -rf /srv/web/* && cp -r /dist/. /srv/web/"]
    volumes:
      - web-static:/srv/web
    restart: "no"

  db:
    image: postgres:15-alpine
    restart: unless-stopped
    env_file: .env             # POSTGRES_USER/PASSWORD/DB
    expose: ["5432"]           # internal only
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [walletnet]

  backup:
    image: postgres:15-alpine  # reuse for pg_dump binary
    restart: unless-stopped
    env_file: .env             # PG creds + B2/R2 keys
    depends_on:
      db: { condition: service_healthy }
    volumes:
      - backup-staging:/backups
      - ./scripts/backup.sh:/backup.sh:ro
    entrypoint: ["sh", "-c", "while true; do sleep 86400; /backup.sh; done"]
    networks: [walletnet]
    # Alternative: use `mcuadros/ofelia` as a separate scheduler if multiple jobs.

volumes:
  postgres-data:
  caddy-data:
  caddy-config:
  web-static:
  backup-staging:

networks:
  walletnet:
    driver: bridge
```

### depends_on Graph

```
db (healthy)
 ├── migrate (run_once → completes)
 │       └── backend (healthy)
 │               └── caddy
 ├── backup (always running, sleeps + dumps)
 └── (caddy also waits on backend for sane startup ordering)

frontend-publish (independent; one-shot; runs whenever compose up is called)
 → populates web-static volume → caddy serves it
```

### Port Exposure Summary

| Service | Host port | Container port | Why |
|---|---|---|---|
| caddy | 80, 443, 443/udp | 80, 443 | Public ingress |
| backend | — (none) | 8000 (internal `expose:`) | Caddy reverse-proxies; never directly reachable |
| db | — (none) | 5432 (internal `expose:`) | Backend + backup talk to it via docker DNS `db:5432` |
| backup | — | — | Pure cron worker |
| frontend-publish | — | — | One-shot, no listener |

### Volume Mounts

| Volume | Mounted in | Purpose |
|---|---|---|
| `postgres-data` | `db:/var/lib/postgresql/data` | DB persistence |
| `caddy-data` | `caddy:/data` | LE cert+key persistence (CRITICAL — losing this hits LE rate limits) |
| `caddy-config` | `caddy:/config` | Caddy auto-state |
| `web-static` | `caddy:/srv/web:ro` (read), `frontend-publish:/srv/web` (write) | Static export hand-off |
| `backup-staging` | `backup:/backups` | Where pg_dump lands before rclone upload |

---

## 3. Build vs Runtime Artifact Split — Frontend

**Three options evaluated:**

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| **(a) Bake into frontend image** | Dockerfile.frontend runs `npx expo export --platform web` during `docker build`; image contains `/dist`. Compose runs a one-shot publish container that copies `/dist` into `web-static` volume. | Reproducible artifact in registry; CI builds once, deploys anywhere; image hash is the version; rollback = pull old image | Slightly larger image; need a publish step to surface files to Caddy |
| **(b) Build in CI, rsync to VM** | GH Actions runs `npx expo export`, `rsync -az dist/ vm:/srv/web/` over SSH | No Docker image for frontend; smallest moving parts | Two transports (SSH for files, GHCR for backend); state on VM not derivable from `compose pull`; harder to rollback (no immutable artifact); rsync requires shell on VM |
| **(c) Build on VM at deploy** | `git pull && npm ci && npx expo export` on the VM | No CI complexity | VM needs node, npm, build memory; slow deploys; deploy can fail mid-build leaving broken state; defeats the purpose of containers |

**Recommendation: (a).** Reasons:

1. **One deploy verb.** GH Actions runs `docker compose pull && docker compose up -d`. Both backend and frontend roll forward from immutable GHCR tags. No two-protocol deploy, no shell scripts that diverge.
2. **Rollback symmetry.** `IMAGE_TAG=v2.0.3 docker compose up -d` rolls both services; the static files in the volume get overwritten by whichever frontend tag is pulled. Same mental model as backend.
3. **Build host hygiene.** VM stays minimal (Docker only); no node/npm; smaller attack surface.
4. **Consistency with backend.** Both services are GHCR images. Documentation and runbooks have one shape.

**Trade-off acknowledged:** the publish step (`frontend-publish` service) feels weird vs (b). The alternative is to put a tiny nginx/caddy in the frontend image and run *two* reverse-proxy chains — adds a hop and another moving part. The publish-into-shared-volume pattern is clean and standard for SPA-on-Caddy setups.

**Dockerfile.frontend sketch:**

```dockerfile
# Stage 1: build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN npx expo export --platform web
# Result: /app/dist/

# Stage 2: minimal carrier — no server, just a /dist payload
FROM alpine:3 AS dist
COPY --from=build /app/dist /dist
# Container does nothing; consumed by `frontend-publish` compose service.
```

**Note on `web.output`:** `frontend/app.json` does NOT currently set `web.output`. The export will produce a single-page bundle (default) which is what we want for `try_files {path} /index.html`. If we later switch to Expo Router with static rendering we set `"web": { "output": "static" }`.

---

## 4. Frontend → Backend Wiring

### Decision: build-time `EXPO_PUBLIC_API_URL` env var

**Status quo (must change):** `frontend/src/constants/config.ts` line 6 is a hardcoded `__DEV__` ternary. There is **zero existing env-var support in the frontend**. This is the single biggest required code change in the frontend.

**Three options:**

| Option | How | Verdict |
|---|---|---|
| **Build-time env (`EXPO_PUBLIC_API_URL`)** | Expo bakes any `EXPO_PUBLIC_*` var from build environment into bundle (verified via Context7 — `expo_dev` docs, `EXPO_PUBLIC_API_URL=https://staging.example.com` is the canonical example). Set in Dockerfile.frontend `ARG` + `ENV`, passed by GH Actions. | **CHOSEN.** Simplest, idiomatic. |
| **Runtime config endpoint** | App fetches `/config.json` on boot to learn API URL. | Overkill for a single deployment. Adds a blocking request on cold start, complicates SW caching, breaks pure static hosting model. |
| **Relative `/api/v1/...` paths** | Drop the `baseURL` and use relative paths; works because same-origin. | Tempting, but the existing axios client *requires* a `baseURL` and stripping it is a deeper refactor than a single env-var read. Also breaks dev where Expo serves on `:8081` and backend on `:8000`. |

**Final shape of `config.ts`:**

```ts
// Reads at build time (web bundle) or load time (native), with sensible default for dev.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';
```

CI sets `EXPO_PUBLIC_API_URL=https://wallet.example.com/api/v1` for the prod build.

### PWA caching implications

- The API URL is **inside the JS bundle**. Service worker caches the bundle. If the prod URL changes, users on cached SW get the OLD URL until SW refreshes. Mitigation: SW uses `skipWaiting()` + version-based cache busting on bundle hash. Expo's web export already content-hashes JS chunks, so a redeploy yields new filenames → SW evicts old.
- Service worker MUST NOT cache `/api/*` responses (auth-bearing, user-specific). Scope SW cache to static assets only (`/static/*`, `/`, `/index.html`, `/manifest.json`, `/favicon.png`).
- `index.html` should be `Cache-Control: no-cache` to ensure new bundle URLs propagate (Caddy handles this).

---

## 5. Database Connection Pooling & Migration

### Pooling — single backend container

Already configured in `database.py`: `pool_size=5`, `max_overflow=10`, `pool_pre_ping=True`, `pool_recycle=3600`. Total capacity per container: **15 simultaneous DB connections**.

**Sizing check:** Postgres 15-alpine default `max_connections=100`. With 15 from backend + ~3 from backup sidecar (during dump) + 1 admin headroom, we use ~19/100. **No pgbouncer needed for v2.0.** Add it only when:
- Multiple backend replicas (we explicitly have one).
- pool exhaustion under measured load.
- Connection establishment latency becomes a bottleneck (unlikely for a single-user app).

**Action:** Document this decision in the deployment runbook so future scaling work knows the trigger.

### Migration strategy on deploy

**Decision: dedicated one-shot `migrate` service, runs before `backend`.**

Pattern verified above in §2. The compose file declares:
```yaml
migrate:
  image: ghcr.io/.../wallet-backend:${IMAGE_TAG}
  command: ["alembic", "upgrade", "head"]
  restart: "no"
backend:
  depends_on:
    migrate: { condition: service_completed_successfully }
```

**Why one-shot init container vs entrypoint script in backend:**
- **Idempotent.** `alembic upgrade head` is safe to re-run; if no migrations, exits 0 instantly.
- **Single point of failure.** If migration fails, backend never starts; uptime monitor flags it; no half-migrated app serving 500s on broken schema.
- **Same image as backend.** No second Dockerfile; no version drift.
- **Compatible with multi-replica future.** When/if backend scales out, migrate still runs once.

### Schema drift detection

Two complementary checks:

1. **CI guard (pre-deploy):** GH Actions step that spins up a throwaway Postgres, runs `alembic upgrade head`, then `alembic check` (Alembic 1.9+) which fails if the model definitions in `models/` don't match the head revision. Catches devs who edit models without generating a migration.
2. **Deploy-time observation:** the `migrate` container's logs show what was applied. If logs show "no new revisions" on every deploy, schema is in sync. If a deploy shows an unexpected migration, abort.

**Bonus:** add a backend startup self-check that queries `alembic_version` table and logs the current revision; helps debug "is this the right schema?" questions.

---

## 6. Secrets Flow

### Where secrets live

| Secret | Where | How loaded |
|---|---|---|
| `SECRET_KEY` (JWT) | `.env` on VM, `chmod 600`, owned by deploy user | `env_file: .env` in compose → backend reads via Pydantic Settings |
| `DATABASE_URL` | `.env` on VM | Same |
| `POSTGRES_USER/PASSWORD/DB` | `.env` on VM | Same; consumed by both `db` and `backend` services |
| `EXCHANGE_RATE_API_URL` | `.env` (or default; Frankfurter is keyless) | Same |
| `ALLOWED_ORIGINS` | `.env` — set to `https://wallet.example.com` | Same |
| Backup creds (B2/R2 key id + secret) | `.env` (separate keys: `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`) | `env_file: .env` in `backup` service |
| GHCR pull credentials | `~/.docker/config.json` on VM (one-time `docker login ghcr.io`) | Docker daemon |
| SSH deploy key (GH Actions → VM) | GH Actions secret `DEPLOY_SSH_KEY`; matching pubkey in VM's `~/.ssh/authorized_keys` | Used only by CI |

### Deployment of `.env`

**Recommendation: operator places `.env` on VM by hand, once.**

Rationale:
- The `.env` file changes rarely (DB password, JWT secret are set on initial provisioning and rotated quarterly at most).
- GH Actions writing secrets via SSH on every deploy means **every deploy has access to every secret**; broader blast radius if the GH Actions token is ever compromised.
- A one-time scp + chmod 600 keeps the secret blast radius to "whoever has VM SSH access," which is already required for any meaningful operation.
- Document in runbook: rotation procedure = `ssh vm`, edit `.env`, `docker compose up -d` to re-load.

**Counter-pattern (avoid):** putting secrets in GH Actions and templating `.env` on each deploy. Adds churn, conflates app-deploy with secret-rotate.

**`.gitignore` confirmation:** `.env` and `*.env` must be in `.gitignore` — verify on the first commit of v2.0.

### CORS specifically

Backend `ALLOWED_ORIGINS=https://wallet.example.com`. Because we chose subpath, requests are same-origin and CORS doesn't fire — but keeping the header populated is defensive in case anything ever queries from a different origin (e.g., a future native app calling production from `localhost`).

---

## 7. Backup Architecture

### Mechanism

Sidecar `backup` container (defined in §2):
- Reuses `postgres:15-alpine` image (already has `pg_dump` matching the server version — critical to avoid version-skew pg_dump errors).
- Runs `pg_dump -h db -U $POSTGRES_USER $POSTGRES_DB | gzip > /backups/wallet-$(date +%F-%H%M).sql.gz`.
- Then uploads via `rclone` (or `aws s3 cp` / `b2 upload-file`) to remote bucket.
- Retains last 7 local files in `backup-staging`; remote bucket has its own lifecycle policy (e.g., 30 daily, 12 monthly).

### Scheduler choice

Two acceptable patterns:
- **A) Sleep-loop in entrypoint** (shown in compose above). Simplest. One container, no extra image. Drawback: if the VM reboots at 3 a.m. the schedule drifts to "3 a.m. + uptime."
- **B) [`mcuadros/ofelia`](https://github.com/mcuadros/ofelia)** — Docker-native cron scheduler that triggers commands inside other containers on a real cron schedule. Worth adopting if/when we have >1 scheduled job. For v2.0 with one job, (A) suffices.

**Recommendation: A for v2.0, with a note in the runbook to migrate to B when a second scheduled task is needed.**

### Restore drill

The backup is only as good as the restore. **Required, included in v2.0:**
1. Documented procedure in `docs/RESTORE.md`: `docker compose stop backend migrate`, `docker exec -i db psql -U $POSTGRES_USER $POSTGRES_DB < backup.sql`, `docker compose up -d`.
2. **One real restore drill on a throwaway VM** as a Phase exit gate. Without this, "we have backups" is wishful thinking.
3. Optionally automate: monthly GH Actions job that pulls latest backup from B2, restores into a disposable Postgres container, runs `SELECT count(*) FROM users` etc., reports.

### Where backups land before upload

`backup-staging` named volume → `/backups` in the sidecar. Local copy survives even if remote upload fails (which the script logs). Alert if upload fails twice in a row (uptime monitor + log line grep, or just a Healthchecks.io ping URL hit at end of script).

---

## 8. Build Order — Critical Path & Phases

### The hard dependencies

```
[A] backend container (Dockerfile + compose stub for backend+db running together)
        └──► [C] reverse-proxy + Caddyfile (needs a backend to proxy to)
                    └──► [D] DNS + domain + LE cert (needs Caddy listening on :443)
                                └──► [E] CI/CD wiring (GHCR push + SSH deploy)
                                            └──► [G] PWA polish (needs prod URL stable)
                                                        └──► [H] uptime monitor

[B] frontend container/static-export pipeline (needs API URL plumbing — §4)
        └──► [C] (Caddy needs static files volume populated)

[F] backup sidecar (needs db running — depends on [A])
```

### Grouped into 4 build-orderable phases

Annotated with what can parallelize.

**Phase 2.1 — Containerization (foundation)**
*Goal: full stack runs locally via the prod compose file with HTTP only.*
- 2.1a: Activate `backend` service in a new `docker-compose.prod.yml` (uncomment + clean up the existing stub). [serial first]
- 2.1b: Add `migrate` one-shot service. [after 2.1a]
- 2.1c: Add `EXPO_PUBLIC_API_URL` plumbing in `frontend/src/constants/config.ts` + Dockerfile.frontend + `frontend-publish` one-shot. [PARALLEL with 2.1a/b]
- Exit gate: `docker compose -f docker-compose.prod.yml up` on a laptop; backend reachable on a temp port; frontend dist appears in `web-static`; alembic ran.

**Phase 2.2 — Reverse proxy + domain + HTTPS**
*Goal: full stack reachable on a real domain over HTTPS from a phone.*
- 2.2a: Caddyfile with subpath routing (no LE yet — use `localhost` or `tls internal`). [serial]
- 2.2b: Provision VM (Hetzner or Oracle). [PARALLEL with 2.2a]
- 2.2c: DNS A record `wallet.example.com → VM_IP`. [after 2.2b]
- 2.2d: Deploy compose to VM manually (scp compose + Caddyfile + .env, `docker compose up -d`). [after 2.2a, 2.2c]
- 2.2e: Confirm Caddy auto-issued LE cert. [after 2.2d]
- Exit gate: `https://wallet.example.com/` loads the app, `/api/v1/auth/me` returns 401 (correctly), login round-trip works on phone.

**Phase 2.3 — CI/CD + Backups**
*Goal: push to main → live, and DB is recoverable.*
- 2.3a: `.github/workflows/build.yml` builds + pushes both images to GHCR on tag/main. [serial first; needs phase 2.1 images known-good]
- 2.3b: `.github/workflows/deploy.yml` SSHes to VM, `docker compose pull && up -d`. [after 2.3a]
- 2.3c: `backup` sidecar with rclone + B2/R2 bucket configured. [PARALLEL with 2.3a/b]
- 2.3d: Restore drill on throwaway VM. [after 2.3c]
- Exit gate: a commit on main appears on prod within ~5 minutes; one successful drill restore.

**Phase 2.4 — PWA + Observability (polish)**
*Goal: installable on phone, alerted when it dies.*
- 2.4a: `public/manifest.json`, `public/icons/*`, register service worker (vite-plugin-pwa style or hand-rolled `sw.js`). [serial]
- 2.4b: Verify mobile-responsive layouts on real phone. [PARALLEL with 2.4a]
- 2.4c: Healthchecks.io / UptimeRobot pinging `https://wallet.example.com/health` every 5 min. [PARALLEL with 2.4a]
- Exit gate: "Add to Home Screen" on iOS Safari + Android Chrome shows the app icon and launches in standalone mode; uptime monitor alerts on test downtime.

### Why this order

- **2.1 before 2.2:** Caddy can't reverse-proxy to a backend that doesn't exist as a container.
- **2.2 before 2.3:** CI/CD that deploys to a non-existent host is dead code; we want a manual deploy path proven first so we have a fallback when CI breaks.
- **2.3 before 2.4:** PWA install only matters if the URL is stable; deploying via CI ensures cache-busting hashes flow through correctly. Backups before PWA because data loss > install ergonomics.
- **2.4 last:** PWA polish has zero blast radius; pure additive.

---

## 9. New Components vs Modified Existing — Explicit File List

### NEW files

| Path | Purpose |
|---|---|
| `docker-compose.prod.yml` (root) | Production compose, all services |
| `Caddyfile` (root or `infra/`) | Reverse-proxy + static serving rules |
| `frontend/Dockerfile` | Multi-stage Node build → /dist payload |
| `frontend/.dockerignore` | Skip node_modules, .expo, etc. |
| `backend/Dockerfile` | (already exists; verify `requests` in deps OR change healthcheck to `urllib`) |
| `frontend/public/manifest.json` | PWA manifest |
| `frontend/public/sw.js` | Service worker (cache static assets, never `/api/*`) |
| `frontend/public/icons/icon-{192,512}.png` | PWA icons |
| `.github/workflows/build.yml` | Build & push both images to GHCR |
| `.github/workflows/deploy.yml` | SSH to VM, `compose pull && up -d` |
| `infra/scripts/backup.sh` | pg_dump + rclone upload + retention |
| `infra/scripts/restore.sh` | One-command restore from latest dump |
| `infra/.env.example` | Template of required env vars (committed) |
| `docs/DEPLOYMENT.md` | Provision → deploy → restore runbook |
| `docs/RESTORE.md` | Restore procedure (kept separate so it's findable in an emergency) |

### MODIFIED files

| Path | Change |
|---|---|
| `frontend/src/constants/config.ts` | Replace `__DEV__` ternary with `process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'` |
| `frontend/app.json` | Add `web.bundler: "metro"` if not implicit; verify `web` block; add PWA meta if Expo supports it natively in SDK 54, else handcraft via `public/index.html` |
| `frontend/package.json` | Add `build:web` script: `expo export --platform web` |
| `backend/app/core/config.py` | No code change required — but **change default `SECRET_KEY` to a value that crashes/warns if used in prod** (Pydantic validator that raises if `ENVIRONMENT=production` and secret matches default) |
| `backend/Dockerfile` | Healthcheck uses `requests` which may not be a runtime dep; switch to `urllib.request` or `curl` |
| `backend/docker-compose.yml` | Leave as local-dev-only; add a header comment pointing to `docker-compose.prod.yml` |
| `.gitignore` (root) | Ensure `.env`, `*.env`, `frontend/dist/`, `frontend/.expo/` are ignored |
| `README.md` | New "Production Deployment" section |

### UNCHANGED (deliberately)

- `backend/app/main.py` CORS list (keep allow-list pattern; just point env var at prod origin)
- `backend/app/core/database.py` pool config (already production-sized for single backend)
- `backend/app/core/security.py` JWT logic
- All routes, models, schemas
- `frontend/src/api/client.ts` (it consumes `API_BASE_URL`; the constant changes, the client doesn't)

---

## 10. Roadmap Implications

### Suggested 4 phases with parallelization hints

1. **Phase 2.1 — Containerize prod stack** (1 PR; ~1 day). Sub-tasks 2.1a/b serial; 2.1c parallel.
2. **Phase 2.2 — VPS + domain + HTTPS** (1-2 PRs; ~1 day). 2.2a + 2.2b parallel; 2.2c gates 2.2d.
3. **Phase 2.3 — CI/CD + backups** (2 PRs; ~1 day). 2.3a/b serial; 2.3c parallel.
4. **Phase 2.4 — PWA + uptime** (1 PR; ~half-day). All three sub-tasks parallel.

Each phase has a clear exit gate (a thing that works end-to-end), so failure stays localized.

### Risk flags for the roadmap

- **Phase 2.2 risk:** LE cert issuance can fail silently if DNS hasn't propagated or Cloudflare proxy is on. Phase exit gate must include `curl -vI https://wallet.example.com` showing `Server: Caddy` and a real cert.
- **Phase 2.3 risk:** Restore drill is the most-skipped item in deployment work. Make it a hard exit-gate, not a follow-up.
- **Phase 2.4 risk:** Expo SDK 54 PWA story isn't first-class — manifest + sw.js are hand-rolled. Verify against current Expo docs before estimating.

---

## Sources

- `backend/app/main.py`, `backend/app/core/config.py`, `backend/app/core/database.py`, `backend/Dockerfile`, `backend/docker-compose.yml` — verified directly.
- `frontend/src/api/client.ts`, `frontend/src/constants/config.ts`, `frontend/app.json`, `frontend/package.json` — verified directly.
- `.planning/codebase/{ARCHITECTURE,STACK,STRUCTURE}.md` — existing arch documentation.
- Context7 `/websites/expo_dev` — confirmed `EXPO_PUBLIC_*` env var convention, `npx expo export --platform web` produces `dist/`, `web.output: "static"` for static rendering.
- Caddy v2 reverse proxy + ACME behavior: standard, well-documented; same-origin subpath pattern is the textbook PWA-with-API setup.
- Compose v2 `depends_on` with `condition: service_completed_successfully` for one-shot init containers — standard, supported since Compose 2.x.

**Confidence:** HIGH on existing architecture (read source). HIGH on subpath/compose/migrate-as-init-container decisions (industry-standard for this scope). MEDIUM on Expo PWA specifics (SDK 54 web is evolving; verify manifest behavior in Phase 2.4 before assuming nothing-extra-needed).
