# Phase 5: PWA-ify Frontend + Mobile Polish - Research

**Researched:** 2026-05-23
**Domain:** Progressive Web App (manifest + service worker + iOS install) layered on Expo SDK 54 web export (Metro bundler) for a React-Native-Web app
**Confidence:** HIGH overall — most decisions are locked in `05-CONTEXT.md` / `05-UI-SPEC.md`; this research confirms feasibility, tightens version pins, surfaces one critical tooling change since CONTEXT was authored, and maps every success-criterion to a verification command.

## Summary

Phase 5 is mostly **execution against a locked design contract**. CONTEXT D-01..D-15 already decide the file layout (`frontend/public/` for static PWA assets), tooling (`workbox-cli generateSW` post-`expo export`), SW lifecycle (`skipWaiting + clientsClaim` + a "Reload App" toast), icon strategy (4 hand-authored PNGs), touch-target fix-site (`Button.tsx` `small` size override), and the deferral of real-device verification to Phase 6. Research's job is to confirm each piece of tooling exists, name exact versions, document the Expo-web export bootstrap markup our `public/index.html` must preserve, and surface one tooling change since CONTEXT was authored that **materially changes how SC-1 (Lighthouse PWA score ≥90) is verified**.

**The critical finding:** Lighthouse 12+ (released April 2024, current 13.3.0) **removed the PWA category entirely**. The `--only-categories=pwa` flag from CONTEXT D-12 will fail. The score-≥90 target is no longer producible by any current `lighthouse` invocation. The PWA-installability checks now live as individual Chrome DevTools audits and as the standalone `@pwabuilder/manifest-validation` library. Phase 5 verification must shift from "Lighthouse PWA score ≥90" to a decomposed installability check (manifest fields validate, SW registers, icons present, meta tags present) — every original sub-criterion from SC-1 is still verifiable, just not via a single PWA score.

**Primary recommendation:** Implement D-01..D-15 verbatim. Replace the Lighthouse PWA-score gate with a deterministic checklist: (a) `@pwabuilder/manifest-validation` JSON-API validation of `manifest.json`, (b) `grep`-based meta-tag presence checks against `dist/index.html`, (c) Workbox-emitted `sw.js` parse + precache-manifest count check, (d) a Playwright/Puppeteer smoke that registers the SW against the prod Caddy stack and asserts `navigator.serviceWorker.controller` becomes non-null. This produces the same coverage as the old Lighthouse PWA category and is reproducible in CI without a headless-Chrome dependency.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PWA manifest JSON + linked icons | Browser / Client (static asset) | CDN / Static (served by Caddy) | Manifest is a static file fetched once at install; no runtime logic |
| Service worker (precache + runtime caching) | Browser / Client | — | SW is a client-side proxy; runs in a separate worker thread of the browser |
| `index.html` shell + apple/viewport meta tags | CDN / Static | — | Static template served by Caddy; no SSR for this SPA |
| SW registration + update toast | Browser / Client | — | Pure browser API (`navigator.serviceWorker`) + React-Native-Web rendering |
| Touch-target sizing | Browser / Client | — | CSS dimensions enforced by the React-Native-Web style runtime |
| Safe-area inset padding | Browser / Client | — | `env(safe-area-inset-*)` CSS via `react-native-safe-area-context` |
| 16px input font (no-zoom) | Browser / Client | — | Global CSS rule in `public/pwa.css` |
| `inputmode="decimal"` keyboard hint | Browser / Client | — | HTML attribute (RN's `keyboardType="decimal-pad"` already maps to `inputmode="decimal"` via react-native-web) |
| Lighthouse / installability verification | Local dev tooling | — | Verification step, not part of the shipped app |

All Phase 5 work lives in the **Browser / Client** tier. No backend, API, or storage changes. Caddy (the static server from Phase 4) is touched only by the new asset paths it serves — no Caddyfile edit needed (Phase 4 D-12 confirms `dist/` is bind-mounted read-only, so new files under `dist/` appear automatically).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `workbox-cli` | `^7.4.1` [VERIFIED: npm registry — published 2026-05-04] | Generate `sw.js` from a `workbox-config.cjs` against the built `dist/` tree | The canonical Google-maintained PWA SW generator; eliminates hand-rolled cache versioning [CITED: developer.chrome.com/docs/workbox/modules/workbox-cli] |
| `react-native-safe-area-context` | `^5.6.1` (already a dep) [VERIFIED: present in `frontend/package.json`] | Cross-platform safe-area-inset hook + Provider | Apple-and-Flow's library is the documented React-Native standard; on web it emits CSS `env(safe-area-inset-*)` [CITED: docs.expo.dev/versions/latest/sdk/safe-area-context/] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@pwabuilder/manifest-validation` | latest [VERIFIED: npm registry, replaces deprecated Lighthouse PWA category] | Programmatic manifest schema validation | Phase 5 verification only — used in `infra/scripts/smoke.sh` extension or a new `frontend/scripts/verify-pwa.mjs`; **dev-time only**, not bundled |
| `lighthouse` | `^13.3.0` [VERIFIED: npm registry — published 2026-05-07] | Performance + accessibility + best-practices audit (NOT PWA — that category was removed in v12.0) | Optional sanity audit at dev time; do NOT gate Phase 5 verify on a Lighthouse "PWA score" because no such score exists in v12+ [CITED: github.com/GoogleChrome/lighthouse/issues/15535] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `workbox-cli generateSW` | `workbox-cli injectManifest` (author your own `sw.js` template) | injectManifest gives total control over the SW source but requires authoring service-worker JavaScript by hand. CONTEXT D-04 picks `generateSW` because the PWA-04 runtimeCaching strategy fits cleanly in the config. No reason to revisit unless we hit a generateSW limit (we won't for this scope). |
| `vite-plugin-pwa` | — | Not applicable: Expo uses Metro, not Vite. CONTEXT D-04 already eliminates this. |
| Hand-rolled `sw.js` | — | Reinvents Workbox's precache-manifest-with-revision-hashes machinery. Predictable foot-gun: stale shells when a JS chunk hash changes but the SW's hardcoded version doesn't. |
| `pwa-asset-generator` for icons | Hand-author 4 PNGs (CONTEXT D-10) | Tool adds a dep + a generate step. CONTEXT chooses hand-author for a one-shot v2.0; the tool is cheaper if icons change often, which they won't. |

**Installation (proposed):**
```bash
# In frontend/
npm install --save-dev workbox-cli@^7.4.1
# Verify scope:
npm view workbox-cli scripts.postinstall   # expected: empty (no postinstall script)
# Optional dev-time verification helpers (NOT runtime deps, do NOT add to dependencies):
npm install --save-dev @pwabuilder/manifest-validation lighthouse
```

**Version verification:**
- `workbox-cli`: `7.4.1`, published `2026-05-04` (npm view confirmed during this research session)
- `lighthouse`: `13.3.0`, published `2026-05-07` (npm view confirmed)
- `react-native-safe-area-context`: `5.6.1` is already pinned in `frontend/package.json` line 29 — no change needed.

## Package Legitimacy Audit

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `workbox-cli` | npm | ~6 yrs (Workbox project mature) | github.com/GoogleChrome/workbox | [OK] (scanned 2026-05-23) | Approved — Google-maintained, primary recommendation |
| `lighthouse` | npm | ~9 yrs (Google project) | github.com/GoogleChrome/lighthouse | [OK] (scanned 2026-05-23) | Approved — Google-maintained; **dev-only, not bundled** |
| `@pwabuilder/manifest-validation` | npm | Microsoft project (PWABuilder org) | github.com/pwa-builder/manifest-information | Not run individually; org has long history of legitimate PWA tooling | [ASSUMED] — planner must add `checkpoint:human-verify` before install. Reason: not scanned individually in this session; replaces a previously trusted Lighthouse capability so warrants confirmation. |
| `react-native-safe-area-context` | npm | Already installed since v1.0 | github.com/AppAndFlow/react-native-safe-area-context | n/a (pre-existing) | Approved — no new install |

**Packages removed due to `[SLOP]` verdict:** none
**Packages flagged `[SUS]`:** none. `@pwabuilder/manifest-validation` is tagged `[ASSUMED]` not `[SUS]` — slopcheck wasn't run on it specifically in this session; planner should gate the install behind a manual verification step (confirm `github.com/pwa-builder` is the npm-scope owner).

**Postinstall-script check:**
```bash
npm view workbox-cli scripts.postinstall  # empty (confirmed in this session)
npm view lighthouse scripts.postinstall   # empty
```
No suspicious lifecycle scripts detected.

## Architecture Patterns

### System Architecture Diagram

```
Browser request flow (post-Phase 5):

  User taps icon on iPhone home screen
       │
       ▼
  iOS Safari launches "/" in standalone mode (no Safari chrome)
       │  (display: standalone read from manifest.json)
       ▼
  GET /index.html  ──►  Caddy file_server  ──►  dist/index.html  (NETWORK-FIRST cached)
       │
       │ ← <link rel="manifest" href="/manifest.json">
       │ ← <link rel="apple-touch-icon" href="/apple-touch-icon.png">
       │ ← <meta name="viewport" content="...viewport-fit=cover">
       │ ← <meta name="apple-mobile-web-app-capable" content="yes">
       │ ← <link rel="stylesheet" href="/pwa.css">  (16px input override)
       │ ← <script src="/_expo/static/js/web/index-<hash>.js" defer></script>
       │
       ▼
  React-Native-Web app boots
       │
       ├──► import '@/pwa/registerSW'  (web-only side-effect)
       │         │
       │         └──► navigator.serviceWorker.register('/sw.js')
       │                  │
       │                  ├──► PRECACHE: every {js,css,html,png,svg,woff2} in dist/
       │                  │    (Workbox generateSW emits hashed manifest)
       │                  │
       │                  └──► RUNTIME ROUTES:
       │                       ├─ /api/*       → NetworkFirst (live data preferred)
       │                       ├─ /index.html  → NetworkFirst (no stale-shell trap)
       │                       └─ everything   → CacheFirst (with expiry on fonts/images)
       │
       ├──► <Navigation />        (existing auth tabs + HomeScreen)
       │         └─ Screen.tsx uses SafeAreaProvider + useSafeAreaInsets()
       │              for paddingTop / paddingBottom (MOBUI-02)
       │
       └──► <UpdateToast />       (new — bottom-of-screen banner)
                 └─ useServiceWorkerUpdate() hook
                       ├─ listens for navigator.serviceWorker `updatefound` + `controllerchange`
                       └─ on tap: registration.waiting.postMessage({type:'SKIP_WAITING'})
                                  → location.reload()

Backend & infra:  UNCHANGED from Phase 4 — Caddy still serves dist/ + proxies /api/*.
```

The diagram shows that **all Phase 5 work is additive layers on top of an unchanged Phase-4 architecture**. The new SW intercepts requests after they leave React, transparently to the rest of the codebase.

### Recommended Project Structure
```
frontend/
├── public/                        # NEW — Expo SDK 50+ copies this verbatim into dist/
│   ├── index.html                 # NEW — replaces Expo's default template
│   ├── manifest.json              # NEW
│   ├── pwa.css                    # NEW — 16px input override + future web-only CSS
│   ├── offline.html               # NEW — fallback for SW NetworkFirst miss
│   ├── 192.png                    # NEW — manifest icon (general)
│   ├── 512.png                    # NEW — manifest icon (general)
│   ├── 512-maskable.png           # NEW — manifest icon (maskable)
│   └── apple-touch-icon.png       # NEW — 180×180 iOS home-screen icon
├── src/
│   ├── pwa/                       # NEW
│   │   ├── registerSW.ts          # NEW — side-effect SW registration on web only
│   │   └── useServiceWorkerUpdate.ts  # NEW — hook for the update toast
│   ├── components/
│   │   ├── Button.tsx             # MODIFIED — minHeight/minWidth on `small` size
│   │   ├── Screen.tsx             # MODIFIED — SafeAreaView import source swap
│   │   └── UpdateToast.tsx        # NEW — bottom-of-screen update banner
│   ├── screens/
│   │   ├── TransactionFormScreen.tsx  # MODIFIED — add inputMode="decimal" (RN web already maps decimal-pad → inputmode=decimal, but explicit is safer)
│   │   ├── FinanceSourceFormScreen.tsx # MODIFIED — currency-picker row TouchableOpacity min sizes
│   │   └── (Login/Register already have keyboardType=email-address + autoComplete=email — verify nothing more needed)
│   └── (no other changes)
├── App.tsx                        # MODIFIED — wrap with SafeAreaProvider; import '@/pwa/registerSW'; render <UpdateToast />
├── workbox-config.cjs             # NEW — root of frontend/
└── package.json                   # MODIFIED — build:web script gains workbox step (per D-05)
```

### Pattern 1: Workbox generateSW config (D-04 implementation)
**What:** Single `workbox-config.cjs` declares precache globs + runtime caching strategies + lifecycle flags.
**When to use:** Always — this is the entire SW source of truth.
**Example:**
```js
// Source: developer.chrome.com/docs/workbox/modules/workbox-build (verified 2026-05-23)
// frontend/workbox-config.cjs
module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*.{js,css,html,png,svg,jpg,jpeg,webp,woff,woff2,ico,json}'],
  globIgnores: ['**/sw.js', '**/workbox-*.js'],   // never precache the SW itself
  swDest: 'dist/sw.js',
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  navigateFallback: '/offline.html',
  navigateFallbackDenylist: [/^\/api/],            // never serve offline.html for API misses
  dontCacheBustURLsMatching: /\.[0-9a-f]{20,}\./,  // Expo emits 32-hex content-hashes; trust them
  runtimeCaching: [
    {
      urlPattern: ({url}) => url.pathname === '/' || url.pathname === '/index.html',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'app-shell',
        networkTimeoutSeconds: 3,
      },
    },
    {
      urlPattern: /\/api\//,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        networkTimeoutSeconds: 5,
        cacheableResponse: {statuses: [0, 200]},
      },
    },
    {
      urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'fonts',
        expiration: {maxAgeSeconds: 60 * 60 * 24 * 30},  // 30 days
      },
    },
    {
      urlPattern: /\.(?:png|jpe?g|svg|webp|ico)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: {maxAgeSeconds: 60 * 60 * 24 * 30},
      },
    },
  ],
};
```

### Pattern 2: SW registration with update toast (D-07/D-08)
**What:** Web-only `registerSW.ts` module + a React hook fed by `navigator.serviceWorker` events.
**When to use:** Imported as a side-effect from `App.tsx`; the hook is consumed by `<UpdateToast />`.
**Example:**
```ts
// frontend/src/pwa/registerSW.ts
// Source: developer.chrome.com/docs/workbox/modules/workbox-window + MDN ServiceWorkerRegistration (verified 2026-05-23)
import {Platform} from 'react-native';

let waitingWorker: ServiceWorker | null = null;
const listeners = new Set<(waiting: ServiceWorker | null) => void>();

export function subscribeUpdate(cb: (w: ServiceWorker | null) => void) {
  listeners.add(cb);
  cb(waitingWorker);
  return () => listeners.delete(cb);
}

export function applyUpdate() {
  if (!waitingWorker) return;
  waitingWorker.postMessage({type: 'SKIP_WAITING'});
  // controllerchange fires once new SW activates; reload then.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  }, {once: true});
}

if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      const notify = (w: ServiceWorker | null) => {
        waitingWorker = w;
        listeners.forEach((cb) => cb(w));
      };
      if (registration.waiting) notify(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            notify(installing);
          }
        });
      });
    }).catch((err) => {
      // SW registration failed — log but never crash app boot.
      console.warn('[PWA] SW registration failed:', err);
    });
  });
}
```

```ts
// frontend/src/pwa/useServiceWorkerUpdate.ts
import {useEffect, useState} from 'react';
import {subscribeUpdate, applyUpdate} from './registerSW';

export function useServiceWorkerUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => subscribeUpdate((w) => setUpdateAvailable(!!w)), []);
  return {updateAvailable, applyUpdate};
}
```

### Pattern 3: SafeAreaProvider wrapping App
**What:** `useSafeAreaInsets()` returns zeros unless its provider sits above the consuming component.
**When to use:** Every Phase 5 React app must have `SafeAreaProvider` near the root.
**Example:**
```tsx
// frontend/App.tsx — change
// Source: docs.expo.dev/versions/latest/sdk/safe-area-context/ (verified 2026-05-23)
import {SafeAreaProvider} from 'react-native-safe-area-context';
import '@/pwa/registerSW';  // side-effect; no-op on native
import {UpdateToast} from '@/components/UpdateToast';

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppContent />
          <UpdateToast />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
```

### Pattern 4: Touch-target single-point fix
**What:** Add `minHeight: 44, minWidth: 44` to the `small` size style in `Button.tsx`. Every `<Button size="small">` across the app inherits it.
**When to use:** Only place that needs editing for the `<Button>`-based call-sites (TransactionList Edit/Delete, FinanceSourceList Edit/Archive — confirmed in `TransactionsScreen.tsx:160-170`, `FinanceSourcesScreen.tsx:96-105`).
**Non-Button TouchableOpacity sites** still need per-site fixes — see "Component-Level Fix Targets" in CONTEXT canonical_refs and the Touch Target Audit Map below.

### Anti-Patterns to Avoid

- **Hand-written `sw.js`:** Reinvents Workbox precache-with-revision-hash machinery. Predictable stale-shell foot-gun.
- **Maskable + general in one icon (`purpose: "any maskable"`):** Documented bad practice — forces unnecessary padding on the general icon. Ship two separate 512s: one `purpose: "any"`, one `purpose: "maskable"` [CITED: web.dev/articles/maskable-icon].
- **Forgetting `viewport-fit=cover`:** Without it, `env(safe-area-inset-*)` evaluates to zero on iPhones with a notch; safe-area-inset wiring silently does nothing.
- **Forgetting `SafeAreaProvider`:** `useSafeAreaInsets()` returns `{top:0, bottom:0, left:0, right:0}` everywhere without it.
- **`apple-mobile-web-app-capable` AND `mobile-web-app-capable` both on the same page:** Some Apple-developer-forum advice says you must include both for the most-conservative compat. CONTEXT/UI-SPEC only lists `apple-mobile-web-app-capable`; ROADMAP SC-1 names that exact tag. Include both as belt-and-braces — Apple's Safari 17/18 still honors the `apple-` prefixed tag, and `mobile-web-app-capable` is the standardized form some console-warnings expect.
- **Caching `sw.js` itself:** A precached SW is unrecoverable. The `globIgnores: ['**/sw.js', '**/workbox-*.js']` line above must stay.
- **Forgetting `cleanupOutdatedCaches: true`:** Without it, old precache buckets accumulate forever in IndexedDB. Default-off in Workbox; we explicitly enable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service-worker precache + cache-versioning | A `sw.js` with a hand-rolled `CACHE_VERSION` constant | `workbox-cli generateSW` | Workbox emits a hashed precache manifest entry for every file; bumping any file invalidates only that file. Hand-rolled versioning leads to the exact "stale shell" trap PWA-04 forbids. |
| Manifest schema validation | A hand-written JSON.parse + field-presence loop | `@pwabuilder/manifest-validation` (dev-only) | Has the W3C schema rules built in; emits actionable error codes. |
| Safe-area-inset cross-platform polyfill | CSS-only `padding-top: env(safe-area-inset-top)` everywhere | `react-native-safe-area-context` `useSafeAreaInsets()` (already a dep) | Already in tree; works on iOS/Android/Web; emits the right CSS on web automatically. |
| Maskable-icon-aware crop | An ImageMagick / sharp script | Hand-author one PNG with the foreground in the center 80% canvas | Per CONTEXT D-10; one-shot for v2.0. |
| PWA-installability scoring | A bespoke installability checker | A decomposed checklist of (manifest valid + icons present + SW registers + meta tags present) | Lighthouse 12+ removed the PWA category — there is no longer a single composite score to chase. |
| Decimal-keyboard hint on web | `<input inputmode="decimal">` JSX hack | Keep `keyboardType="decimal-pad"` on React-Native `<TextInput>` — react-native-web 0.21 maps it to `inputmode="decimal"` automatically | Confirmed by react-native-web source [CITED: GitHub necolas/react-native-web issue #1575]. The current code already does this in `TransactionFormScreen.tsx:535,628,727`. |
| iOS standalone-mode detection | `window.matchMedia('(display-mode: standalone)')` ad-hoc | Same, but only if Phase 5 actually needs to branch on it (it doesn't — toast renders identically in both modes) | Don't add code we don't need; the only "is standalone" branch we'd want is for an iOS install-banner, which CONTEXT defers. |

**Key insight:** PWA tooling has matured to the point where every load-bearing piece (SW generation, manifest validation, safe-area handling) has a battle-tested library. The phase's only true engineering work is wiring those libraries together. Custom SW code is the single highest-risk thing we could add to this phase.

## Runtime State Inventory

This phase is **net-additive** — no renames, no migrations. The few existing artifacts that could carry stale state are listed below:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB or local-storage rename. `AsyncStorage` keys for auth tokens unchanged. | None |
| Live service config | None — Phase 4 Caddyfile already serves `dist/` at `/`; new files appear automatically. No Caddy edit, no compose change. | None — verify by inspecting `infra/Caddyfile` shows only `file_server` + reverse_proxy `/api/*` |
| OS-registered state | None — no Task Scheduler / launchd / pm2 entries to update | None |
| Secrets/env vars | None — Phase 5 introduces no new env vars (no `EXPO_PUBLIC_SW_ENABLED` flag etc.) | None |
| Build artifacts | **Stale `frontend/dist/` from prior `expo export -p web`** (currently contains `dist/index.html` + one JS chunk). The new `build:web` already does `rm -rf dist` first (D-05), so build artifacts are rebuilt cleanly. **However**: any browser the developer previously opened against the old `dist/` will have a cached `index.html`/JS in its HTTP cache — first build after Phase 5 may need a hard refresh or an Incognito window for verification. | Document in RUNBOOK that first SW-enabled load may need an Incognito session for clean verification. |

**One subtle item:** if a developer's browser has the **pre-Phase-5** `dist/index.html` HTTP-cached, the first post-Phase-5 page load may serve the old shell (no SW registration), which then prevents the new SW from ever installing on that profile. The fix is `Ctrl+Shift+R` (hard reload) or use Incognito. Worth a one-line note in the Phase 5 verify runbook.

## Common Pitfalls

### Pitfall 1: Lighthouse 12+ has no PWA category
**What goes wrong:** `npx lighthouse https://localhost --only-categories=pwa --view` errors out (`pwa` is no longer a valid category) or returns a report with no PWA-section. CONTEXT D-12 mandates this command.
**Why it happens:** Lighthouse 12.0 (April 2024) removed the PWA category in response to Chrome's installability-criteria rework. Lighthouse 13.3.0 is current.
**How to avoid:** Decompose SC-1 into its constituent checks (see Validation Architecture below). Treat Lighthouse 13's `--only-categories=performance,accessibility,best-practices,seo` as an optional sanity audit, NOT a pass/fail gate for PWA-ness.
**Warning signs:** Any "PWA score" string in a verify script.

### Pitfall 2: The custom `public/index.html` must preserve the Expo bootstrap markup
**What goes wrong:** A hand-authored `index.html` that drops the hashed `<script src="/_expo/static/js/web/index-<hash>.js" defer>` or the `<div id="root">` mount point silently breaks the entire web build — page renders blank.
**Why it happens:** Expo's web export bundles into a content-addressed JS chunk and expects `#root` to exist. CONTEXT D-03 calls this out as the single highest-risk part of the phase.
**How to avoid:** Inspect a fresh Expo export first. The current `frontend/dist/index.html` from a prior export (read during this research session, see "Current Expo bootstrap markup" below) shows the exact pattern. **Critical:** the script tag uses a hashed filename that changes on every build — but Expo populates it automatically from `public/index.html` if the file uses the literal markup `<script src="/_expo/static/js/web/<placeholder>" defer></script>` and Expo replaces the placeholder during export. Researcher confirmed: Expo SDK 50+ documentation says "customize public/index.html" and Expo handles script injection — there is no hash placeholder in the documented template; **Expo appends/replaces the `<script src=...>` line during `expo export -p web`** (verified by observation: the prior `dist/index.html` line 35 has the hashed script tag appended right before `</body>`).
**Warning signs:** A blank page on the localhost prod stack; DevTools "Failed to load resource" for `/_expo/static/js/web/*`.

### Pitfall 3: Forgetting `viewport-fit=cover`
**What goes wrong:** Safe-area-inset padding silently does nothing on iPhone notch / Dynamic Island devices. MOBUI-02 silently regresses.
**Why it happens:** Without `viewport-fit=cover`, iOS Safari does not expose the env() insets to CSS; they evaluate to 0.
**How to avoid:** Hard-grep the built `dist/index.html` for the literal string `viewport-fit=cover` as part of verify. Already mandated by SC-1 and PWA-03.
**Warning signs:** On an iPhone with a notch, the bottom nav sits under the home-indicator bar.

### Pitfall 4: The "v1 → v2 → reload once → v2 controls" requirement
**What goes wrong:** Without `skipWaiting()` + `clientsClaim()`, the user gets the old shell for at least one extra full-reload after a deploy. The "update available" toast becomes the user's only escape hatch — if the toast logic is wrong, users are stuck on the old version indefinitely.
**Why it happens:** SW spec default: a new SW stays in `installed` (waiting) state until **all** controlled clients close. Our `applyUpdate()` posts `SKIP_WAITING` to skip the wait; combined with `clientsClaim:true` in generateSW config, the new SW takes over immediately on activation.
**How to avoid:** Verify the flow with a Playwright/Puppeteer script that (a) loads the page, (b) overwrites `dist/sw.js` with a noop variant, (c) reloads, (d) asserts `registration.waiting !== null`, (e) posts `SKIP_WAITING`, (f) waits for `controllerchange`, (g) reloads, (h) asserts the new SW's `clientsClaim` took effect (`navigator.serviceWorker.controller.scriptURL` matches the v2 URL or the v2 SW's runtime cache name is present in `caches.keys()`).
**Warning signs:** Users report "I had to clear cache to see the new feature." If a user ever has to clear cache, this contract is broken.

### Pitfall 5: NetworkFirst + offline + no cached fallback
**What goes wrong:** A user loads the app offline before the SW has ever cached `/index.html` (cold install path). NetworkFirst fails. `navigateFallback: '/offline.html'` saves us — but only if `offline.html` is in the precache list (it is, by virtue of being under `public/`).
**Why it happens:** Workbox's NetworkFirst falls back to cache; if cache is empty (first visit, offline), it falls back to `navigateFallback`; if that file isn't precached, browsers show the dino.
**How to avoid:** Verify `offline.html` is in the emitted precache manifest. Workbox-cli prints the file count; we can also parse `dist/sw.js` and grep for `"offline.html"`.

### Pitfall 6: react-native-web `autoComplete="email"` vs HTML `autocomplete`
**What goes wrong:** Confusing the prop case. React-native `autoComplete="email"` (camelCase) maps to HTML `autocomplete="email"` (lowercase) on web. Both `LoginScreen.tsx:72` and `RegisterScreen.tsx:107` already use the camelCase form correctly.
**How to avoid:** Don't try to "fix" what's already right. Verify via inspection of the rendered DOM (Playwright `await page.locator('input[type=email]').getAttribute('autocomplete')` should be `email`).

### Pitfall 7: Tag chips listed in MOBUI-01 don't actually exist as interactive elements
**What goes wrong:** ROADMAP SC-4 lists "tag chips" as touch targets to audit. Reading the code: tag chips in this codebase are display-only (no `onPress`). UI-SPEC explicitly notes "Tags are display-only (not interactive) in current code — no fix needed unless made tappable."
**How to avoid:** Don't waste planner time creating a "fix tag chip touch targets" task. Document in the plan that tag-chip MOBUI-01 compliance is satisfied by-definition (not interactive).

### Pitfall 8: `body { overflow: hidden }` in Expo's default style
**What goes wrong:** Expo's default `<style id="expo-reset">` includes `body { overflow: hidden }` (see line 17 of current `dist/index.html`). On web in standalone mode this is correct (the ScrollView handles scrolling), but if Phase 5 introduces any direct CSS that assumes the body scrolls, things break.
**How to avoid:** Keep the `<style id="expo-reset">` block intact in the new `public/index.html`. CONTEXT D-02 routes new web-only CSS through a separate `pwa.css` link — exactly right.

## Code Examples

Examples for the highest-risk pieces. All other code follows directly from CONTEXT D-01..D-15.

### `public/index.html` — must preserve Expo bootstrap markup
```html
<!-- frontend/public/index.html -->
<!-- Source: docs.expo.dev/guides/progressive-web-apps + observation of current dist/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Wallet</title>

    <!-- PWA manifest + theme -->
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#0ea5e9" />

    <!-- iOS-specific (PWA-02) -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Wallet" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

    <!-- Expo's required reset (DO NOT EDIT) -->
    <style id="expo-reset">
      html, body { height: 100%; }
      body { overflow: hidden; }
      #root { display: flex; height: 100%; flex: 1; }
    </style>

    <!-- Web-only overrides (MOBUI-03: 16px inputs) -->
    <link rel="stylesheet" href="/pwa.css" />
    <link rel="icon" href="/favicon.ico" />
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
    <!--
      Expo inserts the hashed <script src="/_expo/static/js/web/index-<hash>.js" defer></script>
      tag here during `expo export -p web`. Do NOT hand-author the script tag in this template
      — Expo replaces the body tag's contents with the bootstrap script during export.
    -->
  </body>
</html>
```

> **Critical implementation note for executor:** before merging this template, run `npx expo export -p web` against a throwaway copy of the project to confirm Expo injects the script tag correctly. If Expo does NOT inject (e.g., template gets copied verbatim), the executor must append `<script src="/_expo/static/js/web/_EXPO_BUNDLE_" defer></script>` where Expo's docs document the placeholder. **As of SDK 54, Expo's documented behavior is to use the public/index.html as-is and append the script tag during export** [CITED: docs.expo.dev/guides/publishing-websites/ and observation of current `dist/index.html` showing the hashed script tag was appended right before `</body>` even though Expo's default template had it elsewhere].

### `manifest.json`
```json
{
  "$schema": "https://json.schemastore.org/web-manifest-combined.json",
  "name": "Wallet",
  "short_name": "Wallet",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0ea5e9",
  "background_color": "#ffffff",
  "icons": [
    {"src": "/192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "/512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "/512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
```

### `pwa.css`
```css
/* frontend/public/pwa.css */
/* MOBUI-03: prevent iOS Safari zoom-on-focus by ensuring input font-size >= 16px */
input, select, textarea {
  font-size: 16px !important;
}
```

### `offline.html`
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>You're offline — Wallet</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; background: #f9fafb; color: #1f2937; padding: 32px; text-align: center; }
      h1 { font-size: 24px; margin-bottom: 16px; }
      p  { font-size: 16px; line-height: 1.5; color: #6b7280; }
    </style>
  </head>
  <body>
    <h1>You're offline</h1>
    <p>Check your connection. Your data will load once you're back online.</p>
  </body>
</html>
```

### `Button.tsx` patch (small size)
```diff
   // Sizes
   small: {
     paddingVertical: 8,
     paddingHorizontal: 16,
+    minHeight: 44,
+    minWidth: 44,
   },
```

### `Screen.tsx` SafeAreaView swap
```diff
- import { View, SafeAreaView, ScrollView, ... } from 'react-native';
+ import { View, ScrollView, ... } from 'react-native';
+ import { SafeAreaView } from 'react-native-safe-area-context';
```
(All other code in `Screen.tsx` stays — `react-native-safe-area-context`'s `SafeAreaView` has a near-identical API.)

### `TransactionFormScreen.tsx` amount field — already correct
The amount field already declares `keyboardType="decimal-pad"` (lines 535, 628, 727). On react-native-web 0.21 this maps to `inputmode="decimal"` automatically. **For belt-and-braces and to satisfy MOBUI-04 verbatim**, also add the explicit web prop:
```diff
- keyboardType="decimal-pad"
+ keyboardType="decimal-pad"
+ inputMode="decimal"
```
RN's `inputMode` prop takes precedence over `keyboardType` on web; on native it's a no-op or harmless. Confirmed in react-native-web 0.21+ source [CITED: GitHub necolas/react-native-web issue #1575].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lighthouse PWA category score (≥90) | Decomposed installability checks (manifest valid, SW registers, meta tags present, icons present) | Lighthouse 12.0 — April 2024 | **Affects Phase 5 directly.** CONTEXT D-12's exact command no longer works; verify-script must change. |
| `apple-mobile-web-app-capable` only | Both `apple-mobile-web-app-capable` AND `mobile-web-app-capable` | ~2024 — `mobile-web-app-capable` standardized | Belt-and-braces — both are <100B added to HTML; some console-checks warn if `mobile-web-app-capable` is missing. UI-SPEC only lists `apple-`-prefixed; researcher recommends adding both. |
| `purpose: "any maskable"` (single icon serving both) | Two separate icons: `purpose: "any"` + `purpose: "maskable"` | web.dev guidance, ongoing | UI-SPEC already mandates this; CONTEXT D-10 ships both as separate PNGs. |
| `keyboardType="decimal-pad"` (RN) alone | `keyboardType="decimal-pad"` + explicit `inputMode="decimal"` | react-native-web 0.20+ added `inputMode` prop | Safer for cross-RN-web-version forward compat. |
| `SafeAreaView` from `react-native` | `SafeAreaView` from `react-native-safe-area-context` | RN core deprecated their own | Already a dep in our project; UI-SPEC and CONTEXT mandate the swap. |

**Deprecated/outdated:**
- **Lighthouse PWA category** — gone in v12+; do not target.
- **PWABuilder-CLI** — unmaintained per their own README; use `@pwabuilder/manifest-validation` library directly or the web UI at pwabuilder.com for one-off audits.
- **`expo customize public/index.html`** (Expo CLI subcommand) — documented for SDK <50; in SDK 54 you just create the file under `public/`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Expo SDK 54's `expo export -p web` appends the bootstrap `<script>` tag to a custom `public/index.html` automatically (no placeholder syntax needed). | Code Examples → `public/index.html` | Web build renders blank page. Executor MUST do a smoke test before committing template. Mitigation: CONTEXT already calls this out (D-03) and assigns researcher the responsibility — researcher's recommendation is to run `npx expo export -p web` once with the new template and inspect `dist/index.html` for the appended script tag before declaring the template task done. |
| A2 | `@pwabuilder/manifest-validation` is the right replacement for Lighthouse's removed PWA category. | Validation Architecture | If the package's API differs from documented, verify script breaks. Mitigation: planner adds `checkpoint:human-verify` before install (per Package Legitimacy Audit). |
| A3 | Caddy from Phase 4 will serve `dist/sw.js`, `dist/manifest.json`, and `dist/apple-touch-icon.png` at their respective root paths with correct MIME types automatically (`file_server` directive handles all). | Architecture Patterns / Pitfalls | If a custom MIME-type setup is needed for `.webmanifest`, the manifest won't be picked up. Mitigation: we use `.json` extension on the manifest (Caddy default MIME for `.json` is correct); apple-touch-icon is `.png` (default correct); `sw.js` is `.js` (default correct). Low risk. |
| A4 | `pip install slopcheck` and `npx workbox` will be available in the executor's environment. | Environment Availability | If executor's env lacks pip or npm, install fails. Mitigation: both are in the dev toolchain already (Node 24.14.1 + npm 11.11.0 confirmed during research). |
| A5 | Real-device install verification (MOBUI-05) is deferred to Phase 6 per CONTEXT D-13. | Validation Architecture / Phase Requirements | Phase 5 cannot satisfy MOBUI-05 at verify-time. CONTEXT explicitly accepts this; the requirement is marked "verified later" and Phase 6 inherits the obligation. |
| A6 | The current `frontend/dist/` directory contains a representative `index.html` for understanding bootstrap markup. (It was read during this research; latest commit referenced 04-* phase plans which complete a `build:web`.) | Pitfalls / Code Examples | If the executor's local dist/ is from an older Expo version, the script-tag pattern may differ. Mitigation: executor re-exports once before authoring template. |

## Open Questions

1. **Should the `mobile-web-app-capable` meta tag be added even though UI-SPEC only names the `apple-` variant?**
   - What we know: `mobile-web-app-capable` is the standardized, non-Apple-specific form; some installability checkers prefer it; cost is one HTML line.
   - What's unclear: Whether UI-SPEC's omission was deliberate (the field was simply forgotten when transcribed from the ROADMAP) or whether UI-SPEC means "exactly these tags and no others."
   - Recommendation: Add both. The UI-SPEC contract is about visual/interaction surface, not exhaustive HTML; this is additive and cannot regress anything UI-SPEC locks. Flag in plan-check for human confirmation if discuss-phase wants stricter UI-SPEC alignment.

2. **Should `workbox-window` be a dependency, or is the hand-rolled `registerSW.ts` enough?**
   - What we know: `workbox-window` (`^7.4.1`) wraps the manual `navigator.serviceWorker` event-listener dance with a friendlier API and built-in MessageChannel reply support.
   - What's unclear: Whether the small SW update logic in Pattern 2 above is robust enough or whether we want workbox-window's `Workbox.messageSW()` reply pattern.
   - Recommendation: Skip `workbox-window` for v2.0. Our SW update flow is ~30 lines of plain code; adding a 30KB dep for syntactic sugar isn't worth it. Revisit if the toast UX gets more complex.

3. **Does Phase 4's Caddyfile need any change to handle `/sw.js` correctly?**
   - What we know: Caddy's `file_server` serves `.js` files with `Content-Type: application/javascript; charset=utf-8` by default. This is correct for SW.
   - What's unclear: Whether the SW needs explicit `Service-Worker-Allowed: /` response headers (only needed if the SW lives at a path other than the root, which it doesn't — it's at `/sw.js`).
   - Recommendation: No Caddyfile change needed. Verify in the smoke script with `curl -sI https://localhost/sw.js | grep -i content-type`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm scripts, `expo export`, `workbox generateSW`, verification script | ✓ | v24.14.1 | — |
| npm | Package installs | ✓ | 11.11.0 | — |
| `npx` | Running workbox-cli + lighthouse on-demand | ✓ | bundled with npm | — |
| Docker + docker-compose | Bringing up Phase 4 prod stack for verification | (assumed) | per Phase 4 | — |
| Google Chrome / Chromium | Lighthouse CLI requires a headless Chrome binary | **✗ (NOT FOUND in WSL during research)** | — | Lighthouse 13 can use `--chrome-flags="--headless"` if Chrome is present; **without it, Lighthouse cannot run** |
| `slopcheck` (Python) | Package legitimacy gate | ✓ (installed during research) | 0.6.1 | — |
| `@pwabuilder/manifest-validation` | Replacement for Lighthouse PWA category | not yet installed | — | Use `ajv` + manual JSON-schema validation as fallback; or run pwabuilder.com web UI manually one-off |
| iPhone Safari + Android Chrome | MOBUI-05 real-device install verification | n/a (deferred to Phase 6 per CONTEXT D-13) | — | n/a |

**Missing dependencies with no fallback:**
- **Headless Chrome / Chromium** — required for any Lighthouse run. Executor needs to either (a) install `chromium` via apt (`sudo apt install chromium-browser`), (b) install `puppeteer` which bundles Chromium, or (c) skip the optional Lighthouse perf-audit and rely on the decomposed installability checks (Validation Architecture below). Recommendation: install Chromium via puppeteer OR skip Lighthouse. **For the Phase 5 verify gate, Lighthouse is no longer required** because Lighthouse 12+ removed the PWA category — the decomposed checks are the spec-correct replacement.

**Missing dependencies with fallback:**
- `@pwabuilder/manifest-validation` — fallback is hand-written field-presence checks against `manifest.json`, which is fine for our small manifest.

## Validation Architecture

> Workflow `nyquist_validation: true` confirmed in `.planning/config.json`. This section is REQUIRED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.3.0 + `babel-jest` (config: `frontend/jest.config.js`) — `testEnvironment: 'node'` (static-only tests; no React-Native runtime) |
| Config file | `frontend/jest.config.js` |
| Quick run command | `cd frontend && npm test -- --testPathPattern=<spec>` |
| Full suite command | `cd frontend && npm test` |
| Supplementary tools | `node` script for static dist/* checks; `curl` for served-asset MIME checks; optional `npx puppeteer` for SW smoke test |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PWA-01 | `dist/manifest.json` validates against W3C manifest schema; has `name`, `short_name`, `start_url=/`, `display=standalone`, `theme_color`, `background_color`, ≥1 icon 192, ≥1 icon 512, ≥1 icon `purpose=maskable` | static + schema | `node frontend/scripts/verify-pwa.mjs --check=manifest` (uses `@pwabuilder/manifest-validation` or ajv) | ❌ Wave 0 — script to be created |
| PWA-02 | `dist/index.html` contains all required apple-touch / apple-mobile-web-app-* meta tags AND `dist/apple-touch-icon.png` is a 180×180 PNG | static (grep + file-size + magic-bytes) | `node frontend/scripts/verify-pwa.mjs --check=apple-meta` | ❌ Wave 0 |
| PWA-03 | `dist/index.html` viewport meta includes `viewport-fit=cover` | static (regex) | `node frontend/scripts/verify-pwa.mjs --check=viewport` | ❌ Wave 0 |
| PWA-04 | `dist/sw.js` exists, parses as JS, contains references to NetworkFirst + CacheFirst + skipWaiting + clientsClaim + the `/api/` and `/index.html` URL patterns | static (parse + grep) | `node frontend/scripts/verify-pwa.mjs --check=sw` | ❌ Wave 0 |
| PWA-04 (runtime) | "v1 → v2 → reload once → v2 controls" — programmatic verification | integration (Puppeteer) | `node frontend/scripts/verify-sw-update.mjs` (boots prod compose, navigates page, replaces sw.js with v2, asserts controllerchange fires within 5s of SKIP_WAITING) | ❌ Wave 0 — optional but recommended |
| MOBUI-01 | `Button` `size="small"` style declares `minHeight: 44, minWidth: 44` | unit (RTL-style static-test against the StyleSheet object) | `npm test -- Button.test.ts` | ❌ Wave 0 — new spec |
| MOBUI-01 | Currency-picker row `TouchableOpacity` styles in `FinanceSourceFormScreen.tsx` + `TransactionFormScreen.tsx` declare `minHeight: 44` | static (regex over source) | `node frontend/scripts/verify-touch-targets.mjs` | ❌ Wave 0 |
| MOBUI-02 | `Screen.tsx` imports `SafeAreaView` from `react-native-safe-area-context`; `App.tsx` wraps with `SafeAreaProvider` | static (regex over source) | `grep -F "react-native-safe-area-context" frontend/src/components/Screen.tsx frontend/App.tsx` (each must match) | already-runnable; assert in script |
| MOBUI-03 | `dist/pwa.css` contains the `input, select, textarea { font-size: 16px !important; }` rule | static (grep) | `grep -F "font-size: 16px" frontend/dist/pwa.css` | ❌ Wave 0 |
| MOBUI-04 | `TransactionFormScreen.tsx` amount field has both `keyboardType="decimal-pad"` and `inputMode="decimal"` | static (regex) | `node frontend/scripts/verify-touch-targets.mjs` (extend to cover input modes too) | ❌ Wave 0 |
| MOBUI-04 | `LoginScreen.tsx` + `RegisterScreen.tsx` email inputs have `keyboardType="email-address"` AND `autoComplete="email"` | static (regex) | same script | already partially compliant; verify maps to web correctly |
| MOBUI-05 | PWA installs on real iPhone Safari + real Android Chrome | manual (device test) | **deferred to Phase 6 per CONTEXT D-13** — Phase 5 verify does NOT gate on this | n/a |

### Sampling Rate
- **Per task commit:** Re-run the static checks affected by the task. E.g., a touch-target task re-runs `node frontend/scripts/verify-touch-targets.mjs`; a manifest task re-runs the manifest-validation script.
- **Per wave merge:** `npm run build:web && node frontend/scripts/verify-pwa.mjs --all`. (Single command that runs the full battery of PWA-01..04 + MOBUI-01..04 static checks against a fresh `dist/`.)
- **Phase gate:** Full battery green + Phase 4 smoke.sh still passes (no regression) + one manual Incognito-Chrome install attempt against `https://localhost` (developer's laptop) before invoking `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `frontend/scripts/verify-pwa.mjs` — new — drives manifest-validation, meta-tag-grep, sw.js parse-check, pwa.css check. Single CLI with `--check=<name>` and `--all` switches.
- [ ] `frontend/scripts/verify-touch-targets.mjs` — new — greps source files for the required style declarations (`minHeight: 44`, `inputMode="decimal"`, etc.).
- [ ] `frontend/scripts/verify-sw-update.mjs` — new, OPTIONAL — Puppeteer-based "v1 → v2 → reload" smoke. Skip if Chromium not available; manual DevTools demo suffices for v2.0.
- [ ] `frontend/__tests__/Button.test.ts` — new — assert `Button` `small` style object has `minHeight === 44 && minWidth === 44`. Jest config supports this (existing tests are all static-only).
- [ ] `frontend/__tests__/manifest.test.ts` — new, OPTIONAL — wrap the `verify-pwa.mjs` schema check as a Jest test so it runs in the existing suite.
- [ ] Install `@pwabuilder/manifest-validation` as devDependency (pending checkpoint:human-verify per Package Legitimacy Audit).

## Security Domain

Security enforcement is enabled by default. PWA-specific security surfaces:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no — Phase 5 does not touch auth flow | n/a (auth was Phase 1–3) |
| V3 Session Management | no — JWT in AsyncStorage unchanged | n/a |
| V4 Access Control | no | n/a |
| V5 Input Validation | partial — adding HTML `inputmode` + `autocomplete` is UX, not security; existing react-hook-form + zod validation continues to enforce inputs server-side and client-side | Existing zod schemas in `frontend/src/screens/*FormScreen.tsx` |
| V6 Cryptography | no | n/a |
| V11 Business Logic / V12 File / V13 API | no | n/a |
| V14 Configuration | yes — service worker is a new same-origin code path; misconfigured caching could return another user's data | Workbox cacheableResponse plugin restricts to status 0/200; api-cache will be invalidated per-user implicitly because JWT identifies the user server-side (no user-id in cache key needed). |

### Known Threat Patterns for PWA / SW stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale-shell trap (user stuck on old client-side code that doesn't know about a server-side breaking change) | Tampering (data freshness) | NetworkFirst on `/index.html` + `skipWaiting` + `clientsClaim` + "Update available" toast — explicitly mandated by PWA-04 |
| Service worker serving cached `/api/` response to a different logged-in user (cache key not user-scoped) | Information Disclosure | Use NetworkFirst on `/api/*` (already mandated) — falls back to cache only when network unreachable; on successful network response cache is updated with the current user's JWT-authenticated response. **Risk remains** on a shared device: if user A logs out and user B logs in while offline, user B could see user A's cached `/api/me` etc. **Mitigation:** add a logout step that calls `caches.delete('api-cache')` from registerSW.ts (export `clearApiCache()` helper). NOT mandated by phase scope but worth flagging in plan. |
| Service worker hijack (a malicious SW served from the same origin) | Tampering / Spoofing | Only served via HTTPS (Caddy enforces TLS); `sw.js` lives at root; Caddy file_server cannot be tricked into serving from another path |
| Reflected XSS via manifest fields | Tampering | `manifest.json` is a static file authored by us — no untrusted input |
| Apple-touch-icon spoofing | Spoofing | Static asset, no risk |
| Cache poisoning via long-lived CacheFirst on JS chunks | Tampering | Workbox uses revisioned URLs (content-hashed filenames from Expo) — a poisoned chunk would have to match a hash, which is infeasible. `cleanupOutdatedCaches: true` removes stale buckets. |

**Recommended:** Add a future ticket (not Phase 5 scope, but document in Deferred Ideas) to call `caches.delete('api-cache')` on logout to prevent cross-user cache leakage on shared devices.

## Sources

### Primary (HIGH confidence)
- [Workbox: workbox-build / generateSW reference](https://developer.chrome.com/docs/workbox/modules/workbox-build) — generateSW config options, runtimeCaching shape, navigateFallback semantics.
- [Workbox: workbox-cli reference](https://developer.chrome.com/docs/workbox/modules/workbox-cli) — CLI invocation pattern.
- [Workbox: workbox-window reference](https://developer.chrome.com/docs/workbox/modules/workbox-window) — Workbox class + messageSW pattern (informed our hand-rolled equivalent).
- [Expo docs: Progressive Web Apps](https://docs.expo.dev/guides/progressive-web-apps/) — `public/index.html` + `public/manifest.json` placement for SDK 50+.
- [Expo docs: Publish websites](https://docs.expo.dev/guides/publishing-websites/) — default `web.output: "single"` mode and how `public/` is copied to `dist/`.
- [MDN: ServiceWorkerGlobalScope.skipWaiting()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting) — skipWaiting + clientsClaim semantics.
- [web.dev: Adaptive icon support in PWAs with maskable icons](https://web.dev/articles/maskable-icon) — center-80% safe zone; separate icons for `purpose: any` vs `purpose: maskable`.
- [Lighthouse changelog v12.0 + GitHub issue #15535](https://github.com/GoogleChrome/lighthouse/issues/15535) — PWA category removal (critical for SC-1 verification).
- [Chrome blog: Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria) — replacement guidance (DevTools Application panel + installability flag checks).
- [react-native-safe-area-context (Expo docs)](https://docs.expo.dev/versions/latest/sdk/safe-area-context/) — useSafeAreaInsets web behavior; emits `env(safe-area-inset-*)` CSS.
- npm registry direct verification (run during this research session 2026-05-23):
  - `npm view workbox-cli version` → `7.4.1` (published 2026-05-04)
  - `npm view lighthouse version` → `13.3.0` (published 2026-05-07)
  - `npm view workbox-cli scripts.postinstall` → empty
- slopcheck v0.6.1 npm scan (run 2026-05-23): `workbox-cli` [OK], `lighthouse` [OK].

### Secondary (MEDIUM confidence)
- [GitHub necolas/react-native-web issue #1575](https://github.com/necolas/react-native-web/issues/1575) — `inputMode` prop maps; `decimal-pad` keyboardType auto-maps on web.
- [firt.dev: iOS PWA Compatibility](https://firt.dev/notes/pwa-ios/) — long-running authoritative iOS PWA blog; last updated 2023, so apple-mobile-web-app-capable guidance treated as still-current but flagged as MEDIUM confidence for the deprecation question.
- [Workbox GitHub issue #1120: Recommended Approach for Refreshing Page on new SW](https://github.com/GoogleChrome/workbox/issues/1120) — the SKIP_WAITING + controllerchange + reload dance our `registerSW.ts` implements.
- [Workbox issue #2199 (redundant event)](https://github.com/GoogleChrome/workbox/issues/2199) — edge case in SW state transitions; informed the `installing.state === 'installed'` check.

### Tertiary (LOW confidence)
- General PWA testing checklists from mobileviewer.github.io and blog.pixelfreestudio.com — informed broader awareness but no claims rely on them solely.
- DEV.to article "Flawless and Silent Upgrade of the Service Worker" — confirms the SKIP_WAITING pattern is widely-used; we already have primary sources for the same.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — workbox-cli + safe-area-context are both Google/Apple-and-Flow standards; versions npm-verified this session; slopcheck OK.
- Architecture: HIGH — all decisions in CONTEXT D-01..D-15 verified against Expo docs and React-Native-Web behavior; the additive-layer model is straightforward.
- Bootstrap markup (Pitfall 2 / A1): MEDIUM — Expo's documented behavior is consistent with the observed `dist/index.html`, but no executor has yet authored `public/index.html` against SDK 54 in this codebase. Researcher recommends a one-time smoke test by the executor before the template task is declared done.
- iOS meta tags: HIGH for content; MEDIUM for "do you need both `apple-mobile-web-app-capable` AND `mobile-web-app-capable`" — recommendation is "yes, add both" with rationale.
- Lighthouse PWA-score deprecation: HIGH — Lighthouse 12 changelog + GitHub issue #15535 are primary sources. **This finding materially changes the SC-1 verification path and should be surfaced loudly in plan-phase.**
- Touch-target audit: HIGH — code paths confirmed by direct inspection (`grep "size=\"small\""`, ProfileScreen back button, FinanceSourceFormScreen currency picker, TransactionsScreen Edit/Delete pair).
- Pitfalls: HIGH — Pitfalls 1, 2, 4, 5 all backed by primary Workbox/Lighthouse/Expo sources.

**Research date:** 2026-05-23
**Valid until:** ~2026-06-23 (30 days) for the stable parts (Expo SDK 54, workbox-cli 7.x, manifest schema). The Lighthouse PWA-category status is unlikely to reverse — that finding remains valid indefinitely.
