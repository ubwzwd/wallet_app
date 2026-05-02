# Stack Research — v2.0 Single-VPS Deployment + Mobile-Web Access

**Domain:** Self-hosted single-VM Docker deployment for an existing FastAPI + Expo Web monorepo
**Researched:** 2026-05-02
**Confidence:** HIGH (verified against current vendor docs, GitHub releases, and 2026 community sources)

> **Scope discipline:** Existing stack (FastAPI 0.104+ / Python 3.11 / SQLAlchemy 2 / Postgres 15 / Expo SDK 54 / TypeScript 5.9 / NativeWind / TanStack Query / Zod / JWT / bcrypt) is fixed and NOT re-researched. This document only covers tools/libraries that the v2.0 deployment milestone introduces.

---

## CRITICAL FINDING — Hetzner Singapore Has NO ARM

**Source-of-truth correction needed before roadmap is written.**

`PROJECT.md` currently lists *"Hetzner Singapore ARM CPX11/CAX11"*. This is impossible:

- **CPX11** is the AMD-based shared-vCPU plan and **IS** available in Singapore (€4.99/mo, 2 vCPU, 2 GB RAM, 40 GB SSD). It is x86_64, not ARM.
- **CAX11** is the Ampere ARM plan and is **available only in Falkenstein, Nuremberg, and Helsinki** — never in Singapore as of May 2026. The Singapore region launched in 2024 with AMD-only.

**Implication for the milestone:**

1. If user wants Singapore latency → **Hetzner CPX11 (AMD/x86_64) in Singapore** OR **Oracle Cloud Always Free Ampere (ARM64) in Singapore**.
2. If user wants Hetzner's ARM pricing (CAX11 ~€4/mo) → must accept EU latency (Helsinki/Nuremberg).
3. Multi-arch container builds (`linux/amd64,linux/arm64`) are still recommended so the user can move between Hetzner-AMD-SG and Oracle-ARM-SG without rebuilding.

**Action:** Update `PROJECT.md` to read "Hetzner Singapore CPX11 (AMD) or Oracle Cloud Singapore Ampere ARM (Always Free)".

Sources:
- [Hetzner CPX11 spec — Spare Cores (Singapore listed)](https://sparecores.com/server/hcloud/cpx11)
- [Hetzner Singapore launch press release](https://www.hetzner.com/news/new-location-singapore/)
- [Hetzner Cloud Review 2026 — confirms CAX EU-only](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/)

---

## Recommended Stack

### Core Technologies (NEW for v2.0)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Caddy** | `2.10.2` (image `caddy:2.10.2-alpine`) | Reverse proxy + auto-HTTPS via Let's Encrypt | Two-line Caddyfile vs. multi-file Nginx + acme.sh dance vs. label-driven Traefik. ~30 MB RAM. Single-VM, single-domain → Caddy wins on simplicity. No ACME boilerplate. Multi-arch official image (amd64/arm64/armv7). |
| **Docker Compose** | v2 (`docker compose` plugin, file format `3.9` or unversioned) | Single-host orchestration of 4 services (caddy, frontend, backend, postgres, backup) | Already used for local dev → zero new-tool tax. SPOF acceptable per milestone goal. |
| **PostgreSQL** | `postgres:16-alpine` (multi-arch) | Database — **upgrade from existing 15 → 16** | PG16 is the current primary supported branch (PG18 GA, but 16 is the most-deployed). Alpine variant is multi-arch (amd64/arm64), supports ICU locales since PG15. **OR** keep `postgres:15-alpine` if zero migration risk preferred — both are supported. See "Postgres version decision" below. |
| **prodrigestivill/postgres-backup-local** | `:16` (matches PG version) | Daily `pg_dump` sidecar with rotation (KEEP_DAYS / KEEP_WEEKS / KEEP_MONTHS) | Battle-tested, multi-arch, environment-variable config, healthcheck port. Avoids hand-rolling cron. |
| **rclone** | `rclone/rclone:1.69` (latest stable) | Push backup directory to Backblaze B2 / Cloudflare R2 / S3 | Single binary, S3-compatible to all three providers. Simpler than restic for this use case (we already have point-in-time `pg_dump` files; we just need offsite copies, not dedup). |
| **Workbox CLI** | `workbox-cli@7.x` | Generate `sw.js` for the Expo web build | Officially endorsed by the Expo PWA docs. Expo provides no built-in SW generator in SDK 54. Run as a post-step after `npx expo export -p web`. |

### Supporting Libraries (NEW)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **structlog** | `25.x` | Structured JSON logging in FastAPI | Add when wiring `/health` and request-logging middleware. Faster JSON serialization than loguru (~25%) and safe-by-default (no traceback variable leaks). |
| **httpx** | already a transitive dep | Optional: hit Frankfurter from `/health` to verify upstream | Only if you want a "deep" health check; default to a "shallow" check (DB ping only). |

> **Loguru intentionally NOT chosen.** It is delightful for scripts but `diagnose=True` (default) leaks variable values into tracebacks — production foot-gun. structlog is 2026 consensus for FastAPI.

### Development / Build Tools (NEW)

| Tool | Purpose | Notes |
|------|---------|-------|
| **GitHub Actions** | CI: build → push GHCR → SSH-deploy | Free for public repos; 2,000 free minutes/mo for private. `ubuntu-24.04-arm` runner is now GA — use it to avoid 3–10× QEMU emulation slowdown when building ARM64 images. |
| **`docker/setup-buildx-action@v3`** | Buildx initialization | Pinned major version; renovate-friendly. |
| **`docker/setup-qemu-action@v3`** | Multi-arch emulation (only if NOT using arm runner) | Skip if using `runs-on: ubuntu-24.04-arm` for ARM build job. |
| **`docker/login-action@v3`** | GHCR auth | Use `${{ secrets.GITHUB_TOKEN }}` + `permissions: { packages: write }` — no PAT needed for same-repo pushes. |
| **`docker/build-push-action@v6`** | Multi-arch build + push | v6 is current stable; v7 exists but v6 is the broadly-deployed version in the docker org's own examples. `platforms: linux/amd64,linux/arm64`. |
| **`docker/metadata-action@v5`** | Auto-tag images (sha, branch, semver) | Generates `ghcr.io/owner/wallet-api:main`, `:sha-abc123`. |
| **`appleboy/ssh-action@v1.x`** | SSH into VPS, `docker compose pull && up -d` | Most-used SSH action (1M+ uses). Alternative: raw `ssh -i $KEY user@host "..."` in a `run:` step — slightly less magic, equally simple. Use whichever the user prefers. |

### Runtime Container Images (NEW)

| Image | Base | Pattern | Notes |
|-------|------|---------|-------|
| **Backend (`wallet-api`)** | `python:3.11-slim-bookworm` (matches existing pinned Python 3.11) | Multi-stage: builder copies `ghcr.io/astral-sh/uv:0.5` → `uv sync --frozen` → runtime stage copies `.venv` only | uv is 10-40× faster than pip for installs. Final image ~120 MB. **Do NOT switch to Python 3.12 in this milestone** — that's a separate concern. **Do NOT use distroless** — it complicates `docker exec` debugging on a single-VM POC. |
| **Frontend (`wallet-web`)** | Build stage: `node:20-alpine` runs `npx expo export -p web` + `workbox generateSW`. Runtime: `caddy:2.10.2-alpine` with a tiny Caddyfile that serves `/srv` + SPA fallback | Single static-server image. **Do NOT add a separate `nginx:alpine` container** — the front-edge Caddy can serve the static dist directly via `file_server` + `try_files {path} /index.html`. One less container, one less moving part. |

> **Two viable architectures for the web tier:**
>
> **Option A (recommended for SPOF-OK POC):** Front-edge Caddy *also* serves the Expo `dist/` directly. No separate frontend container. Caddyfile has two routes: `/api/*` → `wallet-api:8000`, everything else → `file_server`.
>
> **Option B:** Separate `wallet-web` container running its own Caddy on `:80`, front-edge Caddy proxies `/` → `wallet-web:80` and `/api/*` → `wallet-api:8000`. Cleaner separation; useful if frontend ever needs scaling. Costs one more container.
>
> Pick A for v2.0. Document B as the upgrade path.

### Domain / DNS / Edge

| Component | Pick | Notes |
|-----------|------|-------|
| **Registrar** | **Porkbun** (preferred) — register at near-wholesale, no nameserver lock-in | Cloudflare Registrar is also fine if user already has a CF account, but it forces you to keep CF nameservers — a constraint we don't need. Porkbun TLD selection is broader. |
| **DNS hosting** | **Cloudflare DNS** (free) regardless of registrar | Anycast, fast Singapore POPs, free DNSSEC. Works fine with Porkbun-registered domain by changing nameservers. |
| **Cloudflare proxy mode** | **DNS-only ("grey cloud") for v2.0** | Caddy already gets a real Let's Encrypt cert; CF proxy adds: WAF, DDoS, hide origin IP, free CDN — at the cost of one more layer that can break, certificate-pinning quirks, and harder debugging. Defer proxy-on to a later milestone once the POC is healthy. If origin IP exposure is a worry, flip the cloud orange anytime — Caddy keeps working unchanged. |

### Uptime + Observability (Minimum Viable)

| Tool | Why this minimum | Notes |
|------|------------------|------|
| **UptimeRobot Free** | 50 monitors / 5-min interval — overkill for one site, $0 forever | Better Stack free tier offers 30-second checks but caps at ~10 monitors and pushes paid upgrades. UptimeRobot is the path of least resistance. |
| **FastAPI `/health` endpoint** (in-app) | Sync + DB ping pattern (see snippet below) | Two endpoints recommended: `/health/live` (process up, no deps) and `/health/ready` (DB SELECT 1 with 2-3s timeout). UptimeRobot polls `/health/live`. |
| **structlog → stdout JSON** | `docker compose logs` is sufficient for a POC | Defer Loki/Sentry. JSON-structured stdout means a future Loki/Vector/Sentry adapter is a config change, not a refactor. |

---

## Installation / Pinned Image Tags

```yaml
# docker-compose.yml — image tags only (config omitted)
services:
  caddy:
    image: caddy:2.10.2-alpine

  api:
    image: ghcr.io/<owner>/wallet-api:${TAG:-latest}   # built in CI

  web:
    image: ghcr.io/<owner>/wallet-web:${TAG:-latest}   # built in CI (or omit if Option A)

  db:
    image: postgres:16-alpine    # or postgres:15-alpine if no-upgrade preferred

  backup:
    image: prodrigestivill/postgres-backup-local:16    # match db version
```

```dockerfile
# backend/Dockerfile — multi-stage with uv
FROM ghcr.io/astral-sh/uv:0.5-python3.11-bookworm-slim AS builder
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY . .
RUN uv sync --frozen --no-dev

FROM python:3.11-slim-bookworm
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```Caddyfile
# caddy/Caddyfile — Option A (front-edge serves SPA + proxies /api)
wallet.example.com {
    encode zstd gzip

    # API
    handle_path /api/* {
        reverse_proxy api:8000
    }

    # PWA SPA
    root * /srv
    try_files {path} /index.html
    file_server

    # Service worker must not be cached
    @sw path /sw.js
    header @sw Cache-Control "no-cache"
}
```

```yaml
# Postgres healthcheck (compose snippet)
db:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: wallet
    POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    POSTGRES_DB: wallet
  volumes:
    - pgdata:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U wallet -d wallet"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
```

```python
# backend/app/health.py — minimal pattern
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio

router = APIRouter(prefix="/health", tags=["health"])

@router.get("/live")
async def live() -> dict:
    return {"status": "ok"}

@router.get("/ready")
async def ready(db: AsyncSession = Depends(get_db)) -> dict:
    try:
        await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=2.0)
    except (asyncio.TimeoutError, Exception) as e:
        raise HTTPException(status_code=503, detail=f"db_unreachable: {type(e).__name__}")
    return {"status": "ok", "db": "ok"}
```

```yaml
# Backup sidecar
backup:
  image: prodrigestivill/postgres-backup-local:16
  environment:
    POSTGRES_HOST: db
    POSTGRES_DB: wallet
    POSTGRES_USER: wallet
    POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    SCHEDULE: "@daily"
    BACKUP_KEEP_DAYS: 7
    BACKUP_KEEP_WEEKS: 4
    BACKUP_KEEP_MONTHS: 6
    HEALTHCHECK_PORT: 8080
  volumes:
    - ./backups:/backups
  depends_on:
    db: { condition: service_healthy }

# Separate cron container or systemd timer on host pushes /backups → B2 via rclone
# rclone config stored in ./rclone.conf (NOT in git)
```

---

## Postgres version decision (15 vs 16)

| Factor | postgres:15-alpine | postgres:16-alpine |
|--------|---------------------|---------------------|
| Currently in PROJECT.md / dev | ✓ | — |
| Active community support | ✓ (until Nov 2027) | ✓ (until Nov 2028) |
| ARM64 image | ✓ | ✓ |
| Migration risk for v2.0 | None | Low (PG15→16 is in-place, but adds a step) |
| Recommendation | **Stay on 15 for v2.0** | Defer 15→16 to a future milestone with its own UAT |

**Verdict:** Keep `postgres:15-alpine`. v2.0's job is "make it run publicly", not "modernize the data layer."

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Caddy** | **Traefik v3** | If/when you split into multiple compose stacks and want auto-discovery via Docker labels. For a single domain on one VM, Traefik is overkill (~80 MB RAM, more YAML). |
| **Caddy** | **Nginx + acme.sh** | If you have deep Nginx muscle memory and need fine-grained tuning. Costs you the auto-HTTPS magic. |
| **Caddy** | **Nginx Proxy Manager** | Only if a non-developer operator needs a GUI. Adds a database (SQLite) and management UI you have to keep secured. |
| **uv-based image** | Plain `python:3.11-slim` + `pip install -r requirements.txt` | If you don't already use uv in dev. uv is faster but introduces a tool. (User already uses Python 3.11 — no info on whether uv is current; if not, plain pip is acceptable.) |
| **prodrigestivill backup container** | Hand-rolled cron in compose / on host | If you want exactly one less container. Hand-rolled is fine but you re-implement rotation. Not worth it. |
| **rclone to B2/R2** | restic / duplicity (encrypted, deduped offsite) | Once data exceeds ~1 GB and you want incremental dedup. For a personal wallet app at <100 MB, plain `pg_dump` + rclone is simpler and equally restorable. |
| **GitHub Actions** | Drone / Woodpecker / self-hosted Gitea Actions | If you want zero vendor dependency. Overkill for v2.0. |
| **appleboy/ssh-action** | Raw `ssh user@host "docker compose pull && docker compose up -d"` in a step | Both are fine. Raw is one fewer marketplace dependency to audit. |
| **UptimeRobot** | Better Stack, Healthchecks.io, Bubobot | If you want 30-second intervals (BS) or "dead-man's-switch" cron monitoring (Healthchecks). UptimeRobot is the broadest free tier. |
| **Hetzner CPX11 SG (AMD)** | **Oracle Cloud Always Free Ampere (ARM, SG)** | If €0/mo matters more than provisioning ease. Oracle's free tier reclaims idle ARM instances and capacity is tight in popular regions. |
| **Porkbun (registrar)** | Cloudflare Registrar | If you're already all-in on Cloudflare DNS+proxy. CF Registrar locks NS to Cloudflare. |
| **structlog** | stdlib `logging` + `python-json-logger` | If you want zero new deps. Works but lacks structlog's `bind()` context propagation. |
| **structlog** | **loguru** | Never for production with `diagnose=True`. If you must, set `diagnose=False`. |

---

## What NOT to Use (and Why)

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Kubernetes / k3s / Helm** | Single-VM POC; orchestration overhead dwarfs the workload | Docker Compose |
| **Docker Swarm** | Effectively dead upstream; all the Compose syntax you'd need is already in Compose v2 | Docker Compose |
| **Service mesh (Istio, Linkerd)** | Two services on one box | Plain Docker network |
| **Sentry / Loki / Grafana / Prometheus** | Observability tax — install when you have customers complaining, not before | structlog → stdout, UptimeRobot for liveness |
| **Separate staging/prod environments** | One environment per milestone scope | Single env; treat the VPS as prod-ish from day one |
| **EAS / Expo Application Services native builds** | Out of milestone scope (deferred to M2 Android / M6 iOS) | PWA only via `expo export -p web` + Workbox |
| **Distroless Python image** | Loses `bash`/`sh` for `docker exec` — bad for a POC where you'll be SSHing in to debug | `python:3.11-slim-bookworm` |
| **`:latest` tag in compose** | Non-deterministic deploys; broke many hobby setups in the wild | Pin to specific version (`caddy:2.10.2-alpine`) or use the CI-generated `:sha-XXXXXXX` tag |
| **loguru with default `diagnose=True` in production** | Leaks variable values into exception tracebacks | structlog, OR loguru with `diagnose=False` |
| **NPM-installed `serve` for the static frontend** | Node runtime for static files = ~150 MB image, ~50 MB RAM idle | Caddy `file_server` (~30 MB) |
| **Cloudflare proxy ON for v2.0** | Adds debugging surface area when you're trying to ship | Grey-cloud (DNS-only); flip to orange later if origin IP exposure becomes a concern |
| **Hetzner CAX11 in Singapore** | Doesn't exist (CAX is EU-only) | CPX11 (AMD, SG) or Oracle Ampere (ARM, SG) |
| **Postgres-in-compose for "real" production** | Fine for a POC, but not for paying users | Acceptable for v2.0; revisit at first paid customer |
| **Hand-rolled service worker** | Easy to ship a SW that traps users on a stale build | Workbox CLI's `generateSW` with sane defaults |

---

## Stack Patterns by Variant

**If user picks Hetzner CPX11 (AMD, Singapore):**
- CI builds `linux/amd64` only is sufficient → faster pipeline, no QEMU
- But still build multi-arch so Oracle ARM is a one-line redeploy

**If user picks Oracle Cloud Ampere (ARM, Singapore):**
- CI **must** build `linux/arm64` — use `runs-on: ubuntu-24.04-arm` for the build job to avoid QEMU 3-10× slowdown
- Some pip wheels still lack ARM64 builds — verify on first build, not at deploy time

**If user later wants Cloudflare proxy in front:**
- Caddy config doesn't change (LE cert keeps renewing via HTTP-01)
- Optionally tighten `trusted_proxies` to Cloudflare CIDR list so client IPs are correct in logs
- Optionally switch to Cloudflare Origin Certificate (15-year cert) and Authenticated Origin Pulls

**If user adds a second app to the same VM later:**
- Caddy site blocks scale linearly (one block per domain, all auto-HTTPS)
- Consider `lucaslorentz/caddy-docker-proxy` for label-driven config at that point

---

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| `caddy:2.10.2-alpine` | Linux kernel 3.10+ | Multi-arch (amd64, arm64, armv6, armv7, ppc64le, s390x) |
| `postgres:15-alpine` | PG client 13+; libpq 13+ | Existing FastAPI/SQLAlchemy already on PG15 — zero migration |
| `python:3.11-slim-bookworm` | Existing FastAPI 0.104+ requires Python ≥3.8 | Stay on 3.11 — don't bundle a 3.11→3.12 upgrade with this milestone |
| `prodrigestivill/postgres-backup-local:15` | Must match the major version of Postgres being dumped | If you upgrade DB to 16, bump backup image tag to `:16` |
| `node:20-alpine` (build stage) | Expo SDK 54 / RN 0.81 | Node 20 LTS is current LTS; Node 22 also works |
| `docker/build-push-action@v6` | Buildx ≥0.10 | v7 exists; v6 is current widely-deployed stable |
| `appleboy/ssh-action@v1.2.x` | OpenSSH ≥7.0 on target | Use `key: ${{ secrets.SSH_PRIVATE_KEY }}` (ed25519) |
| Workbox CLI 7 | Any static SPA build | `generateSW` mode is the simplest; `injectManifest` if you need custom SW logic |

---

## Integration Points with Existing Codebase

| Existing | Change | Effort |
|----------|--------|--------|
| `app/main.py` (FastAPI) | Add `/health/live` and `/health/ready` routers; mount structlog JSON formatter | Small (~50 LOC) |
| `pyproject.toml` / requirements | Add `structlog`. Optionally add `uv` to dev deps. | Trivial |
| `frontend/app.json` (Expo) | Confirm `web.bundler: "metro"`, ensure `web.favicon` and a `public/manifest.json` exist | Small |
| `frontend/public/index.html` (after `npx expo customize public/index.html`) | Add `<link rel="manifest" href="/manifest.json">` and SW registration script | Small |
| `frontend/package.json` | Add `"build:web": "expo export -p web && workbox generateSW workbox-config.js"`; add `workbox-cli` devDep | Small |
| `docker-compose.yml` (currently dev-only Postgres) | Add: `caddy`, `api`, `web` (optional, see Option A vs B), `backup` services. Externalize secrets to `.env` (not committed) | Medium |
| `alembic/` migrations | Add an init-on-first-run pattern: an entrypoint script in the API image that runs `alembic upgrade head` before `uvicorn` starts. Use `depends_on: db: { condition: service_healthy }` to gate startup. | Small |
| Frontend API base URL | Change from `http://localhost:8000` to `/api` (relative) so Caddy's path-based routing works | Trivial |
| CORS in FastAPI | If using Option A (same origin), CORS can be removed or tightened to the production domain only | Trivial |
| `.gitignore` | Add `.env`, `caddy_data/`, `caddy_config/`, `pgdata/`, `backups/`, `rclone.conf` | Trivial |

---

## Sources

**Reverse proxy comparison (Caddy vs Traefik vs Nginx):**
- [Reverse Proxy Comparison: Traefik vs. Caddy vs. Nginx (Docker) — programonaut](https://www.programonaut.com/reverse-proxies-compared-traefik-vs-caddy-vs-nginx-docker/) — MEDIUM
- [Traefik vs Caddy vs Nginx (2026) — OSSAlt](https://ossalt.com/guides/traefik-vs-caddy-vs-nginx-reverse-proxy-self-hosting-2026) — MEDIUM
- [Caddy vs Traefik vs Nginx Proxy Manager 2026 — PkgPulse](https://www.pkgpulse.com/guides/caddy-vs-traefik-vs-nginx-proxy-manager-reverse-proxies-2026) — MEDIUM
- [Caddy with Cloudflare SSL settings — samjmck](https://samjmck.com/en/blog/using-caddy-with-cloudflare/) — MEDIUM
- [Caddy Automatic HTTPS docs (official)](https://caddyserver.com/docs/automatic-https) — HIGH

**Caddy version & Docker tags:**
- [Caddy Docker Hub tags (official)](https://hub.docker.com/_/caddy/tags) — HIGH (verified 2.10.x current)
- [caddyserver/caddy GitHub releases](https://github.com/caddyserver/caddy/releases) — HIGH
- [caddy-docker-proxy bumped to 2.10.2 (release notes)](https://github.com/lucaslorentz/caddy-docker-proxy/releases) — HIGH

**FastAPI image / uv:**
- [Astral uv-docker-example (official)](https://github.com/astral-sh/uv-docker-example) — HIGH
- [Using uv with FastAPI — Astral docs (official)](https://docs.astral.sh/uv/guides/integration/fastapi/) — HIGH
- [FastAPI in Containers (official docs)](https://fastapi.tiangolo.com/deployment/docker/) — HIGH
- [FastAPI 0.136.1 release (April 2026) — PyPI](https://pypi.org/project/fastapi/) — HIGH

**Expo PWA / SDK 54:**
- [Expo Progressive Web Apps guide (official)](https://docs.expo.dev/guides/progressive-web-apps/) — HIGH (verified manual workflow, Workbox-based, no built-in SW gen)
- [Expo SDK 54 changelog (official)](https://expo.dev/changelog/sdk-54) — HIGH
- [Expo Publish websites guide (official)](https://docs.expo.dev/guides/publishing-websites/) — HIGH
- [How to add support for PWA — expo/router discussion #408](https://github.com/expo/router/discussions/408) — MEDIUM

**Postgres in compose:**
- [Postgres official Docker image](https://hub.docker.com/_/postgres) — HIGH
- [Docker Compose for Postgres with healthcheck (gist)](https://gist.github.com/aliesm-com/0168779c9d645bc13ec8e9352122fd90) — MEDIUM

**Backups:**
- [prodrigestivill/postgres-backup-local (GitHub)](https://github.com/prodrigestivill/docker-postgres-backup-local) — HIGH
- [rclone Backblaze B2 backend (official)](https://rclone.org/b2/) — HIGH
- [MySQL backups to Cloudflare R2 with rclone — Ashley Rich (pattern transfers to PG)](https://ashleyrich.com/blog/mysql-backups-cloudflare-r2) — MEDIUM

**CI/CD:**
- [Multi-platform image with GitHub Actions (official Docker docs)](https://docs.docker.com/build/ci/github-actions/multi-platform/) — HIGH
- [Building Multi-Platform Docker Images for ARM64 — Blacksmith](https://www.blacksmith.sh/blog/building-multi-platform-docker-images-for-arm64-in-github-actions) — MEDIUM
- [Publishing Multi-Arch Docker images to GHCR — Pradumna Saraf (DEV)](https://dev.to/pradumnasaraf/publishing-multi-arch-docker-images-to-ghcr-using-buildx-and-github-actions-2k7j) — MEDIUM
- [docker/build-push-action GitHub repo](https://github.com/docker/build-push-action) — HIGH

**Logging / health:**
- [Structured logging using structlog and FastAPI — Angelos Panagiotopoulos](https://www.angelospanag.me/blog/structured-logging-using-structlog-and-fastapi) — MEDIUM
- [How to Add Structured Logging to FastAPI — OneUptime](https://oneuptime.com/blog/post/2026-02-02-fastapi-structured-logging/view) — MEDIUM
- [Choosing a Python Logging Library in 2026 — Dash0](https://www.dash0.com/guides/python-logging-libraries) — MEDIUM
- [Is Loguru Good for Production Python Services? — BSWEN](https://docs.bswen.com/blog/2026-04-29-loguru-production-python/) — MEDIUM
- [Health Checks — FastAPI Production Guide — Patryk Golabek](https://patrykgolabek.dev/guides/fastapi-production/health-checks/) — MEDIUM

**Uptime monitoring:**
- [Better Stack vs UptimeRobot — apistatuscheck](https://apistatuscheck.com/blog/better-stack-vs-uptimerobot) — MEDIUM
- [UptimeRobot vs Better Stack — StackShare](https://stackshare.io/stackups/better-stack-vs-uptimerobot) — MEDIUM

**Domain / DNS:**
- [Porkbun vs Cloudflare 2026 — hostingseekers](https://www.hostingseekers.com/blog/porkbun-vs-cloudflare-which-domain-registrar-is-better/) — MEDIUM
- [Porkbun vs Cloudflare official Porkbun comparison](https://porkbun.com/about/porkbun-vs-cloudflare) — LOW (vendor)
- [Cloudflare Proxy status docs (official)](https://developers.cloudflare.com/dns/proxy-status/) — HIGH

**VPS:**
- [Hetzner Cloud Singapore launch (official press)](https://www.hetzner.com/news/new-location-singapore/) — HIGH (confirms AMD-only at launch)
- [Hetzner CPX11 — Spare Cores](https://sparecores.com/server/hcloud/cpx11) — HIGH (Singapore listed as available region)
- [Hetzner Cloud Review 2026 — Better Stack](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/) — MEDIUM (confirms CAX EU-only)
- [Hetzner vs Oracle ARM VPS Performance — Bitdoze](https://www.bitdoze.com/hetzner-oracle-arm-performance/) — MEDIUM

---

## Confidence Summary

| Area | Confidence | Notes |
|------|------------|-------|
| Reverse proxy choice (Caddy) | HIGH | Multiple 2026 sources converge; Caddy is the documented simple-VPS default |
| Caddy version (2.10.2) | HIGH | Verified Docker Hub tags + caddy-docker-proxy release notes |
| FastAPI container pattern | HIGH | Official Astral docs + FastAPI official deployment docs |
| Expo PWA workflow (manual + Workbox) | HIGH | Verified directly against Expo official PWA docs |
| Postgres image / healthcheck | HIGH | Official image docs + standard pattern |
| Backup tooling (prodrigestivill + rclone) | HIGH | Tool is mature and well-documented |
| CI/CD actions versions | HIGH | Verified against docker org's own examples |
| structlog over loguru | MEDIUM-HIGH | 2026 community consensus; loguru's `diagnose=True` foot-gun is documented |
| UptimeRobot free tier specs | HIGH | Confirmed via multiple comparison sources |
| Hetzner Singapore is AMD-only | HIGH | Confirmed in Hetzner's own press release |
| Porkbun + Cloudflare-DNS hybrid | MEDIUM | Common community pattern; vendor-neutral |

---

*Stack research for: v2.0 single-VPS deployment + PWA-flavored mobile-web access*
*Researched: 2026-05-02*
