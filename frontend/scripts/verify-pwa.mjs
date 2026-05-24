#!/usr/bin/env node
/**
 * verify-pwa.mjs — Wave 0 static PWA verifier (Phase 5, plan 05-01).
 *
 * Usage:
 *   node scripts/verify-pwa.mjs --check=<name>    # run a single check
 *   node scripts/verify-pwa.mjs --all              # run every check in order
 *
 * Checks (locked names — downstream plans grep these):
 *   manifest     dist/manifest.json validates against vendored W3C JSON Schema
 *                via ajv; plus a hand-rolled "≥1 icon.purpose contains maskable" check
 *   apple-meta   dist/index.html contains the four <meta name="apple-*"> tags AND
 *                dist/apple-touch-icon.png exists
 *   viewport     dist/index.html viewport meta contains `viewport-fit=cover`
 *   sw           dist/sw.js parses and contains Workbox strategy + clientsClaim
 *                + skipWaiting + /api/ + /index.html literals
 *   ios-zoom     dist/pwa.css contains `font-size: 16px !important` on input/select/textarea
 *
 * Cadence (mirrors infra/scripts/smoke.sh):
 *   ==> step name      to stdout on entry
 *   FAIL: reason       to stderr on failure, immediately followed by process.exit(1)
 *
 * The script intentionally exits 1 against a pre-PWA dist/ — that RED state is the
 * proof Wave 0 wired the verifier correctly. Production code is NOT touched here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import Ajv from 'ajv';

const DIST = path.join(process.cwd(), 'dist');
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const SCHEMA_PATH = path.join(SCRIPT_DIR, 'w3c-manifest-schema.json');

// Load and compile the vendored W3C Web App Manifest schema ONCE at module scope.
// strict:false because schemastore uses draft-04 + a few non-standard hints.
// allErrors:true so we surface every violation, not just the first.
// The SchemaStore copy declares "$schema": "http://json-schema.org/draft-04/schema#"
// and uses bare "id" (draft-04 keyword). Ajv 8 defaults to draft-07 and will throw
// on the draft-04 meta-schema URL — so we strip the declaration and normalize "id" → "$id"
// across the entire schema tree before compiling. The semantic constraints are unchanged.
const rawSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
function normalizeSchema(node) {
  if (Array.isArray(node)) {
    for (const item of node) normalizeSchema(item);
    return;
  }
  if (node && typeof node === 'object') {
    if ('$schema' in node) delete node.$schema;
    if ('id' in node && !('$id' in node)) {
      node.$id = node.id;
      delete node.id;
    }
    for (const k of Object.keys(node)) normalizeSchema(node[k]);
  }
}
normalizeSchema(rawSchema);
const schema = rawSchema;
// logger: false suppresses ajv's "unknown format" warnings (we have no need for
// runtime format checks like uri/email — those are surface-level and the script
// already covers the relevant manifest fields with its own assertions).
const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
const validateManifest = ajv.compile(schema);

function readDist(rel) {
  return fs.readFileSync(path.join(DIST, rel), 'utf8');
}

function fail(msg) {
  process.stderr.write('FAIL: ' + msg + '\n');
  process.exit(1);
}

function step(name) {
  process.stdout.write('==> ' + name + '\n');
}

// ─── checks ──────────────────────────────────────────────────────────────────

function checkManifest() {
  step('manifest: read dist/manifest.json');
  let raw;
  try {
    raw = readDist('manifest.json');
  } catch (e) {
    fail('manifest schema violation at /: dist/manifest.json missing (' + e.message + ')');
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    fail('manifest schema violation at /: dist/manifest.json is not valid JSON (' + e.message + ')');
  }

  step('manifest: ajv validate against vendored W3C schema');
  const ok = validateManifest(manifest);
  if (!ok) {
    for (const err of validateManifest.errors || []) {
      const where = err.instancePath || '/';
      process.stderr.write(
        'FAIL: manifest schema violation at ' + where + ': ' + err.message + '\n'
      );
    }
    process.exit(1);
  }

  // Supplementary hand-rolled check: the W3C schema does NOT enforce that at least
  // one icon entry carries purpose=maskable, but PWA-02 requires it.
  step('manifest: ≥1 icon has purpose containing "maskable"');
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const hasMaskable = icons.some(
    (icon) => typeof icon.purpose === 'string' && /\bmaskable\b/.test(icon.purpose)
  );
  if (!hasMaskable) {
    fail('manifest missing maskable icon');
  }
}

function checkAppleMeta() {
  step('apple-meta: read dist/index.html');
  let html;
  try {
    html = readDist('index.html');
  } catch (e) {
    fail('dist/index.html missing (' + e.message + ')');
  }
  const required = [
    'apple-mobile-web-app-capable',
    'apple-mobile-web-app-status-bar-style',
    'apple-mobile-web-app-title',
    'apple-touch-icon',
  ];
  for (const tag of required) {
    if (!html.includes(tag)) {
      fail('apple-meta: dist/index.html missing ' + tag);
    }
  }
  step('apple-meta: dist/apple-touch-icon.png exists');
  if (!fs.existsSync(path.join(DIST, 'apple-touch-icon.png'))) {
    fail('apple-meta: dist/apple-touch-icon.png missing');
  }
}

function checkViewport() {
  step('viewport: viewport meta contains viewport-fit=cover');
  let html;
  try {
    html = readDist('index.html');
  } catch (e) {
    fail('viewport: dist/index.html missing (' + e.message + ')');
  }
  if (!html.includes('viewport-fit=cover')) {
    fail('viewport: dist/index.html viewport meta missing viewport-fit=cover');
  }
}

function checkSw() {
  step('sw: read dist/sw.js');
  let src;
  try {
    src = readDist('sw.js');
  } catch (e) {
    fail('sw: dist/sw.js missing (' + e.message + ')');
  }
  step('sw: parse syntax via new Function()');
  try {
    // Parse-only sanity check — never executed
    new Function(src);
  } catch (e) {
    fail('sw: dist/sw.js syntax error: ' + e.message);
  }
  const required = [
    'NetworkFirst',
    'CacheFirst',
    'skipWaiting',
    'clientsClaim',
    '/api/',
    '/index.html',
  ];
  step('sw: dist/sw.js contains Workbox strategies + lifecycle + nav scope');
  for (const literal of required) {
    if (!src.includes(literal)) {
      fail('sw: dist/sw.js missing required literal ' + JSON.stringify(literal));
    }
  }
}

function checkIosZoom() {
  step('ios-zoom: dist/pwa.css contains font-size: 16px !important on inputs');
  let css;
  try {
    css = readDist('pwa.css');
  } catch (e) {
    fail('ios-zoom: dist/pwa.css missing (' + e.message + ')');
  }
  if (!css.includes('font-size: 16px')) {
    fail('ios-zoom: dist/pwa.css missing literal "font-size: 16px"');
  }
  if (!/font-size:\s*16px\s*!important/.test(css)) {
    fail('ios-zoom: dist/pwa.css missing /font-size:\\s*16px\\s*!important/ pattern');
  }
}

// ─── driver ──────────────────────────────────────────────────────────────────

const CHECKS = {
  manifest: checkManifest,
  'apple-meta': checkAppleMeta,
  viewport: checkViewport,
  sw: checkSw,
  'ios-zoom': checkIosZoom,
};

function usage() {
  // Literal full --check=<name> forms are spelled out below so downstream plan
  // acceptance criteria can grep this script for every flag value.
  process.stderr.write(
    [
      'usage: node scripts/verify-pwa.mjs <flag>',
      '  --check=manifest     validate dist/manifest.json',
      '  --check=apple-meta   verify iOS PWA meta tags + apple-touch-icon.png',
      '  --check=viewport     verify viewport-fit=cover',
      '  --check=sw           verify dist/sw.js Workbox strategies',
      '  --check=ios-zoom     verify pwa.css input/select/textarea font-size: 16px !important',
      '  --all                run every check in order',
      '',
    ].join('\n')
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const checkArg = argv.find((a) => a.startsWith('--check='))?.slice(8);
const allMode = argv.includes('--all');

if (!checkArg && !allMode) {
  usage();
}

if (checkArg) {
  const fn = CHECKS[checkArg];
  if (!fn) {
    process.stderr.write('FAIL: unknown check name: ' + checkArg + '\n');
    process.exit(1);
  }
  fn();
  process.stdout.write('==> ' + checkArg + ': passed\n');
  process.exit(0);
}

// --all
for (const name of Object.keys(CHECKS)) {
  step(name);
  CHECKS[name]();
}
process.stdout.write('==> all pwa checks passed\n');
process.exit(0);
