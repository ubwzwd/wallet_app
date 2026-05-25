---
phase: 06-provision-oracle-vm-domain-caddy-https
plan: "04"
subsystem: infra
tags: [runbook, documentation, operator-playbook, deploy, letsencrypt, caddy, ufw, ssh, uptimerobot]

# Dependency graph
requires:
  - plan: "06-01"
    provides: "infra/Caddyfile (acme_ca + HSTS), infra/.env.example (CADDY_ACME_CA + CADDY_DOMAIN + ALLOWED_ORIGINS), infra/docker-compose.prod.yml (CADDY_ACME_CA env passthrough)"
  - plan: "06-02"
    provides: "infra/scripts/verify-phase6.sh (quick + full modes), infra/runbook-evidence/.gitkeep"
  - plan: "06-03"
    provides: ".planning/ROADMAP.md SC3 amended to 23333/80/443"
provides:
  - "infra/RUNBOOK.md — end-to-end operator playbook covering §0–§16 + Appendices A–D (DEPLOY-05)"
  - "Procedural enforcement of D-04 (DNS-before-Caddy gate in §8) and D-05 (LE staging-then-prod two-commit in §10→§11)"
  - "All 9 RESEARCH pitfalls surfaced as inline callouts at their relevant sections"
  - "SC4 DB-independence verification sequence (§12), SC5 downtime drill steps (§15), SC3 nmap evidence (§13)"
affects:
  - "06-05 onwards — operator execution plans reference §9 (.env authoring), §10 (first stack bringup), §11 (LE prod flip), §12 (DB-independence), §13 (port scan), §14-§15 (UptimeRobot), §16 (verifier)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-markdown copy-paste-block runbook (D-16): each command block shows expected output so the operator knows when to proceed"
    - "Procedural gate enforcement via markdown: DNS gate (§8) and two-commit LE staging→prod (§10→§11) substitute for compose depends_on at the runbook layer"

key-files:
  created:
    - infra/RUNBOOK.md
  modified: []

key-decisions:
  - "Three-task split for RUNBOOK.md authoring: §0–§5 in Task 1 (prerequisites + OS hardening), §6–§11 in Task 2 (Docker + DNS + Caddy cert flow), §12–§16+Appendices in Task 3 (verification + monitoring + appendices)"
  - "All 9 RESEARCH pitfalls surfaced as inline callouts at exactly the section where they apply — not in a separate pitfalls appendix"
  - "SECOND-TERMINAL VERIFY callout for SSH port change (§4) mirrors RESEARCH Pattern 3 Approach A drop-in method"
  - "uptime-alert.png gitignore behavior noted in §15: operator must verify git add stages the file (Plan 02 .gitignore negation handles this)"
  - "CADDY_ACME_CA Commit B procedure aligns with Plan 01 deviation: operator must UNSET/REMOVE the line (not set to empty string) so Caddyfile default triggers"

patterns-established:
  - "Operator runbook pattern: prerequisite checklist + copy-paste blocks + expected-output verification + DO-NOT callouts for irreversible actions"

requirements-completed:
  - DEPLOY-05

# Metrics
duration: 6min
completed: "2026-05-26"
---

# Phase 6 Plan 04: Operator Runbook Summary

**infra/RUNBOOK.md authored: end-to-end operator playbook (§0–§16 + Appendices A–D) guiding provisioning from Oracle account to live LE production cert + UptimeRobot monitor in <60 min**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-25T15:58:41Z
- **Completed:** 2026-05-26
- **Tasks:** 3
- **Files created:** 1 (infra/RUNBOOK.md, 1013 lines)

## Accomplishments

- `infra/RUNBOOK.md` created at 1013 lines covering all 17 numbered sections (§0–§16) and 4 appendices (A–D)
- All 9 RESEARCH pitfalls surfaced as inline callouts at their relevant sections
- D-04 DNS-propagation hard gate enforced in §8 (dig loop, DO NOT PROCEED callout)
- D-05 two-commit staging→prod pattern enforced in §10→§11 with "TWO-COMMIT" procedural gate callout
- §12 documents the `docker compose stop db` → `curl /health` → `start db` sequence (D-18 / OPS-01 / SC4)
- §15 documents the deliberate downtime drill: stop caddy → wait → screenshot to `infra/runbook-evidence/uptime-alert.png` → start caddy (D-22 / OPS-02 / SC5)
- §16 invokes both `verify-phase6.sh quick` and `verify-phase6.sh full <domain> <ip>` with cross-reference table for failures
- Appendix C lists FORBIDDEN operational commands (`down -v`, `volume rm caddy_data`, `volume rm wallet_pgdata_prod`) with safe alternatives
- Appendix D documents Oracle serial console lockout recovery path

## Task Commits

Each task was committed atomically:

1. **Task 1: Author RUNBOOK.md §0–§5 (prerequisites, Oracle provisioning, SSH hardening, ufw, unattended-upgrades)** — `fd46af5`
2. **Task 2: Append RUNBOOK.md §6–§11 (Docker install, Cloudflare DNS, DNS gate, .env authoring, staging cert, LE prod flip)** — `2ef7d0f`
3. **Task 3: Append RUNBOOK.md §12–§16 + Appendices A–D** — `e5f133b`

## Files Created

- `infra/RUNBOOK.md` — 1013 lines, 17 numbered sections (§0–§16), 4 appendices (A–D), 22 total `##` headings

## Decisions Made

- **Three-task authoring split**: kept each task at ~25% of context as specified by the plan. Task 1 = OS hardening (§0–§5), Task 2 = network/cert setup (§6–§11), Task 3 = verification+monitoring (§12–§16+appendices).
- **Pitfall callouts inline, not in a separate section**: each pitfall appears at the exact step where the operator would encounter it, matching the plan's pitfall-to-callout map.
- **CADDY_ACME_CA Commit B alignment**: the runbook §11 tells the operator to REMOVE/UNSET `CADDY_ACME_CA` (not set to empty string), consistent with Plan 01's deviation finding that Caddy 2.11.3 uses `{$VAR:default}` fallback only when the var is unset.

## Deviations from Plan

None — plan executed exactly as written. The RUNBOOK content maps precisely to the plan's section list, pitfall-to-callout map, and acceptance criteria.

## Known Stubs

None — the RUNBOOK.md is a pure-markdown document with no data flows or UI rendering. All content is operator-readable prose and copy-paste command blocks. Placeholder values (`<your-domain>`, `<vm-ip>`, `<your-org>`) are intentional and correct per the plan spec (D-01: domain not pre-decided).

## Threat Flags

None — this plan creates only a markdown documentation file. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check

**Created files:**

```bash
test -f infra/RUNBOOK.md && echo "FOUND: infra/RUNBOOK.md" || echo "MISSING: infra/RUNBOOK.md"
```

Result: FOUND

**Line count:**

```bash
wc -l infra/RUNBOOK.md
```

Result: 1013 lines (requirement: >= 500)

**Section count:**

```bash
grep -cE '^## ' infra/RUNBOOK.md
```

Result: 22 sections (requirement: >= 14)

**Commits exist:**

- `fd46af5` — EXISTS (docs(06-04): author RUNBOOK.md §0–§5)
- `2ef7d0f` — EXISTS (docs(06-04): append RUNBOOK.md §6–§11)
- `e5f133b` — EXISTS (docs(06-04): append RUNBOOK.md §12–§16 + Appendices)

## Self-Check: PASSED

---
*Phase: 06-provision-oracle-vm-domain-caddy-https*
*Completed: 2026-05-26*
