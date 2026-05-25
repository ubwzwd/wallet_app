---
phase: 05
plan: 05
subsystem: frontend
tags: [pwa, mobile-polish, safe-area, MOBUI-02]
requires:
  - 05-01 (verify-touch-targets.mjs registry — screen-safe-area + app-safe-area-provider checks)
  - 05-03 (frontend/src/pwa/registerSW.ts must exist on disk before side-effect import resolves)
provides:
  - "SafeAreaProvider wraps the App.tsx root tree (outermost) — `useSafeAreaInsets()` returns real values across web/iOS/Android"
  - "SafeAreaView in Screen.tsx now sourced from react-native-safe-area-context — web emits env(safe-area-inset-*) padding"
  - "App.tsx side-effect imports `@/pwa/registerSW` — SW registration triggers on web; no-op on native (per-module Platform guard)"
affects:
  - "Every screen rendered through Screen.tsx now respects notch/home-indicator insets on web (Caddy-served PWA shell)"
  - "App boot path: SW register-and-log fires on window load on web; safe-area context is initialized before any consumer can call useSafeAreaInsets()"
tech-stack:
  added: []  # no new deps — react-native-safe-area-context@^5.6.1 already declared in v1.0
  patterns:
    - "Outermost provider wrap idiom (SafeAreaProvider above all data/query/auth providers)"
    - "Side-effect import as PWA glue (analog: src/utils/queryClient.ts module-level singleton init)"
    - "Static verifier per-check isolation via `--check=<name>` (no `--all` until Wave 1 fully landed)"
key-files:
  created: []
  modified:
    - frontend/src/components/Screen.tsx
    - frontend/App.tsx
decisions:
  - "D-05-05-A — No UpdateToast: per the revised D-07/D-08/D-09 (CONTEXT.md supersession), the previously planned `<UpdateToast />` sibling-render is OMITTED. Silent SW takeover via Workbox `skipWaiting + clientsClaim` (configured in 05-03's workbox-config.cjs) handles updates without any UI surface. ROADMAP SC-3 (`silent SW takeover`) preserved."
  - "D-05-05-B — SafeAreaProvider is outermost: placed above QueryClientProvider per RESEARCH § Anti-Pattern (`Forgetting SafeAreaProvider` causes useSafeAreaInsets() to silently return zero). Source-order check verified via Node.js indexOf assertion."
  - "D-05-05-C — Import-only swap for Screen.tsx: the safe-area-context `SafeAreaView` has an identical API surface to RN core's, so no JSX or style changes are needed. Diff is 1 line removed / 1 line added at the top of the file."
  - "D-05-05-D — Side-effect import lives in App.tsx (not in a separate platform-conditional file): `frontend/src/pwa/registerSW.ts` guards itself internally via `Platform.OS === 'web'`, so unconditional import from App.tsx is safe on native Expo Go (becomes a no-op)."
metrics:
  duration_min: ~8
  completed: 2026-05-25
  tasks_completed: 3
  files_modified: 2
  commits: 2
---

# Phase 5 Plan 5: PWA-ify Frontend + Mobile Polish — MOBUI-02 (safe-area wiring) Summary

**One-liner:** Wired the cross-platform safe-area-inset stack into the app by swapping Screen.tsx's `SafeAreaView` import to `react-native-safe-area-context` and wrapping App.tsx's root tree with `SafeAreaProvider`, simultaneously integrating the PWA glue from 05-03 via a side-effect `import '@/pwa/registerSW'`. No UpdateToast — silent SW takeover preserved per revised D-07/D-08/D-09.

## What Was Done

### Task 1 — Screen.tsx import swap (commit `139ca08`)

- Removed `SafeAreaView` from the destructured `from 'react-native'` import (was line 4 of the previous import block).
- Added a new import line: `import { SafeAreaView } from 'react-native-safe-area-context';`
- JSX block, props interface, and StyleSheet block are byte-identical to pre-edit (verified by `git diff` — change scoped to the import block).
- API parity confirmed: `safe-area-context`'s `SafeAreaView` accepts the same `style` and `children` props as RN core's, so no consumer-site changes required.

### Task 2 — App.tsx provider wrap + registerSW side-effect (commit `4d24a22`)

Two additive edits:

1. **Imports (lines 3 + 8):**
   - `import { SafeAreaProvider } from 'react-native-safe-area-context';`
   - `import '@/pwa/registerSW'; // side-effect — registers /sw.js on web; no-op on native`
2. **Root tree wrap:** Wrapped the returned JSX of the default-exported `App` function with `<SafeAreaProvider>` as the OUTERMOST element (above `<QueryClientProvider>`).

NO `UpdateToast` import. NO `<UpdateToast />` JSX element. Per the revised D-07/D-08/D-09, the silent SW takeover via `skipWaiting + clientsClaim` (Workbox config from 05-03) replaces the previously planned explicit user-opt-in toast.

`AppContent` function, `ActivityIndicator` loading state, `StatusBar` render, and `styles` block are all preserved unchanged.

### Task 3 — Verification gate

Per-check isolated verification (NOT `--all`, which is owned by 05-06 Task 3):

```
==> verify-touch-targets[screen-safe-area]: Screen.tsx imports SafeAreaView from react-native-safe-area-context (NOT react-native)
PASS: screen-safe-area
```

```
==> verify-touch-targets[app-safe-area-provider]: App.tsx wraps the tree with SafeAreaProvider imported from react-native-safe-area-context
PASS: app-safe-area-provider
```

Jest regression check:

```
Test Suites: 5 passed, 5 total
Tests:       64 passed, 64 total
Snapshots:   0 total
Time:        1.035 s
Ran all test suites.
```

## Audit Evidence

### App.tsx import block (audit confirmation: NO UpdateToast import)

```tsx
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/store/AuthContext';
import { queryClient } from '@/utils/queryClient';
import { Navigation } from '@/components/Navigation';
import '@/pwa/registerSW'; // side-effect — registers /sw.js on web; no-op on native
```

No `from '@/components/UpdateToast'` line. No `UpdateToast` symbol anywhere in App.tsx.

### App.tsx root tree (SafeAreaProvider is outermost)

```tsx
export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
```

Source-order assertion passed (Task 2 verify):

```
==> App.tsx provider wrap + registerSW side-effect OK; no UpdateToast
```

(`indexOf('<SafeAreaProvider>')` < `indexOf('<QueryClientProvider')` — provider is the outermost wrapper as required by RESEARCH § Anti-Pattern.)

### Screen.tsx import block (audit confirmation: SafeAreaView from safe-area-context)

```tsx
import React, { ReactNode } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
```

`SafeAreaView` is no longer in the destructured `react-native` import (regex `^import \{[^}]*SafeAreaView[^}]*\} from 'react-native'` returns no match).

## Additivity & Behavior Preservation

- App.tsx and Screen.tsx changes are **additive only** — no functional code (JSX, styles, AppContent, ActivityIndicator, StatusBar, AuthProvider, QueryClientProvider) was removed.
- `git diff` for both files shows only the import block insertions and the JSX wrap insertion (4 added lines in App.tsx; 1 added / 1 removed in Screen.tsx).
- **No `<UpdateToast />` element is mounted** in App.tsx — silent SW takeover via Workbox `skipWaiting + clientsClaim` (preserved from 05-03's workbox-config.cjs per ROADMAP SC-3) handles updates without any UI surface. The next navigation or refresh after a deploy automatically surfaces the new app shell via NetworkFirst on `/index.html`.

## Deviations from Plan

None — plan executed exactly as written.

The PLAN.md's revised supersession (NO UpdateToast mount) was followed verbatim. No auto-fix rules were triggered. No checkpoints were hit. The two MOBUI-02-owned per-check verifications both PASSED on first GREEN attempt after each task's edit.

## Threat Model Status

Per the plan's threat register:

- **T-05-05-01 (Stale-shell trap, mitigate):** Mitigation in place — SW silent takeover via `skipWaiting + clientsClaim` from 05-03 + NetworkFirst on `/index.html` surfaces the new shell on next nav/refresh. No UI surface needed.
- **T-05-05-02 (SW hijack, mitigate):** Same-origin HTTPS registration via Caddy (Phase 4); `registerSW.ts` was reviewed/minimized in 05-03 (register + log only).
- **T-05-05-04 (CacheFirst cache poisoning, mitigate):** Handled in 05-03 (content-hashed filenames + cleanupOutdatedCaches).
- **T-05-05-03, T-05-05-05, T-05-05-SC (accept):** Out of scope or no new attack surface from this plan.

No new threats discovered during execution. No `threat_flag:` entries.

## Known Stubs

None. Both files have real, wired implementations; no placeholder data; no `// TODO`s introduced.

## Self-Check: PASSED

- `frontend/src/components/Screen.tsx` — FOUND
- `frontend/App.tsx` — FOUND
- `.planning/phases/05-pwa-ify-frontend-mobile-polish/05-05-SUMMARY.md` — FOUND (this file)
- Commit `139ca08` — FOUND (feat(05-05): swap SafeAreaView import in Screen.tsx)
- Commit `4d24a22` — FOUND (feat(05-05): wrap App.tsx in SafeAreaProvider + side-effect import registerSW)
- `node frontend/scripts/verify-touch-targets.mjs --check=screen-safe-area` — exit 0, `PASS: screen-safe-area`
- `node frontend/scripts/verify-touch-targets.mjs --check=app-safe-area-provider` — exit 0, `PASS: app-safe-area-provider`
- `cd frontend && npm test` — 5/5 suites, 64/64 tests pass
- `frontend/src/components/UpdateToast.tsx` — DOES NOT EXIST (confirmed via filesystem check)
- No STATE.md or ROADMAP.md modifications (per parallel-executor contract)
