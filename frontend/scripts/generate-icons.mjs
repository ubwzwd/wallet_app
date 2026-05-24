#!/usr/bin/env node
/**
 * generate-icons.mjs — Phase 5, plan 05-02 Task 2.
 *
 * Sharp-based icon generator (canonical production method per revised D-10).
 *
 * Reads:   frontend/assets/adaptive-icon.png  (design source per D-11)
 * Writes:  frontend/public/192.png            (192x192, purpose=any)
 *          frontend/public/512.png            (512x512, purpose=any)
 *          frontend/public/512-maskable.png   (512x512, purpose=maskable; foreground at 80% safe zone)
 *          frontend/public/apple-touch-icon.png (180x180 iOS home-screen icon)
 *          frontend/public/favicon.ico        (32x32 ICO; see Part C below)
 *
 * Background: solid #0ea5e9 (UI-SPEC accent / D-11).
 *
 * Re-run after any logo or color change: `cd frontend && node scripts/generate-icons.mjs`.
 *
 * favicon.ico approach (Part C): sharp does not emit ICO natively. We render a
 * 32x32 PNG buffer via sharp, then wrap it in a minimal 22-byte ICONDIR + ICONDIRENTRY
 * header and append the PNG payload (modern browsers accept PNG-encoded ICOs;
 * Windows Vista+ also supports embedded-PNG icons). This avoids an ImageMagick dep.
 */

import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const FRONTEND = path.resolve(SCRIPT_DIR, '..');
const SRC = path.join(FRONTEND, 'assets/adaptive-icon.png');
const OUT_DIR = path.join(FRONTEND, 'public');

const BG = { r: 0x0e, g: 0xa5, b: 0xe9, alpha: 1 };

async function emit(outName, canvasSize, foregroundScale) {
  const sourceBuf = fs.readFileSync(SRC);
  const fgSize = Math.round(canvasSize * foregroundScale);

  // Resize the source to a centered fgSize × fgSize PNG buffer.
  const fgBuf = await sharp(sourceBuf)
    .resize(fgSize, fgSize, { fit: 'contain', background: BG })
    .png()
    .toBuffer();

  // Composite the foreground onto a full canvas of solid BG.
  const outPath = path.join(OUT_DIR, outName);
  await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: fgBuf, gravity: 'center' }])
    .png()
    .toFile(outPath);

  process.stdout.write(`==> generate-icons: wrote frontend/public/${outName}\n`);
}

async function emitFavicon() {
  // Render a 32x32 PNG buffer (same composition as the larger icons).
  const sourceBuf = fs.readFileSync(SRC);
  const fgBuf = await sharp(sourceBuf)
    .resize(32, 32, { fit: 'contain', background: BG })
    .png()
    .toBuffer();
  const pngBuf = await sharp({
    create: { width: 32, height: 32, channels: 4, background: BG },
  })
    .composite([{ input: fgBuf, gravity: 'center' }])
    .png()
    .toBuffer();

  // Build a minimal ICO containing one PNG-encoded 32x32 frame.
  // ICONDIR (6 bytes):
  //   reserved=0 (uint16), type=1 (uint16, ICO), count=1 (uint16)
  // ICONDIRENTRY (16 bytes):
  //   width=32, height=32, colorCount=0, reserved=0,
  //   planes=1 (uint16), bitCount=32 (uint16),
  //   bytesInRes=<png length> (uint32), imageOffset=22 (uint32)
  const header = Buffer.alloc(6 + 16);
  // ICONDIR
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type
  header.writeUInt16LE(1, 4); // count
  // ICONDIRENTRY
  header.writeUInt8(32, 6);  // width (0 means 256)
  header.writeUInt8(32, 7);  // height
  header.writeUInt8(0, 8);   // colorCount
  header.writeUInt8(0, 9);   // reserved
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bitCount
  header.writeUInt32LE(pngBuf.length, 14); // bytesInRes
  header.writeUInt32LE(22, 18); // imageOffset (header is 22 bytes)

  const ico = Buffer.concat([header, pngBuf]);
  const outPath = path.join(OUT_DIR, 'favicon.ico');
  fs.writeFileSync(outPath, ico);
  process.stdout.write('==> generate-icons: wrote frontend/public/favicon.ico\n');
}

try {
  await emit('192.png', 192, 1.0);
  await emit('512.png', 512, 1.0);
  // 512-maskable: foreground rescaled to 80% safe zone (web.dev maskable-icons spec).
  await emit('512-maskable.png', 512, 0.8);
  await emit('apple-touch-icon.png', 180, 1.0);
  await emitFavicon();
} catch (err) {
  process.stderr.write(`FAIL: generate-icons — ${err.message}\n`);
  process.exit(1);
}
