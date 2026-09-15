/**
 * Date & money formatting (04 §5.4, §8.1). Every function is pure and takes `lang`
 * as a parameter instead of reading global state, so pages can format for a language
 * that is not (yet) the active i18next language, and these functions are trivially
 * unit-testable without mounting i18next at all.
 *
 * Money is always a decimal string (`Money`, 04 §3.3) — we only ever `Number()` it
 * for display, never for arithmetic (that lives in `src/domain/money.ts`).
 */
import type { IsoDate, IsoDateTime, Money } from '@/api/types';
import type { Lang } from './index';

/** Unicode minus (U+2212) instead of the ASCII hyphen — reads better next to
 *  tabular-nums digits (04 §5.4). */
const MINUS = '−';

const LOCALE_TAG: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' };

/** Currencies with no minor unit — JPY/KRW show as whole numbers (04 §5.4, §8.1). */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW']);

function fractionDigitsFor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

function toNumber(amount: Money | number): number {
  return typeof amount === 'number' ? amount : Number(amount);
}

/**
 * The symbol every mockup frame writes in front of an amount (§14.59a).
 *
 * `Intl` is not usable here: it swings the symbol with the *interface* language — CNY reads
 * 「¥」 in zh-CN but 「CN¥」 in en-US, JPY the other way round — while the mockups write one
 * symbol per currency whatever the language, because the symbol belongs to the money, not to
 * the reader. 屏幕稿 09 prints 「S$4,120.80」 for the Singapore account and 「¥24,576.75」 for
 * the base-currency total on the same row, so this table is the source of truth.
 *
 * A code that is not in the table keeps its ISO code and a space — 「MYR 1,234.56」 — which is
 * what `Intl` does for an unknown symbol anyway.
 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  CNY: '¥',
  SGD: 'S$',
  USD: '$',
  HKD: 'HK$',
  EUR: '€',
  GBP: '£',
  JPY: 'JP¥',
  AUD: 'A$',
  TWD: 'NT$',
  KRW: '₩',
};

/** The symbol for a currency code, or `null` when it only has an ISO code to show. */
export function currencySymbol(code: string): string | null {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? null;
}

export interface FormatMoneyOptions {
  /** Mirrors `Intl.NumberFormat`'s `signDisplay`, but applied to our own U+2212 sign
   *  rather than Intl's (which would use a plain hyphen and/or parentheses). */
  signDisplay?: 'auto' | 'never' | 'always';
  /** Short form for tight spots such as the twelve trend labels: `¥1.2万` / `¥12K`
   *  (`Intl`'s compact notation, one fractional digit at most). */
  compact?: boolean;
}

/**
 * An amount with its currency's symbol: `¥1,234.56`, `S$4,120.80`, `MYR 1,234.56`
 * (§14.59a, 04 §5.4). Negative is always U+2212, never parentheses; decimal places follow
 * the currency, not the locale. Only the grouping and the compact suffix follow `lang`
 * (`¥1.2万` in zh, `¥12K` in en) — the symbol never does.
 */
export function formatMoney(
  amount: Money | number,
  currency: string,
  lang: Lang,
  opts?: FormatMoneyOptions,
): string {
  const value = toNumber(amount);
  const signDisplay = opts?.signDisplay ?? 'auto';
  const digits = fractionDigitsFor(currency);
  const formatter = new Intl.NumberFormat(
    LOCALE_TAG[lang],
    opts?.compact === true
      ? {
          style: 'decimal',
          notation: 'compact',
          compactDisplay: 'short',
          maximumFractionDigits: 1,
        }
      : {
          style: 'decimal',
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        },
  );
  const symbol = currencySymbol(currency);
  const prefix = symbol ?? `${currency.toUpperCase()} `;
  const formattedAbs = prefix + formatter.format(Math.abs(value));
  if (value < 0 && signDisplay !== 'never') return MINUS + formattedAbs;
  if (value > 0 && signDisplay === 'always') return '+' + formattedAbs;
  return formattedAbs;
}

/**
 * A converted (secondary) amount shown under the original one, e.g. '≈ $165.32' (04 §5.4).
 *
 * The sign is deliberately dropped: the line right above already carries it, and a second
 * minus reads as a second amount. Returns an empty string when there is nothing to convert
 * — a zero original amount, or a base currency identical to the original one.
 */
export function formatConverted(
  amount: Money | number,
  currency: string,
  amountBase: Money | number,
  baseCurrency: string,
  lang: Lang,
): string {
  if (toNumber(amount) === 0) return '';
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) return '';
  return `≈ ${formatMoney(amountBase, baseCurrency, lang, { signDisplay: 'never' })}`;
}

/**
 * The bare number: thousands separators, the currency's decimal places, a U+2212 in front
 * of a negative one and nothing at all in front of a positive one (§14.59a).
 *
 * This is what every *base-currency* amount in a grid reads as — list rows, the two tinted
 * home cards, the accounts total, category rows, the impact card, the refund progress, the
 * summary bar, the review table — because the column header already names the currency and
 * the mockups never repeat 「¥」 on every line. A caller that wants a 「+」 (an income row)
 * prepends it itself; a caller that wants the symbol calls `formatMoney`. Also used by
 * `AmountField`, where the currency sits in its own control next to the input (04 §6.4).
 */
export function formatAmountPlain(amount: Money | number, currency: string): string {
  const value = toNumber(amount);
  const digits = fractionDigitsFor(currency);
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const formatted = formatter.format(Math.abs(value));
  return value < 0 ? MINUS + formatted : formatted;
}

/** Parses a calendar date (`YYYY-MM-DD`, no timezone) as a LOCAL date — never
 *  `new Date('YYYY-MM-DD')`, which parses as UTC midnight and shifts a day in
 *  timezones east of UTC (04 §5.4, §8.1). */
export function parseLocalDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toLocalIso(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today's calendar date in the local timezone (never `toISOString()`, which is UTC). */
export function todayLocalIso(): IsoDate {
  return toLocalIso(new Date());
}

const EN_MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const EN_MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * List style: the plain numeric day, `2026-08-14`.
 *
 * Every mockup frame writes dates this way — the refund picker (06), the ledger's
 * 「建于」 line (12), the form's summary card (04), the operations timeline (07 / 08) —
 * always in the mono face, never as 「8月14日」. It is deliberately language-independent,
 * which is also what the settings page promises: 「日期一律按账本的基准币种与地区走，不随
 * 语言变」. It therefore takes no `lang`: the date is the date in either language.
 */
export function formatDate(iso: IsoDate): string {
  return iso;
}

/**
 * The compact form the tables and the home card use, `08-14` — for columns and meta lines
 * narrow enough that the mockups drop the year (01 「最近」, 02's 日期 column, 03's review
 * table, the detail breadcrumb).
 */
export function formatDateShort(iso: IsoDate): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(5) : iso;
}

/** Today / yesterday (local calendar day), otherwise falls back to `formatDate`. */
export function formatRelativeDay(iso: IsoDate, lang: Lang): string {
  const target = parseLocalDate(iso);
  const today = new Date();
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((target.getTime() - todayLocal.getTime()) / 86_400_000);
  if (diffDays === 0) return lang === 'zh' ? '今天' : 'Today';
  if (diffDays === -1) return lang === 'zh' ? '昨天' : 'Yesterday';
  return formatDate(iso);
}

/** `'2026-08'` → '2026 年 8 月' / 'August 2026'. */
export function formatMonth(month: string, lang: Lang): string {
  const [yStr, mStr] = month.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  return lang === 'zh' ? `${y} 年 ${m} 月` : `${EN_MONTHS_FULL[m - 1]} ${y}`;
}

/**
 * `'2026-08'` → '8 月' / 'Aug' — the trend chart's axis labels (04 §4.4).
 *
 * The zh form keeps a space between the digits and 「月」, the way every mockup frame
 * sets it (屏幕稿 01 「9 月支出」 and its 「10 月 … 9 月」 axis, 08 「对 9 月的影响」):
 * Latin digits next to a CJK character need the gap to stop reading as one glyph run.
 */
export function formatMonthShort(month: string, lang: Lang): string {
  const m = parseInt(month.split('-')[1] ?? '', 10);
  if (!Number.isInteger(m) || m < 1 || m > 12) return month;
  return lang === 'zh' ? `${m} 月` : EN_MONTHS_SHORT[m - 1];
}

/** UTC ISO datetime → local `'YYYY-MM-DD HH:mm'` (24h, locale-invariant — used in the
 *  operations timeline, 04 §4.7). */
export function formatDateTime(isoDateTime: IsoDateTime, _lang: Lang): string {
  const date = new Date(isoDateTime);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * The same stamp with the year dropped, `'09-08 07:12'` — what 屏幕稿 07 / 08 write in the
 * 「操作记录」 timeline, matching the year-less dates `formatDateShort` gives the columns
 * next to it. `formatDateTime` keeps the year for the import history and the batch pages,
 * where a row can be months old and the year is the point.
 */
export function formatDateTimeShort(isoDateTime: IsoDateTime): string {
  const date = new Date(isoDateTime);
  return (
    `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** Seconds → 'MM:SS', for invite-code / rate-limit countdowns. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${pad2(m)}:${pad2(rem)}`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

/** Human-readable file size, e.g. `128 KB`, `2.3 MB` (import upload UI). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  let value = n;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${BYTE_UNITS[unitIndex]}`;
}
