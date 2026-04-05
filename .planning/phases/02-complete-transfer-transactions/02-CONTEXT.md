# Phase 2: Complete Transfer Transactions - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable the Transfer tab in `TransactionFormScreen.tsx` and build a functional two-step wizard: step 1 selects source and destination finance sources, step 2 enters amount/date and confirms. Two `POST /api/v1/transactions` calls create the debit and credit legs linked via a shared `transfer_pair_id` UUID. Also enables editing existing transfer transactions (amount/date on both legs).

No backend changes needed. No new dependencies.

</domain>

<decisions>
## Implementation Decisions

### Transfer UX flow

- **D-01:** True wizard with sequential steps. Step 1 shows FROM source (existing source field) and TO destination source picker. A "Next →" button advances to Step 2. Step 2 shows amount, date, optional description/merchant/tags, and "Create Transfer" submit. A "← Back" button returns to Step 1.
- **D-02:** Show a step indicator in the section header: "Step 1 of 2 — Select Accounts" and "Step 2 of 2 — Enter Amount". Keep styling consistent with existing `sectionLabel` Text style.
- **D-03:** The existing Finance Source field (FROM) stays in Step 1. The new destination picker (TO) appears below it. Both clearly labeled "From" and "To".

### Destination source picker

- **D-04:** Use the Modal+FlatList pattern established in Phase 1 for the currency picker (D-09 from Phase 1 CONTEXT). Platform-aware: Modal on all platforms, same styling. This is the only pattern that works on iOS/Android/Web without raw `<select>`.
- **D-05:** Destination source list is sourced from the same `sources` query already in the form. Exclude the currently selected FROM source from the TO list (can't transfer to same source). If only one source exists: disable the Transfer tab and show "Add another finance source to create transfers".

### transfer_pair_id generation

- **D-06:** Generate client-side using `crypto.randomUUID()` — available in Expo/React Native without any new dependency. Generate once before the first POST, pass to both legs.

### Amount sign convention

- **D-07:** Debit leg (FROM source): `amount = -Math.abs(userEnteredAmount)`. Credit leg (TO source): `amount = +Math.abs(userEnteredAmount)`. Same currency for both legs (the currency the user selects in Step 2).

### Partial failure handling

- **D-08:** If first POST succeeds and second POST fails: immediately call `deleteTransaction(firstLeg.id)`. If the delete also fails: show a specific error message — "Transfer partially created. One transaction may exist in your account — please check your transactions and delete manually if needed."
- **D-09:** Success feedback follows existing pattern: `Platform.OS === 'web'` → `window.alert`, native → `Alert.alert`.

### Editing existing transfer transactions

- **D-10:** Enable editing for transfers. When `isEditing && transaction.transfer_pair_id`: show a simplified form with only amount, date, description, merchant, tags (no type or source changes). On submit: call `updateTransaction` on the current transaction **and** fetch the paired leg via `GET /transactions?transfer_pair_id={id}` then `updateTransaction` on it with matching amount (opposite sign) and same date.
- **D-11:** Do NOT allow changing source or destination on an existing transfer edit. Do NOT allow changing currency on edit (would require conversion recalculation). These fields are read-only in edit mode for transfers.

### Claude's Discretion

- Exact step indicator styling (font size, color, position)
- Loading state during the two sequential POSTs (single spinner covering both calls is fine)
- Cancel button behavior (dismiss the form entirely, same as existing cancel)
- Whether to show a "You cannot edit transfer source/currency" note in edit mode (informational only)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary implementation target
- `frontend/src/screens/TransactionFormScreen.tsx` — The file to modify; transfer button at lines 203–214 (disabled); existing source picker, form state, mutations, validation logic
- `frontend/src/types/api.ts` — `TransactionCreate` already has `transfer_pair_id?: string`; `Transaction` already has `transfer_pair_id: string | null` — no type changes needed
- `frontend/src/api/transactions.ts` — `createTransaction`, `updateTransaction`, `deleteTransaction` — the functions to call for both legs

### Patterns to follow from Phase 1
- `frontend/src/screens/TransactionFormScreen.tsx` lines 33–51 — the currency picker Modal+FlatList pattern (D-09 from Phase 1) — replicate for destination source picker
- `.planning/phases/01-wire-fix-and-harden/01-CONTEXT.md` §D-09 — Modal+FlatList pattern decision and rationale

### Conventions
- `.planning/codebase/CONVENTIONS.md` — Platform.OS patterns, Alert.alert usage, TanStack Query mutation conventions
- `.planning/codebase/STRUCTURE.md` — Screen file location, component import patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sources` query: already fetched in `TransactionFormScreen` (`useQuery` with `QUERY_KEYS.FINANCE_SOURCES`) — no new fetch needed for the destination picker list
- `createTransaction`, `deleteTransaction` from `frontend/src/api/transactions.ts` — both already available and imported
- `Modal`, `FlatList`, `TouchableOpacity`, `Platform` — all already imported in `TransactionFormScreen.tsx`
- `QUERY_KEYS` constant: add nothing new — `FINANCE_SOURCES` query already used
- `crypto.randomUUID()` — available in Expo without imports

### Established Patterns
- Currency picker in this same file (lines 33–51): Modal visibility state, FlatList render, TouchableOpacity items — replicate exactly for destination source picker
- `isLoading` guard: `createMutation.isPending || updateMutation.isPending` — extend to cover both leg mutations
- `Platform.OS === 'web'` check in `onSuccess`/`onError` callbacks — maintain this pattern for transfer success/error

### Integration Points
- Transfer button: lines 203–214 — remove `disabled` prop, clear the "coming soon" hint
- Validation: line 123–125 — remove the "Transfer not supported" error case; add new transfer-specific validations (destination required)
- `handleSubmit`: lines 131–165 — add a `type === 'transfer'` branch calling two mutations sequentially
- `isEditing` path (lines 143–164): add a transfer-aware update path

</code_context>

<specifics>
## Specific Ideas

- Step wizard: keep both steps within the same `TransactionFormScreen` component using a `step` state variable (1 or 2) — no routing/modal needed, just conditional rendering within the existing `ScrollView`
- Destination source picker: clone the currency picker pattern exactly (same Modal structure, same FlatList, just sources instead of currencies)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-complete-transfer-transactions*
*Context gathered: 2026-04-05*
