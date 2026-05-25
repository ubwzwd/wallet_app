# Phase 6: Provision Oracle VM + Domain + Caddy HTTPS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 06-provision-oracle-vm-domain-caddy-https
**Areas discussed:** Domain & DNS provider, VM state & SSH access, RUNBOOK shape & hardening extras, Monitoring & alert channel

---

## Domain & DNS provider

### Q1 — Domain status

| Option | Description | Selected |
|--------|-------------|----------|
| Already own one | Just point A record at new VM IP | |
| Need to register one | Pick a registrar; register during phase | ✓ |
| Have one but want to switch | Transfer or change nameservers | |

**User's choice:** Need to register one.

### Q2 — DNS host (clarifying turn)

| Option | Description | Selected |
|--------|-------------|----------|
| Registrar's own DNS | Simplest; HTTP-01 challenge works | |
| Cloudflare DNS, grey cloud | Cloudflare nameservers, no proxy; HTTP-01 still works | (resolved in Q3) |
| Cloudflare DNS, orange cloud | Full proxy; forces DNS-01 + custom Caddy build | |

**User's choice:** Asked a clarifying question — "If I choose to register a domain with cloudflare, is it better to also use its DNS service?"
**Notes:** Answered directly: Cloudflare Registrar *requires* Cloudflare DNS (cannot use external nameservers). Cloudflare Registrar = at-cost pricing, paired with free Cloudflare DNS. Orange/grey cloud is an independent toggle.

### Q3 — Registrar (re-asked after Q2 clarification)

| Option | Description | Selected |
|--------|-------------|----------|
| Cloudflare Registrar (Recommended) | At-cost, free CF DNS, forces CF nameservers | ✓ |
| Porkbun | Cheap, broad TLD support, free WHOIS privacy | |
| Namecheap | Familiar, broader TLDs, slightly pricier | |

**User's choice:** Cloudflare Registrar.

### Q4 — Cloudflare proxy (clarifying turn → re-asked)

| Option | Description | Selected |
|--------|-------------|----------|
| Grey cloud / DNS only (Recommended) | Direct traffic, stock `caddy:alpine`, HTTP-01 | ✓ |
| Orange cloud / proxied | CF in front, DNS-01 challenge, custom Caddy build | |

**User's choice (first turn):** Asked clarifying question — "what is orange cloud on cloudflare". Answered with full explanation of orange (proxied, hides origin, forces DNS-01) vs grey (DNS-only, direct traffic, HTTP-01).
**User's choice (re-ask):** Grey cloud / DNS only.

### Q5 — Domain name

| Option | Description | Selected |
|--------|-------------|----------|
| I have one in mind | Bake exact name into runbook examples | |
| Leave as placeholder | Use `<your-domain>` / `$CADDY_DOMAIN` everywhere | ✓ |

**User's choice:** "I will decide when register the domain" → placeholder approach. Runbook stays portable.

---

## VM state & SSH access

### Q6 — VM provisioning state (clarifying turn → re-asked)

| Option | Description | Selected |
|--------|-------------|----------|
| Not yet provisioned — create in Phase 6 | Runbook includes Oracle console click-through | ✓ |
| Already provisioned and SSH-reachable | Start at "install Docker" | |
| Provisioned but not yet hardened | Start at hardening | |

**User's choice (first turn):** "I have the OCI's Always Free-eligible" — ambiguous between "account exists" and "instance exists".
**User's choice (re-ask):** No instance yet — create it in Phase 6. Confirmed account + A1.Flex eligibility, no instance created.

### Q7 — SSH key strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Generate fresh ed25519 (Recommended) | `~/.ssh/wallet_app_oracle`, scoped to this VM | ✓ |
| Reuse existing personal key | One less key to manage; broader blast radius if leaked | |
| Decide at provision time | Runbook documents both | |

**User's choice:** Generate fresh ed25519.

### Q8 — Deploy user + sudo policy

| Option | Description | Selected |
|--------|-------------|----------|
| `deploy` with NOPASSWD sudo (Recommended) | Conventional, supports Phase 7 GH Actions SSH-deploy | ✓ |
| `wallet` with NOPASSWD sudo | Project-themed name | |
| `deploy` with scoped sudoers | More secure, may break Phase 7 if commands missed | |

**User's choice:** `deploy` with NOPASSWD sudo.

---

## RUNBOOK shape & hardening extras

### Q9 — Runbook style

| Option | Description | Selected |
|--------|-------------|----------|
| Pure markdown with copy-paste blocks (Recommended) | Top-to-bottom, every command visible | ✓ |
| Markdown + idempotent shell scripts | `provision.sh`, `harden.sh`, re-runnable | |
| Pure scripts, minimal markdown | Most automated, least transparent | |

**User's choice:** Pure markdown with copy-paste blocks.

### Q10 — Hardening extras (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| fail2ban for SSH brute-force (Recommended) | Common addition, low setup | (deferred — see Notes) |
| Change SSH port from 22 to non-standard | Reduces scanner noise, not real security | ✓ |
| Restrict SSH to specific source IPs | Strong but brittle on residential ISP | |
| Just the SEC-02 baseline | No extras | ✓ |

**User's choice:** Change SSH port + SEC-02 baseline only.
**Notes:** "We can consider to add the fail2ban as an optional improvement in later milestones" — explicit deferral, captured in Deferred Ideas.

### Q11 — unattended-upgrades scope

| Option | Description | Selected |
|--------|-------------|----------|
| Security updates only (Recommended) | Ubuntu default; lowest breakage risk | ✓ |
| Security + general updates | More current, more breakage risk | |

**User's choice:** Security updates only.

### Q12 — SSH port number (clarifying turn → re-asked → re-asked)

| Option | Description | Selected |
|--------|-------------|----------|
| 2222 | Most-popular alt-port for SSH; still scanned heavily | |
| High random in 49152–65535 (Recommended) | Quietest, dynamic-port range | |
| Decide at provision time | Placeholder | |

**User's choice (first turn):** "is 2333 a safe port?" — asked for evaluation.
**Notes:** Explained 2333 is in IANA user-ports range (1024–49151), not assigned to anything well-known, fine to use; port choice is noise reduction not real security.

**Q12b — Lock 2333 vs quieter (re-ask):**
**User's choice:** "Or use 23333?" — proposed alternative.
**Notes:** Explained 23333 is equivalent to 2333 (same range, same characteristics).

**Q12c — Final: 2333 vs 23333:**
**User's choice:** 23333.

### Q13 — ROADMAP SC3 literal-text amendment

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — amend to `23333/80/443` (Recommended) | Intent preserved, port swapped | ✓ |
| No — keep 22 open as listed | Defeats purpose of port move | |
| No — revert to SSH on 22 | Match ROADMAP literally | |

**User's choice:** Yes — amend.

---

## Monitoring & alert channel

### Q14 — UptimeRobot account state

| Option | Description | Selected |
|--------|-------------|----------|
| I have one — add a new monitor | Existing account | |
| Sign up during Phase 6 | Runbook includes signup step | ✓ |
| Skip UptimeRobot, use different tool | Changes OPS-02 wording | |

**User's choice:** Sign up during Phase 6.

### Q15 — Alert email

| Option | Description | Selected |
|--------|-------------|----------|
| Personal email — added at monitor-create time | Runbook says "add your email, verify" | ✓ |
| Dedicated alerts inbox | Filtered alias / separate account | |

**User's choice:** Personal email, added when creating the monitor.

### Q16 — Downtime test method

| Option | Description | Selected |
|--------|-------------|----------|
| Stop the caddy container (Recommended) | Cleanest, no DB/migrate risk | ✓ |
| Stop the whole stack | More dramatic, slight half-state risk | |
| Block the port at ufw | Lower-layer test, lockout risk if typo | |

**User's choice:** Stop the caddy container.

### Q17 — Extra monitors

| Option | Description | Selected |
|--------|-------------|----------|
| Just the /health monitor (Recommended) | Caddy auto-renews; one monitor sufficient | ✓ |
| Also add TLS cert expiry monitor | Belt-and-suspenders against renewal failure | |
| Also add homepage monitor | Catches frontend regressions /health misses | |

**User's choice:** Just the /health monitor.

---

## Claude's Discretion

- Exact Caddy v2 syntax for switching ACME endpoints (`acme_ca` global vs site-block `tls { issuer acme { ca ... } }`).
- Named volume vs bind-mount for Caddy's `/data` (ACME state).
- ufw rule ordering on a fresh install.
- LE-prod-flip commit: bump `acme_ca` to explicit prod URL or simply remove the override.
- Oracle VCN/subnet/security-list naming.
- `infra/runbook-evidence/` gitignored vs LFS for the UptimeRobot screenshot.
- Wording of the "if A1.Flex capacity is Out" sub-section.
- LE-prod swap as manual operator commit vs runbook-driven step.

## Deferred Ideas

- fail2ban → later "harden production" milestone (user-explicit).
- Cloudflare orange-cloud proxy / WAF / DDoS → later milestone.
- TLS cert-expiry monitor (separate UptimeRobot SSL monitor) → later milestone.
- Root-URL / homepage monitor → later milestone.
- SMS / webhook alert channels (Slack/Discord for uptime) → later milestone (Phase 7 covers deploy webhooks separately).
- Idempotent provisioning scripts (`infra/scripts/provision.sh` etc.) → later milestone.
- IP-restricted SSH → later milestone, if ever.
- Auto-reboot for kernel updates → revisit if reboot cadence becomes a problem.
- `www` subdomain redirect → trivial follow-up; not in Phase 6.
- HSTS preload submission → never (irreversible).
- Cert-state backups in Phase 7's daily backups → revisit when widening backup scope.
- A1.Flex capacity reservation → requires paid OCI, out of scope.
