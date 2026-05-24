/**
 * MOBUI-01: Button.tsx `small` size must meet the 44x44 touch-target minimum.
 *
 * Static-source assertion (jest.config.js sets testEnvironment to node). This
 * spec must NOT import the React Native package or any rendering library — the
 * node env intentionally cannot resolve the React Native runtime.
 *
 * Wave 0 red state (Phase 5 plan 05-01): describe block 1 passes (small block
 * exists). It blocks 2 and 3 fail (minHeight / minWidth missing) until plan
 * 05-04 lands its edit. That failure is the proof this spec gates the fix.
 */
import * as fs from 'fs';
import * as path from 'path';

const BUTTON_SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/components/Button.tsx'),
  'utf8'
);

describe('MOBUI-01: Button small size satisfies 44x44 touch-target minimum', () => {
  it('Button.tsx defines a small size style block', () => {
    expect(BUTTON_SOURCE).toMatch(/small:\s*\{/);
  });

  it('small size has minHeight: 44', () => {
    expect(BUTTON_SOURCE).toMatch(/small:\s*\{[^}]*minHeight:\s*44/s);
  });

  it('small size has minWidth: 44', () => {
    expect(BUTTON_SOURCE).toMatch(/small:\s*\{[^}]*minWidth:\s*44/s);
  });
});
