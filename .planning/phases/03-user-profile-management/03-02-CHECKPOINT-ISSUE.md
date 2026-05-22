---
plan: 03-02
status: incomplete
issue: session-invalidation-post-update
checkpoint_type: human-verify
---

# Task 4 Checkpoint Failure: Session Invalidation After Profile Update

## What Passed

Tasks 1-3 completed and verified:
- ✓ UserUpdate type and updateMe API function
- ✓ ProfileScreen component with currency picker
- ✓ HomeScreen navigation wired
- ✓ TypeScript compilation clean

## What Failed

**Step 8-9 of 12-step verification:**

```
Expected: Save Changes → success alert → return to HomeView with updated currency
Actual: Save succeeds (visible in UI), but GET /auth/me returns 401 (Unauthorized)
```

**Error logs:**
```
:8000/api/v1/auth/me:1 
 Failed to load resource: the server responded with a status of 401 (Unauthorized)

AuthContext.tsx:57 Failed to load user: Error: Could not validate credentials
```

## Root Cause

PATCH /auth/me endpoint is updating the user record on the backend, but the frontend is not receiving or storing the updated JWT token. The API request succeeds, but the session is invalidated.

## Required Fix

1. **Backend check:** Verify PATCH /auth/me returns updated token in response (if applicable)
2. **Frontend check:** Verify updateMe() in auth.ts stores the returned token before returning
3. **AuthContext check:** Verify refresh logic properly handles token rotation

## Impact

Profile editing is broken UX — users are logged out after changing base_currency.
