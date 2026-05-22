---
phase: 04-containerize-and-compose-locally
plan: 02
subsystem: infra
tags: [docker-compose, repo-layout, gitignore, docs]

requires:
  - 04-01-backend-dockerfile (sibling Phase 4 plan; not a strict dependency, both already on this branch)

provides:
  - infra/docker-compose.dev.yml — dev db-only compose at canonical D-02 location
  - .gitignore protection for infra/.env (T-04-06 mitigation) and frontend/dist/

affects:
  - 04-03..04-06 (any plan referencing the dev compose now points at infra/docker-compose.dev.yml)
  - backend/README.md docker workflow (all paths retargeted via ../infra/)
  - README.md (repo root) Quick Start

tech-stack:
  added: []
  patterns:
    - "Pure git mv first, content edits second — preserves 100% rename detection in git history"
    - "Touch-test-cleanup pattern for git check-ignore verification (no leftover artifact)"

key-files:
  created:
    - infra/docker-compose.dev.yml (via rename from backend/docker-compose.yml)
    - .planning/phases/04-containerize-and-compose-locally/deferred-items.md
  modified:
    - infra/docker-compose.dev.yml (drop version, replace api comment)
    - backend/README.md
    - README.md
    - .gitignore
  deleted:
    - backend/docker-compose.yml (renamed, not unlinked)

key-decisions:
  - "Two-commit pattern for the move: pure rename + content edits. A single combined commit dropped similarity below git's default rename threshold and broke history-following. Acceptance criterion `git log --diff-filter=R --summary` would have failed."
  - "Safer git-check-ignore verification: touch → test → unconditional rm, instead of plan's `|| touch && check-ignore` chain that left infra/.env on the success path. Planner warning honoured (Rule 1 fix)."
  - "SPEC.md (repo root) compose references intentionally NOT touched — file has ~850 lines of pre-existing uncommitted drift unrelated to this plan; logged in deferred-items.md."

requirements-completed:
  - DEPLOY-01

duration: 4min
completed: 2026-05-11
---

# Phase 04 Plan 02: Relocate Dev Compose Summary

**Dev db-only compose moved from `backend/docker-compose.yml` to `infra/docker-compose.dev.yml` with full git rename history preserved; obsolete `version:` line dropped; doc references retargeted; `.gitignore` extended with `infra/.env` and `frontend/dist/`.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-11T15:31:40Z
- **Completed:** 2026-05-11T15:35:31Z
- **Tasks:** 2 of 2
- **Files modified:** 5 (1 renamed, 2 docs, 1 gitignore, 1 new deferred-items log)

## Accomplishments

- Established the canonical `infra/` repo layout for compose orchestration (D-01/D-02). The dev compose now lives at `infra/docker-compose.dev.yml` next to `infra/Dockerfile.api` from plan 04-01.
- Preserved 100% git rename history via a deliberate two-commit pattern: `git mv` + commit (pure rename), then content edits in a second commit. `git log --diff-filter=R --summary -- infra/docker-compose.dev.yml` reports `rename backend/docker-compose.yml => infra/docker-compose.dev.yml (100%)`; `git log --follow` traces history back to Phase 1.1.
- Dropped obsolete `version: '3.8'` top-level key (Compose v2 emits a deprecation warning otherwise).
- Replaced the commented-out backend api service block with a one-line pointer to `infra/docker-compose.prod.yml` — clarifies that the dev compose is intentionally db-only.
- Volume name `postgres_data` preserved verbatim — existing developers' dev DB state survives the move untouched.
- Updated every doc reference to the moved file:
  - `backend/README.md`: all `docker-compose up -d db`, `docker-compose ps`, `docker-compose logs`, `docker-compose down -v` invocations now use `docker compose -f ../infra/docker-compose.dev.yml ...`; Project Structure tree no longer lists the moved files and points at `../infra/`; the "Docker Development" section names both `infra/docker-compose.dev.yml` (db-only) and `infra/docker-compose.prod.yml` (prod-shape, added in 04-05).
  - `README.md` (repo root): Quick Start backend step invokes `docker compose -f infra/docker-compose.dev.yml up -d db` from the repo root (no more `cd backend && docker-compose up -d`).
  - `backend/README.md` carries zero remaining occurrences of `backend/docker-compose.yml`; 6 references to `infra/docker-compose.dev.yml`.
- Appended `.gitignore` Phase 4 entries: `infra/.env` (T-04-06 explicit mitigation; `.env` was already globally ignored but the explicit line documents intent and is enforced by the SEC-01 acceptance test) and `frontend/dist/` (Phase 4 web bundle artifact per D-12, hoisted forward).
- T-04-07 mitigation in place: `grep -c 'backend/docker-compose.yml' backend/README.md` returns 0, so a future operator cannot follow a stale doc path to a missing file.

## Task Commits

1. **Task 1a: git mv backend/docker-compose.yml -> infra/docker-compose.dev.yml (pure rename)** — `32a0f9e` (refactor)
2. **Task 1b: drop version key + replace commented api block** — `3ff28fb` (refactor)
3. **Task 2: retarget docs + extend .gitignore** — `9245df5` (docs)

_Note: docs commit for SUMMARY.md / STATE.md / ROADMAP.md / REQUIREMENTS.md is added after this section by the executor protocol._

## Files Created/Modified

- `infra/docker-compose.dev.yml` (renamed from `backend/docker-compose.yml`, then edited):
  - line removed: top-level `version: '3.8'`
  - block replaced: the 20-line commented-out backend api service with a 3-line pointer at `infra/docker-compose.prod.yml`
  - kept verbatim: `db` service block (image, restart, environment, ports, volumes, healthcheck) and the `volumes: postgres_data:` declaration.
- `backend/docker-compose.yml` (deleted — via rename; commit reports `rename ... (100%)`).
- `backend/README.md` (modified):
  - §4 "Start PostgreSQL": `docker compose -f ../infra/docker-compose.dev.yml up -d db`
  - §Project Structure: removed `docker-compose.yml` and `Dockerfile` from tree; appended `(see ../infra/ for Docker / compose files)`
  - §Docker Development: rewritten to name both `infra/docker-compose.dev.yml` and `infra/docker-compose.prod.yml`
  - §Troubleshooting / Database connection errors: all four `docker-compose` commands rewritten to `docker compose -f ../infra/docker-compose.dev.yml ...`
- `README.md` (modified): Quick Start backend invocation uses `-f infra/docker-compose.dev.yml`.
- `.gitignore` (modified): appended `# Phase 4 infra\ninfra/.env\n\n# Frontend web build artifacts\nfrontend/dist/`.
- `.planning/phases/04-containerize-and-compose-locally/deferred-items.md` (new): logs out-of-scope discoveries.

## Decisions Made

- **Two-commit pattern for the move (rename, then edits) — not one combined commit.** First attempt combined `git mv` + version-line strip + comment-block replacement in a single commit; git's default rename detection (`-M50%`) dropped below threshold because the strip + block replacement modified a large portion of a small file. Result: history would have broken, the plan's `git log --diff-filter=R --summary` acceptance criterion would have failed, and `git log --follow` on the new file would have stopped at the commit. The fix was to soft-reset the bad commit, redo the move as a pure rename (`git mv` only, 100% similarity), commit it, then make the content edits in a second commit. Git log now shows `rename backend/docker-compose.yml => infra/docker-compose.dev.yml (100%)`. This is the canonical pattern for any large compose-file relocate.
- **SPEC.md compose references NOT touched in this plan.** SPEC.md at the repo root references `backend/docker-compose.yml` in two places but already has ~850 lines of pre-existing uncommitted drift from prior phases. Touching it would entangle this commit with unrelated changes and violate scope. Logged in `.planning/phases/04-containerize-and-compose-locally/deferred-items.md` for a future doc-sweep.
- **Both committed dev compose paths use `docker compose` (space) not `docker-compose` (hyphen).** Compose v1 (the `docker-compose` Python binary) is end-of-life; the Compose v2 plugin invocation is `docker compose`. The new docs reflect modern usage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's git-check-ignore verify chain leaves `infra/.env` on the success path**
- **Found during:** Pre-execution (planner-flagged warning in the environment notes)
- **Issue:** The plan's `<verify>` and `<acceptance_criteria>` used `... git check-ignore -q infra/.env || touch infra/.env && git check-ignore -q infra/.env`. Because `.env` is already globally ignored, the first `check-ignore` exits 0, the `||` short-circuits, and the `touch` never runs — fine. But if anyone runs this from a clean state where the file doesn't exist, the same shell logic doesn't create-then-test, and worse, future copy/paste of just the `touch && check-ignore` branch leaves `infra/.env` on disk afterwards (real-secret risk if a future contributor copies the test idiom into a real workflow).
- **Fix:** Replaced with the safer pattern in the executor verification: `touch infra/.env; git check-ignore -q infra/.env; RC=$?; rm -f infra/.env`. Always create, always test, always clean up. Confirmed exit 0 and confirmed `test ! -f infra/.env` post-test.
- **Files modified:** none (verification-time pattern only — the on-disk state is unchanged)
- **Committed in:** no source change; documented here per Rule 1 transparency

**2. [Rule 1 - Bug] Combined-commit rename strategy breaks git history**
- **Found during:** First commit attempt of Task 1 (`aa46f81`, since reset)
- **Issue:** `git mv` followed by content edits in a single commit produced `delete` + `create` instead of `rename` because git's default `-M50%` rename threshold was not met after stripping the `version:` line and replacing the 20-line api block. `git log --diff-filter=R --summary` for `infra/docker-compose.dev.yml` returned empty, failing the plan's history-preservation acceptance criterion.
- **Fix:** `git reset --soft HEAD~1`, restored both files to their pre-edit state, committed the pure rename first (`32a0f9e`, 100% similarity), then committed the content edits separately (`3ff28fb`). `git log -M --diff-filter=R --summary --all` now shows `rename backend/docker-compose.yml => infra/docker-compose.dev.yml (100%)`.
- **Files modified:** infra/docker-compose.dev.yml (re-applied edits in second commit)
- **Verification:** `git log --follow --oneline -- infra/docker-compose.dev.yml | head -2` shows `32a0f9e refactor(04-02): relocate dev compose to infra/ (pure rename)` then `8ee3f61 Phase 1.1: Setup backend project structure ...` — full history follows the file.
- **Committed in:** `32a0f9e` (rename) + `3ff28fb` (edits)

### Scope Boundary Notes

- **`SPEC.md` references not updated.** Two pre-existing references to `backend/docker-compose.yml` remain in SPEC.md §2.1 (Container line) and §2.2 (Repository Structure tree). The file has ~850 lines of uncommitted pre-existing edits from prior phases that would bundle into this commit. Logged in `deferred-items.md` for a future doc-sweep.
- **Top-level `README.md` markdownlint warnings.** Diagnostics flagged MD036/MD032/MD022/MD031/MD012 violations on lines 11-82 and 114-128. None are on lines I edited (94-101). Pre-existing; deferred.
- **`.claude/worktrees/agent-a8fd3383/` mirror.** Holds a copy of the repo from a prior agent worktree; references the old path. Untracked by git; out of scope.

---

**Total deviations:** 2 auto-fixed (1 verify-pattern bug; 1 commit-strategy bug discovered at first attempt)
**Impact on plan:** Both deviations were prerequisites for the plan's own acceptance criteria to pass. Neither expanded scope. The rename-history fix also preserves the file's git-blame and follows chain — a long-term win for code archaeology.

## Issues Encountered

- **Pre-existing uncommitted state in working tree.** The repo had several pre-existing modifications (SPEC.md, deleted M1_*.md files) before this plan started. None overlap with this plan's files. They will be picked up by a future maintenance commit; this plan only touched the files it owns.

## User Setup Required

None. The move is transparent to existing developers — their dev DB volume (`postgres_data`) is preserved, and the new compose path is documented in both READMEs.

## Known Stubs

None. Every change is live and verified.

## Threat Model Coverage

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-04-06 (Info Disclosure: infra/.env committed) | mitigate | `.gitignore` line `infra/.env` present (in addition to global `.env`); `touch infra/.env && git check-ignore -q infra/.env` exits 0. |
| T-04-07 (Tampering: stale doc paths cause wrong-compose mistake) | mitigate | `grep -c 'backend/docker-compose.yml' backend/README.md` returns 0; 6 references to `infra/docker-compose.dev.yml` in its place. |

## Next Phase Readiness

- `infra/docker-compose.dev.yml` is the canonical dev db path; plans 04-03..04-06 should reference it (not the moved location).
- `infra/.env` is gitignored — plan 04-04 (env-secrets) can safely author developer-local secrets at that path with no risk of accidental commit.
- `infra/` directory is now established alongside `infra/Dockerfile.api`; plan 04-05 (prod compose + Caddy) lands `infra/docker-compose.prod.yml` and `infra/Caddyfile` in the same directory.

## Self-Check: PASSED

Verified before reporting completion:

- `test ! -f backend/docker-compose.yml` → exit 0 (FOUND absent)
- `test -f infra/docker-compose.dev.yml` → exit 0 (FOUND present)
- `docker compose -f infra/docker-compose.dev.yml config -q` → exit 0 (lint clean)
- `grep -c '^version:' infra/docker-compose.dev.yml` → 0 (stripped)
- `grep -c 'image: postgres:15-alpine' infra/docker-compose.dev.yml` → 1 (preserved)
- `grep -c '^  postgres_data:$' infra/docker-compose.dev.yml` → 1 (volume declaration preserved)
- `grep -c '^infra/\.env$' .gitignore` → 1
- `grep -c '^frontend/dist/$' .gitignore` → 1
- `touch infra/.env && git check-ignore -q infra/.env; rm -f infra/.env` → exit 0, no leftover
- `grep -c 'backend/docker-compose.yml' backend/README.md` → 0
- `grep -c 'infra/docker-compose.dev.yml' backend/README.md` → 6
- `git log --diff-filter=R --summary -- infra/docker-compose.dev.yml` → reports `rename backend/docker-compose.yml => infra/docker-compose.dev.yml (100%)`
- `git log --oneline | grep 32a0f9e` → FOUND (`refactor(04-02): relocate dev compose to infra/ (pure rename)`)
- `git log --oneline | grep 3ff28fb` → FOUND (`refactor(04-02): drop obsolete version key + point comment at prod compose`)
- `git log --oneline | grep 9245df5` → FOUND (`docs(04-02): retarget docs to infra/docker-compose.dev.yml + gitignore infra/.env`)

---
*Phase: 04-containerize-and-compose-locally*
*Completed: 2026-05-11*
