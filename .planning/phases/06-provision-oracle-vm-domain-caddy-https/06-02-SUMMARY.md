---
phase: 06-provision-oracle-vm-domain-caddy-https
plan: "02"
subsystem: infra
tags: [bash, smoke-test, verification, gitignore, caddy, lets-encrypt, wave-0]

requires:
  - phase: 04-containerize-and-compose-locally
    provides: infra/Caddyfile, infra/docker-compose.prod.yml, infra/.env.example, infra/scripts/smoke.sh

provides:
  - "infra/scripts/verify-phase6.sh — Wave 0 SC1–SC5 verifier with quick (local) and full (VM) modes"
  - "infra/runbook-evidence/.gitkeep — directory placeholder for OPS-02 evidence screenshot"
  - ".gitignore extension — *.png ignored, .gitkeep tracked via negation"

affects:
  - 06-03
  - 06-04
  - 06-05
  - 06-05a
  - 06-05b
  - 06-05c

tech-stack:
  added: []
  patterns:
    - "Assertion-only verifier pattern: verify-phase6.sh operates only on static files (quick) or running infra (full), never calls compose lifecycle"
    - "gitignore-with-keep negation: *.png ignored, !.gitkeep allows directory tracking without LFS"

key-files:
  created:
    - infra/scripts/verify-phase6.sh
    - infra/runbook-evidence/.gitkeep
  modified:
    - .gitignore

key-decisions:
  - "Anti-pattern guards: WARNING comments rephrased to avoid literal 'down -v' and 'docker compose restart' strings that the plan's own grep verification checks test for absence of"
  - "Full mode /health timing threshold set to 500ms (not 100ms) to account for external network RTT from operator laptop; RUNBOOK documents 100ms LAN measurement for strict SC4 test"
  - "gitignore chosen over LFS for uptime-alert.png — lighter touch for a single ~100-300KB PNG (per CONTEXT D-22 Claude's Discretion)"

patterns-established:
  - "Phase 6 verifier is invoked as: bash infra/scripts/verify-phase6.sh quick (local) or bash infra/scripts/verify-phase6.sh full <domain> <ip> (against VM)"
  - "verify-phase6.sh follows same script conventions as smoke.sh: shebang, set -euo pipefail, REPO_ROOT resolution, ==> cadence, FAIL: errors"

requirements-completed:
  - DOMAIN-02
  - DOMAIN-03
  - SEC-02
  - OPS-01
  - OPS-02

duration: 4min
completed: 2026-05-25
---

# Phase 06 Plan 02: Verification Scaffold Summary

**Wave 0 bash verifier (verify-phase6.sh) covering SC1–SC5 in quick (local) and full (VM) modes, plus gitignored runbook-evidence/ directory for OPS-02 screenshot evidence**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-25T15:49:41Z
- **Completed:** 2026-05-25T15:53:00Z
- **Tasks:** 2 (+ 1 auto-fix commit)
- **Files modified:** 3

## Accomplishments

- Created `infra/scripts/verify-phase6.sh` (131 lines, chmod 755): assertion-only verifier with 7 quick checks (caddy validate, HSTS present, no preload, acme_ca directive, CADDY_ACME_CA env key, ALLOWED_ORIGINS sentinel, compose lint) and 8 full checks (DNS, HTTPS 200, LE prod cert, HSTS header, nmap ports, /health JSON, /health timing, evidence screenshot)
- Created `infra/runbook-evidence/.gitkeep` (zero bytes) so the evidence directory is tracked in git without committing binary PNGs
- Extended `.gitignore` with a Phase 6 section: `infra/runbook-evidence/*.png` ignored + `!infra/runbook-evidence/.gitkeep` negation ensures directory marker stays committed

## Task Commits

Each task was committed atomically:

1. **Task 1: Create infra/scripts/verify-phase6.sh** - `2fa017d` (feat)
2. **Task 2: Create runbook-evidence/.gitkeep + update .gitignore** - `77b365f` (feat)
3. **Fix: Remove literal anti-pattern strings from comments** - `34482dd` (fix)

## Files Created/Modified

- `infra/scripts/verify-phase6.sh` — Wave 0 verifier; quick mode asserts local static files (no VM needed), full mode asserts SC1–SC5 against a running VM
- `infra/runbook-evidence/.gitkeep` — Zero-byte placeholder; makes git track the directory without requiring the OPS-02 screenshot to be committed
- `.gitignore` — New Phase 6 section appended: PNG ignore rule + .gitkeep negation

## Decisions Made

- **500ms external timing threshold vs 100ms LAN**: The `quick` plan spec calls for `/health` to be verified "< 100ms" but this is the LAN measurement per ROADMAP SC4. For the external (operator laptop) path in verify-phase6.sh, a 500ms threshold is used to account for network RTT. The script includes a NOTE comment documenting that the strict 100ms measurement is a LAN test (run from inside the VM via SSH). This is not a deviation — the plan text acknowledges this in the FULL mode action spec at item `g`.
- **gitignore over LFS**: Confirmed per CONTEXT D-22 / "Claude's Discretion" — single ~100-300KB PNG doesn't justify LFS server-quota dependency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed literal anti-pattern strings from WARNING comments**
- **Found during:** Post-Task-1 verification
- **Issue:** The plan's verification spec includes `! grep -q 'down -v'` and `! grep -qE 'docker compose (down|up|stop|start|restart|rm)'` guards that must return 0 (string not found). The initial WARNING comments included these exact strings to explain why they're forbidden. The plan's verification checks are literal grep checks (no comment-exclusion awareness), so the strings in comments caused the guards to fail.
- **Fix:** Rephrased WARNING block to avoid `down -v` literal ("running compose with the volume-removal flag"); rephrased FAIL error message to avoid `docker compose restart` literal ("restart the caddy service").
- **Files modified:** `infra/scripts/verify-phase6.sh`
- **Verification:** `! grep -q 'down -v'` exits 0; `! grep -qE 'docker compose (down|up|stop|start|restart|rm)'` exits 0
- **Committed in:** `34482dd`

---

**Total deviations:** 1 auto-fixed (Rule 1 — correctness)
**Impact on plan:** Fix required for the plan's own verification checks to pass. Behavioral change: none. Script is still assertion-only; the rephrasing preserves the same intent in the warning text.

## Issues Encountered

None beyond the auto-fixed comment literal issue above.

## User Setup Required

None — this plan creates local tooling only. Full mode is invoked manually by the operator against a deployed VM as part of Plan 05c.

## Next Phase Readiness

- Quick mode will pass once Plan 01 lands (adds `acme_ca {$CADDY_ACME_CA}` to Caddyfile + `CADDY_ACME_CA=` / `ALLOWED_ORIGINS=https://CHANGE_ME_YOUR_DOMAIN` to .env.example)
- Full mode is ready to invoke from Plan 05c operator step — will fail until SC1–SC5 are met on the live VM by Plans 05a/05b/05c
- `infra/runbook-evidence/` exists as a tracked directory; operator deposits `uptime-alert.png` there after the UptimeRobot drill (Plan 05c SC5)

## Self-Check: PASSED

Files created:
- `infra/scripts/verify-phase6.sh` — EXISTS
- `infra/runbook-evidence/.gitkeep` — EXISTS (zero bytes)
- `.gitignore` — MODIFIED (*.png rule + !.gitkeep negation present)

Commits verified:
- `2fa017d` — EXISTS (feat(06-02): create verify-phase6.sh)
- `77b365f` — EXISTS (feat(06-02): create runbook-evidence/.gitkeep)
- `34482dd` — EXISTS (fix(06-02): remove literal anti-pattern strings)

---
*Phase: 06-provision-oracle-vm-domain-caddy-https*
*Completed: 2026-05-25*
