# Phase 6: Provision Oracle VM + Domain + Caddy HTTPS - Research

**Researched:** 2026-05-25
**Domain:** Cloud provisioning + DNS + TLS + VM hardening (Caddy / Let's Encrypt / Oracle Cloud / Ubuntu 24.04 / UptimeRobot)
**Confidence:** HIGH (Caddy + LE + Docker + UFW), MEDIUM (Oracle Cloud capacity tactics + UptimeRobot ToS), HIGH (Ubuntu 24.04 ssh.socket + unattended-upgrades — confirmed via official Ubuntu docs)

## Summary

Phase 6 is a **provisioning + runbook** phase, not a code phase. The single new code surface area is the `infra/Caddyfile` (two added directives: `acme_ca` and HSTS `header`), the single env-var addition is `CADDY_ACME_CA`, and the single doc deliverable is `infra/RUNBOOK.md`. Everything else is operator click-through (Oracle console, Cloudflare dashboard, UptimeRobot signup) captured as copy-paste markdown blocks per D-16.

Three findings dominate the planner's decisions: **(1)** Caddy v2's global `acme_ca` directive is the idiomatic env-var-driven swap — `acme_ca {$CADDY_ACME_CA}` in the global block, with the empty/unset default falling through to **Let's Encrypt + ZeroSSL production** (so the "prod flip commit" simply removes the env var or sets it empty — no need to hard-code the prod URL). **(2)** Let's Encrypt's *Certificates per Registered Domain* limit was raised to **50/week** (not 5 — the ROADMAP's "5 issuances/week" was a stale citation of the older limit and possibly conflated with the *Duplicate Certificates* limit which is still 5/week for an identical SAN set). The staging-first pattern from D-05 remains a hard requirement regardless, because misconfiguration is much more likely than rate-limit exhaustion. **(3)** Ubuntu 24.04 uses **ssh.socket** activation by default — changing `Port` in `/etc/ssh/sshd_config` requires `systemctl daemon-reload && systemctl restart ssh.socket` (not `ssh.service`), and to make SSH listen **only** on 23333 (not also on 22), a `/etc/systemd/system/ssh.socket.d/listen.conf` drop-in is needed.

**Primary recommendation:** Use the global `acme_ca {$CADDY_ACME_CA}` directive (env-var driven, fits Phase 4's pattern); use a Docker named volume `caddy_data` for ACME persistence (already in `docker-compose.prod.yml`); follow the verified Ubuntu 24.04 ssh.socket + ufw + unattended-upgrades sequences below; budget extra time for Oracle A1.Flex capacity hunting (Ashburn/Phoenix have most consistent capacity, not Singapore).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TLS termination + cert provisioning | Caddy (edge) | — | Caddy owns ACME flow per Phase 4 design; FastAPI sees plain HTTP via `reverse_proxy`. |
| HTTP-01 ACME challenge response | Caddy (edge, port 80) | — | Caddy serves `/.well-known/acme-challenge/*` automatically; requires inbound 80 reachable. |
| DNS resolution | Cloudflare DNS (authoritative) | — | Cloudflare nameservers (forced by Cloudflare Registrar). Grey-cloud A record only. |
| Domain registration | Cloudflare Registrar | — | D-01. At-cost, no markup. |
| Network ingress filtering | Oracle Security List + `ufw` | — | Two layers, both must allow 23333/80/443. ufw is the real enforcement; security list is defense-in-depth. |
| SSH access | OpenSSH on VM (`ssh.socket`) | — | Key-only, port 23333. |
| Container orchestration | Docker Compose v2 on VM | — | Same `docker-compose.prod.yml` from Phase 4 (deployed unmodified). |
| Health probing (internal) | Docker compose healthcheck → `/health` | — | Phase 4 already wired (`urllib.request` probe in compose). |
| Health probing (external) | UptimeRobot → `https://<domain>/health` | — | 5-min interval, email alert. |
| OS security patches | `unattended-upgrades` (apt) | — | Security pocket only, auto-reboot off (D-14). |
| Domain → IP mapping | Cloudflare DNS A record (apex `@`) | — | DOMAIN-01. `dig +short` confirm before Caddy first start (D-04). |

## Standard Stack

### Core
| Library / Tool | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `caddy:alpine` (Docker image) | `2.11.3-alpine` (`alpine` rolling) | TLS edge + reverse proxy | Official image; multi-arch including `arm64v8`; Phase 4 already uses it. `[VERIFIED: Docker Hub via WebFetch]` |
| Ubuntu 24.04 LTS Minimal (ARM64) | 24.04 (Noble) | VM OS | D-08 locks this; matches Phase 4 arm64-only image platform. `[CITED: discuss-phase D-08]` |
| `docker-ce` + `docker-ce-cli` + `containerd.io` + `docker-buildx-plugin` + `docker-compose-plugin` | apt latest stable | Container engine + Compose v2 | Official Docker apt repo; the canonical install path. `[VERIFIED: docs.docker.com]` |
| `unattended-upgrades` | apt default | Automatic security patches | Ubuntu's blessed mechanism. `[VERIFIED: ubuntu.com/server/docs]` |
| `ufw` (Uncomplicated Firewall) | apt default | Inbound packet filtering | Ubuntu default; trivial rule syntax. `[VERIFIED: Ubuntu defaults]` |
| OpenSSH server | apt default (ssh.socket activation) | SSH | Ubuntu 24.04 default. `[VERIFIED: 4sysops + dev.to articles]` |
| `nmap` | apt latest | External port-scan verification (D-15) | Standard tool, `-p` flag for targeted scan. `[VERIFIED: nmap.org]` |

### Supporting
| Tool / Service | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Cloudflare Registrar | n/a (web service) | Domain registration | D-01. At-cost. |
| Cloudflare DNS | n/a (web service) | Authoritative DNS (forced by Cloudflare Registrar) | D-02. Grey-cloud A record only. |
| Oracle Cloud (OCI Free Tier) | n/a (cloud service) | Compute + networking | D-06. A1.Flex Ampere shape, Always Free. |
| UptimeRobot Free Tier | n/a (web service, account creation in-phase) | External uptime monitor | D-21. 50 monitors, 5-min interval, email alerts. `[VERIFIED: uptimerobot.com/pricing]` |
| `dig` (BIND utilities) | system default on most laptops | DNS-propagation check | D-04 prerequisite step. |
| `curl` | system default | TLS + HSTS verification | SC5 evidence (`curl -I` for HSTS header). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `acme_ca` global option | `tls { issuer acme { ca <url> } }` site-block | Site-block scoped per-site; global is simpler for one-site deployments. **Pick global** — matches Phase 4's env-var pattern and is the documented "for the whole Caddyfile" recommendation. `[VERIFIED: caddyserver.com docs]` |
| Named volume `caddy_data` | Bind mount `/var/lib/wallet-caddy:/data` | Bind mount is filesystem-explicit but loses Docker's volume abstraction; named volume already in `docker-compose.prod.yml` (Phase 4 D-15 pattern). **Pick named volume** — zero diff to compose. `[VERIFIED: hub.docker.com/_/caddy]` |
| Edit `/etc/ssh/sshd_config` Port directly | Drop `/etc/ssh/sshd_config.d/99-wallet-hardening.conf` | Drop-in is cleaner (preserves stock `sshd_config`); main config's `Include /etc/ssh/sshd_config.d/*.conf` makes them equivalent. **Pick drop-in** for tidiness, but operator can choose. `[VERIFIED: Ubuntu 24.04 ships Include directive]` |
| Cloudflare orange-cloud proxy | Grey-cloud DNS-only | Orange-cloud would require custom Caddy build with DNS-01 plugin (`caddy-dns/cloudflare`) — out of scope per D-03. |
| Bash retry script for Oracle capacity | Manual console retry | Script is more reliable but requires `oci` CLI setup. **Document both** — manual retry first, script in an appendix. |

**Installation summary (no npm/pip packages — system packages only):**
```bash
# On VM, as deploy user with sudo:
sudo apt update
sudo apt install -y ca-certificates curl ufw unattended-upgrades nmap
# Docker official repo (see Pattern 4 below for full commands)
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**Version verification (apt packages — no slopcheck applicable, all are upstream Debian/Ubuntu or Docker official):**
- `caddy:alpine` → `2.11.3` as of 2026-05-25 `[VERIFIED: Docker Hub]`
- `docker-ce` on Ubuntu 24.04 (Noble) ARM64 → installed from official Docker apt repo `[VERIFIED: docs.docker.com/engine/install/ubuntu]`
- `unattended-upgrades` → Ubuntu-maintained `[VERIFIED: ubuntu.com/server/docs]`

## Package Legitimacy Audit

> Phase 6 introduces **zero npm/pip/cargo packages**. All software is installed via Ubuntu/Debian `apt` from official repositories or pulled as official Docker images from Docker Hub. Slopcheck does not apply to apt packages; the equivalent verification is "is this the upstream-blessed source?"

| Package | Registry | Age | Downloads | Source Repo | Verification | Disposition |
|---------|----------|-----|-----------|-------------|--------------|-------------|
| `caddy:alpine` | Docker Hub (Official Image) | 9+ years (Caddy project) | 1B+ pulls | github.com/caddyserver/caddy | Docker Hub "Official Image" badge | Approved |
| `postgres:15-alpine` | Docker Hub (Official Image) | already in Phase 4 | 5B+ pulls | github.com/docker-library/postgres | Docker Hub "Official Image" badge | Approved (carryover) |
| `docker-ce` / `containerd.io` / `docker-compose-plugin` | Docker apt repo (`download.docker.com`) | 11+ years | n/a | github.com/docker | GPG-signed via `/etc/apt/keyrings/docker.asc` | Approved |
| `unattended-upgrades` | Ubuntu noble main | Ubuntu-maintained | n/a | Ubuntu source | Ubuntu signed | Approved |
| `ufw` | Ubuntu noble main | Ubuntu-maintained | n/a | Ubuntu source | Ubuntu signed | Approved |
| `nmap` | Ubuntu noble main | Ubuntu-maintained | n/a | github.com/nmap/nmap | Ubuntu signed | Approved |
| `openssh-server` | Ubuntu noble main | Ubuntu-maintained | n/a | OpenSSH upstream | Ubuntu signed | Approved (already on Oracle Ubuntu image) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    +-------------------+
                    |  Operator laptop  |
                    | (browser, ssh)    |
                    +---------+---------+
                              |
              ssh -p 23333    |    https://<your-domain>/...
                              v
                +--------+----+---------------+
                |  Cloudflare DNS (grey cloud)|
                |  @ A <VM-public-IP>         |
                +-----------+-----------------+
                            | (DNS answer: VM IP)
                            v
        +-------------------+-------------------+
        |   Oracle Cloud A1.Flex VM (ARM64)     |
        |   Ubuntu 24.04 Minimal                |
        |                                       |
        |  +--- ufw (23333/80/443 only) -----+ |
        |  |  +--- ssh.socket -> sshd ------+ | |
        |  |  | port 23333 (key-only auth)  | | |
        |  |  +-----------------------------+ | |
        |  |                                  | |
        |  |  +--- Docker (compose stack) --+| |
        |  |  |                              || |
        |  |  |  caddy:alpine  :80, :443     || |
        |  |  |  --> /api/*  -> api:8000     || |
        |  |  |  --> /health -> api:8000     || |
        |  |  |  --> /       -> /srv (dist)  || |
        |  |  |                              || |
        |  |  |  api (FastAPI) :8000         || |
        |  |  |  -> postgres @ db:5432       || |
        |  |  |                              || |
        |  |  |  migrate (alembic, one-shot) || |
        |  |  |                              || |
        |  |  |  db (postgres:15-alpine)     || |
        |  |  |  -- tuned shared_buffers=3GB || |
        |  |  +------------------------------+| |
        |  +----------------------------------+ |
        +---------------------------------------+
                            ^
                            | port 80 inbound: HTTP-01 challenge
                            | port 443 inbound: regular traffic + monitor probes
                            |
                +-----------+--------------------+
                |  Let's Encrypt ACME servers    |
                |  Staging first, then prod      |
                +--------------------------------+
                            ^
                            | HTTPS /health probe every 5 min
                            |
                +-----------+--------------------+
                |  UptimeRobot probe servers     |
                |  Email alert on 2 consecutive  |
                |  failures (free tier)          |
                +--------------------------------+
```

**Data flows:**
1. **Operator browser → app:** DNS query to Cloudflare → resolves to VM IP (grey-cloud, no proxy) → TCP 443 to VM → Caddy terminates TLS → routes by path (`/api/*` → FastAPI, `/health` → FastAPI, `/` → static `frontend/dist`).
2. **Operator SSH → VM:** TCP 23333 (key-only, ed25519) → ssh.socket → sshd → user `deploy`.
3. **ACME issuance:** Caddy outbound HTTPS to LE ACME directory → LE responds with challenge → LE inbound HTTP to VM port 80 `/.well-known/acme-challenge/<token>` → Caddy serves response → LE verifies → issues cert → Caddy stores in `/data` (named volume `caddy_data`).
4. **UptimeRobot probe:** UptimeRobot probe servers → DNS resolve → HTTPS GET `/health` → Caddy → FastAPI `/health` → 200 OK JSON.
5. **Alert flow:** UptimeRobot detects ≥2 consecutive non-200 → email to operator's verified address.

### Recommended File Structure (additions/edits)

```
infra/
├── Caddyfile                       # MODIFIED: + acme_ca {$CADDY_ACME_CA} (global block)
│                                   #           + header Strict-Transport-Security "max-age=31536000; includeSubDomains"
├── .env.example                    # MODIFIED: + CADDY_ACME_CA= (documented w/ staging URL in comments)
├── docker-compose.prod.yml         # UNCHANGED (already has caddy_data named volume from Phase 4)
├── RUNBOOK.md                      # NEW: pure-markdown operator playbook (D-16)
└── runbook-evidence/               # NEW (planner picks: gitignored or LFS)
    └── uptime-alert.png            # NEW: UptimeRobot alert screenshot (D-22, SC5 artifact)

backend/app/main.py                 # UNCHANGED (already DB-independent /health per D-18)
.gitignore                          # MAYBE-MODIFIED: + infra/runbook-evidence/*.png (planner picks LFS vs ignore)
.planning/ROADMAP.md                # TRIVIAL EDIT: SC3 literal "22/80/443" -> "23333/80/443" (D-12)
```

### Pattern 1: Caddyfile Global `acme_ca` (env-var driven swap)

**What:** Add a global block (above the site block) with `acme_ca` reading from env var. Default to empty/unset on the VM after the prod flip.
**When to use:** This phase, for the staging-first pattern (D-05).

**Final `infra/Caddyfile`:**

```caddy
{
    acme_ca {$CADDY_ACME_CA}
}

{$CADDY_DOMAIN:localhost} {
    tls {$CADDY_TLS_MODE:internal}

    header Strict-Transport-Security "max-age=31536000; includeSubDomains"

    encode zstd gzip

    handle /api/* {
        reverse_proxy api:8000
    }

    handle /health {
        reverse_proxy api:8000
    }

    handle /docs* {
        reverse_proxy api:8000
    }

    handle /openapi.json {
        reverse_proxy api:8000
    }

    handle {
        root * /srv
        try_files {path} /index.html
        file_server
    }
}
```

**Source:** `[VERIFIED: caddyserver.com/docs/caddyfile/options]` — "acme_ca <directory_url>" syntax; default = "ZeroSSL and Let's Encrypt's production endpoints" when omitted.

**Behavioral semantics of empty env var:**
- When `CADDY_ACME_CA` env var is **unset** OR **empty string**, Caddy's directive expansion produces `acme_ca` with no value → Caddy uses its default (LE prod + ZeroSSL). `[VERIFIED: caddyserver.com docs]`
- When `CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`, Caddy uses LE staging only.

**Two-commit pattern (D-05):**
- **Commit A (staging):** VM's `infra/.env` has `CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`. Bring stack up. Verify a **staging cert is issued** (`docker compose logs caddy | grep -i "obtained certificate"`; or `curl -vI https://<your-domain>/` — cert will be untrusted by browsers but issued).
- **Commit B (prod):** Edit `.env` on VM to set `CADDY_ACME_CA=` (empty) — single-line change. `docker compose restart caddy` (NOT `down/up -v` — must preserve `caddy_data` volume). Caddy re-issues against LE prod automatically.

**Trade-off note:** Setting `CADDY_ACME_CA=` to empty triggers Caddy default (LE prod + ZeroSSL fallback). If you want LE-only (no ZeroSSL), you'd need the explicit prod URL `https://acme-v02.api.letsencrypt.org/directory`. For Phase 6, the default-fallback behavior is fine — ZeroSSL fallback is a *bonus*, not a problem.

### Pattern 2: Named Docker Volume for Caddy `/data`

**What:** `/data` inside the Caddy container persists across container recreations via the named volume `caddy_data`. This is already configured in `infra/docker-compose.prod.yml` from Phase 4.

**What Caddy writes under `/data`:** `[VERIFIED: hub.docker.com/_/caddy + community thread]`
- `acme/` — ACME accounts (private keys, registration emails, directory URLs)
- `certificates/` — issued certs and their private keys
- `locks/` — issuance locks (prevent simultaneous renewals)
- `ocsp/` — OCSP staples

**Why persist:** Without `/data` persistence, Caddy re-issues certs on every container recreation — directly burns the LE *Duplicate Certificate* limit (5/week per identical SAN set). `[VERIFIED: letsencrypt.org/docs/rate-limits]`

**Phase 6 implication:** No compose change needed. The runbook should explicitly call out *do not run `docker compose down -v`* (the `-v` removes named volumes), and the LE-prod-flip commit uses `docker compose restart caddy`, not `down/up`.

### Pattern 3: Ubuntu 24.04 SSH Hardening (ssh.socket)

**What:** Ubuntu 24.04 uses **systemd socket activation** for SSH by default. Editing `Port` in `/etc/ssh/sshd_config` alone is **not sufficient** — the socket unit defines the listening port. `[VERIFIED: dev.to + 4sysops articles]`

**Two valid approaches:**

**Approach A (recommended — keep socket activation):**

1. Drop a hardening file at `/etc/ssh/sshd_config.d/99-wallet-hardening.conf`:
   ```
   Port 23333
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PubkeyAuthentication yes
   ```
2. Override the socket to clear port 22 and listen on 23333 only:
   ```bash
   sudo mkdir -p /etc/systemd/system/ssh.socket.d
   sudo tee /etc/systemd/system/ssh.socket.d/listen.conf <<'EOF'
   [Socket]
   ListenStream=
   ListenStream=23333
   EOF
   ```
   The empty `ListenStream=` first **clears** the inherited port-22 default; the second line sets 23333.
3. Reload + restart:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ssh.socket
   ```
4. **Verify in a SECOND SSH session before closing the first:** `ssh -p 23333 <user>@<ip>` must succeed.

**Approach B (alternative — disable socket, use service):**
```bash
sudo systemctl disable --now ssh.socket
sudo systemctl enable --now ssh.service
sudo systemctl restart ssh.service
```
With `ssh.service`, `/etc/ssh/sshd_config` fully controls the port. Simpler, but it diverges from the Ubuntu 24.04 default — Approach A is more "Ubuntu-blessed".

**Planner recommendation:** Approach A. Two reasons: (1) preserves Ubuntu's default activation model; (2) the drop-in `99-wallet-hardening.conf` is easier to audit later than a buried edit in `sshd_config`.

### Pattern 4: Docker Engine + Compose v2 on Ubuntu 24.04 ARM64 (official repo)

**Source:** `[VERIFIED: docs.docker.com/engine/install/ubuntu]`

```bash
# Step 1 — Prereqs + Docker GPG key
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Step 2 — Apt sources (deb822 format)
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update

# Step 3 — Install
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Step 4 — Allow deploy user to run docker without sudo (matches D-10's docker group membership)
sudo usermod -aG docker deploy
# (deploy must log out + back in for group membership to take effect)
```

**Verify:** `docker compose version` (note: `docker compose` two-word, not `docker-compose`).

### Pattern 5: Unattended-Upgrades (security-only, auto-reboot off)

**Source:** `[VERIFIED: ubuntu.com/server/docs/how-to/software/automatic-updates]`

`/etc/apt/apt.conf.d/50unattended-upgrades` — keep only these origin lines uncommented:
```
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

Unattended-Upgrade::Automatic-Reboot "false";
```

`/etc/apt/apt.conf.d/20auto-upgrades` — set both to "1":
```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

**Verify:**
```bash
sudo unattended-upgrade --dry-run --debug
# Should list candidate security packages without errors
sudo systemctl status apt-daily-upgrade.timer
# Should show: active (waiting)
```

### Pattern 6: ufw Safe Rule Ordering on Ubuntu

**Source:** `[VERIFIED: digitalocean.com/community + linuxsecurity.com]`

**Critical safety property:** `ufw enable` on a fresh install **does NOT drop existing SSH sessions** — established TCP connections aren't filtered by ufw's stateful rules. But your *next* SSH connection attempt will hit the firewall. Therefore: open the right ports first, then `ufw enable`, then verify a NEW SSH connection works in a SECOND TERMINAL before closing the first.

```bash
# Run as root (or with sudo) — order matters
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 23333/tcp comment 'SSH custom port'
sudo ufw allow 80/tcp     comment 'HTTP for Let''s Encrypt HTTP-01 challenge'
sudo ufw allow 443/tcp    comment 'HTTPS'
sudo ufw enable
# Verify ufw is active and lists the three ports:
sudo ufw status verbose
```

**Do NOT add `ufw allow 22/tcp` even temporarily** — Oracle's security list + our custom Port 23333 + the SECOND-SESSION verify pattern is sufficient. The runbook should say "if the second-session test fails, you can recover via the Oracle Cloud serial console (not via re-opening 22)."

**Anti-pattern (lockout risk):** Running `sudo ufw enable` *before* the `sudo ufw allow 23333/tcp` line — even though existing sessions stay up, you'll be unable to reconnect after the session ends.

### Pattern 7: Cloudflare DNS Grey-Cloud A Record

**Source:** `[VERIFIED: developers.cloudflare.com/dns/proxy-status]`

In the Cloudflare dashboard → DNS → Records → Add record:
- **Type:** `A`
- **Name:** `@` (apex)
- **IPv4 address:** `<VM-public-IP>`
- **Proxy status:** **DNS only** (grey cloud) — click the orange cloud icon to toggle
- **TTL:** `Auto` (= 300s for proxied; for DNS-only the explicit value is respected — Auto is fine)

**Verify propagation (D-04 hard prerequisite):**
```bash
dig @1.1.1.1 <your-domain> A +short
# Must return <VM-public-IP> before bringing Caddy online
# (Cross-check from a public resolver to avoid local DNS cache surprises)
dig @8.8.8.8 <your-domain> A +short
```

**Why grey-cloud (D-03):** Orange-cloud would re-encrypt at Cloudflare → require a CF Origin Cert OR full strict TLS, AND the LE HTTP-01 challenge would fail because the challenge response would be proxied through Cloudflare's HTTPS layer not the VM's port 80. Grey-cloud sidesteps both: LE talks direct to VM:80, no custom Caddy build needed.

### Pattern 8: Oracle Cloud A1.Flex Capacity Hunting

**Sources:** `[CITED: medium.com/@me69oshan]` (general technique) + `[CITED: grokipedia.com/Oracle_Cloud_Always_Free_Tier]` + `[ASSUMED]` for specific region availability (varies week-to-week).

**Reality check:** A1.Flex Always Free capacity is **the single hardest part of this phase**. Real-world reports place success rates as follows (with strong week-to-week variance — treat as guidance, not guarantee):

| Region | Anecdotal A1.Flex availability (2026) | Source |
|--------|---------------------------------------|--------|
| US East (Ashburn) | Most consistent | `[CITED: grokipedia article]` |
| US West (Phoenix) | Most consistent | `[CITED: grokipedia article]` |
| EU (Frankfurt) | Mixed; user got it on retry | `[CITED: medium.com article]` |
| Tokyo / Singapore / Sydney | "Can have availability issues during peak demand" | `[CITED: grokipedia article]` |
| Mumbai | Anecdotal availability | `[ASSUMED]` — varies |

**Runbook tactic (Out-of-Capacity recovery):**

1. **Manual first:** Try the Oracle web console manually. If it succeeds, skip the retry script.
2. **If "Out of capacity" error:** Document the exact error message in the runbook.
3. **Retry approach (manual):** Wait 5–15 minutes, retry from console. Do this 3–5 times. A1.Flex capacity often opens up briefly.
4. **Retry approach (scripted, optional appendix):** Provide an `oci compute instance launch` retry loop pattern in a runbook appendix. Requires `oci-cli` installed locally + ~10 minutes of one-time setup (API key in OCI console, ~/.oci/config). The script attempts launch every ~60s in a loop until success.
5. **Region-hop:** If a region returns OOC for 24+ hours, switch the *Home Region* to one of Ashburn/Phoenix (note: Home Region is a one-time choice when the tenancy is first created; if the tenancy was created in Singapore, region-hop may require creating a new tenancy).

**Important note for the runbook:** The "Home Region" decision is **made once when the OCI tenancy is created**. If the operator's tenancy is already locked to Singapore from prior signup, the runbook must mention that switching to Ashburn/Phoenix requires a new tenancy/account (irreversible for the existing one). For a fresh signup, recommend choosing Ashburn or Phoenix at signup time.

### Anti-Patterns to Avoid

- **`docker compose down -v` on the VM** — the `-v` flag deletes named volumes, including `caddy_data` (loses ACME account + certs) and `wallet_pgdata_prod` (loses the database). Runbook MUST say `docker compose down` (no -v) for graceful stop, and `docker compose restart <svc>` for individual service restarts.
- **Editing `/etc/ssh/sshd_config` Port WITHOUT updating ssh.socket** — port change appears to take effect on Ubuntu 24.04 because the docs say it does, but socket activation may still listen on 22 if not restarted/overridden. Always restart `ssh.socket` and verify in a second session.
- **Running `ufw enable` before allowing SSH** — even though existing connection survives, the next reconnect attempts get filtered. Always add the SSH-port allow rule first.
- **Setting `CADDY_DOMAIN=<domain>` BEFORE the A record points at the VM IP** — Caddy will attempt HTTP-01 challenge, LE will fail to resolve the domain to the VM, and you burn an LE *failed validation* count. D-04 ordering is a hard rule.
- **Using LE production endpoint during initial bring-up** — if Caddy misconfig is detected only after first start, you may have already burned LE prod-issuance attempts. Staging-first pattern (D-05) avoids this.
- **HSTS preload directive (`; preload`)** — irreversible; you submit to the Chrome HSTS preload list and there's a months-long de-listing process. D-19 explicitly omits `preload`.
- **Cloudflare orange-cloud while attempting HTTP-01 challenge** — challenge will fail because CF terminates port 80 itself. Either grey-cloud (this phase's choice) or use DNS-01 challenge with a custom Caddy build (deferred).
- **Skipping the "second SSH session" verify step after `ufw enable` or `ssh.socket` restart** — lockout recovery requires Oracle Cloud serial console (slower path).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ACME / Let's Encrypt cert issuance | A certbot wrapper | Caddy's built-in auto-HTTPS | Caddy handles staging fallback, OCSP stapling, renewal scheduling, account portability automatically. |
| Cert renewal cron job | A `certbot renew` cron | Caddy auto-renew (every 60 days, automatic) | Caddy renews when cert has <30 days left; survives restarts via `/data` volume. |
| OCSP stapling | A custom nginx config | Caddy stamps it automatically | Native to Caddy's TLS pipeline. |
| HSTS header logic | Custom middleware in FastAPI | Caddy `header` directive | Defense at the edge, applies to static + API uniformly. |
| Inbound firewall | Hand-written `iptables` rules | `ufw` | UFW is iptables-compatible, easier to audit, and survives reboot via `ufw` service. |
| Security patching | Bespoke cron + apt | `unattended-upgrades` | Ubuntu's blessed, audited, and respects allow/deny lists per pocket. |
| External uptime monitoring | Self-hosted Prometheus + Alertmanager | UptimeRobot free tier | We're a one-VM POC; external probes are exactly what we need (catches "VM down" which self-hosting can't). |
| TLS testing on dev | Ngrok / self-signed gymnastics | Phase 4 already set `tls internal` on laptop | The HTTPS code path was exercised in dev; Phase 6 only swaps the cert source. |
| Custom retry logic for Oracle capacity | Sophisticated polling daemon | A simple `while ! oci ... ; do sleep 60; done` loop OR manual console retries | A1.Flex capacity is a Oracle-side queue issue; nothing client-side can game it beyond patience. |
| Backup of Caddy's ACME state | A separate backup service | Just persist the `caddy_data` named volume (Phase 7 backups will cover it) | Caddy's account survives container recreation as long as the volume persists. |

**Key insight:** Caddy's auto-HTTPS pipeline is the single biggest "don't hand-roll" win in this phase. It handles ACME staging→prod failover, cert storage, renewal scheduling, OCSP stapling, key rotation, and HTTP-01/TLS-ALPN-01 fallback — all from a 2-3 line Caddyfile. The Phase 6 work is *configuration*, not *implementation*.

## Runtime State Inventory

**This phase is partly a rename/swap operation** (`CADDY_DOMAIN=localhost` → `<your-domain>`, `CADDY_TLS_MODE=internal` → dropped, plus new `CADDY_ACME_CA` env var). Runtime state inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `caddy_data` named volume holds the **localhost self-signed cert** from Phase 4 laptop testing — irrelevant on the VM because the volume is created fresh on first VM `docker compose up`. Postgres data is empty on first deploy (migrations run via `migrate` service). | None on VM (fresh volumes); operator's laptop dev volumes are untouched. |
| **Live service config** | None yet — VM doesn't exist. After Phase 6, the VM's `infra/.env` holds the prod values; Cloudflare DNS holds the A record; UptimeRobot holds the monitor config; OCI holds the VCN/subnet/security-list config. | Document all these in RUNBOOK.md so a re-provision is reproducible. |
| **OS-registered state** | Ubuntu systemd: `ssh.socket` listening port (drop-in at `/etc/systemd/system/ssh.socket.d/listen.conf`); `ufw` rules saved by ufw service; `unattended-upgrades` apt timer config. | All set during VM hardening; survive reboot. |
| **Secrets and env vars** | `infra/.env` on VM contains `SECRET_KEY`, `POSTGRES_PASSWORD`, `CADDY_DOMAIN`, `CADDY_ACME_CA`, `ALLOWED_ORIGINS`. `chmod 600` enforced on VM (Phase 4 D-17 deferred this enforcement to Phase 6). | Runbook step: `chmod 600 infra/.env && chown deploy:deploy infra/.env` immediately after authoring. Also: regenerate `SECRET_KEY` for prod (`openssl rand -hex 32`) — don't reuse laptop dev value. |
| **Build artifacts / installed packages** | `wallet-app/api:local` image built ON VM (build-on-VM per Phase 6 design, Phase 7 will swap to GHCR pull). `frontend/dist/` must be built on VM via `npm run build:web` from the runbook OR pre-built on laptop and `scp`d (planner picks). | Runbook step: either `npm install && npm run build:web` on VM (requires Node), or `scp -P 23333 -r frontend/dist deploy@vm:~/wallet_app/frontend/` from laptop. **Recommendation: scp from laptop** — keeps VM dependency footprint smaller (no Node toolchain on prod VM). |

**Nothing found:** No prior infra (VM doesn't exist), no Datadog/Tailscale/external integrations, no pre-existing DNS records to migrate.

## Common Pitfalls

### Pitfall 1: Caddy hits LE prod on first start because `acme_ca` env var is unset

**What goes wrong:** Operator deploys to VM, forgets to add `CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` to `.env`. Caddy starts, sees `CADDY_DOMAIN=<real-domain>`, hits LE prod immediately. If the domain/DNS/firewall is misconfigured at all, this burns *failed-validation* attempts against LE prod.
**Why it happens:** `acme_ca {$CADDY_ACME_CA}` with empty/unset env var → Caddy default = LE prod.
**How to avoid:** Runbook's `.env`-authoring step puts `CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` **above** the `CADDY_DOMAIN` line, with an explicit comment "DO NOT REMOVE until staging cert is verified — see RUNBOOK §Flip to LE Prod". The pre-flight checklist (right before `docker compose up`) restates: `grep CADDY_ACME_CA infra/.env` must return the staging URL.
**Warning signs:** `docker compose logs caddy | grep -i "obtained certificate"` showing an issuer other than "(STAGING) Pretend Pear X1" in the very first run.

### Pitfall 2: DNS not propagated when Caddy first starts

**What goes wrong:** Operator creates A record in Cloudflare and immediately runs `docker compose up -d`. Caddy queries `<your-domain>` → resolver still has old record (or no record) cached → LE can't validate ownership → first issuance fails. With LE staging this is just an inconvenience; with prod it counts against the 50/week budget.
**Why it happens:** Cloudflare DNS propagation is fast (<5 min typically) but not instant; local resolver caches can lag.
**How to avoid:** D-04 hard prerequisite — `dig @1.1.1.1 <your-domain> +short` must return the VM IP before `docker compose up`. Runbook step is a `bash` block that loops `dig` with a 10s sleep until the right answer appears.
**Warning signs:** `dig +short` returns empty / wrong IP / NXDOMAIN.

### Pitfall 3: Oracle security list allows 80/443 but ufw blocks them (or vice versa)

**What goes wrong:** Two-layer firewall confusion. ufw correctly allows 80/443 but Oracle security list only has the default (22) → traffic doesn't even reach the VM. Or vice versa.
**Why it happens:** Two independent firewalls, both must allow.
**How to avoid:** Runbook explicitly walks both: (1) Oracle console → Networking → VCN → security list → Add ingress rules for 23333, 80, 443 from `0.0.0.0/0`; (2) on VM, `sudo ufw status` shows the same three ports allowed. Verification: `nmap -Pn -p 23333,80,443 <vm-ip>` from **outside** the VM (operator's laptop) — all three must be reachable.
**Warning signs:** `curl -v http://<vm-ip>` from laptop times out (not refused). Timeout = filtered (firewall drops); refused = port not listening but reachable.

### Pitfall 4: Oracle image ships with iptables rules blocking 80/443

**What goes wrong:** Some Oracle Ubuntu cloud images (especially older ones) bake in iptables rules via `/etc/iptables/rules.v4` that block everything except SSH on 22, in addition to whatever ufw says. ufw allows 80/443 but the underlying iptables chain blocks it first.
**Why it happens:** Oracle's own "secure by default" baseline on the image conflicts with ufw, which on Ubuntu *also* manipulates iptables.
**How to avoid:** On Ubuntu 24.04 Minimal (D-08), the image is generally clean (no pre-baked iptables rules), but the runbook should include a check: `sudo iptables -L INPUT -n | head -20` before enabling ufw. If non-empty rules exist that aren't ufw-managed, flush them: `sudo iptables -F INPUT` BEFORE enabling ufw (do NOT do this if currently SSH'd in on 22 without also having 23333 allowed — sequencing matters).
**Warning signs:** ufw shows 80/443 allowed AND Oracle security list allows them AND nmap from outside shows them filtered.

### Pitfall 5: SSH lockout after ssh.socket misconfig

**What goes wrong:** Operator edits `/etc/ssh/sshd_config` with `Port 23333`, runs `systemctl restart ssh.service`, and assumes done. Ubuntu 24.04 socket activation means port 22 is still bound; or worse, the operator overrides `ListenStream` incorrectly and SSH binds to nothing.
**Why it happens:** Ubuntu 24.04 socket activation is recent; muscle memory from older Ubuntu/Debian doesn't apply.
**How to avoid:** Use the documented Approach A sequence (drop-in `sshd_config.d/99-wallet-hardening.conf` + `ssh.socket.d/listen.conf`). Always verify in a **second SSH session** before closing the first. The runbook MUST say "DO NOT close the original SSH session until you have a confirmed working session on port 23333 in a second terminal."
**Warning signs:** `ssh -p 23333 <user>@<ip>` says "connection refused" → port not bound; "connection timed out" → ufw/Oracle blocked; works on 22 but not 23333 → socket override didn't apply.

### Pitfall 6: UptimeRobot probe fails because Cloudflare DNS hasn't propagated to their resolvers

**What goes wrong:** Operator finishes everything, adds UptimeRobot monitor, and sees immediate "Down" because UptimeRobot's probe servers haven't yet seen the DNS A record.
**Why it happens:** UptimeRobot resolves via their own infrastructure; cache TTL takes a few minutes.
**How to avoid:** Wait 5–10 minutes after creating the UptimeRobot monitor before declaring failure. The runbook step says "give it one full check-cycle (5 min) before troubleshooting."
**Warning signs:** UptimeRobot dashboard shows the monitor red, but `curl https://<your-domain>/health` from laptop works.

### Pitfall 7: HSTS bricks browser access if added before real cert is in place

**What goes wrong:** Operator adds HSTS header in Caddyfile while still on `tls internal` self-signed cert (or while on LE staging which uses untrusted "Fake LE Root" cert). Browser pins the bad cert; for the next year, can't access the site even after fixing certs.
**Why it happens:** HSTS tells the browser "ONLY connect via HTTPS with a trusted cert"; an untrusted cert from staging+HSTS = effective brick.
**How to avoid:** Add the HSTS `header` directive only AFTER the LE prod cert is in place. The two-commit pattern naturally handles this: Commit A (staging) does NOT include HSTS; Commit B (prod flip) is the same commit that ALSO adds the HSTS directive — OR alternatively, HSTS is in the Caddyfile from the start but the operator uses incognito mode for staging verification (no HSTS pinning persists). **Recommendation:** Keep HSTS in the Caddyfile from Commit A (avoids a multi-step file diff) and have the runbook say "verify staging cert from a private/incognito browser tab so HSTS pin doesn't carry forward to prod-cert testing."
**Warning signs:** Browser shows "this site can't be reached" with no option to bypass cert warning; `chrome://net-internals/#hsts` shows the domain pinned.

### Pitfall 8: `docker compose down -v` wipes the cert state on the VM

**What goes wrong:** Operator runs `docker compose down -v` to "clean up", `caddy_data` named volume gets deleted, Caddy re-issues against LE prod on next `up` → burns Duplicate Certificate count (5/week per identical SAN set).
**Why it happens:** `-v` removes named volumes; muscle memory from dev environments.
**How to avoid:** Runbook explicitly forbids `down -v` on the VM. Common operations are `docker compose stop <svc>`, `docker compose restart <svc>`, `docker compose up -d` (idempotent). The `-v` flag is never used in production runbook commands.
**Warning signs:** `docker volume ls | grep caddy_data` returns empty after running compose commands.

### Pitfall 9: `.env` file world-readable on the VM

**What goes wrong:** `infra/.env` ends up with default `chmod 644`; any user on the box can read `SECRET_KEY` and `POSTGRES_PASSWORD`.
**Why it happens:** Phase 4 D-17 explicitly deferred enforcement to Phase 6; default file creation on most shells is 644.
**How to avoid:** Runbook step immediately after `cp .env.example .env`: `chmod 600 infra/.env && chown deploy:deploy infra/.env`. Verify: `ls -la infra/.env` shows `-rw-------`.
**Warning signs:** `stat -c '%a' infra/.env` returns anything other than `600`.

## Code Examples

### Example 1: Final `infra/Caddyfile` (after Phase 6 edits)

```caddy
# Source: caddyserver.com/docs/caddyfile/options + caddyserver.com/docs/caddyfile/directives/tls
{
    acme_ca {$CADDY_ACME_CA}
}

{$CADDY_DOMAIN:localhost} {
    tls {$CADDY_TLS_MODE:internal}

    header Strict-Transport-Security "max-age=31536000; includeSubDomains"

    encode zstd gzip

    handle /api/* {
        reverse_proxy api:8000
    }

    handle /health {
        reverse_proxy api:8000
    }

    handle /docs* {
        reverse_proxy api:8000
    }

    handle /openapi.json {
        reverse_proxy api:8000
    }

    handle {
        root * /srv
        try_files {path} /index.html
        file_server
    }
}
```

### Example 2: `infra/.env.example` (Phase 6 additions, full file)

```bash
# infra/.env.example — Phase 4 production-shape + Phase 6 production-domain template

# Postgres
POSTGRES_USER=CHANGE_ME_POSTGRES_USER
POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD
POSTGRES_DB=CHANGE_ME_POSTGRES_DB
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}

# JWT / Auth
SECRET_KEY=CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32
ACCESS_TOKEN_EXPIRE_MINUTES=30
ALGORITHM=HS256

# CORS — Phase 6: narrow from https://localhost to real prod domain
ALLOWED_ORIGINS=https://CHANGE_ME_YOUR_DOMAIN

# Exchange rates
EXCHANGE_RATE_API_URL=https://api.frankfurter.dev/v1

ENVIRONMENT=production
DEBUG=False

# Caddy — Phase 4 default values commented out; Phase 6 VM overrides:
# CADDY_DOMAIN=localhost      # laptop
# CADDY_TLS_MODE=internal     # laptop
CADDY_DOMAIN=CHANGE_ME_YOUR_DOMAIN
# CADDY_TLS_MODE — UNSET on VM (let Caddy default to ACME). Comment out or delete.

# Phase 6 NEW: ACME endpoint override.
# Staging (default for first bring-up): https://acme-staging-v02.api.letsencrypt.org/directory
# Production (set to empty after staging-cert verification): CADDY_ACME_CA=
CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

### Example 3: Ubuntu 24.04 SSH hardening drop-in

```bash
# /etc/ssh/sshd_config.d/99-wallet-hardening.conf
Port 23333
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
```

```bash
# /etc/systemd/system/ssh.socket.d/listen.conf
[Socket]
ListenStream=
ListenStream=23333
```

```bash
# Apply
sudo systemctl daemon-reload
sudo systemctl restart ssh.socket
# Verify in SECOND terminal: ssh -p 23333 deploy@<vm-ip>
```

### Example 4: ufw safe-order rule application

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 23333/tcp comment 'SSH custom port'
sudo ufw allow 80/tcp     comment 'HTTP for Let''s Encrypt HTTP-01'
sudo ufw allow 443/tcp    comment 'HTTPS'
sudo ufw enable
# (answers 'y' to lockout warning prompt)
sudo ufw status verbose
```

### Example 5: Cloudflare DNS verify before first Caddy start (runbook block)

```bash
# Wait for DNS propagation — D-04 hard prerequisite
DOMAIN="<your-domain>"
EXPECTED_IP="<vm-public-ip>"

while true; do
  ACTUAL=$(dig @1.1.1.1 "$DOMAIN" +short | head -1)
  if [ "$ACTUAL" = "$EXPECTED_IP" ]; then
    echo "DNS propagated: $DOMAIN -> $EXPECTED_IP"
    break
  fi
  echo "Waiting for DNS... got [$ACTUAL] expected [$EXPECTED_IP]"
  sleep 10
done
```

### Example 6: LE staging → prod flip (one-line .env diff + restart)

```bash
# On VM:
ssh wallet-app   # operator's ~/.ssh/config alias

cd ~/wallet_app/infra

# Verify staging cert is in place:
docker compose logs caddy | grep -i "obtained certificate"
# Should show issuer "(STAGING) Pretend Pear X1" or similar.

# Edit .env: comment out or empty the staging URL
sed -i 's|^CADDY_ACME_CA=.*|CADDY_ACME_CA=|' .env
grep ^CADDY_ACME_CA .env  # should show: CADDY_ACME_CA=

# Restart Caddy only — preserves volumes
docker compose restart caddy

# Watch logs for prod cert issuance
docker compose logs -f caddy | grep -i "obtained certificate"
# Should now show LE prod issuer (e.g., "(STAGING)" no longer present)

# Verify in browser AND from cli:
curl -vI https://<your-domain>/health 2>&1 | grep -E '(strict-transport|HTTP/)'
```

### Example 7: UptimeRobot downtime drill (SC5 evidence-generation)

```bash
# On VM as deploy user
ssh wallet-app
cd ~/wallet_app/infra

# Trigger downtime
docker compose stop caddy
date  # log start time

# Wait for UptimeRobot alert email — up to 5 minutes (next probe cycle)
# When email arrives, screenshot it and save under infra/runbook-evidence/uptime-alert.png

# Restore
docker compose start caddy
date  # log restore time
docker compose ps caddy  # should show "running"

# Confirm UptimeRobot returns to "Up" within one probe cycle (5 min)
```

### Example 8: External port-scan verification (D-15, SC3)

```bash
# Run from operator's laptop (NOT from inside the VM)
nmap -Pn -p 23333,80,443 <vm-public-ip>

# Expected: all three "open" or "filtered" (filtered means firewall isn't even ACK'ing — fine).
# All other ports should NOT show open.

# For thoroughness (slower):
nmap -Pn -p- <vm-public-ip>
# Verify no surprise open ports.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `certbot` + nginx + cron-renewal | Caddy auto-HTTPS | Caddy 2.0 (2020) | Eliminates entire class of cert-management bugs. Caddy is now the default reverse-proxy choice for HTTPS-first deploys. |
| LE rate limit 5 certs / domain / week | 50 certs / domain / week (renewals exempt; refill at 1/202min) | 2025 (Let's Encrypt scaling update) | The ROADMAP's "5 issuances/week" is **stale**; the real limit is 50 new, 5 duplicate per identical SAN set. Staging-first pattern (D-05) still warranted for *misconfiguration* protection, not rate-limit avoidance. `[VERIFIED: letsencrypt.org/docs/rate-limits]` |
| `ssh.service` (always-on daemon) on Ubuntu | `ssh.socket` (socket activation) on Ubuntu 22.10+ | Ubuntu 22.10 / persists into 24.04 | Port changes require restart of `ssh.socket`, not `ssh.service`. Old muscle memory wrong. `[VERIFIED: 4sysops]` |
| `docker-compose` (Python v1) | `docker compose` (Go v2, plugin) | Docker Desktop default mid-2021, apt plugin since ~2022 | Use `docker compose` (no hyphen). `docker-compose-plugin` apt package. `[VERIFIED: docs.docker.com]` |
| Cloudflare Registrar limited to ~50 TLDs | 400+ TLDs supported | Ongoing expansion through 2024-2026 | The common TLDs (`.com .net .org .io .dev .app .co .ai`) are all supported. `[VERIFIED: cloudflare.com/tld-policies]` |
| UptimeRobot free tier = 50 monitors, no card | Same as 2026, but **personal use only since Dec 2024** | Dec 2024 ToS change | Solo dev with personal domain is fine. **Commercial use is now explicitly prohibited on free tier.** `[VERIFIED: uptimerobot.com — citation note: this affects the v2.0 POC use case; for any future commercial use of this app, switch to paid tier or alternative (HealthChecks.io supports free webhooks).]` |

**Deprecated / outdated:**
- "5 LE prod certs per domain per week" (ROADMAP's stated number) — superseded by 50/week. Staging-first still warranted for safety, not rate-limit-avoidance. Researcher recommendation: keep D-05 as a hard requirement (it's correct policy regardless of the exact number), but the runbook prose can drop the alarming "burns the 5/week budget" framing.
- `Port` in `/etc/ssh/sshd_config` alone (without socket override) on Ubuntu 22.10+ — must coordinate with `ssh.socket`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Oracle Ubuntu 24.04 Minimal image does NOT ship with pre-baked iptables rules blocking 80/443 (older images did; Minimal 24.04 is generally clean) | Pitfall 4 | Runbook may need an extra `iptables -F INPUT` step before `ufw enable`; mitigated by including a verification step. |
| A2 | Mumbai region has comparable A1.Flex availability to Phoenix | Pattern 8 | If operator picks Mumbai and gets repeated OOC, runbook should still work — capacity hunting is a known process. Low risk. |
| A3 | Operator's tenancy Home Region can be chosen at signup if not already created. If pre-existing tenancy is locked to Singapore, region-hop requires new tenancy. | Pattern 8 | Runbook should ask "which Home Region is your tenancy?" early. Low risk if checked. |
| A4 | `caddy:alpine` rolling tag will continue to track the 2.x stable line through Phase 6 completion (no surprise 3.0 cutover breaking config syntax) | Standard Stack | Pin to `caddy:2.11-alpine` instead of `caddy:alpine` if planner wants belt-and-suspenders. |
| A5 | Cloudflare Registrar pricing is at-cost with no markup (true historically; could change) | D-01 | Operator sees actual price at checkout; no impact on runbook flow. |
| A6 | The Caddy `acme_ca` directive accepts an empty string (from empty env var) and falls through to default | Pattern 1 | If empty string is treated as error instead, the prod flip would need to set `CADDY_ACME_CA=https://acme-v02.api.letsencrypt.org/directory` explicitly (a 1-character runbook diff). Low risk — verified behavior is documented. |
| A7 | UptimeRobot probe servers reach Cloudflare-resolved DNS within one probe cycle (5 min) | Pitfall 6 | Operator may see initial false-Down; mitigated by runbook's "wait one cycle" instruction. |
| A8 | The `wallet-app/api:local` image built on the VM is functionally identical to the laptop build (arm64 platform matches) | Runtime State Inventory | If a build difference exists (e.g., glibc version), runbook would need to capture it. Phase 4 already built on arm64; risk is low. |
| A9 | `frontend/dist/` built on laptop is portable to VM (no host-OS-specific paths baked in) | Runtime State Inventory | Standard expo web export is portable; risk near zero. |
| A10 | "Personal, non-commercial use" UptimeRobot ToS clause is met by a solo developer's POC wallet app | UptimeRobot row in State of the Art | If app becomes commercial (revenue), switch to paid tier or HealthChecks.io. Operator should be aware. |

## Open Questions

1. **Runbook scope of "scp dist from laptop" vs "build on VM"** — researcher recommends scp from laptop (no Node toolchain on VM), but planner picks. Both feasible.
   - Recommendation: scp + a one-line "if you don't have a recent dist build on laptop, run `npm run build:web` in `frontend/` first".

2. **`infra/runbook-evidence/uptime-alert.png` — gitignored or LFS?**
   - Typical alert email screenshot: 200-500 KB. Below GitHub's 100 MB single-file limit by orders of magnitude.
   - Recommendation: **commit directly** (no LFS needed at this size). Add `infra/runbook-evidence/.gitkeep` to make the directory exist before evidence is added.

3. **Caddy image tag — `caddy:alpine` (rolling) vs `caddy:2.11-alpine` (pinned)?**
   - Phase 4 uses `caddy:alpine`. For consistency, keep rolling.
   - Recommendation: keep `caddy:alpine`. If a future 3.0 release breaks syntax, Phase 7's CI will catch it before VM affected (image pull is explicit).

4. **Oracle `oci` CLI retry script — runbook appendix or pure prose?**
   - Researcher leans toward pure prose ("manual retry every 5-15 minutes") + a footnote linking to the medium.com article with the bash-loop pattern. Avoids adding `oci` CLI as a runbook dependency.
   - Recommendation: pure prose with footnote.

5. **HSTS in Caddyfile from Commit A or Commit B?**
   - Researcher recommends Commit A (single Caddyfile diff) + runbook instructions to use incognito for staging-cert verification. Avoids a multi-step file diff.
   - Recommendation: Caddyfile changes ALL go in Commit A; only `.env` changes between A and B.

## Environment Availability

| Dependency | Required By | Available (target VM) | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Engine | All services | ✗ (must install per Pattern 4) | will install latest from Docker apt | none — blocking |
| `docker compose` plugin v2 | Compose file format | ✗ (must install per Pattern 4) | bundled with docker-compose-plugin apt | none — blocking |
| `git` | Clone repo on VM | usually present on Ubuntu Minimal | system | apt install git |
| `ufw` | SEC-02 baseline | yes (Ubuntu default) | system | none needed |
| `unattended-upgrades` | SEC-02 baseline | yes (often pre-installed; install if missing) | system | apt install unattended-upgrades |
| `nmap` | D-15 verification | typically not on Ubuntu Minimal — **install on OPERATOR LAPTOP, not VM** | system | none if missing on laptop; install via apt/brew/scoop |
| `openssh-server` | SSH access | yes (Oracle Ubuntu image default) | system | none needed |
| `dig` (BIND utilities) | D-04 DNS verify (operator laptop side) | typically present on Linux/macOS; Windows needs install | system | nslookup or PowerShell Resolve-DnsName as fallback |
| Cloudflare account | Registrar + DNS | operator must create | n/a | none — blocking |
| Oracle Cloud account | A1.Flex VM | operator confirmed exists per D-06 | n/a | none — blocking |
| UptimeRobot account | OPS-02 monitor | operator creates during phase per D-21 | n/a | HealthChecks.io as alternative (deferred per ROADMAP) |
| Node.js + npm on laptop | Build `frontend/dist/` before scp to VM | yes (Phase 5 verified) | from Phase 5 | none if laptop loses Node — install Node 20 LTS |

**Missing dependencies with no fallback:**
- Docker engine on VM — install step in runbook (Pattern 4)
- Cloudflare account — operator creates as runbook step
- Oracle Cloud account — confirmed present per D-06

**Missing dependencies with fallback:** none significant.

## Validation Architecture

> `workflow.nyquist_validation: true` per `.planning/config.json` — section included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bash-based smoke tests + manual operator verification (no traditional pytest/jest applicable to provisioning) |
| Config file | `infra/scripts/smoke.sh` (Phase 4 existing) + new `infra/scripts/verify-phase6.sh` (planner adds) |
| Quick run command | `bash infra/scripts/verify-phase6.sh quick` (local; checks Caddyfile syntax, .env.example schema) |
| Full suite command | `bash infra/scripts/verify-phase6.sh full` (against deployed VM — `https://<domain>` reachable, /health DB-independent, HSTS header present, nmap matches, UptimeRobot artifact present) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEPLOY-05 | RUNBOOK.md exists + documents end-to-end provisioning | doc-exists | `test -f infra/RUNBOOK.md && grep -E '^## ' infra/RUNBOOK.md \| wc -l` (expect ≥10 sections) | ❌ Wave 0 |
| DOMAIN-01 | A record → VM public IP, dig-confirmed | smoke | `dig @1.1.1.1 <your-domain> +short` (manual or scripted with expected IP) | ❌ Wave 0 |
| DOMAIN-02 | LE prod cert in place | smoke | `curl -vI https://<your-domain>/ 2>&1 \| grep "issuer" \| grep -v STAGING` | ❌ Wave 0 |
| DOMAIN-03 | HSTS header observed | smoke | `curl -sI https://<your-domain>/ \| grep -i 'strict-transport-security: max-age=31536000; includeSubDomains'` | ❌ Wave 0 |
| SEC-02 (ufw) | Only 23333/80/443 reachable externally | smoke | `nmap -Pn -p- <vm-ip>` from laptop (manual review of output) | ❌ Wave 0 |
| SEC-02 (SSH) | Key-only, port 23333, no root | smoke | `ssh -o PasswordAuthentication=yes -p 23333 root@<vm-ip>` (should fail) + `ssh -p 22 deploy@<vm-ip>` (should fail/timeout) | ❌ Wave 0 |
| SEC-02 (unattended-upgrades) | Security updates scheduled | smoke | `systemctl is-active apt-daily-upgrade.timer` returns `active` on VM | ❌ Wave 0 |
| OPS-01 | /health survives DB stop | smoke | `docker compose stop db && curl -sf https://<domain>/health \| jq .status` returns `"healthy"`; then `docker compose start db` | ❌ Wave 0 |
| OPS-02 | UptimeRobot monitor exists + alerted | manual-only | screenshot of UptimeRobot dashboard showing monitor + alert email screenshot at `infra/runbook-evidence/uptime-alert.png` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** N/A — Phase 6 is a single deployment phase, not a multi-iteration code phase. Verifications happen at runbook execution boundaries.
- **Per wave merge:** Run Caddyfile lint locally: `docker run --rm -v $(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile:ro caddy:alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
- **Phase gate:** Full operator verification — every SC1–SC5 from ROADMAP confirmed against deployed VM. Evidence: UptimeRobot screenshot committed.

### Wave 0 Gaps

- [ ] `infra/scripts/verify-phase6.sh` — wraps the smoke tests above (Caddyfile validate locally; curl checks against deployed VM; nmap reminder)
- [ ] `infra/RUNBOOK.md` skeleton with section headers + copy-paste blocks (created during phase execution, not Wave 0)
- [ ] `infra/runbook-evidence/.gitkeep` — placeholder so evidence directory exists pre-execution
- [ ] No new test framework install needed — bash + curl + dig + nmap suffice; nmap must be on operator laptop (not VM)

## Security Domain

> `workflow.code_review: true`, `workflow.ui_review: true` per config; ASVS applicable categories below.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Defense-in-depth: Cloudflare DNS + Oracle security list + ufw + sshd_config (4-layer ingress); `chmod 600 .env` + non-root containers + non-root sudo user (3-layer process boundary). |
| V2 Authentication | partial | SSH: key-only (PasswordAuth no, ed25519); password-based auth at the FastAPI app layer is unchanged from Phase 3. |
| V3 Session Management | n/a (no session changes in this phase) | — |
| V4 Access Control | partial | ufw rule allowlist (3 ports); Oracle security list mirrors; sshd `PermitRootLogin no`. |
| V5 Input Validation | n/a (no new input surfaces) | — |
| V6 Cryptography | yes | TLS 1.2/1.3 via Caddy auto-config (Caddy picks safe defaults); LE ECDSA cert; HSTS `max-age=31536000` (1y); no preload (irreversibility risk). |
| V7 Error Handling | n/a (no app-code changes) | — |
| V8 Data Protection at Rest | partial | `.env` chmod 600 on VM (D-17 enforcement). Caddy named volume permissions are Docker-managed (root inside container). |
| V9 Communications | yes | All external traffic over TLS 1.2+ via Caddy; HSTS pins. SSH on non-default port (23333) + key-only. |
| V10 Malicious Code | n/a (no new code paths) | — |
| V11 Business Logic | n/a | — |
| V12 Files & Resources | partial | Caddy `file_server` serves only `/srv` (read-only bind mount); no upload paths. |
| V13 API | partial | Same-origin via Caddy `reverse_proxy`; CORS allowlist narrowed to prod domain (D-20). |
| V14 Configuration | yes | Hardening baseline (SEC-02): ufw, unattended-upgrades (security-only), key-only SSH, non-root deploy user. External nmap verifies (D-15). |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LE rate-limit exhaustion via misconfiguration | DoS (self-inflicted) | Staging-first pattern (D-05); LE per-domain limit is 50/week (renewals exempt) — buffer is large but staging avoids burning attempts during config iteration. |
| SSH brute force | Spoofing | Key-only auth (D-09); non-default port (D-11, modest noise reduction); fail2ban deferred to later milestone (D-13). |
| Stolen LE account key (theft of `caddy_data` volume) | Repudiation / Tampering | Volume sits inside the VM; VM compromise = game over anyway. Caddy auto-recovers via new account if `/data` lost (re-issues, subject to rate limits). |
| Cert pinning brick via HSTS + bad cert | DoS (self-inflicted) | No `preload` directive (D-19); incognito browser for staging verification (Pitfall 7). |
| Port-22 still reachable (Oracle default security list rule) | Spoofing / Brute Force | Runbook removes Oracle SL inbound rule for 22 + ufw doesn't allow 22; both layers must drop. nmap verifies (D-15). |
| Plaintext secrets in image / git | Information Disclosure | `infra/.env` gitignored (Phase 4 D-17); `chmod 600` on VM (this phase). No secrets in compose file (env_file reference). |
| Outdated kernel / userspace | Tampering / EoP | `unattended-upgrades` security-only (D-14); auto-reboot off requires manual reboot for kernel updates — operator tracks deferred reboots. |
| Cloudflare credential takeover → DNS hijack | Spoofing (DNS) | 2FA on Cloudflare account (operator responsibility — runbook should remind); registrar lock not needed (60-day ICANN new-registration lock is automatic). |
| UptimeRobot account takeover | Information Disclosure (monitor schedule) | Email-based, low-stakes monitor; 2FA on UptimeRobot account (free tier supports TOTP) — runbook recommends. |

## Project Constraints (from CLAUDE.md / project config)

No `CLAUDE.md` present at `./CLAUDE.md`. The `.planning/config.json` constraints:
- `commit_docs: true` — research, plan, verification docs MUST be committed.
- `workflow.nyquist_validation: true` — validation architecture section required (provided above).
- `workflow.code_review: true` + `workflow.code_review_depth: "deep"` — implementation PRs require deep code review.
- `workflow.ui_safety_gate: true` + `workflow.ui_review: true` — applies if any UI changes; Phase 6 has none (HSTS header is server-side; no frontend bundle change).
- `git.branching_strategy: "phase"` with template `gsd/phase-{phase}-{slug}` — Phase 6 branch will be `gsd/phase-06-provision-oracle-vm-domain-caddy-https`.
- `git.create_tag: true` — phase-completion tag.
- `mode: "yolo"` — agent autonomy elevated; planner can make decisions without per-step confirmation provided they respect locked decisions in CONTEXT.md.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPLOY-05 | First-time deploy `RUNBOOK.md` documents provision → install Docker → clone repo → set `.env` → bootstrap → verify | Pattern 4 (Docker install), Pattern 5 (unattended-upgrades), Pattern 6 (ufw), Pattern 7 (DNS), Pattern 8 (OCI provisioning), all code examples |
| DOMAIN-01 | Custom domain registered + A record points at VM public IP, `dig`-confirmed before first Caddy start | Pattern 7 (Cloudflare DNS), Example 5 (`dig` loop), Pitfall 2 (propagation timing) |
| DOMAIN-02 | Caddy auto-HTTPS via Let's Encrypt (staging endpoint during initial setup) | Pattern 1 (Caddyfile `acme_ca`), Pattern 2 (named volume), Example 1 (final Caddyfile), Example 6 (staging→prod flip), Pitfall 1 (env var safety) |
| DOMAIN-03 | HSTS header `max-age=31536000; includeSubDomains, no preload` configured | Example 1 (`header` directive in Caddyfile), Pitfall 7 (HSTS pinning brick) |
| SEC-02 | VM hardening: ufw allows only 23333/80/443 (per D-12); SSH key-only; unattended-upgrades enabled; non-root deploy user with sudo | Pattern 3 (ssh.socket), Pattern 5 (unattended-upgrades), Pattern 6 (ufw safe order), Example 3 (sshd drop-ins), Example 4 (ufw commands), Example 8 (nmap verify), Pitfall 5 (lockout) |
| OPS-01 | `/health` returns 200 OK without touching DB; verified by `docker compose stop db` | D-18 (no code change); main.py:33-40 already DB-independent; Example 7 pattern adapted for `stop db` instead of `stop caddy` |
| OPS-02 | UptimeRobot free-tier monitor pings `/health` every 5 min; email alert on failure | Pattern: account creation in runbook; Example 7 (downtime drill); D-21/D-22/D-23 locked; Pitfall 6 (UptimeRobot DNS lag) |

## Sources

### Primary (HIGH confidence)
- [Caddy automatic-https documentation](https://caddyserver.com/docs/automatic-https) — `/data` persistence, default ACME CAs
- [Caddy Caddyfile global options](https://caddyserver.com/docs/caddyfile/options) — `acme_ca` directive syntax + default = LE prod + ZeroSSL
- [Caddy tls directive](https://caddyserver.com/docs/caddyfile/directives/tls) — site-block `tls { issuer acme { ca <url> } }` alternative
- [Let's Encrypt rate limits](https://letsencrypt.org/docs/rate-limits/) — 50 certs / domain / week; 5 duplicate / identical SAN set / week
- [Let's Encrypt staging environment](https://letsencrypt.org/docs/staging-environment/) — staging URL `https://acme-staging-v02.api.letsencrypt.org/directory`
- [Docker Engine install on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) — official apt repo, GPG key, deb822 sources, package list
- [Ubuntu automatic updates docs](https://ubuntu.com/server/docs/how-to/software/automatic-updates/) — `/etc/apt/apt.conf.d/50unattended-upgrades` and `20auto-upgrades` exact lines
- [Caddy Docker Hub official](https://hub.docker.com/_/caddy) — arm64v8 supported; current tag 2.11.3-alpine
- [Cloudflare DNS proxy status docs](https://developers.cloudflare.com/dns/proxy-status/) — grey-cloud vs orange-cloud semantics
- [Cloudflare Registrar TLDs](https://domains.cloudflare.com/tld-policies) — 400+ TLDs supported

### Secondary (MEDIUM confidence — verified via secondary sources)
- [Understanding SSH Socket-Based Activation in Ubuntu 24.04 (dev.to)](https://dev.to/saishanmukkha/understanding-ssh-socket-based-activation-in-ubuntu-2404-28m) — corroborates 4sysops + Launchpad bug 2069041
- [Don't Lock Yourself Out: UFW + SSH (dev.to)](https://dev.to/marcoz/dont-lock-yourself-out-enabling-ufw-on-a-linux-server-without-breaking-ssh-2p7o) — corroborates DigitalOcean UFW essentials guide
- [UptimeRobot pricing](https://uptimerobot.com/pricing/) + [stillup.org Free Plan analysis](https://stillup.org/blog/uptimerobot-free-plan-limits) — 50 monitors, 5-min interval, email alerts, personal-use-only since Dec 2024
- [Oracle Cloud Always Free networking docs](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/scenarioa.htm) — Public subnet scenario (VCN + IG + SL)

### Tertiary (LOWER confidence — single source or community knowledge, flagged for validation)
- [Medium article on OCI capacity retry](https://medium.com/@me69oshan/get-always-free-vm-instance-in-oracle-cloud-and-solve-out-of-host-capacity-issue-the-easy-way-88babae4eae5) — retry-script tactic
- [Grokipedia Oracle Cloud Always Free Tier](https://grokipedia.com/page/Oracle_Cloud_Always_Free_Tier) — Phoenix/Ashburn capacity preference
- [DEV.to: Opening ports 80/443 on Oracle Cloud](https://dev.to/armiedema/opening-up-port-80-and-443-for-oracle-cloud-servers-j35) — pre-baked iptables on some Ubuntu images (older); Ubuntu 24.04 Minimal generally clean per assumption A1

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every component is upstream-official, verified against Docker Hub / Caddy docs / Ubuntu docs
- Architecture: HIGH — patterns 1-6 are documented and verified; pattern 8 (OCI capacity) is MEDIUM due to capacity-availability variance
- Pitfalls: HIGH — each is sourced; #4 (iptables on Oracle) is MEDIUM (assumption A1)
- LE rate-limit count (50 vs ROADMAP's "5"): HIGH — verified against official LE docs; ROADMAP citation was stale, retroactively explained in State of the Art

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (30 days — stable domain, Caddy + LE + Ubuntu unlikely to break)

---

*Phase: 06-provision-oracle-vm-domain-caddy-https*
*Research generated by gsd-researcher*
