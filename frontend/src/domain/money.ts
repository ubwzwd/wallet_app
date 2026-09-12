/**
 * Decimal-string money arithmetic (04 §1.2, §4.6.5; decisions §1, §3).
 *
 * `Money` (see `@/api/types`) travels as a string like `'-42.5000'` (server `NUMERIC(18,4)`).
 * Every function here goes through `bigint` scaled by 10^4 — amounts never touch `number` /
 * floating point, so summing hundreds of transactions never drifts by a cent.
 */
import type { Money } from '@/api/types';

const MONEY_SCALE = 10000n; // 4 decimal places

/** Strip whitespace (incl. full-width), thousands separators, and normalize the minus sign. */
function cleanMoneyString(raw: string): string {
  return raw
    .trim()
    .replace(/−/g, '-') // U+2212 MINUS SIGN → ascii hyphen
    .replace(/[\s　]/g, '') // ascii + full-width space
    .replace(/,/g, ''); // thousands separator
}

/** Number of digits after the decimal point in a numeric string (0 if there is none). */
export function decimalPlaces(raw: string): number {
  const idx = raw.indexOf('.');
  return idx === -1 ? 0 : raw.length - idx - 1;
}

/**
 * Parse a decimal string into a bigint scaled by 10^4. Accepts an optional leading sign
 * (ascii `-` or U+2212), thousands separators, and surrounding whitespace. Throws on anything
 * that isn't a plain decimal number, or on more than 4 fractional digits.
 */
export function parseMoney(raw: string): bigint {
  const cleaned = cleanMoneyString(raw);
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`invalid money string: ${JSON.stringify(raw)}`);
  }
  if (decimalPlaces(cleaned) > 4) {
    throw new Error(`too many decimal places: ${JSON.stringify(raw)}`);
  }
  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const magnitude = BigInt(intPart) * MONEY_SCALE + BigInt(fracPart.padEnd(4, '0'));
  return negative ? -magnitude : magnitude;
}

/** Format a scaled bigint back into the wire `Money` form, e.g. `-38.0000`. */
export function formatMoney4(v: bigint): Money {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const intPart = abs / MONEY_SCALE;
  const fracPart = abs % MONEY_SCALE;
  return `${negative ? '-' : ''}${intPart.toString()}.${fracPart.toString().padStart(4, '0')}`;
}

export function addMoney(...xs: Money[]): Money {
  const total = xs.reduce((acc, x) => acc + parseMoney(x), 0n);
  return formatMoney4(total);
}

export function subMoney(a: Money, b: Money): Money {
  return formatMoney4(parseMoney(a) - parseMoney(b));
}

export function negMoney(a: Money): Money {
  return formatMoney4(-parseMoney(a));
}

export function absMoney(a: Money): Money {
  const v = parseMoney(a);
  return formatMoney4(v < 0n ? -v : v);
}

export function cmpMoney(a: Money, b: Money): -1 | 0 | 1 {
  const d = parseMoney(a) - parseMoney(b);
  if (d < 0n) return -1;
  if (d > 0n) return 1;
  return 0;
}

export function isZeroMoney(a: Money): boolean {
  return parseMoney(a) === 0n;
}

export function isPositiveMoney(a: Money): boolean {
  return parseMoney(a) > 0n;
}

/** Sum a `Money` field pulled out of a list of arbitrary records. */
export function sumMoney<T>(list: readonly T[], pick: (item: T) => Money): Money {
  const total = list.reduce((acc, item) => acc + parseMoney(pick(item)), 0n);
  return formatMoney4(total);
}

/**
 * Turn raw user keyboard input into a normalized 4-decimal `Money` string, or `null` if it
 * isn't a plain decimal number. Strips thousands separators and whitespace, and accepts the
 * full-width decimal point forms (`．`/`。`) some IMEs produce.
 */
export function normalizeAmountInput(raw: string): Money | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s === '') return null;
  s = s.replace(/[．。]/g, '.');
  s = s.replace(/−/g, '-');
  s = s.replace(/[\s　]/g, '');
  s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  if (decimalPlaces(s) > 4) return null;
  try {
    return formatMoney4(parseMoney(s));
  } catch {
    return null;
  }
}
