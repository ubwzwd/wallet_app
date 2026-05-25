#!/usr/bin/env node
/**
 * verify-touch-targets.mjs — Wave 0 static touch-target verifier (Phase 5, plan 05-01).
 *
 * KNOWN LIMITATION: the `all-touchables` check uses regex; nested style spreads
 * (style={[styles.a, styles.b]}) may produce false-negatives because the regex
 * won't resolve which keys are actually applied. Escalate to AST if regression hits.
 * The 05-04 Task 6 reviewer should manually inspect nested-spread sites.
 *
 * Usage:
 *   node scripts/verify-touch-targets.mjs --check=<name>   # single check, exit 0 PASS / 1 FAIL
 *   node scripts/verify-touch-targets.mjs --all            # every check, aggregate failures
 *   node scripts/verify-touch-targets.mjs                  # defaults to --all
 *
 * Check-name registry (10 stable names — downstream plans grep these):
 *   button-small-44           Button.tsx `small` size has minHeight: 44 + minWidth: 44
 *   finance-form-spot-fix-44  FinanceSourceFormScreen.tsx contains ≥1 minHeight: 44
 *   tx-form-spot-fix-44       TransactionFormScreen.tsx contains ≥1 minHeight: 44
 *   profile-spot-fix-44       ProfileScreen.tsx contains ≥1 minHeight: 44
 *   tx-amount-inputmode       inputMode="decimal" count == keyboardType="decimal-pad" count, both ≥3
 *   login-email-props         LoginScreen.tsx has keyboardType=email-address + autoComplete=email
 *   register-email-props      RegisterScreen.tsx has keyboardType=email-address + autoComplete=email
 *   screen-safe-area          Screen.tsx imports SafeAreaView from react-native-safe-area-context
 *   app-safe-area-provider    App.tsx wraps tree with SafeAreaProvider from safe-area-context
 *   all-touchables            Every <TouchableOpacity|Pressable|TouchableHighlight> under src/ has
 *                             minHeight: 44 (inline or styles.<key> referent) OR an opt-out
 *                             "// touch-target-exempt: <reason>" comment
 *
 * Emit-string contract (locked — downstream plans grep these exact strings):
 *   ==> verify-touch-targets[<check-name>]: <one-line description>      stdout
 *   PASS: <check-name>                                                  stdout
 *   FAIL: <check-name> — <reason>                                       stderr
 *
 * Cadence mirrors infra/scripts/smoke.sh.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

const CWD = process.cwd();

function readSrc(rel) {
  return fs.readFileSync(path.join(CWD, rel), 'utf8');
}

function tryReadSrc(rel) {
  try {
    return readSrc(rel);
  } catch (e) {
    return null;
  }
}

function emitEntry(name, description) {
  process.stdout.write(`==> verify-touch-targets[${name}]: ${description}\n`);
}

function emitPass(name) {
  process.stdout.write(`PASS: ${name}\n`);
}

function emitFail(name, reason) {
  process.stderr.write(`FAIL: ${name} — ${reason}\n`);
}

// ─── single-failure checks ───────────────────────────────────────────────────

function checkButtonSmall44() {
  const description = 'Button.tsx `small` size declares minHeight: 44 and minWidth: 44';
  emitEntry('button-small-44', description);
  const src = tryReadSrc('src/components/Button.tsx');
  if (src == null) {
    return { ok: false, reason: 'src/components/Button.tsx missing' };
  }
  // Either property order acceptable
  const re1 = /small:\s*\{[^}]*minHeight:\s*44[^}]*minWidth:\s*44/s;
  const re2 = /small:\s*\{[^}]*minWidth:\s*44[^}]*minHeight:\s*44/s;
  if (re1.test(src) || re2.test(src)) return { ok: true };
  return {
    ok: false,
    reason: 'Button.tsx small size missing minHeight: 44 and/or minWidth: 44',
  };
}

function checkFinanceFormSpotFix44() {
  const description = 'FinanceSourceFormScreen.tsx contains ≥1 minHeight: 44';
  emitEntry('finance-form-spot-fix-44', description);
  const src = tryReadSrc('src/screens/FinanceSourceFormScreen.tsx');
  if (src == null)
    return { ok: false, reason: 'src/screens/FinanceSourceFormScreen.tsx missing' };
  if (src.includes('minHeight: 44')) return { ok: true };
  return { ok: false, reason: 'FinanceSourceFormScreen.tsx missing minHeight: 44' };
}

function checkTxFormSpotFix44() {
  const description = 'TransactionFormScreen.tsx contains ≥1 minHeight: 44';
  emitEntry('tx-form-spot-fix-44', description);
  const src = tryReadSrc('src/screens/TransactionFormScreen.tsx');
  if (src == null)
    return { ok: false, reason: 'src/screens/TransactionFormScreen.tsx missing' };
  if (src.includes('minHeight: 44')) return { ok: true };
  return { ok: false, reason: 'TransactionFormScreen.tsx missing minHeight: 44' };
}

function checkProfileSpotFix44() {
  const description = 'ProfileScreen.tsx contains ≥1 minHeight: 44';
  emitEntry('profile-spot-fix-44', description);
  const src = tryReadSrc('src/screens/ProfileScreen.tsx');
  if (src == null) return { ok: false, reason: 'src/screens/ProfileScreen.tsx missing' };
  if (src.includes('minHeight: 44')) return { ok: true };
  return { ok: false, reason: 'ProfileScreen.tsx missing minHeight: 44' };
}

function checkTxAmountInputmode() {
  const description =
    'TransactionFormScreen.tsx inputMode="decimal" count matches keyboardType="decimal-pad" count, both ≥3';
  emitEntry('tx-amount-inputmode', description);
  const src = tryReadSrc('src/screens/TransactionFormScreen.tsx');
  if (src == null)
    return { ok: false, reason: 'src/screens/TransactionFormScreen.tsx missing' };
  const inputModeCount = (src.match(/inputMode="decimal"/g) || []).length;
  const keyboardTypeCount = (src.match(/keyboardType="decimal-pad"/g) || []).length;
  if (inputModeCount === keyboardTypeCount && inputModeCount >= 3) return { ok: true };
  return {
    ok: false,
    reason: `inputMode="decimal" count (${inputModeCount}) does not equal keyboardType="decimal-pad" count (${keyboardTypeCount}) or both < 3`,
  };
}

function checkLoginEmailProps() {
  const description =
    'LoginScreen.tsx declares keyboardType="email-address" and autoComplete="email"';
  emitEntry('login-email-props', description);
  const src = tryReadSrc('src/screens/LoginScreen.tsx');
  if (src == null) return { ok: false, reason: 'src/screens/LoginScreen.tsx missing' };
  const okKbd = src.includes('keyboardType="email-address"');
  const okAuto = src.includes('autoComplete="email"');
  if (okKbd && okAuto) return { ok: true };
  const missing = [];
  if (!okKbd) missing.push('keyboardType="email-address"');
  if (!okAuto) missing.push('autoComplete="email"');
  return { ok: false, reason: 'LoginScreen.tsx missing ' + missing.join(' + ') };
}

function checkRegisterEmailProps() {
  const description =
    'RegisterScreen.tsx declares keyboardType="email-address" and autoComplete="email"';
  emitEntry('register-email-props', description);
  const src = tryReadSrc('src/screens/RegisterScreen.tsx');
  if (src == null) return { ok: false, reason: 'src/screens/RegisterScreen.tsx missing' };
  const okKbd = src.includes('keyboardType="email-address"');
  const okAuto = src.includes('autoComplete="email"');
  if (okKbd && okAuto) return { ok: true };
  const missing = [];
  if (!okKbd) missing.push('keyboardType="email-address"');
  if (!okAuto) missing.push('autoComplete="email"');
  return { ok: false, reason: 'RegisterScreen.tsx missing ' + missing.join(' + ') };
}

function checkScreenSafeArea() {
  const description =
    'Screen.tsx imports SafeAreaView from react-native-safe-area-context (NOT react-native)';
  emitEntry('screen-safe-area', description);
  const src = tryReadSrc('src/components/Screen.tsx');
  if (src == null) return { ok: false, reason: 'src/components/Screen.tsx missing' };
  const importsFromContext = /from\s+['"]react-native-safe-area-context['"]/.test(src);
  // Check no destructured SafeAreaView from react-native:
  //   imports look like: import { ..., SafeAreaView, ... } from 'react-native';
  // We match the import line(s) for react-native and check the symbol list.
  const rnImportRe =
    /import\s*(?:[^;]*?\{([^}]*)\}|[^;]*?)\s*from\s*['"]react-native['"]\s*;?/g;
  let m;
  let destructuredFromRN = false;
  while ((m = rnImportRe.exec(src))) {
    if (m[1] && /\bSafeAreaView\b/.test(m[1])) {
      destructuredFromRN = true;
      break;
    }
  }
  if (importsFromContext && !destructuredFromRN) return { ok: true };
  const reasons = [];
  if (!importsFromContext) reasons.push('does not import from react-native-safe-area-context');
  if (destructuredFromRN) reasons.push('SafeAreaView is destructured from react-native');
  return { ok: false, reason: 'Screen.tsx ' + reasons.join(' + ') };
}

function checkAppSafeAreaProvider() {
  const description =
    'App.tsx wraps the tree with SafeAreaProvider imported from react-native-safe-area-context';
  emitEntry('app-safe-area-provider', description);
  // App.tsx lives at the frontend root, not under src/
  const src = tryReadSrc('App.tsx');
  if (src == null) return { ok: false, reason: 'App.tsx missing' };
  const hasProvider = src.includes('SafeAreaProvider');
  const importsFromContext = /from\s+['"]react-native-safe-area-context['"]/.test(src);
  if (hasProvider && importsFromContext) return { ok: true };
  const reasons = [];
  if (!hasProvider) reasons.push('SafeAreaProvider not referenced');
  if (!importsFromContext) reasons.push('does not import from react-native-safe-area-context');
  return { ok: false, reason: 'App.tsx ' + reasons.join(' + ') };
}

// ─── all-touchables (multi-failure) ──────────────────────────────────────────

function walkTsx(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsx(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

const TOUCH_ELEMENTS = ['TouchableOpacity', 'Pressable', 'TouchableHighlight'];
const EXEMPT_RE = /\/\/\s*touch-target-exempt:/;

function checkAllTouchables() {
  const description =
    'scanning all TouchableOpacity / Pressable / TouchableHighlight under frontend/src/';
  emitEntry('all-touchables', description);
  const srcDir = path.join(CWD, 'src');
  if (!fs.existsSync(srcDir)) {
    return { ok: false, fails: ['<missing>:0: frontend/src/ directory not found'] };
  }
  const files = walkTsx(srcDir, []);
  const fails = [];

  for (const filePath of files) {
    const src = fs.readFileSync(filePath, 'utf8');
    const lines = src.split('\n');
    const rel = path.relative(CWD, filePath);

    // Build StyleSheet key map: any styles.<key> definition containing minHeight: 44 in this file.
    // Match `<key>: { ... minHeight: 44 ... }` inside StyleSheet.create blocks (we just scan the
    // whole file for top-level keys — the StyleSheet.create wrapper is not load-bearing here).
    const styleKeys44 = new Set();
    const keyBlockRe = /(\w+)\s*:\s*\{([\s\S]*?)\}/g;
    let km;
    while ((km = keyBlockRe.exec(src))) {
      if (/minHeight:\s*44/.test(km[2])) {
        styleKeys44.add(km[1]);
      }
    }

    // Scan for each touch element open tag
    for (const el of TOUCH_ELEMENTS) {
      const tagRe = new RegExp('<' + el + '\\b', 'g');
      let tm;
      while ((tm = tagRe.exec(src))) {
        // Locate line number
        const lineNum = src.slice(0, tm.index).split('\n').length;
        const lineIdx = lineNum - 1;
        const sameLine = lines[lineIdx] || '';
        const prevLine = lines[lineIdx - 1] || '';

        // Opt-out exemption?
        if (EXEMPT_RE.test(sameLine) || EXEMPT_RE.test(prevLine)) continue;

        // Window: tag position ± 200 chars
        const winStart = Math.max(0, tm.index - 200);
        const winEnd = Math.min(src.length, tm.index + 600);
        const window = src.slice(winStart, winEnd);

        // (a) inline style with minHeight: 44
        if (/style=\{\{[^}]*minHeight:\s*44/.test(window)) continue;

        // (b) referenced styles.<key> in the window, and that key's block had minHeight: 44
        let hit = false;
        const refRe = /styles\.(\w+)/g;
        let rm;
        while ((rm = refRe.exec(window))) {
          if (styleKeys44.has(rm[1])) {
            hit = true;
            break;
          }
        }
        if (hit) continue;

        // Also support arrayed style spreads: pull every key out of `style={[styles.a, styles.b]}`
        // — if ANY referenced key has minHeight: 44, accept. (Documented limitation: doesn't
        // model what wins on conflict.)
        const arrayStyleRe = /style=\{\[([^\]]*)\]\}/g;
        let am;
        while (!hit && (am = arrayStyleRe.exec(window))) {
          const refsInArr = am[1].match(/styles\.(\w+)/g) || [];
          for (const ref of refsInArr) {
            const key = ref.slice('styles.'.length);
            if (styleKeys44.has(key)) {
              hit = true;
              break;
            }
          }
        }
        if (hit) continue;

        fails.push(`${rel}:${lineNum}: ${el} missing minHeight: 44`);
      }
    }
  }

  if (fails.length === 0) return { ok: true };
  return { ok: false, fails };
}

// ─── driver ──────────────────────────────────────────────────────────────────

// Order matters for --all aggregation cadence.
const REGISTRY = [
  ['button-small-44', checkButtonSmall44],
  ['finance-form-spot-fix-44', checkFinanceFormSpotFix44],
  ['tx-form-spot-fix-44', checkTxFormSpotFix44],
  ['profile-spot-fix-44', checkProfileSpotFix44],
  ['tx-amount-inputmode', checkTxAmountInputmode],
  ['login-email-props', checkLoginEmailProps],
  ['register-email-props', checkRegisterEmailProps],
  ['screen-safe-area', checkScreenSafeArea],
  ['app-safe-area-provider', checkAppSafeAreaProvider],
  ['all-touchables', checkAllTouchables],
];
const REGISTRY_MAP = Object.fromEntries(REGISTRY);

function runOne(name, fn, collectedFails) {
  const result = fn();
  if (result.ok) {
    emitPass(name);
    return true;
  }
  if (result.fails && result.fails.length > 0) {
    // multi-failure: emit one line per offender
    for (const f of result.fails) {
      const line = `FAIL: ${name} — ${f}`;
      process.stderr.write(line + '\n');
      collectedFails.push(line);
    }
  } else {
    const line = `FAIL: ${name} — ${result.reason || 'unknown failure'}`;
    process.stderr.write(line + '\n');
    collectedFails.push(line);
  }
  return false;
}

const argv = process.argv.slice(2);
const checkArg = argv.find((a) => a.startsWith('--check='))?.slice(8);
const allFlag = argv.includes('--all');
const allMode = allFlag || !checkArg;

if (checkArg) {
  const fn = REGISTRY_MAP[checkArg];
  if (!fn) {
    process.stderr.write('FAIL: unknown check name: ' + checkArg + '\n');
    process.exit(1);
  }
  // Single-check mode: still emit per-fail lines (does NOT use --all aggregation cadence),
  // but exits 1 if any fail, 0 if all pass.
  const collected = [];
  const ok = runOne(checkArg, fn, collected);
  process.exit(ok ? 0 : 1);
}

// --all mode
const collected = [];
for (const [name, fn] of REGISTRY) {
  runOne(name, fn, collected);
}
if (collected.length > 0) {
  process.exit(1);
}
process.stdout.write('==> all touch-target checks passed\n');
process.exit(0);
