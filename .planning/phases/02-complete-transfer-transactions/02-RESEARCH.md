# Phase 2: Complete Transfer Transactions - Research

**Researched:** 2026-04-14
**Domain:** React Native / Expo — multi-step form wizard, sequential TanStack Query mutations, platform-aware pickers
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** True wizard with sequential steps. Step 1 shows FROM source (existing source field) and TO destination source picker. A "Next →" button advances to Step 2. Step 2 shows amount, date, optional description/merchant/tags, and "Create Transfer" submit. A "← Back" button returns to Step 1.
- **D-02:** Show a step indicator in the section header: "Step 1 of 2 — Select Accounts" and "Step 2 of 2 — Enter Amount". Keep styling consistent with existing `sectionLabel` Text style.
- **D-03:** The existing Finance Source field (FROM) stays in Step 1. The new destination picker (TO) appears below it. Both clearly labeled "From" and "To".
- **D-04:** Use the Modal+FlatList pattern established in Phase 1 for the currency picker. Platform-aware: Modal on all platforms, same styling. This is the only pattern that works on iOS/Android/Web without raw `<select>`.
- **D-05:** Destination source list sourced from same `sources` query already in the form. Exclude the FROM source from the TO list. If only one source exists: disable Transfer tab with hint "Add another finance source to enable transfers."
- **D-06:** Generate `transfer_pair_id` client-side using `crypto.randomUUID()` — available in Expo without any new dependency.
- **D-07:** Debit leg (FROM source): `amount = -Math.abs(userEnteredAmount)`. Credit leg (TO source): `amount = +Math.abs(userEnteredAmount)`. Same currency for both legs.
- **D-08:** If first POST succeeds and second POST fails: immediately call `deleteTransaction(firstLeg.id)`. If delete also fails: show specific error message about partial creation.
- **D-09:** Success/error feedback follows existing pattern: `Platform.OS === 'web'` → `window.alert`, native → `Alert.alert`.
- **D-10:** Enable editing for transfers. When `isEditing && transaction.transfer_pair_id`: show simplified form (amount, date, description, merchant, tags only). On submit: call `updateTransaction` on current transaction AND fetch the paired leg via `GET /transactions?transfer_pair_id={id}` then `updateTransaction` on it with opposite sign and same date.
- **D-11:** Do NOT allow changing source or destination on an existing transfer edit. Do NOT allow changing currency on edit. These fields are read-only in edit mode for transfers.

### Claude's Discretion

- Exact step indicator styling (font size, color, position)
- Loading state during the two sequential POSTs (single spinner covering both calls is fine)
- Cancel button behavior (dismiss the form entirely, same as existing cancel)
- Whether to show a "You cannot edit transfer source/currency" note in edit mode (informational only)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| XFER-01 | User can create a transfer transaction via a two-step form (select destination source, enter amount) | Two-step wizard pattern using `step` state variable; destination picker using Modal+FlatList clone of currency picker |
| XFER-02 | Transfer creation links two transactions via a shared `transfer_pair_id` UUID | Client-side `crypto.randomUUID()` (D-06); both POSTs carry the same UUID; backend already stores and returns `transfer_pair_id` |
| XFER-03 | Transfer button in TransactionFormScreen is enabled and functional (not disabled/coming soon) | Remove `disabled` prop from lines 203–214; remove "coming soon" hint; add single-source guard using `sources?.length` check |

</phase_requirements>

---

## Summary

Phase 2 is a pure frontend change to `TransactionFormScreen.tsx`. No backend modifications, no new dependencies. The existing API, types, and query infrastructure are already in place — the work is wiring a two-step wizard UI, enabling sequential creation mutations, and handling the transfer edit path.

The dominant pattern to follow is the currency picker Modal+FlatList (lines 281–322 of `TransactionFormScreen.tsx`), which must be cloned for the destination source picker. The step wizard is implemented with a `step: 1 | 2` state variable and conditional JSX rendering inside the existing `ScrollView` — no routing or modals needed for the wizard itself.

One gap exists in the edit path (D-10): CONTEXT.md specifies filtering by `transfer_pair_id` via `GET /transactions?transfer_pair_id={id}`, but the backend `list_transactions` endpoint does not support this query parameter. The planner must choose between: (a) adding `transfer_pair_id` filter support to the backend `list_transactions` endpoint, or (b) fetching all transactions and filtering client-side using the already-loaded query cache.

**Primary recommendation:** Implement the wizard and creation path exactly per the locked decisions. For edit mode, use the TanStack Query cache (`getTransactions` result already cached under `QUERY_KEYS.TRANSACTIONS`) to find the paired leg client-side — avoids any backend change while keeping the phase boundary clean.

---

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React Native | existing | Modal, FlatList, TouchableOpacity, Platform, Alert | Core cross-platform primitives already imported |
| `@tanstack/react-query` | existing | `useMutation`, `useQuery`, `useQueryClient` | Project standard for all async state; mutations already wired |
| `crypto.randomUUID()` | built-in (Expo) | Client-side UUID generation for `transfer_pair_id` | Available globally in Expo without import per D-06 |

[VERIFIED: codebase grep — all imports already present in TransactionFormScreen.tsx lines 1–9]

### No New Dependencies

This phase adds no packages. `crypto.randomUUID()` is available in the Expo/React Native runtime without an import. [VERIFIED: CONTEXT.md D-06, CLAUDE.md not found — no project-level override]

---

## Architecture Patterns

### Step Wizard Pattern

**What:** A `step` state variable (`1 | 2`) gates which JSX renders inside the existing `Card`. No navigation, no modals for the wizard itself.

**When to use:** Single-screen multi-step flows where all state is local. Avoids navigation stack complexity for short wizards.

**Pattern:**
```typescript
// Source: CONTEXT.md §specifics + codebase inference
const [step, setStep] = useState<1 | 2>(1);
const [destinationSourceId, setDestinationSourceId] = useState('');
const [destPickerVisible, setDestPickerVisible] = useState(false);

// In JSX, within the existing Card:
{type === 'transfer' && step === 1 && (
  // Step 1: FROM + TO pickers + Next/Cancel
)}
{type === 'transfer' && step === 2 && (
  // Step 2: Amount, currency, date, etc. + Back/Create Transfer
)}
{type !== 'transfer' && (
  // Existing non-transfer form fields
)}
```

[ASSUMED: step state scoped to the same component; pattern inferred from CONTEXT.md §specifics]

### Destination Source Picker (Modal+FlatList clone)

**What:** Exact structural clone of the currency picker at lines 281–322. Uses the same `sources` query already loaded in the form.

**Platform branching:**
- **Web:** `<select>` element using existing `pickerContainer` + `picker` styles, filtered to exclude FROM source
- **Native:** `TouchableOpacity` trigger + `Modal` + `FlatList` (exact clone of currency picker)

**Pattern (native branch):**
```typescript
// Source: TransactionFormScreen.tsx lines 281–322 (currency picker to clone)
<TouchableOpacity
  style={styles.currencyTrigger}
  onPress={() => setDestPickerVisible(true)}
>
  <Text style={styles.currencyTriggerText}>
    {sources?.find(s => s.id === destinationSourceId)?.name || 'Select destination'}
  </Text>
</TouchableOpacity>

<Modal
  visible={destPickerVisible}
  animationType="slide"
  onRequestClose={() => setDestPickerVisible(false)}
>
  <View style={styles.modalContainer}>
    <View style={styles.modalHeader}>
      <Text style={styles.modalTitle}>Select Destination</Text>
      <TouchableOpacity onPress={() => setDestPickerVisible(false)}>
        <Text style={styles.modalClose}>Close</Text>
      </TouchableOpacity>
    </View>
    <FlatList
      data={sources?.filter(s => s.id !== sourceId)}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        const isSelected = item.id === destinationSourceId;
        return (
          <TouchableOpacity
            style={[styles.currencyItem, isSelected && styles.currencyItemSelected]}
            onPress={() => {
              setDestinationSourceId(item.id);
              setDestPickerVisible(false);
            }}
          >
            <Text style={[styles.currencyItemText, isSelected && styles.currencyItemTextSelected]}>
              <Text style={styles.currencyCode}>{item.name}</Text>
              {` (${item.default_currency})`}
            </Text>
          </TouchableOpacity>
        );
      }}
      ItemSeparatorComponent={() => <View style={styles.currencyDivider} />}
    />
  </View>
</Modal>
```

[VERIFIED: codebase — currency picker Modal+FlatList at TransactionFormScreen.tsx lines 281–322; style keys confirmed in StyleSheet lines 390–526]

### Sequential Mutation Pattern (Create Transfer)

**What:** Two `createTransaction` calls executed sequentially. First POST creates the debit leg. On success, second POST creates the credit leg. On second POST failure, delete the first leg.

**Pattern:**
```typescript
// Source: CONTEXT.md D-06, D-07, D-08
const handleTransferSubmit = async () => {
  const pairId = crypto.randomUUID();
  const absAmount = Math.abs(parseFloat(amount));
  const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
  const commonFields = {
    currency: currency.toUpperCase(),
    occurred_at: date,
    description: description.trim() || undefined,
    merchant: merchant.trim() || undefined,
    tags,
    transfer_pair_id: pairId,
  };

  let firstLeg: Transaction;
  try {
    firstLeg = await transactionsApi.createTransaction({
      source_id: sourceId,
      amount: -absAmount,
      ...commonFields,
    });
  } catch (err: any) {
    // First POST failed — nothing to clean up
    showError(err.message || 'Failed to create transfer');
    return;
  }

  try {
    await transactionsApi.createTransaction({
      source_id: destinationSourceId,
      amount: absAmount,
      ...commonFields,
    });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
    showSuccess('Transfer created successfully!');
    onSuccess();
  } catch (secondErr: any) {
    // Second POST failed — attempt rollback
    try {
      await transactionsApi.deleteTransaction(firstLeg.id);
    } catch {
      showPartialFailureError();
      return;
    }
    showError(secondErr.message || 'Failed to create transfer');
  }
};
```

Note: Because this is a sequential async flow (not parallel), it cannot use `useMutation` with its `onSuccess`/`onError` callbacks in the standard chained pattern. Use direct `await` calls inside an `async` handler, with `isPending` state managed via a local `useState<boolean>`. [ASSUMED: pattern inferred from sequential requirement; TanStack Query mutations can be called imperatively via `mutateAsync`]

**Alternative via `mutateAsync`:** TanStack Query exposes `mutateAsync` which returns a promise, enabling sequential calls without abandoning the mutation abstraction. This keeps `isPending` on the mutation objects rather than requiring separate state.

```typescript
// Using mutateAsync for sequential calls
const firstLeg = await createMutation.mutateAsync({ source_id: sourceId, amount: -absAmount, ... });
await createMutation.mutateAsync({ source_id: destinationSourceId, amount: absAmount, ... });
```

[VERIFIED: TanStack Query docs — `mutateAsync` is a standard API that returns Promise<TData>]

### Transfer Edit Pattern (D-10)

**What:** When `isEditing && transaction?.transfer_pair_id`, render a simplified form and update both legs on submit.

**Gap identified:** CONTEXT.md D-10 specifies `GET /transactions?transfer_pair_id={id}` to find the paired leg. However, the backend `list_transactions` endpoint at `GET /api/v1/transactions` does NOT support a `transfer_pair_id` query parameter. [VERIFIED: backend/app/api/transactions.py — `list_transactions` accepts `source_id`, `from_date`, `to_date`, `tag`, `limit`, `offset` only]

**Recommended approach (no backend change):** Use the TanStack Query cache. The transactions list is already cached under `QUERY_KEYS.TRANSACTIONS`. Call `queryClient.getQueryData([QUERY_KEYS.TRANSACTIONS])` to get cached transactions, then find the paired leg by `transfer_pair_id`. If cache is empty, fetch all transactions and filter.

```typescript
// Find paired leg from cache
const allTransactions = queryClient.getQueryData<Transaction[]>([QUERY_KEYS.TRANSACTIONS]) ?? [];
const pairedLeg = allTransactions.find(
  t => t.transfer_pair_id === transaction.transfer_pair_id && t.id !== transaction.id
);
```

[ASSUMED: Query cache key shape is `[QUERY_KEYS.TRANSACTIONS]` without filter params — confirmed by TransactionsScreen.tsx but exact cache key structure for the list query needs verification against TransactionsScreen.tsx]

### Single-Source Guard

**What:** If `sources?.length <= 1`, disable the Transfer type button and show hint text.

```typescript
// In JSX — Transfer button
<Button
  title="🔄 Transfer"
  variant={type === 'transfer' ? 'primary' : 'secondary'}
  onPress={() => setType('transfer')}
  style={styles.typeButton}
  size="small"
  disabled={!sources || sources.length <= 1}
/>
{(!sources || sources.length <= 1) && (
  <Text style={styles.hint}>Add another finance source to enable transfers.</Text>
)}
```

[VERIFIED: CONTEXT.md D-05]

### Anti-Patterns to Avoid

- **Parallel mutation:** Do NOT fire both POST calls in parallel. The debit leg must exist before creating the credit leg so rollback is possible on partial failure.
- **New dependencies for UUID:** Do NOT import `uuid` or `nanoid`. Use `crypto.randomUUID()` (D-06).
- **Raw `<select>` for destination picker on native:** The currency picker already uses Modal+FlatList for native. The destination picker must follow the same pattern (D-04).
- **Changing sources on edit:** Do NOT render source or currency fields in transfer edit mode (D-11).
- **Routing for wizard steps:** Do NOT use navigation/routing for steps. Keep everything in one component with `step` state.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom UUID function | `crypto.randomUUID()` | Built into Expo runtime; no import needed |
| Platform-branched picker | Custom picker component | Clone of existing currency picker Modal+FlatList | Pattern already established, tested by Phase 1 |
| Query cache lookup | Re-fetch from API | `queryClient.getQueryData()` | Avoids extra network call; data already in cache from TransactionsScreen |

---

## Common Pitfalls

### Pitfall 1: `step` state not reset when switching type
**What goes wrong:** User opens Transfer (step 1), clicks Back to income, then clicks Transfer again — form is on step 2.
**Why it happens:** `step` state persists across type changes if not reset.
**How to avoid:** Reset `step` to `1` in the `setType` handler, or in a `useEffect` watching `type`.
**Warning signs:** Step 2 appears immediately when Transfer tab is tapped.

### Pitfall 2: Paired leg not found in cache
**What goes wrong:** Edit mode fails silently when the paired leg is missing from cache (e.g., user navigated directly to edit without viewing the list first).
**Why it happens:** TanStack Query cache is empty on first render if list screen was never opened.
**How to avoid:** Add a fallback `getTransactions()` call when `pairedLeg` is undefined. Show a loading state, not a silent no-op.
**Warning signs:** "Update Transfer" updates only one leg.

### Pitfall 3: `isLoading` not covering both POST calls
**What goes wrong:** Create Transfer button appears to complete after first POST, user taps again, creating duplicate transfer pair.
**Why it happens:** `createMutation.isPending` resets between the two sequential calls if using two separate mutations.
**How to avoid:** Use a single local `isSubmitting` boolean state that covers the entire sequential operation. Set true before first POST, false after both complete (success or error).
**Warning signs:** Button briefly re-enables between the two API calls.

### Pitfall 4: Destination picker shows FROM source in list
**What goes wrong:** User selects the same source for both FROM and TO, creating a meaningless self-transfer.
**Why it happens:** `sources` data is filtered client-side — easy to forget to exclude `sourceId`.
**How to avoid:** `sources?.filter(s => s.id !== sourceId)` in the FlatList `data` prop and in the web `<select>` option rendering. Also validate in `validate()` that `destinationSourceId !== sourceId`.
**Warning signs:** Same source appears in both dropdowns.

### Pitfall 5: `step` not reset on form cancel/success
**What goes wrong:** Next time the modal opens, step 2 is shown immediately.
**Why it happens:** Component state persists if the parent doesn't unmount the component between opens.
**How to avoid:** Reset `step` to `1` in the `onCancel` and `onSuccess` callbacks (or rely on parent unmounting).

### Pitfall 6: Backend `transfer_pair_id` filter not available
**What goes wrong:** `getTransactions({ transfer_pair_id: id })` returns all transactions (param silently ignored) instead of filtered pair.
**Why it happens:** Backend `list_transactions` does not accept `transfer_pair_id` as a filter parameter. [VERIFIED: backend/app/api/transactions.py lines 145–215]
**How to avoid:** Use the TanStack Query cache instead of a network filter. See Architecture Patterns — Transfer Edit Pattern above.

---

## Code Examples

Verified patterns from official sources:

### Existing Currency Picker to Clone (source: TransactionFormScreen.tsx lines 281–322)
```typescript
// Native Modal+FlatList pattern — replicate exactly for destination source picker
<TouchableOpacity
  style={styles.currencyTrigger}
  onPress={() => setCurrencyPickerVisible(true)}
>
  <Text style={styles.currencyTriggerText}>{currency}</Text>
</TouchableOpacity>

<Modal
  visible={currencyPickerVisible}
  animationType="slide"
  onRequestClose={() => setCurrencyPickerVisible(false)}
>
  <View style={styles.modalContainer}>
    <View style={styles.modalHeader}>
      <Text style={styles.modalTitle}>Select Currency</Text>
      <TouchableOpacity onPress={() => setCurrencyPickerVisible(false)}>
        <Text style={styles.modalClose}>Close</Text>
      </TouchableOpacity>
    </View>
    <FlatList
      data={currencies}
      keyExtractor={(item) => item}
      renderItem={({ item }) => { ... }}
      ItemSeparatorComponent={() => <View style={styles.currencyDivider} />}
    />
  </View>
</Modal>
```
[VERIFIED: codebase — TransactionFormScreen.tsx lines 281–322]

### Alert Pattern (source: TransactionFormScreen.tsx lines 77–108)
```typescript
// Success feedback
if (Platform.OS === 'web') {
  window.alert('Success\n\nTransfer created successfully!');
} else {
  Alert.alert('Success', 'Transfer created successfully!');
}
onSuccess();

// Partial failure feedback
if (Platform.OS === 'web') {
  window.alert('Transfer Error\n\nTransfer partially created. One transaction may exist in your account — please check your transactions and delete manually if needed.');
} else {
  Alert.alert('Transfer Error', 'Transfer partially created. One transaction may exist in your account — please check your transactions and delete manually if needed.');
}
```
[VERIFIED: codebase — CONTEXT.md D-08, D-09; Alert import already in TransactionFormScreen.tsx line 2]

### Validation Extension (source: TransactionFormScreen.tsx lines 111–128)
```typescript
// Add to validate() function
if (type === 'transfer') {
  // Remove: newErrors.type = 'Transfer transactions are not yet supported...'
  if (!destinationSourceId) {
    newErrors.destinationSourceId = 'Destination source is required';
  }
  if (destinationSourceId === sourceId) {
    newErrors.destinationSourceId = 'Destination must differ from source';
  }
}
```
[VERIFIED: codebase — existing validate() at TransactionFormScreen.tsx lines 111–128]

### Transfer Button Enable/Submit Guard (source: TransactionFormScreen.tsx lines 380–382)
```typescript
// Remove `type === 'transfer'` from disabled prop on Create/Update button
// Replace with:
disabled={isLoading || (type === 'transfer' && step === 1)}
// (Create Transfer button only appears in step 2, so no guard needed there)
```
[VERIFIED: codebase — TransactionFormScreen.tsx line 380]

---

## UI Spec Summary

Key UI decisions from 02-UI-SPEC.md:

| Element | Spec |
|---------|------|
| Step indicator text | `sectionLabel` style: 14px, weight 600, `#374151` |
| FROM label | "From" (replaces existing "Finance Source *" label in transfer step 1) |
| TO label | "To" |
| Next button | "Next →" (primary variant) |
| Back button | "← Back" (secondary variant) |
| Create CTA | "Create Transfer" |
| Edit CTA | "Update Transfer" |
| Destination picker modal title | "Select Destination" |
| Single-source hint | "Add another finance source to enable transfers." (`hint` style: 12px, `#6b7280`) |
| Edit read-only note | "Source and currency cannot be changed on an existing transfer." (`hint` style) |
| Partial failure alert | Title: "Transfer Error" / Body: full text per D-08 |
| Touch target height for FlatList items | 48px (matches `currencyItem: { height: 48 }`) |

[VERIFIED: codebase — 02-UI-SPEC.md]

---

## Integration Points Summary

| File | Lines | Change |
|------|-------|--------|
| `TransactionFormScreen.tsx` | 203–214 | Remove `disabled` from Transfer button; remove "coming soon" hint |
| `TransactionFormScreen.tsx` | 123–125 | Remove `type === 'transfer'` error; add destination validation |
| `TransactionFormScreen.tsx` | 131–165 | Add `type === 'transfer'` branch in `handleSubmit` |
| `TransactionFormScreen.tsx` | 143–164 | Add transfer-aware update path for edit mode |
| `TransactionFormScreen.tsx` | 380 | Remove `|| type === 'transfer'` from Create button `disabled` prop |
| `TransactionFormScreen.tsx` | ~24 | Add `step`, `destinationSourceId`, `destPickerVisible` state |
| `frontend/src/api/transactions.ts` | — | No changes needed |
| `frontend/src/types/api.ts` | — | No changes needed (`transfer_pair_id` already present) |

[VERIFIED: codebase — all line numbers confirmed against TransactionFormScreen.tsx]

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely frontend code changes with no external tool dependencies beyond the already-running development server. No new CLIs, databases, or services required.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | jest-expo (Jest) |
| Config file | `frontend/jest.config.js` |
| Quick run command | `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest --testPathPattern=TransactionForm` |
| Full suite command | `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest` |

[VERIFIED: codebase — frontend/jest.config.js; frontend/package.json `"test": "jest"`]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| XFER-01 | Transfer tab opens two-step form | static analysis | `npx jest --testPathPattern=TransactionForm` | ❌ Wave 0 |
| XFER-02 | Two transactions created with same `transfer_pair_id` | static analysis | `npx jest --testPathPattern=TransactionForm` | ❌ Wave 0 |
| XFER-03 | Transfer button is not disabled; coming-soon hint absent | static analysis | `npx jest --testPathPattern=TransactionForm` | ❌ Wave 0 |

The existing test pattern (confirmed in `CurrencyPicker.test.ts` and `TransactionsScreen.test.ts`) is **source-level static analysis**: read the `.tsx` file as a string and `expect(source).toContain(...)` / `expect(source).not.toContain(...)`. This is the established Nyquist pattern for this project and avoids complex React Native rendering setup.

### Sampling Rate
- **Per task commit:** `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest --testPathPattern=TransactionForm`
- **Per wave merge:** `cd /home/ubwzwd/Code/wallet_app/frontend && npx jest`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `frontend/__tests__/TransactionFormScreen.test.ts` — covers XFER-01, XFER-02, XFER-03 using source-level static analysis pattern

*(Existing infrastructure covers the framework — only the test file is missing)*

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Step wizard uses `step: 1 | 2` state scoped to the same component with conditional JSX | Architecture Patterns | Low — matches CONTEXT.md §specifics exactly |
| A2 | `mutateAsync` can be used for sequential calls (TanStack Query v5) | Architecture Patterns | Low — `mutateAsync` is a stable TanStack Query API; project already uses `useMutation` |
| A3 | TanStack Query cache key for transaction list is `[QUERY_KEYS.TRANSACTIONS]` (no filter params for the base list) | Architecture Patterns — Transfer Edit | Medium — if TransactionsScreen uses a keyed query with params, `getQueryData` call needs matching key |
| A4 | `crypto.randomUUID()` available globally in Expo without import | Standard Stack | Low — documented in CONTEXT.md D-06 |

---

## Open Questions

1. **Backend `transfer_pair_id` filter for edit mode (D-10)**
   - What we know: CONTEXT.md D-10 specifies `GET /transactions?transfer_pair_id={id}`, but backend does not support this filter parameter
   - What's unclear: Whether the planner should add backend support or use cache-based lookup
   - Recommendation: Use cache-based lookup (no backend change) for this phase; if cache is cold, fall back to `getTransactions()` and filter client-side

2. **TanStack Query cache key for transaction list**
   - What we know: TransactionsScreen.tsx likely uses `[QUERY_KEYS.TRANSACTIONS]` as the query key
   - What's unclear: Whether any filter params are included in the key (would affect `getQueryData` call)
   - Recommendation: Planner should verify TransactionsScreen.tsx query key before implementing cache lookup in edit path

---

## Sources

### Primary (HIGH confidence)
- `frontend/src/screens/TransactionFormScreen.tsx` — full file read; all line numbers verified
- `frontend/src/types/api.ts` — confirmed `transfer_pair_id` present on both `Transaction` and `TransactionCreate`
- `frontend/src/api/transactions.ts` — confirmed `createTransaction`, `updateTransaction`, `deleteTransaction` signatures
- `backend/app/api/transactions.py` lines 145–215 — confirmed `list_transactions` does NOT accept `transfer_pair_id` filter
- `.planning/phases/02-complete-transfer-transactions/02-CONTEXT.md` — all decisions D-01 through D-11
- `.planning/phases/02-complete-transfer-transactions/02-UI-SPEC.md` — UI contract fully read
- `.planning/codebase/CONVENTIONS.md` — naming, error handling, import order
- `frontend/__tests__/CurrencyPicker.test.ts` — confirmed static analysis test pattern
- `frontend/__tests__/TransactionsScreen.test.ts` — confirmed static analysis test pattern
- `frontend/jest.config.js` — confirmed `jest-expo` preset, `@/` alias

### Secondary (MEDIUM confidence)
- TanStack Query `mutateAsync` API — inferred from project's TanStack Query usage; stable documented API

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing; no new packages
- Architecture: HIGH — patterns directly read from codebase; wizard pattern confirmed by CONTEXT.md
- Pitfalls: HIGH — derived from code inspection and known React Native patterns
- Edit mode gap: HIGH (gap confirmed) — backend does not support `transfer_pair_id` filter; workaround identified

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable codebase; no external dependencies)
