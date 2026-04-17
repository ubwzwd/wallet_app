---
phase: 3
slug: user-profile-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (backend) + tsc type check (frontend) |
| **Config file** | `backend/` (no dedicated pytest.ini — tests run from `backend/tests/`) |
| **Quick run command** | `cd backend && python -m pytest tests/ -x -q` |
| **Full suite command** | `cd backend && python -m pytest tests/ -v` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && python -m pytest tests/ -x -q`
- **After every plan wave:** Run `cd backend && python -m pytest tests/ -v`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|----------|-----------|-------------------|--------|
| 03-01-00 | 01 | 0 | PROF-01 | `UserUpdate` schema exists with optional fields | structural | `cd backend && python -m pytest tests/test_profile_structure.py -x` | ⬜ pending |
| 03-01-01 | 01 | 1 | PROF-01 | `UserResponse` includes `default_source_id` field | structural | `cd backend && python -m pytest tests/test_profile_structure.py -x` | ⬜ pending |
| 03-01-02 | 01 | 1 | PROF-01 | `PATCH /auth/me` handler exists and normalizes `base_currency` to uppercase | unit | `cd backend && python -m pytest tests/test_profile_structure.py::test_patch_auth_me_normalizes_currency -x` | ⬜ pending |
| 03-01-03 | 01 | 1 | PROF-03 | `create_finance_source` sets `default_source_id` when count == 1 | structural/unit | `cd backend && python -m pytest tests/test_auto_default_source.py -x` | ⬜ pending |
| 03-02-01 | 02 | 2 | PROF-02 | `UserUpdate` TypeScript interface exists in types/api.ts | structural | `cd frontend && tsc --noEmit` | ⬜ pending |
| 03-02-02 | 02 | 2 | PROF-02 | `updateMe` function exported from api/auth.ts | structural | `cd frontend && tsc --noEmit` | ⬜ pending |
| 03-02-03 | 02 | 2 | PROF-02 | `ProfileScreen.tsx` file exists and renders a currency picker modal | structural/manual | `ls frontend/src/screens/ProfileScreen.tsx && cd frontend && tsc --noEmit` | ⬜ pending |
| 03-02-04 | 02 | 2 | PROF-02 | Frontend profile screen navigates from HomeScreen and saves successfully | manual-only | human verification checkpoint | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_profile_structure.py` — stubs for PROF-01: `UserUpdate` schema existence, `UserResponse.default_source_id` field, `PATCH /auth/me` handler, `base_currency.upper()` call
- [ ] `backend/tests/test_auto_default_source.py` — stubs for PROF-03: auto-default logic exists in `create_finance_source` (AST check for `default_source_id` assignment)
- [ ] Existing `backend/conftest.py` — already has psycopg2, jose, passlib mocks; sufficient for both new test files

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Frontend profile screen navigates from HomeScreen Quick Actions, displays currency picker, and saves successfully with real API call | PROF-02 | UI interaction and live API integration cannot be automated in static phase verification | 1. Navigate to HomeScreen 2. Tap "⚙️ Edit Profile" button in Quick Actions 3. Tap the currency field to open modal 4. Select a different currency 5. Tap "Save Changes" 6. Verify success alert appears 7. Verify `GET /auth/me` returns new `base_currency` |
| Creating first finance source auto-sets `default_source_id` on user record | PROF-03 | Requires live database state; verified in `GET /auth/me` response after creation | 1. Create a new user via registration 2. Create the first finance source 3. Call `GET /auth/me` 4. Verify `default_source_id` is non-null and matches the created source ID |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter after gate passes

**Approval:** pending
