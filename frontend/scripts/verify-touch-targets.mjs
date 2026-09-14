#!/usr/bin/env node
/**
 * verify-touch-targets.mjs — static touch-target / input-affordance verifier (04 §7.1).
 *
 * Rewritten for the v3.0 tree: the v2 layout it used to check (`src/components/*`,
 * `src/screens/<Name>Screen.tsx`, a root `App.tsx`) no longer exists. The component
 * library now lives in `src/ui/`, pages in `src/screens/<area>/`, and the provider tree
 * in `app/_layout.tsx`.
 *
 * KNOWN LIMITATION: `all-touchables` is regex-based, not AST-based. A style value that
 * only becomes 44 after a runtime computation, or a style key defined in another file,
 * cannot be resolved — those sites need the `// touch-target-exempt:` opt-out with a
 * reason. Conversely, a file that defines *some* style key with `minHeight: 44` and
 * references it near a touchable is accepted without proving that key wins a style
 * conflict.
 *
 * Usage:
 *   node scripts/verify-touch-targets.mjs --check=<name>   # single check, exit 0 PASS / 1 FAIL
 *   node scripts/verify-touch-targets.mjs --all            # every check, aggregate failures
 *   node scripts/verify-touch-targets.mjs                  # defaults to --all
 *
 * Check-name registry (6 stable names — downstream plans grep these):
 *   button-min-44            src/ui/Button.tsx sizes the tap target: a `minHeight: 44`
 *                            (or larger) or a `hitSlop` that guarantees it
 *   amount-inputmode         src/ui/AmountField.tsx declares BOTH inputMode="decimal"
 *                            and keyboardType="decimal-pad"
 *   login-email-props        src/screens/auth/LoginScreen.tsx has keyboardType
 *                            "email-address" + autoComplete "email"
 *   register-email-props     src/screens/auth/RegisterScreen.tsx, same two props
 *   root-safe-area-provider  app/_layout.tsx wraps the tree with SafeAreaProvider from
 *                            react-native-safe-area-context
 *   all-touchables           every <Pressable|TouchableOpacity|TouchableHighlight> under
 *                            src/ui/ and src/screens/ has minHeight/height ≥ 44 (inline
 *                            or through a styles.<key> in the same file), a `hitSlop`,
 *                            or a `// touch-target-exempt: <reason>` comment
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

function tryReadSrc(rel) {
  try {
    return fs.readFileSync(path.join(CWD, rel), 'utf8');
  } catch {
    return null;
  }
}

function emitEntry(name, description) {
  process.stdout.write(`==> verify-touch-targets[${name}]: ${description}\n`);
}

function emitPass(name) {
  process.stdout.write(`PASS: ${name}\n`);
}

// ─── size resolution ─────────────────────────────────────────────────────────

/**
 * Heights are rarely written as bare numbers in this codebase — they come from the design
 * tokens (`density.listRowHeight`, `controls.button.heights.md`) or a file-local constant
 * (`const BAR_HEIGHT = 8`). So the checker resolves those references instead of only
 * matching digits; an unresolvable reference counts as "not proven ≥ 44".
 *
 * `src/theme/tokens.ts` is generated plain data (`export const x = { ... } as const;`), so
 * each top-level object literal is lifted out by brace matching and evaluated.
 */
function loadTokenValues() {
  const src = tryReadSrc('src/theme/tokens.ts');
  const out = {};
  if (src == null) return out;
  const declRe = /export const (\w+)(?::[^=]+)?\s*=\s*/g;
  let m;
  while ((m = declRe.exec(src))) {
    const start = declRe.lastIndex;
    if (src[start] !== '{') continue;
    const end = matchBrace(src, start);
    if (end < 0) continue;
    const literal = src.slice(start, end + 1).replace(/\bas const\b/g, '');
    try {
      // Generated data only: object/array/number/string literals, no identifiers.
      out[m[1]] = new Function('return (' + literal + ')')();
    } catch {
      /* a declaration that references other bindings — not a size source, skip it */
    }
  }
  return out;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const TOKEN_VALUES = loadTokenValues();

/** `density.listRowHeight` / `controls.button.heights.md` → its number, or null. */
function lookupPath(expr) {
  const parts = expr.split('.');
  let node = TOKEN_VALUES;
  for (const part of parts) {
    if (node == null || typeof node !== 'object' || !(part in node)) return null;
    node = node[part];
  }
  return typeof node === 'number' ? node : null;
}

/** File-local `const NAME = 48;` bindings. */
function localNumbers(src) {
  const out = {};
  const re = /\bconst\s+(\w+)\s*(?::\s*number\s*)?=\s*(\d+)\s*;/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = Number(m[2]);
  return out;
}

/** Resolve one `height:`/`minHeight:` right-hand side to a number, or null. */
function resolveSize(expr, locals) {
  const value = expr.trim().replace(/^\{\s*/, '').replace(/\s*\}$/, '').trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value)) return lookupPath(value);
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return locals[value] ?? null;
  return null;
}

/**
 * A style that stretches to its parent's height: a full-screen backdrop
 * (`StyleSheet.absoluteFill*`, `position: 'absolute'` pinned on all four sides) or an
 * explicit `height: '100%'`. Those targets are as tall as whatever contains them, which
 * a static checker cannot measure but which is never a 20px tap target.
 */
function fillsParent(text) {
  if (/StyleSheet\.absoluteFill/.test(text)) return true;
  if (/\bheight\s*:\s*['"]100%['"]/.test(text)) return true;
  if (/position\s*:\s*['"]absolute['"]/.test(text) && /\btop\s*:/.test(text) && /\bbottom\s*:/.test(text)) {
    return true;
  }
  return false;
}

/**
 * Vertical padding of 14 or more. A line of body text is at least 16px tall, so
 * `paddingVertical: 14` already puts the element past 44 — that is the C2 density's
 * `rowInnerPadding`, which is how most rows in this codebase reach a full-size target.
 */
function hasTallPadding(text, locals = {}) {
  const re = /\bpadding(?:Vertical)?\s*:\s*([^,;\n}]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const n = resolveSize(m[1], locals);
    if (n !== null && n >= 14) return true;
  }
  return false;
}

/** `minHeight: 44` / `height: density.listRowHeight` / `minHeight={48}` — any ≥ 44. */
function hasSize44(text, locals = {}) {
  const re = /\b(?:min)?[Hh]eight\s*[:=]\s*([^,;\n}]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const n = resolveSize(m[1], locals);
    if (n !== null && n >= 44) return true;
  }
  return false;
}

// ─── single-failure checks ───────────────────────────────────────────────────

function checkButtonMin44() {
  const description =
    'src/ui/Button.tsx gives its Pressable a ≥44 tap target (minHeight or hitSlop)';
  emitEntry('button-min-44', description);
  const src = tryReadSrc('src/ui/Button.tsx');
  if (src == null) return { ok: false, reason: 'src/ui/Button.tsx missing' };
  if (hasSize44(src)) return { ok: true };
  if (/hitSlop\s*=/.test(src)) return { ok: true };
  return {
    ok: false,
    reason: 'Button.tsx declares neither a ≥44 (min)height nor a hitSlop',
  };
}

function checkAmountInputmode() {
  const description =
    'src/ui/AmountField.tsx declares inputMode="decimal" AND keyboardType="decimal-pad"';
  emitEntry('amount-inputmode', description);
  const src = tryReadSrc('src/ui/AmountField.tsx');
  if (src == null) return { ok: false, reason: 'src/ui/AmountField.tsx missing' };
  const missing = [];
  if (!src.includes('inputMode="decimal"')) missing.push('inputMode="decimal"');
  if (!src.includes('keyboardType="decimal-pad"')) missing.push('keyboardType="decimal-pad"');
  if (missing.length === 0) return { ok: true };
  return { ok: false, reason: 'AmountField.tsx missing ' + missing.join(' + ') };
}

function emailPropsCheck(name, rel, label) {
  const description = `${label} declares keyboardType="email-address" and autoComplete="email"`;
  emitEntry(name, description);
  const src = tryReadSrc(rel);
  if (src == null) return { ok: false, reason: `${rel} missing` };
  const missing = [];
  if (!src.includes('keyboardType="email-address"')) missing.push('keyboardType="email-address"');
  if (!src.includes('autoComplete="email"')) missing.push('autoComplete="email"');
  if (missing.length === 0) return { ok: true };
  return { ok: false, reason: `${label} missing ` + missing.join(' + ') };
}

function checkLoginEmailProps() {
  return emailPropsCheck(
    'login-email-props',
    'src/screens/auth/LoginScreen.tsx',
    'LoginScreen.tsx',
  );
}

function checkRegisterEmailProps() {
  return emailPropsCheck(
    'register-email-props',
    'src/screens/auth/RegisterScreen.tsx',
    'RegisterScreen.tsx',
  );
}

function checkRootSafeAreaProvider() {
  const description =
    'app/_layout.tsx wraps the tree with SafeAreaProvider from react-native-safe-area-context';
  emitEntry('root-safe-area-provider', description);
  const src = tryReadSrc('app/_layout.tsx');
  if (src == null) return { ok: false, reason: 'app/_layout.tsx missing' };
  const reasons = [];
  if (!/<SafeAreaProvider[\s>]/.test(src)) reasons.push('no <SafeAreaProvider> element');
  if (!/from\s+['"]react-native-safe-area-context['"]/.test(src)) {
    reasons.push('does not import from react-native-safe-area-context');
  }
  if (reasons.length === 0) return { ok: true };
  return { ok: false, reason: 'app/_layout.tsx ' + reasons.join(' + ') };
}

// ─── all-touchables (multi-failure) ──────────────────────────────────────────

/** Directories scanned for touch targets — the component library and the pages. */
const SCAN_DIRS = ['src/ui', 'src/screens'];

function walkTsx(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
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
const EXEMPT_RE = /touch-target-exempt:/;
/** How many lines above the tag an exemption comment may sit (it usually carries a reason). */
const EXEMPT_LOOKBACK = 3;

/**
 * The text of the JSX element that starts at `start`: from `<El` to the matching `>` of
 * the opening tag, plus a little of what follows (a style callback's body often sits just
 * past it). Brace-aware, so `style={(state) => [...]}` is not cut in half.
 */
function openingTag(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start, Math.min(src.length, start + 1200));
}

function checkAllTouchables() {
  const description =
    'scanning every TouchableOpacity / Pressable / TouchableHighlight under src/ui/ and src/screens/';
  emitEntry('all-touchables', description);

  const files = [];
  const missingDirs = [];
  for (const rel of SCAN_DIRS) {
    const abs = path.join(CWD, rel);
    if (!fs.existsSync(abs)) {
      missingDirs.push(rel);
      continue;
    }
    walkTsx(abs, files);
  }
  if (missingDirs.length > 0) {
    return { ok: false, fails: missingDirs.map((d) => `<missing>:0: ${d}/ not found`) };
  }
  files.sort();

  const fails = [];

  for (const filePath of files) {
    const src = fs.readFileSync(filePath, 'utf8');
    const lines = src.split('\n');
    const rel = path.relative(CWD, filePath);
    const locals = localNumbers(src);

    // Style keys in this file whose block declares a ≥44 (min)height, or fills its parent
    // (`StyleSheet.absoluteFill*`, `height: '100%'`). Blocks are brace-matched, so a
    // nested object (`shadowOffset: { ... }`) does not truncate the block.
    const bigKeys = new Set();
    const keyRe = /(\w+)\s*:\s*\{/g;
    let km;
    while ((km = keyRe.exec(src))) {
      const open = km.index + km[0].length - 1;
      const close = matchBrace(src, open);
      if (close < 0) continue;
      const block = src.slice(open + 1, close);
      if (hasSize44(block, locals) || fillsParent(block) || hasTallPadding(block, locals)) {
        bigKeys.add(km[1]);
      }
    }

    for (const el of TOUCH_ELEMENTS) {
      const tagRe = new RegExp('<' + el + '\\b', 'g');
      let tm;
      while ((tm = tagRe.exec(src))) {
        const lineNum = src.slice(0, tm.index).split('\n').length;

        // (a) opt-out comment on the tag's line or just above it
        let exempt = false;
        for (let i = lineNum - 1; i >= Math.max(0, lineNum - 1 - EXEMPT_LOOKBACK); i -= 1) {
          if (EXEMPT_RE.test(lines[i] ?? '')) {
            exempt = true;
            break;
          }
        }
        if (exempt) continue;

        const tag = openingTag(src, tm.index);

        // (b) a hitSlop on the element itself
        if (/hitSlop\s*=/.test(tag)) continue;

        // (c) a ≥44 (min)height written into the element's own props/styles, or a style
        //     that makes it fill its parent (a full-screen backdrop, a full-height column)
        if (hasSize44(tag, locals) || fillsParent(tag) || hasTallPadding(tag, locals)) continue;

        // (d) a styles.<key> referenced by the element whose block declares a ≥44 height
        let hit = false;
        const refRe = /styles\.(\w+)/g;
        let rm;
        while ((rm = refRe.exec(tag))) {
          if (bigKeys.has(rm[1])) {
            hit = true;
            break;
          }
        }
        if (hit) continue;

        fails.push(
          `${rel}:${lineNum}: ${el} has no minHeight ≥ 44, no hitSlop and no ` +
            '"// touch-target-exempt: <reason>" comment',
        );
      }
    }
  }

  if (fails.length === 0) return { ok: true };
  return { ok: false, fails };
}

// ─── driver ──────────────────────────────────────────────────────────────────

// Order matters for --all aggregation cadence.
const REGISTRY = [
  ['button-min-44', checkButtonMin44],
  ['amount-inputmode', checkAmountInputmode],
  ['login-email-props', checkLoginEmailProps],
  ['register-email-props', checkRegisterEmailProps],
  ['root-safe-area-provider', checkRootSafeAreaProvider],
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
    // multi-failure: one line per offender
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

if (checkArg) {
  const fn = REGISTRY_MAP[checkArg];
  if (!fn) {
    process.stderr.write('FAIL: unknown check name: ' + checkArg + '\n');
    process.exit(1);
  }
  const collected = [];
  const ok = runOne(checkArg, fn, collected);
  process.exit(ok ? 0 : 1);
}

// --all mode (also the default with no flag)
const collected = [];
for (const [name, fn] of REGISTRY) {
  runOne(name, fn, collected);
}
if (collected.length > 0) {
  process.exit(1);
}
process.stdout.write('==> all touch-target checks passed\n');
process.exit(0);
