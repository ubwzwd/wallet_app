---
phase: 02
slug: complete-transfer-transactions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest-expo (Jest) |
| **Config file** | `frontend/jest.config.js` |
| **Quick run command** | `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest --testPathPattern=TransactionForm` |
| **Full suite command** | `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest --testPathPattern=TransactionForm`
- **After every plan wave:** Run `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | XFER-03 | — | N/A | static analysis | `npx jest --testPathPattern=TransactionForm` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | XFER-01 | — | N/A | static analysis | `npx jest --testPathPattern=TransactionForm` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | XFER-02 | — | N/A | static analysis | `npx jest --testPathPattern=TransactionForm` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/__tests__/TransactionFormScreen.test.ts` — stubs for XFER-01, XFER-02, XFER-03 using source-level static analysis pattern

*Existing infrastructure covers the framework — only the test file is missing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two-step wizard UX is visually correct | XFER-01 | Visual layout cannot be verified by static analysis | 1. Open TransactionFormScreen 2. Tap Transfer tab 3. Verify Step 1 shows FROM/TO pickers 4. Tap Next 5. Verify Step 2 shows amount/date fields |
| Transfer creates two linked records in DB | XFER-02 | Requires running backend + frontend together | 1. Create a transfer 2. Check transactions list for both legs 3. Verify both share same transfer_pair_id |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
