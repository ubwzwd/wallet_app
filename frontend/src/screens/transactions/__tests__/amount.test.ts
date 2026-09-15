/**
 * §14.59a's writing rule and §14.59b's header stats, tested where they are decided rather
 * than through a screen: both are pure functions over a `summary` / an amount.
 */
import type { TFunction } from 'i18next';

import type { TransactionSummary } from '@/api/types';

import { amountText, plainAmount } from '../amount';
import { headerStatText, refundTotalOf } from '../headerStats';

describe('plainAmount', () => {
  test('writes the bare number with the sign rules formatMoney uses', () => {
    expect(plainAmount('-45.0000', 'CNY')).toBe('−45.00');
    expect(plainAmount('18000.0000', 'CNY')).toBe('18,000.00');
    expect(plainAmount('18000.0000', 'CNY', 'always')).toBe('+18,000.00');
    // `never` drops the U+2212 that `formatAmountPlain` puts there, it does not negate.
    expect(plainAmount('-66.2000', 'CNY', 'never')).toBe('66.20');
    // Zero takes no sign in any mode — 「+0.00」 reads as a change that did not happen.
    expect(plainAmount('0', 'CNY', 'always')).toBe('0.00');
    // The currency still decides the decimals, even with no symbol in front.
    expect(plainAmount('1200', 'JPY')).toBe('1,200');
  });
});

describe('amountText', () => {
  test('base currency is bare, every other currency keeps its symbol', () => {
    expect(amountText('-45.0000', 'CNY', 'CNY', 'zh')).toBe('−45.00');
    expect(amountText('-12.4000', 'SGD', 'CNY', 'zh')).toBe('−S$12.40');
    // The case of the code may not change the answer: both come off the wire uppercased,
    // but a ledger created before that could still carry a lowercase one.
    expect(amountText('45.0000', 'cny', 'CNY', 'zh')).toBe('45.00');
    // A symbol-less code keeps the ISO form rather than inventing a glyph.
    expect(amountText('1234.5600', 'MYR', 'CNY', 'en')).toBe('MYR 1,234.56');
    expect(amountText('4120.8000', 'SGD', 'CNY', 'zh', 'always')).toBe('+S$4,120.80');
  });
});

// ---------------------------------------------------------------- header stats

function summary(over: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    base_currency: 'CNY',
    expense: '111.2000',
    income: '18000.0000',
    net: '18087.8000',
    count: 6,
    rate_missing_count: 0,
    ...over,
  };
}

/** i18next with the real 「支出 {{amount}}」 shapes, without mounting it. */
const t = ((key: string, opts?: { amount?: string }) =>
  `${{ 'transaction:list.stat.expense': '支出', 'transaction:list.stat.income': '收入', 'transaction:list.stat.refund': '退款' }[key]} ${opts?.amount}`) as unknown as TFunction;

describe('refundTotalOf', () => {
  test('recovers the refund total the API does not report from net − income + expense', () => {
    // §5.25: net = income − expense + refund, and refunds are kept out of `income`.
    expect(refundTotalOf(summary())).toBe('199.0000');
    // A filtered result with no refunds in it comes back at exactly zero, never at −0.
    expect(refundTotalOf(summary({ net: '17888.8000' }))).toBe('0.0000');
  });
});

describe('headerStatText', () => {
  test('屏幕稿 02: one segment per kind that happened, refunds only on the wide frame', () => {
    expect(headerStatText(t, summary(), { withRefund: true })).toBe(
      '支出 111.20 · 收入 18,000.00 · 退款 199.00',
    );
    expect(headerStatText(t, summary(), { withRefund: false })).toBe(
      '支出 111.20 · 收入 18,000.00',
    );
  });

  test('a kind with nothing in it is left out, never padded to 0.00', () => {
    const expenseOnly = summary({ income: '0', net: '-111.2000' });
    expect(headerStatText(t, expenseOnly, { withRefund: true })).toBe('支出 111.20');
    expect(headerStatText(t, summaryToZero(), { withRefund: true })).toBeNull();
  });
});

/** 屏幕稿 15: a result with no money in it gets no money line at all. */
function summaryToZero(): TransactionSummary {
  return summary({ expense: '0', income: '0', net: '0', count: 0 });
}
