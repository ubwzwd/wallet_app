/** 04 §1.3: URL <-> TransactionListParams round-trip, empty-value omission, repeated keys. */
import type { TransactionListParams } from '@/api/types';
import {
  activeFilterCount,
  filterChips,
  parseTxFilters,
  removeFilter,
  serializeTxFilters,
} from '../filters';

describe('parseTxFilters / serializeTxFilters round-trip', () => {
  test('round-trips a fully populated filter set', () => {
    const params: TransactionListParams = {
      q: '咖啡',
      kind: ['expense', 'refund'],
      source_id: ['s1', 's2'],
      category_l1: 'food',
      category_l2: 'lunch',
      from: '2026-08-01',
      to: '2026-08-31',
      currency: 'CNY',
      min_amount: 20,
      max_amount: 500,
      import_batch_id: 'b1',
      offset: 100,
    };
    const serialized = serializeTxFilters(params);
    const search: Record<string, string | string[]> = serialized;
    const parsed = parseTxFilters(search);
    expect(parsed).toEqual(params);
  });

  test('empty values never appear in the serialized form', () => {
    const serialized = serializeTxFilters({ q: '', kind: [], source_id: [] });
    expect(serialized).toEqual({});
  });

  test('limit is never written to the URL, even if set on the params', () => {
    const serialized = serializeTxFilters({ limit: 50 } as TransactionListParams);
    expect(serialized.limit).toBeUndefined();
  });

  test('array params keep repeated-key semantics (not comma-joined)', () => {
    const serialized = serializeTxFilters({ kind: ['expense', 'income'] });
    expect(serialized.kind).toEqual(['expense', 'income']);
  });

  test('keys come out in lexicographic order', () => {
    const serialized = serializeTxFilters({ to: '2026-08-31', q: 'x', from: '2026-08-01' });
    expect(Object.keys(serialized)).toEqual(['from', 'q', 'to']);
  });

  test('import_batch_id round-trips (decision §14.46 04-D-7)', () => {
    const serialized = serializeTxFilters({ import_batch_id: 'batch-1' });
    expect(serialized.import_batch_id).toBe('batch-1');
    expect(parseTxFilters(serialized)).toEqual({ import_batch_id: 'batch-1' });
  });

  test('illegal numeric values are dropped, not defaulted', () => {
    expect(
      parseTxFilters({ min_amount: 'not-a-number', max_amount: '50', offset: '-3' })
    ).toEqual({ max_amount: 50 });
    expect(parseTxFilters({ offset: 'abc' })).toEqual({});
  });

  test('only plain decimal digits count as a number', () => {
    for (const raw of ['', '   ', '0x10', '1e3', 'Infinity', '-Infinity', '+5', '5.', '.5']) {
      expect(parseTxFilters({ min_amount: raw, max_amount: raw, offset: raw })).toEqual({});
    }
    // offset=0 is the default; it is never written to the URL, so it is not read back either.
    expect(parseTxFilters({ offset: '0' })).toEqual({});
    expect(parseTxFilters({ min_amount: '-20.5', max_amount: '500', offset: '50' })).toEqual({
      min_amount: -20.5,
      max_amount: 500,
      offset: 50,
    });
  });

  test('parse -> serialize -> parse is idempotent for every numeric shape', () => {
    for (const raw of ['', '  ', '0x10', '1e3', 'Infinity', '20.50', '0', '-3']) {
      const once = parseTxFilters({ min_amount: raw, max_amount: raw, offset: raw });
      const twice = parseTxFilters(serializeTxFilters(once));
      expect(twice).toEqual(once);
    }
  });

  test('an invalid date is dropped', () => {
    expect(parseTxFilters({ from: '2026-13-40', to: '2026-08-31' })).toEqual({
      to: '2026-08-31',
    });
  });

  test('an unrecognized kind value is dropped', () => {
    expect(parseTxFilters({ kind: ['expense', 'bogus'] })).toEqual({ kind: ['expense'] });
  });

  test('a repeated single key becomes an array', () => {
    expect(parseTxFilters({ kind: ['expense', 'income'] })).toEqual({
      kind: ['expense', 'income'],
    });
  });
});

describe('activeFilterCount', () => {
  test('excludes offset/limit and counts each dimension once', () => {
    expect(activeFilterCount({ kind: ['expense', 'refund'], q: 'x', offset: 50 })).toBe(2);
    expect(activeFilterCount({})).toBe(0);
  });
});

describe('filterChips', () => {
  test('one chip per active condition, one per array item', () => {
    const chips = filterChips({ kind: ['expense', 'refund'], currency: 'CNY' });
    expect(chips).toEqual([
      { key: 'kind', value: 'expense' },
      { key: 'kind', value: 'refund' },
      { key: 'currency', value: 'CNY' },
    ]);
  });
});

describe('removeFilter', () => {
  test('removes a scalar filter entirely', () => {
    expect(removeFilter({ currency: 'CNY', q: 'x' }, 'currency')).toEqual({ q: 'x' });
  });

  test('removes one value out of an array filter, keeping the rest', () => {
    expect(removeFilter({ kind: ['expense', 'refund'] }, 'kind', 'expense')).toEqual({
      kind: ['refund'],
    });
  });

  test('removes the array field entirely once its last value is removed', () => {
    expect(removeFilter({ kind: ['expense'] }, 'kind', 'expense')).toEqual({});
  });
});
