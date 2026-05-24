---
phase: 05
plan: 03
subsystem: frontend-pwa-service-worker
tags: [pwa, service-worker, workbox, build-pipeline]
requirements_completed: [PWA-04]
dependency_graph:
  requires:
    - 05-01  # workbox-cli devDep + verify-pwa.mjs --check=sw verifier
    - 05-02  # dist/index.html + manifest + apple-touch-icon + pwa.css produced by the static asset plan
  provides:
    - workbox-config.cjs (SW source-of-truth — generateSW config)
    - frontend/src/pwa/registerSW.ts (web-only side-effect register + log)
    - extended build:web (atomic chain: expo export → workbox generateSW → dev-config restore)
    - frontend/dist/sw.js (emitted; gitignored)
  affects:
    - frontend/package.json scripts.build:web (single-line atomic value preserved)
    - frontend/App.tsx (NOT modified here — side-effect import deferred to 05-05)
tech_stack:
  added: []  # No new deps — workbox-cli was added in 05-01
  patterns: [generateSW post-build chain, side-effect-on-import module]
key_files:
  created:
    - frontend/workbox-config.cjs
    - frontend/src/pwa/registerSW.ts
  modified:
    - frontend/package.json
decisions:
  - "registerSW.ts is register+log only (revised D-07 — no useServiceWorkerUpdate hook, no SKIP_WAITING handshake, no UpdateToast UI). Silent SW takeover via skipWaiting + clientsClaim is load-bearing for ROADMAP SC-3."
  - "workbox-config.cjs uses .cjs (not .js or .mjs) because package.json has no \"type\": \"module\"; workbox-cli expects CommonJS by default."
  - "globIgnores excludes sw.js + workbox-*.js to prevent the unrecoverable-SW anti-pattern (RESEARCH § Anti-Patterns)."
  - "build:web remains a single atomic line per D-05 — Workbox step inserted BETWEEN `expo export -p web` and the dev-config restore."
metrics:
  duration: "~4 minutes (excluding initial worktree npm install of 1762 packages)"
  completed_date: 2026-05-24
  tasks: 4
  commits: 4  # 3 task commits + this SUMMARY commit
  files_created: 2
  files_modified: 1
---

# Phase 5 Plan 03: PWA Service Worker (Workbox Pipeline) Summary

**One-liner:** Wires the Workbox-generated service worker into the Expo build pipeline via a CommonJS workbox-config.cjs (NetworkFirst on /index.html + /api/*, CacheFirst on fonts + images, skipWaiting + clientsClaim for ROADMAP SC-3 silent update) plus a 32-line web-only registerSW.ts that logs registration outcome without exposing any update hook or UI.

## What Built

1. **`frontend/workbox-config.cjs`** — Workbox `generateSW` source-of-truth. Locked shape:
   - `skipWaiting: true`, `clientsClaim: true`, `cleanupOutdatedCaches: true` (ROADMAP SC-3 silent-update contract).
   - `globPatterns: ['**/*.{js,css,html,png,svg,jpg,jpeg,webp,woff,woff2,ico,json}']`.
   - `globIgnores: ['**/sw.js', '**/workbox-*.js']` (prevents the unrecoverable-SW anti-pattern).
   - `navigateFallback: '/offline.html'`, `navigateFallbackDenylist: [/^\/api/]`.
   - `dontCacheBustURLsMatching: /\.[0-9a-f]{20,}\./` (trusts Expo's 32-hex content-hashed filenames).
   - `runtimeCaching`: 4 entries (NetworkFirst on app shell — 3s timeout; NetworkFirst on `/api/*` — 5s timeout, cacheableResponse statuses [0,200]; CacheFirst on fonts — 30d expiry; CacheFirst on images — 30d expiry).

2. **`frontend/src/pwa/registerSW.ts`** — 32-line side-effect-only module. Imports `Platform` from `react-native`; if `Platform.OS === 'web'` AND `'serviceWorker' in navigator`, attaches a `load` listener that calls `navigator.serviceWorker.register('/sw.js')` and logs `[pwa] service worker registered` on success or `[pwa] service worker registration failed` on failure (`.catch` — never throws). On native (Expo Go iOS/Android) the guard returns false and the module is a complete no-op. **No exports.** No `useServiceWorkerUpdate` hook, no `controllerchange` listener, no `SKIP_WAITING` postMessage, no `updatefound`/`subscribeUpdate`/`applyUpdate` API.

3. **`frontend/package.json` `build:web`** — extended to a single atomic line by inserting `npx workbox generateSW workbox-config.cjs` BETWEEN `expo export -p web` and the dev-config restore. Final value:

   ```
   rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && npx workbox generateSW workbox-config.cjs && cp src/constants/config.dev.ts src/constants/config.ts
   ```

   The Phase 4 config-swap pattern (prod-config → export → dev-config restore) is preserved; Workbox now runs immediately after the export so it sees the final hashed chunks.

## Full registerSW.ts Body (proof no hook/UI leaked in — ≤32 lines)

```ts
/**
 * registerSW.ts — Web-only service worker registration (PWA-04, Phase 5 plan 05-03).
 *
 * Imported for side-effect only: `import '@/pwa/registerSW'` (wired in 05-05).
 * On web, registers `/sw.js` on `window`'s `load` event and logs the result.
 * On native (Expo Go iOS/Android), the guard returns false and this module
 * is a complete no-op — safe to import unconditionally from App.tsx.
 *
 * Per the revised D-07 (2026-05-24), this module is intentionally minimal:
 * register + log. The silent-takeover path is handled entirely SW-side via
 * Workbox's lifecycle flags (configured in workbox-config.cjs, ROADMAP SC-3
 * preserved). NetworkFirst on `/index.html` surfaces the fresh shell on the
 * next nav/refresh — no client-side update hook, no UI surface.
 *
 * Analog: src/utils/queryClient.ts — module-level singleton init,
 * side-effect-on-import idiom.
 */
import { Platform } from 'react-native';

if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {
        console.log('[pwa] service worker registered');
      })
      .catch((err) => {
        // Never throw — app boot must never break because of PWA registration.
        console.warn('[pwa] service worker registration failed', err);
      });
  });
}
```

## Verification Evidence

### Task 1 — workbox-config.cjs shape

```
$ cd frontend && node -e "const c=require('./workbox-config.cjs'); ..."
==> workbox-config.cjs shape OK
```

`skipWaiting`, `clientsClaim`, `cleanupOutdatedCaches` all `true`; `globIgnores` contains both `**/sw.js` and `**/workbox-*.js`; `runtimeCaching` length is 4 with exactly two `NetworkFirst` and two `CacheFirst` handlers; `navigateFallback === '/offline.html'`.

### Task 2 — registerSW.ts surface

Positive grep matches (all four required):

- `Platform.OS === 'web'` ✓
- `navigator.serviceWorker.register('/sw.js')` ✓
- `[pwa] service worker registered` ✓
- `[pwa] service worker registration failed` ✓

Negative grep (none of these are present):

- `SKIP_WAITING` ✓ absent
- `controllerchange` ✓ absent
- `subscribeUpdate` ✓ absent
- `useServiceWorkerUpdate` ✓ absent
- `applyUpdate` ✓ absent
- `updatefound` ✓ absent
- `from 'react'` ✓ absent (no React/hook imports)

File is 32 lines (≤25 lines of executable content + 16-line header comment).

Existing Jest suite still green: CurrencyPicker (3 tests), TransactionsScreen, FinanceSourcesScreen, registerSW — 4 suites passed, 62 tests passed. Button.test.ts is intentionally red until 05-04 (2 tests failing as expected — the plan explicitly excludes it from the regression gate).

### Task 3 — build:web atomic line

```
$ cd frontend && node -e "const p=require('./package.json'); ... if(!(idxExpo<idxWb && idxWb<idxRestore))throw new Error(...)"
==> build:web atomic line shape OK
```

Order verified: `expo export -p web` → `npx workbox generateSW workbox-config.cjs` → `cp src/constants/config.dev.ts src/constants/config.ts`.

### Task 4 — End-to-end build + verifier

```
$ cd frontend && npm run build:web
> rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && npx workbox generateSW workbox-config.cjs && cp src/constants/config.dev.ts src/constants/config.ts

Starting Metro Bundler
Web Bundled 505ms index.ts (352 modules)
› web bundles (1):
_expo/static/js/web/index-3aa11dba28e23b6e8f4f32af639dfc93.js (625 kB)
› Files (2):
index.html (1.28 kB)
metadata.json (49 B)
Exported: dist

Using configuration from /home/.../frontend/workbox-config.cjs.
The service worker files were written to:
  • dist/sw.js
  • dist/sw.js.map
  • dist/workbox-35f09345.js
  • dist/workbox-35f09345.js.map
The service worker will precache 11 URLs, totaling 736 kB.

EXIT=0
```

`dist/sw.js` parseable as JS (`new Function(readFileSync(...))`). All six required literals present plus the navigateFallback reference:

- `NetworkFirst` ✓
- `CacheFirst` ✓
- `skipWaiting` ✓
- `clientsClaim` ✓
- `/api/` ✓
- `/index.html` ✓
- `offline.html` ✓ (precache manifest entry — proves Pitfall 5 mitigated)

```
$ node scripts/verify-pwa.mjs --check=sw
==> sw: read dist/sw.js
==> sw: parse syntax via new Function()
==> sw: dist/sw.js contains Workbox strategies + lifecycle + nav scope
==> sw: passed
EXIT=0
```

```
$ node scripts/verify-pwa.mjs --all
==> manifest      [passed — ajv against W3C schema + maskable icon check]
==> apple-meta    [passed — 4 meta tags + apple-touch-icon.png]
==> viewport      [passed — viewport-fit=cover]
==> sw            [passed — all 6 literals]
==> ios-zoom      [passed — 16px !important on inputs]
==> all pwa checks passed
EXIT=0
```

All five PWA static checks green.

`diff -q src/constants/config.ts src/constants/config.dev.ts` → identical (the dev-config restore at the end of build:web ran correctly).

## Deviations from Plan

**None — plan executed exactly as written.**

Notes on minor execution details:

- **Worktree npm install was required before tests/build could run.** The Claude Code worktree starts without `node_modules/`. Ran `npm install --legacy-peer-deps` (jest-expo 55 pins `react-test-renderer@19.2.0` which conflicts with `react@19.2.6` — `--legacy-peer-deps` is the established workaround in this repo). This is not a code change and is gitignored; not a plan deviation.
- **Jest `--testPathPattern` was renamed to `--testPathPatterns` in Jest 30.** The plan's verify command uses the older flag; both produce the same effective behavior on Jest 30 (the regex `(?!Button)` is a zero-width assertion that matches every path, so Button.test.ts still runs — its 2 failing tests are intentionally red until 05-04 per the plan acceptance criterion). The regression gate of "the four other suites pass" is satisfied.

## Auth Gates

None — no authenticated APIs touched in this plan.

## Known Stubs

None — registerSW.ts has no placeholder data; workbox-config.cjs has no TODO/placeholder fields.

## Threat Flags

None — no new security-relevant surface beyond what the plan's `<threat_model>` already covered. The SW intercepts every fetch on the origin, but that surface is the entire point of the plan and is captured in T-05-03-01..06.

## Integration Deferred to 05-05

The side-effect `import '@/pwa/registerSW'` in `App.tsx` is **deferred to plan 05-05** (the SafeAreaProvider wrap), per the output contract, to avoid a Wave-1 merge conflict on App.tsx. **No `<UpdateToast />` element will be mounted in 05-05** per the revised D-08/D-09 — silent SW takeover handles updates with zero client participation.

## Commits

| Task                                                        | Commit  | Files                          |
| ----------------------------------------------------------- | ------- | ------------------------------ |
| Task 1: workbox-config.cjs                                  | b31c40f | frontend/workbox-config.cjs    |
| Task 2: registerSW.ts                                       | 4fb4dc5 | frontend/src/pwa/registerSW.ts |
| Task 3: build:web extension                                 | 295bc6b | frontend/package.json          |
| Task 4 verification + SUMMARY (no source — verification only) | (this commit) | .planning/phases/05-.../05-03-SUMMARY.md |

## Self-Check: PASSED

- `frontend/workbox-config.cjs` exists ✓
- `frontend/src/pwa/registerSW.ts` exists ✓
- `frontend/package.json` build:web includes `npx workbox generateSW workbox-config.cjs` ✓
- Commit `b31c40f` present in git log ✓
- Commit `4fb4dc5` present in git log ✓
- Commit `295bc6b` present in git log ✓
- `dist/sw.js` emitted with all 6 required literals + offline.html reference ✓
- `verify-pwa.mjs --all` exits 0 ✓
- `src/constants/config.ts` matches `config.dev.ts` byte-for-byte ✓
- No UpdateToast.tsx file created ✓
- registerSW.ts contains no SKIP_WAITING / controllerchange / useServiceWorkerUpdate strings ✓
