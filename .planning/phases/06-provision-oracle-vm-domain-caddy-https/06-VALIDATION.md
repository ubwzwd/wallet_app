---
phase: 06
slug: provision-oracle-vm-domain-caddy-https
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 06-RESEARCH.md §Validation Architecture (locked).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bash smoke tests + manual operator verification (no pytest/jest applicable to provisioning) |
| **Config file** | `infra/scripts/verify-phase6.sh` (Wave 0 creates) |
| **Quick run command** | `bash infra/scripts/verify-phase6.sh quick` (local — Caddyfile lint + .env.example schema) |
| **Full suite command** | `bash infra/scripts/verify-phase6.sh full <your-domain> <vm-ip>` (against deployed VM) |
| **Estimated runtime** | quick ~5s, full ~30s (network-bound) |

---

## Sampling Rate

- **After every task commit:** Run `bash infra/scripts/verify-phase6.sh quick` (Caddyfile validate; .env.example schema)
- **After every plan wave:** Run quick suite locally — full suite is only meaningful against the deployed VM
- **Before `/gsd:verify-work`:** Full suite must be green against the deployed VM (SC1–SC5)
- **Max feedback latency:** quick ~5s; full ~30s
- **Per-task verification:** N/A for code commits — Phase 6 verifications happen at runbook execution boundaries (operator-driven), not per-commit

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| DEPLOY-05 | RUNBOOK.md exists + documents end-to-end provisioning | doc-exists | `test -f infra/RUNBOOK.md && [ $(grep -cE '^## ' infra/RUNBOOK.md) -ge 10 ]` | ❌ Wave 0 | ⬜ pending |
| DOMAIN-01 | A record → VM public IP, dig-confirmed before Caddy first start | smoke | `dig @1.1.1.1 <your-domain> +short` (compare with reserved IP) | ❌ Wave 0 | ⬜ pending |
| DOMAIN-02 | LE prod cert in place (not STAGING) | smoke | `curl -vI https://<your-domain>/ 2>&1 \| grep -i issuer \| grep -v STAGING` | ❌ Wave 0 | ⬜ pending |
| DOMAIN-03 | HSTS header observed | smoke | `curl -sI https://<your-domain>/ \| grep -i 'strict-transport-security: max-age=31536000; includeSubDomains'` | ❌ Wave 0 | ⬜ pending |
| SEC-02 (ufw) | Only 23333/80/443 reachable externally | smoke | `nmap -Pn -p- <vm-ip>` from operator laptop — operator reviews output | ❌ Wave 0 | ⬜ pending |
| SEC-02 (SSH) | Key-only, port 23333, no root | smoke | `ssh -o PreferredAuthentications=password -p 23333 root@<vm-ip>` should fail; `ssh -p 22 deploy@<vm-ip>` should timeout/refuse | ❌ Wave 0 | ⬜ pending |
| SEC-02 (unattended-upgrades) | Security updates scheduled, auto-reboot off | smoke | `systemctl is-active apt-daily-upgrade.timer` returns `active` on VM; `grep 'Automatic-Reboot' /etc/apt/apt.conf.d/50unattended-upgrades` shows `"false"` | ❌ Wave 0 | ⬜ pending |
| OPS-01 | `/health` survives DB stop (200 OK in <100ms) | smoke | `docker compose stop db && time curl -sf https://<domain>/health \| jq .status` returns `"healthy"`; `docker compose start db` to restore | ❌ Wave 0 | ⬜ pending |
| OPS-02 | UptimeRobot monitor exists + alerted in drill | manual-only | screenshot at `infra/runbook-evidence/uptime-alert.png` committed; UptimeRobot dashboard shows 5-min HTTPS monitor on `/health` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `infra/scripts/verify-phase6.sh` — wraps the smoke commands above (`quick` mode: Caddyfile validate, .env.example schema check; `full` mode: curl/dig/nmap reminders against deployed VM)
- [ ] `infra/runbook-evidence/.gitkeep` — placeholder directory for SC5 screenshot (gitkeep file committed; `*.png` either committed directly per RESEARCH recommendation, or gitignored per planner decision)
- [ ] No new test framework install needed — bash + curl + dig + nmap suffice; nmap must be installed on operator laptop, not the VM

*Caddyfile local-validate one-liner (callable from `verify-phase6.sh quick`):*
```bash
docker run --rm -v "$(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Oracle A1.Flex VM provisioned + reachable | DEPLOY-05 | Requires Oracle Cloud console click-through + capacity availability | Operator follows RUNBOOK §Provision VM; success = `ssh wallet-app` returns shell prompt |
| Cloudflare Registrar domain purchased | DOMAIN-01 | Real-money transaction + operator-chosen TLD | Operator follows RUNBOOK §Register Domain; success = domain shows in Cloudflare dashboard with NS records assigned |
| `dig` confirms A record before first Caddy start | DOMAIN-01 → DOMAIN-02 ordering | Time-ordered procedural gate (D-04 hard requirement); cannot be automated against an unprovisioned VM | RUNBOOK has explicit gate block: "DO NOT proceed past this section until `dig +short <your-domain>` returns the VM IP" |
| LE staging→prod two-commit flip | DOMAIN-02, D-05 | Procedural deliberate-commit pattern; not a single-command verification | Operator verifies staging cert (browser warning expected on staging — Pebble fake root); makes Commit B (`CADDY_ACME_CA=` empty); `docker compose restart caddy`; re-curl for prod cert |
| External nmap port scan from outside the VM | SEC-02 | Requires command run from a network OUTSIDE the VM's perimeter | Operator runs `nmap -Pn -p 1-65535 <vm-ip>` from laptop; expected: only 23333/80/443 open or filtered, all else closed/filtered |
| UptimeRobot alert email drill | OPS-02, D-22 | Requires real email delivery + screenshot evidence; not deterministic in CI | Operator: `docker compose stop caddy` → wait up to 5min for alert email → screenshot email → commit screenshot to `infra/runbook-evidence/uptime-alert.png` → `docker compose start caddy` → confirm UptimeRobot returns to "Up" within one cycle |

---

## Validation Sign-Off

- [ ] All requirements have automated or manual verification recipe
- [ ] Sampling continuity: N/A — provisioning phase, not iterative code phase (acceptable for this phase type per RESEARCH §Sampling Rate)
- [ ] Wave 0 covers all ❌ items (verify-phase6.sh + .gitkeep)
- [ ] No watch-mode flags (one-shot bash scripts only)
- [ ] Feedback latency < 30s for full suite (network-bound; acceptable)
- [ ] `nyquist_compliant: true` will be set in frontmatter when planner accepts validation contract

**Approval:** pending (planner to confirm in PLAN.md)

---

*Phase: 06-provision-oracle-vm-domain-caddy-https*
*Validation strategy authored: 2026-05-25 from 06-RESEARCH.md §Validation Architecture*
