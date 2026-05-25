---
milestone: v2.0
milestone_name: Single-VPS Deployment + Mobile-Web Access
created: 2026-05-02
granularity: coarse
status: defined
---

# Roadmap — v2.0 Single-VPS Deployment + Mobile-Web Access

**Goal:** Get the wallet app running publicly on a single Oracle Cloud Always-Free Ampere VM, usable from PC and phone (mobile browser, installable as a PWA), with custom domain and HTTPS.

**Platform (locked):**
- Oracle Cloud Always Free, `VM.Standard.A1.Flex`, 2 OCPU / 12 GB RAM, Ubuntu 24.04, ARM64
- Container builds: **arm64-only** (no multi-arch)
- API served same-origin via Caddy reverse-proxy → no separate web container
- Postgres tuned to keep memory >20% of RAM (Oracle idle-reclaim mitigation)

**Coverage:** 29/29 requirements mapped across 4 phases (numbering continues from v1.0; first new phase is **Phase 4**).

---

## Phases

- [x] **Phase 4: Containerize and Compose Locally** — Production docker-compose stack runs end-to-end on a developer laptop, no cloud cost.
- [x] **Phase 5: PWA-ify Frontend + Mobile Polish** — Web build is installable on iOS/Android home screen and feels native on phone-sized screens. (completed 2026-05-25)
- [ ] **Phase 6: Provision Oracle VM + Domain + Caddy HTTPS** — App reachable at `https://<domain>` with valid Let's Encrypt cert, deployed by hand from a runbook.
- [ ] **Phase 7: CI/CD + Backups + Polish** — `git push` to `main` deploys; daily off-site backups verified by restore drill; zero-downtime rollovers.

---

## Phase Details

### Phase 4: Containerize and Compose Locally
**Goal**: Production-shape stack (Caddy + FastAPI + Postgres) runs end-to-end on the developer laptop, with migrations, secrets handling, and same-origin routing — verifiable before any cloud cost is incurred.
**Depends on**: Nothing (first phase of v2.0)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DOMAIN-04, OPS-04, SEC-01
**Success Criteria** (what must be TRUE):
  1. `docker compose -f docker-compose.prod.yml up` on a clean laptop brings up Caddy, FastAPI (arm64 image), Postgres (tuned, `shared_buffers≈3GB`), and runs Alembic migrations to head **before** the API container accepts traffic.
  2. The Expo web export is served by Caddy via `file_server` at `/`, and `/api/*` is reverse-proxied to FastAPI on the same origin (no separate web container, no CORS preflight in browser DevTools).
  3. Frontend bundle does **not** contain the literal string `localhost:8000` — `EXPO_PUBLIC_API_URL` (or relative `/api/v1` paths) drives the prod build, verified by `grep` against the built JS chunks.
  4. `.env` containing all secrets (SECRET_KEY, DB password, ALLOWED_ORIGINS) is loaded via `env_file:` directive, is `.gitignore`d, and is documented in `infra/.env.example` with placeholder values; FastAPI CORS allowlist is narrowed to the prod domain even though same-origin makes it moot.
  5. Backend Dockerfile is multi-stage (`uv` builder → `python:3.11-slim` runtime), produces a non-root container, and the final image is **arm64-only** (`--platform linux/arm64`).
**Plans**: 6 plans
  - [x] 04-01-backend-dockerfile-PLAN.md — multi-stage arm64 uv Dockerfile + retire backend/Dockerfile (DEPLOY-02, SEC-01)
  - [ ] 04-02-relocate-dev-compose-PLAN.md — move dev compose to infra/, update docs, gitignore infra/.env + frontend/dist (DEPLOY-01)
  - [ ] 04-03-frontend-config-split-PLAN.md — config.dev.ts / config.prod.ts + npm run build:web swap (DEPLOY-03, DOMAIN-04)
  - [ ] 04-04-env-secrets-PLAN.md — infra/.env.example + env-coverage.sh Wave-0 check (SEC-01, DEPLOY-04)
  - [ ] 04-05-prod-compose-and-caddy-PLAN.md — db+migrate+api+caddy with depends_on chain + Caddyfile (DEPLOY-01, DEPLOY-04, DOMAIN-04, OPS-04)
  - [ ] 04-06-smoke-and-verify-PLAN.md — end-to-end smoke.sh covering all 5 ROADMAP success criteria (all reqs)

### Phase 5: PWA-ify Frontend + Mobile Polish
**Goal**: The web build is installable to home screen on iOS Safari and Android Chrome, feels like a native app in standalone mode, and is touch-friendly on real phone screens.
**Depends on**: Nothing (parallelizable with Phase 4 — frontend-only work)
**Requirements**: PWA-01, PWA-02, PWA-03, PWA-04, MOBUI-01, MOBUI-02, MOBUI-03, MOBUI-04, MOBUI-05
**Success Criteria** (what must be TRUE):
  1. Lighthouse PWA audit score ≥90 on the production build: `manifest.json` has name/short_name/start_url=`/`/display=standalone/theme_color/background_color and 192+512 icons (at least one `purpose: "maskable"`); apple-touch-icon (180×180) and `apple-mobile-web-app-capable=yes` meta tags present; viewport meta includes `viewport-fit=cover`.
  2. PWA installs to home screen on a real iPhone via Safari → Share → Add to Home Screen, and launches in standalone mode (no Safari chrome); install prompt fires on a real Android Chrome.
  3. Workbox-generated service worker caches JS/CSS/fonts/images cache-first, but uses **network-first for `/index.html` and `/api/*`** (verified in DevTools: SW v1 → deploy SW v2 → reload once → v2 controls; no stale-shell trap), with `skipWaiting()` + `clients.claim()` on activation.
  4. Touch targets across TransactionList row actions, FinanceSourceList row actions, modal close buttons, currency picker rows, and tag chips measure ≥44×44 CSS px (audited via DevTools); `safe-area-inset-top/bottom` padding applied to header and bottom navigation.
  5. Form inputs use `font-size: 16px` globally (no iOS zoom-on-focus); transaction amount field has `inputmode="decimal"`; auth forms use `type="email"` + `autocomplete="email"`.
**Plans**: 7 plans
  - [x] 05-01-PLAN.md — Wave 0 verification harness: verify-pwa.mjs + verify-touch-targets.mjs + Button.test.ts + workbox-cli/@pwabuilder/manifest-validation install (gated by checkpoint:human-verify) — establishes deterministic verifiers used by every downstream plan (PWA-01..04, MOBUI-01..04)
  - [x] 05-02-PLAN.md — Static PWA assets under frontend/public/: index.html (preserves Expo bootstrap shape), manifest.json, pwa.css, offline.html, 4 hand-authored PNG icons + favicon.ico; bootstrap-injection smoke per RESEARCH A1 (PWA-01, PWA-02, PWA-03, MOBUI-03)
  - [x] 05-03-PLAN.md — Workbox SW pipeline + update flow: workbox-config.cjs, registerSW.ts (Platform.OS web guard), useServiceWorkerUpdate hook, UpdateToast component, atomic build:web extension (PWA-04)
  - [x] 05-04-PLAN.md — Touch-target single-point fix in Button.tsx (44×44 propagates to 14 call-sites) + spot-fixes in FinanceSourceFormScreen, TransactionFormScreen, ProfileScreen (MOBUI-01)
  - [x] 05-05-PLAN.md — Safe-area-inset wiring: Screen.tsx SafeAreaView import swap to react-native-safe-area-context + App.tsx SafeAreaProvider wrap + PWA glue mount (registerSW + UpdateToast) (MOBUI-02)
  - [x] 05-06-PLAN.md — inputMode="decimal" on TransactionFormScreen amount fields + verify Login/Register email props already compliant (MOBUI-03, MOBUI-04)
  - [x] 05-07-PLAN.md — Phase verification gate: npm run verify:phase5 aggregator + manual Incognito-Chrome install smoke + record MOBUI-05 deferral to Phase 6 (per CONTEXT D-13) (all 9)
**UI hint**: yes

### Phase 6: Provision Oracle VM + Domain + Caddy HTTPS
**Goal**: The app is publicly reachable at `https://<domain>` with a valid Let's Encrypt certificate, deployed manually from a documented runbook on a hardened Oracle A1.Flex VM. Real-device PWA installability is verified once the production cert is live.
**Depends on**: Phase 4 (need working compose stack to deploy), Phase 5 (PWA assets shipped in the deployed bundle)
**Requirements**: DEPLOY-05, DOMAIN-01, DOMAIN-02, DOMAIN-03, SEC-02, OPS-01, OPS-02, MOBUI-05
**Domain layer**: Cloudflare Registrar + Cloudflare DNS in **DNS-only (gray-cloud) mode**. No CF proxy / CDN / WAF for v2.0 — this keeps Caddy's LE HTTP-01 challenge working with zero extra plugins. CF proxy + DNS-01 challenge is deferred to "harden production".
**Success Criteria** (what must be TRUE):
  1. `https://<domain>/` loads the wallet app from the Oracle VM with a real (production, not staging) Let's Encrypt certificate; `dig +short <domain>` returns the VM's public IP and was verified before the first Caddy start (DOMAIN-01 → DOMAIN-02 ordering preserved); Caddyfile uses Let's Encrypt **staging endpoint** during initial bring-up and is flipped to production in a separate, deliberate commit to avoid burning the 5-issuance/week prod rate limit.
  2. Operator can re-provision the VM end-to-end in <60 minutes by following `RUNBOOK.md` (provision Oracle A1.Flex → install Docker → clone repo → write `.env` → `docker compose up -d` → verify `/health`).
  3. VM is hardened per SEC-02 baseline: `ufw` allows only 23333/80/443; SSH is key-only (`PasswordAuthentication no`, `PermitRootLogin no`); `unattended-upgrades` enabled for security patches; non-root deploy user with sudo; `nmap` from outside shows only the three allowed ports.
  4. `GET /health` returns 200 OK in <100ms **without** touching the database (verified by stopping Postgres and observing /health still 200) — DB outage cannot kill the API container.
  5. UptimeRobot free-tier monitor is pinging `https://<domain>/health` every 5 min and successfully delivered an email alert during a deliberate downtime test; HSTS header (`max-age=31536000; includeSubDomains`, no preload) is observed in `curl -I` output.
  6. **MOBUI-05** (deferred from Phase 5): PWA installs to home screen on a real iPhone (Safari → Share → Add to Home Screen, launches in standalone mode) AND on a real Android Chrome (install prompt fires); service-worker registration confirmed in DevTools against the production LE cert. Verified after 06-06 (LE staging → prod flip).
**Plans**: 7 plans
  - [x] 06-01-PLAN.md — Caddyfile additions (acme_ca global + HSTS header) + .env.example new CADDY_ACME_CA + narrowed ALLOWED_ORIGINS + caddy service env passthrough in docker-compose.prod.yml (DOMAIN-02, DOMAIN-03, DOMAIN-04)
  - [x] 06-02-PLAN.md — Wave 0 verification scaffold: infra/scripts/verify-phase6.sh (quick + full modes, assertion-only no down -v) + infra/runbook-evidence/.gitkeep + .gitignore *.png rule (cross-cutting verification)
  - [x] 06-03-PLAN.md — ROADMAP.md SC3 trivial text amendment: 22/80/443 -> 23333/80/443 per D-12 (SEC-02)
  - [x] 06-04-PLAN.md — infra/RUNBOOK.md authoring (§0-§16 + Appendices A-D): operator playbook with D-04 + D-05 procedural gates and 9 pitfall callouts (DEPLOY-05)
  - [ ] 06-05-PLAN.md — Operator-driven RUNBOOK §0-§13 execution: provision Oracle VM, register domain, harden SSH/ufw/unattended-upgrades, install Docker, DNS A record + propagation gate, author .env with LE staging URL, first compose up, verify staging cert in incognito, SC4 DB-independence test, SC3 nmap scan (DOMAIN-01, DEPLOY-05, SEC-02, OPS-01)
  - [ ] 06-06-PLAN.md — Operator-driven D-05 Commit B: flip CADDY_ACME_CA= empty + docker compose restart caddy + verify real LE prod cert (not STAGING) + verify HSTS header on responses (DOMAIN-02, DOMAIN-03)
  - [ ] 06-07-PLAN.md — Operator-driven RUNBOOK §14-§16: UptimeRobot signup + /health monitor (D-21) + deliberate downtime drill capturing uptime-alert.png evidence (D-22 / SC5) + **MOBUI-05 real-device install verification on iPhone Safari + Android Chrome against the LE prod cert (SC6)** + final verify-phase6.sh full as SC1-SC6 holistic gate (OPS-02, DEPLOY-05, MOBUI-05)

### Phase 7: CI/CD + Backups + Polish
**Goal**: A push to `main` ships to production automatically; a daily off-site database dump exists; deploys cause no user-visible downtime.
**Depends on**: Phase 6 (need a live VM to deploy to and back up from)
**Requirements**: CI-01, CI-02, CI-03, OPS-03, OPS-05, DEPLOY-06
**Success Criteria** (what must be TRUE):
  1. A commit pushed to `main` triggers GitHub Actions to build arm64 backend + frontend images on `runs-on: ubuntu-24.04-arm`, push to GHCR tagged with both `latest` and the git SHA, SSH into the VM, run `docker rollout` for zero-downtime cutover, and complete the full `git push` → live in <5 minutes (measured wall-clock).
  2. Post-deploy healthcheck (`curl --retry 5 --retry-delay 3 https://<domain>/health` from the runner) gates the workflow: a deliberately broken deploy fails the workflow with a non-200 status and prevents the bad image from being marked stable.
  3. Daily `pg_dump | gzip` cron container pushes the dump to **Cloudflare R2 free tier** via `rclone`; **7-day retention only** (no weekly rollups); pg_dump runs from the matching Postgres image (no version-mismatch silent failures). The first scheduled dump's existence in R2 is verified via `rclone ls` from the VM. **No restore drill / `docs/RESTORE.md`** for v2.0 — deferred to "harden production".
  4. Slack/Discord webhook posts deploy success/failure to a channel from the GH Actions workflow (P2 — OPS-05); `docker rollout` performs zero-downtime swaps verified by hammering `/health` during a deploy and observing zero non-200s (DEPLOY-06).
**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 4. Containerize and Compose Locally | 6/6 | Complete | 2026-05-22 |
| 5. PWA-ify Frontend + Mobile Polish | 7/7 | Complete   | 2026-05-25 |
| 6. Provision Oracle VM + Domain + Caddy HTTPS | 4/7 | In Progress|  |
| 7. CI/CD + Backups + Polish | 0/0 | Not started | - |

---

## Coverage Map

29/29 requirements mapped (no orphans):

| Phase | Requirements | Count |
|-------|--------------|-------|
| 4 | DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DOMAIN-04, OPS-04, SEC-01 | 7 |
| 5 | PWA-01, PWA-02, PWA-03, PWA-04, MOBUI-01, MOBUI-02, MOBUI-03, MOBUI-04 | 8 |
| 6 | DEPLOY-05, DOMAIN-01, DOMAIN-02, DOMAIN-03, SEC-02, OPS-01, OPS-02, MOBUI-05 | 8 |
| 7 | CI-01, CI-02, CI-03, OPS-03, OPS-05, DEPLOY-06 | 6 |

---

## Critical Pitfall Mitigations Baked Into Phase Ordering

- **Caddy auto-HTTPS requires DNS first** — DOMAIN-01 (A record + `dig` confirm) must precede DOMAIN-02 (Caddy bring-up) within Phase 6.
- **Let's Encrypt rate limit (5 prod issuances/domain/week)** — Phase 6 starts with the LE staging endpoint; the swap to production endpoint is a deliberate, separate commit.
- **Service worker stale-shell trap** — Phase 5 success criterion 3 explicitly verifies network-first on `/index.html` and `/api/*`, plus a SW v1→v2 swap test.
- **Migrations before API takes traffic** — Phase 4 success criterion 1 mandates one-shot `migrate` service via `depends_on: condition: service_completed_successfully`; not an entrypoint script in the API container (avoids worker-race per Pitfall 8).
- **Hardcoded `localhost:8000` baked into prod bundle** — Phase 4 success criterion 3 grep-checks the built JS for the literal string; Phase 7 CI step can promote this to a build-failing assertion.
- **Backup destination** — Cloudflare R2 free tier chosen to stay inside the Cloudflare-centric stack (DOMAIN-01 already adds CF as a vendor). 7-day retention; no restore drill for v2.0.
- **MOBUI-05 deferred Phase 5 → Phase 6** — install-prompt + SW registration require the production LE cert that only exists after Phase 6 06-06 cert flip; verified inside 06-07 alongside the UptimeRobot drill.
- **Postgres tuning for Oracle 20% idle-reclaim** — folded into Phase 4 (OPS-04) as part of the production compose, not a separate phase.

---

*Last updated: 2026-05-26 — Phase 4 + 5 shipped; Phase 6 in execution (4 of 7 plans done). MOBUI-05 remapped Phase 5 → Phase 6 (06-07). Phase 7 OPS-03 downgraded to R2 free tier + 7-day retention + no restore drill. Cloudflare Registrar + DNS-only (gray cloud) added to DOMAIN-01 in Phase 6.*
