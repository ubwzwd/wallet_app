# Phase 5: PWA-ify Frontend + Mobile Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 05-pwa-ify-frontend-mobile-polish
**Areas discussed:** Head/meta + manifest injection, Service worker tooling + registration, Icon generation pipeline, Lighthouse + device verification

---

## Head/Meta + Manifest Injection

| Option | Description | Selected |
|--------|-------------|----------|
| public/ directory pattern | Author `frontend/public/index.html` + `manifest.json` + icons; Expo SDK 50+ copies the entire `public/` tree into `dist/` at export time. Zero build script, fully declarative. | ✓ |
| Post-build patch script | Node script runs after `expo export -p web`, opens `dist/index.html`, injects meta tags via cheerio/regex. Risk: Expo updates template, regex drifts silently. | |
| Expo config plugin | Custom `withPwaHead` plugin registered in `app.json`; hooks the web export and modifies generated HTML programmatically. Most idiomatic, heaviest setup. | |

**User's choice:** public/ directory pattern
**Notes:** Declarative wins. The custom `public/index.html` fully replaces Expo's default template, so researcher must inspect a real `expo export` output to capture the React-Native-Web bootstrap markup before authoring the template — that's the single highest-risk part of the approach.

---

### Sub-question — Where does the web-only CSS override live?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline `<style>` in index.html | Single ~3-line block in `<head>`; no extra file, no extra request. | |
| Separate public/pwa.css | Drop a `public/pwa.css` and link it from index.html. Future-proofs for additional web-only rules. | ✓ |

**User's choice:** Separate public/pwa.css
**Notes:** Preference for keeping CSS in a dedicated file even though the current ruleset is tiny.

---

## Service Worker Tooling

| Option | Description | Selected |
|--------|-------------|----------|
| workbox-cli generateSW | Declarative `workbox-config.cjs`; runs as a post-step in `build:web`; emits `dist/sw.js` with hashed precache manifest + runtime caching rules per PWA-04. | ✓ |
| Hand-rolled sw.js + workbox-sw CDN | Author SW manually; load Workbox via `importScripts` from CDN. Simpler conceptually but no auto-generated precache manifest → stale-shell trap risk. | |
| workbox-cli injectManifest | Maintain `src/sw.ts` as the SW source; workbox-cli rewrites the precache placeholder at build time. Best for custom SW logic, overkill here. | |

**User's choice:** workbox-cli generateSW
**Notes:** PWA-04's strategy fits entirely inside `generateSW` config — no custom SW logic needed. Cache-busting is correct by construction.

---

### Sub-question — Where does SW registration + the update toast live?

| Option | Description | Selected |
|--------|-------------|----------|
| React module + global toast | `src/pwa/registerSW.ts` exposes `useServiceWorkerUpdate()` hook; new `UpdateToast.tsx` (RN-web component) mounted at App.tsx root. Single styling system, reuses UI-SPEC color tokens. | ✓ |
| Inline script + DOM-rendered toast | Register SW in `<script>` in `public/index.html`; render toast as vanilla DOM div. Bypasses React but duplicates styling system. | |

**User's choice:** React module + global toast
**Notes:** Keeps a single styling/color system. Toast must reuse UI-SPEC accent color `#0ea5e9` for the "Reload App" button.

---

## Icon Generation Pipeline

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-author once, commit PNGs | Generate 192/512/512-maskable/apple-touch-icon PNGs once, commit them under `frontend/public/`. Zero build-time work, zero new deps. | ✓ |
| pwa-asset-generator from one source | Add devDep; `npm run icons` script generates all PNGs from a single `assets/icon-source.png`. Reproducible, heavyweight dep used once. | |
| Custom sharp script | Write `scripts/gen-icons.mjs` composing the icon programmatically. Most control, most maintenance. | |

**User's choice:** Hand-author once, commit PNGs
**Notes:** Icon design is locked by UI-SPEC and v2.0 ships once — moving parts not worth the reproducibility win. Source visual: reuse `frontend/assets/adaptive-icon.png` foreground on `#0ea5e9` background.

---

## Lighthouse + Device Verification Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Defer both to Phase 6 | Phase 5 gates only on static checks (manifest schema, meta-tag grep, SW file presence, touch-target tests). Lighthouse + device install verified after Phase 6 ships the public domain. Cleanest separation. | |
| Lighthouse now + device deferred | Lighthouse local against Phase 4 Caddy compose at `https://localhost` with `--ignore-certificate-errors`. Real-device install deferred to Phase 6. Splits the two SCs across phases. | ✓ |
| Full local verification now | Lighthouse local + real-device test via laptop LAN IP with cert-trust workaround. Most rigorous, brittle, network-dependent. | |

**User's choice:** Lighthouse now + device deferred
**Notes:** Self-signed cert may dock a few points; if local score lands in the 85–90 band, document the delta and re-verify in Phase 6 against the real LE cert rather than chasing the local number. Real-device install requires the canonical environment (public HTTPS) to be representative — Phase 6 owns SC-2.

---

## Touch-Target Audit Scope

(Not selected as a top-level discussion area but resolved inline via UI-SPEC + D-15.)

**Decision:** Button.tsx single-point fix PLUS spot-fix of UI-SPEC-named non-Button offenders (currency picker rows, modal close buttons when introduced, navigation back buttons). No full grep audit — trust the UI-SPEC contract list.

---

## Claude's Discretion

- File naming under `frontend/public/` and `frontend/src/pwa/` left to researcher/planner provided the D-01..D-09 invariants hold.
- Exact Workbox `runtimeCaching` glob patterns (especially for fonts subdirectory layout that Expo emits) left to researcher so long as UI-SPEC §"Service Worker Caching Contract" strategy is preserved.
- Optional `<noscript>` fallback in `public/index.html` left to executor — not load-bearing.

## Deferred Ideas

- Lighthouse + real-device verification against the real public domain → Phase 6 verify inherits both ROADMAP SC-1 (re-verify with real LE cert) and SC-2 (iPhone Safari + Android Chrome Add-to-Home-Screen).
- Lighthouse-CI as a build gate → natural fit for Phase 7 (CI-01..03).
- Custom modal for destructive confirmations → polish follow-up; UI-SPEC accepts `window.confirm()` for v2.0.
- Custom Install banner with iOS instructions → already deferred in REQUIREMENTS.md "Future Requirements".
- Web Push, offline-first writes, monochrome icons → already deferred in REQUIREMENTS.md "Out of Scope".
- Full grep audit of every `TouchableOpacity` for touch-target compliance → explicitly out per D-15; fold any stray finding into a future polish phase.
