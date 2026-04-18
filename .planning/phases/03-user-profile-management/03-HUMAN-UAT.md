---
status: partial
phase: 03-user-profile-management
source: [03-VERIFICATION.md]
started: 2026-04-19T00:00:00Z
updated: 2026-04-19T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end profile update flow on live PostgreSQL backend

**Expected behavior:**
1. Tap Edit Profile button from HomeScreen
2. Change base currency selection in the modal
3. Tap Save button
4. Receive success alert
5. Return to HomeScreen — Account Information card shows new base_currency
6. User remains logged in

**Why human testing is required:**
Automated regression tests run against SQLite in-memory. The original root cause (session invalidation bug) was a transient 401 under live PostgreSQL connection pooling. Human must confirm the fix resolves the issue with real PostgreSQL + network conditions.

**Result:**
[pending]

---

### 2. Currency picker displays live ECB currencies (31+)

**Expected behavior:**
1. Open ProfileScreen from HomeScreen
2. Tap the "Base Currency" field to open the currency selector modal
3. Observe FlatList populated with currency codes from the backend's GET /rates/currencies endpoint
4. Verify 31+ currencies are displayed (not the 6-item hardcoded fallback)
5. Verify selection and save work correctly with the live list

**Why human testing is required:**
Requires a running backend serving /rates/currencies. The 6-item fallback is code-reachable while the useQuery is loading — human must confirm the live list loads and replaces the fallback properly.

**Result:**
[pending]

---

### 3. Platform alert behavior (iOS/Android vs web)

**Expected behavior:**
1. On **web**: Successful profile save shows `window.alert()` popup
2. On **iOS/Android**: Successful profile save shows RN `Alert.alert()` popup
3. Error alert (if triggered) uses the same platform-appropriate API

**Why human testing is required:**
Requires running the app on both web and native platforms. Code uses `Platform.OS === 'web'` branching which cannot be tested programmatically.

**Result:**
[pending]

---

## Summary

| Metric | Value |
|--------|-------|
| total | 3 |
| passed | 0 |
| issues | 0 |
| pending | 3 |
| skipped | 0 |
| blocked | 0 |

## Gaps

[None — all must-haves verified. Awaiting human verification to confirm live runtime behavior.]
