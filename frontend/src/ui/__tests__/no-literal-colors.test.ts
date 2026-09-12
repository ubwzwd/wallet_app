/**
 * 04 §6.2: components read semantic token names only. The generated token module is the
 * one place a colour value may appear; everywhere else a literal is a bug (the current
 * codebase it replaces had 147 of them across 14 files).
 *
 * A line may opt out with a trailing `// hex-ok` comment — nothing needs it today.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', '..');
const GENERATED = path.join(SRC, 'theme', 'tokens.ts');

/** `#abc`, `#a1b2c3`, `#a1b2c3ff`, plus the CSS colour functions. */
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (full === GENERATED) continue;
    out.push(full);
  }
  return out;
}

describe('no literal colours outside tokens.ts', () => {
  const files = sourceFiles(SRC);

  test('the scan actually sees the component library', () => {
    const relative = files.map((f) => path.relative(SRC, f));
    expect(relative).toContain(path.join('ui', 'Button.tsx'));
    expect(relative).toContain(path.join('theme', 'ThemeProvider.tsx'));
    expect(files.length).toBeGreaterThan(10);
  });

  test('every source file reads colours from the palette', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!LITERAL.test(line)) return;
        if (line.includes('// hex-ok')) return;
        offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('the generated token module is the file that does hold the values', () => {
    expect(LITERAL.test(fs.readFileSync(GENERATED, 'utf8'))).toBe(true);
  });
});
