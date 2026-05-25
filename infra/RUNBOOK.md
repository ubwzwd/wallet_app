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
