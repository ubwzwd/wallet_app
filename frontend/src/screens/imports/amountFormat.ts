/**
 * How the import screens write an amount (§14.59a).
 *
 * 屏幕稿 03 and 11 write every base-currency amount bare and signed — 「−45.00」,
 * 「+18,000.00」, 「+1,204.60」 — because the column it sits in (金额, 净额, 净额回滚) already
 * names the currency, and a repeated 「¥」 on every line only gets in the way of a mono
 * column. A foreign amount keeps its symbol (「−S$12.40」), because there the column header
 * and the number disagree and the symbol is the only thing that says so.
 *
 * `formatAmountPlain` writes the U+2212 for a negative number and nothing for a positive
 * one, so the 「+」 is this module's to add — it is what tells a 收入 row from a 支出 one
 * once the colour is gone (a printout, a screen reader).
 */
import type { Money } from '@/api/types';
import type { Lang } from '@/i18n';
import { formatAmountPlain, formatMoney } from '@/i18n/format';

/** The bare amount with an explicit sign on both directions: 「+1,204.60」 / 「−45.00」. */
export function signedPlain(amount: Money | number, currency: string): string {
  const text = formatAmountPlain(amount, currency);
  return Number(amount) > 0 ? `+${text}` : text;
}

/** `signedPlain` for the ledger's own currency, `formatMoney` for anything else. */
export function importAmountText(
  amount: Money | number,
  currency: string,
  baseCurrency: string,
  lang: Lang,
): string {
  return currency.toUpperCase() === baseCurrency.toUpperCase()
    ? signedPlain(amount, currency)
    : formatMoney(amount, currency, lang, { signDisplay: 'always' });
}
