# Phase 3: User Profile Management - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `PATCH /auth/me` endpoint accepting `base_currency` and `default_source_id` updates, a frontend `ProfileScreen` for editing base currency, and auto-set `default_source_id` on the user record when their first finance source is created.

No new authentication flows. No email/password change. No multi-user concerns.

</domain>

<decisions>
## Implementation Decisions

### Profile Navigation

- **D-01:** Add an "⚙️ Edit Profile" button to the Quick Actions card in `HomeScreen.tsx`, alongside the existing "Manage Finance Sources" and "View Transactions" buttons. Add `'profile'` to the `HomeView` union type and handle the `currentView === 'profile'` case to render `ProfileScreen`.

### ProfileScreen Layout

- **D-02:** Show a read-only account header (email and member-since date) at the top of the screen, followed by the base_currency picker field and a Save button below. The header uses the same Card/infoRow style as the existing Account Information card on HomeScreen.
- **D-03:** Use the Modal+FlatList currency picker pattern established in Phase 1 (D-09) and reused in Phase 2 (D-04). The picker is triggered by tapping the base_currency field; the same pattern already works on iOS, Android, and Web.

### Save Behavior

- **D-04:** Explicit Save button (not auto-save). User selects currency from modal, then taps "Save Changes" to call `PATCH /auth/me`. Consistent with TransactionFormScreen and FinanceSourceFormScreen. On success: call `refreshUser()` from `AuthContext`, show `Alert.alert` on native / `window.alert` on web (existing platform feedback pattern), then navigate back to 'main'.

### Backend — PATCH /auth/me

- **D-05:** Add `UserUpdate` Pydantic schema in `backend/app/schemas/user.py` with optional fields: `base_currency: str | None` and `default_source_id: UUID | None`. Both optional — only provided fields are applied (same partial-update pattern as `FinanceSourceUpdate`).
- **D-06:** Add `default_source_id` field to `UserResponse` schema — it exists on the `User` model and in `frontend/src/types/api.ts` but is currently missing from the Pydantic response schema. Must be patched here.
- **D-07:** In the `PATCH /auth/me` handler: validate that if `default_source_id` is provided, it refers to a finance source owned by the current user. Return 404 if not found or not owned.
- **D-08:** Normalize `base_currency` to uppercase (same as registration does: `user_data.base_currency.upper()`).

### Auto-Default Source (PROF-03)

- **D-09:** In `finance_sources.py` `create_finance_source` handler: after committing the new source, query for the count of finance sources belonging to the current user. If the newly created source is the first (count == 1 after commit, or check before creation), set `current_user.default_source_id = new_source.id` and commit the user record. This is purely additive — does not change the source creation response.

### Frontend — API and Types

- **D-10:** Add `updateMe` function to `frontend/src/api/auth.ts` calling `PATCH /auth/me` with a `UserUpdate` payload.
- **D-11:** Add `UserUpdate` interface to `frontend/src/types/api.ts` with `base_currency?: string` and `default_source_id?: string`.

### Claude's Discretion

- Exact styling and spacing of ProfileScreen (follow existing screen conventions)
- Whether to show a "Saved!" inline confirmation text in addition to the alert
- Error message wording for save failures

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend
- `backend/app/api/auth.py` — Existing auth routes; add `PATCH /auth/me` here alongside `GET /auth/me`
- `backend/app/schemas/user.py` — Add `UserUpdate` schema; also add `default_source_id` to `UserResponse`
- `backend/app/models/user.py` — `User` model with `base_currency`, `default_source_id` fields
- `backend/app/api/finance_sources.py` — `create_finance_source` handler; add auto-default logic here

### Frontend
- `frontend/src/screens/HomeScreen.tsx` — `HomeView` union type (line ~11); Quick Actions card (bottom portion); pattern for adding new views
- `frontend/src/api/auth.ts` — Add `updateMe` here alongside existing `getCurrentUser`
- `frontend/src/types/api.ts` — `User` interface (already has `default_source_id`); add `UserUpdate`
- `frontend/src/store/AuthContext.tsx` — `refreshUser()` already implemented; call after successful PATCH

### Patterns to carry forward
- `.planning/phases/01-wire-fix-and-harden/01-CONTEXT.md` §D-09 — Modal+FlatList currency picker pattern
- `.planning/phases/01-wire-fix-and-harden/01-CONTEXT.md` §D-12/D-13 — Platform.OS alert pattern for success/error

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Modal`, `FlatList`, `Platform`, `Alert` — all already imported in TransactionFormScreen; replicate exact currency picker pattern (lines 33–51 of TransactionFormScreen.tsx after Phase 1) for the base_currency picker in ProfileScreen
- `refreshUser()` in `AuthContext` — already calls `GET /auth/me` and updates `user` state; just call it after successful PATCH
- `useAuth()` hook — provides `user` (email, base_currency, created_at) for the read-only header
- Existing `Screen`, `Card`, `Button` components — use for ProfileScreen layout

### Established Patterns
- Partial update pattern: `model_dump(exclude_unset=True)` → `setattr` loop (used in `update_finance_source`) — reuse for PATCH /auth/me
- Platform feedback: `Platform.OS === 'web'` → `window.alert`, native → `Alert.alert` (established in Phase 1 bug fixes)
- HomeView navigation: `useState<HomeView>` + `setCurrentView(...)` — same pattern for 'profile' view
- `UserCreate.base_currency.upper()` normalization — replicate in PATCH handler

### Integration Points
- `HomeScreen.tsx` Quick Actions card: add `<Button title="⚙️ Edit Profile" ... onPress={() => setCurrentView('profile')} />` below existing buttons
- `HomeView` type: add `| 'profile'` to the union
- `UserResponse` schema: add `default_source_id: UUID | None` field — critical for frontend `user.default_source_id` to be populated after GET /auth/me
- `create_finance_source` handler: add post-commit check after `db.refresh(new_source)` — no new imports needed

</code_context>

<specifics>
## Specific Ideas

No specific UI references provided — follow existing screen conventions (same style as FinanceSourceFormScreen).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-user-profile-management*
*Context gathered: 2026-04-17*
