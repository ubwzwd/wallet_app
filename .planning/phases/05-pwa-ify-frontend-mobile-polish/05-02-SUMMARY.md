---
phase: 05-pwa-ify-frontend-mobile-polish
plan: 02
subsystem: ui
tags: [pwa, expo, web, manifest, ios, sharp, icons, viewport, workbox-precursor]

# Dependency graph
requires:
  - phase: 05-pwa-ify-frontend-mobile-polish
    provides: "05-01 installed sharp + ajv + workbox-cli devDeps and shipped verify-pwa.mjs Wave 0 verifier"
provides:
  - "frontend/public/ static-asset shell that Expo SDK 54 copies verbatim into dist/ (D-01)"
  - "frontend/public/manifest.json — W3C-valid PWA manifest (name=Wallet, display=standalone, 3 icons including maskable)"
  - "frontend/public/index.html — custom shell preserving Expo bootstrap markup (#root mount + expo-reset style); Expo injects hashed /_expo/static/js/web/index-*.js defer script at export time"
  - "frontend/public/pwa.css — input,select,textarea {font-size:16px !important} for MOBUI-03 (iOS Safari zoom-on-focus prevention)"
  - "frontend/public/offline.html — self-contained offline fallback served by SW (UI-SPEC Copywriting Contract verbatim)"
  - "frontend/public/{192,512,512-maskable,apple-touch-icon}.png + favicon.ico"
  - "frontend/scripts/generate-icons.mjs — sharp-based canonical icon production (composites adaptive-icon.png on #0ea5e9; maskable variant at 80% safe zone)"
  - "Confirmed bootstrap-injection contract: dist/index.html contains /_expo/static/js/web/index-<hash>.js defer + expo-reset + #root (RESEARCH A1 mitigation green)"
affects: [05-03 service-worker-and-build-wiring, 05-04 mobile-polish, 05-05 verifier]

# Tech tracking
tech-stack:
  added: []  # No new deps; sharp/ajv/workbox-cli already in devDeps from 05-01
  patterns:
    - "public/ directory pattern (Expo SDK 50+ copies it verbatim into dist/) — owns all static PWA assets outside the Metro bundle"
    - "Sharp + composite() icon generator — deterministic re-run; ICO emitted via minimal hand-built ICONDIR header wrapping a PNG payload"
    - "Bootstrap-preserving template: custom index.html keeps expo-reset style block + #root mount; Expo appends the hashed bootstrap script during expo export -p web"

key-files:
  created:
    - "frontend/public/manifest.json"
    - "frontend/public/pwa.css"
    - "frontend/public/offline.html"
    - "frontend/public/index.html"
    - "frontend/public/192.png"
    - "frontend/public/512.png"
    - "frontend/public/512-maskable.png"
    - "frontend/public/apple-touch-icon.png"
    - "frontend/public/favicon.ico"
    - "frontend/scripts/generate-icons.mjs"
  modified: []

key-decisions:
  - "Favicon.ico emitted by generate-icons.mjs via a hand-built 22-byte ICONDIR header wrapping a 32x32 PNG payload — avoids an ImageMagick devDep; valid for modern browsers + Windows Vista+"
  - "Maintainer comment in public/index.html avoids the literal '_expo/static/js' substring so the Task 3 grep guard (which proves no hand-authored script tag) succeeds on both source and generated artifacts"
  - "Frontend npm dependencies installed via --legacy-peer-deps because react-test-renderer@19.2.0 and react@19.1.0 disagree by a minor; the install is reproducing devDeps already declared in 05-01 (sharp/ajv/workbox-cli), not introducing new packages"

patterns-established:
  - "Canonical icon production: cd frontend && node scripts/generate-icons.mjs regenerates all 4 PNGs + favicon.ico deterministically from frontend/assets/adaptive-icon.png on #0ea5e9 background"
  - "Bootstrap smoke test: after any change to public/index.html, run `npx expo export -p web` from frontend/ and grep dist/index.html for /_expo/static/js/web/ + defer + expo-reset + #root"
  - "Static shell vs. SW separation: 05-02 owns public/ only; 05-03 wires the SW + workbox build chain"

requirements-completed:
  - PWA-01
  - PWA-02
  - PWA-03
  - MOBUI-03

# Metrics
duration: ~6 min
completed: 2026-05-24
---

# Phase 05 Plan 02: Static PWA Asset Shell Summary

**Authored every static PWA asset under `frontend/public/` (manifest, index.html, pwa.css, offline.html, 4 PNG icons, favicon.ico) plus the sharp-based `generate-icons.mjs` producer; confirmed `npx expo export -p web` injects the hashed bootstrap script into the new custom template without stripping the Expo reset markup.**

## Performance

- **Duration:** ~6 min (excluding the one-time 37s `npm install --legacy-peer-deps` to materialize devDeps in the fresh worktree)
- **Started:** 2026-05-24T17:14:00Z
- **Completed:** 2026-05-24T17:17:34Z
- **Tasks:** 4
- **Files created:** 10

## Accomplishments

- All 9 files under `frontend/public/` shipped: manifest.json, index.html, pwa.css, offline.html, 192.png, 512.png, 512-maskable.png, apple-touch-icon.png, favicon.ico.
- `frontend/scripts/generate-icons.mjs` committed and runnable; re-running deterministically reproduces all 5 image artifacts from `frontend/assets/adaptive-icon.png` on the `#0ea5e9` background (D-11 preserved).
- 4 of 5 `verify-pwa.mjs` static checks now PASS: `--check=manifest`, `--check=apple-meta`, `--check=viewport`, `--check=ios-zoom`. The `--check=sw` check remains RED as expected (owned by 05-03).
- Expo bootstrap smoke (RESEARCH § Pitfall 2 / Assumption A1) GREEN: the custom `public/index.html` did not break the Expo SDK 54 export.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author manifest.json, pwa.css, offline.html** — `a1d6b62` (feat)
2. **Task 2: Author generate-icons.mjs + produce 4 PNGs + favicon.ico** — `fc17cec` (feat)
3. **Task 3: Author public/index.html preserving Expo bootstrap shape** — `4804165` (feat)
4. **Task 4: Expo bootstrap smoke + verify-pwa checks** — no source-tree changes (dist/ is gitignored); confirmation captured in this SUMMARY.

## Bootstrap Smoke Evidence (Task 4)

Running `npx expo export -p web` from `frontend/` exited 0 and emitted:

```
› web bundles (1):
_expo/static/js/web/index-40e411781b13948f559fec9ae4ef8e77.js (625 kB)

› Files (2):
index.html (1.28 kB)
metadata.json (49 B)

Exported: dist
```

The matched bootstrap line inside `dist/index.html` (the proof Expo successfully injected the hashed script into our custom template):

```html
<script src="/_expo/static/js/web/index-40e411781b13948f559fec9ae4ef8e77.js" defer></script>
```

The Expo reset block survived (proving Expo did not strip it during template processing):

```html
<style id="expo-reset">
```

The `<div id="root"></div>` mount point also survived verbatim.

### Exact contents of frontend/dist/ after Task 4 export

(Predictable input set for 05-03's Workbox precache step.)

```
192.png             12368 bytes
512-maskable.png    38636 bytes
512.png             44612 bytes
_expo/              (Metro JS chunks, hashed)
apple-touch-icon.png 11275 bytes
favicon.ico          1132 bytes
index.html           1284 bytes
manifest.json         631 bytes
metadata.json          49 bytes
offline.html          794 bytes
pwa.css               296 bytes
```

That's 9 top-level static assets plus the `_expo/` directory of hashed JS chunks.

### Icon generator log (Task 2)

```
==> generate-icons: wrote frontend/public/192.png
==> generate-icons: wrote frontend/public/512.png
==> generate-icons: wrote frontend/public/512-maskable.png
==> generate-icons: wrote frontend/public/apple-touch-icon.png
==> generate-icons: wrote frontend/public/favicon.ico
```

Future icon regeneration is a one-command operation: `cd frontend && node scripts/generate-icons.mjs`.

### verify-pwa.mjs results

```
$ node scripts/verify-pwa.mjs --check=manifest    → exit 0
$ node scripts/verify-pwa.mjs --check=apple-meta  → exit 0
$ node scripts/verify-pwa.mjs --check=viewport    → exit 0
$ node scripts/verify-pwa.mjs --check=ios-zoom    → exit 0
$ node scripts/verify-pwa.mjs --check=sw          → exit 1  (expected — SW lands in 05-03)
```

## Files Created/Modified

- `frontend/public/manifest.json` — W3C PWA manifest; name/short_name=Wallet, display=standalone, theme #0ea5e9, 3 icons (192 any, 512 any, 512 maskable separately).
- `frontend/public/pwa.css` — single global rule `input, select, textarea { font-size: 16px !important; }` for MOBUI-03; top-of-file comment documents intent.
- `frontend/public/offline.html` — self-contained offline fallback; uses only UI-SPEC palette tokens (`#f9fafb`, `#1f2937`, `#6b7280`); Copywriting Contract strings verbatim ("You're offline" / "Check your connection. Your data will load once you're back online.").
- `frontend/public/index.html` — custom shell with viewport-fit=cover (PWA-03), manifest link, theme-color #0ea5e9, four Apple PWA meta tags, belt-and-braces `mobile-web-app-capable`, preserved `<style id="expo-reset">` block and `<div id="root">` mount, link to `/pwa.css`, link to `/favicon.ico`. NO hand-authored bootstrap script tag.
- `frontend/public/{192,512,512-maskable,apple-touch-icon}.png` — produced by `generate-icons.mjs`; PNG magic + IHDR-verified dimensions.
- `frontend/public/favicon.ico` — 32x32 PNG-encoded ICO (header magic `00 00 01 00`).
- `frontend/scripts/generate-icons.mjs` — sharp-based generator; reads `frontend/assets/adaptive-icon.png`; composites at `#0ea5e9`; 80% safe zone for the maskable variant per web.dev spec.

## Decisions Made

- **ICO production approach:** Embedded a 32x32 PNG inside a minimal hand-built 22-byte ICONDIR + ICONDIRENTRY header rather than adding an ImageMagick devDep. Modern browsers and Windows Vista+ accept PNG-encoded ICOs.
- **Comment phrasing in public/index.html:** Used "hashed Expo-web bootstrap script tag" instead of the literal `/_expo/static/js/web/...` URL in the maintainer comment so the Task 3 `! grep -F '_expo/static/js' public/index.html` acceptance guard succeeds. The guard exists to prove no hand-authored script tag; a documentary mention in a comment would have falsely tripped it.
- **`--legacy-peer-deps` for npm install:** The fresh worktree had no `frontend/node_modules/`; Rule 3 unblock by reproducing existing devDeps (sharp/ajv/workbox-cli already declared in 05-01). Peer conflict between react@19.1.0 and react-test-renderer@19.2.0 is pre-existing and orthogonal to this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Materialized frontend devDependencies via `npm install --legacy-peer-deps`**
- **Found during:** Task 2 (first `node scripts/generate-icons.mjs` invocation).
- **Issue:** Fresh worktree had no `frontend/node_modules/`; `sharp` was declared as devDep in 05-01 but not physically present, so the ESM `import sharp from 'sharp'` raised `ERR_MODULE_NOT_FOUND`.
- **Fix:** Ran `cd frontend && npm install --no-audit --no-fund --prefer-offline --legacy-peer-deps`. The flag is required because the existing `package.json` has react@19.1.0 vs react-test-renderer@19.2.0 — a pre-existing minor mismatch, not something this plan introduced.
- **Files modified:** none committed (node_modules is gitignored; package.json untouched).
- **Verification:** `node scripts/generate-icons.mjs` then produced all 5 image files.
- **Committed in:** N/A (no source changes).

**2. [Rule 1 — Bug] Removed stray `>` after `apple-mobile-web-app-status-bar-style` meta tag in public/index.html**
- **Found during:** Task 3 (immediate post-Write self-inspection).
- **Issue:** A typo introduced an extra `>` character on the meta tag line, producing `... content="default" />>`. Browsers would render the trailing `>` as page text.
- **Fix:** Edited the file to remove the stray `>`. Caught and fixed before the Task 3 commit.
- **Files modified:** `frontend/public/index.html` (pre-commit fix; single commit `4804165`).
- **Verification:** Re-ran the Task 3 substring grep suite — all 13 checks pass; no stray `>` remains.
- **Committed in:** `4804165` (the only Task 3 commit; clean).

---

**Total deviations:** 2 auto-fixed (1 blocking install, 1 typo).
**Impact on plan:** Neither expanded scope. The npm install reproduces existing 05-01 devDeps. The typo fix is internal to the same task before its commit.

## Issues Encountered

- None beyond the auto-fixed deviations.

## User Setup Required

None — no new external services or env vars.

## Next Phase Readiness

- **05-03 (service-worker-and-build-wiring) unblocked:** All static inputs the SW will precache exist under `frontend/public/` and have been confirmed to land under `dist/` after `expo export -p web`. The exact dist file list is documented above so workbox-config.cjs' precache count is predictable.
- **`--check=sw` is the only remaining red Wave 1 verifier check;** all four static checks (`manifest`, `apple-meta`, `viewport`, `ios-zoom`) are green.
- **Self-Check below confirms zero claimed-but-missing artifacts.**

## Self-Check: PASSED

- `frontend/public/manifest.json` — FOUND
- `frontend/public/pwa.css` — FOUND
- `frontend/public/offline.html` — FOUND
- `frontend/public/index.html` — FOUND
- `frontend/public/192.png` — FOUND (192x192)
- `frontend/public/512.png` — FOUND (512x512)
- `frontend/public/512-maskable.png` — FOUND (512x512)
- `frontend/public/apple-touch-icon.png` — FOUND (180x180)
- `frontend/public/favicon.ico` — FOUND (valid ICO magic)
- `frontend/scripts/generate-icons.mjs` — FOUND
- Commit `a1d6b62` — FOUND
- Commit `fc17cec` — FOUND
- Commit `4804165` — FOUND

---
*Phase: 05-pwa-ify-frontend-mobile-polish*
*Plan: 02*
*Completed: 2026-05-24*
