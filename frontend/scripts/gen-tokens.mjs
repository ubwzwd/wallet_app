#!/usr/bin/env node
/**
 * gen-tokens.mjs — generate src/theme/tokens.ts from docs/target-design/mockups/tokens.json.
 *
 * tokens.json is the single source of truth for the visual design (04 §6.2, decision §14.45).
 * Components must only ever read semantic names from the generated module; literal colour
 * values are not allowed anywhere else in the frontend.
 *
 * Usage:
 *   node scripts/gen-tokens.mjs           # (re)write src/theme/tokens.ts
 *   node scripts/gen-tokens.mjs --check   # exit 1 if the committed file is stale
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(here, '../../docs/target-design/mockups/tokens.json');
const OUT = path.resolve(here, '../src/theme/tokens.ts');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const colorKeys = Object.keys(raw.color.light);
const darkKeys = Object.keys(raw.color.dark);
if (colorKeys.join() !== darkKeys.join()) {
  throw new Error('tokens.json: light and dark colour key sets differ');
}

const q = (s) => JSON.stringify(s);
const lit = (v) => JSON.stringify(v, null, 2).replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, '$1:');

const typeEntries = Object.entries(raw.type).map(([k, v]) => [k.replace(/^text\./, ''), v]);
const spaceEntries = Object.entries(raw.space).map(([k, v]) => [k.replace(/^space\./, ''), v]);
const seriesCount = colorKeys.filter((k) => k.startsWith('chart.series[')).length;

const lines = [];
lines.push('/* eslint-disable */');
lines.push('/**');
lines.push(' * GENERATED FILE — do not edit by hand.');
lines.push(' * Source: docs/target-design/mockups/tokens.json (version ' + raw.version + ').');
lines.push(' * Regenerate with `node scripts/gen-tokens.mjs`; `--check` verifies it is current.');
lines.push(' */');
lines.push('');
lines.push('export const TOKENS_VERSION = ' + q(raw.version) + ';');
lines.push('export const TOKENS_DIRECTION = ' + q(raw.direction) + ';');
lines.push('');
lines.push('export type ColorToken =');
lines.push(colorKeys.map((k) => '  | ' + q(k)).join('\n') + ';');
lines.push('');
lines.push('export type ColorScheme = \'light\' | \'dark\';');
lines.push('export type Palette = Readonly<Record<ColorToken, string>>;');
lines.push('');
lines.push('export const lightColors: Palette = {');
for (const k of colorKeys) lines.push('  ' + q(k) + ': ' + q(raw.color.light[k]) + ',');
lines.push('};');
lines.push('');
lines.push('export const darkColors: Palette = {');
for (const k of colorKeys) lines.push('  ' + q(k) + ': ' + q(raw.color.dark[k]) + ',');
lines.push('};');
lines.push('');
lines.push('export const palettes: Readonly<Record<ColorScheme, Palette>> = { light: lightColors, dark: darkColors };');
lines.push('');
lines.push('/** The ' + seriesCount + ' category / chart colours (04 §6.2 rule 3) — never the four kind colours. */');
lines.push('export const CHART_SERIES_COUNT = ' + seriesCount + ';');
lines.push('export function chartSeries(p: Palette): readonly string[] {');
lines.push('  return [' + Array.from({ length: seriesCount }, (_, i) => 'p[' + q('chart.series[' + i + ']') + ']').join(', ') + '];');
lines.push('}');
lines.push('');
lines.push('export const font = ' + lit(raw.font) + ' as const;');
lines.push('');
lines.push('export type TypeVariant = ' + typeEntries.map(([k]) => q(k)).join(' | ') + ';');
lines.push('export const type: Readonly<Record<TypeVariant, { size: number; lineHeight: number; weight: number }>> = ' + lit(Object.fromEntries(typeEntries)) + ';');
lines.push('export const TYPE_NOTES = ' + q(raw.typeNotes) + ';');
lines.push('');
lines.push('export const space = ' + lit(Object.fromEntries(spaceEntries)) + ' as const;');
lines.push('export type SpaceStep = keyof typeof space;');
lines.push('');
lines.push('export const density = ' + lit(raw.density) + ' as const;');
lines.push('export const radius = ' + lit({ sm: raw.radius.sm, md: raw.radius.md, lg: raw.radius.lg, pill: raw.radius.pill }) + ' as const;');
lines.push('export const RADIUS_USAGE = ' + q(raw.radius.usage) + ';');
lines.push('export const shadow = ' + lit(raw.shadow) + ' as const;');
lines.push('export const controls = ' + lit(raw.controls) + ' as const;');
lines.push('export const icons = ' + lit(raw.icons) + ' as const;');
lines.push('export const kindSemantics = ' + lit(raw.kindSemantics) + ' as const;');
lines.push('');
lines.push('/* Not part of the visual sign-off (04 §6.2, last paragraph): values are ours to choose. */');
lines.push('export const z = { dropdown: 100, sticky: 200, overlay: 300, toast: 400 } as const;');
lines.push('/** Milliseconds; both collapse to 0 under prefers-reduced-motion. */');
lines.push('export const motion = { fast: 120, base: 200 } as const;');
lines.push('/** The single breakpoint (decision §0.6): below = narrow (bottom tabs), at/above = wide (sidebar). */');
lines.push('export const breakpoint = { md: 1024 } as const;');
lines.push('');

const text = lines.join('\n');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    process.stderr.write('FAIL: src/theme/tokens.ts is stale — run `node scripts/gen-tokens.mjs`\n');
    process.exit(1);
  }
  process.stdout.write('PASS: src/theme/tokens.ts matches tokens.json\n');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  process.stdout.write('wrote ' + path.relative(process.cwd(), OUT) + ' (' + colorKeys.length + ' colour tokens)\n');
}
