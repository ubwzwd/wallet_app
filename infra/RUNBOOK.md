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

