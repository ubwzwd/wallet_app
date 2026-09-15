/**
 * The two readings every account row needs, written once so the wide table and the narrow
 * list agree (屏幕稿 09).
 *
 * 屏幕稿 09 paints a credit card's balance as a plain negative number in the expense red
 * rather than the older 「欠 ¥3,204.00」 wording — the mockups are the visual source of
 * truth (决策 §14.45), and a signed number lines up in a mono column where a prefix does
 * not. Everything else about the reading is unchanged: the amount is in the account's own
 * currency, and the converted value is the server's `balance_base` (04 §4.8).
 *
 * `balanceText` writes the symbol for a foreign account only. §14.59a settled the question
 * for every screen at once: a base-currency amount in a grid is bare — the wide table's 币种
 * column and the narrow list's 「储蓄卡 · CNY」 subtitle already name the currency (屏幕稿 09:
 * 「12,480.35」, 「−3,215.00」, and 「S$4,120.80」 on the one row where they disagree).
 */
import type { FinanceSource } from '@/api/types';
import { parseMoney } from '@/domain/money';
import type { Lang } from '@/i18n';
import { formatLedgerAmount } from '@/i18n/format';
import type { TextTone } from '@/ui';

/** An account in the red (a credit card's debt, an overdrawn account) reads as expense. */
export function balanceTone(source: FinanceSource, muted: boolean): TextTone {
  if (muted) return 'muted';
  return parseMoney(source.balance) < 0n ? 'expense' : 'primary';
}

/** The balance in the account's own currency; bare when that is the ledger's base. */
export function balanceText(source: FinanceSource, lang: Lang, baseCurrency: string): string {
  return formatLedgerAmount(source.balance, source.default_currency, baseCurrency, lang);
}

/** Whether this account's balance is worth converting at all. */
export function isForeign(source: FinanceSource, baseCurrency: string): boolean {
  return source.default_currency.toUpperCase() !== baseCurrency.toUpperCase();
}

/** How many distinct currencies the active accounts are held in (屏幕稿 09: 「混合币种」). */
export function currencyCount(sources: readonly FinanceSource[]): number {
  return new Set(sources.map((s) => s.default_currency.toUpperCase())).size;
}
