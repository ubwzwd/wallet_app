---
phase: 06-provision-oracle-vm-domain-caddy-https
plan: 03
subsystem: infra
tags: [roadmap, documentation, ufw, ssh, sec-02]

# Dependency graph
requires:
  - phase: 06-CONTEXT.md
    provides: "D-11 (SSH on port 23333) and D-12 (ROADMAP SC3 port-list amendment lock)"
provides:
  - "ROADMAP.md Phase 6 SC3 literal text aligned with D-11/D-12: port list reads 23333/80/443"
affects:
  - 06-02-verify-phase6.sh (nmap assertion must match 23333/80/443)
  - 06-04-RUNBOOK.md (§13 nmap scan references 23333/80/443)
  - 06-05 operator execution (ufw rules open 23333 not 22)

# Tech tracking
tech-stack:
  added: []
  patterns: ["ROADMAP source-of-truth alignment: context decisions must be reflected in literal success criteria text before operator execution plans reference them"]

key-files:
  created: []
  modified:
    - .planning/ROADMAP.md

key-decisions:
  - "D-12 honored: ROADMAP Phase 6 SC3 port list changed from 22/80/443 to 23333/80/443 to match D-11 (SSH on non-default port 23333)"

patterns-established:
  - "Trivial text-amendment plans: single Edit tool call with uniquely-identifying old_string + pre/post grep verification"

requirements-completed: [SEC-02]

# Metrics
duration: 5min
completed: 2026-05-25
---

# Phase 6 Plan 03: ROADMAP SC3 Port-List Amendment Summary

**ROADMAP.md Phase 6 Success Criterion 3 updated from `22/80/443` to `23333/80/443` to align with D-11/D-12 locked SSH port decision**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-25T15:45:00Z
- **Completed:** 2026-05-25T15:50:45Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Phase 6 SC3 now reads "ufw allows only 23333/80/443" — matching D-11 (SSH on port 23333) and D-12 (ROADMAP amendment lock)
- Downstream verification (verify-phase6.sh nmap assertion, RUNBOOK §13) will reference the correct port
- No structural changes to ROADMAP.md: all 4 phase headers, 4 SC3 lines, and total line count unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Amend ROADMAP.md Phase 6 SC3 port list per D-12** - `3e427f5` (docs)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `.planning/ROADMAP.md` - Line 79: replaced `22/80/443` with `23333/80/443` in Phase 6 SC3

## Decisions Made
None - followed plan as specified. The edit was a single literal-text substitution exactly as prescribed by D-12 and the plan's `<action>` block.

## Deviations from Plan

None - plan executed exactly as written.

**Note on verification result:** `grep -c '23333/80/443' .planning/ROADMAP.md` returns 2, not 1 as stated in the plan's verify block. The second occurrence is on line 85 (plan description: "22/80/443 -> 23333/80/443 per D-12") which pre-existed in the file before this edit. The task's actual acceptance criterion is met: SC3 (line 79) contains `23333/80/443`, and `22/80/443` appears 0 times as a standalone port list (the only remaining `22/80/443` on line 85 is part of the transition notation "22/80/443 -> 23333/80/443", not a port list). This is a pre-existing condition in the original ROADMAP.md, not introduced by this edit.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ROADMAP.md is now consistent with all locked context decisions (D-11, D-12)
- Plan 04 (RUNBOOK.md authoring) can reference `23333/80/443` as the canonical SC3 port list
- Plan 02 (verify-phase6.sh) nmap assertion at port 23333 matches the roadmap

---
*Phase: 06-provision-oracle-vm-domain-caddy-https*
*Completed: 2026-05-25*
