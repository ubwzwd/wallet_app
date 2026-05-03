---
milestone: v2.0
milestone_name: Single-VPS Deployment + Mobile-Web Access
created: 2026-05-02
status: defined
---

# Milestone v2.0 Requirements

**Goal:** Get the wallet app running publicly on a single Oracle Cloud Always-Free Ampere VM so it's usable from PC and phone (mobile browser, installable as a PWA), with custom domain and HTTPS.

**Platform (locked):**

- VM: Oracle Cloud Always Free, `VM.Standard.A1.Flex`, **2 OCPU / 12 GB RAM, Ubuntu 24.04, ARM64**
- Container images: **arm64-only** (no multi-arch)
- Postgres tuned to keep memory >20% of RAM (Oracle idle-reclaim mitigation)

## Active Requirements

### Deployment Lifecycle (DEPLOY)

- [ ] **DEPLOY-01**: Production `docker-compose.yml` orchestrates backend + Postgres + Caddy reverse-proxy + frontend static export on a single VM (separate from local dev compose; named volumes for Postgres data and Caddy certs)
- [ ] **DEPLOY-02**: Multi-stage `Dockerfile` for FastAPI backend (uv builder → `python:3.11-slim` runtime, non-root user, `arm64-only` build target)
- [ ] **DEPLOY-03**: Frontend served as static `expo export -p web` output via Caddy `file_server` (no separate web container)
- [ ] **DEPLOY-04**: Alembic migrations run before API container takes traffic (one-shot migrate service or entrypoint guard)
- [ ] **DEPLOY-05**: First-time deploy `RUNBOOK.md` documents provision Oracle A1.Flex → install Docker → clone repo → set `.env` → bootstrap → verify
- [ ] **DEPLOY-06**: Zero-downtime deploys via `docker-rollout` (P2 — no user-visible blip on `docker compose pull && up -d`)

### Domain & TLS (DOMAIN)

- [ ] **DOMAIN-01**: Custom domain registered (Porkbun or similar) and A record points at Oracle VM public IP, `dig`-confirmed before first Caddy start
- [ ] **DOMAIN-02**: Caddy auto-HTTPS via Let's Encrypt (using staging endpoint during initial setup to avoid prod rate limits)
- [ ] **DOMAIN-03**: HSTS header (`max-age=31536000; includeSubDomains`, no preload) configured in Caddy
- [ ] **DOMAIN-04**: API served same-origin (Caddy reverse-proxies `/api/*` to FastAPI) so CORS becomes a non-issue; FastAPI CORS allowlist still narrowed to prod domain as defense-in-depth

### PWA Basics (PWA)

- [ ] **PWA-01**: `public/manifest.json` with required fields (name, short_name, start_url, display=standalone, theme_color, background_color, 192/512 icons including one with `purpose: "maskable"`)
- [ ] **PWA-02**: iOS-specific meta tags + apple-touch-icon (180×180) in `public/index.html` (`apple-mobile-web-app-capable=yes`, status-bar-style, app-title)
- [ ] **PWA-03**: Viewport meta `width=device-width, initial-scale=1, viewport-fit=cover`
- [ ] **PWA-04**: Workbox-generated service worker with cache-first for JS/CSS/fonts/images, **network-first for `/index.html` and `/api/*`** (avoid stale-shell trap), `skipWaiting()` + `clients.claim()` on activation

### Mobile-Responsive Verification (MOBUI)

- [ ] **MOBUI-01**: Touch targets audited to ≥44×44 CSS px across TransactionList row actions, FinanceSourceList row actions, modal close buttons, currency picker rows, tag chips
- [ ] **MOBUI-02**: `safe-area-inset-top/bottom` padding applied to header and bottom navigation/tabs
- [ ] **MOBUI-03**: Global `font-size: 16px` on `input, select, textarea` to prevent iOS zoom-on-focus
- [ ] **MOBUI-04**: `inputmode="decimal"` on transaction amount field; `type="email"` + `autocomplete="email"` on auth forms
- [ ] **MOBUI-05**: PWA installability verified on real iPhone (Safari → Share → Add to Home Screen) and real Android (Chrome install prompt)

### Operations (OPS)

- [ ] **OPS-01**: `/health` endpoint in FastAPI returns 200 OK without touching the database (DB outage must not kill the API container)
- [ ] **OPS-02**: UptimeRobot free-tier monitor pings `/health` every 5 min; email alert on failure
- [ ] **OPS-03**: Daily `pg_dump | gzip` cron container pushes to off-site object storage via rclone (R2 vs B2 vs S3 chosen during Phase 7); 7-daily + 4-weekly retention
- [ ] **OPS-04**: Postgres container tuned with `shared_buffers ≈ 3 GB` (~25% of 12 GB) so memory utilization stays above Oracle's 20% idle-reclaim threshold
- [ ] **OPS-05**: Slack/Discord webhook posted from GH Actions on deploy success/failure (P2)

### CI/CD (CI)

- [ ] **CI-01**: GitHub Actions workflow on push to `main`: build backend + frontend images on `runs-on: ubuntu-24.04-arm`, push to GHCR tagged with both `latest` and git SHA
- [ ] **CI-02**: GitHub Actions deploy step uses `appleboy/ssh-action` with dedicated deploy SSH key to run `docker compose pull && docker rollout <service>` on the VM
- [ ] **CI-03**: Post-deploy healthcheck: `curl --retry 5 --retry-delay 3 https://<domain>/health` from the runner; workflow fails on non-200

### Security (SEC)

- [ ] **SEC-01**: Production `.env` lives only on VM (`chmod 600`, owned by deploy user), gitignored; GH Actions injects values via SSH session env on each deploy; no secrets in image, repo, or compose file
- [ ] **SEC-02**: VM hardening baseline: ufw allows only 22/80/443; SSH key-only (password auth disabled); `unattended-upgrades` enabled for security patches; non-root deploy user with sudo

## Out of Scope (deferred)

Anti-features for v2.0 — explicitly punted to a later "harden production" milestone or to M2/M3/M4/M5/M6:

- Native EAS builds (iOS/Android) — deferred to **M2 Android / M6 iOS**
- Sentry / error-tracking SaaS — deferred to "harden production"
- Loki / Grafana / log aggregation — deferred to "harden production"
- Multi-region / API CDN — deferred (single-VM is fine for POC)
- DB streaming replication / hot standby — deferred (daily pg_dump is enough)
- PITR via WAL archiving — deferred (24h RPO acceptable)
- SOPS / Doppler / Vault — deferred (`.env` chmod 600 is fine for one developer)
- HSTS preload submission — deferred (one-way door, not appropriate for POC)
- Web Push notifications — deferred to whatever milestone introduces notification-worthy events
- Offline-first writes (IndexedDB queue, background sync) — deferred to a dedicated "offline mode" milestone
- Custom Install banner with iOS instructions — deferred to "polish" follow-up
- Maskable + monochrome icons (beyond the one maskable in PWA-01) — deferred polish
- Weekly verified restore drill — deferred (manual restore drill once during Phase 7 is sufficient for v2.0)
- Image vulnerability scanning in CI — deferred to "harden production"
- Multiple environments (staging/prod) — single env for POC
- Preview environments per PR — single-developer workflow
- Kubernetes / k3s — anti-feature; docker compose is correct for this scale

## Future Requirements (deferred to v2.x or later)

- Custom Install banner with iOS instructions — trigger: anyone other than user needs to install
- Weekly automated restore-drill cron — trigger: first time you wonder "are backups actually working?"
- Maskable + monochrome icons polish — trigger: visible white-square halo on Android
- Structured JSON logs + request IDs — trigger: first user-reported bug you can't reproduce
- Sentry / error tracking — trigger: >1 user (you can no longer be the error reporter)
- Switch backup storage class from R2/B2 free tier — trigger: storage exceeds 10 GB free tier

## Traceability

Phase mappings produced by `/gsd-roadmapper` on 2026-05-02. Plan column populated as `/gsd-plan-phase` runs per phase.

| REQ-ID | Phase | Plan |
|--------|-------|------|
| DEPLOY-01 | Phase 4 | TBD |
| DEPLOY-02 | Phase 4 | TBD |
| DEPLOY-03 | Phase 4 | TBD |
| DEPLOY-04 | Phase 4 | TBD |
| DEPLOY-05 | Phase 6 | TBD |
| DEPLOY-06 | Phase 7 | TBD |
| DOMAIN-01 | Phase 6 | TBD |
| DOMAIN-02 | Phase 6 | TBD |
| DOMAIN-03 | Phase 6 | TBD |
| DOMAIN-04 | Phase 4 | TBD |
| PWA-01 | Phase 5 | TBD |
| PWA-02 | Phase 5 | TBD |
| PWA-03 | Phase 5 | TBD |
| PWA-04 | Phase 5 | TBD |
| MOBUI-01 | Phase 5 | TBD |
| MOBUI-02 | Phase 5 | TBD |
| MOBUI-03 | Phase 5 | TBD |
| MOBUI-04 | Phase 5 | TBD |
| MOBUI-05 | Phase 5 | TBD |
| OPS-01 | Phase 6 | TBD |
| OPS-02 | Phase 6 | TBD |
| OPS-03 | Phase 7 | TBD |
| OPS-04 | Phase 4 | TBD |
| OPS-05 | Phase 7 | TBD |
| CI-01 | Phase 7 | TBD |
| CI-02 | Phase 7 | TBD |
| CI-03 | Phase 7 | TBD |
| SEC-01 | Phase 4 | TBD |
| SEC-02 | Phase 6 | TBD |

**Coverage:** 29/29 requirements mapped to phases (no orphans).

---
*v2.0 requirement count: 29 active (27 P1 + 2 P2: DEPLOY-06, OPS-05). Platform locked to Oracle Cloud Always Free Ampere ARM64.*
