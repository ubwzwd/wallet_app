---
phase: 05
plan: 04
subsystem: frontend-mobile-polish
tags: [touch-target, accessibility, mobile-ui, mobui-01, react-native, pwa]
dependency_graph:
  requires: [05-01]
  provides: [touch-target-44-enforced, mobui-01-shipped]
  affects: [Button.tsx, Input.tsx, Navigation.tsx, FinanceSourceFormScreen.tsx, TransactionFormScreen.tsx, ProfileScreen.tsx]
tech_stack:
  added: []
  patterns: [stylesheet-spot-fix, single-point-button-fix, full-grep-audit]
key_files:
  created:
    - .planning/phases/05-pwa-ify-frontend-mobile-polish/05-04-audit-report.txt
    - .planning/phases/05-pwa-ify-frontend-mobile-polish/05-04-SUMMARY.md
  modified:
    - frontend/src/components/Button.tsx
    - frontend/src/components/Input.tsx
    - frontend/src/components/Navigation.tsx
    - frontend/src/screens/FinanceSourceFormScreen.tsx
    - frontend/src/screens/TransactionFormScreen.tsx
    - frontend/src/screens/ProfileScreen.tsx
decisions:
  - "D-15 enforcement: full grep audit with all-touchables gate, no exemptions used (every touchable is touch-critical)"
  - "Audit found 4 sites beyond the named spot-fix list (Button.tsx root, Input.tsx password toggle, Navigation.tsx tabs x2); all were touch-critical and received minHeight: 44 directly — zero exemption comments needed"
  - "Added minHeight: 44 to styles.button base (Button.tsx) — propagates to dynamic styles[size] indexing which the verifier cannot resolve statically; the single-point fix now covers both `small` size AND the root TouchableOpacity in one shot"
requirements: [MOBUI-01]
metrics:
  duration: ~15 min
  completed: 2026-05-25
  tasks: 6
  commits: 5
  touchables_total: 18
  touchables_fixed: 18
  exemptions_added: 0
---

# Phase 5 Plan 04: Touch-Target 44×44 Enforcement Summary

MOBUI-01 fix landed in two waves: the Button.tsx single-point edit (propagates to 14 small-button call-sites + the root TouchableOpacity), the named spot-fixes in three screens (currency-picker rows, modal close buttons, ProfileScreen back button), AND the full grep audit per the revised D-15 — every TouchableOpacity / Pressable / TouchableHighlight under `frontend/src/` now satisfies `minHeight: 44` (no exemptions required).

## What shipped

- **Button.tsx single-point fix** (Task 1): `styles.small` adds `minHeight: 44, minWidth: 44`. Button.test.ts (RED from 05-01) flips to 3/3 GREEN.
- **FinanceSourceFormScreen.tsx spot-fixes** (Task 2): `currencyTrigger.minHeight=44`, `currencyItem.minHeight=44`, new `modalCloseButton` style (44×44 + padding: 12).
- **TransactionFormScreen.tsx spot-fixes** (Task 3): `currencyTrigger.minHeight=44`, `currencyItem.minHeight=44`, new `modalCloseButton` style. Amount-field TextInputs intentionally untouched (owned by plan 05-06).
- **ProfileScreen.tsx spot-fixes** (Task 4): `backButton` (44×44 + justifyContent: 'center'), `currencyTrigger.minHeight=44`, `currencyItem.minHeight=44`, new `modalCloseButton` style.
- **Per-check verifier gate** (Task 5): all four named MOBUI-01 checks PASS in isolation.
- **Full grep audit** (Task 6): 4 remaining sites discovered beyond the named list, all fixed with code (no exemptions). `verify-touch-targets --check=all-touchables` PASS.

## Git diff stat (this plan)

```
 .../05-04-audit-report.txt                         | 69 ++++++++++++++++++++++
 frontend/src/components/Button.tsx                 |  3 +
 frontend/src/components/Input.tsx                  |  2 +
 frontend/src/components/Navigation.tsx             |  2 +
 frontend/src/screens/FinanceSourceFormScreen.tsx   | 13 +++-
 frontend/src/screens/ProfileScreen.tsx             | 12 ++++
 frontend/src/screens/TransactionFormScreen.tsx     | 14 ++++-
 7 files changed, 113 insertions(+), 2 deletions(-)
```

## Commits (5 total — atomic per task)

| Task | Hash      | Title                                                                |
| ---- | --------- | -------------------------------------------------------------------- |
| 1    | `69101ee` | feat(05-04): Button.tsx small size declares 44x44 (single-point fix) |
| 2    | `d7f7e84` | feat(05-04): FinanceSourceFormScreen touch-target spot-fixes          |
| 3    | `8077bff` | feat(05-04): TransactionFormScreen currency-picker touch-target spot-fixes |
| 4    | `9cb2cbc` | feat(05-04): ProfileScreen touch-target spot-fixes                    |
| 6    | `97156d3` | feat(05-04): full touchables audit — fix 4 remaining sites, all-touchables PASS |

Task 5 is verification-only (no file edits), so no commit was created for it — verifier output is recorded below.

## Verification — Button.test.ts GREEN (Task 1 gate)

```
> jest --testPathPatterns=Button
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

Baseline (pre-Task-1) was 1/3 PASS, 2/3 FAIL per 05-01's RED contract. Post-Task-1: 3/3 GREEN.

## Verification — 5 per-check verifier results

```
==> verify-touch-targets[button-small-44]: Button.tsx `small` size declares minHeight: 44 and minWidth: 44
PASS: button-small-44

==> verify-touch-targets[finance-form-spot-fix-44]: FinanceSourceFormScreen.tsx contains ≥1 minHeight: 44
PASS: finance-form-spot-fix-44

==> verify-touch-targets[tx-form-spot-fix-44]: TransactionFormScreen.tsx contains ≥1 minHeight: 44
PASS: tx-form-spot-fix-44

==> verify-touch-targets[profile-spot-fix-44]: ProfileScreen.tsx contains ≥1 minHeight: 44
PASS: profile-spot-fix-44

==> verify-touch-targets[all-touchables]: scanning all TouchableOpacity / Pressable / TouchableHighlight under frontend/src/
PASS: all-touchables
```

All five exit 0; stderr empty.

## Touchables audit (Task 6)

- **Total touchables before:** 18 (recorded in `.planning/phases/05-pwa-ify-frontend-mobile-polish/05-04-audit-report.txt`)
- **Total touchables after:** 18 (none deleted; line numbers shifted by inserted style props)
- **Verifier failures before Task 6:** 4 (after Tasks 1-4 covered the named subset)
- **Verifier failures after Task 6:** 0
- **`// touch-target-exempt:` comments added:** 0

### Task 6 remediation (the 4 sites beyond the named list)

| File                              | Line | Fix                                                                    |
| --------------------------------- | ---- | ---------------------------------------------------------------------- |
| `frontend/src/components/Button.tsx`     | 35   | Added `minHeight: 44` to `styles.button` base (covers dynamic `styles[size]`) |
| `frontend/src/components/Input.tsx`      | 47   | Added `minHeight: 44, minWidth: 44` to `styles.passwordToggle`                 |
| `frontend/src/components/Navigation.tsx` | 25   | Added `minHeight: 44, justifyContent: 'center'` to `styles.tab` (login tab)    |
| `frontend/src/components/Navigation.tsx` | 33   | Same fix — `styles.tab` is shared between login + register tabs                 |

Zero exemption comments — every touchable in the codebase is a touch-critical UI element.

## Amount-field intentionally untouched (parallel-execution contract)

`frontend/src/screens/TransactionFormScreen.tsx` still has:
- 3× `keyboardType="decimal-pad"` (unchanged)
- 0× `inputMode="decimal"` (still 05-06's responsibility — that plan owns the MOBUI-04 amount-field input-mode swap)

`git diff` on TransactionFormScreen.tsx shows changes ONLY in the currency-picker block (currencyTrigger + currencyItem + 2 modal-close + new modalCloseButton style). No edits to amount-field TextInputs, no edits to validation hooks. The parallel-execution contract with 05-06 is preserved.

## Full Jest suite — no regression

```
> jest
Test Suites: 5 passed, 5 total
Tests:       64 passed, 64 total
```

All 5 existing test suites pass: `Button.test.ts` (3/3, was 1/3 before this plan), `CurrencyPicker.test.ts`, `FinanceSourcesScreen.test.ts`, `TransactionFormScreen.test.ts`, `TransactionsScreen.test.ts`.

## Deviations from Plan

**Auto-fixed Issues (Rule 2 — auto-add missing correctness):**

**1. [Rule 2] Added `minHeight: 44` to `styles.button` base block in Button.tsx (Task 6 discovery)**
- **Found during:** Task 6 audit pass (after Tasks 1-4 completed).
- **Issue:** The verifier scans `<TouchableOpacity` open tags and resolves `styles.<key>` references in a 200-back/600-forward character window. Button.tsx's root TouchableOpacity uses dynamic `styles[size]` indexing, which the verifier cannot statically resolve. After Task 1, only `styles.small` had `minHeight: 44`; `styles.medium` and `styles.large` met 44 via padding heuristically but not formally. The `--check=all-touchables` flagged Button.tsx:35 as a fail.
- **Fix:** Added `minHeight: 44` to `styles.button` base style (always applied to every size). This is the architecturally cleanest fix — every Button instance is now guaranteed ≥44 tall regardless of size variant.
- **Files modified:** `frontend/src/components/Button.tsx`
- **Commit:** `97156d3` (Task 6)

**2. [Rule 2] Added `minHeight: 44, minWidth: 44` to `styles.passwordToggle` in Input.tsx (Task 6 discovery)**
- **Found during:** Task 6 audit pass.
- **Issue:** Password-visibility toggle TouchableOpacity (Input.tsx:47) had only `paddingHorizontal: 4` — too small to hit reliably on mobile.
- **Fix:** Explicit `minHeight: 44, minWidth: 44` on the toggle style.
- **Files modified:** `frontend/src/components/Input.tsx`
- **Commit:** `97156d3` (Task 6)

**3. [Rule 2] Added `minHeight: 44, justifyContent: 'center'` to `styles.tab` in Navigation.tsx (Task 6 discovery)**
- **Found during:** Task 6 audit pass.
- **Issue:** Login/Register tab buttons (Navigation.tsx:25, :33) used `paddingVertical: 16` + 16px text → roughly 48px effective height, but verifier is strict on the literal `minHeight: 44` declaration. Two `<TouchableOpacity>` sites share the same `styles.tab` so one style edit fixes both.
- **Fix:** `minHeight: 44, justifyContent: 'center'` on `styles.tab`.
- **Files modified:** `frontend/src/components/Navigation.tsx`
- **Commit:** `97156d3` (Task 6)

All three Task-6 discoveries were Rule 2 — correctness (a11y / touch-target) requirements, not architectural changes. Auto-fixed without checkpoint per the deviation rules.

**No CLAUDE.md-driven adjustments** — no project-level rules conflict with this plan's edits.

## Self-Check: PASSED

- All 6 plan-listed files exist and have been modified or created per acceptance criteria.
- Commits 69101ee, d7f7e84, 8077bff, 9cb2cbc, 97156d3 all verified in `git log`.
- Audit report archived at `.planning/phases/05-pwa-ify-frontend-mobile-polish/05-04-audit-report.txt` (69 lines, contains pre/post inventory + verifier confirmation lines).
- Button.test.ts: 3/3 GREEN.
- Five `verify-touch-targets --check=...` checks: all PASS.
- Full Jest suite: 5 suites, 64 tests, 0 failures.
- TransactionFormScreen.tsx amount-field TextInputs untouched (`keyboardType="decimal-pad"` count: 3; `inputMode="decimal"` count: 0 — both unchanged from baseline).
