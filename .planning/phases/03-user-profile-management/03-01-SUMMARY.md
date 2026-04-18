---
phase: 03-user-profile-management
plan: "01"
subsystem: backend
tags: [profile, user, patch, schema, finance-source, auto-default]

dependency_graph:
  requires: []
  provides: [PROF-01, PROF-03]
  affects: [backend/app/schemas/user.py, backend/app/api/auth.py, backend/app/api/finance_sources.py]

tech_stack:
  added: []
  patterns:
    - "model_dump(exclude_unset=True) for partial update"
    - "Ownership query filtered by user_id before accepting IDOR-sensitive field"
    - "Post-commit count guard for auto-default assignment"

key_files:
  created:
    - backend/tests/test_profile_structure.py
    - backend/tests/test_auto_default_source.py
  modified:
    - backend/app/schemas/user.py
    - backend/app/api/auth.py
    - backend/app/api/finance_sources.py

decisions:
  - "UserUpdate uses Field(min_length=3, max_length=3) to enforce ISO 4217 code length at schema boundary"
  - "Ownership check for default_source_id uses FinanceSource.user_id == current_user.id filter returning 404 on mismatch (D-07)"
  - "Auto-default guard fires post-commit using source_count == 1 (D-09)"
  - "test_config.py DEBUG=False failures are pre-existing and out of scope for this plan"

metrics:
  duration: "~20 minutes"
  completed_date: "2026-04-18"
  tasks_completed: 4
  files_changed: 5
---

# Phase 03 Plan 01: User Profile Backend — Schema, PATCH /me, Auto-Default Source Summary

**One-liner:** PATCH /auth/me endpoint with IDOR-safe ownership check, uppercase currency normalization, and auto-default_source_id assignment on first finance source creation.

## What Was Built

This plan delivered three backend changes required to unblock the Phase 03 frontend ProfileScreen (Plan 02) and fulfill requirements PROF-01 and PROF-03.

**Task 0 (Wave 0) — Failing structural tests (RED)**
Created two structural test files that run against source text and imported modules (no live DB/HTTP). Both fail RED until Tasks 1-3 land, acting as a specification lock.

**Task 1 — UserUpdate schema + UserResponse.default_source_id**
Added `UserUpdate` Pydantic schema with `base_currency` (min/max_length=3) and optional `default_source_id`. Patched `UserResponse` to expose the already-existing `default_source_id` column from the User model.

**Task 2 — PATCH /auth/me handler**
Registered `@router.patch("/me")` in `auth.py`:
- Imports `FinanceSource` for the ownership check (D-07): queries `FinanceSource.id == user_data.default_source_id AND FinanceSource.user_id == current_user.id`, raises 404 on mismatch
- Normalizes `base_currency` to uppercase (D-08)
- Uses `model_dump(exclude_unset=True)` for partial-update semantics

**Task 3 — Auto-default_source_id on first finance source creation**
Inserted post-commit count guard in `create_finance_source` (D-09): after `db.refresh(new_source)`, counts user's sources; assigns `current_user.default_source_id = new_source.id` only when `source_count == 1`.

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 0 | 3b48d8b | test(03-01): add failing structural tests for PROF-01 and PROF-03 |
| Task 1 | eef3b6b | feat(03-01): add UserUpdate schema and default_source_id to UserResponse |
| Task 2 | a167a45 | feat(03-01): add PATCH /auth/me handler with ownership check and currency normalization |
| Task 3 | de0370d | feat(03-01): auto-set default_source_id on first finance source creation |

## Verification Results

All 10 structural tests pass:
- `test_profile_structure.py` — 8 tests for PROF-01 (schema shape, handler registration, uppercase, ownership, exclude_unset)
- `test_auto_default_source.py` — 2 tests for PROF-03 (default_source_id assigned, assignment after refresh)

Full suite (excluding pre-existing test_config.py failures): 29 passed.

## Deviations from Plan

None — plan executed exactly as written. The `test_config.py` DEBUG=False failures are pre-existing (confirmed via git stash check before any 03-01 commits) and are tracked in deferred-items.md.

## Known Stubs

None — no hardcoded empty values or placeholder data wired to UI rendering.

## Threat Flags

No new threat surface introduced beyond what the plan's threat model covers:
- T-03-01 (IDOR): mitigated by ownership query in PATCH /me handler
- T-03-02 (Tampering): mitigated by Pydantic min/max_length=3 + .upper() normalization
- T-03-03 (Info Disclosure): accepted — user's own data exposed to authenticated owner
- T-03-04 (Race): accepted — single-user application; post-commit count guard sufficient

## Self-Check: PASSED

| Item | Status |
|------|--------|
| backend/tests/test_profile_structure.py | FOUND |
| backend/tests/test_auto_default_source.py | FOUND |
| backend/app/schemas/user.py | FOUND |
| backend/app/api/auth.py | FOUND |
| backend/app/api/finance_sources.py | FOUND |
| Commit 3b48d8b (test Task 0) | FOUND |
| Commit eef3b6b (feat Task 1) | FOUND |
| Commit a167a45 (feat Task 2) | FOUND |
| Commit de0370d (feat Task 3) | FOUND |
