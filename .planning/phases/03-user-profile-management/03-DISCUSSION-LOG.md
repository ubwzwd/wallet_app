# Phase 3: User Profile Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 03-user-profile-management
**Areas discussed:** Profile navigation, ProfileScreen layout, Save behavior

---

## Profile Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| ⚙️ Quick Actions button | Add "⚙️ Edit Profile" button to Quick Actions card in HomeScreen alongside existing nav buttons | ✓ |
| Tappable Account Info card | Make the Account Information card tappable to open profile settings | |

**User's choice:** ⚙️ Quick Actions button
**Notes:** Recommended option — most discoverable, consistent with existing navigation pattern

---

## ProfileScreen Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Currency picker + account header | Read-only header (email, member since) + base_currency picker + Save button | ✓ |
| Minimal — just the picker | Only the base_currency picker and a Save button | |

**User's choice:** Currency picker + account header
**Notes:** Recommended option — users can see their account info in context

---

## Save Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit Save button | User picks currency, then taps Save to persist. Consistent with other forms. | ✓ |
| Auto-save on picker selection | Immediately calls PATCH /auth/me when user picks currency from modal | |

**User's choice:** Explicit Save button
**Notes:** Recommended option — consistent with TransactionFormScreen and FinanceSourceFormScreen

---

## Claude's Discretion

- Exact ProfileScreen styling and spacing
- Whether to show inline "Saved!" confirmation text in addition to alert
- Error message wording for save failures

## Deferred Ideas

None
