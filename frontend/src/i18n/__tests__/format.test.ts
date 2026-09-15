/**
 * Pure formatter tests (04 §5.4, §8.1): unicode minus, zero-decimal currencies,
 * timezone-safe date parsing, relative-day wording, month/day-time formatting.
 */
import type { IsoDate } from '@/api/types';
import {
  currencySymbol,
  formatMoney,
  formatConverted,
  formatAmountPlain,
  parseLocalDate,
  todayLocalIso,
  formatDate,
  formatDateShort,
  formatRelativeDay,
  formatMonth,
  formatMonthShort,
  formatDateTime,
  formatDateTimeShort,
  formatCountdown,
  formatBytes,
} from '../format';

describe('formatMoney', () => {
  test('uses U+2212 for negative amounts, never a hyphen', () => {
    const out = formatMoney('-1299.0000', 'CNY', 'zh');
    expect(out).toContain('−');
    expect(out).not.toContain('-');
  });

  test('never wraps a negative amount in parentheses', () => {
    const out = formatMoney('-1299.0000', 'CNY', 'zh');
    expect(out).not.toContain('(');
    expect(out).not.toContain(')');
  });

  test('JPY and KRW show zero decimal places', () => {
    expect(formatMoney('1000', 'JPY', 'en')).not.toContain('.');
    expect(formatMoney('1000', 'KRW', 'en')).not.toContain('.');
  });

  test('other currencies show two decimal places', () => {
    expect(formatMoney('720', 'EUR', 'zh')).toMatch(/\.00/);
  });

  test('signDisplay "never" drops the sign', () => {
    const out = formatMoney('-38.00', 'CNY', 'zh', { signDisplay: 'never' });
    expect(out).not.toContain('−');
  });

  test('signDisplay "always" prefixes a positive amount with +', () => {
    const out = formatMoney('38.00', 'CNY', 'en', { signDisplay: 'always' });
    expect(out.startsWith('+')).toBe(true);
  });

  test('accepts a plain number as well as a Money string', () => {
    expect(formatMoney(-1299, 'CNY', 'zh')).toContain('−');
  });
});

describe('the currency symbol table (§14.59a)', () => {
  test.each([
    ['CNY', '¥'],
    ['SGD', 'S$'],
    ['USD', '$'],
    ['HKD', 'HK$'],
    ['EUR', '€'],
    ['GBP', '£'],
    ['JPY', 'JP¥'],
    ['AUD', 'A$'],
    ['TWD', 'NT$'],
    ['KRW', '₩'],
  ])('%s reads as %s', (code, symbol) => {
    expect(currencySymbol(code)).toBe(symbol);
    expect(currencySymbol(code.toLowerCase())).toBe(symbol);
  });

  test('a code with no symbol has none', () => {
    expect(currencySymbol('MYR')).toBeNull();
  });

  test('屏幕稿 09 writes the Singapore account as S$4,120.80', () => {
    expect(formatMoney('4120.8000', 'SGD', 'zh')).toBe('S$4,120.80');
    // The symbol belongs to the money, not to the reader: `Intl` would swing this to
    // 「SGD 4,120.80」 and CNY to 「CN¥」 with the interface language, the mockups do not.
    expect(formatMoney('4120.8000', 'SGD', 'en')).toBe('S$4,120.80');
    expect(formatMoney('24576.75', 'CNY', 'en')).toBe('¥24,576.75');
    expect(formatMoney('24576.75', 'CNY', 'zh')).toBe('¥24,576.75');
  });

  test('a zero-decimal currency keeps its own symbol and no decimals', () => {
    expect(formatMoney('4121', 'JPY', 'en')).toBe('JP¥4,121');
    expect(formatMoney('4121', 'KRW', 'zh')).toBe('₩4,121');
  });

  test('an unknown code falls back to the ISO code and a space', () => {
    expect(formatMoney('1234.56', 'MYR', 'zh')).toBe('MYR 1,234.56');
    expect(formatMoney('-1234.56', 'myr', 'en')).toBe('−MYR 1,234.56');
  });

  test('the sign sits in front of the symbol, never between it and the digits', () => {
    expect(formatMoney('-1234.56', 'SGD', 'zh')).toBe('−S$1,234.56');
    expect(formatMoney('1234.56', 'SGD', 'zh', { signDisplay: 'always' })).toBe('+S$1,234.56');
  });
});

describe('formatConverted (04 §5.4)', () => {
  test('prefixes the base-currency amount with ≈ and drops the sign', () => {
    expect(formatConverted('-1299.0000', 'CNY', '-165.32', 'USD', 'en')).toBe('≈ $165.32');
    expect(formatConverted('1299.0000', 'CNY', '165.32', 'USD', 'en')).toBe('≈ $165.32');
  });

  test('nothing to convert: a zero amount or the same currency give an empty string', () => {
    expect(formatConverted('0.0000', 'CNY', '0.00', 'USD', 'en')).toBe('');
    expect(formatConverted('-1299.0000', 'CNY', '-1299.0000', 'cny', 'zh')).toBe('');
  });
});

describe('formatMoney compact', () => {
  test('zh uses 万, en uses K, and the minus stays U+2212', () => {
    expect(formatMoney('12000', 'CNY', 'zh', { compact: true })).toContain('万');
    expect(formatMoney('12000', 'CNY', 'en', { compact: true })).toContain('K');
    const negative = formatMoney('-12000', 'CNY', 'zh', { compact: true });
    expect(negative).toContain('−');
    expect(negative).not.toContain('-');
  });

  test('a compact label is much shorter than the full one', () => {
    const full = formatMoney('12000', 'CNY', 'zh');
    const compact = formatMoney('12000', 'CNY', 'zh', { compact: true });
    expect(compact.length).toBeLessThan(full.length);
  });
});

describe('formatMonthShort', () => {
  test("'2026-08' reads as 8月 / Aug", () => {
    expect(formatMonthShort('2026-08', 'zh')).toBe('8月');
    expect(formatMonthShort('2026-08', 'en')).toBe('Aug');
  });

  test('a malformed month is passed through rather than rendered as NaN', () => {
    expect(formatMonthShort('nonsense', 'en')).toBe('nonsense');
    expect(formatMonthShort('2026-13', 'zh')).toBe('2026-13');
  });
});

describe('formatAmountPlain (§14.59a — the bare number in a grid)', () => {
  test('has no currency symbol but keeps thousands separators', () => {
    const out = formatAmountPlain('1299.5', 'CNY');
    expect(out).not.toMatch(/[¥$€]/);
    expect(out).toContain(',');
  });

  test('a negative amount keeps the U+2212 sign, a positive one gets no +', () => {
    expect(formatAmountPlain('-1234.56', 'CNY')).toBe('−1,234.56');
    expect(formatAmountPlain('1234.56', 'CNY')).toBe('1,234.56');
    // A caller that wants 「+1,234.56」 (an income row) prepends the plus itself.
    expect(formatAmountPlain('0', 'CNY')).toBe('0.00');
  });

  test('respects zero-decimal currencies', () => {
    expect(formatAmountPlain('1000', 'JPY')).toBe('1,000');
    expect(formatAmountPlain('-1000', 'KRW')).toBe('−1,000');
  });

  test('the grouping does not follow the interface language — it takes no language', () => {
    expect(formatAmountPlain(1234567.5, 'CNY')).toBe('1,234,567.50');
  });
});

describe('local-date parsing is timezone-safe (04 §5.4, §8.1)', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  test.each(['Asia/Shanghai', 'America/Los_Angeles', 'UTC'])(
    'parseLocalDate + formatDate show the 14th under %s, not the 13th or 15th',
    (tz) => {
      process.env.TZ = tz;
      const date = parseLocalDate('2026-08-14');
      expect(date.getDate()).toBe(14);
      expect(date.getMonth()).toBe(7); // August, 0-indexed
      expect(date.getFullYear()).toBe(2026);
    },
  );

  test.each(['Asia/Shanghai', 'America/Los_Angeles'])(
    'formatDate never shifts a day under %s',
    (tz) => {
      process.env.TZ = tz;
      expect(formatDate('2026-08-14', 'zh')).toContain('14');
      expect(formatDate('2026-08-14', 'en')).toContain('14');
    },
  );
});

describe('formatDate', () => {
  // 屏幕稿 04 / 06 / 07 / 12 all write a date as the plain numeric day, and the settings
  // page promises dates do not follow the interface language (决策 §14.45).
  test('is the numeric day, with the year, in either language', () => {
    const thisYear = new Date().getFullYear();
    expect(formatDate(`${thisYear}-08-14`, 'zh')).toBe(`${thisYear}-08-14`);
    expect(formatDate(`${thisYear}-08-14`, 'en')).toBe(`${thisYear}-08-14`);
    expect(formatDate('2019-08-14', 'zh')).toBe('2019-08-14');
    expect(formatDate('2019-08-14', 'en')).toBe('2019-08-14');
  });
});

describe('formatDateShort', () => {
  test('drops the year for the columns that have no room for it (屏幕稿 01 / 02 / 03)', () => {
    expect(formatDateShort('2026-08-14')).toBe('08-14');
  });

  test('leaves anything that is not a calendar day alone', () => {
    expect(formatDateShort('whenever' as IsoDate)).toBe('whenever');
  });
});

describe('formatDateTimeShort (屏幕稿 07 / 08 操作记录)', () => {
  test("drops the year the way formatDateShort does: '09-08 07:12'", () => {
    // No trailing Z: a bare datetime is parsed as local time, so this holds in any zone.
    expect(formatDateTimeShort('2026-09-08T07:12')).toBe('09-08 07:12');
    expect(formatDateTimeShort('2026-12-31T23:59')).toBe('12-31 23:59');
  });

  test('it is formatDateTime with the year and its dash cut off', () => {
    const utc = '2026-08-14T09:12:00.000000Z';
    expect(formatDateTimeShort(utc)).toBe(formatDateTime(utc, 'en').slice(5));
    expect(formatDateTimeShort(utc)).not.toContain('2026');
  });
});

describe('formatRelativeDay', () => {
  test('today and yesterday are localized words, local calendar day', () => {
    const today = todayLocalIso();
    const yesterday = toLocalIso(addDays(parseLocalDate(today), -1));
    expect(formatRelativeDay(today, 'zh')).toBe('今天');
    expect(formatRelativeDay(today, 'en')).toBe('Today');
    expect(formatRelativeDay(yesterday, 'zh')).toBe('昨天');
    expect(formatRelativeDay(yesterday, 'en')).toBe('Yesterday');
  });

  test('falls back to formatDate for anything else', () => {
    expect(formatRelativeDay('2019-08-14', 'en')).toBe(formatDate('2019-08-14', 'en'));
  });
});

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function toLocalIso(d: Date): string {
  const pad = (x: number) => (x < 10 ? `0${x}` : String(x));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('formatMonth', () => {
  test('zh and en', () => {
    expect(formatMonth('2026-08', 'zh')).toBe('2026 年 8 月');
    expect(formatMonth('2026-08', 'en')).toBe('August 2026');
  });
});

test('formatDateTime renders local YYYY-MM-DD HH:mm', () => {
  const out = formatDateTime('2026-08-14T09:12:00.000000Z', 'en');
  expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

describe('formatCountdown', () => {
  test('formats seconds as MM:SS', () => {
    expect(formatCountdown(581)).toBe('09:41');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(600)).toBe('10:00');
  });
});

describe('formatBytes', () => {
  test('formats sizes in the expected units', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
  });
});
