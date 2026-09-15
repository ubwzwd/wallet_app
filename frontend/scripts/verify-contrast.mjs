#!/usr/bin/env node
/**
 * verify-contrast.mjs — WCAG 2.1 contrast gate for the design tokens (阶段 7 验收).
 *
 * The 17 mockup frames are the single source of truth for colour (决策 §14.45), and both
 * palettes are generated from `docs/target-design/mockups/tokens.json` into
 * `src/theme/tokens.ts`. Neither file may be hand-edited, so this script only *reads* the
 * JSON and reports: a failing pair is a decision for the orchestrator, never a silent
 * nudge of a hex value.
 *
 * What is checked, in both the light and the dark set:
 *
 *   body        fg.primary / fg.secondary over bg.canvas, bg.surface, bg.raised, bg.subtle
 *               — the running text of every page                              ≥ 4.5
 *   kind        the four transaction colours over their own `.subtle` tint and
 *               over bg.raised — amounts and kind badges                      ≥ 3.0 (badge)
 *               with the amount reading, on bg.raised, held to                ≥ 4.5
 *   button      accent.fg over accent.solid, and fg.inverse over accent.solid ≥ 4.5
 *   status      the four status `fg` over their own `bg`, and over bg.raised  ≥ 3.0 / ≥ 4.5
 *   flags       the three import flag colours over bg.raised (badge text)     ≥ 3.0
 *   muted       fg.muted over bg.canvas / bg.surface / bg.raised — captions   ≥ 4.5
 *   chart       the 8 series colours over bg.raised (bars, dots)              ≥ 3.0
 *
 * Usage:
 *   node scripts/verify-contrast.mjs            # every pair, exit 1 on any failure
 *   node scripts/verify-contrast.mjs --list     # print every pair and its ratio, exit 0
 *
 * Emit-string contract:
 *   ==> verify-contrast[<scheme>]: <n> pairs        stdout
 *   note <scheme> <ratio> ... <fg> on <bg>          stdout (reported, never gating)
 *   PASS: verify-contrast                           stdout
 *   FAIL: <scheme> <fg> on <bg> — <ratio> < <min> (<role>)   stderr
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = path.resolve(HERE, '../../docs/target-design/mockups/tokens.json');

/** Normal-size body text (WCAG 2.1 SC 1.4.3). */
const BODY_MIN = 4.5;
/** Large text, badge text and non-text UI components (SC 1.4.3 large / SC 1.4.11). */
const LARGE_MIN = 3.0;

// ------------------------------------------------------------------ WCAG maths

/** `#RGB` / `#RRGGBB` → `[r, g, b]`, each 0–255. */
function parseHex(hex) {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** WCAG 2.1 relative luminance (sRGB, the exact formula from the spec). */
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1–21. Order of the two colours does not matter. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ----------------------------------------------------------------- the pairings

const KINDS = ['expense', 'income', 'refund', 'transfer'];
const STATUSES = ['success', 'warning', 'danger', 'info'];
const FLAGS = ['duplicate', 'needs_review', 'uncategorized'];
const SERIES = 8;

/**
 * Every pair to check, as `{ fg, bg, min, role }` token-name triples. Built from names
 * rather than values so the report names the tokens, which is what a fix would have to
 * talk about.
 */
function pairs() {
  const out = [];
  const add = (fg, bg, min, role) => out.push({ fg, bg, min, role, gated: true });
  /**
   * Printed with its ratio but not gated. WCAG SC 1.4.11 asks for 3:1 only on the visual
   * information *required to identify* a control; in this design every input, chip and
   * card is identified by its own fill (bg.subtle / bg.raised against bg.canvas), and
   * these two borders are the decorative hairline drawn on top of that fill. The focus
   * ring, which IS the identifying indicator, is gated below.
   */
  const note = (fg, bg, role) => out.push({ fg, bg, min: LARGE_MIN, role, gated: false });

  // Running text. Every surface a paragraph can sit on.
  for (const bg of ['bg.canvas', 'bg.surface', 'bg.raised', 'bg.subtle']) {
    add('fg.primary', bg, BODY_MIN, 'body');
    add('fg.secondary', bg, BODY_MIN, 'body');
  }
  // Captions and hints — still body-sized, so still 4.5 (04 §6.2 rule 6).
  for (const bg of ['bg.canvas', 'bg.surface', 'bg.raised']) {
    add('fg.muted', bg, BODY_MIN, 'caption');
  }

  // The four transaction colours: as an amount on a card, and as badge text on their tint.
  for (const kind of KINDS) {
    add(`kind.${kind}`, 'bg.raised', BODY_MIN, 'amount');
    add(`kind.${kind}`, 'bg.canvas', BODY_MIN, 'amount');
    add(`kind.${kind}`, `kind.${kind}.subtle`, LARGE_MIN, 'kind badge');
  }

  // The primary button, and anything else that puts the inverse foreground on the accent.
  add('accent.fg', 'accent.solid', BODY_MIN, 'button');
  add('fg.inverse', 'accent.solid', BODY_MIN, 'button');
  add('accent.solid', 'bg.raised', BODY_MIN, 'link');
  add('accent.solid', 'bg.canvas', BODY_MIN, 'link');
  add('accent.solid', 'accent.subtle', LARGE_MIN, 'selected nav');

  // Status colours, on their own tint (badge) and on a card (sentence).
  for (const s of STATUSES) {
    add(`status.${s}.fg`, `status.${s}.bg`, LARGE_MIN, 'status badge');
    add(`status.${s}.fg`, 'bg.raised', BODY_MIN, 'status text');
  }

  // Import row flags — badge text on a card (屏幕稿 03).
  for (const f of FLAGS) add(`flag.${f}`, 'bg.raised', LARGE_MIN, 'flag badge');

  // Chart series: bars and legend dots are non-text UI (SC 1.4.11).
  for (let i = 0; i < SERIES; i += 1) {
    add(`chart.series[${i}]`, 'bg.raised', LARGE_MIN, 'chart series');
  }

  // The focus indicator is non-text UI that has to be identifiable (SC 1.4.11, 2.4.11).
  add('border.focus', 'bg.raised', LARGE_MIN, 'focus ring');
  add('border.focus', 'bg.canvas', LARGE_MIN, 'focus ring');
  // Decorative hairlines — reported, not gated (see `note` above).
  note('border.strong', 'bg.raised', 'decorative border');
  note('border.default', 'bg.raised', 'decorative border');

  return out;
}

// ------------------------------------------------------------------------ main

function main() {
  const list = process.argv.includes('--list');
  const json = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const schemes = ['light', 'dark'];
  const failures = [];
  const checked = pairs();
  const gatedPerScheme = checked.filter((p) => p.gated).length;
  const gatedTotal = gatedPerScheme * schemes.length;

  for (const scheme of schemes) {
    const palette = json.color?.[scheme];
    if (!palette) {
      console.error(`FAIL: tokens.json has no "${scheme}" colour set`);
      process.exit(1);
    }
    console.log(`==> verify-contrast[${scheme}]: ${gatedPerScheme} pairs`);

    for (const { fg, bg, min, role, gated } of checked) {
      const fgHex = palette[fg];
      const bgHex = palette[bg];
      if (fgHex === undefined || bgHex === undefined) {
        failures.push(`${scheme} ${fg} on ${bg} — token missing from tokens.json (${role})`);
        continue;
      }
      const ratio = contrastRatio(fgHex, bgHex);
      const rounded = Math.round(ratio * 100) / 100;
      if (list || !gated) {
        const mark = !gated ? 'note' : ratio + 1e-9 >= min ? 'ok  ' : 'FAIL';
        console.log(
          `    ${mark} ${scheme.padEnd(5)} ${rounded.toFixed(2).padStart(6)} ` +
            `(min ${min.toFixed(1)})  ${fg} on ${bg}  [${role}]`,
        );
      }
      // A hair of tolerance: the ratios are exact rationals, but a token sitting bang on
      // 4.5 should not fail on a floating-point last bit.
      if (gated && ratio + 1e-9 < min) {
        failures.push(
          `${scheme} ${fg} on ${bg} — ${rounded.toFixed(2)} < ${min.toFixed(1)} (${role})`,
        );
      }
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    console.error(
      `FAIL: verify-contrast — ${failures.length}/${checked.length * schemes.length} pairs ` +
        'below the WCAG 2.1 minimum. tokens.json and src/theme/tokens.ts are generated and ' +
        'protected: report these, do not edit them.',
    );
    process.exit(1);
  }
  console.log('PASS: verify-contrast');
}

main();
