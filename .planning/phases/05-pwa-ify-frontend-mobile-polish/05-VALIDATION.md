---
phase: 05
slug: pwa-ify-frontend-mobile-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Detailed Validation Architecture lives in `05-RESEARCH.md` (§ Validation Architecture, lines 591–632); this doc records the per-task sampling rules and Wave 0 gaps the planner will fill.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.3.0 + `babel-jest` (`frontend/jest.config.js`, `testEnvironment: node`) |
| **Config file** | `frontend/jest.config.js` |
| **Quick run command** | `cd frontend && npm test -- --testPathPattern=<spec>` |
| **Full suite command** | `cd frontend && npm test` |
| **Supplementary commands** | `node frontend/scripts/verify-pwa.mjs --all` (static dist/* + manifest/meta/sw checks); `node frontend/scripts/verify-touch-targets.mjs` (source-regex audit); optional `node frontend/scripts/verify-sw-update.mjs` (Puppeteer SW-update smoke) |
| **Estimated runtime** | Jest suite ~10s; verify-pwa --all ~5s; verify-sw-update ~20s (optional) |

---

## Sampling Rate

- **After every task commit:** Run the static check(s) directly affected by the task — e.g. touch-target task re-runs `verify-touch-targets.mjs`; manifest task re-runs `verify-pwa.mjs --check=manifest`.
- **After every wave:** `cd frontend && npm run build:web && node scripts/verify-pwa.mjs --all && node scripts/verify-touch-targets.mjs && npm test`.
- **Before `/gsd:verify-work`:** Full battery green + Phase 4 smoke.sh still passes (no regression) + one manual Incognito-Chrome install attempt against `https://localhost`.
- **Max feedback latency:** ~30 seconds for the full battery (Jest + static scripts).

---

## Per-Task Verification Map

> Populated by the planner from `05-RESEARCH.md` § "Phase Requirements → Test Map". Each task in `*-PLAN.md` MUST include an `<automated>` block referencing one of the commands below, OR declare a Wave 0 dependency on the script being created.

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| PWA-01 | `dist/manifest.json` validates against W3C manifest schema; required fields + icons + maskable | static + schema | `node frontend/scripts/verify-pwa.mjs --check=manifest` | ❌ Wave 0 |
| PWA-02 | apple-touch-icon (180×180 PNG) + apple-mobile-web-app-* meta tags in `dist/index.html` | static | `node frontend/scripts/verify-pwa.mjs --check=apple-meta` | ❌ Wave 0 |
| PWA-03 | viewport meta in `dist/index.html` contains `viewport-fit=cover` | static (regex) | `node frontend/scripts/verify-pwa.mjs --check=viewport` | ❌ Wave 0 |
| PWA-04 (static) | `dist/sw.js` parses + contains NetworkFirst + CacheFirst + skipWaiting + clientsClaim + `/api/` + `/index.html` route patterns | static | `node frontend/scripts/verify-pwa.mjs --check=sw` | ❌ Wave 0 |
| PWA-04 (runtime) | v1 → v2 → reload-once → v2-controls programmatic check | integration | `node frontend/scripts/verify-sw-update.mjs` (Puppeteer) | ❌ Wave 0 — OPTIONAL |
| MOBUI-01 | `Button size="small"` style declares `minHeight: 44, minWidth: 44`; non-Button touch targets in ProfileScreen/FinanceSourceFormScreen/TransactionFormScreen declare `minHeight: 44` | unit + static | `npm test -- Button.test.ts` + `verify-touch-targets.mjs` | ❌ Wave 0 |
| MOBUI-02 | `Screen.tsx` imports `SafeAreaView` from `react-native-safe-area-context`; `App.tsx` wraps with `SafeAreaProvider` | static | included in `verify-touch-targets.mjs` | ❌ Wave 0 |
| MOBUI-03 | `dist/pwa.css` contains `input, select, textarea { font-size: 16px !important; }` | static | `grep -F "font-size: 16px" frontend/dist/pwa.css` (wrapped in verify-pwa --check=ios-zoom) | ❌ Wave 0 |
| MOBUI-04 | `TransactionFormScreen.tsx` amount field has `keyboardType="decimal-pad"` AND explicit `inputMode="decimal"`; Login/Register email inputs unchanged | static | `verify-touch-targets.mjs` (extended) | ❌ Wave 0 |
| MOBUI-05 | Real-device install (iPhone Safari + Android Chrome) | manual | **deferred to Phase 6 per CONTEXT D-13** | n/a |

---

## Wave 0 Requirements

- [ ] `frontend/scripts/verify-pwa.mjs` — new — driver for manifest/apple-meta/viewport/sw/ios-zoom static checks; supports `--check=<name>` and `--all`.
- [ ] `frontend/scripts/verify-touch-targets.mjs` — new — source-regex audit for `minHeight: 44`, `inputMode="decimal"`, safe-area-context imports.
- [ ] `frontend/scripts/verify-sw-update.mjs` — new, OPTIONAL — Puppeteer smoke for SW v1→v2 controllerchange.
- [ ] `frontend/__tests__/Button.test.ts` — new — assert `Button` `small` style has `minHeight === 44 && minWidth === 44` (testEnvironment node, no RN runtime).
- [ ] devDependency `@pwabuilder/manifest-validation` (or `ajv` + W3C schema) — install behind `checkpoint:human-verify` per Package Legitimacy Audit.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Add-to-home-screen install on real iPhone Safari | MOBUI-05 | Apple has no programmatic install API; only a real device can confirm the "feels native" launch behavior | Deferred to Phase 6 per CONTEXT D-13. |
| Install prompt fires on real Android Chrome | MOBUI-05 | Browser engagement heuristics require real user interaction | Deferred to Phase 6 per CONTEXT D-13. |
| Incognito-Chrome smoke install against `https://localhost` | SC-2 (proxy) | Lighthouse 12+ removed the PWA category; the spec-correct proxy is a developer Incognito install attempt | Before invoking `/gsd:verify-work`, run `make compose-up`, open `https://localhost` in Incognito Chrome, open DevTools → Application → Manifest, confirm "Installability" shows no errors; click the address-bar install icon and confirm the app installs and launches in standalone. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify command OR a Wave 0 dependency on the script being created.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify.
- [ ] Wave 0 covers all MISSING references in the Per-Task Verification Map.
- [ ] No watch-mode flags (`--watch`, `--watchAll`).
- [ ] Feedback latency < 30s for the full battery.
- [ ] `nyquist_compliant: true` set in frontmatter after planner pass.

**Approval:** pending
