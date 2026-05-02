# Feature Research

**Domain:** Single-VPS Production Deployment + Mobile-Web (PWA) Access for a FastAPI + Expo Web SPA
**Researched:** 2026-05-02
**Confidence:** HIGH (most claims verified against official docs / multiple recent sources)

## Scope Note

This research applies to **v2.0 Single-VPS Deployment + Mobile-Web Access**. Existing capabilities (JWT auth, finance source CRUD, multi-currency txns, Frankfurter integration, profile management) are treated as inputs/dependencies, not subjects of research. The question is: what does it take to make this stack publicly reachable on a custom domain, installable on phones, with sane operational hygiene — without crossing into "harden production" territory.

## Feature Landscape

### Table Stakes (Users / Operators Expect These)

If any of these is missing, the deploy isn't "real" — it's either broken, unsafe, or a maintenance trap.

#### A. Deployment lifecycle

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|----------------------|
| **Single `docker-compose.yml` orchestrating backend + db + reverse proxy + web** | Single command (`docker compose up -d`) reproduces the entire stack on a fresh VM. Without this, "deploy" is undocumented tribal knowledge. | LOW | Need separate prod compose file (`compose.prod.yml`) so dev compose stays local-only. Postgres data lives in a named volume, not bind-mount, to survive `docker compose down`. |
| **Image build pipeline → registry (GHCR)** | VM should pull versioned images, not build from source. Build-on-VM steals CPU/RAM during deploy and slows the MTTR on a hot fix. | LOW-MED | Use `secrets.GITHUB_TOKEN` (built-in, scoped) to push to GHCR — no PAT rotation. Tag with both `latest` and `git-sha` so rollback is `docker compose up -d --pull` with a different tag. |
| **First-time bootstrap script / runbook** | "Provision VM → install Docker → clone → set .env → migrate → start → verify" must be executable in <30 min by anyone with the runbook. Otherwise the VM is a pet, not cattle. | LOW | Can be a single `bootstrap.sh` + a `RUNBOOK.md`. For a POC, a documented checklist is sufficient — full IaC (Terraform/Ansible) is anti-feature for v2.0. |
| **Migrations run on every deploy** | Alembic must run before the API container takes traffic, or schema mismatches break requests. | LOW | Either: (a) compose `depends_on` + entrypoint script that runs `alembic upgrade head` before `uvicorn`, or (b) one-shot `migrate` service that exits 0 before `api` starts. Backwards-compatible migrations only (no destructive in same release). |
| **Restart-on-deploy is acceptable (5-sec blip)** | For a POC with a single user / handful of users, a 5-10 sec restart blip is industry-acceptable. Zero-downtime requires either docker-rollout, blue/green, or Traefik with healthcheck-aware routing — all add real complexity. | LOW | **Differentiator territory** to add `docker-rollout` or blue/green. For v2.0, document that deploys cause a brief 503 and pin them to off-hours. |
| **Reverse proxy with auto-HTTPS** | Browsers refuse PWA install without HTTPS. Service workers won't register without HTTPS. JWT cookies need `Secure` flag which requires HTTPS. | LOW | **Caddy** is the path of least resistance: 5-line Caddyfile gets you auto-Let's-Encrypt + HTTP→HTTPS redirect + HTTP/2. Nginx requires certbot + cron (which silently fails — known production-outage pattern). |
| **Custom domain with A record (and AAAA if VM has IPv6)** | App needs a memorable URL, not an IP. | LOW | **Gotcha:** DNS propagation 5-60 min on first setup; Let's Encrypt issuance fails if A record isn't live, generating a "failed validation" error that some users assume is a Caddy bug. **Always wait for `dig +short yourdomain.com` to return the IP before starting Caddy.** |
| **Production secrets via env file on VM (not in git)** | `.env` mounted into compose. GH Actions injects via SSH session env or `scp`s a fresh `.env`. | LOW | **Minimum viable:** `.env` on VM with `chmod 600`, owned by deploy user. GH Actions secrets → SSH session env vars → written to `/opt/wallet/.env` on each deploy. SOPS/Doppler/Vault is anti-feature for POC (one user, one VM, one developer). |
| **JWT served only over HTTPS with `Secure` cookie flag** | Existing JWT auth works in dev over HTTP. In prod over HTTPS, **without `Secure`** the browser will send the cookie over any future HTTP request — token leak. **Without `SameSite=Lax`** CSRF risk increases. | LOW | **Dependency on existing feature:** auth middleware sets cookie attributes from env (`COOKIE_SECURE=true` in prod, `false` in dev). If the app currently uses `Authorization: Bearer` header from AsyncStorage (not a cookie), this is moot — but **CORS config must change** to whitelist exactly `https://yourdomain.com`, not `*`. |

#### B. PWA basics

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|----------------------|
| **`manifest.json` with required fields** | Without these, Chrome will not show install prompt; iOS shows generic icon. Required: `name`, `short_name`, `start_url`, `display: "standalone"`, `theme_color`, `background_color`, `icons` (with at least 192x192 and 512x512 PNGs, both `purpose: "any"` and one `purpose: "maskable"`). | LOW | Place at `public/manifest.json` for Expo Router web export. Link from `<head>`: `<link rel="manifest" href="/manifest.json">`. **Expo Router does NOT auto-generate this** (the older `@expo/webpack-config` did); must be hand-authored. |
| **Apple-specific meta tags + apple-touch-icon** | iOS Safari ignores most of `manifest.json` for the home-screen experience. Without `<link rel="apple-touch-icon">` (180x180), iOS shows a screenshot. Without `<meta name="apple-mobile-web-app-capable" content="yes">`, opening from home screen launches Safari chrome instead of standalone. | LOW | Required tags: `apple-touch-icon` (180x180 PNG), `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=default` (or `black-translucent`), `apple-mobile-web-app-title`. |
| **Viewport meta with `viewport-fit=cover`** | Without `viewport-fit=cover` on iOS, the white "letterbox" appears around notched-phone content. Without `width=device-width, initial-scale=1`, iOS double-tap-zooms. | LOW | `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` |
| **Service worker that caches the app shell** | Without an SW, the URL is not installable on Chrome (Chrome requires `fetch` handler in active SW). Cache strategy: cache-first for static assets (JS/CSS/fonts/images), network-first for `/api/*` calls. | MED | **Recommendation:** `workbox-cli generateSW` invoked after `expo export -p web`. **Critical anti-pattern warning:** an over-aggressive SW that caches `index.html` as cache-first will trap users on stale builds with no path to update — always use network-first or stale-while-revalidate for the HTML shell, version the SW, and call `skipWaiting()` + `clients.claim()` on activation. |
| **HTTPS** | PWA installability requires it. SW registration requires it. Browser geolocation, clipboard, etc. require it. | LOW | Covered by Caddy + Let's Encrypt above. |

#### C. Mobile-responsive verification

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|----------------------|
| **Touch targets ≥44×44 CSS px (iOS HIG) / ≥48dp (Material)** | Below this threshold, mistaps in transaction lists become rage-taps. Most affected: "delete" icons in row, currency picker chips, tag chips. | LOW-MED | Audit all interactive elements in: TransactionList row actions, FinanceSourceList row actions, modal close buttons, currency picker rows. Apply `min-height: 44px; min-width: 44px;` via NativeWind utility. |
| **`safe-area-inset-*` for notched phones in standalone mode** | When installed as PWA on iPhone X+, the status bar overlaps the header without `env(safe-area-inset-top)` padding, and the home-indicator overlaps the bottom tab bar without `env(safe-area-inset-bottom)`. | LOW | Header: `padding-top: env(safe-area-inset-top)`. Bottom tabs/FAB: `padding-bottom: env(safe-area-inset-bottom)`. Requires the `viewport-fit=cover` meta (above) to take effect. |
| **No hover-only interactions** | Mobile has no hover; "show on hover" UI elements are invisible to phones. Common offenders: tooltips, kebab menus that appear on row hover. | LOW | Audit pass: anything using `:hover` to reveal must also be reachable via tap (or always visible on `(pointer: coarse)`). |
| **Native scroll behavior in long lists** | Transaction list will be hundreds of rows. Custom scroll containers on mobile feel laggy; native `<FlatList>` (or `overflow-y: auto` on web) is correct. | LOW | Likely already correct since Expo `<FlatList>` is native. **Verify on a real phone** that pull-to-refresh works in standalone PWA mode (some browsers disable PTR in standalone). |
| **Form inputs with correct `inputmode` / `type`** | On mobile, `<input type="number">` shows numeric keyboard for amounts. `inputmode="decimal"` is better for currencies (shows `.` not `,` on iOS). `autocomplete="email"` and `type="email"` for login. | LOW | Touch-up pass on TransactionForm amount field, login/register email field. |
| **Text doesn't trigger zoom on focus** | iOS Safari zooms input on focus if `font-size < 16px`. Disorienting. | LOW | Set `font-size: 16px` on `input, select, textarea` globally, or use `user-scalable=no` (last resort — bad for accessibility; the 16px fix is preferred). |

#### D. Operations

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|----------------------|
| **`/health` endpoint** | Caddy/proxy uses it for upstream health. Uptime monitor pings it. Without it, "is the app up?" requires hitting an authenticated route. | LOW | Single `/health` returning `{"status": "ok"}` with HTTP 200 is sufficient for v2.0. Must NOT touch the database (a DB outage shouldn't kill the API container). Separate `/health/ready` that hits DB is differentiator. |
| **External uptime monitor pinging /health every 5 min** | Without it, the first signal of "the app is down" is a user complaint. UptimeRobot free = 50 monitors @ 5 min, alerts via email. Sufficient for one user. | LOW | **Caveat:** UptimeRobot free tier became "non-commercial use only" in Oct 2024. For a personal wallet, fine. **Alternatives:** HetrixTools (15 monitors @ 1 min), Better Stack (10 monitors @ 3 min, 30s on paid), self-hosted Uptime Kuma. |
| **Daily `pg_dump` to off-site object storage** | Single-VM means single point of failure. Disk failure / accidental `docker compose down -v` wipes everything. Off-site (B2/R2/S3) means recovery survives the VM dying entirely. | LOW | Cron container running `pg_dump | gzip | rclone copy` to **Cloudflare R2** (10 GB free, no egress fees) or **Backblaze B2** (10 GB free, free egress to Cloudflare). Use a sidecar like `eeshugerman/postgres-backup-s3` if rolling your own feels risky. **Retain:** 7 daily + 4 weekly is industry minimum. |
| **CI: build + push image to GHCR on push to `main`** | Without CI, deploy = manual `docker build` on laptop, manual `docker push`, manual SSH. Slow, error-prone, undocumented. | LOW | GH Actions workflow: checkout → `docker/build-push-action@v5` → push to `ghcr.io/<user>/wallet-api:latest` and `:<sha>`. Web build similarly: `expo export -p web` → bundle into nginx/static-serve image OR push to `ghcr.io/<user>/wallet-web`. |
| **CD: SSH-deploy after build** | Without CD, a green CI is just "image exists" — not "deployed". | LOW | GH Actions: `appleboy/ssh-action` → `cd /opt/wallet && docker compose pull && docker compose up -d`. Use a dedicated `deploy` SSH key, not personal key. |
| **Post-deploy healthcheck in CI** | Without it, a deploy that pushes a broken image silently 500s until a human notices. | LOW | After SSH `up -d`, run `curl --retry 5 --retry-delay 3 https://yourdomain.com/health` from the runner. Fail the workflow on non-200 so GH sends the email. |

### Differentiators (Nice-to-Have for POC)

These are valuable but skipping them does not break the v2.0 deliverable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Zero-downtime deploys via `docker-rollout`** | Deploys cause no user-visible blip. Drop-in: `docker rollout <service>` instead of `docker compose up -d <service>`. | LOW | Requires healthcheck on the service (which you should have anyway). For a wallet with one user, the 5-sec blip is fine; this is a polish item. |
| **Automated rollback on healthcheck failure** | If post-deploy `/health` fails, redeploy the previous tag automatically. | MED | Requires: tagging with git SHA, a "previous good SHA" file on VM, a small bash wrapper. Most teams add this only after the first painful manual rollback. |
| **Slack/Discord webhook on deploy success/failure** | Immediate visual feedback for the developer; replaces "did the deploy go out?" anxiety. | LOW | One curl POST in the GH Actions workflow. Free webhook from Slack/Discord. |
| **Offline-first PWA (full transaction CRUD offline, sync on reconnect)** | Genuinely useful for entering expenses on the subway. But requires: IndexedDB queue, background sync, conflict resolution. **iOS Background Sync API is unsupported** — sync only happens when the user reopens the app. | HIGH | Defer to a dedicated "offline mode" milestone. For v2.0, the SW caches the shell and lets the app open offline; API calls still need network. |
| **Push notifications via Web Push** | Re-engagement, transaction alerts. Works on Chrome / Android freely. **iOS requires PWA to be installed to home screen first**, and even then has no silent push / no background data. | MED | No use case in v2.0 (no notification-worthy events yet). |
| **Web App Install Prompt (custom UI)** | Catch the `beforeinstallprompt` event on Chrome and show a custom "Install to home screen" banner. Improves install rate vs. waiting for the user to find the menu. | LOW | iOS doesn't fire this event — must show iOS-specific instructions ("tap Share → Add to Home Screen") via UA sniff. |
| **Maskable icons + monochrome icon** | Maskable icons render correctly inside Android's adaptive-icon shape (no white-square halo). Monochrome enables Android's themed icon mode. | LOW | Just an extra icon file + `purpose: "maskable"` and `purpose: "monochrome"` in the manifest. Cheap polish. |
| **HSTS header (without preload)** | Browser refuses to downgrade to HTTP. Defends against SSL-strip attacks. | LOW | Caddy: `header Strict-Transport-Security "max-age=31536000; includeSubDomains"`. **Skip `preload`** for a POC — submitting to the preload list is a one-way door (removal takes weeks/months) and locks you into HTTPS forever, including for any future preview/dev subdomains. |
| **Weekly verified restore drill** | "Backups you've never restored aren't backups." A scripted weekly job that downloads the latest dump into a throwaway Postgres container and runs `\dt` to confirm tables exist. | MED | Catches silent corruption / wrong creds / wrong region issues that daily backups can't. The "gold standard" the question asked about. |
| **Structured logging with request IDs** | When a user reports "it broke at 3pm", correlated logs are the only way to find the problem. JSON logs + a request-id middleware in FastAPI. | LOW | Just a middleware + log formatter swap. Defer log *aggregation* (Loki, Grafana) — that's anti-feature for v2.0. |
| **Image vulnerability scan in CI** | `docker scout` or Trivy on built images surfaces CVEs before deploy. | LOW | Useful but not blocking for v2.0. |

### Anti-Features (Skip in v2.0; Belongs in Later "Harden Production" Milestone)

| Feature | Why Requested | Why Problematic for v2.0 | Alternative |
|---------|---------------|--------------------------|-------------|
| **Kubernetes / k3s on a single node** | "Real production runs on K8s" mythology. | Operational burden 10× higher than docker compose. Single-node k8s gives zero of the benefits (HA, autoscale) and all of the costs (etcd, networking complexity, upgrade hell). | Stick with docker compose until you have a *demonstrated* need that compose can't solve. |
| **Database streaming replication / hot standby** | "What if the DB dies?" | One paying user; daily off-site `pg_dump` recovers within 24 hours. Streaming replication needs a second VM, network tuning, monitoring of replication lag. | Daily off-site backup + documented restore runbook. |
| **PITR (Point-in-Time Recovery) via WAL archiving** | "I want to recover to 3:47pm exactly." | Requires pgBackRest or barman, WAL shipping infrastructure, retention policies. ~10× the operational complexity of `pg_dump`. | Daily snapshot is sufficient for a personal wallet. The user can re-enter today's transactions. |
| **Sentry / error tracking SaaS** | "We need to know about production errors." | Adds external dependency, requires DSN secret management, free tier has tight quotas. For one user, the user IS the error reporter. | FastAPI's built-in exception logging + tail `docker compose logs` when the user reports an issue. Add Sentry when you have >5 users. |
| **Loki + Grafana log aggregation** | "We need observability." | Three more containers, Grafana auth setup, Loki retention tuning. Worth it at 10+ services or 10+ users. | `docker compose logs --tail=200 --follow` is the v2.0 observability story. |
| **Multi-region / CDN for the API** | "What if a user is in Europe?" | Frankfurter and a Singapore VM serve the wallet user(s) fine. CDN in front of a SPA's static assets is a polish item; Caddy serves them at sane speeds already. | Cloudflare in front of the static web (free, easy) is a *differentiator*; multi-region API is anti-feature. |
| **OAuth / social login** | Already explicitly out-of-scope per PROJECT.md. | Email + password works for a private POC. | Defer indefinitely. |
| **Native EAS builds (iOS / Android)** | Already explicitly out-of-scope per PROJECT.md (deferred to M2/M6). | App Store / Play Store accounts, signing certs, review queues — all weeks of overhead for a POC user. | The PWA *is* the mobile experience for v2.0. |
| **SOPS / Doppler / HashiCorp Vault for secrets** | "Industry-standard secret management." | One developer, one VM, one set of secrets. The overhead of SOPS or Doppler dwarfs the benefit. | `chmod 600 .env` on the VM. Rotate by editing the file and `docker compose up -d`. |
| **Preview environments per PR** | Useful at team scale. | Single dev, no PR review process, no QA team. Spinning up subdomains and certs per branch chews Let's Encrypt rate limits (50/week per registered domain). | Test locally with `docker compose up`. |
| **Blue/green deployment with full env duplication** | Zero-downtime + instant rollback. | A single 1-CPU/2GB VM may not have RAM headroom to run two full stacks side-by-side. `docker-rollout` (one extra container per service, briefly) is enough. | `docker-rollout` if zero-downtime is desired; otherwise accept the 5-sec blip. |
| **HSTS preload submission** | "Maximum HTTPS security." | Submitting to the preload list is one-way (removal takes weeks). Locks every subdomain into HTTPS-only forever. Bad call for a POC where you might want a quick `staging.` HTTP test. | Plain HSTS header (no `preload`) gives 99% of the benefit reversibly. |
| **Web Push notifications** | Re-engagement. | iOS requires installed PWA; no silent push; only relevant if there's something to notify about. v2.0 has no notification-worthy events. | Defer until a use case (e.g., budget alerts, recurring transaction reminders) appears. |

## Feature Dependencies

```
Custom domain + DNS A record
    └──blocks──> Let's Encrypt issuance
                       └──blocks──> HTTPS reachable
                                          ├──blocks──> Service worker registration
                                          │                  └──blocks──> PWA install prompt
                                          ├──blocks──> JWT cookie Secure flag
                                          └──blocks──> /health endpoint reachable for monitor

GHCR build pipeline
    └──blocks──> SSH-deploy CD
                       └──blocks──> Post-deploy healthcheck
                                          └──blocks──> Slack/email failure notification

Manifest.json + apple-touch-icon + viewport-fit=cover meta
    └──enables──> "Looks right on iOS home screen"

viewport-fit=cover meta
    └──required-by──> safe-area-inset-* CSS

Daily pg_dump cron + B2/R2 credentials
    └──enables──> Disaster recovery
                       └──enhanced-by──> Weekly restore drill (differentiator)

Existing JWT auth ──depends-on──> CORS allowlist updated to prod domain
                  ──depends-on──> Cookie Secure + SameSite=Lax (if cookie-based)
                                  OR Authorization header (if AsyncStorage-based, current state)

Existing Frankfurter integration ──unaffected──> by deploy (it's an outbound HTTP call)
```

### Dependency Notes

- **DNS → Certs → HTTPS → almost everything else:** Get the A record live and `dig`-confirmed *before* starting Caddy the first time. Caddy will hammer Let's Encrypt's prod API and burn through duplicate-cert quota (5 per exact identifier set per week) if it loops on a misconfigured domain.
- **SW registration scope = directory of the SW file:** Place `sw.js` at the web root (`/sw.js`) so its scope is `/`, not nested under `/static/sw.js` (scope `/static/`).
- **Existing JWT auth → CORS:** Current dev probably uses `allow_origins=["*"]` or `localhost:8081`. Production must whitelist exactly `https://yourdomain.com`. If the SPA is served from the *same* origin as the API (Caddy reverse-proxies `/api/*` to FastAPI on the same host), CORS becomes a non-issue — strongly recommended pattern.
- **Existing AsyncStorage-based JWT:** If the app currently sends `Authorization: Bearer <token>` from `AsyncStorage` (not a cookie), the SameSite/Secure cookie attack surface doesn't apply, but XSS becomes the dominant token-theft vector — making the SPA's CSP and dependency hygiene more important. Verify which scheme is in use during scoping.
- **Migrations before API start:** If the API container starts before migrations finish, the first requests after deploy hit the old schema. Either chain via compose `depends_on` + healthcheck on the migrate service, or run migrations as an init container.

## MVP Definition

### Launch With (v2.0)

These constitute "the deploy is real":

- [ ] Production `docker-compose.yml` (backend + db + Caddy + web)
- [ ] Production `Dockerfile`s for backend and web (multi-stage, non-root user)
- [ ] GHCR image push on `main` push (GH Actions)
- [ ] SSH-deploy step + post-deploy `/health` curl in GH Actions
- [ ] Caddyfile with auto-HTTPS + HSTS (no preload)
- [ ] Custom domain registered and DNS-pointed
- [ ] `manifest.json` with name, short_name, start_url, display=standalone, theme_color, background_color, 192/512 icons (one maskable)
- [ ] `<link rel="apple-touch-icon">` (180x180), apple-mobile-web-app-capable meta, viewport-fit=cover meta
- [ ] Service worker generated by Workbox: cache-first for JS/CSS/fonts, network-first for `/api/*`, network-first for `/index.html`
- [ ] Touch target audit + 16px input font + safe-area-inset on header/tabs
- [ ] `/health` endpoint (no DB touch)
- [ ] UptimeRobot monitor (5-min) on `/health`
- [ ] Daily `pg_dump | gzip | rclone copy` to R2/B2 (cron container)
- [ ] `.env` on VM via SSH-injected GH secrets (no .env in git)
- [ ] CORS narrowed to prod domain (or same-origin via reverse proxy)
- [ ] Cookie `Secure` + `SameSite=Lax` if cookie auth is used
- [ ] First-time deploy `RUNBOOK.md` (provision → install Docker → clone → bootstrap)

### Add After Validation (v2.x)

Trigger: the v2.0 deploy is up and the user has actually used it from a phone for a week.

- [ ] `docker-rollout` for zero-downtime deploys — trigger: first time you postpone a deploy because "users are using it"
- [ ] Slack/Discord deploy webhook — trigger: you miss a failed deploy and find out next day
- [ ] Custom Install banner with iOS instructions — trigger: anyone other than you needs to install it
- [ ] Weekly restore-drill cron — trigger: first time you wonder "are the backups actually working?"
- [ ] Structured JSON logs + request IDs — trigger: first user-reported bug you can't reproduce
- [ ] Maskable + monochrome icons — trigger: first time you see the white-square halo on Android

### Future Consideration (v3+)

- [ ] Sentry — when >1 user means you can't be the error reporter
- [ ] Loki + Grafana — when log volume exceeds `docker compose logs` usability
- [ ] Offline-first writes (IndexedDB queue) — when subway-mode entry becomes a real use case
- [ ] Web Push notifications — when there's something to notify about (budgets, recurring txns)
- [ ] PITR / streaming replication — when 24h RPO becomes unacceptable
- [ ] Multi-region / CDN — when latency complaints arrive

## Feature Prioritization Matrix

Prioritization within v2.0 scope only.

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Domain + Caddy + HTTPS | HIGH | LOW | P1 |
| Production docker-compose | HIGH (operator) | LOW | P1 |
| GHCR + SSH deploy | HIGH (operator) | LOW | P1 |
| Migrations on deploy | HIGH | LOW | P1 |
| `/health` + UptimeRobot | MEDIUM | LOW | P1 |
| Daily off-site backup | HIGH (one disk failure away) | LOW | P1 |
| `.env` on VM, not in git | HIGH (security) | LOW | P1 |
| CORS / cookie hardening | HIGH (security) | LOW | P1 |
| Manifest + iOS meta tags | HIGH (PWA installable) | LOW | P1 |
| Service worker (basic) | HIGH (PWA installable) | MEDIUM | P1 |
| Touch targets + safe-area-inset | HIGH (mobile usable) | LOW | P1 |
| 16px input font (no zoom) | MEDIUM | LOW | P1 |
| Post-deploy healthcheck in CI | MEDIUM | LOW | P1 |
| `docker-rollout` zero-downtime | LOW (one user) | LOW | P2 |
| Slack deploy webhook | LOW | LOW | P2 |
| Maskable icons | LOW | LOW | P2 |
| HSTS header (no preload) | MEDIUM | LOW | P2 |
| Weekly restore drill | MEDIUM | MEDIUM | P2 |
| Custom Install banner | LOW | LOW | P3 |
| Structured JSON logs | LOW (until first incident) | LOW | P3 |
| Image CVE scan in CI | LOW | LOW | P3 |

## Sources

PWA / mobile-web:
- [Web app manifest – web.dev](https://web.dev/learn/pwa/web-app-manifest)
- [Making PWAs installable – MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Master PWA Installs on iOS & Android: 2025 Guide – JunKangWorld](https://junkangworld.com/blog/master-pwa-installs-on-ios-android-the-2025-guide)
- [PWA on iOS – Current Status & Limitations 2025 – Brainhub](https://brainhub.eu/library/pwa-on-ios)
- [iOS PWA Compatibility – firt.dev](https://firt.dev/notes/pwa-ios/)
- [Do Progressive Web Apps Work on iOS? Complete Guide for 2026 – Mobiloud](https://www.mobiloud.com/blog/progressive-web-apps-ios)
- [Progressive web apps – Expo Documentation](https://docs.expo.dev/guides/progressive-web-apps/)
- [enabling-web-service-workers.md – expo/fyi](https://github.com/expo/fyi/blob/main/enabling-web-service-workers.md)
- [Caching strategies for PWA – Vaadin](https://vaadin.com/pwa/learn/caching-strategies)
- [Offline-First PWAs: Service Worker Caching Strategies – MagicBell](https://www.magicbell.com/blog/offline-first-pwas-service-worker-caching-strategies)
- [Caching – Progressive web apps – MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)

Mobile responsiveness / safe area:
- [Accessible tap targets – web.dev](https://web.dev/articles/accessible-tap-targets)
- [Accessible Target Sizes Cheatsheet – Smashing Magazine](https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/)
- [env() CSS function – MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/env)
- ["The Notch" and CSS – CSS-Tricks](https://css-tricks.com/the-notch-and-css/)
- [Make Your PWAs Look Handsome on iOS – Karma / DEV](https://dev.to/karmasakshi/make-your-pwas-look-handsome-on-ios-1o08)

Deployment / Docker / zero-downtime:
- [Zero Downtime Deployment with Docker Compose in OCI VPS using GitHub Actions – DEV](https://dev.to/thayto/zero-downtime-deployment-with-docker-compose-in-an-oci-vps-using-github-actions-1fbd)
- [docker-rollout – GitHub](https://github.com/wowu/docker-rollout)
- [Docker Rollout: Zero-Downtime Deployments for Docker Compose – Virtualization Howto](https://www.virtualizationhowto.com/2025/06/docker-rollout-zero-downtime-deployments-for-docker-compose-made-simple/)
- [Easy Zero-downtime Docker Compose deployment – Supun.io](https://supun.io/zero-downtime-deployments-docker-compose)

Reverse proxy / TLS:
- [Caddy vs Nginx 2026 – Techplained](https://www.techplained.com/caddy-vs-nginx)
- [Automatic HTTPS – Caddy Documentation](https://caddyserver.com/docs/automatic-https)
- [Rate Limits – Let's Encrypt](https://letsencrypt.org/docs/rate-limits/)
- [Scaling Our Rate Limits – Let's Encrypt](https://letsencrypt.org/2025/01/30/scaling-rate-limits)
- [Staging Environment – Let's Encrypt](https://letsencrypt.org/docs/staging-environment/)

CI/CD / secrets:
- [Using secrets with GitHub Actions – Docker Docs](https://docs.docker.com/build/ci/github-actions/secrets/)
- [Managing secrets in Docker Compose and GitHub Actions deployments – jmh.me](https://jmh.me/blog/secrets-management-docker-compose-deployment)
- [Best Practices for Managing Secrets in GitHub Actions – Blacksmith](https://www.blacksmith.sh/blog/best-practices-for-managing-secrets-in-github-actions)

Backups / monitoring:
- [postgres-backup-s3 – eeshugerman/GitHub](https://github.com/eeshugerman/postgres-backup-s3)
- [pg-r2-backup – BigDaddyAman/GitHub](https://github.com/BigDaddyAman/pg-r2-backup)
- [PostgreSQL backup retention policies – DEV](https://dev.to/piteradyson/postgresql-backup-retention-policies-how-to-set-up-backup-retention-policies-1nj0)
- [UptimeRobot Pricing](https://uptimerobot.com/pricing/)
- [Best UptimeRobot Alternative: Free Unlimited Monitoring – exit1.dev](https://exit1.dev/blog/uptimerobot-alternative-free-unlimited)
- [FastAPI Health Check Endpoint Best Practices – Index.dev](https://www.index.dev/blog/how-to-implement-health-check-in-python)
- [FastAPI Health Checks and Timeouts – Bhagya Rana / Medium](https://medium.com/@bhagyarana80/fastapi-health-checks-and-timeouts-avoiding-zombie-containers-in-production-411a27c2a019)

Auth / security:
- [Ultimate Guide to Securing JWT with httpOnly Cookies – Wisp CMS](https://www.wisp.blog/blog/ultimate-guide-to-securing-jwt-authentication-with-httponly-cookies)
- [CSRF Prevention Cheat Sheet – OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Handling Authentication in SPA With JWT and Cookies – Povio](https://povio.com/blog/handling-authentication-in-spa-with-jwt-and-cookies)

---
*Feature research for: Single-VPS Production Deployment + Mobile-Web (PWA) Access*
*Researched: 2026-05-02*
