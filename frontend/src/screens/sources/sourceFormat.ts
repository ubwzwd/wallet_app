/**
 * The two readings every account row needs, written once so the wide table and the narrow
 * list agree (屏幕稿 09).
 *
 * 屏幕稿 09 paints a credit card's balance as a plain negative number in the expense red
 * rather than the older 「欠 ¥3,204.00」 wording — the mockups are the visual source of
 * truth (决策 §14.45), and a signed number lines up in a mono column where a prefix does
 * not. Everything else about the reading is unchanged: the amount is in the account's own
 * currency, and the converted value is the server's `balance_base` (04 §4.8).
 */
import type { FinanceSource } from '@/api/types';
import { parseMoney } from '@/domain/money';
import type { Lang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import type { TextTone } from '@/ui';

/** An account in the red (a credit card's debt, an overdrawn account) reads as expense. */
export function balanceTone(source: FinanceSource, muted: boolean): TextTone {
  if (muted) return 'muted';
  return parseMoney(source.balance) < 0n ? 'expense' : 'primary';
}

/** The balance in the account's own currency. */
export function balanceText(source: FinanceSource, lang: Lang): string {
  return formatMoney(source.balance, source.default_currency, lang);
}

/** Whether this account's balance is worth converting at all. */
export function isForeign(source: FinanceSource, baseCurrency: string): boolean {
  return source.default_currency.toUpperCase() !== baseCurrency.toUpperCase();
}

/** How many distinct currencies the active accounts are held in (屏幕稿 09: 「混合币种」). */
export function currencyCount(sources: readonly FinanceSource[]): number {
  return new Set(sources.map((s) => s.default_currency.toUpperCase())).size;
}
