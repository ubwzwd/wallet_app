# infra/RUNBOOK.md — Provision a fresh wallet-app production VM

**Audience:** the operator (you, future-you, or a teammate).
**Estimated time:** ~60 min for a clean re-provision (domain already owned, SSH key already generated); 90–180 min for first-time setup (Oracle capacity hunting + domain registration).
**Outcome:** `https://<your-domain>` serves the wallet app from an Oracle A1.Flex VM with a real Let's Encrypt cert, a hardened OS baseline, and a green UptimeRobot monitor.

This runbook is the procedural source of truth for Phase 6 (DEPLOY-05). It walks you from "Oracle account exists, no VM yet" to a fully provisioned production environment. Each section ends with an **Expected outcome** or **Sanity check** block so you know when to proceed. Two procedural gates are HARD requirements: the DNS-propagation gate in §8 (DNS must resolve before Caddy starts) and the LE staging-before-prod two-commit gate in §10→§11. Skipping either gate burns Let's Encrypt rate-limit attempts and may require waiting up to a week before you can issue a clean production cert.

---

## Table of Contents

- [§0. Prerequisites checklist](#0-prerequisites-checklist)
- [§1. Register the domain (Cloudflare Registrar)](#1-register-the-domain-cloudflare-registrar)
- [§2. Provision the Oracle Cloud VM (A1.Flex Always Free)](#2-provision-the-oracle-cloud-vm-a1flex-always-free)
- [§3. First SSH (port 22, default ubuntu user)](#3-first-ssh-port-22-default-ubuntu-user)
- [§4. Harden SSH (port 23333, key-only)](#4-harden-ssh-port-23333-key-only)
- [§5. Create deploy user + ufw + unattended-upgrades](#5-create-deploy-user--ufw--unattended-upgrades)
- [§6. Install Docker + Compose v2](#6-install-docker--compose-v2)
- [§7. Add Cloudflare DNS A record (grey cloud)](#7-add-cloudflare-dns-a-record-grey-cloud)
- [§8. Wait for DNS propagation](#8-wait-for-dns-propagation)
- [§9. Clone repo + author .env (staging LE endpoint)](#9-clone-repo--author-env-staging-le-endpoint)
- [§10. First `docker compose up` → verify staging cert](#10-first-docker-compose-up--verify-staging-cert)
- [§11. Flip to LE production](#11-flip-to-le-production)
- [§12. Verify /health DB-independence](#12-verify-health-db-independence)
- [§13. External port scan from laptop](#13-external-port-scan-from-laptop)
- [§14. UptimeRobot signup + monitor](#14-uptimerobot-signup--monitor)
- [§15. Deliberate downtime drill](#15-deliberate-downtime-drill)
- [§16. Final verification](#16-final-verification)
- [Appendix A: SSH config snippet](#appendix-a-ssh-config-snippet)
- [Appendix B: Oracle A1.Flex Out-of-Capacity retry tactic](#appendix-b-oracle-a1flex-out-of-capacity-retry-tactic)
- [Appendix C: Common operational commands](#appendix-c-common-operational-commands)
- [Appendix D: Recovery — Oracle serial console](#appendix-d-recovery--oracle-serial-console)

---

## 0. Prerequisites checklist

Confirm all of the following before starting:

- [ ] Oracle Cloud account exists and is Always Free eligible — A1.Flex shape available in your tenancy. (Sign up at `https://cloud.oracle.com` if not. Free tier requires a valid credit card for identity verification but will not be charged unless you manually upgrade.)
- [ ] Local laptop has these tools installed (run the sanity-check block below):
  - `ssh` (OpenSSH client)
  - `dig` (BIND utilities — `brew install bind` on macOS, `apt install dnsutils` on Linux)
  - `curl`
  - `nmap` (`brew install nmap` on macOS, `apt install nmap` on Linux)
  - `git`
  - `docker` and `docker compose` v2 (the two-word plugin form)
- [ ] SSH keypair: either generate a fresh ed25519 key now (recommended) or have an existing `ed25519` key path ready.
- [ ] Domain: budget ~10 minutes if not yet owned; skip §1 if already owned and registered at Cloudflare.

**Sanity-check local tooling:**

```bash
dig --version        # Should print DiG version
nmap --version       # Should print Nmap version
docker compose version
# Should print: Docker Compose version v2.x.x
# Note: "docker compose" (two words) — v2 plugin syntax. NOT "docker-compose" (deprecated v1).
```

**Generate SSH keypair** (skip if you already have one to use):

```bash
ssh-keygen -t ed25519 -C wallet-app-oracle -f ~/.ssh/wallet_app_oracle
# Passphrase: empty or operator-chosen (both work; empty is required for Phase 7 automated deploys)
cat ~/.ssh/wallet_app_oracle.pub
# Copy this output — you will paste it into the Oracle console at §2 step 5.
```

> **Expected outcome:** All tools report version numbers; `~/.ssh/wallet_app_oracle.pub` exists.

---

## 1. Register the domain (Cloudflare Registrar)

_Pure dashboard click-through. No shell commands._

This runbook treats the domain as `<your-domain>` throughout — the specific name is your choice. Register any TLD that Cloudflare Registrar supports: `.com`, `.net`, `.org`, `.io`, `.dev`, `.app`, `.co`, and many others (verify the supported list in the dashboard before purchase).

1. Sign in to Cloudflare at `https://dash.cloudflare.com`.
2. In the left sidebar: **Domain Registration** → **Register Domains**.
3. Search for the domain name you want. Confirm the TLD is on the supported list.
4. Complete the purchase (at-cost pricing — no markup, no upsells).
5. Cloudflare automatically assigns its own nameservers (`<x>.ns.cloudflare.com`) — no separate NS change step needed.
6. Note the ICANN 60-day registrar lock: new registrations cannot be transferred OUT for 60 days. This does not block any operation in this runbook.

> **Expected outcome:** Domain visible in Cloudflare dashboard → **DNS** → **Records** with two NS records (`<x>.ns.cloudflare.com`).

> **Note:** If you already own the domain elsewhere, transferring to Cloudflare is out of scope for Phase 6. Either buy a fresh domain at Cloudflare now, or transfer it in a follow-up step before continuing past §7.

---

## 2. Provision the Oracle Cloud VM (A1.Flex Always Free)

_Pure Oracle Cloud console click-through. No shell commands._

> **If "Out of capacity" appears at any step:** jump to Appendix B before continuing.

1. **Choose Home Region** when signing up or confirm your existing tenancy's region. Prefer **US East (Ashburn)** or **US West (Phoenix)** — these have the most consistent A1.Flex capacity. **Important:** Home Region is a one-time, irreversible choice at tenancy creation. If your tenancy is already in Singapore/Tokyo/Sydney, see Appendix B before proceeding.

2. **Create or select a Compartment:** In the top navigation, select **Identity & Security** → **Compartments**. Use root compartment, or create a new one named `wallet-app`.

3. **Create VCN with public subnet + Internet Gateway:**
   - Go to **Networking** → **Virtual Cloud Networks** → **Start VCN Wizard**.
   - Choose **Create VCN with Internet Connectivity**.
   - Name: `wallet-app-vcn`. Leave subnet defaults. Complete the wizard.
   - This creates a public subnet with a route table pointing to an Internet Gateway automatically.

4. **Reserve a public IP:**
   - Go to **Networking** → **Reserved Public IPs** → **Reserve Public IP Address**.
   - Name: `wallet-app-prod-ip`.
   - Note the assigned IP address — this is `<vm-ip>` for the rest of the runbook.

5. **Create the VM instance:**
   - Go to **Compute** → **Instances** → **Create instance**.
   - Name: `wallet-app-prod`
   - **Image:** Ubuntu 24.04 Minimal (ARM64) — click **Change image**, search for Ubuntu 24.04. Select the **Minimal** variant.
   - **Shape:** Click **Change shape** → **Ampere** → **VM.Standard.A1.Flex**. Set **Number of OCPUs: 2** and **Amount of memory: 12 GB**. (This is the maximum Always Free allocation.)
   - **Networking:** Select your VCN and the public subnet. For **Public IPv4 address**, choose **Assign a reserved public IP** and select `wallet-app-prod-ip`.
   - **SSH keys:** Select **Paste public keys** and paste the contents of `~/.ssh/wallet_app_oracle.pub`.
   - Click **Create**. Wait for instance state to show **Running** (typically 2–5 minutes).

6. **Open Security List ingress rules:**
   - Go to **Networking** → **Virtual Cloud Networks** → `wallet-app-vcn` → your public subnet → **Security Lists** → the default security list.
   - Add three **Ingress Rules** (stateless = no, protocol = TCP):
     - Source CIDR: `0.0.0.0/0`, Destination Port Range: `23333` (SSH custom port)
     - Source CIDR: `0.0.0.0/0`, Destination Port Range: `80` (HTTP — required for Let's Encrypt HTTP-01 challenge)
     - Source CIDR: `0.0.0.0/0`, Destination Port Range: `443` (HTTPS)
   - Note: ufw on the VM is the real enforcement layer; the security list is a defense-in-depth outer layer. Both must allow these ports.

> **Expected outcome:** VM in Running state, `<vm-ip>` assigned, security list shows TCP 23333/80/443 ingress rules.

---

## 3. First SSH (port 22, default ubuntu user)

From your laptop, connect to the VM using the default ubuntu user on the default port 22:

```bash
ssh -i ~/.ssh/wallet_app_oracle ubuntu@<vm-ip>
# First connection: your terminal will ask you to confirm the host fingerprint.
# Type "yes" and press Enter.
```

Sanity check on the VM:

```bash
whoami
# Expected: ubuntu
uname -a
# Expected: ... aarch64 ... Ubuntu ...
lsb_release -a
# Expected: Ubuntu 24.04 LTS
```

From here, the runbook assumes you are logged in to the VM as `ubuntu` until §5 creates the `deploy` user.

> **Expected outcome:** Logged in as `ubuntu` on the VM; `uname -a` shows aarch64 Ubuntu 24.04.

---

## 4. Harden SSH (port 23333, key-only)

> **CRITICAL: DO NOT close your current SSH session (on port 22) until you have a confirmed working session on port 23333 in a second terminal. If you close the first session before confirming the second works, you will be locked out — recovery requires the Oracle serial console (Appendix D, slower path).**

The following commands are run on the VM as `ubuntu` with sudo.

**4a. Create the sshd hardening drop-in:**

```bash
sudo mkdir -p /etc/ssh/sshd_config.d
sudo tee /etc/ssh/sshd_config.d/99-wallet-hardening.conf >/dev/null <<'EOF'
Port 23333
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
cat /etc/ssh/sshd_config.d/99-wallet-hardening.conf
# Expected: shows the 5 config lines above
```

**4b. Override the ssh.socket listen port** (Ubuntu 24.04 uses systemd socket activation — editing sshd_config Port alone is NOT sufficient):

```bash
sudo mkdir -p /etc/systemd/system/ssh.socket.d
sudo tee /etc/systemd/system/ssh.socket.d/listen.conf >/dev/null <<'EOF'
[Socket]
ListenStream=
ListenStream=23333
EOF
# The empty "ListenStream=" clears the inherited port-22 default.
# The second "ListenStream=23333" sets the new port.
```

**4c. Reload and restart the socket:**

```bash
sudo systemctl daemon-reload
sudo systemctl restart ssh.socket
# No output on success.
```

**4d. VERIFY IN A SECOND TERMINAL — DO NOT close the first session:**

Open a brand-new terminal on your laptop and run:

```bash
# From laptop, second terminal:
ssh -p 23333 -i ~/.ssh/wallet_app_oracle ubuntu@<vm-ip>
# Expected: connection succeeds, no "Connection refused" or timeout.
whoami
# Expected: ubuntu
```

Only after this second connection succeeds, close the first session.

> **Expected outcome:** SSH on port 23333 works; SSH on port 22 is no longer listening (verifiable in §13 nmap scan). The original port-22 session can be closed.

---

## 5. Create deploy user + ufw + unattended-upgrades

Three sub-steps, executed in order. All commands run as `ubuntu` with sudo (or as `deploy` once created).

### 5a. Create `deploy` user with NOPASSWD sudo

```bash
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG sudo deploy
echo 'deploy ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/deploy
sudo chmod 0440 /etc/sudoers.d/deploy
# Copy authorized keys from ubuntu to deploy
sudo mkdir -p /home/deploy/.ssh
sudo cp /home/ubuntu/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Verify in a third terminal on your laptop:

```bash
# From laptop, third terminal:
ssh -p 23333 -i ~/.ssh/wallet_app_oracle deploy@<vm-ip>
whoami
# Expected: deploy
```

From here, the runbook assumes you are logged in to the VM as `deploy`.

### 5b. Configure ufw — 23333/80/443 only

**Pre-flight check (Pitfall 4 — Oracle image iptables):**

```bash
sudo iptables -L INPUT -n | head -20
# Ubuntu 24.04 Minimal is generally clean (no pre-baked rules).
# If output shows non-ufw DROP/REJECT chains, do NOT flush blindly — contact Oracle support or see Appendix D.
# If the output is empty or shows only policy ACCEPT, proceed.
```

Apply ufw rules in this exact order (order matters — SSH port must be allowed BEFORE `ufw enable`):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 23333/tcp comment 'SSH custom port'
sudo ufw allow 80/tcp     comment 'HTTP for Lets Encrypt HTTP-01 challenge'
sudo ufw allow 443/tcp    comment 'HTTPS'
sudo ufw enable
# Answer 'y' to the lockout warning prompt.
sudo ufw status verbose
# Expected: Status: active
# Expected ports: 23333/tcp, 80/tcp, 443/tcp — nothing else
```

> **CRITICAL:** Do NOT add `ufw allow 22/tcp` even as a temporary safety net. The existing SSH session on port 22 persists (stateful connection), but we want port 22 closed to new connections permanently. If the ufw step goes wrong and you need recovery, use the Oracle serial console (Appendix D) — not port 22.

Verify in a fourth terminal on your laptop that `deploy` on port 23333 still works:

```bash
ssh -p 23333 deploy@<vm-ip>   # uses ~/.ssh/config if you set it up, else add -i flag
# Expected: logs in normally
```

### 5c. Configure unattended-upgrades (security updates only, auto-reboot disabled)

```bash
sudo apt update
sudo apt install -y unattended-upgrades
```

Edit `/etc/apt/apt.conf.d/50unattended-upgrades` so only the security origin patterns are uncommented:

```bash
sudo tee /etc/apt/apt.conf.d/50unattended-upgrades >/dev/null <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

Unattended-Upgrade::Automatic-Reboot "false";
EOF
```

Edit `/etc/apt/apt.conf.d/20auto-upgrades` to enable daily checks and automatic upgrade:

```bash
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
```

Verify:

```bash
sudo unattended-upgrade --dry-run --debug | head -20
# Expected: lists candidate security packages without errors
sudo systemctl status apt-daily-upgrade.timer
# Expected: active (waiting)
```

> **Expected outcome:** `deploy` user exists with NOPASSWD sudo; ufw active with only 23333/80/443 reachable; unattended-upgrades scheduled for the Ubuntu security pocket with `Automatic-Reboot "false"`.

---

## 6. Install Docker + Compose v2

All commands run on the VM as `deploy` with sudo.

**6a. Install prerequisites and Docker GPG key:**

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

**6b. Add Docker apt sources (deb822 format, arm64):**

```bash
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
```

**6c. Install Docker Engine, CLI, containerd, and Compose plugin:**

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**6d. Add `deploy` to the docker group** (so `deploy` can run docker without sudo):

```bash
sudo usermod -aG docker deploy
# IMPORTANT: deploy must log out and back in for group membership to take effect.
exit
# Reconnect: ssh -p 23333 deploy@<vm-ip>
```

After reconnecting, verify:

```bash
docker compose version
# Expected: Docker Compose version v2.x.x
# Note: "docker compose" (two words) is the v2 plugin. NOT "docker-compose" (deprecated v1).
docker run --rm hello-world
# Expected: "Hello from Docker!" message — confirms Docker daemon is working.
```

> **Expected outcome:** `docker compose version` returns v2.x.x; `docker run hello-world` succeeds without sudo.

---

## 7. Add Cloudflare DNS A record (grey cloud)

_Pure Cloudflare dashboard click-through. No shell commands._

1. Go to `https://dash.cloudflare.com` → select `<your-domain>` → **DNS** → **Records** → **Add record**.
2. **Type:** `A`
3. **Name:** `@` (apex — the `@` symbol represents the root of the domain)
4. **IPv4 address:** `<vm-ip>` (the reserved public IP from §2 step 4)
5. **Proxy status:** **DNS only** (grey cloud). If the icon shows an orange cloud, click it once to toggle it to grey. **This step is mandatory** — orange-cloud would proxy traffic through Cloudflare, breaking the Let's Encrypt HTTP-01 challenge in §10.
6. **TTL:** `Auto`
7. Click **Save**.

> **Expected outcome:** DNS record visible in the Cloudflare dashboard showing Type A, Name @, Content `<vm-ip>`, Proxy status = DNS only (grey cloud icon).

> **Note:** Do NOT add a `www` CNAME in this phase — apex-only deployment. `www` redirect is deferred to a later milestone.

---

## 8. Wait for DNS propagation

> **CRITICAL (Pitfall 2): DO NOT proceed to §9 until `dig` confirms the A record from a public resolver. Skipping this gate means Caddy's first start will attempt the HTTP-01 challenge before the domain resolves to your VM. The challenge fails, and the failure counts against your Let's Encrypt rate-limit budget — even for the staging endpoint.**

Run this loop from your **laptop** (NOT from the VM — you must use an external public resolver to avoid local DNS cache):

```bash
DOMAIN="<your-domain>"
EXPECTED_IP="<vm-ip>"

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

Cross-check from a second public resolver to confirm:

```bash
dig @8.8.8.8 "$DOMAIN" +short
# Expected: same $EXPECTED_IP
```

> **Expected outcome:** Both `1.1.1.1` and `8.8.8.8` return the VM IP. DNS typically propagates within 1–5 minutes of the Cloudflare save. Only proceed to §9 after both resolvers return the correct IP.

---

## 9. Clone repo + author .env (staging LE endpoint)

**9a. Set up SSH config alias on your LAPTOP for convenience** — add to `~/.ssh/config`:

```
Host wallet-app
    HostName <vm-ip>
    User deploy
    Port 23333
    IdentityFile ~/.ssh/wallet_app_oracle
```

From here on, `ssh wallet-app` is equivalent to `ssh -p 23333 -i ~/.ssh/wallet_app_oracle deploy@<vm-ip>`. See Appendix A for the full snippet.

**9b. Clone the repo on the VM:**

```bash
ssh wallet-app   # or: ssh -p 23333 -i ~/.ssh/wallet_app_oracle deploy@<vm-ip>
cd ~
git clone https://github.com/<your-org>/wallet_app.git
cd wallet_app/infra
```

**9c. Author `.env` from the example:**

```bash
cp .env.example .env
```

**9d. Immediately apply `chmod 600` (Pitfall 9 — SEC-01 enforcement on the VM):**

```bash
chmod 600 .env
chown deploy:deploy .env
ls -la .env
# Expected: -rw------- 1 deploy deploy ... .env
```

> **IMPORTANT:** This is the Phase 6 enforcement of Phase 4's deferred `chmod 600` requirement. Do NOT skip this step — a world-readable `.env` exposes `SECRET_KEY` and `POSTGRES_PASSWORD` to any user on the box.

**9e. Edit `.env`** using `vim` or `nano`. Replace every `CHANGE_ME_*` placeholder with a real value:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: choose strong values.  
  Generate a secure password: `openssl rand -base64 24`
- `SECRET_KEY`: **regenerate for production** — `openssl rand -hex 32`. Do NOT reuse a laptop dev value.
- `ALLOWED_ORIGINS`: set to `https://<your-domain>` — single origin, HTTPS scheme, no trailing slash.
- `CADDY_DOMAIN`: set to `<your-domain>` — bare hostname, no scheme, no trailing slash.
- `CADDY_TLS_MODE`: **comment out or delete this line entirely** (removing it causes Caddy to fall back to ACME instead of the internal self-signed cert).
- `CADDY_ACME_CA`: set to `https://acme-staging-v02.api.letsencrypt.org/directory` — **Commit A staging URL. DO NOT REMOVE until staging cert is verified in §10.**

**9f. Pre-flight validation block (Pitfall 1 guard):**

Run these checks immediately before `docker compose up`. All four must return the expected values:

```bash
grep '^CADDY_DOMAIN=' .env
# Expected: CADDY_DOMAIN=<your-domain>

grep '^CADDY_ACME_CA=' .env
# Expected: CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory

grep '^ALLOWED_ORIGINS=' .env
# Expected: ALLOWED_ORIGINS=https://<your-domain>

grep '^CADDY_TLS_MODE' .env || echo "OK: CADDY_TLS_MODE removed/commented as expected"
# Expected: empty grep result + the OK message
```

> **Expected outcome:** `.env` exists, is `chmod 600`, has the staging `CADDY_ACME_CA` URL, and `CADDY_TLS_MODE` is absent.

---

## 10. First `docker compose up` → verify staging cert

All commands on the VM as `deploy`, from `~/wallet_app/infra`.

**10a. Build the frontend bundle and copy it to the VM:**

Build on the laptop (recommended — keeps Node off the production VM):

```bash
# From laptop, in the repo root:
cd frontend
npm install
npm run build:web
scp -P 23333 -r dist deploy@<vm-ip>:~/wallet_app/frontend/
```

Alternative: build directly on the VM (requires Node.js):

```bash
# On VM — only if you prefer not to scp:
sudo apt-get install -y nodejs npm
cd ~/wallet_app/frontend
npm install
npm run build:web
```

**10b. Bring up the stack:**

```bash
cd ~/wallet_app/infra
docker compose -f docker-compose.prod.yml up -d --build --wait
```

First start takes 3–5 minutes: `db` starts → `migrate` runs (alembic upgrade head) → `api` becomes healthy → `caddy` starts and immediately attempts the HTTP-01 challenge against the LE staging endpoint.

**10c. Verify the staging cert was issued:**

```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -iE "obtained certificate|certificate obtained"
# Expected: a log line referencing issuance. Issuer will reference "STAGING" or "Pretend Pear".
docker compose -f docker-compose.prod.yml logs caddy | grep -iE "staging|pretend|fake"
# Expected: matches present — confirming it is the staging cert, not a production cert.
```

**10d. CRITICAL CALLOUT (Pitfall 7 — HSTS + staging cert = browser brick):**

> Open `https://<your-domain>/` **ONLY in a private/incognito browser window**. The staging cert is signed by "(STAGING) Pretend Pear X1" or similar — your browser will warn that the cert is untrusted. If you open it in a regular (non-incognito) browser window, the HSTS header (`max-age=31536000`) will be pinned in your browser's HSTS store, bricking HTTPS access to that domain for up to one year even after the real cert is issued. Incognito mode discards HSTS pins when the window is closed.

In the incognito window:

- You will see a browser security warning. Click **Advanced** → **Proceed anyway** (wording varies by browser).
- Confirm the wallet app loads.
- Open DevTools → Security tab → confirm the cert subject matches `<your-domain>` and the issuer references "STAGING", "Pretend Pear", or "Fake LE Root".

**10e. Record staging verification (conceptual Commit A gate):**

```bash
mkdir -p ~/wallet_app/infra/runbook-evidence
echo "Commit A (staging) verified at $(date -u +%FT%TZ)" >> ~/wallet_app/infra/runbook-evidence/staging-verified.log
```

> **Expected outcome:** Staging cert issued; site reachable via incognito (with browser warning); cert subject matches `<your-domain>` and issuer references STAGING. Only proceed to §11 after this is confirmed.

---

## 11. Flip to LE production

> **PROCEDURAL GATE (D-05 TWO-COMMIT pattern): Only proceed past §10 once §10's incognito verification succeeds. Do NOT jump from §9 directly to §11 — that defeats the staging-first requirement and risks burning a LE production rate-limit attempt on a misconfigured setup.**

All commands on the VM as `deploy`, from `~/wallet_app/infra`.

**11a. Set `CADDY_ACME_CA` to empty in `.env`** (single-line change):

```bash
cd ~/wallet_app/infra
sed -i 's|^CADDY_ACME_CA=.*|CADDY_ACME_CA=|' .env
grep '^CADDY_ACME_CA=' .env
# Expected: CADDY_ACME_CA=  (empty value — Caddy Caddyfile default = LE prod)
```

**11b. Restart Caddy only** (preserves the `caddy_data` named volume — Pitfall 8):

```bash
docker compose -f docker-compose.prod.yml restart caddy
```

> **CRITICAL CALLOUT (Pitfall 8): NEVER use `docker compose down -v` on this VM.** The `-v` flag removes named volumes. `caddy_data` loss burns your Let's Encrypt Duplicate Certificate budget (5 issuances/week per identical SAN set); `wallet_pgdata_prod` loss destroys all user data. Use `restart`, `stop`, `start`, or `up -d` only. See Appendix C for the safe alternatives.

**11c. Verify the LE production cert is issued** (allow ~30 seconds for Caddy to reissue):

```bash
sleep 30
docker compose -f docker-compose.prod.yml logs --tail 50 caddy | grep -iE "obtained certificate|certificate obtained"
# Expected: a new log line. It must NOT reference "STAGING" or "Pretend Pear" or "Fake LE Root".
```

**11d. Confirm from your laptop** (regular browser — the LE prod cert IS browser-trusted):

```bash
curl -vI "https://<your-domain>/" 2>&1 | grep -iE 'issuer|subject'
# Expected: issuer line contains "Let's Encrypt" (R3, R10, or E1 — NOT "STAGING").
```

Open `https://<your-domain>/` in your **regular** (non-incognito) browser. Expected: no certificate warning. Padlock icon present. App loads.

**11e. Record production verification (conceptual Commit B gate):**

```bash
echo "Commit B (LE production flip) verified at $(date -u +%FT%TZ)" >> ~/wallet_app/infra/runbook-evidence/prod-verified.log
```

> **Expected outcome:** Real LE production cert in browser (padlock, no warning); `curl -vI` confirms LE prod issuer; HSTS header active on responses (verified in §16 final script).

---

## 12. Verify /health DB-independence

**Background:** ROADMAP Phase 6 SC4 requires that `GET /health` returns 200 OK without touching the database — a DB outage must not kill the API container. The existing endpoint at `backend/app/main.py:33-40` is already DB-independent by construction. This section formally verifies that property end-to-end on the live VM.

All commands on the VM as `deploy`, from `~/wallet_app/infra`.

**12a. Confirm baseline** (DB up, /health works):

```bash
curl -sf https://<your-domain>/health | python3 -m json.tool
# Expected JSON: {"status":"healthy","environment":"production","version":"0.1.0"}
```

**12b. Stop the DB container:**

```bash
docker compose -f docker-compose.prod.yml stop db
docker compose -f docker-compose.prod.yml ps db
# Expected: db state = exited
```

**12c. Verify /health still returns 200 with the DB stopped:**

```bash
time curl -sf https://<your-domain>/health | python3 -m json.tool
# Expected JSON: same {"status":"healthy",...} as the baseline — no error, no 503
# Expected time: well under 1 second wall clock (the /health endpoint never touches the DB)
```

**12d. Restore the DB:**

```bash
docker compose -f docker-compose.prod.yml start db
docker compose -f docker-compose.prod.yml ps db
# Wait for db to become healthy (~10–30 seconds)
PGUSER=$(grep ^POSTGRES_USER .env | cut -d= -f2)
docker compose -f docker-compose.prod.yml exec db pg_isready -U "$PGUSER"
# Expected: /var/run/postgresql:5432 - accepting connections
```

**12e. Record the result:**

```bash
mkdir -p ~/wallet_app/infra/runbook-evidence
echo "OPS-01 / SC4 DB-independence verified at $(date -u +%FT%TZ)" >> ~/wallet_app/infra/runbook-evidence/health-db-independence.log
```

> **Expected outcome:** `/health` returns 200 JSON with the DB container stopped, confirming DB outage does not kill the API container (OPS-01 / SC4 satisfied).

---

## 13. External port scan from laptop

Run this from your **laptop** — the scan must originate from outside the VM to verify that ufw and the Oracle security list together expose exactly the three allowed ports.

**Broad scan** (confirms no unexpected ports are open — takes 30–90 seconds):

```bash
nmap -Pn -p 1-65535 <vm-ip>
# Expected: only TCP 23333, 80, 443 shown as "open"; all other ports as "closed" or "filtered"
```

**Targeted spot-check** (faster — asserts exactly what `verify-phase6.sh` asserts):

```bash
nmap -Pn -p 22,23333,80,443 <vm-ip>
```

Expected output:

```
22/tcp     closed   ssh        (or filtered)
23333/tcp  open     unknown
80/tcp     open     http
443/tcp    open     https
```

**Save the scan result as evidence:**

```bash
nmap -Pn -p 22,23333,80,443 <vm-ip> -oN infra/runbook-evidence/nmap-scan.txt
# Commit this file — it is plain text (not a PNG), so it is NOT gitignored.
```

> **Expected outcome:** nmap shows exactly three allowed ports reachable (23333/80/443). Port 22 is closed or filtered. This satisfies D-15 / SC3 per the ROADMAP literal "ufw allows only 23333/80/443".

---

## 14. UptimeRobot signup + monitor

_Dashboard click-through. No shell commands._

**14a. Sign up** at `https://uptimerobot.com` (free tier — no credit card required). Verify the confirmation email.

**14b. Add a monitor:**

1. Click **+ Add New Monitor** from the dashboard.
2. **Monitor Type:** `HTTPS`
3. **Friendly Name:** `wallet-app prod /health`
4. **URL (or IP):** `https://<your-domain>/health`
5. **Monitoring Interval:** `5 minutes` (this is the free-tier minimum)
6. **Alert Contacts:** Select your verified email address. (UptimeRobot sends a "Please verify this contact" email at this step — click the link in that email to activate the alert destination before continuing.)
7. Click **Create Monitor**.

**14c. Wait for the first probe cycle:**

Wait 5–10 minutes for UptimeRobot's probe servers to complete their first check cycle.

**14d. CRITICAL CALLOUT (Pitfall 6):**

> If the monitor shows "Down" immediately after creation, **wait one full check cycle (5 minutes)** before troubleshooting. UptimeRobot's probe servers may not yet have resolved the DNS A record you created in §7. Only investigate further if "Down" persists past 10 minutes. Confirm locally first: `curl -sf https://<your-domain>/health` from your laptop must work before suspecting UptimeRobot.

> **Expected outcome:** UptimeRobot dashboard shows the monitor as "Up" with a green status indicator. Per D-23, this is the only monitor — no separate TLS-cert-expiry or root-URL monitor is needed.

---

## 15. Deliberate downtime drill

**This section produces the SC5 evidence artifact.** `verify-phase6.sh full` checks that `infra/runbook-evidence/uptime-alert.png` is non-empty. Do not skip this section.

**15a. Confirm baseline:** UptimeRobot dashboard shows the monitor as "Up".

**15b. Stop Caddy** (Caddy is the only container listening on port 443 — stopping it makes `/health` unreachable from the internet):

```bash
ssh wallet-app   # or: ssh -p 23333 deploy@<vm-ip>
cd ~/wallet_app/infra
docker compose -f docker-compose.prod.yml stop caddy
docker compose -f docker-compose.prod.yml ps caddy
# Expected: caddy state = exited
```

**15c. Wait for the UptimeRobot alert:**

Wait up to 10 minutes. The UptimeRobot free tier requires 2 consecutive failed probes (at 5-minute intervals) before sending an alert. The alert email arrives in your verified inbox.

**15d. Screenshot the alert email:**

Open the alert email in your email client. Take a screenshot and save it as:

```
infra/runbook-evidence/uptime-alert.png
```

(PNG files in `infra/runbook-evidence/` are gitignored per Plan 02 — the file lives on the operator's laptop and on the VM, but is committed to the repo as the final SC5 evidence step below.)

**15e. Commit the screenshot to the repo:**

```bash
# On the VM or laptop (wherever the repo checkout is):
cd ~/wallet_app
git add infra/runbook-evidence/uptime-alert.png
git commit -m "evidence(06): SC5 UptimeRobot downtime alert screenshot"
git push
```

Note: the `.gitignore` rule for `infra/runbook-evidence/*.png` is negated by `!infra/runbook-evidence/uptime-alert.png` (or the rule was written to allow specific filenames). Verify the file stages with `git add` before committing.

**15f. Restore Caddy:**

```bash
docker compose -f docker-compose.prod.yml start caddy
docker compose -f docker-compose.prod.yml ps caddy
# Wait ~30 seconds for Caddy to become healthy
sleep 30
curl -sf https://<your-domain>/health | python3 -m json.tool
# Expected: {"status":"healthy",...}
```

**15g. Confirm UptimeRobot returns to "Up"** within one probe cycle (5 minutes).

> **Expected outcome:** `infra/runbook-evidence/uptime-alert.png` committed to the repo (non-empty); UptimeRobot returns to "Up"; SC5 evidence captured and verifiable by `verify-phase6.sh full`.

---

## 16. Final verification

Run both modes of the verifier from your **laptop** (or from the VM — both have a checkout of the repo):

**Quick mode** (local static file checks — no VM needed):

```bash
cd <path-to>/wallet_app
bash infra/scripts/verify-phase6.sh quick
# Expected last line: OK: Phase 6 quick verify green
```

**Full mode** (against the live VM):

```bash
bash infra/scripts/verify-phase6.sh full <your-domain> <vm-ip>
# Expected last line: OK: Phase 6 full verify green
```

If full mode fails, the failing assertion is printed to stdout (e.g., `FAIL: HSTS header missing`). Cross-reference the named check with the section that establishes that property:

| Failing check | Section to revisit |
|---------------|--------------------|
| DNS does not resolve | §7, §8 |
| HTTPS 200 fails | §10, §11 |
| TLS cert is still staging | §11 |
| HSTS header missing | §11 (Caddy restart) |
| Port 22 unexpectedly open | §4, §5b |
| /health JSON missing | §12 |
| Evidence screenshot missing | §15 |

> **Expected outcome:** Both modes exit 0. Phase 6 is complete.

---

## Appendix A: SSH config snippet

Add this block to `~/.ssh/config` on your laptop:

```
Host wallet-app
    HostName <vm-ip>
    User deploy
    Port 23333
    IdentityFile ~/.ssh/wallet_app_oracle
```

Usage: `ssh wallet-app` is now equivalent to `ssh -p 23333 -i ~/.ssh/wallet_app_oracle deploy@<vm-ip>`. For `scp`, use `-P 23333` and `deploy@wallet-app:<path>` syntax (note: `scp` uses uppercase `-P` for port). Restart any existing shell session to pick up the new config.

---

## Appendix B: Oracle A1.Flex Out-of-Capacity retry tactic

A1.Flex Always Free capacity is the single hardest part of Phase 6. Real-world reports vary week-to-week, but "Out of capacity" errors are common — especially in Asia-Pacific regions at peak hours.

**Manual retry (try this first):**

1. Close the "Out of capacity" error dialog in the Oracle console.
2. Wait 5–15 minutes.
3. Re-open the Create Instance form and try again. Repeat 3–5 times.
4. A1.Flex capacity often opens up briefly during off-peak hours (try during UTC night for your chosen region).

**Region availability** (anecdotal — varies week to week):

| Region | Anecdotal A1.Flex availability |
|--------|-------------------------------|
| US East (Ashburn) | Most consistent |
| US West (Phoenix) | Most consistent |
| EU (Frankfurt) | Mixed; often available on retry |
| Tokyo / Singapore / Sydney | Can have availability issues at peak demand |
| Mumbai | Anecdotal — varies |

**Home Region constraint (important):**

The Home Region is chosen **once at OCI tenancy creation** and is irreversible for that tenancy. If your tenancy was created in Singapore and capacity is unavailable, you must create a new OCI tenancy (a separate account) to use a different home region. Capacity reservations require a paid OCI account — not available on Always Free.

**Scripted retry (optional — for persistent OOC situations):**

1. Install the OCI CLI: `https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm` (~10 minutes setup).
2. Configure API key: OCI Console → User Settings → API Keys → Add public key. Save the OCID and tenancy details to `~/.oci/config`.
3. Use the launch API in a retry loop — poll every 60 seconds until capacity becomes available:

```bash
while ! oci compute instance launch \
    --availability-domain <AD-NAME> \
    --compartment-id <COMPARTMENT-OCID> \
    --shape VM.Standard.A1.Flex \
    --shape-config '{"ocpus":2,"memoryInGBs":12}' \
    --image-id <UBUNTU-24-04-ARM64-IMAGE-OCID> \
    --subnet-id <SUBNET-OCID> \
    --assign-public-ip true \
    --ssh-authorized-keys-file ~/.ssh/wallet_app_oracle.pub \
    --display-name wallet-app-prod; do
  echo "Out of capacity — retrying in 60s..."
  sleep 60
done
echo "Instance launched."
```

Replace each `<...>` placeholder with the values from your tenancy. The `--image-id` for Ubuntu 24.04 Minimal ARM64 is visible in the Oracle console under Compute → Images.

---

## Appendix C: Common operational commands

These are the commands the operator runs day-to-day after Phase 6 is complete. All run on the VM as `deploy` from `~/wallet_app/infra`.

**View logs:**

```bash
cd ~/wallet_app/infra
docker compose -f docker-compose.prod.yml logs --tail 100 -f caddy
docker compose -f docker-compose.prod.yml logs --tail 100 -f api
docker compose -f docker-compose.prod.yml logs --tail 100 -f db
```

**Restart a single service:**

```bash
docker compose -f docker-compose.prod.yml restart caddy
docker compose -f docker-compose.prod.yml restart api
```

**Stop the entire stack gracefully (PRESERVES VOLUMES):**

```bash
docker compose -f docker-compose.prod.yml stop
```

**Bring the stack back up after a stop:**

```bash
docker compose -f docker-compose.prod.yml up -d
```

**Pull the latest image after a code update** (Phase 7 introduces GHCR; for now, rebuild on VM):

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

**Edit `.env` on the VM:**

```bash
cd ~/wallet_app/infra
chmod 600 .env   # re-enforce in case of accidental relaxation
vim .env
# After editing, restart the affected service:
docker compose -f docker-compose.prod.yml restart caddy   # if Caddy vars changed
docker compose -f docker-compose.prod.yml restart api     # if API vars changed
```

**Check service health status:**

```bash
docker compose -f docker-compose.prod.yml ps
# All services should show Status = "running (healthy)"
```

**FORBIDDEN commands on this VM (Pitfall 8 — permanent data loss risk):**

- `docker compose down -v` — destroys named volumes (`caddy_data` burns LE rate-limit budget; `wallet_pgdata_prod` destroys all user data). **NEVER use on the production VM.**
- `docker volume rm caddy_data` — same consequence as above.
- `docker volume rm wallet_pgdata_prod` — destroys all user financial data.

**Safe alternatives:**

- Graceful shutdown (preserves volumes): `docker compose -f docker-compose.prod.yml stop`
- Full removal without volume loss: `docker compose -f docker-compose.prod.yml down` (no `-v`)

---

## Appendix D: Recovery — Oracle serial console (lockout fallback)

Use this path if you lose SSH access to the VM — for example, if §4's SECOND-TERMINAL verify step was skipped and the first session was closed before port-23333 SSH was confirmed working, or if a ufw misconfiguration blocks all inbound traffic.

**The serial console gives you direct local TTY access to the VM without any network dependency.** Oracle support also uses this path — there is no "let Oracle SSH in and fix it" option.

1. Go to **Oracle Cloud console** → **Compute** → **Instances** → `wallet-app-prod`.
2. In the instance detail page, find the **Resources** section in the left panel → **Console connection**.
3. Click **Create local connection** (or **Launch Cloud Shell connection** if you prefer the browser-based terminal).
4. Follow the on-screen instructions to connect via the serial console. You will get a local TTY prompt.
5. From the serial console, fix the broken configuration:

   **To restore SSH access on port 22 temporarily:**

   ```bash
   # Revert or remove the SSH hardening drop-in:
   sudo rm /etc/ssh/sshd_config.d/99-wallet-hardening.conf
   sudo rm -rf /etc/systemd/system/ssh.socket.d
   sudo systemctl daemon-reload
   sudo systemctl restart ssh.socket
   # SSH on port 22 should now accept connections again.
   ```

   **To disable ufw temporarily:**

   ```bash
   sudo ufw disable
   # All traffic now passes through — reconnect via SSH on port 22.
   ```

6. Reconnect via SSH on port 22: `ssh -i ~/.ssh/wallet_app_oracle ubuntu@<vm-ip>`
7. Re-apply hardening with the SECOND-TERMINAL verify discipline (§4).

> The serial console is the only recovery path for a fully locked-out VM. It works even if all network-level SSH access is blocked. Treat it as a last resort — the §4 SECOND-TERMINAL verify step exists specifically to avoid needing it.

---

*Phase: 06-provision-oracle-vm-domain-caddy-https*
*RUNBOOK version: Phase 6 / 2026-05-25*
*Operator: follow top-to-bottom for a first-time provision. For a re-provision (domain already owned, key already generated), skip §1 and skip the SSH keygen step in §0.*


