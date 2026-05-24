# Phase 5: PWA-ify Frontend + Mobile Polish — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 21 (8 new, 13 modified)
**Analogs found:** 17 / 21 (4 files are net-new with no in-tree analog — guidance comes from RESEARCH.md primary sources)

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `frontend/public/index.html` | NEW | config (static template) | request-response (static) | `frontend/dist/index.html` (Expo's existing emitted shell) | exact (must preserve shape) |
| `frontend/public/manifest.json` | NEW | config (JSON) | request-response (static) | `frontend/app.json` (single root-object JSON, no in-tree manifest analog) | role-match |
| `frontend/public/pwa.css` | NEW | config (CSS) | request-response (static) | none in-tree (first stylesheet in this repo) | no analog |
| `frontend/public/offline.html` | NEW | config (static HTML) | request-response (static) | `frontend/dist/index.html` (single self-contained HTML) | role-match |
| `frontend/public/192.png`, `512.png`, `512-maskable.png`, `apple-touch-icon.png` | NEW | asset (binary, script-generated) | static | `frontend/assets/adaptive-icon.png` (source design) — composited via `frontend/scripts/generate-icons.mjs` (sharp-based, per revised D-10) | role-match |
| `frontend/scripts/generate-icons.mjs` | NEW | script (icon generator) | batch | sharp v0.33 upstream docs (https://sharp.pixelplumbing.com/) — no in-tree analog; first image-processing script in repo | no analog (RESEARCH/sharp primary) |
| `frontend/workbox-config.cjs` | NEW | config (CommonJS) | build-tool | none in-tree (first `.cjs` file in repo other than `jest.config.js`) | partial (`jest.config.js` shapes the CJS module style) |
| `frontend/src/pwa/registerSW.ts` | NEW | utility (side-effect + pub-sub) | event-driven | `frontend/src/store/AuthContext.tsx` (singleton state + subscribers) — confirmed exists; alternative analog is `frontend/src/utils/queryClient.ts` (module-level singleton) | role-match |
| `frontend/scripts/verify-pwa.mjs` | NEW | script (verification) | batch | `frontend/__tests__/CurrencyPicker.test.ts` (file-read + assertion pattern) and `infra/scripts/smoke.sh` (step-by-step verify with explicit exit codes) | role-match |
| `frontend/scripts/verify-touch-targets.mjs` | NEW | script (verification) | batch | `frontend/__tests__/CurrencyPicker.test.ts` (regex-over-source pattern) | role-match |
| `frontend/__tests__/Button.test.ts` | NEW | test (unit, static) | batch | `frontend/__tests__/CurrencyPicker.test.ts` and `frontend/__tests__/TransactionsScreen.test.ts` | exact |
| `frontend/App.tsx` | MOD | component (app root) | event-driven | self (existing structure stays; additive only) | exact |
| `frontend/src/components/Button.tsx` | MOD | component | request-response | self (single-style-block edit) | exact |
| `frontend/src/components/Screen.tsx` | MOD | component | request-response | self (import-source swap) | exact |
| `frontend/src/screens/TransactionFormScreen.tsx` | MOD | screen | request-response (form) | self — lines 535, 628, 727 (decimal amount field) | exact |
| `frontend/src/screens/FinanceSourceFormScreen.tsx` | MOD | screen | request-response (form) | self — lines 175, 191, 204 (currency picker TouchableOpacities) | exact |
| `frontend/src/screens/ProfileScreen.tsx` | MOD | screen | request-response | self — lines 98 (back button), 122, 164 (picker rows) | exact |
| `frontend/src/screens/TransactionsScreen.tsx` | MOD | screen | request-response | self — no logic change; verify Buttons `size="small"` inherit fix | n/a (inherited) |
| `frontend/src/screens/LoginScreen.tsx`, `RegisterScreen.tsx` | MOD | screen | request-response (form) | self — already MOBUI-04 compliant; verification only | n/a (already correct) |
| `frontend/package.json` | MOD | config | build-tool | self — `build:web` script extension | exact |

## Pattern Assignments

### `frontend/public/index.html` (NEW — config, static template) — HIGHEST RISK

**Analog:** `frontend/dist/index.html` (the currently emitted Expo-web shell)

**Why this analog:** Expo's `expo export -p web` produces this file from its built-in template today. Our custom `public/index.html` **replaces** that template but must preserve the exact bootstrap shape (the `<style id="expo-reset">` block, the `<noscript>` line, the `<div id="root">` mount point, and the script-tag injection point at the end of `<body>`). Per RESEARCH.md A1 and Pitfall 2, Expo SDK 54 **appends** the hashed `<script src="/_expo/static/js/web/index-<hash>.js" defer></script>` automatically during export when a `public/index.html` exists — but only if `<div id="root">` and `</body>` are present in the expected position.

**Bootstrap markup that MUST be preserved verbatim** (from `frontend/dist/index.html` lines 8-25):
```html
<!-- The `react-native-web` recommended style reset -->
<style id="expo-reset">
  html, body { height: 100%; }
  body { overflow: hidden; }
  #root { display: flex; height: 100%; flex: 1; }
</style>
```

**Mount point and noscript** (from `frontend/dist/index.html` lines 28-34):
```html
<body>
  <noscript>You need to enable JavaScript to run this app.</noscript>
  <div id="root"></div>
  <!-- Expo appends <script src="/_expo/static/js/web/index-<hash>.js" defer></script> here -->
</body>
```

**What this file inherits:** The `<style id="expo-reset">` block, `<noscript>`, `<div id="root">`, the `<link rel="icon" href="/favicon.ico" />` location (currently inline at line 26 of `dist/index.html` — move into `<head>` cleanly).

**What this file extends:**
1. The `<meta name="viewport">` MUST become `width=device-width, initial-scale=1, viewport-fit=cover` (replaces existing `shrink-to-fit=no` form on line 6).
2. Add `<link rel="manifest" href="/manifest.json">`.
3. Add `<meta name="theme-color" content="#0ea5e9">`.
4. Add the four iOS meta tags (UI-SPEC §iOS-Specific Meta Tags Contract).
5. Add `<meta name="mobile-web-app-capable" content="yes">` (RESEARCH.md "State of the Art" + Open Question 1 — belt-and-braces; UI-SPEC omission is non-strict).
6. Add `<link rel="stylesheet" href="/pwa.css">`.
7. Change `<title>frontend</title>` → `<title>Wallet</title>` (UI-SPEC §Copywriting Contract: `App display name`).

**Gotcha:** Do NOT hand-author a `<script src=...>` line — Expo appends it. If executor sees a blank page in `dist/` after `expo export -p web`, that means the bootstrap shape diverged from what Expo expects. Mitigation: run `expo export -p web` once with the new template and `grep '_expo/static/js' dist/index.html` to confirm injection.

---

### `frontend/public/manifest.json` (NEW — config, JSON)

**Analog (role-match):** `frontend/app.json` (only existing root-level JSON in this directory)

**Why this analog:** Establishes the project convention of small, hand-authored JSON config files with no schema-validation step at build time. Demonstrates the 2-space indent + double-quote-keys style.

**Style pattern to mirror** (`frontend/app.json` lines 1-9):
```json
{
  "expo": {
    "name": "frontend",
    "slug": "frontend",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    ...
```

**Content (locked by UI-SPEC §PWA Manifest Contract + CONTEXT D-10):**
- `name`, `short_name`: `"Wallet"` (NOT "frontend"; UI-SPEC copywriting contract overrides app.json's "frontend" slug)
- `start_url`: `"/"`, `display`: `"standalone"`, `orientation`: `"portrait"`
- `theme_color`: `"#0ea5e9"`, `background_color`: `"#ffffff"`
- Icons array: 3 entries (`192.png` purpose `any`, `512.png` purpose `any`, `512-maskable.png` purpose `maskable`) — per RESEARCH.md Anti-Pattern "Maskable + general in one icon" — they MUST be separate entries, never `"purpose": "any maskable"`.
- Optionally include `"$schema": "https://json.schemastore.org/web-manifest-combined.json"` for editor validation (RESEARCH.md Code Examples).

**Gotcha:** The `name` field in `manifest.json` and the `apple-mobile-web-app-title` meta tag must agree (`"Wallet"`). The `app.json` `expo.name: "frontend"` is unrelated to PWA install copy — do NOT change it.

---

### `frontend/public/pwa.css` (NEW — config, CSS)

**No in-tree analog.** This is the first CSS file in the project (all styling is RN StyleSheet or NativeWind className).

**Pattern source:** RESEARCH.md Code Examples §`pwa.css`:
```css
/* MOBUI-03: prevent iOS Safari zoom-on-focus by ensuring input font-size >= 16px */
input, select, textarea {
  font-size: 16px !important;
}
```

**Gotcha:** The `!important` is load-bearing — react-native-web emits inline `style="font-size: 14px"` on some `<TextInput>`s; only `!important` reliably overrides inline styles. UI-SPEC §Typography "Locked by MOBUI-03" confirms the rule shape.

---

### `frontend/public/offline.html` (NEW — config, static HTML)

**Analog (role-match):** `frontend/dist/index.html` (only other standalone HTML file)

**Why this analog:** Same `<!DOCTYPE html>` + `<head>` + `<body>` shape; same `<meta name="viewport" ...>` requirement (without `viewport-fit=cover` because no safe-area needed for the offline page).

**Content (locked by UI-SPEC §Copywriting Contract):** heading `"You're offline"`, body `"Check your connection. Your data will load once you're back online."`. Self-contained styles inline per RESEARCH.md Code Examples §`offline.html` — keep colors aligned with UI-SPEC palette (`#f9fafb` background, `#1f2937` text, `#6b7280` muted text).

**Gotcha:** Must NOT depend on any external CSS or JS — this file may load when JS is broken or SW cache is empty.

---

### `frontend/workbox-config.cjs` (NEW — config, CommonJS)

**Analog (partial):** `frontend/jest.config.js` — the only other root-level `.js`/`.cjs` config that uses `module.exports`.

**Why this analog:** Establishes the project's CommonJS-config style (no `.cjs` precedent yet, but `jest.config.js` is the same shape).

**Style pattern from `jest.config.js` lines 1-10:**
```js
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '\\.[jt]sx?$': ['babel-jest', { ... }],
  },
  ...
};
```

**Content (locked by CONTEXT D-04 + RESEARCH.md Pattern 1 "Workbox generateSW config"):**
- `globDirectory: 'dist/'`
- `globPatterns: ['**/*.{js,css,html,png,svg,jpg,jpeg,webp,woff,woff2,ico,json}']`
- `globIgnores: ['**/sw.js', '**/workbox-*.js']` — RESEARCH.md Anti-Pattern "Caching `sw.js` itself" warning
- `swDest: 'dist/sw.js'`
- `skipWaiting: true`, `clientsClaim: true`, `cleanupOutdatedCaches: true`
- `navigateFallback: '/offline.html'`, `navigateFallbackDenylist: [/^\/api/]`
- `dontCacheBustURLsMatching: /\.[0-9a-f]{20,}\./` (Expo's content-hashed filenames)
- `runtimeCaching`: four entries per RESEARCH.md Pattern 1 (NetworkFirst for `/index.html`, NetworkFirst for `/api/*` with `cacheableResponse: {statuses:[0,200]}`, CacheFirst for fonts with 30-day expiry, CacheFirst for images with 30-day expiry).

**Gotcha:** `.cjs` extension is required because Expo's `package.json` sets `"main": "index.ts"` but does not declare `"type": "module"`. Workbox-cli expects CommonJS config by default; `.cjs` is the unambiguous, future-proof signal.

---

### `frontend/src/pwa/registerSW.ts` (NEW — utility, side-effect register + log only)

**Analog:** `frontend/src/utils/queryClient.ts` (module-level singleton init, side-effect on import).

**Why this analog:** `queryClient.ts` is the established pattern for a module whose import triggers a one-time side-effect (singleton init) and exposes nothing — or only a singleton — to callers. Per the revised D-07 (user spot-check 2026-05-24), `registerSW.ts` is now equally minimal: it registers `/sw.js` on web, logs success/failure, and exits. No pub-sub, no hook, no postMessage handshake. (The pub-sub / `AuthContext`-style listener pattern referenced in earlier revisions has been removed alongside the UpdateToast surface.)

**Imports pattern (from project conventions):**
```ts
import { Platform } from 'react-native';
```

**Core pattern (locked by revised D-07 + RESEARCH.md Pattern 2 simplified):**
```ts
import { Platform } from 'react-native';

if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('[pwa] service worker registered'))
      .catch((err) => console.warn('[pwa] service worker registration failed', err));
  });
}
```

**Why the `Platform.OS === 'web'` guard:** Established convention in this codebase — see `TransactionFormScreen.tsx:548` (`{Platform.OS === 'web' && ...}`) and `FinanceSourcesScreen.test.ts` (BUG-03 tests assert `Platform.OS === 'web'` branches). New PWA module must follow the same gate so importing it from `App.tsx` is safe on native.

**Why no hook / no UI surface:** Per the revised D-07 / D-08 / D-09 (2026-05-24), the update lifecycle is handled entirely SW-side via Workbox's `skipWaiting: true + clientsClaim: true` (configured in `workbox-config.cjs`, ROADMAP SC-3 preserved). NetworkFirst on `/index.html` ensures the next navigation/refresh after a deploy fetches the fresh shell. No `useServiceWorkerUpdate()` hook, no `subscribeUpdate`/`applyUpdate` API, no `controllerchange` listener, no `SKIP_WAITING` postMessage, no `UpdateToast.tsx` component.

**Gotcha:** Never throw on SW registration failure — `.catch((err) => console.warn(...))`. App boot must never break because of PWA registration.

---

### `frontend/src/pwa/useServiceWorkerUpdate.ts` — SUPERSEDED (not produced)

**Status (2026-05-24):** This module is NO LONGER planned. The revised D-07 / D-08 / D-09 (user spot-check) eliminated the SW-update UI surface entirely. There is no hook, no pub-sub, no consumer. The silent SW takeover via Workbox `skipWaiting + clientsClaim` (preserved per ROADMAP SC-3) handles updates with zero client participation. See `05-CONTEXT.md` D-07 supersession annotation.

---

### `frontend/src/components/UpdateToast.tsx` — SUPERSEDED (not produced)

**Status (2026-05-24):** This component is NO LONGER planned. The revised D-08 (user spot-check) eliminated the explicit user-opt-in toast in favor of silent SW takeover. No `UpdateToast.tsx` is authored in 05-03; no `<UpdateToast />` is mounted in 05-05. The next navigation/refresh after deploy surfaces the new version automatically because `workbox-config.cjs` uses NetworkFirst on `/index.html` (configured in 05-03). See `05-CONTEXT.md` D-08 supersession annotation.

---

### `frontend/scripts/verify-pwa.mjs` (NEW — verification script)

**Analog 1 (assertion style):** `frontend/__tests__/CurrencyPicker.test.ts` (lines 1-44 — `fs.readFileSync` + `expect(content).toContain(...)`).

**Analog 2 (step-by-step CLI verify pattern):** `infra/scripts/smoke.sh` (lines 30-72 — `echo "==> step"; assert; exit !=0 on fail`).

**Why these analogs:** Project already has two verification idioms — Jest static-analysis tests (in `__tests__/`) and shell-style step-by-step verifiers (in `infra/scripts/`). The new `verify-pwa.mjs` follows the smoke.sh "echo step name, run check, exit on fail" cadence but in Node so it can use `JSON.parse`, regex, and JSON-Schema validation (or via `ajv` + vendored W3C schema, per 05-01 Task 2).

**Step-by-step pattern from `infra/scripts/smoke.sh` lines 49-58:**
```bash
echo "==> frontend: npm run build:web (row 04-05-01)"
( cd frontend && npm run build:web ) >/tmp/smoke-build.log 2>&1 || { tail -50 /tmp/smoke-build.log; echo "FAIL: build:web"; exit 1; }
test -d frontend/dist || { echo "FAIL: frontend/dist not created"; exit 1; }
```

**Node-equivalent skeleton for `verify-pwa.mjs`:**
```js
#!/usr/bin/env node
// frontend/scripts/verify-pwa.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist');
const checks = process.argv.includes('--all') ? ['manifest', 'apple-meta', 'viewport', 'sw', 'pwa-css'] : [process.argv.find(a => a.startsWith('--check='))?.slice(8)];

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`==> ${msg}`); }

for (const c of checks) {
  if (c === 'manifest') {
    ok('manifest: parse + required fields');
    const m = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
    for (const k of ['name', 'short_name', 'start_url', 'display', 'theme_color', 'background_color', 'icons']) {
      if (!(k in m)) fail(`manifest missing field: ${k}`);
    }
    if (!m.icons.some(i => i.sizes === '192x192')) fail('manifest missing 192x192 icon');
    if (!m.icons.some(i => i.sizes === '512x512' && i.purpose !== 'maskable')) fail('manifest missing 512x512 general icon');
    if (!m.icons.some(i => i.purpose === 'maskable')) fail('manifest missing maskable icon');
  }
  // ... apple-meta, viewport, sw, pwa-css branches mirror this shape
}
```

**CLI flags (locked by RESEARCH.md "Phase Requirements → Test Map"):** `--check=manifest`, `--check=apple-meta`, `--check=viewport`, `--check=sw`, `--all`.

**Per-check assertions (each row from the Test Map):**
- `--check=manifest`: parse + required-field presence + icon-size + maskable presence. Wave 0 uses `ajv` + vendored W3C manifest schema (`frontend/scripts/w3c-manifest-schema.json`) for real JSON-Schema validation. No human-verify checkpoint required — ajv is a top-30 npm package.
- `--check=apple-meta`: grep `dist/index.html` for the literal strings `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `apple-touch-icon`. Plus file exists at `dist/apple-touch-icon.png`.
- `--check=viewport`: grep `dist/index.html` for the literal string `viewport-fit=cover` (RESEARCH.md Pitfall 3).
- `--check=sw`: file exists at `dist/sw.js`; parses as JS via dynamic `new Function(src)` (catches syntax errors); contains the strings `NetworkFirst`, `CacheFirst`, `skipWaiting`, `clientsClaim`, `/api/`, `/index.html`.
- `--check=pwa-css`: grep `dist/pwa.css` for `font-size: 16px` (MOBUI-03).

**Gotcha:** `process.exit(1)` on any FAIL — must be CI-friendly. The `==> step name` cadence matches smoke.sh so logs are consistent across verification scripts.

---

### `frontend/scripts/verify-touch-targets.mjs` (NEW — verification script)

**Analog:** `frontend/__tests__/CurrencyPicker.test.ts` lines 9-15 (the `fs.readFileSync` + path conventions are identical).

**Why this analog:** The check is "regex over source files." `CurrencyPicker.test.ts` already established the pattern of reading `frontend/src/screens/*.tsx` and asserting string presence.

**Skeleton (mirror smoke.sh exit-code style + CurrencyPicker.test.ts file-loading pattern):**
```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const FRONTEND = process.cwd();
function readSrc(rel) { return fs.readFileSync(path.join(FRONTEND, rel), 'utf8'); }
function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`==> ${msg}`); }

// MOBUI-01: Button.tsx small size has minHeight: 44 + minWidth: 44
ok('touch-targets: Button.tsx small size declares minHeight: 44 and minWidth: 44');
const btn = readSrc('src/components/Button.tsx');
if (!/small:\s*\{[^}]*minHeight:\s*44[^}]*minWidth:\s*44/s.test(btn)) fail('Button.tsx small size missing minHeight/minWidth 44');

// MOBUI-04: TransactionFormScreen.tsx amount field has both keyboardType="decimal-pad" and inputMode="decimal"
ok('input-mode: TransactionFormScreen amount field has inputMode="decimal"');
const tx = readSrc('src/screens/TransactionFormScreen.tsx');
const decimalPadCount = (tx.match(/keyboardType="decimal-pad"/g) || []).length;
const inputModeCount = (tx.match(/inputMode="decimal"/g) || []).length;
if (decimalPadCount !== inputModeCount) fail(`decimal-pad count ${decimalPadCount} != inputMode count ${inputModeCount}`);

// MOBUI-02: Screen.tsx imports SafeAreaView from react-native-safe-area-context
ok('safe-area: Screen.tsx imports SafeAreaView from react-native-safe-area-context');
const screen = readSrc('src/components/Screen.tsx');
if (!/from\s+['"]react-native-safe-area-context['"]/.test(screen)) fail('Screen.tsx not importing from react-native-safe-area-context');

// MOBUI-02: App.tsx wraps with SafeAreaProvider
ok('safe-area: App.tsx uses SafeAreaProvider');
const app = readSrc('App.tsx');
if (!/SafeAreaProvider/.test(app)) fail('App.tsx not wrapping with SafeAreaProvider');
```

**Gotcha:** Use the same `==>` / `FAIL:` cadence so a single tail-log glance shows all phase verifiers (smoke.sh + verify-pwa.mjs + verify-touch-targets.mjs) consistently.

---

### `frontend/__tests__/Button.test.ts` (NEW — Jest static unit test)

**Analog:** `frontend/__tests__/CurrencyPicker.test.ts` — exact pattern (file-read + `describe`/`it`/`expect`).

**Why this analog:** RESEARCH.md "Validation Architecture" §Test Framework confirms Jest 30.3.0 with `testEnvironment: 'node'` — all existing `__tests__/*.test.ts` are static-analysis tests that read source as a string. `Button.test.ts` must follow exactly the same shape.

**Imports + setup pattern (mirror `CurrencyPicker.test.ts` lines 1-25):**
```ts
import * as fs from 'fs';
import * as path from 'path';

const BUTTON_SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/components/Button.tsx'),
  'utf8'
);
```

**`describe`/`it` pattern (mirror `CurrencyPicker.test.ts` lines 28-44 + `TransactionsScreen.test.ts` lines 17-49):**
```ts
describe('MOBUI-01: Button small size satisfies 44x44 touch-target minimum', () => {
  it('Button.tsx defines a small size style block', () => {
    expect(BUTTON_SOURCE).toMatch(/small:\s*\{/);
  });

  it('small size has minHeight: 44', () => {
    expect(BUTTON_SOURCE).toMatch(/small:\s*\{[^}]*minHeight:\s*44/s);
  });

  it('small size has minWidth: 44', () => {
    expect(BUTTON_SOURCE).toMatch(/small:\s*\{[^}]*minWidth:\s*44/s);
  });
});
```

**Gotcha:** Do NOT try to import `Button` from `'@/components/Button'` and `import { StyleSheet }` and assert against the resolved style object — the project's `jest.config.js` uses `testEnvironment: 'node'` (line 5) explicitly to avoid the RN runtime; running RN code throws because `react-native-worklets` isn't loadable in Node. Stick with the static-source-string assertion idiom established by all 4 existing tests.

---

### `frontend/App.tsx` (MOD — component, app root)

**Analog:** itself (existing structure stays; additive only)

**Why:** UI-SPEC §Safe Area Inset Contract + RESEARCH.md Pattern 3 + CONTEXT D-07/D-09 (revised) lock the surface — wrap in `SafeAreaProvider` and side-effect-import `@/pwa/registerSW`. Per the revised D-08 / D-09 (2026-05-24), the previously planned `<UpdateToast />` sibling-render is REMOVED — App.tsx integration is now JUST the provider wrap + the side-effect import. No `UpdateToast` import, no `<UpdateToast />` element.

**Current shape (`App.tsx` lines 1-42) — to be EXTENDED, not rewritten:**
```tsx
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/store/AuthContext';
import { queryClient } from '@/utils/queryClient';
import { Navigation } from '@/components/Navigation';
```

**Modified imports (add 2 lines — NO UpdateToast import per revised D-08):**
```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '@/pwa/registerSW';  // side-effect; no-op on native
```

**Modified root JSX (mirror RESEARCH.md Pattern 3 §SafeAreaProvider wrapping; NO UpdateToast sibling per revised D-09):**
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

**What stays:** `AppContent`, the loading-state `ActivityIndicator` (lines 11-28), the `styles` block (lines 44-56), `StatusBar`. All untouched.

**Gotcha:** `SafeAreaProvider` MUST be the outermost wrapper. If it sits inside `AuthProvider`, `useSafeAreaInsets()` in `Screen.tsx` will still return zeros (RESEARCH.md Anti-Pattern "Forgetting SafeAreaProvider").

---

### `frontend/src/components/Button.tsx` (MOD)

**Analog:** itself, lines 91-94.

**The single edit** (from RESEARCH.md §Button.tsx patch):
```diff
   // Sizes
   small: {
     paddingVertical: 8,
     paddingHorizontal: 16,
+    minHeight: 44,
+    minWidth: 44,
   },
```

**Why this is the load-bearing fix:** `TransactionsScreen.tsx:160,167,212,220`, `FinanceSourcesScreen.tsx:96,103,135,149,154`, `FinanceSourceFormScreen.tsx:142,165`, `TransactionFormScreen.tsx:371,378,385`, `RegisterScreen.tsx:148` all pass `size="small"` (confirmed via `grep` during pattern mapping). After this one edit, all 14 small-button call-sites inherit the fix — no per-site change required. UI-SPEC §Touch Target Enforcement Contract calls this "the single-point fix."

**What stays:** every other style block (`medium`, `large`, variants, text styles).

---

### `frontend/src/components/Screen.tsx` (MOD)

**Analog:** itself, lines 1-9 (the import block).

**The single edit** (from RESEARCH.md §Screen.tsx SafeAreaView swap):
```diff
- import {
-   View,
-   SafeAreaView,
-   ScrollView,
-   StyleSheet,
-   KeyboardAvoidingView,
-   Platform,
- } from 'react-native';
+ import {
+   View,
+   ScrollView,
+   StyleSheet,
+   KeyboardAvoidingView,
+   Platform,
+ } from 'react-native';
+ import { SafeAreaView } from 'react-native-safe-area-context';
```

**Why:** `react-native-safe-area-context`'s `SafeAreaView` (a) honors `env(safe-area-inset-*)` on web (the RN core `SafeAreaView` is iOS-native-only and a no-op on Android + web), (b) is already a project dep (`package.json:29`), (c) has an identical API surface (`style`, `children`) so no other code in `Screen.tsx` changes.

**What stays:** every line 11-66 untouched. The `styles.safeArea` block (lines 47-50) continues to apply correctly because the new SafeAreaView accepts the same `style` prop.

---

### `frontend/src/screens/TransactionFormScreen.tsx` (MOD)

**Analog:** itself, lines 535, 628, 727 (the three amount fields — original/transfer-source/transfer-dest).

**Edits — three identical patches** (from RESEARCH.md Code Examples §TransactionFormScreen.tsx amount field):
```diff
                 keyboardType="decimal-pad"
+                inputMode="decimal"
```

Apply at lines 535, 628, 727 (one per amount-field call).

**Why both:** `keyboardType="decimal-pad"` is the RN native API; `inputMode="decimal"` is the RN-web 0.20+ prop that maps directly to HTML `inputmode="decimal"` and takes precedence on web (RESEARCH.md "Don't Hand-Roll" + Open Question 2). Belt-and-braces; the codebase already partially handled this via `keyboardType` alone but RESEARCH.md confirms the explicit prop is the spec-correct form for MOBUI-04.

**Also-modify:** currency-picker `TouchableOpacity` at lines 542 (`currencyTrigger`), 466 (modal item), 456 (modal close) — see Shared Patterns §Touch-Target Spot-Fix below.

---

### `frontend/src/screens/FinanceSourceFormScreen.tsx` (MOD)

**Analog:** itself, lines 175-215 (the currency picker block).

**Edits — touch-target spot-fix on three TouchableOpacities:**
- Line 175 (`<TouchableOpacity style={styles.currencyTrigger}>`) — add `minHeight: 44` to `styles.currencyTrigger`.
- Line 191 (modal close `<TouchableOpacity onPress={() => setCurrencyPickerVisible(false)}>`) — wrap or add inline `style={{ minHeight: 44, minWidth: 44, padding: 12, justifyContent: 'center' }}`. UI-SPEC §Touch Target Enforcement Contract lists "Modal close buttons" explicitly.
- Line 204 (currency row `<TouchableOpacity style={[styles.currencyItem, ...]}>`) — add `minHeight: 44` to `styles.currencyItem`.

**Why these named edits (revised 2026-05-24):** These three sites are the HIGH-CONFIDENCE SUBSET — the original D-15 named list that UI-SPEC explicitly called out as touch-critical (currency picker rows + modal close). Per the revised D-15 (user spot-check 2026-05-24), the full grep audit landed in 05-04 Task 6 covers everything else under `frontend/src/` (via `verify-touch-targets.mjs --check=all-touchables`, with `// touch-target-exempt: <reason>` opt-out for genuinely non-tap-critical elements). The named edits here remain because they are reliably correct without inspection — landing them up-front frees the audit pass to focus on the long tail.

---

### `frontend/src/screens/ProfileScreen.tsx` (MOD)

**Analog:** itself, lines 98 (back button), 122 (currency trigger), 164 (modal close).

**Edits — same touch-target spot-fix shape as FinanceSourceFormScreen above:**
- Line 98 `<TouchableOpacity onPress={onBack} style={styles.backButton}>` — add `minHeight: 44, minWidth: 44` to `styles.backButton`.
- Line 122 `<TouchableOpacity style={styles.currencyTrigger}>` — add `minHeight: 44` to `styles.currencyTrigger`.
- Line 164 modal close `<TouchableOpacity onPress={() => { setPickerVisible(false); ... }}>` — same wrap as FinanceSourceFormScreen line 191.

**Why named-only (no Button size="small" tweaks):** ProfileScreen uses `<Button>` for Save/Cancel (lines 135, 142) — those inherit the Button.tsx single-point fix automatically.

---

### `frontend/src/screens/TransactionsScreen.tsx`, `FinanceSourcesScreen.tsx` (MOD — verification only)

**Analog:** themselves. No code change needed.

**Why:** every interactive element in these screens uses `<Button size="small">` (confirmed via grep — `TransactionsScreen.tsx:160,167,212,220`, `FinanceSourcesScreen.tsx:96,103,135,149,154`). They inherit the Button.tsx single-point fix. No edits required.

**Verification:** the new `verify-touch-targets.mjs` script grep'd these files counts as the gate.

---

### `frontend/src/screens/LoginScreen.tsx`, `RegisterScreen.tsx` (MOD — verification only / no-op)

**Analog:** themselves, `LoginScreen.tsx:70-72`, `RegisterScreen.tsx:106-108`.

**Current state (already correct):**
```tsx
keyboardType="email-address"
autoCapitalize="none"
autoComplete="email"
```

**No edit needed.** RESEARCH.md Pitfall 6 explicitly warns "Don't try to 'fix' what's already right." The `verify-touch-targets.mjs` regex check is the verification gate.

**Note:** `<Button size="large">` on the Sign In button (`LoginScreen.tsx:93`) is already 52px (paddingVertical:16 + 18px text = ≥44px) — already compliant.

---

### `frontend/package.json` (MOD — `build:web` script + devDependencies)

**Analog:** itself, line 10 (existing `build:web` script).

**Current shape (line 10):**
```json
"build:web": "rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && cp src/constants/config.dev.ts src/constants/config.ts",
```

**Modified shape (insert `workbox generateSW` BEFORE the dev-config restore — locked by CONTEXT D-05):**
```json
"build:web": "rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && npx workbox generateSW workbox-config.cjs && cp src/constants/config.dev.ts src/constants/config.ts",
```

**Also add to `devDependencies` (per CONTEXT D-06 + RESEARCH.md Standard Stack):**
- `"workbox-cli": "^7.4.1"`
- `"ajv": "^8"`
- `"sharp": "^0.33"` (per revised D-10 — icon generation script in 05-02)

**Atomicity contract (CONTEXT D-05):** the entire `build:web` value MUST stay on one logical line. Phase 4 lived through a partial config-swap failure once already; do not introduce intermediate state.

**Gotcha:** If `npx workbox` is invoked without `--mode production`, it still emits a usable `sw.js` (the flag only controls log verbosity). RESEARCH.md's recommended exact invocation is `npx workbox generateSW workbox-config.cjs` — no flags.

---

## Shared Patterns

### Color Tokens (UI-SPEC §Color)

**Apply to:** every new component and CSS file.

| Token | Value | Source of truth |
|-------|-------|-----------------|
| Accent (primary actions, focus, links) | `#0ea5e9` | `tailwind.config.js` `sky-500`; `Button.tsx:79,84,118`; `Navigation.tsx:70,78` |
| Dominant background | `#f9fafb` | `Screen.tsx:49`; `Navigation.tsx:54`; `App.tsx:49` |
| Secondary background (cards/headers) | `#ffffff` | `Card.tsx:24,28,32`; `Navigation.tsx:58`; `Input.tsx:77` |
| Destructive | `#ef4444` | `Button.tsx:87`; `Input.tsx:91,105` |
| Text primary | `#1f2937` | `Input.tsx:84` |
| Text muted | `#6b7280` | `App.tsx:54`; `Navigation.tsx:75` |
| Border default | `#d1d5db` | `Input.tsx:79` |

**Apply to:**
- `manifest.json` (`theme_color: #0ea5e9`, `background_color: #ffffff`)
- `pwa.css` — no hardcoded colors needed (font-size rule only)
- `offline.html` — inline styles must use `#f9fafb` background, `#1f2937` heading, `#6b7280` body text

**Anti-pattern:** Do NOT introduce any new color value. Every color in every new file MUST appear in this table.

---

### Platform Branching

**Source:** `TransactionFormScreen.tsx:548`, `FinanceSourcesScreen.tsx` BUG-03 tests.

**Idiomatic guard:**
```tsx
import { Platform } from 'react-native';
// ...
if (Platform.OS === 'web') { /* web-only */ }
// or inline:
{Platform.OS === 'web' && <SomeWebOnlyThing />}
```

**Apply to:**
- `registerSW.ts` — gate the SW registration block (`Platform.OS === 'web' && 'serviceWorker' in navigator`) so the file is safe to import unconditionally from `App.tsx`.
- Anywhere else PWA-only logic intrudes — there shouldn't be much; the only PWA-side module in Phase 5 is `registerSW.ts` itself (already guarded), and per the revised D-07/D-08/D-09 there is no hook or component consuming SW events on the client side.

---

### Path Alias Imports

**Source:** `tsconfig.json` lines 6-8 (`"@/*": ["src/*"]`), `jest.config.js` line 19 (`'^@/(.*)$': '<rootDir>/src/$1'`).

**Idiomatic import shape (from `App.tsx` lines 4-6, `Navigation.tsx` lines 3-6):**
```ts
import { Navigation } from '@/components/Navigation';
import { useAuth } from '@/store/AuthContext';
```

**Apply to:**
- `registerSW.ts` is at `@/pwa/registerSW`
- `App.tsx` imports `registerSW` as `import '@/pwa/registerSW'` (side-effect form, no destructure). Per the revised D-08/D-09, no `UpdateToast` component is produced or imported.

**Gotcha:** Verification scripts under `frontend/scripts/*.mjs` run with `cwd=frontend/` — they use literal relative paths (`path.join(FRONTEND, 'src/...')`), not `@/` aliases. The alias only resolves inside the TS/JS bundler graph.

---

### StyleSheet Convention

**Source:** every component file (`Button.tsx:69`, `Card.tsx:18`, `Screen.tsx:46`, `Input.tsx:63`, `Navigation.tsx:51`).

**Pattern:** All component styling via `StyleSheet.create({...})` at the bottom of the file (after the component export), declared as `const styles = StyleSheet.create({...})`. No NativeWind className strings in any current component despite the dep being installed — convention is StyleSheet only.

**Apply to:** every new component in this phase MUST follow the same `const styles = StyleSheet.create({...})` shape; do NOT introduce NativeWind `className=...` syntax. (NativeWind exists in deps but no component uses it yet — keep that convention until a separate phase intentionally adopts it. Phase 5 produces no new components — UpdateToast was dropped per the revised D-08 — so this rule applies prospectively to future phases that touch this area.)

---

### Touch-Target Spot-Fix (per CONTEXT D-15 — revised 2026-05-24)

**Scope (revised 2026-05-24):** Button.tsx single-point fix propagates to 14 call-sites. Named non-Button spot-fixes cover 3 known screens (ProfileScreen, FinanceSourceFormScreen, TransactionFormScreen). **Plus** a full grep audit (05-04 Task 6) over every `<TouchableOpacity>` / `<Pressable>` / `<TouchableHighlight>` in `frontend/src/` catches anything the named list missed, gated by the `all-touchables` check in `verify-touch-targets.mjs`. Opt-out: `// touch-target-exempt: <reason>` comment above a JSX element exempts it (for genuinely non-tap-critical UI like 24×24 informational icons or web-only hover affordances). See revised D-15 supersession annotation in `05-CONTEXT.md`.

**Named sources to touch (preserved as a high-confidence SUBSET of the broader audit):**

| File | Line | Element | Fix |
|------|------|---------|-----|
| `Button.tsx` | 91-94 | `small` size style | add `minHeight: 44, minWidth: 44` |
| `FinanceSourceFormScreen.tsx` | 175 | `currencyTrigger` | add `minHeight: 44` to style |
| `FinanceSourceFormScreen.tsx` | 191 | modal close | `style={{ minHeight: 44, minWidth: 44, padding: 12, justifyContent: 'center' }}` |
| `FinanceSourceFormScreen.tsx` | 204 | currency row | add `minHeight: 44` to `styles.currencyItem` |
| `TransactionFormScreen.tsx` | 542 | `currencyTrigger` | add `minHeight: 44` to style |
| `TransactionFormScreen.tsx` | 456 | modal close | `minHeight: 44, minWidth: 44, padding: 12` |
| `TransactionFormScreen.tsx` | 466 | currency row | add `minHeight: 44` to `styles.currencyItem` |
| `ProfileScreen.tsx` | 98 | back button | add `minHeight: 44, minWidth: 44` to `styles.backButton` |
| `ProfileScreen.tsx` | 122 | `currencyTrigger` | add `minHeight: 44` |
| `ProfileScreen.tsx` | 164 | modal close | `minHeight: 44, minWidth: 44, padding: 12` |
| (every screen) | n/a | `<Button size="small">` | inherits from Button.tsx fix — no per-site edit |

**Audit (revised 2026-05-24):** Per the revised D-15, the named-list-only approach was expanded — 05-04 Task 6 now runs a full grep audit of every `<TouchableOpacity>` / `<Pressable>` / `<TouchableHighlight>` under `frontend/src/` and applies `minHeight: 44` (or a `// touch-target-exempt: <reason>` opt-out comment for genuinely non-tap-critical UI). The `all-touchables` check in `verify-touch-targets.mjs` is the gate. RESEARCH.md Pitfall 7 (tag chips aren't interactive) is preserved as guidance — apply the exemption comment to those sites rather than forcing a 44px hit area.

---

### Static-Source Test Convention (Jest 30 + testEnvironment: 'node')

**Source:** `jest.config.js` (lines 5, 9-13), every existing `__tests__/*.test.ts`.

**Pattern (mirror `CurrencyPicker.test.ts` lines 1-25):**
```ts
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/components/Foo.tsx'),
  'utf8'
);

describe('FEAT-XX: feature description', () => {
  it('asserts a thing about the source string', () => {
    expect(SOURCE).toContain('expected substring');
  });
});
```

**Apply to:** `__tests__/Button.test.ts` (and any other Phase 5 unit test).

**Anti-pattern:** Do NOT use `@testing-library/react-native` `render()` — the test env is Node, not RN; rendering throws because of the missing `react-native-worklets` peer dep (see `jest.config.js:6-8` comment block: "lightweight node environment that avoids expo/winter and react-native-worklets setup failures").

---

### Verification Script Logging Cadence

**Source:** `infra/scripts/smoke.sh` lines 30-72.

**Convention:** every step emits `==> step name` to stdout; on failure emit `FAIL: reason` to stderr and exit with `process.exit(1)` (Node) or `exit 1` (bash). No interactive prompts. No emoji in script output (these may be parsed in CI logs).

**Apply to:** `frontend/scripts/verify-pwa.mjs`, `frontend/scripts/verify-touch-targets.mjs`. The `==>` prefix makes a `grep ==>` over the smoke log produce a clean phase-progress view.

---

## No Analog Found

These four files have no in-tree analog; planner falls back to RESEARCH.md primary sources:

| File | Role | Why no analog | Fallback source |
|------|------|---------------|-----------------|
| `frontend/public/pwa.css` | CSS | First CSS file in repo (everything else is RN StyleSheet) | RESEARCH.md Code Examples §pwa.css |
| `frontend/public/192.png` / `512.png` / `512-maskable.png` / `apple-touch-icon.png` | binary assets (script-generated) | Per the revised D-10 (2026-05-24), these are produced by `frontend/scripts/generate-icons.mjs` (sharp-based; reads `frontend/assets/adaptive-icon.png`, composites on `#0ea5e9` per D-11 preserved). Source: sharp docs at https://sharp.pixelplumbing.com/ — UI-SPEC §PWA Manifest Contract §Icon design direction + CONTEXT D-10 (revised) / D-11 (verbatim). |
| `frontend/scripts/generate-icons.mjs` | image-processing script | First sharp-using script in repo; no in-tree analog | sharp docs at https://sharp.pixelplumbing.com/; CONTEXT revised D-10 |
| `frontend/public/manifest.json` | JSON manifest | No web-app-manifest precedent in repo | RESEARCH.md Code Examples §manifest.json + UI-SPEC §PWA Manifest Contract |
| `frontend/workbox-config.cjs` | Workbox config | First `.cjs` config in repo (only `jest.config.js` is a `.js` config; partial-match only on module-style) | RESEARCH.md Pattern 1 + Anti-Patterns section |

For these four, RESEARCH.md's primary-source code examples ARE the pattern. They were vetted against Workbox/MDN/Expo official docs (RESEARCH.md "Sources" section) — planner can reference them directly.

---

## Project-Specific Gotchas

1. **No CLAUDE.md, no `.claude/skills/`, no `.agents/skills/`** in this repo (confirmed via `ls` during pattern mapping). The repo's conventions come entirely from existing code shape — that's why the analogs above are extracted verbatim from `Button.tsx`, `Screen.tsx`, `Navigation.tsx`, `App.tsx`, `jest.config.js`, `tsconfig.json`, and `smoke.sh`.

2. **`testEnvironment: 'node'`** in Jest (`jest.config.js:5`) — every test in this repo is static-source-analysis. New tests MUST follow that idiom; do not `render()` RN components in Jest.

3. **Atomic `build:web` script** (CONTEXT D-05) — never split the existing one-line script across multiple lines or multiple package.json scripts. Phase 4 already paid the price for that footgun.

4. **`Platform.OS === 'web'` guard everywhere** — `TransactionFormScreen.tsx:548`, `FinanceSourcesScreen.tsx` BUG-03 tests demand this pattern. Web-only modules MUST guard their side effects so unconditional imports stay safe.

5. **Color tokens are exhaustive** — the table in UI-SPEC §Color is the complete palette. Any new color = a UI-SPEC violation. Planner should reject any plan that introduces a new hex.

6. **`react-native-safe-area-context` is already a dep** (`package.json:29`, version `^5.6.1`) — no npm install needed for MOBUI-02. The work is entirely import-source swap + provider wrap.

7. **`mobile-web-app-capable` extra tag (RESEARCH.md Open Question 1)** — researcher recommends adding it alongside `apple-mobile-web-app-capable` for belt-and-braces; UI-SPEC §iOS-Specific Meta Tags Contract names only the `apple-` variant. Plan-check should flag this for human confirmation before authoring `public/index.html`.

8. **Workbox `globIgnores` for `sw.js`** — RESEARCH.md Anti-Pattern "Caching `sw.js` itself" is the highest-stakes anti-pattern in this phase: a precached SW is unrecoverable. The `globIgnores: ['**/sw.js', '**/workbox-*.js']` line is load-bearing; the planner MUST include it in the workbox-config.cjs task.

9. **Expo's bootstrap script-tag injection (RESEARCH.md A1 + Pitfall 2)** — the planner's `public/index.html` task should embed an executor instruction: "After authoring, run `npx expo export -p web` once and `grep '_expo/static/js' dist/index.html` to confirm injection. If grep is empty, the template's `<div id="root"></div></body>` block diverged from Expo's expected shape — fix and retry."

10. **The current `dist/` is stale** — the `frontend/dist/index.html` we read for the bootstrap pattern (line 35) is from a Phase 4 build. `build:web` is destructive (`rm -rf dist`), so the executor will lose this reference after the first new build. Planner should record the bootstrap shape inline in the Phase 5 plan so it survives a fresh build.

## Metadata

**Analog search scope:** `frontend/`, `frontend/src/`, `frontend/__tests__/`, `frontend/scripts/` (empty), `infra/`, `infra/scripts/`, repo root for `CLAUDE.md` (absent), `.claude/skills/` (absent), `.agents/skills/` (absent).

**Files scanned (read in full or targeted ranges):** `frontend/package.json`, `frontend/tsconfig.json`, `frontend/jest.config.js`, `frontend/App.tsx`, `frontend/app.json`, `frontend/dist/index.html`, `frontend/src/components/{Button,Screen,Card,Input,Navigation,index}.tsx`, `frontend/src/screens/{TransactionFormScreen,FinanceSourceFormScreen,FinanceSourcesScreen,TransactionsScreen,ProfileScreen,LoginScreen,RegisterScreen}.tsx` (targeted line ranges), `frontend/__tests__/{CurrencyPicker,TransactionsScreen,FinanceSourcesScreen}.test.ts`, `infra/Caddyfile`, `infra/scripts/smoke.sh`.

**Pattern extraction date:** 2026-05-23
