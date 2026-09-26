/** 04 §4.4, §4.8, decision §14.50: credit -> liabilities, archived excluded, null -> unconvertible. */
import type { FinanceSource } from '@/api/types';
import { SOURCE_TYPE_ORDER, sumSources } from '../networth';

let seq = 0;
function source(overrides: Partial<FinanceSource>): FinanceSource {
  seq += 1;
  return {
    id: `src-${seq}`,
    owner_id: 'user-1',
    name: `Source ${seq}`,
    type: 'checking',
    default_currency: 'CNY',
    opening_balance: '0.0000',
    archived: false,
    archived_at: null,
    created_by: 'user-1',
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    balance: '0.0000',
    balance_base: '0.0000',
    balance_rate: null,
    balance_rate_date: null,
    shared_to: ['ledger-1'],
    rate_missing_count: 0,
    ...overrides,
  };
}

describe('sumSources', () => {
  test('credit balances go to liabilities (kept negative), everything else to assets', () => {
    const checking = source({ type: 'checking', balance_base: '1000.0000' });
    const credit = source({ type: 'credit', balance_base: '-3204.0000' });
    const summary = sumSources([checking, credit]);
    expect(summary.assets).toBe('1000.0000');
    expect(summary.liabilities).toBe('-3204.0000');
    expect(summary.net).toBe('-2204.0000');
  });

  test('archived accounts are excluded entirely, and counted', () => {
    const active = source({ type: 'checking', balance_base: '500.0000' });
    const archived = source({
      type: 'checking',
      balance_base: '9999.0000',
      archived: true,
      archived_at: '2026-08-01T00:00:00.000000Z',
    });
    const summary = sumSources([active, archived]);
    expect(summary.assets).toBe('500.0000');
    expect(summary.archivedCount).toBe(1);
    expect(summary.byType.checking.count).toBe(1); // archived one not counted per-type either
  });

  test('null balance_base is not treated as zero; it is counted as unconvertible', () => {
    const known = source({ type: 'cash', balance_base: '100.0000' });
    const unknown = source({ type: 'cash', balance_base: null });
    const summary = sumSources([known, unknown]);
    expect(summary.assets).toBe('100.0000');
    expect(summary.unconvertibleCount).toBe(1);
    expect(summary.byType.cash.count).toBe(1);
  });

  test('byType groups by all four types in the fixed display order', () => {
    expect(SOURCE_TYPE_ORDER).toEqual(['checking', 'credit', 'cash', 'other']);
    const sources = [
      source({ type: 'checking', balance_base: '100.0000' }),
      source({ type: 'credit', balance_base: '-50.0000' }),
      source({ type: 'cash', balance_base: '20.0000' }),
      source({ type: 'other', balance_base: '5.0000' }),
    ];
    const summary = sumSources(sources);
    expect(summary.byType.checking.subtotal).toBe('100.0000');
    expect(summary.byType.credit.subtotal).toBe('-50.0000');
    expect(summary.byType.cash.subtotal).toBe('20.0000');
    expect(summary.byType.other.subtotal).toBe('5.0000');
    expect(summary.net).toBe('75.0000');
  });

  test('empty list summarizes to all zeros', () => {
    const summary = sumSources([]);
    expect(summary.assets).toBe('0.0000');
    expect(summary.liabilities).toBe('0.0000');
    expect(summary.net).toBe('0.0000');
    expect(summary.archivedCount).toBe(0);
    expect(summary.unconvertibleCount).toBe(0);
  });
});
