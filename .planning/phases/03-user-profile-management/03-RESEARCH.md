# Phase 3: User Profile Management - Research

**Researched:** 2026-04-17
**Domain:** FastAPI partial-update endpoint + React Native profile screen with currency picker
**Confidence:** HIGH

## Summary

Phase 3 is a well-scoped, additive phase with highly specific decisions already locked in CONTEXT.md. Every pattern needed — partial PATCH via `model_dump(exclude_unset=True)`, Modal+FlatList currency picker, Platform.OS alert, `refreshUser()` after save, `setCurrentView` HomeView navigation — is already implemented and running in the codebase. No new third-party dependencies are required.

The backend work is three discrete changes: (1) add `UserUpdate` Pydantic schema and `default_source_id` to `UserResponse`, (2) add `PATCH /auth/me` handler reusing the `FinanceSourceUpdate` partial-update idiom, and (3) inject auto-default-source logic into the existing `create_finance_source` handler after commit. The frontend work is three changes: (1) add `UserUpdate` type and `updateMe` API function, (2) add `'profile'` to the `HomeView` union and a navigation button, and (3) implement `ProfileScreen` using the established screen conventions.

**Primary recommendation:** Follow decisions D-01 through D-11 verbatim — every pattern is verified in the codebase and no ambiguity remains. The only discretion area is cosmetic (ProfileScreen styling).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Add "Edit Profile" button to Quick Actions card in `HomeScreen.tsx`; add `'profile'` to `HomeView` union; render `ProfileScreen` when `currentView === 'profile'`.
- **D-02:** ProfileScreen shows read-only account header (email + member-since) at top using Card/infoRow style, then base_currency picker, then Save button.
- **D-03:** Use Modal+FlatList currency picker pattern from Phase 1 D-09 / Phase 2 D-04. Triggered by tapping base_currency field. Works iOS, Android, Web.
- **D-04:** Explicit Save button (no auto-save). On success: call `refreshUser()`, show platform-appropriate alert, navigate back to `'main'`.
- **D-05:** Add `UserUpdate` Pydantic schema in `backend/app/schemas/user.py` with optional `base_currency: str | None` and `default_source_id: UUID | None`.
- **D-06:** Add `default_source_id: UUID | None` to `UserResponse` schema — currently missing despite existing on the model.
- **D-07:** PATCH handler validates `default_source_id` ownership (return 404 if not found or not owned by current user).
- **D-08:** Normalize `base_currency` to uppercase in PATCH handler (same as registration).
- **D-09:** In `create_finance_source`: after commit, if count of user's sources == 1, set `current_user.default_source_id = new_source.id` and commit.
- **D-10:** Add `updateMe` function to `frontend/src/api/auth.ts` calling `PATCH /auth/me`.
- **D-11:** Add `UserUpdate` interface to `frontend/src/types/api.ts` with `base_currency?: string` and `default_source_id?: string`.

### Claude's Discretion

- Exact styling and spacing of ProfileScreen (follow existing screen conventions)
- Whether to show a "Saved!" inline confirmation text in addition to the alert
- Error message wording for save failures

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROF-01 | `PATCH /auth/me` endpoint accepts `base_currency` and `default_source_id` updates | D-05, D-06, D-07, D-08 cover full backend implementation. Partial-update pattern verified in `update_finance_source`. |
| PROF-02 | Frontend settings screen allows user to update `base_currency` | D-01 through D-04, D-10, D-11 cover full frontend implementation. Currency picker pattern verified in `FinanceSourceFormScreen`. |
| PROF-03 | `default_source_id` auto-set when user's first finance source is created | D-09 covers post-commit injection. `create_finance_source` handler location verified. |
</phase_requirements>

## Standard Stack

### Core (No New Dependencies)

All required libraries are already installed and in use.

| Library | Already Used In | Purpose for Phase 3 |
|---------|----------------|---------------------|
| FastAPI / SQLAlchemy | `auth.py`, `finance_sources.py` | PATCH endpoint, DB update |
| Pydantic v2 | `schemas/user.py`, `schemas/finance_source.py` | `UserUpdate` schema, `model_dump(exclude_unset=True)` |
| React Native (`Modal`, `FlatList`, `TouchableOpacity`, `Platform`, `Alert`) | `TransactionFormScreen.tsx`, `FinanceSourceFormScreen.tsx` | Currency picker, platform feedback |
| `@tanstack/react-query` (`useMutation`, `useQuery`) | `TransactionFormScreen.tsx` | Optional for save mutation |
| Axios (`apiClient`) | `api/auth.ts`, `api/financeSources.ts` | `updateMe` API call |

**Installation:** None required. [VERIFIED: codebase grep — all imports already present]

### Alternatives Considered

None — all decisions are locked. [VERIFIED: CONTEXT.md]

## Architecture Patterns

### Recommended Project Structure Changes

```
backend/app/schemas/user.py        # Add UserUpdate class, add default_source_id to UserResponse
backend/app/api/auth.py            # Add PATCH /auth/me handler
backend/app/api/finance_sources.py # Extend create_finance_source with auto-default logic
frontend/src/types/api.ts          # Add UserUpdate interface
frontend/src/api/auth.ts           # Add updateMe function
frontend/src/screens/HomeScreen.tsx # Add 'profile' to HomeView, add button, add view branch
frontend/src/screens/ProfileScreen.tsx  # NEW FILE
frontend/src/screens/index.ts      # Export ProfileScreen
```

### Pattern 1: Backend Partial Update — `model_dump(exclude_unset=True)`

**What:** Only apply fields the client explicitly sent. Unset optional fields remain unchanged.
**When to use:** All PATCH endpoints in this codebase.
**Verified in:** `update_finance_source` in `finance_sources.py` lines 119–125.

```python
# Source: backend/app/api/finance_sources.py lines 119-125 [VERIFIED: codebase read]
update_data = source_data.model_dump(exclude_unset=True)
for field, value in update_data.items():
    setattr(source, field, value)
db.commit()
db.refresh(source)
```

### Pattern 2: PATCH /auth/me Handler Structure

**What:** Authenticate, optionally validate `default_source_id` ownership, apply partial update, return updated user.

```python
# Canonical structure for new handler in backend/app/api/auth.py [VERIFIED: codebase read]
@router.patch("/me", response_model=UserResponse)
def update_current_user(
    user_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if user_data.default_source_id is not None:
        source = db.query(FinanceSource).filter(
            FinanceSource.id == user_data.default_source_id,
            FinanceSource.user_id == current_user.id
        ).first()
        if not source:
            raise HTTPException(status_code=404, detail="Finance source not found")
    update_fields = user_data.model_dump(exclude_unset=True)
    if "base_currency" in update_fields and update_fields["base_currency"]:
        update_fields["base_currency"] = update_fields["base_currency"].upper()
    for field, value in update_fields.items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user
```

Note: importing `FinanceSource` into `auth.py` will be needed for the D-07 ownership check. [VERIFIED: FinanceSource already imported in finance_sources.py — same pattern applies]

### Pattern 3: Auto-Default Source in `create_finance_source`

**What:** After committing the new source, count the user's total sources. If it is the first one, set `current_user.default_source_id`.

```python
# Additive block after db.refresh(new_source) in finance_sources.py [VERIFIED: codebase read]
source_count = db.query(FinanceSource).filter(
    FinanceSource.user_id == current_user.id
).count()
if source_count == 1:
    current_user.default_source_id = new_source.id
    db.commit()
```

No new imports needed — `FinanceSource`, `current_user`, and `db` are already in scope in that handler. [VERIFIED: finance_sources.py lines 17-43]

### Pattern 4: HomeView Navigation Extension

**What:** Add `'profile'` to the `HomeView` union type and a corresponding `if` branch, identical to how `'transactions'` was added.

```typescript
// Source: frontend/src/screens/HomeScreen.tsx line 11 [VERIFIED: codebase read]
// BEFORE:
type HomeView = 'main' | 'finance-sources' | 'add-source' | 'edit-source' | 'transactions' | 'add-transaction' | 'edit-transaction';

// AFTER (add '| profile'):
type HomeView = 'main' | 'finance-sources' | 'add-source' | 'edit-source' | 'transactions' | 'add-transaction' | 'edit-transaction' | 'profile';
```

Add button inside Quick Actions card (lines 156–170):
```tsx
<Button
  title="⚙️ Edit Profile"
  variant="secondary"
  onPress={() => setCurrentView('profile')}
  style={styles.quickButton}
/>
```

Add view branch before the main return:
```tsx
if (currentView === 'profile') {
  return (
    <ProfileScreen
      onBack={() => setCurrentView('main')}
    />
  );
}
```

### Pattern 5: Modal+FlatList Currency Picker (reuse from FinanceSourceFormScreen)

**What:** On native, a `TouchableOpacity` shows the current value; tapping opens a `Modal` with a `FlatList` of currencies. On web, a horizontal `ScrollView` with button rows.

The exact implementation is in `FinanceSourceFormScreen.tsx` lines 153–224 and the associated styles (lines 295–382). [VERIFIED: codebase read]

ProfileScreen differs only in that it picks `base_currency` (not `default_currency`) and fetches the currency list the same way.

### Pattern 6: Platform Feedback After Save

**What:** `Platform.OS === 'web'` → `window.alert(...)`, native → `Alert.alert(...)`.

```typescript
// Source: TransactionFormScreen.tsx lines 93-96, 100-103 [VERIFIED: codebase read]
if (Platform.OS === 'web') {
  window.alert('Success\n\nProfile updated successfully!');
} else {
  Alert.alert('Success', 'Profile updated successfully!');
}
```

### Pattern 7: `updateMe` API Function

Matches shape of all other API functions in `auth.ts` and `financeSources.ts`:

```typescript
// To be added to frontend/src/api/auth.ts [VERIFIED: pattern from codebase read]
export const updateMe = async (data: UserUpdate): Promise<User> => {
  const response = await apiClient.patch<User>('/auth/me', data);
  return response.data;
};
```

### Anti-Patterns to Avoid

- **Do not auto-save on currency picker close:** D-04 mandates explicit Save button. Auto-save would diverge from every other form in the app.
- **Do not skip `db.refresh(current_user)` after commit:** Without refresh, the returned ORM object may have stale field values before Pydantic serialization.
- **Do not check `count == 0` before creation for auto-default:** The decision (D-09) says check count AFTER commit. Checking before allows a race. Checking count == 1 after commit is the correct guard.
- **Do not re-use `Alert.alert` on web:** `Alert.alert` in React Native Web may silently fail or behave inconsistently. Use `window.alert` on web as established. [VERIFIED: codebase read — TransactionFormScreen uses this split]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Partial update handling | Custom field-by-field if-statements | `model_dump(exclude_unset=True)` + `setattr` loop | Already pattern in `update_finance_source` — consistent and handles all optional fields |
| Currency picker (native) | Custom dropdown | Modal + FlatList (existing pattern) | Already works cross-platform, already has correct styles |
| User state refresh after PATCH | Manual `setUser(...)` in ProfileScreen | `refreshUser()` from `AuthContext` | Keeps single source of truth; also updates AsyncStorage |
| Platform feedback | Conditional rendering | `Platform.OS === 'web'` guard | Already established — do not introduce a new abstraction |

**Key insight:** Every mechanism needed for this phase is already running in the codebase. The work is additive composition of existing patterns, not new engineering.

## Common Pitfalls

### Pitfall 1: `UserResponse` Missing `default_source_id`

**What goes wrong:** `GET /auth/me` returns a `UserResponse` that lacks `default_source_id`. After the PATCH succeeds and `refreshUser()` is called, `user.default_source_id` in the frontend will always be `null` even after auto-default is set.
**Why it happens:** The `User` model has the column. The `User` TypeScript interface has the field. But the Pydantic `UserResponse` schema (in `backend/app/schemas/user.py`) does not include `default_source_id`. [VERIFIED: codebase read — lines 21–29 of user.py confirm omission]
**How to avoid:** D-06 must be implemented first (or in the same commit) as D-05/PATCH handler. The field must be added to `UserResponse` before the PATCH endpoint returns it.
**Warning signs:** Postman/curl test of `GET /auth/me` returns JSON without `default_source_id` key.

### Pitfall 2: `FinanceSource` Import in `auth.py`

**What goes wrong:** The D-07 ownership check requires querying `FinanceSource` inside `auth.py`. If the import is forgotten, a `NameError` occurs at runtime only when `default_source_id` is provided in the PATCH body.
**Why it happens:** `auth.py` currently imports only `User` from models. [VERIFIED: codebase read — auth.py line 13]
**How to avoid:** Add `from app.models.finance_source import FinanceSource` to `auth.py` when implementing the PATCH handler.
**Warning signs:** Handler works with `base_currency`-only payloads but raises `NameError` with `default_source_id`.

### Pitfall 3: Double `db.commit()` in Auto-Default Logic

**What goes wrong:** If the auto-default block in `create_finance_source` calls `db.commit()` a second time, but an error occurs in between, the first commit (new source) already succeeded. The response is correct, but two commits is wasteful and can cause subtle issues in tests.
**Why it happens:** The existing handler already commits once for the new source (line 40). The auto-default check must happen AFTER `db.refresh(new_source)`, then commit only if count == 1.
**How to avoid:** Structure as: commit source → refresh source → count → if 1: set default → commit again. Two commits total is acceptable and matches the decision (D-09). Keep them separate so the source creation path is never blocked by a default-setting failure.
**Warning signs:** SQLAlchemy `DetachedInstanceError` if `new_source` is accessed after a failed rollback.

### Pitfall 4: `ProfileScreen` Not Exported from `screens/index.ts`

**What goes wrong:** `HomeScreen.tsx` imports `ProfileScreen` but if it is imported directly (not via the barrel), it works. However, if omitted from `index.ts`, other callers get a missing export.
**Why it happens:** Every other screen is exported from `frontend/src/screens/index.ts`. [VERIFIED: codebase read]
**How to avoid:** Add `export { ProfileScreen } from './ProfileScreen';` to `index.ts` as part of the same task that creates the screen file.

### Pitfall 5: Currency Picker Fetches on ProfileScreen

**What goes wrong:** ProfileScreen needs the live currency list for the picker. If the `useQuery` for currencies is not included in ProfileScreen, the picker will either error or fall back to the 6-item hardcoded list.
**Why it happens:** The pattern requires explicitly calling `ratesApi.getCurrencies()` via `useQuery` on each screen that uses the picker.
**How to avoid:** Copy the currency fetch pattern from `FinanceSourceFormScreen.tsx` lines 28–37 into `ProfileScreen`. The query key is `QUERY_KEYS.CURRENCIES` and `staleTime: Infinity`. [VERIFIED: codebase read]

## Code Examples

### `UserUpdate` Pydantic Schema

```python
# backend/app/schemas/user.py — new class to add [VERIFIED: pattern from finance_source.py]
class UserUpdate(BaseModel):
    """Schema for partial user profile update."""
    base_currency: str | None = Field(
        None,
        min_length=3,
        max_length=3,
        description="ISO 4217 currency code"
    )
    default_source_id: UUID | None = Field(
        None,
        description="ID of user's default finance source"
    )
```

### `UserResponse` with `default_source_id`

```python
# backend/app/schemas/user.py — updated UserResponse [VERIFIED: codebase read, field confirmed missing]
class UserResponse(BaseModel):
    id: UUID
    email: str
    base_currency: str
    default_source_id: UUID | None = None   # ADD THIS LINE
    created_at: datetime

    class Config:
        from_attributes = True
```

### `UserUpdate` TypeScript Interface

```typescript
// frontend/src/types/api.ts — add after existing User interface [VERIFIED: pattern from FinanceSourceUpdate]
export interface UserUpdate {
  base_currency?: string;
  default_source_id?: string;
}
```

### `updateMe` API Function

```typescript
// frontend/src/api/auth.ts — add after getCurrentUser [VERIFIED: pattern from financeSources.ts]
export const updateMe = async (data: UserUpdate): Promise<User> => {
  const response = await apiClient.patch<User>('/auth/me', data);
  return response.data;
};
```

## State of the Art

| Old Approach | Current Approach | Impact for Phase 3 |
|--------------|------------------|--------------------|
| Pydantic v1 `orm_mode = True` | Pydantic v2 `from_attributes = True` | `UserUpdate` must use Pydantic v2 syntax (no `class Config` with `orm_mode`) |
| `model.dict(exclude_unset=True)` | `model.model_dump(exclude_unset=True)` | Use `model_dump` — already used in `update_finance_source` |

**No deprecated patterns relevant to this phase.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Counting finance sources AFTER commit is the correct guard for auto-default (count == 1) rather than checking BEFORE creation | Architecture Patterns — Pattern 3 | If count is checked before creation, concurrent requests could both pass the check and both set default; low risk in single-user context but using post-commit count is cleaner |

**All other claims verified by direct codebase read.**

## Open Questions (RESOLVED)

1. **`auth.py` import of `FinanceSource` creates a cross-module dependency**
   - What we know: `auth.py` currently only imports `User`. The D-07 ownership check requires `FinanceSource`.
   - What's unclear: Whether the project has a preference for keeping auth routes free of model imports beyond User.
   - Recommendation: Proceed with direct import. The alternative (calling a service function) would be over-engineering for a single ownership check. No architectural concern.

2. **`ProfileScreen` does not need `tanstack-query` mutation if using direct async call**
   - What we know: Other forms use `useMutation`. ProfileScreen could use either `useMutation` or a plain `async` handler with `useState` for loading state.
   - What's unclear: Which pattern the planner should mandate.
   - Recommendation: Use `useMutation` to stay consistent with all other forms in the codebase (`TransactionFormScreen`, `FinanceSourceFormScreen`). [ASSUMED — convention inference]

## Environment Availability

Step 2.6: SKIPPED — Phase 3 is purely code/config changes. No new external dependencies, services, CLIs, or runtimes are introduced. All required tools (Python, Node, FastAPI, React Native) are already established from prior phases.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (backend) |
| Config file | `backend/` (no dedicated pytest.ini found; tests run from `backend/tests/`) |
| Quick run command | `cd backend && python -m pytest tests/ -x -q` |
| Full suite command | `cd backend && python -m pytest tests/ -v` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROF-01 | `PATCH /auth/me` schema structure: `UserUpdate` has optional fields; `UserResponse` includes `default_source_id` | unit (AST/structural) | `cd backend && python -m pytest tests/test_profile_structure.py -x` | Wave 0 |
| PROF-01 | `PATCH /auth/me` uppercase normalization of `base_currency` | unit (AST) | included in above | Wave 0 |
| PROF-03 | `create_finance_source` sets `default_source_id` when count == 1 | unit (AST/structural) | `cd backend && python -m pytest tests/test_auto_default_source.py -x` | Wave 0 |
| PROF-02 | `ProfileScreen` file exists and exports component | structural (file check) | manual / file check | Wave 0 |

### Sampling Rate

- **Per task commit:** `cd backend && python -m pytest tests/ -x -q`
- **Per wave merge:** `cd backend && python -m pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `backend/tests/test_profile_structure.py` — covers PROF-01: `UserUpdate` schema existence, `UserResponse.default_source_id` field, `PATCH /auth/me` handler presence, `base_currency.upper()` call in handler
- [ ] `backend/tests/test_auto_default_source.py` — covers PROF-03: auto-default logic exists in `create_finance_source` (AST check for `default_source_id` assignment)

*(Existing `conftest.py` with mocked psycopg2/jose/passlib covers both new test files — no new fixture infrastructure needed.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no — no auth flow changes | — |
| V3 Session Management | no | — |
| V4 Access Control | yes — ownership check on `default_source_id` | D-07: query `FinanceSource` with `user_id == current_user.id` filter before accepting update |
| V5 Input Validation | yes — `base_currency` input | `UserUpdate` schema: `min_length=3, max_length=3`; `.upper()` normalization in handler |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR on `default_source_id` | Elevation of Privilege | D-07: verify `FinanceSource.user_id == current_user.id` before accepting the update |
| Oversized `base_currency` string | Tampering | Pydantic `min_length=3, max_length=3` on `UserUpdate.base_currency` |

## Sources

### Primary (HIGH confidence)
- `backend/app/api/auth.py` — Existing endpoint structure, import pattern [VERIFIED: codebase read]
- `backend/app/schemas/user.py` — Missing `default_source_id` in `UserResponse` confirmed [VERIFIED: codebase read]
- `backend/app/models/user.py` — `default_source_id` column confirmed present [VERIFIED: codebase read]
- `backend/app/api/finance_sources.py` — `create_finance_source` handler, `model_dump(exclude_unset=True)` partial-update pattern [VERIFIED: codebase read]
- `frontend/src/screens/HomeScreen.tsx` — `HomeView` union type, Quick Actions card structure [VERIFIED: codebase read]
- `frontend/src/screens/FinanceSourceFormScreen.tsx` — Full Modal+FlatList currency picker pattern with styles [VERIFIED: codebase read]
- `frontend/src/screens/TransactionFormScreen.tsx` — Platform.OS alert pattern [VERIFIED: codebase read]
- `frontend/src/store/AuthContext.tsx` — `refreshUser()` implementation confirmed [VERIFIED: codebase read]
- `frontend/src/api/auth.ts` — Existing function shape for `updateMe` pattern [VERIFIED: codebase read]
- `frontend/src/types/api.ts` — `User` interface has `default_source_id`; `UserUpdate` confirmed absent [VERIFIED: codebase read]
- `frontend/src/screens/index.ts` — Barrel exports list; `ProfileScreen` must be added [VERIFIED: codebase read]

### Secondary (MEDIUM confidence)
- None required — all findings derived from direct codebase inspection.

### Tertiary (LOW confidence)
- A1 (Assumptions Log): Post-commit count == 1 guard for auto-default — reasonable convention, not explicitly documented.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified present in codebase
- Architecture: HIGH — every pattern verified against actual running code
- Pitfalls: HIGH — derived from direct reading of the files that will be modified
- Security: HIGH — IDOR pattern is standard; D-07 directly addresses it

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable stack — no fast-moving dependencies)
