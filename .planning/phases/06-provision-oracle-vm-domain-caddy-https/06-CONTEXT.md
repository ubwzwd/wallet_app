# Phase 6: Provision Oracle VM + Domain + Caddy HTTPS - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Take the local-laptop production stack (Phase 4 `infra/docker-compose.prod.yml`) and put it on the public internet on an Oracle Cloud Always Free A1.Flex VM (Ubuntu 24.04, ARM64). Deliverables: a registered domain pointing at the VM, a working Let's Encrypt production certificate, a hardened VM per SEC-02 baseline, a `/health` endpoint formally verified DB-independent, an UptimeRobot monitor on `/health` with one alert email drilled successfully, and an `infra/RUNBOOK.md` an operator can follow end-to-end in under 60 minutes to re-provision the VM from scratch.

**In scope:** Oracle Cloud console provisioning (compartment, VCN/subnet, A1.Flex instance, security list, reserved public IP) — instance does not exist yet; Cloudflare Registrar domain purchase + Cloudflare DNS grey-cloud A record + `dig +short` confirm; SSH hardening (port 23333, key-only, fresh ed25519 key); ufw with three ports only; `deploy` user with NOPASSWD sudo; Docker + Compose v2 install on Ubuntu 24.04 ARM64; `unattended-upgrades` for security updates only; first-time deploy of the existing prod compose stack to the VM; Caddy env swap to real domain (`CADDY_DOMAIN`, drop `CADDY_TLS_MODE`) using Let's Encrypt staging endpoint first, then a deliberate separate commit flipping to production endpoint; HSTS directive in `Caddyfile` (`max-age=31536000; includeSubDomains`, no preload — DOMAIN-03); narrowing `ALLOWED_ORIGINS` from `https://localhost` to the real prod domain; one UptimeRobot HTTPS monitor on `/health` with email alert, drilled by `docker compose stop caddy`; `infra/RUNBOOK.md` (pure markdown, copy-paste blocks).

**Out of scope (other phases or milestones):** CI/CD, GHCR image push, zero-downtime `docker rollout`, automated deploy from `main` — Phase 7. Daily `pg_dump` backups + restore drill — Phase 7. Slack/Discord deploy webhook — Phase 7. fail2ban, IP-restricted SSH, change-only-by-bastion — deferred to a later "harden production" milestone per user direction. Cloudflare orange-cloud proxy + DDoS — deferred (would require custom Caddy build with `caddy-dns/cloudflare` plugin and DNS-01 challenge; not needed for v2.0). Cert-expiry monitor and root-URL monitor — deferred (Caddy auto-renews every 60 days; single `/health` monitor is sufficient signal). SMS/webhook alert channels — paid UptimeRobot tier, deferred. Sentry / log aggregation / Loki / Grafana — explicitly out of v2.0 per PROJECT.md.

</domain>

<decisions>
## Implementation Decisions

### Domain Registration & DNS

- **D-01:** Register the domain with **Cloudflare Registrar** during this phase. At-cost pricing, no markup, no upsells; pairs naturally with Cloudflare DNS (registrar mandates Cloudflare nameservers). The specific domain name is **not pre-decided** — operator picks at registration time. Runbook treats it as a placeholder `<your-domain>` and only requires that the chosen TLD is on Cloudflare Registrar's supported list (`.com`, `.net`, `.org`, `.io`, `.dev`, `.app`, `.co`, etc. — verify in the dashboard before purchase).
- **D-02:** DNS is hosted at **Cloudflare DNS** (forced by D-01). Create a single `A` record `@ → <VM-public-IP>` (apex). No `www` subdomain in this phase (deferred — apex is sufficient).
- **D-03:** Cloudflare proxy is **OFF (grey cloud / DNS only)** on the A record. Cloudflare answers DNS queries with the VM's real IP; traffic goes direct to the VM. This keeps the stock `caddy:alpine` image viable (no custom build with DNS plugin) and lets Caddy use the default HTTP-01 challenge on port 80 for Let's Encrypt. The orange-cloud flip is documented as a future option in `Deferred Ideas`.
- **D-04:** **DOMAIN-01 → DOMAIN-02 ordering is enforced procedurally in the runbook**: the A record must be created and `dig +short <your-domain>` must return the VM's public IP **before** the first `docker compose up` that brings Caddy online with the real `CADDY_DOMAIN`. This is restated in `infra/RUNBOOK.md` as a hard prerequisite block — skipping it burns Let's Encrypt issuance attempts.
- **D-05:** **Let's Encrypt staging endpoint first, then a separate commit flips to production** (preserved from ROADMAP). The Caddyfile gains a new optional directive `acme_ca {$CADDY_ACME_CA}` (or equivalent — planner picks the exact Caddy v2 syntax: `acme_ca` is a global option, alternatively `tls { issuer acme { ca ... } }` in the site block). `.env` on the VM starts with `CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`. After staging-cert success is observed end-to-end, a **separate, deliberate commit** removes the override (or sets it to the production URL), and Caddy is restarted to fetch the prod cert. The two-commit pattern is a hard requirement, not a convention — the runbook calls this out explicitly.

### VM Provisioning (Oracle Cloud)

- **D-06:** Oracle Cloud account exists and is Always Free eligible. **No instance has been created yet** — Phase 6 includes the full Oracle console click-through. Runbook documents: select compartment (root or new `wallet-app`), create VCN with public subnet + internet gateway, reserve a public IP, create A1.Flex instance (Ubuntu 24.04 Minimal, 2 OCPU / 12 GB RAM — Always Free shape), attach the reserved public IP, set security list to allow 23333/80/443 inbound from anywhere (ufw is the real enforcement — the security list is a redundant outer layer).
- **D-07:** Region is **whichever has Ampere A1.Flex capacity at provisioning time** (PROJECT.md notes Singapore as a preference). A1.Flex capacity is notoriously hard to get — the runbook includes a short "if Out of Capacity" subsection: retry script pattern, alternate regions to try (Phoenix / Tokyo / Mumbai are commonly cited as having better availability than Singapore), and a note that capacity reservations require a paid account (not an option here).
- **D-08:** OS image: **Ubuntu 24.04 LTS Minimal** (ARM64). Minimal because we install only what we need (Docker, Compose v2). Matches the platform target of the arm64-only backend image from Phase 4.

### SSH & Deploy User

- **D-09:** Generate a **fresh ed25519 keypair** dedicated to this VM: `ssh-keygen -t ed25519 -C wallet-app-oracle -f ~/.ssh/wallet_app_oracle` (no passphrase, or operator-chosen passphrase — runbook leaves it open). Public key pasted into the Oracle console at instance-create time for the default `ubuntu` user; copied to `/home/deploy/.ssh/authorized_keys` during hardening. Operator adds a `Host wallet-app` block to `~/.ssh/config` with `HostName <ip>`, `User deploy`, `Port 23333`, `IdentityFile ~/.ssh/wallet_app_oracle`, so `ssh wallet-app` is the only command they need to remember.
- **D-10:** **Deploy user is named `deploy`** with **NOPASSWD sudo**. `usermod -aG sudo,docker deploy`, `/etc/sudoers.d/deploy` contains `deploy ALL=(ALL) NOPASSWD:ALL`. Rationale: Phase 7's GitHub Actions SSH-deploy step cannot hang waiting for a sudo password, and SSH is key-only (no reachable password from outside anyway). Phase 7 will SSH in as `deploy` with the same key (or a deploy-scoped key — Phase 7 decides).
- **D-11:** **SSH on port 23333** (not 22). `sshd_config`: `Port 23333`, `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PubkeyAuthentication yes`. ufw rule: `ufw allow 23333/tcp`. Runbook step ordering critical: open 23333 in ufw and verify `ssh -p 23333` works **before** running `ufw deny 22` (otherwise lock-out). Oracle security list must also allow 23333; runbook calls this out before the ufw step.
- **D-12:** **ROADMAP Phase 6 Success Criterion 3 is amended**: literal text "ufw allows only 22/80/443" → "ufw allows only 23333/80/443" (intent preserved — three ports, only deploy/web reachable). This amendment is captured in CONTEXT.md and the planner's PLAN.md will reflect it; the literal ROADMAP text will be updated by the planner or executor as a trivial edit during this phase, not via a separate ROADMAP-edit ceremony.

### VM Hardening (SEC-02 baseline only)

- **D-13:** **No fail2ban, no IP-restricted SSH, no other extras** beyond the ROADMAP-mandated baseline: ufw with three ports only, key-only SSH on 23333, `unattended-upgrades`, non-root deploy user with NOPASSWD sudo. fail2ban is **explicitly deferred to a later milestone** ("harden production") — user-requested.
- **D-14:** **`unattended-upgrades` configured for security updates only** (Ubuntu 24.04 default). `/etc/apt/apt.conf.d/50unattended-upgrades` allows only `${distro_id}:${distro_codename}-security`; `/etc/apt/apt.conf.d/20auto-upgrades` enables `APT::Periodic::Unattended-Upgrade "1"`. Auto-reboot is **disabled** (`Unattended-Upgrade::Automatic-Reboot "false"`) — kernel updates wait for a manually-triggered reboot at a convenient time. This is a deliberate trade-off: stability > zero-touch security. Operator notes any deferred reboots and runs `sudo reboot` during a maintenance window.
- **D-15:** **External port scan from outside the VM** (`nmap -Pn -p 1-65535 <ip>` run from the operator's laptop) is part of the Phase 6 verification — must show only 23333 (filtered or open), 80, and 443 reachable. Runbook documents the exact `nmap` invocation expected.

### RUNBOOK Shape

- **D-16:** **`infra/RUNBOOK.md` is pure markdown with copy-paste blocks**, not a shell script. Top-to-bottom human-readable: prerequisites → register domain → provision VM → first SSH → harden → install Docker → clone repo → write `.env` → bring up stack (staging LE) → verify → flip to prod LE → set up monitoring → run downtime drill. Each command block shows the expected output / sanity check so the operator knows when to proceed. Idempotent shell scripts under `infra/scripts/` are **explicitly deferred** to a later milestone (would pay back if VM rebuilds become frequent — they currently don't).
- **D-17:** **Runbook must support sub-60-minute end-to-end re-provision** (ROADMAP SC2). The first run-through during Phase 6 will be slower (Oracle capacity hunting, domain registration), but the runbook is timed and refined on subsequent dry-runs so a clean re-provision (domain already owned, key already generated) clocks in under 60 minutes.

### `/health` DB-Independence (OPS-01)

- **D-18:** The existing `GET /health` endpoint at [backend/app/main.py:33-40](backend/app/main.py#L33-L40) is **already DB-independent** by construction (no DB call). Phase 6 adds the **formal verification** required by ROADMAP SC4: with the prod stack running on the VM, `docker compose stop db`, then `curl https://<your-domain>/health` from the operator's laptop must return `200 OK` with the standard JSON body in under 100ms. Restore: `docker compose start db`. This verification step is in the runbook and the phase plan's verification section. **No code change is required** in `backend/app/main.py`.

### HSTS

- **D-19:** **HSTS directive added to the `Caddyfile` site block in this phase** (DOMAIN-03, deferred from Phase 4 D-11). Directive: `header Strict-Transport-Security "max-age=31536000; includeSubDomains"` — exactly the ROADMAP-specified value, **no preload** (preload would require explicit submission to the Chrome HSTS preload list, which is irreversible and out of scope). Added to the same site block as the existing handlers in `infra/Caddyfile`. Becomes active automatically after the LE prod-cert flip in D-05.

### `ALLOWED_ORIGINS` Narrowing (DOMAIN-04 defense-in-depth)

- **D-20:** On the VM's `.env`, **`ALLOWED_ORIGINS=https://<your-domain>`** (not `https://localhost`). Defense-in-depth: same-origin via Caddy already eliminates CORS preflights for normal traffic, but the FastAPI CORS allowlist remains as a second line in case Caddy's `handle /api/*` route is ever misconfigured or bypassed. Runbook's `.env`-authoring step calls this out.

### Monitoring & Alert Drill

- **D-21:** **UptimeRobot account sign-up happens during Phase 6** (operator does not yet have one). Free tier — no card required. Add a single **HTTPS monitor** on `https://<your-domain>/health` with the default 5-minute interval. Alert contact: a personal email address that the operator adds at monitor-creation time (not baked into the runbook — runbook step says "add your email, verify the inbound `Please verify` email"). Skip SMS/webhook (paid).
- **D-22:** **Deliberate downtime drill (ROADMAP SC5):** SSH to VM as `deploy`, `cd infra && docker compose stop caddy`, wait up to 5 minutes for UptimeRobot's next check and the alert email to arrive, **screenshot the alert email** (filed under `infra/runbook-evidence/uptime-alert.png` — gitignored or LFS, depending on size; planner picks), then `docker compose start caddy` and confirm UptimeRobot returns to "Up" within one cycle. The screenshot is the verification artifact for SC5; absence of it fails the phase.
- **D-23:** **Single `/health` monitor only.** No separate TLS-cert-expiry monitor, no root-URL monitor. Caddy auto-renews LE certs every 60 days from the saved ACME account/state on the named volume; a separate cert-expiry monitor adds noise without information the `/health` monitor wouldn't already give us if Caddy stopped serving HTTPS. Extra monitors are deferred to a later milestone.

### Claude's Discretion

- Exact Caddy v2 syntax for switching ACME endpoints (global `acme_ca` option vs site-block `tls { issuer acme { ca ... } }`) — planner picks based on current Caddy v2 documentation. Researcher to confirm via Context7.
- Whether to use a Caddy named volume for `/data` (ACME state, cert storage) as `wallet_caddy_data`, or to bind-mount a path on the VM filesystem (`/var/lib/wallet-caddy`). Named volume is the standard pattern; planner decides. Either way the cert state must survive container recreation.
- Exact ufw rule ordering (rules vs `default deny incoming`) — planner picks the safest sequence in the runbook.
- Whether the LE-prod-flip commit also bumps Caddy's `acme_ca` directive to the explicit prod URL or simply removes the override (defaulting to LE prod) — researcher to confirm Caddy v2 default.
- Oracle VCN/subnet/security-list naming — planner picks defaults that don't collide with anything else in the tenancy.
- Whether `infra/runbook-evidence/` is gitignored or LFS-tracked for the UptimeRobot screenshot — planner picks based on file size + repo conventions.
- Exact wording of the runbook's "if A1.Flex capacity is Out" sub-section — planner decides on the retry-loop tactic (`oci compute instance launch` retry script vs manual console retry).
- Whether the LE-prod swap is a manual commit by the operator after staging verification, or a step the runbook drives (the runbook can stop and say "verify staging cert, then make this commit and run this command" — same outcome). Planner picks the more operator-friendly phrasing.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements
- [.planning/ROADMAP.md](.planning/ROADMAP.md) §"Phase 6" — Goal, success criteria 1–5, requirements list (DEPLOY-05, DOMAIN-01, DOMAIN-02, DOMAIN-03, SEC-02, OPS-01, OPS-02). **Note D-12 amends SC3 literal text to `23333/80/443`.**
- [.planning/ROADMAP.md](.planning/ROADMAP.md) §"Critical Pitfall Mitigations Baked Into Phase Ordering" — Caddy auto-HTTPS-requires-DNS-first (DOMAIN-01→DOMAIN-02), Let's Encrypt rate-limit (5 prod issuances/domain/week → staging-first pattern), Postgres tuning for Oracle 20% idle-reclaim (already locked in Phase 4).
- [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md) — locked statements for DEPLOY-05, DOMAIN-01, DOMAIN-02, DOMAIN-03, SEC-02, OPS-01, OPS-02; also DOMAIN-04 (defense-in-depth CORS allowlist narrowing → D-20).
- [.planning/PROJECT.md](.planning/PROJECT.md) §"Current Milestone: v2.0 Single-VPS Deployment" — target features, Oracle A1.Flex shape, Singapore-region preference, "no native EAS / no Sentry/Loki/Grafana" exclusions.

### Carry-forward From Phase 4 (the prod stack this phase is deploying)
- [.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md](.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md) D-10 — Caddyfile is env-var-driven (`{$CADDY_DOMAIN:localhost}`, `tls {$CADDY_TLS_MODE:internal}`). **Phase 6 swap = set `CADDY_DOMAIN=<your-domain>`, unset `CADDY_TLS_MODE` (drop the default `internal`), and add `acme_ca` for staging→prod flow.**
- [.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md](.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md) D-11 — HSTS deferred to this phase; add to the same site block as D-19.
- [.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md](.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md) D-17 — `infra/.env` is gitignored; `chmod 600` enforcement is the VM-side responsibility — **this phase enforces it on the VM**.
- [.planning/phases/04-containerize-and-compose-locally/04-VERIFICATION.md](.planning/phases/04-containerize-and-compose-locally/04-VERIFICATION.md) — Two human-UAT items pending (CORS preflight in real browser, first-time TLS warning). The real-LE-cert deployment in this phase **eliminates the TLS-warning UAT item**; the CORS-preflight check should be re-run against the deployed `https://<your-domain>/api/*` to close it out. Planner folds this into the Phase 6 verification step.

### Existing Code & Infra (must be modified or referenced)
- [infra/Caddyfile](infra/Caddyfile) — Existing env-var-driven Caddyfile from Phase 4. Phase 6 adds the HSTS `header` directive and `acme_ca` directive (or equivalent) per D-05 and D-19; otherwise unchanged structurally.
- [infra/.env.example](infra/.env.example) — Source of truth for env vars. Phase 6 adds `CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` (as a documented optional override; production default = empty / prod LE).
- [infra/docker-compose.prod.yml](infra/docker-compose.prod.yml) — Existing prod compose stack from Phase 4. Phase 6 deploys this **unmodified** to the VM (modulo the Caddyfile/env changes above). No new services.
- [infra/Dockerfile.api](infra/Dockerfile.api) — arm64-only API image from Phase 4. Phase 6 builds it on the VM (`docker compose build api`) or pulls it (Phase 7 will introduce GHCR push); for Phase 6, build-on-VM is the runbook step.
- [backend/app/main.py:33-40](backend/app/main.py#L33-L40) — Existing `GET /health` endpoint, already DB-independent. Phase 6 **does not modify this** — only verifies via the `docker compose stop db` test (D-18).
- [backend/app/core/config.py](backend/app/core/config.py) — pydantic-settings `Settings`. Reads `ALLOWED_ORIGINS`; the VM's `.env` sets it to `https://<your-domain>` per D-20.
- [.gitignore](.gitignore) — Already excludes `infra/.env` from Phase 4. Phase 6 may add `infra/runbook-evidence/*.png` if the planner picks gitignore over LFS for the UptimeRobot screenshot.

### Codebase Maps
- [.planning/codebase/STACK.md](.planning/codebase/STACK.md) — Tech stack (FastAPI 0.109+, PostgreSQL 15, Caddy, Docker Compose v2).
- [.planning/codebase/STRUCTURE.md](.planning/codebase/STRUCTURE.md) — Repo layout; `infra/` is the home for all deployment artifacts (RUNBOOK.md sits there).
- [.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md) — Known concerns to cross-check against.
- [.planning/codebase/INTEGRATIONS.md](.planning/codebase/INTEGRATIONS.md) — External integrations (Frankfurter — unrelated here, but a useful pattern reference for third-party API failure handling).

### External Documentation (researcher to fetch via Context7 / WebFetch)
- **Caddy v2** — Caddyfile syntax for: `acme_ca` global option vs site-block `tls { issuer acme { ca ... } }`; `header Strict-Transport-Security` directive; default ACME endpoint behavior on production LE; `/data` volume layout for cert persistence; HTTP-01 challenge requirements (port 80 must be reachable from LE servers — confirms Oracle security list + ufw allow 80).
- **Let's Encrypt** — Staging vs production endpoints (URLs, certificate trust paths); production rate limit (5 issuances per domain per week — D-05 mitigation); ACME account state portability (so a VM rebuild doesn't lose the account).
- **Cloudflare Registrar** — Supported TLD list (for D-01 verification at registration time); registrar lock period for new registrations (60-day ICANN lock — doesn't affect us since we're registering, not transferring).
- **Cloudflare DNS** — Grey-cloud vs orange-cloud semantics on an A record; TTL defaults (auto = 300s — fine for our use).
- **Oracle Cloud Infrastructure (OCI)** — Always Free A1.Flex shape spec (2 OCPU / 12 GB RAM / 200 GB block storage); VCN + subnet + security list creation flow; reserved public IP attach flow; capacity-availability tactics for A1.Flex (region-hopping, retry patterns).
- **Ubuntu 24.04** — `unattended-upgrades` configuration (`/etc/apt/apt.conf.d/50unattended-upgrades`, `20auto-upgrades`); `ufw` rule ordering on a fresh install; OpenSSH `sshd_config` syntax for `Port`, `PasswordAuthentication`, `PermitRootLogin`, `PubkeyAuthentication`.
- **Docker Engine + Compose v2 on ARM64 Ubuntu 24.04** — Official install instructions (apt repo, GPG key, `docker.io` group, `docker compose` v2 plugin).
- **UptimeRobot free tier** — HTTPS monitor type, 5-minute interval limit, email-only alert channel on free tier, signup flow without credit card.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- [infra/Caddyfile](infra/Caddyfile) — Already env-var-driven (`{$CADDY_DOMAIN:localhost}`, `tls {$CADDY_TLS_MODE:internal}`); Phase 4 D-10 designed this exact swap. Phase 6 adds two directives (HSTS header, ACME CA override) and changes two env vars. No structural changes.
- [infra/.env.example](infra/.env.example) — Already contains `CADDY_DOMAIN=localhost` + `CADDY_TLS_MODE=internal`. Phase 6 adds one new variable (`CADDY_ACME_CA`) and documents the production override values in the example comments.
- [infra/docker-compose.prod.yml](infra/docker-compose.prod.yml) — Deploys unmodified to the VM. The `migrate` service (Phase 4 D-13) handles `alembic upgrade head` before the API takes traffic; this works identically on the VM.
- [backend/app/main.py:33-40](backend/app/main.py#L33-L40) — `GET /health` is already DB-independent by construction. No code change.
- [backend/Dockerfile](backend/Dockerfile) → [infra/Dockerfile.api](infra/Dockerfile.api) — Phase 4 already built the arm64-only image. The VM is arm64, so the image runs natively (no QEMU emulation, no multi-arch manifest).

### Established Patterns
- **Env-var-driven config** (Phase 4): every environment-specific value is in `.env`; never hard-coded. Phase 6 preserves this — domain, ACME endpoint, allowed origins, deploy paths all read from `.env`.
- **Two-step deliberate-commit pattern for risky operations** (LE staging→prod, Phase 4 frontend config swap): Phase 6 reuses this for the LE-prod flip.
- **`infra/` is the home for all deployment artifacts** (Phase 4 D-01): RUNBOOK.md sits in `infra/`, not in repo root or `docs/`.
- **Procedural ordering enforcement** (Phase 4 D-13's migrate-before-API via `depends_on: condition: service_completed_successfully`): Phase 6's DOMAIN-01-before-DOMAIN-02 is the analog at the runbook layer — restated as a prerequisite block in markdown rather than encoded in compose.

### Integration Points
- **Oracle Cloud console → VM** — Operator clicks; nothing in repo orchestrates this. Runbook is the only artifact.
- **Cloudflare dashboard → DNS A record** — Operator clicks; nothing in repo orchestrates this. Runbook captures the exact field values.
- **Operator's laptop → VM via SSH on 23333** — `~/.ssh/config` snippet in runbook makes `ssh wallet-app` the canonical command.
- **Runbook → repo on VM** — `git clone` step. The VM has a working tree of the repo; `git pull` is how subsequent deploys would happen in Phase 6 (Phase 7 replaces this with GHCR pull + `docker compose pull && up -d`).
- **Caddy on VM → Let's Encrypt** — Outbound HTTPS to ACME servers; Caddy needs port 80 inbound for HTTP-01 challenge. Both ufw and Oracle security list must allow 80.
- **UptimeRobot probe servers → `https://<your-domain>/health`** — Inbound HTTPS from UptimeRobot IPs (we don't whitelist them — public open path, fine).
- **`.env` on VM → compose services** — Same `env_file:` pattern as laptop. The single new thing is `chmod 600 /home/deploy/wallet_app/infra/.env` after authoring it (SEC-01 enforcement on the VM, deferred from Phase 4 D-17).

</code_context>

<specifics>
## Specific Ideas

- **"I have the OCI's Always Free-eligible"** (user, verbatim) — clarified to mean account exists + A1.Flex eligibility confirmed, but no instance yet. Drove D-06: Phase 6 includes Oracle console click-through.
- **"is 2333 a safe port?"** / **"Or use 23333?"** (user, verbatim) — drove D-11: SSH on 23333, with the noted caveat that port choice is noise reduction, not real security. Real security is key-only auth (D-09) + (later) fail2ban (deferred).
- **"We can consider to add the fail2ban as an optional improvement in later milestones"** (user, verbatim) — drove D-13: explicit deferral of fail2ban to a later "harden production" milestone. Documented in `Deferred Ideas` so the v3.0 or "harden" milestone planner picks it up.
- **"I will decide when register the domain"** (user, verbatim) — drove D-01: runbook uses `<your-domain>` placeholder, domain name not pre-decided. The runbook is therefore portable: someone else could follow it with a different domain and get the same result.
- **Grey cloud chosen over orange cloud** — the simpler path was preferred. The orange-cloud option is genuinely deferred (not "rejected") — D-03 + Deferred Ideas document the trade-off so future-us can flip it without re-discussing.

</specifics>

<deferred>
## Deferred Ideas

- **fail2ban** → later milestone (post-v2.0 "harden production"). Public-internet SSH on a non-standard port + key-only auth gives us a reasonable baseline; fail2ban is the natural next step when log noise / login-attempt-rate analysis warrants it. User-explicitly deferred.
- **Cloudflare orange-cloud proxy + WAF + DDoS protection** → later milestone. Would require: rebuilding Caddy with `caddy-dns/cloudflare` plugin (custom Dockerfile), switching ACME challenge to DNS-01, storing a CF API token in `.env`, and re-doing the LE cert dance under the new challenge type. Currently no DDoS pressure; revisit when traffic or threat model justifies it.
- **TLS-cert-expiry monitor (separate UptimeRobot monitor type SSL)** → later milestone. Caddy auto-renews; redundant for now.
- **Root-URL / homepage monitor** → later milestone. Frontend-bundle regressions are caught by Phase 5's `verify:phase5` script in Phase 7's CI; runtime monitoring adds noise more than signal at this scale.
- **SMS / webhook alert channels (Slack/Discord)** → Phase 7 covers Slack/Discord webhooks for **deploy notifications** (DEPLOY-06); for uptime alerts specifically, paid UptimeRobot tier or alternative free tier (HealthChecks.io supports webhooks free) → deferred to a later milestone.
- **Idempotent provisioning scripts (`infra/scripts/provision.sh` etc.)** → later milestone. Would pay back if VM rebuilds become frequent; currently this is a one-time provisioning event.
- **IP-restricted SSH (`ufw allow from <home-IP> to any port 23333`)** → later milestone, if at all. Awkward for solo dev on a residential ISP.
- **Auto-reboot for kernel updates from `unattended-upgrades`** → not enabled by D-14. If reboot cadence becomes a problem, revisit by setting `Unattended-Upgrade::Automatic-Reboot "true"` with a maintenance-window schedule.
- **`www` subdomain redirect** → not in Phase 6. Apex-only deployment. If desired later, add a CNAME `www → @` in Cloudflare DNS + a `www.<domain>` site block in Caddy that 301s to apex. Trivial follow-up.
- **HSTS preload submission** → never (irreversible). Stays out of the directive (per D-19).
- **Cert state backups (separate to-be-restored artifact)** → relies on the Caddy `/data` named volume + Caddy's own ACME state. Phase 7's daily backups can be widened to include this volume; currently not in Phase 7 scope either.
- **Capacity reservation for A1.Flex** → requires paid OCI account; out of scope for Always Free.

</deferred>

---

*Phase: 06-provision-oracle-vm-domain-caddy-https*
*Context gathered: 2026-05-25*
