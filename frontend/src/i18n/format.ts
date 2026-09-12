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

export interface FormatMoneyOptions {
  /** Mirrors `Intl.NumberFormat`'s `signDisplay`, but applied to our own U+2212 sign
   *  rather than Intl's (which would use a plain hyphen and/or parentheses). */
  signDisplay?: 'auto' | 'never' | 'always';
}

/** `Intl.NumberFormat` currency style; negative sign is always U+2212, never
 *  parentheses (04 §5.4). Decimal places follow the currency, not the locale. */
export function formatMoney(
  amount: Money | number,
  currency: string,
  lang: Lang,
  opts?: FormatMoneyOptions,
): string {
  const value = toNumber(amount);
  const signDisplay = opts?.signDisplay ?? 'auto';
  const digits = fractionDigitsFor(currency);
  const formatter = new Intl.NumberFormat(LOCALE_TAG[lang], {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const formattedAbs = formatter.format(Math.abs(value));
  if (value < 0 && signDisplay !== 'never') return MINUS + formattedAbs;
  if (value > 0 && signDisplay === 'always') return '+' + formattedAbs;
  return formattedAbs;
}

/** A converted (secondary) amount, e.g. under a transaction row: '≈ $165.32'. */
export function formatConverted(
  amount: Money | number,
  currency: string,
  amountBase: Money | number,
  baseCurrency: string,
  lang: Lang,
): string {
  return `≈ ${formatMoney(amountBase, baseCurrency, lang)}`;
}

/** Plain digits + thousands separator, no currency symbol — for `AmountField`,
 *  where the currency is shown separately and the sign is read-only (04 §6.4). */
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

/** List style: this year → '8月14日' / 'Aug 14'; other years → with the year. */
export function formatDate(iso: IsoDate, lang: Lang): string {
  const date = parseLocalDate(iso);
  const thisYear = new Date().getFullYear();
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  if (lang === 'zh') {
    return y === thisYear ? `${m + 1}月${d}日` : `${y}年${m + 1}月${d}日`;
  }
  return y === thisYear ? `${EN_MONTHS_SHORT[m]} ${d}` : `${EN_MONTHS_SHORT[m]} ${d}, ${y}`;
}

/** Today / yesterday (local calendar day), otherwise falls back to `formatDate`. */
export function formatRelativeDay(iso: IsoDate, lang: Lang): string {
  const target = parseLocalDate(iso);
  const today = new Date();
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((target.getTime() - todayLocal.getTime()) / 86_400_000);
  if (diffDays === 0) return lang === 'zh' ? '今天' : 'Today';
  if (diffDays === -1) return lang === 'zh' ? '昨天' : 'Yesterday';
  return formatDate(iso, lang);
}

/** `'2026-08'` → '2026 年 8 月' / 'August 2026'. */
export function formatMonth(month: string, lang: Lang): string {
  const [yStr, mStr] = month.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  return lang === 'zh' ? `${y} 年 ${m} 月` : `${EN_MONTHS_FULL[m - 1]} ${y}`;
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
