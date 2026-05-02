# Pitfalls Research

**Domain:** First-time production deployment + PWA layer for FastAPI + Expo Web on a single VPS
**Researched:** 2026-05-02
**Confidence:** HIGH (most items verified against official docs / current 2026 sources; a few marked MEDIUM/LOW inline)

> Scope assumption: single-developer POC, single VM, Docker Compose, custom domain, Caddy + Let's Encrypt, Expo web export served as PWA, daily pg_dump → object storage, GitHub Actions → GHCR → SSH deploy. JWT in `AsyncStorage` (no server sessions).

---

## TL;DR — Top 5 Highest-Risk Pitfalls

Ranked by **likelihood × blast radius** for a single-developer first deploy. Each one is the kind of thing that either (a) silently corrupts a deploy you can't roll back from, or (b) wastes a full weekend.

| # | Pitfall | Why it ranks here | First sign you hit it |
|---|---------|-------------------|----------------------|
| **1** | **Stale service-worker cache pinning a wrong API URL** | A bad SW deployed once will *permanently* cache the wrong `EXPO_PUBLIC_API_URL` on every installed PWA. Hard to recover — users have to manually clear site data or you must ship a "kill-switch" SW. There is no server-side fix. | Phone PWA keeps hitting `localhost:8000` or old preview URL; refresh doesn't fix it; only "Clear site data" works. |
| **2** | **Hetzner Singapore has no ARM (CAX) — only AMD CPX** | The milestone names "Hetzner Singapore ARM CAX11 primary" — that VM doesn't exist. You'll either pick a wrong shape or waste hours debugging the Hetzner UI. CAX is EU-only. | Region selector greys out CAX shapes when SG region is chosen. |
| **3** | **Oracle Always Free reclaims the instance after 7 days <20% CPU** | This is the single most-cited Oracle Free Tier complaint. Wallet app traffic = ~zero, so reclamation is *guaranteed*, not hypothetical. You'll wake up to a stopped instance and possibly lose the shape if SG ARM capacity is exhausted (it routinely is). | Instance shows "Stopped" in console; trying to start returns "Out of host capacity." |
| **4** | **Expo `EXPO_PUBLIC_*` vars are baked at build time → wrong API URL shipped to prod** | First deploy will almost certainly ship with `EXPO_PUBLIC_API_URL=http://localhost:8000` (or your dev value) inlined into the JS bundle. Combined with pitfall #1 (SW cache), this is unrecoverable without a manual cache purge on every device. | DevTools network tab on phone shows requests going to localhost or wrong host. |
| **5** | **Let's Encrypt rate limit (50/week registered domain, 5/week duplicate) hit during testing** | Easy to blow during initial setup — restart Caddy 6 times debugging a config and you're locked out for a week. Recovery = wait 7 days *or* buy a different domain. Not using the staging endpoint first is the cause every single time. | Caddy logs: `urn:ietf:params:acme:error:rateLimited` or `too many certificates already issued`. |

These five share a common pattern: **they are unrecoverable or severely punishing if hit, and the prevention is a single config flag or one-line change**. The roadmap should prevent each *before* the corresponding feature ships, not after.

---

## Critical Pitfalls

### Pitfall 1: Stale service worker pins a broken API URL forever

**What goes wrong:**
A service worker is registered with `clients.claim()` + cache-first strategy. The first deploy ships with a wrong `API_URL` (e.g. `localhost:8000`). User loads the page once, the SW installs, the SW caches `index.html` and the JS bundle, and the app is now permanently broken on that device. Subsequent deploys don't help because the old SW intercepts requests and serves stale assets. Users can't even reach the new SW because the old one is in control.

**Why it happens:**
- Default Workbox / Expo PWA templates use cache-first for static assets.
- Developers test the PWA only on their dev laptop where they DevTools-clear caches reflexively.
- The "Update on reload" devtools toggle hides the bug from the developer.
- No SW update notification flow built in. The SW only takes over on a hard reload, which users never do.

**How to avoid:**
1. Register the SW with `updateViaCache: 'none'` so the SW file itself is never cached.
2. Use a network-first or stale-while-revalidate strategy for `index.html` — never cache-first.
3. Never cache `/api/*` requests in the SW (bypass them explicitly via runtime route exclusion).
4. Inject a build-time `BUILD_ID` constant into the SW so a new deploy = a new SW (forces install).
5. Implement a SW update flow: `registration.waiting.postMessage({type:'SKIP_WAITING'})` triggered by a "New version available, reload?" UI prompt.
6. Ship a "kill-switch" SW from day one — a registered route at e.g. `/sw-killswitch.js` that, when fetched and registered, calls `self.registration.unregister()` and `caches.keys().then(k => k.forEach(caches.delete))`. This is your nuclear option for fixing the unrecoverable case.
7. Make the API URL **runtime-fetched** (see Pitfall 4), not build-time-baked, so even a stale bundle can self-correct.

**Warning signs:**
- DevTools Application tab shows two SW versions ("activated" + "waiting") and the waiting one never activates.
- Phone keeps hitting an old hostname even after you redeployed hours ago.
- The fix on dev laptop ("just clear cache") doesn't help on the phone because users won't do that.

**Phase to address:** **PWA phase** — must land *before first public deploy*. Add SW update flow + kill-switch as a hard requirement, not a stretch goal.

**Sources:** [Taming PWA Cache Behavior — Infinity Interactive](https://iinteractive.com/resources/blog/taming-pwa-cache-behavior), [PWA Update — web.dev](https://web.dev/learn/pwa/update)

---

### Pitfall 2: Hetzner Singapore offers no ARM (CAX) — milestone assumption is wrong

**What goes wrong:**
The milestone says "Hetzner Singapore ARM (CAX11) primary." That instance **does not exist**. As of 2026, Hetzner Singapore only offers CPX (AMD shared), CCX (AMD dedicated). CX (Intel) and CAX (Ampere ARM) are EU-only. Selecting "Singapore" in the Hetzner UI greys out CAX shapes silently. If you scripted Terraform/hcloud-cli with `cax11` + `sin-cloud1`, the API will reject it with a confusing "shape not available in location" error.

**Why it happens:**
- Hetzner's marketing materials don't make region/shape compatibility obvious.
- Most blog posts about CAX are EU-centric.
- The user/orchestrator likely conflated "Hetzner has SG" + "Hetzner has ARM" → "Hetzner has SG ARM."

**How to avoid:**
- **Update the milestone:** Hetzner SG = CPX21 (AMD, ~€7.05/mo, 4GB RAM, 2 vCPU, 8TB traffic) is the realistic primary. CAX11 (€3.79/mo, ARM, EU only) is only viable if you accept ~150–200ms RTT from SE Asia.
- If you genuinely want ARM in SG, the only realistic options are: Oracle Cloud SG (with reclamation risk — see Pitfall 3) or AWS Graviton (not free).
- Decide at provisioning phase: **lower latency (Hetzner SG AMD)** vs **lower cost + ARM (Hetzner Helsinki/Falkenstein CAX)**.

**Warning signs:**
- `hcloud server create --image ... --type cax11 --location sin-cloud1` → API error.
- Hetzner Cloud web UI shape picker disables ARM rows when SG is selected.

**Phase to address:** **Provisioning phase** — must be settled before purchasing a domain or doing any DNS work.

**Sources:** [Hetzner Cloud Review 2026 — Better Stack](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/), [Hetzner Cloud Pricing](https://www.hetzner.com/cloud), [Hetzner Cost-Optimized plans (CAX = EU only)](https://www.hetzner.com/cloud/cost-optimized)

---

### Pitfall 3: Oracle Cloud Always Free reclaims idle instances after 7 days

**What goes wrong:**
Oracle's policy: Always Free compute is reclaimed if **CPU 95th percentile < 20%** over a 7-day window (some sources cite < 10% across CPU+network+memory for A1 ARM shapes). A wallet app for one user will trivially be below that threshold. After reclamation, the instance is *stopped*, not deleted — but to restart it you need shape capacity in the region, and Always Free SG ARM (Ampere A1) is **notoriously capacity-constrained** with reports of "Out of host capacity" errors lasting weeks.

**Why it happens:**
- Personal POC traffic is genuinely near zero.
- Postgres in idle state uses ~1% CPU.
- FastAPI with no requests uses ~0% CPU.
- Oracle introduced this in 2023 to free up A1 capacity for new free-tier signups.

**How to avoid:**
- **Don't use Always Free for the primary deploy.** Use it only as a redundant secondary or DR target.
- If using anyway: run a synthetic load script (cron `stress-ng --cpu 1 --timeout 300s` every few hours) to keep the 95th percentile above 20%. This is a hack but well-documented in the LowEndTalk community ("NeverIdle," "LookBusy" scripts).
- Convert account to Pay-As-You-Go ($0/mo if you stay within free limits, but tagged as paying customer → no reclamation). **This is the only officially supported way.** Requires a credit card on file.
- Take frequent boot-volume backups (free; 5 backups retained) so if the instance is reclaimed and you can't get capacity back, you can restore elsewhere.
- Pin the boot-volume backup, the public IP reservation, and the cloud-init config to source control so re-creation is < 30 minutes.

**Warning signs:**
- OCI console: "Stopped" status with reason "Reclaimed."
- Email from Oracle warning of pending reclamation 24h ahead (easy to miss).
- Trying to start an A1 instance returns `Out of host capacity` — capacity may not return for days/weeks.

**Phase to address:** **Provisioning phase** — decide explicitly: Hetzner-primary (paid €7/mo, no reclamation) or Oracle-primary (free, with weekly liveness hack required). Don't leave it ambiguous.

**Sources:** [Oracle Always Free FAQ](https://www.oracle.com/cloud/free/faq/), [Oracle Cleaning Up Idle Compute Instances + LookBusy script](https://blog.51sec.org/2023/02/oracle-cloud-cleaning-up-idle-compute.html), [LowEndTalk: Oracle may reclaim your idle VPS](https://lowendtalk.com/discussion/184161/oracle-may-reclaim-your-idle-vps)

---

### Pitfall 4: Expo `EXPO_PUBLIC_*` env vars are inlined at build time

**What goes wrong:**
You build the Expo web bundle on your laptop with `.env.local` containing `EXPO_PUBLIC_API_URL=http://localhost:8000`. That literal string is **inlined into every JS chunk** during bundling. Deploying that bundle means every user's browser tries to fetch `http://localhost:8000` (their own machine, not your server). Combined with Pitfall 1 (SW cache), this is permanent.

Changing the value requires a **full rebuild** of the bundle, then a redeploy, then waiting for SW to update.

**Why it happens:**
- Expo's `EXPO_PUBLIC_` prefix only signals "safe to inline" — devs assume it's read at runtime.
- `process.env.EXPO_PUBLIC_X` is replaced with the literal string at bundle time by Metro.
- Local `.env` files leak into prod builds if you build locally without environment isolation.

**How to avoid:**
1. **Build the prod bundle inside CI/CD only**, never on a dev laptop. CI sets `EXPO_PUBLIC_API_URL=https://api.yourdomain.com` from GitHub secrets / Actions environment.
2. Add a build-time guard: a script that fails the build if `EXPO_PUBLIC_API_URL` contains `localhost`, `127.0.0.1`, or starts with `http://` (only `https://` allowed in prod).
3. **Better: do not bake the API URL.** Have the bundle fetch `/config.json` at runtime (served by Caddy, not in the bundle). Then changing the API URL is a config edit + redeploy of one tiny file, no SW invalidation needed.
4. Use `EAS environment variables` for native builds; for web builds, gate prod builds behind `NODE_ENV=production` and a separate `.env.production` file ignored by `.gitignore`'s rule for `.env*`.

**Warning signs:**
- DevTools network tab on phone shows `http://localhost:8000/api/...` (red CORS errors).
- Searching the deployed JS bundle for `localhost` returns hits (`curl -s https://yourdomain.com/static/js/main.*.js | grep -o 'http[^"]\{1,40\}'`).

**Phase to address:** **Frontend production build phase** + **CI/CD phase** — both need the guard. Add the bundle-grep check to CI as a release gate.

**Sources:** [Environment variables in Expo — official docs](https://docs.expo.dev/guides/environment-variables/), [EAS environment variables FAQ](https://docs.expo.dev/eas/environment-variables/faq/)

---

### Pitfall 5: Let's Encrypt rate limit hit during initial Caddy setup

**What goes wrong:**
Let's Encrypt's production API limits: **50 certificates per registered domain per week** (counts new issuance) and **5 duplicate certificates per week** (same exact domain set). Restart Caddy 5 times while debugging a misconfigured site block, and you're locked out of `yourdomain.com` certs for ~7 days. There is no override, no support ticket fix.

**Why it happens:**
- Default Caddy config uses production ACME endpoint. There is no warning before you hit it.
- Devs iterate on Caddyfile config, restart container, each cycle re-issues a cert.
- Trying to add a wildcard while debugging counts against the limit.

**How to avoid:**
1. **Always start with the staging endpoint** during initial setup. In Caddyfile global block:
   ```
   {
       acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
   }
   ```
   Confirm everything works end-to-end with the (untrusted) staging cert. *Then* remove that line for production.
2. Persist Caddy's `/data` directory across container restarts (named volume `caddy_data:/data`) — Caddy stores certs there and won't re-issue if the cert is still valid. Wiping this volume on every `down -v` is what triggers re-issuance.
3. Use a sub-subdomain (`test.yourdomain.com`) for experiments so prod-domain limits aren't burned.
4. If you accidentally hit the limit, the clock is the *only* fix — wait the rolling 7 days. Or buy a second domain.

**Warning signs:**
- Caddy logs: `urn:ietf:params:acme:error:rateLimited`
- Caddy logs: `too many certificates already issued for: yourdomain.com`
- Site loads with browser SSL warning instead of a valid cert.

**Phase to address:** **Reverse proxy / HTTPS phase** — staging endpoint must be the default in the first iteration of the Caddyfile. Switch to prod endpoint as a separate, deliberate commit.

**Sources:** [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/), [Let's Encrypt Staging Environment](https://letsencrypt.org/docs/staging-environment/), [Caddy + Cloudflare proxy pitfalls](https://caddy.community/t/solved-caddy-and-lets-encrypt-cloudflare-dns-challenge-not-working/23728)

---

### Pitfall 6: `restart: always` makes intentional stops permanent

**What goes wrong:**
Compose's `restart: always` means **the container restarts even if you `docker stop` it** — Docker daemon reload, host reboot, or `compose restart` will all bring it back up. You can't take it down for surgery without disabling the policy.

`unless-stopped` does what most people *think* `always` does: restart on crash/reboot, *but respect a manual stop*.

**Why it happens:**
Pasted from a tutorial that used `always` because that's the most-restart-y option.

**How to avoid:**
Default every service to `restart: unless-stopped` in `docker-compose.yml`. Reserve `always` for one specific case: containers that *must* run no matter what, even if an operator stops them by accident (rare).

**Warning signs:**
- `docker compose stop backend` followed by `docker ps` still shows backend running.
- Postgres restarts itself mid-`pg_dump`.

**Phase to address:** **Containerization phase** — set the default in the first `docker-compose.yml` template; add to a checklist.

**Sources:** [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/), [Baeldung — Compose restart policies](https://www.baeldung.com/ops/docker-compose-restart-policies)

---

### Pitfall 7: `depends_on` does not wait for healthy → frontend hits backend before it's ready

**What goes wrong:**
`depends_on: [backend]` only waits for the backend container to *start*, not to be *ready to accept connections*. On a fresh `docker compose up` after a reboot, the FE container starts, makes an API call, gets `connection refused` because Postgres → Alembic → uvicorn is still booting. App appears broken on first hit; refreshing fixes it. Confusing to debug.

**Why it happens:**
The "wait for ready" semantics require explicit healthchecks + `condition: service_healthy`.

**How to avoid:**
1. Add `healthcheck:` to backend (`curl -f http://localhost:8000/healthz || exit 1`), Postgres (`pg_isready -U $POSTGRES_USER`), and Caddy.
2. Use long-form `depends_on`:
   ```yaml
   depends_on:
     backend:
       condition: service_healthy
   ```
3. The backend itself needs to gracefully retry the DB connection on startup — Postgres takes ~5–15s to be `pg_isready`.

**Warning signs:**
- First request after `compose up` returns 502/connection refused; subsequent ones work.
- Caddy logs `dial tcp ...:8000: connect: connection refused` on container startup.

**Phase to address:** **Containerization phase**, validated in **deployment smoke-test phase**.

---

### Pitfall 8: Alembic migrations run on app startup race with multiple workers

**What goes wrong:**
If `cmd: alembic upgrade head && uvicorn app:app --workers 4`, only worker 0 runs the migration — fine. But if migrations are inside a FastAPI startup event, all 4 workers race; one wins, three error or worse, two partially apply. With Compose scaling (`--scale backend=2`), even the entrypoint approach races between containers.

**Why it happens:**
Tutorials show migration-on-startup for simplicity. Multi-worker production breaks the assumption.

**How to avoid:**
1. Run migrations as a **separate one-shot Compose service** that runs to completion before the backend starts:
   ```yaml
   migrate:
     image: ${BACKEND_IMAGE}
     command: alembic upgrade head
     depends_on: { db: { condition: service_healthy } }
   backend:
     depends_on: { migrate: { condition: service_completed_successfully } }
   ```
2. *Never* call `alembic.command.upgrade(...)` from a FastAPI startup hook in production.
3. Pin `alembic_version` table location in `alembic.ini` (default schema is fine) so first run isn't ambiguous.
4. Have a deployment-script safety check: refuse to run `alembic upgrade` if the target DB URL does not match a known-prod allowlist (prevents the "I ran prod migrations against my dev DB" disaster).

**Warning signs:**
- Random `relation "alembic_version" already exists` or `duplicate key value violates unique constraint "alembic_version_pkc"` errors on deploy.
- Schema in inconsistent state — some columns added, some not.

**Phase to address:** **Containerization phase** + **Deploy script phase**. The "wrong DB" guard belongs in the deploy script.

**Sources:** [Alembic in CI/CD](https://www.stacklesson.com/react-fastapi/fastapi-alembic/ch25-lesson-05-alembic-in-ci-cd/)

---

### Pitfall 9: pg_dump version mismatch silently breaks backups

**What goes wrong:**
You install `postgresql-client` on the VM via `apt`, get whatever version Ubuntu ships (often older than your Postgres 15 container). pg_dump errors:
```
pg_dump: error: aborting because of server version mismatch
pg_dump: server version: 15.5; pg_dump version: 14.10
```
Cron runs nightly, fails silently, you don't notice until the day you need a backup.

**Why it happens:**
Postgres rule: pg_dump must be **>= server version**. Older pg_dump cannot dump newer servers. apt-installed client is often older than container-installed server.

**How to avoid:**
1. Run pg_dump *inside* the same Postgres container (or a sibling container of the same image): `docker compose exec db pg_dump ...` — guaranteed version match.
2. Or, use Postgres's official apt repo (`apt.postgresql.org`) to install matching client.
3. Add a startup check to the backup script: `pg_dump --version` vs `psql -c "SHOW server_version"` — fail loudly if they differ.
4. Pipe backup output to a "did-this-actually-produce-a-non-empty-file" check (size > 1KB minimum, more if the DB has data) and alert if it doesn't.

**Warning signs:**
- Cron logs show "aborting because of server version mismatch."
- Backup files in B2/R2 are 0 bytes or 200 bytes (just an error message).

**Phase to address:** **Backup phase**. Add a weekly *restore test* to a throwaway schema as the only true verification.

**Sources:** [DigitalOcean — Fix pg_dump version mismatch](https://docs.digitalocean.com/support/how-do-i-fix-the-pg_dump-aborting-because-of-server-version-mismatch-error/), [Heroku — server version mismatch](https://help.heroku.com/PK20R6U8/why-am-i-seeing-a-server-version-mismatch-error-when-restoring-a-postgres-database-with-pg_dump)

---

### Pitfall 10: Cloudflare proxy mode breaks Let's Encrypt HTTP-01 challenge

**What goes wrong:**
You buy a domain, point it at Cloudflare's nameservers (because their DNS UI is good), enable proxy mode (orange cloud) for `app.yourdomain.com` because "DDoS protection sounds nice." Caddy starts, tries HTTP-01 challenge, the request `http://app.yourdomain.com/.well-known/acme-challenge/...` is intercepted by Cloudflare's edge and never reaches your VM. ACME fails. Caddy retries. You hit Pitfall 5 (rate limit).

**Why it happens:**
Cloudflare's proxy intercepts HTTP traffic. The HTTP-01 challenge expects a direct hit on port 80 of your origin.

**How to avoid:**
1. **First-time setup: turn proxy mode OFF (grey cloud) until cert is issued and Caddy has it in `/data`.**
2. Then either: (a) leave proxy off permanently — simplest; (b) turn proxy on + switch Caddy to DNS-01 challenge with Cloudflare API token; (c) use Cloudflare Origin Certificates (15-year cert from Cloudflare, paired with their proxy).
3. For a single-dev POC, option (a) is correct. Cloudflare proxy is overkill for a personal wallet.

**Warning signs:**
- ACME fails with `Connection refused` or `404` on `/.well-known/acme-challenge/...`
- `dig app.yourdomain.com` returns Cloudflare IPs (104.x, 172.x) instead of your VM's IP.

**Phase to address:** **DNS / domain phase** — checklist item: "before first deploy, verify `dig +short app.yourdomain.com` returns the *VM's* IP, not Cloudflare's."

**Sources:** [Caddy + Cloudflare proxy issue](https://caddy.community/t/solved-caddy-and-lets-encrypt-cloudflare-dns-challenge-not-working/23728), [Caddy Automatic HTTPS docs](https://caddyserver.com/docs/automatic-https)

---

### Pitfall 11: Disk fills — Docker images, journald, Postgres WAL

**What goes wrong:**
Single-VM, no log rotation. Causes of disk-full disaster, in descending frequency:
- **Docker image bloat:** every CI deploy pulls a new image, old images are never pruned. After ~30 deploys you're out of disk on a 40GB VM.
- **Container logs:** default Docker `json-file` driver has no rotation. A noisy backend can write GBs/day.
- **journald:** systemd-journald defaults to ~10% of disk; on a 40GB VM that's 4GB. Docker daemon logs everything to journald *and* to its own log file (double accounting).
- **Postgres WAL:** if `wal_keep_size` is set wrong or replication is configured but inactive, WAL can grow without bound.
- **Postgres `pg_dump` files written locally and not deleted after upload to S3/R2.**

When disk hits 100%, Postgres goes read-only, FastAPI starts erroring on writes, Docker can't restart containers, Caddy can't write certs. Cascading failure.

**How to avoid:**
1. Daemon config `/etc/docker/daemon.json`:
   ```json
   { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
   ```
2. Cron weekly: `docker system prune -af --filter "until=168h"` (clean images > 1 week old).
3. Limit journald: `/etc/systemd/journald.conf` → `SystemMaxUse=500M`.
4. Backup script: write to `/tmp` (tmpfs or auto-cleaned), upload, then `rm`. Never accumulate dumps locally.
5. Monitor: a `df -h` cron that alerts (via a simple `curl healthchecks.io`) when usage > 80%.

**Warning signs:**
- `df -h` shows `/var/lib/docker` at >80%.
- Postgres logs `disk full` or transitions to recovery mode.
- `journalctl --disk-usage` shows multi-GB.

**Phase to address:** **Containerization phase** (daemon log limits) + **Backup phase** (cleanup) + **Monitoring phase** (alert).

---

### Pitfall 12: No memory limits → Postgres OOM-killed by FastAPI under load

**What goes wrong:**
4GB VM, no `mem_limit` on any service. FastAPI process holds ~200MB normally but a malformed query or large response can spike to 1GB+. Postgres has `shared_buffers=128MB` (default). Linux OOM-killer picks the largest process — usually Postgres — and kills it. Backend still appears healthy, but every query now fails. Postgres takes 30s to restart, during which all writes are lost.

**How to avoid:**
1. Set explicit limits in `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       limits: { memory: 1G }
       reservations: { memory: 256M }
   ```
   Backend: 1G. Postgres: 1.5G. Caddy: 256M. Frontend (static, near zero): 128M.
2. Configure swap (single-VM POC justification: prefer slowness over OOM kills):
   ```bash
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   ```
   Add to `/etc/fstab`. Set `vm.swappiness=10` for Postgres-friendly behavior.
3. Tune Postgres for the VM: `shared_buffers=512MB`, `effective_cache_size=2GB`, `work_mem=16MB`. Don't use defaults sized for a laptop.

**Warning signs:**
- `dmesg | grep -i 'killed process'` shows Postgres or uvicorn entries.
- App returns 500s in bursts; recovers after ~30s; repeats.
- `free -h` shows 0 swap and 0 free memory at peak.

**Phase to address:** **Containerization phase** + **VM hardening phase**.

---

### Pitfall 13: SSH hardening missing — root login, no fail2ban, no ufw

**What goes wrong:**
Default Hetzner image has root SSH enabled with password (depending on provisioning choice). Within minutes of the IP being live, brute-force bots will be hammering port 22. If a weak password is set or root key is leaked, full compromise.

**How to avoid (cloud-init / ansible at provisioning):**
1. Disable root SSH: `/etc/ssh/sshd_config` → `PermitRootLogin no`, `PasswordAuthentication no`.
2. Create a non-root user with sudo, ssh-keys-only.
3. `ufw default deny incoming; ufw allow 22; ufw allow 80; ufw allow 443; ufw enable`.
4. Install `fail2ban` with sshd jail enabled (default is fine).
5. `unattended-upgrades` package configured for security updates only.
6. Optionally move SSH off port 22 (security theater but reduces log noise).

**Warning signs:**
- `journalctl -u ssh | grep -i 'failed password'` showing thousands of attempts.
- `fail2ban-client status sshd` showing many banned IPs.

**Phase to address:** **VM provisioning phase** — ideally as cloud-init `user_data` so the VM is hardened before its first SSH session.

---

### Pitfall 14: Time zone / NTP drift breaks JWT exp

**What goes wrong:**
JWT `exp` claim is a Unix timestamp. If the VM clock drifts (NTP not running), tokens get rejected as expired or accepted past their actual expiry. If the VM is in `Asia/Singapore` but the backend logs in UTC, log correlation gets confusing. JWT validation that uses `datetime.utcnow()` in the backend is fine if NTP is running; broken if not.

**How to avoid:**
1. `timedatectl set-timezone UTC` on the VM. Always use UTC server-side, even in SG.
2. Verify `chronyd` or `systemd-timesyncd` is enabled and synced: `timedatectl status` should show "System clock synchronized: yes".
3. In Postgres, set `timezone = 'UTC'` in `postgresql.conf`.
4. JWT validation: always `datetime.now(timezone.utc)`, never naive `datetime.now()`.

**Warning signs:**
- "Token expired" errors immediately after issuance.
- Logs show timestamps off by hours from `date -u`.

**Phase to address:** **VM provisioning phase**.

---

### Pitfall 15: GitHub Actions deploy leaks secrets via `set -x` or echo

**What goes wrong:**
A debug step like `run: echo "DEPLOY_KEY=$DEPLOY_KEY"` or a script with `set -x` will print secrets to the workflow log. GitHub auto-redacts known secret values, **but only exact matches** — base64-encoded, partial, or transformed values are *not* redacted. Public workflow logs (on a public repo) leak instantly.

**How to avoid:**
1. Never `echo` env vars in workflows. If debugging, mask: `echo "::add-mask::$VAR"` first.
2. Set workflow `permissions:` block to least privilege (default is overly permissive).
3. Use a deploy-only SSH key (separate from your dev key), with `command="..."` restriction in `~/.ssh/authorized_keys` on the VM to limit what the key can run.
4. GHCR PAT: use the auto-provisioned `GITHUB_TOKEN` with `packages: write` scope instead of a long-lived PAT.
5. **Don't disable host key checking** (`StrictHostKeyChecking=no`) — pin the host key in `known_hosts` from a trusted first-time SSH session, store in a secret, write it to `~/.ssh/known_hosts` in the workflow.
6. Add a CI lint step that fails if any workflow file contains `set -x` or `echo $.*SECRET`.

**Warning signs:**
- Workflow log contains plaintext base64 strings, IP addresses, hostnames.
- `gh secret list` shows secrets you forgot you created.

**Phase to address:** **CI/CD phase**.

---

### Pitfall 16: `docker compose down -v` deletes the database volume

**What goes wrong:**
`docker compose down` is fine. `docker compose down -v` deletes **named volumes** including the Postgres data volume. Run it on the VM to "clean up" → entire DB gone. If backups are bad (Pitfall 9), data is permanently lost.

**How to avoid:**
1. Aliased command in deploy script: `compose-restart` = `down --remove-orphans && up -d` (no `-v`).
2. Use bind mounts for the database (`./pgdata:/var/lib/postgresql/data`) — they survive `down -v`. **Trade-off:** bind mounts on slow disk can hurt Postgres perf on cheap VPS; named volumes are usually faster. For a single-dev POC the safety wins.
3. Document loudly in `README.md`: "**NEVER** run `docker compose down -v` on production."
4. Tested restore script that proves backups work — turns "I deleted the volume" from disaster into 15-min recovery.

**Warning signs:**
- `docker volume ls` no longer shows your `pgdata` volume.
- Postgres container starts a fresh `initdb` on next `up`.

**Phase to address:** **Containerization phase** + **Backup/recovery phase**.

---

### Pitfall 17: CORS breaks going from localhost to https domain

**What goes wrong:**
FastAPI dev had `CORSMiddleware(allow_origins=["*"])` or `["http://localhost:19006"]`. Deploy to `app.yourdomain.com`, frontend hits `api.yourdomain.com` → preflight fails, browser blocks, app appears completely broken with cryptic console errors.

**How to avoid:**
1. Make `CORS_ALLOWED_ORIGINS` env-driven, not hardcoded. Prod value: `https://app.yourdomain.com` (no trailing slash, exact match).
2. **Same-origin is simpler than CORS.** Serve frontend at `app.yourdomain.com/` and API at `app.yourdomain.com/api/` (Caddy handles the routing). Eliminates CORS entirely. Recommended for v2.0.
3. If using subdomains, ensure `Access-Control-Allow-Credentials: true` only if needed (JWT in `Authorization` header doesn't need credentials).
4. JWT in `Authorization: Bearer ...` header **always triggers preflight** (it's not a simple header). Allow `OPTIONS` and the `Authorization` header explicitly.

**Warning signs:**
- Browser console: `blocked by CORS policy: No 'Access-Control-Allow-Origin' header`.
- DevTools Network: OPTIONS request returning 400/500.

**Phase to address:** **Reverse proxy / routing phase** (decide same-origin vs cross-origin) + **Backend config phase**.

---

### Pitfall 18: Mixed content (http://) breaks under HTTPS

**What goes wrong:**
A hardcoded `http://` URL anywhere — image src, fetch, font CDN — gets blocked by browsers when the page is served over HTTPS. Wallet app likely has fewer of these than a content site, but the Frankfurter API integration is a candidate (`https://api.frankfurter.dev` — verify it's https, not http).

**How to avoid:**
1. Grep the codebase for `http://` literals, replace with `https://` or relative URLs.
2. Add CSP header `upgrade-insecure-requests` to force any `http://` to upgrade to `https://`.
3. Ensure the API itself never returns `http://` URLs in responses.

**Warning signs:**
- Browser console: `Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an insecure resource 'http://...'`.

**Phase to address:** **Pre-deploy audit / smoke-test phase**.

---

### Pitfall 19: PWA manifest missing maskable icons / wrong start_url

**What goes wrong:**
- Without a 192x192 *and* 512x512 PNG in the manifest, browsers don't show "Install" prompt.
- Without a `maskable` purpose icon, Android crops your logo into a circle and chops off the corners.
- Wrong `start_url` (e.g. relative path that resolves wrong from a sub-route) → installed app launches a 404.
- Missing `display: standalone` → install gives a Chrome tab, not a "real" app feel.
- Missing `theme_color` → status bar looks default/wrong.

**How to avoid:**
1. Manifest must have at minimum: `name`, `short_name`, `start_url: "/"` (absolute), `display: "standalone"`, `theme_color`, `background_color`, and an `icons` array with a 192x192 and 512x512 entry, and at least one with `"purpose": "maskable"`.
2. Test with Chrome DevTools → Application → Manifest tab — Lighthouse PWA audit catches all of these.
3. Test "Add to Home Screen" on a real Android device and a real iPhone before declaring PWA done.

**iOS-specific limitations to plan around:**
- No web push notifications (until iOS 16.4+, and even then only from installed PWA, not Safari tab).
- No background sync.
- 50MB storage cap historically (raised in newer iOS but still tight).
- Install UX is hidden — users must hit Share → Add to Home Screen. Document this in your help text.
- iOS PWAs lose state when backgrounded for long periods (the tab is purged).

**Warning signs:**
- Lighthouse PWA score < 90.
- Install button never appears in Chrome.
- Installed app launches to 404 or a blank screen.

**Phase to address:** **PWA phase**.

---

### Pitfall 20: Backups never restore-tested

**What goes wrong:**
pg_dump runs nightly, files appear in B2/R2, you feel safe. The day you need a restore, the dump is incomplete (Pitfall 9), encrypted with a lost key, or restoring it requires a DB version you don't have. "The backup that hasn't been restored isn't a backup."

**How to avoid:**
1. **Monthly drill (calendar reminder):** download the latest backup, restore it to a throwaway Postgres container locally, run a sanity query (`SELECT count(*) FROM transactions`). Document the steps.
2. Encrypt at rest in object storage (B2 has SSE; R2 supports encryption; pg_dump with `| age -e -r ...` is simpler). **Store the decryption key somewhere other than the VM.** If the VM is gone *and* the key was on it, the encrypted backup is useless.
3. Rotate: keep daily for 7 days, weekly for 4 weeks, monthly for 6 months. Don't accumulate forever (cost) or only keep last (risk).
4. Don't bake B2/R2 credentials into the Docker image. Pass via env file or runtime secret.
5. Run dump from a *separate* container/cron, not the same container that runs migrations — avoid the dump-mid-migration race.

**Warning signs:**
- Backup file size hasn't changed in days (probably failing silently).
- No one on the team can confidently restore from backup in under an hour.

**Phase to address:** **Backup phase** — restore test must be in the phase's exit criteria, not "we'll do it later."

---

## Technical Debt Patterns

Shortcuts that look fine for "first deploy" but compound.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| `:latest` image tags in compose | Easy to "always get newest" | Non-reproducible deploys; can't roll back; surprise breakage when upstream updates | **Never** in prod. Use `:sha-abc1234` from CI. |
| Build prod bundle locally | No CI to set up | Wrong env vars baked in (Pitfall 4); developer's node_modules state leaks into prod | Only for emergency hotfix, never as default workflow |
| Single `.env` file on VM, copy-pasted from notes | Fast to deploy | Drift between dev/prod; secrets in shell history; no audit | First weekend only — formalize before second deploy |
| Cron-based pg_dump with no monitoring | Simple, no extra service | You don't notice failures (Pitfall 20) | Acceptable if paired with healthchecks.io ping ($0/mo) |
| Single domain, no `api.` subdomain | One DNS record, no CORS | Locks you into same-origin; harder to split later | Acceptable and recommended for v2.0 (less complexity) |
| Self-signed cert "until I fix Caddy" | Page loads | PWA service worker requires HTTPS; users get scary warnings; install prompt won't trigger | **Never.** Use Caddy + LE staging endpoint instead. |
| Run migrations in FastAPI startup | "Just works" with one worker | Race conditions with workers (Pitfall 8); silent partial migrations | Only acceptable in dev. Never in prod. |
| Putting B2/S3 keys in image | "It works" | Image leaks → S3 keys leak → backups deletable by attacker | **Never.** Mount via env at runtime. |
| Skip `unattended-upgrades` because "I'll patch monthly" | No surprise reboots | You won't remember to patch; CVE in OpenSSH lingers for weeks | Never. Enable security-only upgrades; manual control over minor version bumps. |
| No staging environment, push straight to prod | Saves a VM | Every change is a prod experiment | Acceptable for single-dev POC if rollback is reliable (image SHA + DB backup) |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| **Caddy + Let's Encrypt** | Forgetting to persist `/data` volume | Named volume `caddy_data:/data` + `caddy_config:/config` |
| **Caddy + Cloudflare** | Leaving proxy on (orange cloud) during initial cert issuance | Grey cloud first, switch to orange after cert is in `/data` |
| **GitHub Actions + GHCR** | Using long-lived PAT with full scopes | Use built-in `GITHUB_TOKEN` with `packages: write` only |
| **GitHub Actions + SSH** | `StrictHostKeyChecking=no` | Pin host key from trusted first connection in repo secret |
| **Docker + Postgres** | Bind-mounting on slow disk causes Postgres I/O to crawl | Use named volumes by default; bind mounts only when restore-friendliness > performance |
| **Expo Web + Service Worker** | Cache-first on `index.html` and JS bundle | Network-first on HTML/bundles; never cache `/api/*` |
| **B2/R2 + pg_dump** | Streaming dump direct to bucket without local sanity check | Dump to `/tmp`, verify size > N bytes, encrypt, upload, delete local |
| **Frankfurter API** | Treating it as always available; no cache | Cache exchange rates daily (they don't change intraday); fall back to last-known on outage |
| **Domain registrar** | GoDaddy / Name.com — opaque renewal pricing, upsell traps | Cloudflare Registrar (at-cost) or Porkbun (transparent, cheap, good UX) |
| **Cloudflare DNS** | TTL set high (3600+) during initial setup makes iteration painful | Set TTL to 60s during setup; raise to 3600+ once stable |

---

## Performance Traps

For a wallet app at expected scale (1–10 active users for v2.0):

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Synchronous Frankfurter API call inside transaction create | Long create latency; cascading failures when Frankfurter is slow | Cache rates daily in DB; async fetch; fallback to last-known rate | Now — already exists in v1.0 |
| N+1 query loading transactions with sources/tags | List endpoint slow as transaction count grows | `selectinload`/`joinedload` in SQLAlchemy 2 | Visible at >100 transactions per user |
| No DB connection pooling tuning | Postgres connection limit hit under any concurrency | SQLAlchemy `pool_size=5, max_overflow=10`; FastAPI 1–2 workers (single VM doesn't need 4+) | Visible at >10 concurrent requests |
| Service worker caches API responses | Stale balance shown after a transaction | Network-first or no-cache for `/api/*`; bypass SW for API entirely | Immediately after first SW install |
| Postgres on default `shared_buffers=128MB` | Slow queries on a 4GB VM that should be fast | Tune to ~25% of available RAM (512MB-1GB) | Visible at any non-trivial dataset |
| Static assets not gzipped/brotli'd | Large JS bundle slow on mobile data | Caddy auto-handles compression; verify `Content-Encoding` header in DevTools | First mobile-network test |

---

## Security Mistakes

Beyond standard "use HTTPS, hash passwords":

| Mistake | Risk | Prevention |
|---|---|---|
| JWT in `localStorage` / `AsyncStorage` (existing) | XSS = full account takeover (no httpOnly protection) | Acceptable for SPA; mitigate with strict CSP, no `eval`, no inline scripts; consider rotating to refresh+access pattern in a future milestone |
| JWT secret in committed `.env.example` | Anyone who clones can forge tokens | Use placeholder in example; load from env on server only; rotate any leaked secret immediately |
| Long-lived JWT (e.g. 30 days) | Stolen token usable for a month | 1-hour access token + refresh-token rotation; or accept risk + add server-side blocklist for compromised tokens |
| `DEBUG=True` reaches prod | FastAPI shows stack traces with code/env to attackers | Already addressed in v1.0 — keep enforcement |
| CORS `allow_origins=["*"]` with credentials | Auth requests forgeable across origins | Specific origins only; credentials only when needed |
| Cloud-init `user_data` checked into a public repo | Often contains SSH keys, secrets | Use private repo, or template substitution at provision time |
| Postgres exposed on host port 5432 | Direct attack surface | Don't publish 5432; use Docker network only; backend connects via service name `db:5432` |
| Backups not encrypted at rest | B2/R2 admin or breach exposes financial data | Encrypt with `age`/`gpg` before upload; keep key off the VM |
| `ENVIRONMENT=production` not enforced | Dev-only routes (e.g. `/debug`) live in prod | Hard-coded route guards: `if settings.ENVIRONMENT != "production"` for any debug surface |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| No "app updated, reload" prompt for SW | Users stuck on stale version forever | Show a non-blocking banner when `registration.waiting` exists |
| iOS install UX hidden | Users don't know to do Share → Add to Home Screen | First-load banner on iOS Safari with screenshot of install steps |
| Auth token expires mid-session, app silently fails | User sees blank screen / cryptic error | Detect 401, redirect to login, restore route on success |
| Offline = white screen | App appears broken when on subway / spotty wifi | Minimal offline shell from SW (cached `index.html`), even if data is unreachable |
| Phone keyboard covers form fields | Users can't see what they're typing | Test on real device; use `KeyboardAvoidingView`; ensure transaction-create form is reachable |
| Currency selector loads slowly on first paint | Confusing flash of empty | Pre-fetch the 31 currencies on app boot or SW pre-cache the response |
| No loading indicator on transaction create | User taps twice → duplicate transaction | Disable submit button during pending; show spinner |

---

## "Looks Done But Isn't" Checklist

Use this as the **pre-deploy verification gate** — if any item is unchecked, don't deploy.

- [ ] **PWA:** Manifest has both 192x192 *and* 512x512 icons, with at least one `purpose: maskable`. `start_url: "/"` absolute. `display: standalone`. Lighthouse PWA score >= 90.
- [ ] **PWA:** Service worker has a kill-switch route deployed and tested (`/sw-killswitch.js` unregisters all SWs and clears caches).
- [ ] **PWA:** SW update flow shows a "reload to update" prompt when a new version is detected.
- [ ] **PWA:** API requests bypass the SW (verified in DevTools Network tab — no "(ServiceWorker)" annotation on `/api/*` responses).
- [ ] **HTTPS:** Cert was issued from production LE (not staging); padlock shows in browser; `curl -I https://yourdomain.com` returns 200.
- [ ] **HTTPS:** Auto-renewal verified by checking Caddy's `data/caddy/certificates/` and confirming a recent acme-renewal entry in logs.
- [ ] **DNS:** `dig +short yourdomain.com` returns the VM IP (not Cloudflare proxy IPs).
- [ ] **DNS:** AAAA record matches A record (or AAAA absent — IPv6-only edge cases).
- [ ] **Compose:** Every service has `restart: unless-stopped`. None have `restart: always`.
- [ ] **Compose:** Every service has a `healthcheck`. `depends_on` uses `condition: service_healthy`.
- [ ] **Compose:** Memory limits set for backend, db, frontend, caddy.
- [ ] **Compose:** Image tags pinned to SHAs, no `:latest`.
- [ ] **Migrations:** Run as a one-shot `migrate` service that completes before backend starts.
- [ ] **Migrations:** Deploy script refuses to run if `DATABASE_URL` doesn't match prod allowlist.
- [ ] **Backup:** Cron triggered last night; latest dump in B2/R2 has size > expected minimum.
- [ ] **Backup:** Restore test performed in last 30 days, documented, succeeded.
- [ ] **Backup:** Encryption key for backups stored OFF the VM.
- [ ] **VM:** SSH on key-only auth, root login disabled, fail2ban running, ufw enabled.
- [ ] **VM:** `unattended-upgrades` enabled for security only.
- [ ] **VM:** Swap configured (2GB minimum on a 4GB box).
- [ ] **VM:** NTP synced (`timedatectl` shows synchronized: yes).
- [ ] **VM:** Docker logging capped (10MB × 3 files); journald capped (500MB).
- [ ] **VM:** Disk usage < 60% after first deploy.
- [ ] **CI/CD:** No `set -x` or `echo $SECRET` patterns in workflows.
- [ ] **CI/CD:** SSH host key pinned in `known_hosts`.
- [ ] **CI/CD:** Deploy uses GHCR via `GITHUB_TOKEN`, not long-lived PAT.
- [ ] **CI/CD:** Deploy is idempotent (safe to re-run on the same SHA).
- [ ] **CI/CD:** Build-time check: prod bundle does not contain `localhost` or `http://`.
- [ ] **App:** `EXPO_PUBLIC_API_URL` in deployed bundle = `https://yourdomain.com/api` (not localhost).
- [ ] **App:** CORS origins env-driven, set to exact prod origin.
- [ ] **App:** Health endpoint returns 200; uptime monitor (healthchecks.io / UptimeRobot free) is pinging it.
- [ ] **App:** Tested install → use → close → reopen on real iPhone.
- [ ] **App:** Tested install → use → close → reopen on real Android phone.
- [ ] **App:** Tested behavior when offline (graceful, not white screen).

---

## Recovery Strategies

When prevention fails — these are the "OK, it happened, what now?" playbooks.

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Stale SW pinning bad URL | HIGH (per device) | Deploy kill-switch SW at known route; instruct users to visit `/clear-cache.html` which registers it; no other reliable fix |
| Wrong API URL baked in bundle | MEDIUM | Trigger CI rebuild with corrected env; redeploy; users hit Pitfall 1 unless SW update flow exists |
| LE rate limit hit | LOW (time) / HIGH (UX) | Wait 7 days OR purchase new domain. Use staging endpoint for any further testing in interim |
| Oracle Free instance reclaimed | MEDIUM | Try restart immediately; if "out of capacity," provision new VM (Hetzner SG fallback), restore boot-volume backup, update DNS |
| Postgres OOM-killed | LOW | Add memory limits + swap; restart Compose; check for orphaned long queries; consider reducing FastAPI workers |
| Disk full | MEDIUM | `docker system prune -af`; clear journald (`journalctl --vacuum-size=500M`); rotate Postgres logs; remove old pg_dumps |
| pg_dump version mismatch | LOW | Switch backup script to `docker compose exec db pg_dump`; restart cron |
| Cloudflare proxy breaks ACME | LOW | Toggle off proxy (grey cloud); wait 5 min; restart Caddy; switch back to proxy after cert issued (if desired) |
| `down -v` deleted DB | HIGH (if no backup) | Restore from latest pg_dump; replay any transactions from app logs since the dump |
| GitHub secrets leaked | HIGH | Rotate the secret immediately; audit access logs; rotate any keys derived from leaked value; check for unauthorized GHCR pulls |
| Migration applied to wrong DB | HIGH | Restore target DB from backup; investigate `alembic_version` table state; document what went wrong |
| CORS blocks all requests post-deploy | LOW | Update `CORS_ALLOWED_ORIGINS` env on VM; restart backend; verify with OPTIONS curl |
| iOS PWA loses state mid-session | LOW (UX) | Implement aggressive local persistence (IndexedDB); restore on reopen |

---

## Pitfall-to-Phase Mapping

This table is designed to drive **roadmap ordering**: each pitfall maps to the phase that owns its prevention. Phases with the most critical pitfalls should be sequenced earliest.

| # | Pitfall | Prevention Phase | Verification |
|---|---|---|---|
| 1 | Stale SW caches bad API URL | PWA phase | Lighthouse PWA audit + manual test: deploy SW v1, then SW v2, verify v2 takes over within 1 reload |
| 2 | Hetzner SG has no ARM | VM provisioning phase | Confirmed in milestone doc that primary = Hetzner SG **CPX21** (AMD), or fallback chosen explicitly |
| 3 | Oracle Free reclamation | VM provisioning phase | Decision recorded: PAYG conversion, NeverIdle script, or accept reclamation |
| 4 | Expo env vars baked at build | Frontend prod-build phase + CI/CD phase | CI step greps the bundle for `localhost` and fails build if found |
| 5 | Let's Encrypt rate limit | Reverse-proxy phase | Caddyfile defaults to staging; production endpoint enabled in a separate, deliberate commit |
| 6 | `restart: always` | Containerization phase | Compose lint: every service has `restart: unless-stopped` |
| 7 | `depends_on` race | Containerization phase | First boot after `compose up` succeeds without manual retry |
| 8 | Alembic worker race | Containerization phase + Deploy script phase | `migrate` is a separate service; deploy script has prod-DB allowlist |
| 9 | pg_dump version mismatch | Backup phase | Backup runs `docker compose exec db pg_dump`, version-locked to server |
| 10 | Cloudflare breaks ACME | DNS / domain phase | `dig` returns VM IP, not Cloudflare; cert issuance succeeds first try |
| 11 | Disk fills | Containerization + Backup + Monitoring phases | After 7 days uptime, `df -h` < 60%; log rotation verified |
| 12 | OOM kills Postgres | Containerization + VM hardening phases | `dmesg` clean of OOM events after 7 days; swap configured; mem limits set |
| 13 | SSH hardening | VM provisioning phase | Cloud-init applied; `nmap` from outside shows only 22/80/443; root SSH disabled |
| 14 | Time / NTP drift | VM provisioning phase | `timedatectl` shows synchronized; JWT round-trip works |
| 15 | GH Actions secret leakage | CI/CD phase | Workflow lint pass; no `set -x`; `GITHUB_TOKEN` only |
| 16 | `down -v` wipes DB | Containerization + Backup phases | Bind-mount or named-volume documented; restore-test passed |
| 17 | CORS breaks | Reverse-proxy phase + Backend config phase | Same-origin chosen (or CORS env-configured); curl OPTIONS returns 200 |
| 18 | Mixed content | Pre-deploy audit phase | `grep -r 'http://' src/` returns no production code hits |
| 19 | PWA manifest issues | PWA phase | Lighthouse PWA score >= 90; install tested on real iPhone + Android |
| 20 | Backups never restore-tested | Backup phase | Restore-test calendar reminder set; first restore-test completed and documented |

**Suggested phase ordering (informed by this mapping):**

1. **VM provisioning + hardening** (pitfalls 2, 3, 13, 14)
2. **Containerization** (pitfalls 6, 7, 8, 11, 12, 16)
3. **DNS + domain** (pitfall 10)
4. **Reverse proxy + HTTPS** (pitfalls 5, 17)
5. **Frontend prod build** (pitfall 4)
6. **PWA layer** (pitfalls 1, 19)
7. **Backup + restore** (pitfalls 9, 20)
8. **CI/CD** (pitfalls 4, 15)
9. **Pre-deploy audit + smoke test** (pitfalls 18, all)
10. **Monitoring + uptime** (pitfall 11 long-tail)

The PWA phase (pitfall 1, top risk) lands *after* the API is reachable at the right URL, so the SW caches a working app from day one. The Frontend prod build phase ahead of PWA is intentional — getting the right `API_URL` baked in matters before the SW is allowed to cache anything.

---

## Sources

- [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/) — official 50/week + 5 duplicate/week limits
- [Let's Encrypt Staging Environment](https://letsencrypt.org/docs/staging-environment/) — use this for testing
- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https) — official ACME behavior
- [Caddy + Cloudflare proxy issue](https://caddy.community/t/solved-caddy-and-lets-encrypt-cloudflare-dns-challenge-not-working/23728) — community thread on HTTP-01 + proxy
- [Hetzner Cloud Review 2026 — Better Stack](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/) — confirms CAX is EU-only
- [Hetzner Cloud (regular performance)](https://www.hetzner.com/cloud/regular-performance) — region/shape availability matrix
- [Hetzner Cost-Optimized plans (CAX EU only)](https://www.hetzner.com/cloud/cost-optimized) — CAX availability
- [Oracle Always Free FAQ](https://www.oracle.com/cloud/free/faq/) — official reclamation policy
- [Oracle Cleaning Up Idle Compute Instances + LookBusy script](https://blog.51sec.org/2023/02/oracle-cloud-cleaning-up-idle-compute.html) — workaround scripts
- [LowEndTalk: Oracle reclamation reports](https://lowendtalk.com/discussion/184161/oracle-may-reclaim-your-idle-vps) — community experience
- [Oracle Reclamation of Idle Compute Instances](https://community.oracle.com/customerconnect/discussion/671904/reclamation-of-idle-compute-instances) — Oracle Customer Connect thread
- [Expo Environment Variables — official docs](https://docs.expo.dev/guides/environment-variables/) — `EXPO_PUBLIC_` build-time inlining
- [Expo EAS env vars FAQ](https://docs.expo.dev/eas/environment-variables/faq/)
- [Docker restart policies — official](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [Baeldung — Compose restart policies](https://www.baeldung.com/ops/docker-compose-restart-policies)
- [DigitalOcean — pg_dump version mismatch](https://docs.digitalocean.com/support/how-do-i-fix-the-pg_dump-aborting-because-of-server-version-mismatch-error/)
- [Heroku — pg_dump server version mismatch](https://help.heroku.com/PK20R6U8/why-am-i-seeing-a-server-version-mismatch-error-when-restoring-a-postgres-database-with-pg_dump)
- [Alembic in CI/CD — StackLesson](https://www.stacklesson.com/react-fastapi/fastapi-alembic/ch25-lesson-05-alembic-in-ci-cd/) — migration race condition pattern
- [Taming PWA Cache Behavior — Infinity Interactive](https://iinteractive.com/resources/blog/taming-pwa-cache-behavior) — stale SW recovery
- [PWA Update — web.dev](https://web.dev/learn/pwa/update) — official SW update lifecycle

---

*Pitfalls research for: First-time production deploy + PWA layer for FastAPI + Expo on a single VPS*
*Researched: 2026-05-02*
