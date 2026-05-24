---
phase: 05
plan: 01
subsystem: pwa-verification-harness
tags: [pwa, verification, static-analysis, touch-targets, tdd, wave-0]
dependency_graph:
  requires: []
  provides:
    - "frontend/scripts/verify-pwa.mjs (5 named checks + --all)"
    - "frontend/scripts/verify-touch-targets.mjs (10 named checks + --all)"
    - "frontend/scripts/w3c-manifest-schema.json (vendored W3C Web App Manifest schema)"
    - "frontend/__tests__/Button.test.ts (MOBUI-01 RED spec)"
  affects:
    - "frontend/package.json (devDependencies: workbox-cli, ajv, sharp)"
    - "frontend/package-lock.json"
tech_stack:
  added:
    - "workbox-cli@^7.4.1 (dev-only — Workbox SW generator, consumed in 05-03)"
    - "ajv@^8 (dev-only — JSON-Schema validator for manifest)"
    - "sharp@^0.33 (dev-only — image-resize for icon generation in 05-02 Task 2)"
  patterns:
    - "node:fs.readFileSync + path.join(process.cwd(), ...) — same idiom as frontend/__tests__/CurrencyPicker.test.ts"
    - "==> step / FAIL: reason / process.exit(1) cadence — mirrors infra/scripts/smoke.sh"
    - "ajv 8 with strict:false + logger:false; draft-04 → normalized $schema/id stripped at load time"
key_files:
  created:
    - "frontend/scripts/verify-pwa.mjs"
    - "frontend/scripts/verify-touch-targets.mjs"
    - "frontend/scripts/w3c-manifest-schema.json"
    - "frontend/__tests__/Button.test.ts"
  modified:
    - "frontend/package.json"
    - "frontend/package-lock.json"
decisions:
  - "D-14 verifier contract locked: verify-pwa.mjs and verify-touch-targets.mjs share the --check=<name> / --all argv surface; downstream plans grep PASS:/FAIL: emit strings."
  - "D-15 revised (10-check registry): all-touchables added to verify-touch-targets.mjs registry to gate the full audit pass in 05-04 Task 6."
  - "ajv 8 compatibility: SchemaStore's W3C manifest schema is draft-04 and uses bare `id`. The script strips `$schema` and rewrites `id` → `$id` recursively at load time before compiling. logger:false silences benign 'unknown format uri' warnings."
  - "Vendored schema is the inlined combined form: web-manifest.json + web-manifest-app-info.json + web-manifest-share-target.json bundled into a single allOf wrapper, so ajv has zero $ref resolution at runtime."
metrics:
  duration: "~10 min"
  completed: "2026-05-25"
  tasks_completed: "4 of 4"
  commits:
    - { hash: "967e737", type: "chore", subject: "add workbox-cli + ajv + sharp devDeps and vendor W3C manifest schema" }
    - { hash: "24136b2", type: "feat",  subject: "add verify-pwa.mjs static driver (ajv-validated W3C manifest)" }
    - { hash: "80cc6c3", type: "feat",  subject: "add verify-touch-targets.mjs with 10-check registry incl. all-touchables" }
    - { hash: "2c1cea2", type: "test",  subject: "add Button.test.ts static-source spec for MOBUI-01 (RED)" }
---

# Phase 5 Plan 01: PWA Verification Harness Summary

Wave-0 verifier scaffolding for PWA-ify Frontend + Mobile Polish: two Node scripts (`verify-pwa.mjs`, `verify-touch-targets.mjs`), one Jest static-source spec (`Button.test.ts`), one vendored W3C manifest JSON schema, and three devDependencies (workbox-cli, ajv, sharp). All scripts intentionally FAIL against the pre-PWA codebase — that RED state is the proof Wave 0 wired the contract correctly. Zero production source modifications under `frontend/src/`.

## What was built

### `frontend/scripts/verify-pwa.mjs` (5 checks + `--all`)

| --check= | What it asserts |
|----------|-----------------|
| `manifest`     | ajv-validate `dist/manifest.json` against vendored W3C schema; supplementary "≥1 icon.purpose contains maskable" check |
| `apple-meta`   | `dist/index.html` carries the four `apple-*` meta tags AND `dist/apple-touch-icon.png` exists |
| `viewport`     | `dist/index.html` viewport meta contains `viewport-fit=cover` |
| `sw`           | `dist/sw.js` parses + contains `NetworkFirst`, `CacheFirst`, `skipWaiting`, `clientsClaim`, `/api/`, `/index.html` |
| `ios-zoom`     | `dist/pwa.css` contains `font-size: 16px !important` on input/select/textarea |

`--all` runs every check in order; first failure exits 1. No args → usage to stderr + exit 1.

### `frontend/scripts/verify-touch-targets.mjs` (10 checks + `--all`)

The ten stable check names (downstream plans grep these — D-15 revised):

| check-name | One-line |
|------------|----------|
| `button-small-44`           | Button.tsx `small` size declares minHeight: 44 and minWidth: 44 |
| `finance-form-spot-fix-44`  | FinanceSourceFormScreen.tsx contains ≥1 `minHeight: 44` |
| `tx-form-spot-fix-44`       | TransactionFormScreen.tsx contains ≥1 `minHeight: 44` |
| `profile-spot-fix-44`       | ProfileScreen.tsx contains ≥1 `minHeight: 44` |
| `tx-amount-inputmode`       | TransactionFormScreen.tsx `inputMode="decimal"` count == `keyboardType="decimal-pad"` count, both ≥3 |
| `login-email-props`         | LoginScreen.tsx declares `keyboardType="email-address"` + `autoComplete="email"` |
| `register-email-props`      | RegisterScreen.tsx declares `keyboardType="email-address"` + `autoComplete="email"` |
| `screen-safe-area`          | Screen.tsx imports `SafeAreaView` from `react-native-safe-area-context` (NOT `react-native`) |
| `app-safe-area-provider`    | App.tsx wraps tree with `SafeAreaProvider` from `react-native-safe-area-context` |
| `all-touchables`            | Every `<TouchableOpacity|Pressable|TouchableHighlight>` under `frontend/src/` has `minHeight: 44` (inline or via referenced StyleSheet key) OR an `// touch-target-exempt: <reason>` comment |

#### Emit-string contract (locked):
- Entry: `==> verify-touch-targets[<check-name>]: <description>` to stdout
- Pass:  `PASS: <check-name>` to stdout
- Fail:  `FAIL: <check-name> — <reason>` to stderr (em-dash separator)
- Unknown check-name: `FAIL: unknown check name: <name>` and exit 1 (no silent passes on typos)
- `--all` mode: no exit-on-first-failure; failures aggregated into a final stderr dump, exit 1 if any
- `--all` success ending: `==> all touch-target checks passed`

#### `all-touchables` implementation strategy
1. Recursive `.tsx` walk under `frontend/src/` (skips `__tests__/` and `node_modules/`).
2. Regex-scan each file for `<TouchableOpacity\b`, `<Pressable\b`, `<TouchableHighlight\b`.
3. For each match: walk a ±200-character window for either an inline `style={{ ... minHeight: 44 ... }}` attribute OR a `styles.<key>` reference whose StyleSheet key contains `minHeight: 44` in the same file. Array-spread `style={[styles.a, styles.b]}` keys are also considered.
4. Opt-out: an `// touch-target-exempt: <reason>` comment on the same or immediately-preceding line makes the element PASS regardless of style content.

**Known limitation (documented at top of file):** the regex approach can produce false-negatives on conflict-spread style arrays (`style={[base, overrideThatRemovesMinHeight]}`). Acceptable for v2.0 — escalate to AST if a regression hits.

### `frontend/scripts/w3c-manifest-schema.json` (vendored)

Combined W3C Web App Manifest JSON Schema, inlined from SchemaStore:
- Source: `https://json.schemastore.org/web-manifest-combined.json` plus the three `$ref` files (`web-manifest.json`, `web-manifest-app-info.json`, `web-manifest-share-target.json`).
- The on-disk file wraps all three in a top-level `allOf` so ajv has zero `$ref` resolution at runtime, and zero network dependency.
- 17 KB, draft-04 declarations stripped at load time by verify-pwa.mjs (ajv 8 default is draft-07).

### `frontend/__tests__/Button.test.ts`

Three static-source `it` blocks under `describe('MOBUI-01: Button small size satisfies 44x44 touch-target minimum', ...)`:
1. Button.tsx defines a small size style block → **PASS** (block exists).
2. small size has `minHeight: 44` → **FAIL** (the RED gate — plan 05-04 lands this).
3. small size has `minWidth: 44` → **FAIL** (the RED gate — plan 05-04 lands this).

`fs.readFileSync(path.join(__dirname, '../src/components/Button.tsx'), 'utf8')` — same idiom as `CurrencyPicker.test.ts`. No `react-native` imports, no `@testing-library`. `jest.config.js` testEnvironment is `node`.

### devDependencies added

| Package | Version | Purpose | When consumed |
|---------|---------|---------|---------------|
| `workbox-cli` | `^7.4.1` | Workbox service-worker generator | 05-03 (SW generation step) |
| `ajv`         | `^8.20.0` | JSON-Schema validator | 05-01 verify-pwa.mjs (now) |
| `sharp`       | `^0.33.5` | Image-resize for PWA PNG icons | 05-02 Task 2 (`frontend/scripts/generate-icons.mjs`) |

None of the three appear under `dependencies`. All are widely deployed top-tier packages — no human-verify checkpoint required (per `<threat_model>` T-05-01-SC).

## Pre-fix FAILing assertions observed (red gates — 05-02 through 05-04 must turn these green)

`verify-touch-targets.mjs --all` against the pre-fix codebase produces:

- `FAIL: button-small-44 — Button.tsx small size missing minHeight: 44 and/or minWidth: 44`
- `FAIL: finance-form-spot-fix-44 — FinanceSourceFormScreen.tsx missing minHeight: 44`
- `FAIL: tx-form-spot-fix-44 — TransactionFormScreen.tsx missing minHeight: 44`
- `FAIL: profile-spot-fix-44 — ProfileScreen.tsx missing minHeight: 44`
- `FAIL: tx-amount-inputmode — inputMode="decimal" count (0) does not equal keyboardType="decimal-pad" count (3) or both < 3`
- `FAIL: screen-safe-area — Screen.tsx does not import from react-native-safe-area-context + SafeAreaView is destructured from react-native`
- `FAIL: app-safe-area-provider — App.tsx SafeAreaProvider not referenced + does not import from react-native-safe-area-context`
- `FAIL: all-touchables — <18 offenders across Button.tsx, Input.tsx, Navigation.tsx, FinanceSourceFormScreen.tsx, ProfileScreen.tsx, TransactionFormScreen.tsx>`

PASSing pre-fix:
- `PASS: login-email-props`
- `PASS: register-email-props`

`verify-pwa.mjs --check=manifest` against current `dist/` (no PWA artifacts yet):
- `FAIL: manifest schema violation at /: dist/manifest.json missing (ENOENT ...)`

`Button.test.ts`:
- `Tests: 2 failed, 1 passed, 3 total` — fails are the two minHeight/minWidth assertions; pass is the "small block exists" assertion.

## Production source untouched

`git diff b98c720 HEAD --name-only` shows only:
```
frontend/__tests__/Button.test.ts
frontend/package-lock.json
frontend/package.json
frontend/scripts/verify-pwa.mjs
frontend/scripts/verify-touch-targets.mjs
frontend/scripts/w3c-manifest-schema.json
```
No file under `frontend/src/` was modified.

## Deviations from Plan

### [Rule 3 - Blocking install issue] `npm install` required `--legacy-peer-deps`

- **Found during:** Task 1
- **Issue:** `npm install --save-dev workbox-cli ajv sharp` failed with ERESOLVE because the existing project's `@testing-library/react-native@13.3.3` and `jest-expo@55.0.13` have conflicting `react-test-renderer` peer ranges against `react@19.1.0`. This is **pre-existing repo state**, not caused by my packages — workbox-cli / ajv / sharp have no React peer deps.
- **Fix:** Used `npm install --save-dev --legacy-peer-deps workbox-cli@^7.4.1 ajv@^8 sharp@^0.33`. This is the standard approach for Expo + RN + @testing-library/react-native projects on React 19 (the Expo team has not yet updated `@testing-library/react-native` to relax the peer range).
- **Files modified:** `frontend/package.json`, `frontend/package-lock.json`
- **Commit:** `967e737`
- **Impact:** None for our packages. The pre-existing peer conflict was already latent; surfacing it via `--legacy-peer-deps` does not alter resolution of unrelated packages. Downstream installs (05-02, 05-03) will likely need the same flag.

### [Rule 3 - Blocking environment drift] Jest CLI flag renamed in v30

- **Found during:** Task 4
- **Issue:** The PLAN's verification command uses `--testPathPattern=Button.test.ts` (singular). Jest 30 renamed this to `--testPathPatterns=Button.test.ts` (plural). The singular form prints a deprecation notice and exits 1 from a flag-parse error — not from test failures — so the plan's literal command produces a false-positive "exit non-zero" without ever running the tests.
- **Fix:** Used the new flag `--testPathPatterns=Button.test.ts` in the verify step. Tests run; the script's intended red state (`Tests: 2 failed, 1 passed, 3 total`, output mentions `minHeight: 44`) is observed.
- **Files modified:** None (the test spec itself is unchanged; only the npm test invocation flag).
- **Impact:** Downstream plans that grep `--testPathPattern` in PLAN.md verify blocks will need to update to `--testPathPatterns`. Documented here so plan reviewers can sweep references.

### [Rule 3 - ajv 8 vs draft-04 schema] In-memory schema normalization

- **Found during:** Task 2 first run
- **Issue:** ajv 8 defaults to draft-07 and throws `Error: no schema with key or ref "http://json-schema.org/draft-04/schema#"` when compiling SchemaStore's draft-04 web-manifest schema. The schema also uses bare `id` (draft-04 keyword) instead of `$id` (draft-07+).
- **Fix:** Added a `normalizeSchema()` walker that recursively strips `$schema` and rewrites `id` → `$id` on the in-memory schema before passing to `ajv.compile(...)`. The semantic constraints (properties, required, types, enums) are unchanged — only the meta-schema declaration is dropped. Also set `logger: false` to suppress benign "unknown format uri" warnings.
- **Files modified:** `frontend/scripts/verify-pwa.mjs` (only — schema file on disk is the raw vendored copy, untouched).
- **Impact:** None. Validation behavior is correct; positive smoke test (valid manifest with maskable icon) exits 0; missing-maskable case fails the supplementary check; missing-file case fails the read step.

## Authentication Gates

None.

## Known Stubs

None. All scripts are functional; the "FAIL on missing dist/" state is the *contract*, not a stub.

## TDD Gate Compliance

Tasks 2, 3, 4 are marked `tdd="true"`. The Wave-0 contract makes the RED gate the verification target itself:

- **Task 2 (verify-pwa.mjs):** RED gate = "`--check=manifest` exits 1 on missing `dist/manifest.json`". GREEN gate = the script's own correctness (verified by adding a valid + a maskable-missing manifest in `/tmp/` during inline development and observing both branches behave correctly before commit). No separate test commit was needed because the script's stderr/exit-code IS the test; the GREEN observation is in this SUMMARY.
- **Task 3 (verify-touch-targets.mjs):** RED gate = "`--all` exits 1 against current source with the locked emit strings". GREEN gate = "`--check=login-email-props` exits 0 against current source AND `--check=unknown-check-foo` exits 1 with `FAIL: unknown check name: unknown-check-foo`". Both observed pre-commit.
- **Task 4 (Button.test.ts):** Pure RED state per design — 2 failed, 1 passed, exit 1. The GREEN flip will occur in plan 05-04 when Button.tsx's `small` block gains `minHeight: 44, minWidth: 44`.

Commit type pattern: `test(05-01): ...` for Button.test.ts (TDD test commit), `feat(05-01): ...` for the two scripts (feature scaffolding — the scripts ARE the production code for the verifier subsystem, with their RED outputs serving as the test).

## Self-Check: PASSED

Verified files exist and commits present:

- `frontend/scripts/verify-pwa.mjs` → FOUND
- `frontend/scripts/verify-touch-targets.mjs` → FOUND
- `frontend/scripts/w3c-manifest-schema.json` → FOUND (17 KB, valid JSON, contains `name`, `start_url`, `display`)
- `frontend/__tests__/Button.test.ts` → FOUND
- `frontend/package.json` devDependencies → workbox-cli@^7.4.1, ajv@^8.20.0, sharp@^0.33.5 — none in `dependencies`
- Commit `967e737` (chore) → FOUND in git log
- Commit `24136b2` (feat verify-pwa) → FOUND in git log
- Commit `80cc6c3` (feat verify-touch-targets) → FOUND in git log
- Commit `2c1cea2` (test Button.test.ts) → FOUND in git log

All 7 plan-level success criteria assertions from `<verification>` pass.
