/**
 * 04 §4.5, decision §14.52 B15: merging two transfer legs into one list row, and the
 * day-grouped subtotals that must exclude transfers and count unconvertible rows separately.
 */
import type { Transaction } from '@/api/types';
import { countRows, groupByDay, mergeTransferRows } from '../transfers';

let seq = 0;
function tx(overrides: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    ledger_id: 'ledger-1',
    source_id: 'source-1',
    kind: 'expense',
    amount: '-38.0000',
    currency: 'CNY',
    occurred_at: '2026-08-14',
    note: null,
    merchant: null,
    category_l1: 'food',
    category_l2: null,
    transfer_role: null,
    transfer_subtype: null,
    transfer_pair_id: null,
    counterparty: null,
    refund_of: null,
    import_batch_id: null,
    created_by: 'user-1',
    updated_by: null,
    created_at: '2026-08-14T00:00:00.000000Z',
    updated_at: '2026-08-14T00:00:00.000000Z',
    amount_base: '-38.0000',
    rate_used: null,
    rate_date: null,
    ...overrides,
  };
}

describe('mergeTransferRows', () => {
  test('same transfer_pair_id merges into one pair row, counted once', () => {
    const out = tx({
      id: 'out',
      kind: 'transfer',
      amount: '-1000.0000',
      transfer_role: 'out',
      transfer_pair_id: 'pair-1',
      category_l1: null,
    });
    const inn = tx({
      id: 'in',
      kind: 'transfer',
      amount: '1000.0000',
      transfer_role: 'in',
      transfer_pair_id: 'pair-1',
      category_l1: null,
    });
    const rows = mergeTransferRows([out, inn]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ kind: 'pair', pairId: 'pair-1', out, in: inn });
    expect(countRows(rows)).toBe(1);
  });

  test('a single-leg transfer (transfer_pair_id null) does not merge with anything', () => {
    const solo = tx({
      kind: 'transfer',
      transfer_role: 'in',
      transfer_pair_id: null,
      counterparty: '老婆',
      category_l1: null,
    });
    const rows = mergeTransferRows([solo]);
    expect(rows).toEqual([{ kind: 'single', tx: solo }]);
  });

  test('only one leg present in this page renders as half, missing the other side', () => {
    const out = tx({
      kind: 'transfer',
      amount: '-1000.0000',
      transfer_role: 'out',
      transfer_pair_id: 'pair-2',
      category_l1: null,
    });
    const rows = mergeTransferRows([out]);
    expect(rows).toEqual([{ kind: 'half', tx: out, missing: 'in' }]);
  });

  test('row order is stable: position follows the first leg seen', () => {
    const before = tx({ id: 'before' });
    const out = tx({
      id: 'out',
      kind: 'transfer',
      amount: '-500.0000',
      transfer_role: 'out',
      transfer_pair_id: 'pair-3',
      category_l1: null,
    });
    const after = tx({ id: 'after' });
    const inn = tx({
      id: 'in',
      kind: 'transfer',
      amount: '500.0000',
      transfer_role: 'in',
      transfer_pair_id: 'pair-3',
      category_l1: null,
    });
    const rows = mergeTransferRows([before, out, after, inn]);
    expect(rows.map((r) => r.kind)).toEqual(['single', 'pair', 'single']);
    expect(rows[1]).toEqual({ kind: 'pair', pairId: 'pair-3', out, in: inn });
  });

  test('non-transfer transactions always render as single', () => {
    const income = tx({ kind: 'income', amount: '5000.0000', category_l1: 'salary' });
    expect(mergeTransferRows([income])).toEqual([{ kind: 'single', tx: income }]);
  });
});

describe('groupByDay', () => {
  test('subtotals exclude transfers and split expense/income by sign; null amount_base is counted, not zeroed', () => {
    const day1Expense = tx({
      occurred_at: '2026-08-14',
      amount: '-38.0000',
      amount_base: '-38.0000',
    });
    const day1Income = tx({
      occurred_at: '2026-08-14',
      kind: 'income',
      amount: '100.0000',
      amount_base: '100.0000',
      category_l1: 'salary',
    });
    const day1NoRate = tx({
      occurred_at: '2026-08-14',
      amount: '-20.0000',
      amount_base: null,
    });
    const day1Pair = mergeTransferRows([
      tx({
        occurred_at: '2026-08-14',
        kind: 'transfer',
        amount: '-1000.0000',
        amount_base: '-1000.0000',
        transfer_role: 'out',
        transfer_pair_id: 'pair-4',
        category_l1: null,
      }),
      tx({
        occurred_at: '2026-08-14',
        kind: 'transfer',
        amount: '1000.0000',
        amount_base: '1000.0000',
        transfer_role: 'in',
        transfer_pair_id: 'pair-4',
        category_l1: null,
      }),
    ]);
    const day2Expense = tx({
      occurred_at: '2026-08-13',
      amount: '-5.0000',
      amount_base: '-5.0000',
    });

    const rows = [
      { kind: 'single' as const, tx: day1Expense },
      { kind: 'single' as const, tx: day1Income },
      { kind: 'single' as const, tx: day1NoRate },
      ...day1Pair,
      { kind: 'single' as const, tx: day2Expense },
    ];

    const groups = groupByDay(rows);
    expect(groups.map((g) => g.date)).toEqual(['2026-08-14', '2026-08-13']);

    const day1 = groups[0];
    expect(day1.expense).toBe('38.0000'); // day1NoRate excluded, transfer excluded
    expect(day1.income).toBe('100.0000');
    expect(day1.rateMissing).toBe(1);
    expect(day1.rows).toHaveLength(4); // expense + income + noRate + the merged pair row

    const day2 = groups[1];
    expect(day2.expense).toBe('5.0000');
    expect(day2.income).toBe('0.0000');
    expect(day2.rateMissing).toBe(0);
  });
});
