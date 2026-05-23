# Phase 5: PWA-ify Frontend + Mobile Polish - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Transform the existing Expo-web build into a real PWA that installs to the home screen on iOS Safari and Android Chrome, feels native in standalone mode, and is touch-friendly on phone screens. All visual + interaction decisions (manifest fields, colors, typography, touch-target rules, SW caching strategy, copywriting) are already locked in `05-UI-SPEC.md` — this phase decides **how** to wire them into the Expo-web export pipeline.

**In scope:** PWA manifest + icons under `frontend/public/`; full custom `public/index.html` template (replaces Expo default) with apple-touch meta tags, viewport-fit=cover, manifest link; Workbox-generated service worker with PWA-04 caching strategy; React-side SW registration + "Update available" toast; touch-target fixes in `Button.tsx` and ad-hoc TouchableOpacity sites; safe-area inset wiring via `useSafeAreaInsets()`; input-mode + autocomplete attributes; global 16px input CSS for iOS zoom prevention; offline.html fallback.

**Out of scope (other phases):**
- Public domain + Let's Encrypt cert (Phase 6) — Lighthouse runs locally against the Phase 4 Caddy `tls internal` stack
- Real-device Add-to-Home-Screen verification on iPhone Safari + Android Chrome (deferred to Phase 6 once a real HTTPS public URL exists)
- Web Push notifications (deferred per REQUIREMENTS.md "Out of Scope")
- Offline-first writes / IndexedDB queue / background sync (deferred to dedicated milestone)
- Custom Install banner with iOS instructions (deferred to "polish" follow-up)
- Maskable + monochrome icons beyond the single maskable required by PWA-01 (deferred polish)

</domain>

<decisions>
## Implementation Decisions

### Head/Meta + Manifest Injection

- **D-01:** Use the `public/` directory pattern. Author a full `frontend/public/index.html` (replaces Expo's default template) containing the React-Native-Web mount point, the PWA manifest link, all `apple-mobile-web-app-*` meta tags, `viewport-fit=cover`, `theme-color`, and the `<link rel="apple-touch-icon">`. Drop `manifest.json`, icons, and `offline.html` next to it. Expo SDK 50+ copies the `public/` tree verbatim into `dist/` at `expo export -p web` time — zero build-script work, fully declarative, version-controlled.
- **D-02:** Web-only CSS overrides (the MOBUI-03 `input,select,textarea { font-size: 16px !important }` rule and any future web-only styling) live in a separate `frontend/public/pwa.css` linked from `public/index.html`. Future-proofs for additional web-only rules.
- **D-03:** Because we replace Expo's default `index.html`, the new template MUST keep whatever script-tag pattern Expo uses to bootstrap the React-Native-Web bundle (the hashed JS chunk filename + the `#root` mount point). Researcher must inspect a fresh `expo export -p web` output to identify the exact bootstrap markup before authoring the template — getting this wrong silently breaks the entire web build.

### Service Worker Tooling

- **D-04:** Use `workbox-cli generateSW` against `dist/` as a post-step in the existing `frontend/package.json` `build:web` script. New `frontend/workbox-config.cjs` declares globs (`**/*.{js,css,html,png,svg,woff2}`), `swDest: 'dist/sw.js'`, and `runtimeCaching` rules implementing the PWA-04 strategy from UI-SPEC: NetworkFirst for `/index.html` and `/api/*`; CacheFirst (with expiry on fonts/images) for everything else; `skipWaiting: true`, `clientsClaim: true`. Generated SW carries the hashed precache manifest of every emitted asset — eliminates the stale-shell trap by construction.
- **D-05:** Updated `build:web` script ordering (atomic — single command line, no intermediate state to forget): `rm -rf dist && cp src/constants/config.prod.ts src/constants/config.ts && expo export -p web && npx workbox generateSW workbox-config.cjs && cp src/constants/config.dev.ts src/constants/config.ts`. Workbox runs **after** the export so it sees the final hashed chunks. The existing config-swap pattern from Phase 4 (D-03..D-06) is preserved.
- **D-06:** Add `workbox-cli` as a `devDependency` only — no Workbox runtime imports in app code; everything Workbox-related is generated.

### SW Registration + Update UX

- **D-07:** New `frontend/src/pwa/registerSW.ts` registers `/sw.js` on `window.addEventListener('load', ...)`. The module exposes a `useServiceWorkerUpdate()` hook returning `{ updateAvailable: boolean, applyUpdate: () => void }`. `applyUpdate()` posts `{ type: 'SKIP_WAITING' }` to `registration.waiting` then calls `window.location.reload()`. The module is a no-op on native (guarded by `Platform.OS === 'web'` and the `'serviceWorker' in navigator` check), so importing it from `App.tsx` is safe across platforms.
- **D-08:** New `frontend/src/components/UpdateToast.tsx` (React-Native-Web component) consumes `useServiceWorkerUpdate()` and renders the bottom-of-screen toast using the UI-SPEC copywriting contract: heading "Update available", button label "Reload App". Styling uses the existing color tokens (accent `#0ea5e9` for the Reload button). Mounted once at the App.tsx root, alongside the existing navigation tree.
- **D-09:** Registration code path: import side-effect `import '@/pwa/registerSW'` in `App.tsx` near the top; the import triggers registration on web only. The toast is rendered as a sibling of `<Navigation />` in App.tsx so it overlays all screens.

### Icon Generation

- **D-10:** Hand-author the 4 required PNGs once and commit them under `frontend/public/`: `192.png`, `512.png`, `512-maskable.png` (foreground content within the center 80% safe zone), `apple-touch-icon.png` (180×180). No icon-generation script, no `pwa-asset-generator` dep, no `sharp` script. Acceptable because UI-SPEC locks the icon design and v2.0 ships once.
- **D-11:** Icon design reuses the existing `frontend/assets/adaptive-icon.png` foreground composited on a solid `#0ea5e9` background, per UI-SPEC "Icon design direction" section.

### Lighthouse + Device Verification

- **D-12:** Lighthouse PWA audit (ROADMAP SC-1, ≥90 target) runs **locally** in Phase 5 against the Phase 4 Caddy compose stack at `https://localhost`. Verification runbook entry: `docker compose -f infra/docker-compose.prod.yml up -d`, then `npx lighthouse https://localhost --only-categories=pwa --chrome-flags="--ignore-certificate-errors" --view`. The self-signed `tls internal` cert may cost a small score delta vs a real LE cert — if the local score lands in the 85–90 band, document the delta and re-verify in Phase 6 against the real domain rather than chasing the local number.

  > **Superseded by:** Lighthouse 12.0 (released 2024-05) removed the dedicated PWA category — the `--only-categories=pwa` flag in D-12 no longer produces a PWA score. See `05-RESEARCH.md § Pitfalls § Pitfall 1` (Lighthouse v12.0 changelog + GoogleChrome/lighthouse issue #15535) for the upstream change and rationale. Phase 5 substitutes a decomposed verification: `frontend/scripts/verify-pwa.mjs --all` (manifest + apple-meta + viewport + sw + ios-zoom static checks) + a manual Incognito install smoke recorded in `05-07-SUMMARY.md`. D-12's original text is preserved above for traceability; it is locked-and-annotated, not rewritten.

- **D-13:** Real-device install verification (ROADMAP SC-2: iPhone Safari + Android Chrome) is **deferred to Phase 6's verification**. Rationale: LAN-IP + self-signed cert trust on mobile devices is brittle and not representative of the actual install path users will hit. Once Phase 6 has the public `https://<domain>` working with a real LE cert, Add-to-Home-Screen is testable in the canonical environment. Phase 5 verify gates only on Lighthouse + the static checks below.
- **D-14:** Static verification checks for Phase 5 (deterministic, runnable in CI later): (a) `node -e "JSON.parse(require('fs').readFileSync('frontend/dist/manifest.json'))"` plus a JSON-schema validation against the W3C PWA manifest schema; (b) `grep` over `frontend/dist/index.html` for every required apple/viewport/theme-color meta tag; (c) presence + parse-ability of `frontend/dist/sw.js`; (d) jest/RTL component tests asserting `Button` `size="small"` produces a node with `minHeight: 44` and `minWidth: 44`.

### Touch-Target Scope

- **D-15:** Touch-target enforcement is the **Button.tsx single-point fix** from UI-SPEC PLUS a targeted spot-fix of the named non-Button offenders. Specifically: add `minHeight: 44, minWidth: 44` to the `small` size style in `Button.tsx`; then audit and fix the `TouchableOpacity` instances called out in UI-SPEC Touch Target Enforcement Contract (currency picker rows, modal close buttons when introduced, navigation back buttons). Not a full grep audit of every TouchableOpacity in the codebase — UI-SPEC names the touch-critical sites; trust that list.

### Claude's Discretion

- File naming under `frontend/public/` and `frontend/src/pwa/` is researcher/planner's call provided D-01..D-09 invariants hold.
- Exact Workbox `runtimeCaching` glob patterns (especially around font subdirectories Expo emits) are researcher's call so long as the strategy in UI-SPEC "Service Worker Caching Contract" is preserved end-to-end.
- Whether to add a small inline `<noscript>` fallback in `public/index.html` is the executor's call — not load-bearing for any success criterion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 Locked Contracts
- `.planning/phases/05-pwa-ify-frontend-mobile-polish/05-UI-SPEC.md` — Visual + interaction contract. Locks manifest fields, color roles, typography scale, touch-target rules, SW caching strategy, copywriting, iOS meta tags. **Every implementation decision in this phase derives from or aligns with this file.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 5: PWA-ify Frontend + Mobile Polish" — 5 ROADMAP success criteria are the definition of done.
- `.planning/REQUIREMENTS.md` §"PWA Basics (PWA)" — PWA-01..04 (manifest, iOS meta, viewport, Workbox SW).
- `.planning/REQUIREMENTS.md` §"Mobile-Responsive Verification (MOBUI)" — MOBUI-01..05 (touch targets, safe-area, 16px font, input modes, real-device install).
- `.planning/REQUIREMENTS.md` §"Out of Scope (deferred)" — explicitly punts Web Push, offline writes, install banner, monochrome icons.

### Prior-Phase Context Still Relevant
- `.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md` §"Frontend API URL Strategy" (D-03..D-06) — the `build:web` script's config-swap pattern that we extend in D-05.
- `.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md` §"Caddy + Local-Laptop TLS" (D-10) — explains the `tls internal` self-signed cert that D-12 relies on for local Lighthouse.

### Codebase Maps (read selectively)
- `.planning/codebase/STACK.md` — confirms Expo SDK 54, Metro web bundler, React Native 0.81, NativeWind 4, react-native-safe-area-context already a dep.
- `.planning/codebase/ARCHITECTURE.md` — frontend component + screen layout for touch-target audit targeting.

### Source Files Researcher Must Inspect Before Authoring `public/index.html`
- A fresh `expo export -p web` output (`frontend/dist/index.html`) — identify the exact React-Native-Web bootstrap markup (hashed JS chunk + mount point) that any custom template must preserve. This is the single highest-risk part of D-01/D-03.
- `frontend/app.json` `expo.web` block — verify nothing in the existing config conflicts with a custom `public/index.html`.
- `frontend/src/constants/config.dev.ts` / `config.prod.ts` — confirm the Phase 4 config-swap pattern still works inside the new `build:web` script ordering from D-05.

### Component-Level Fix Targets
- `frontend/src/components/Button.tsx` — single-point touch-target fix (D-15).
- `frontend/src/components/Input.tsx` — already has `fontSize: 16`; confirm web build picks it up (UI-SPEC §Typography).
- `frontend/src/components/Screen.tsx` — `SafeAreaView` swap from `react-native` to `react-native-safe-area-context` (UI-SPEC §Safe Area).
- `frontend/src/components/Navigation.tsx` — confirm the existing top-of-screen auth tabs are 48px-compliant per UI-SPEC's "Already compliant" note.
- `frontend/src/screens/TransactionFormScreen.tsx` — add `inputMode="decimal"` to amount field (MOBUI-04).
- `frontend/src/screens/LoginScreen.tsx`, `RegisterScreen.tsx` — add `type="email"` + `autoComplete="email"` to email fields (MOBUI-04).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `react-native-safe-area-context` (already a dep): `useSafeAreaInsets()` and its `SafeAreaView` are the canonical implementations for MOBUI-02 — no new dep needed.
- `frontend/assets/adaptive-icon.png`: existing Android adaptive-icon foreground — reused as the visual source for the new PWA icons (D-11).
- Existing `build:web` script (`frontend/package.json`) with the config-swap idiom from Phase 4 — D-05 extends it cleanly by appending the workbox step before the dev-config restore.
- `frontend/src/components/Input.tsx` already declares `fontSize: 16` — D-02 only adds the global CSS override for non-Input native inputs on web.

### Established Patterns
- Expo's web export uses Metro, not Vite/Webpack — eliminates `vite-plugin-pwa` / `workbox-webpack-plugin` from consideration and is why D-04 uses `workbox-cli` post-build.
- Phase 4 decisions (D-12 in 04-CONTEXT.md) bind-mount `frontend/dist/` read-only into Caddy at `/srv` — so the SW + manifest + icons + apple-touch-icon end up served at correct paths (`/sw.js`, `/manifest.json`, `/apple-touch-icon.png`) automatically with no Caddy changes.
- Phase 4's Caddyfile already serves `try_files {path} /index.html` — works correctly with the SW's NetworkFirst-on-`/index.html` strategy (no Caddy rewrite needed).

### Integration Points
- `App.tsx`: side-effect import `import '@/pwa/registerSW'` + sibling `<UpdateToast />` mounted alongside `<Navigation />`.
- `frontend/package.json` `build:web` script: append `workbox generateSW` between `expo export -p web` and the dev-config restore.
- `frontend/public/` (new directory): index.html, manifest.json, pwa.css, sw-source-not-applicable (generated), icons, offline.html, apple-touch-icon.png.
- `frontend/src/components/Screen.tsx`: swap `SafeAreaView` import source.

</code_context>

<specifics>
## Specific Ideas

- The `build:web` script must be **a single atomic line** (D-05) because intermediate state from a failed config-swap is the most likely silent footgun (Phase 4 already lived through this once with the config swap; do not re-litigate that pattern).
- The custom `public/index.html` is the highest-risk file in the phase — researcher MUST inspect a real Expo-web export and document the bootstrap markup before the planner writes any task to author the template.
- "Update available" toast must reuse UI-SPEC color tokens — no new colors, no separate styling system.

</specifics>

<deferred>
## Deferred Ideas

- **Lighthouse + real-device verification against real public domain** — deferred to Phase 6 verify (D-12, D-13). Captured here so Phase 6 planning knows it inherits SC-1 (re-verify against real LE cert) and SC-2 (real iPhone Safari + Android Chrome Add-to-Home-Screen) from Phase 5.
- **Lighthouse-CI as a CI gate** — natural fit for Phase 7 (CI-01..03) once GitHub Actions exist. Not in scope here.
- **Custom modal for destructive confirmations** — UI-SPEC accepts `window.confirm()`/`window.alert()` as acceptable for v2.0; deferred to a polish follow-up. Captured in UI-SPEC already.
- **Custom Install banner with iOS instructions** — already deferred in REQUIREMENTS.md "Future Requirements"; restated here so no Phase 5 plan accidentally adds it.
- **Web Push, offline-first writes, monochrome icons** — already deferred in REQUIREMENTS.md "Out of Scope".
- **Full grep audit of every `TouchableOpacity` for touch-target compliance** — explicitly out per D-15. If a stray non-compliant tap target is discovered post-ship, fold into a polish phase.

</deferred>

---

*Phase: 05-pwa-ify-frontend-mobile-polish*
*Context gathered: 2026-05-23*
