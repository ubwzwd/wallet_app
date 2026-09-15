/**
 * The inline stats 屏幕稿 02 puts beside the 「交易」 title (§14.59b).
 *
 * 「共 6 笔 · 支出 111.20 · 收入 18,000.00 · 退款 199.00」 — one segment per kind that
 * actually happened, in the base currency and written bare (§14.59a). A kind with nothing
 * in it is left out rather than padded to 「¥0.00」, which is what makes the line readable
 * on a ledger that only ever spends.
 *
 * Every figure comes from the response's `summary`, i.e. from the **whole filtered
 * result** — never from the page on screen.
 */
import type { TFunction } from 'i18next';

import type { TransactionSummary } from '@/api/types';
import { addMoney, parseMoney, subMoney } from '@/domain/money';

import { plainAmount } from './amount';

/**
 * What a refund added to the month, recovered from the three figures the API does report.
 *
 * `§5.25`'s net is `income − expense + refund` and refunds are kept out of `income`, so the
 * refund total is the only unknown in that equation and comes straight back out of it.
 * (The API reports no transfer total at all — transfer legs are excluded from `summary`
 * by design — so 屏幕稿 02's 「转账 8,000.00」 segment has no data behind it and is left
 * out; see the task notes.)
 */
export function refundTotalOf(summary: TransactionSummary): string {
  return addMoney(subMoney(summary.net, summary.income), summary.expense);
}

/** `支出 111.20 · 收入 18,000.00 · 退款 199.00`, or `null` when nothing happened. */
export function headerStatText(
  t: TFunction,
  summary: TransactionSummary,
  /** The narrow frame (屏幕稿 02 · 375) has room for 支出 / 收入 and nothing more. */
  opts: { withRefund: boolean },
): string | null {
  const currency = summary.base_currency;
  const parts: string[] = [];
  const push = (key: string, raw: string): void => {
    if (parseMoney(raw) === 0n) return;
    parts.push(t(`transaction:list.stat.${key}`, { amount: plainAmount(raw, currency) }));
  };
  push('expense', summary.expense);
  push('income', summary.income);
  if (opts.withRefund) push('refund', refundTotalOf(summary));
  return parts.length === 0 ? null : parts.join(' · ');
}
