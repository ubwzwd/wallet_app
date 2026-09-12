import { normalizeParams, serializeParams, toSearchParams } from '@/api/params';
import type { TransactionListParams } from '@/api/types';

describe('normalizeParams (04 §3.5)', () => {
  it('drops undefined / null / empty string / empty array', () => {
    const out = normalizeParams({
      q: '',
      kind: [],
      currency: undefined,
      category_l1: null,
      from: '2026-08-01',
      offset: 0,
      include_archived: false,
    });
    expect(out).toEqual({ from: '2026-08-01', offset: 0, include_archived: false });
  });

  it('keeps 0 and false — they are real filter values, not empties', () => {
    expect(normalizeParams({ min_amount: 0, dry_run: false })).toEqual({
      min_amount: 0,
      dry_run: false,
    });
  });

  it('de-duplicates and sorts array values', () => {
    expect(normalizeParams({ kind: ['refund', 'expense', 'expense'] })).toEqual({
      kind: ['expense', 'refund'],
    });
  });

  it('is stable: the same filter state written in any order is deeply equal', () => {
    const a: TransactionListParams = {
      kind: ['refund', 'expense'],
      q: 'coffee',
      source_id: ['b', 'a'],
      from: '2026-08-01',
    };
    const b: TransactionListParams = {
      from: '2026-08-01',
      source_id: ['a', 'b'],
      q: 'coffee',
      kind: ['expense', 'refund'],
    };
    expect(normalizeParams(a)).toEqual(normalizeParams(b));
    expect(JSON.stringify(normalizeParams(a))).toBe(JSON.stringify(normalizeParams(b)));
  });

  it('emits keys in lexicographic order', () => {
    expect(Object.keys(normalizeParams({ to: '2026-08-31', from: '2026-08-01', q: 'x' }))).toEqual([
      'from',
      'q',
      'to',
    ]);
  });
});

describe('toSearchParams (04 §1.3)', () => {
  it('uses repeated keys for arrays, never a comma-joined string', () => {
    expect(serializeParams({ kind: ['expense', 'refund'] })).toBe('kind=expense&kind=refund');
  });

  it('renders numbers and booleans as strings', () => {
    expect(serializeParams({ months: 12, include_archived: true, dry_run: false })).toBe(
      'dry_run=false&include_archived=true&months=12',
    );
  });

  it('omits empty values so one filter state has one URL', () => {
    expect(serializeParams({ q: '', kind: [], offset: 100 })).toBe('offset=100');
  });

  it('returns an empty URLSearchParams for undefined', () => {
    expect(toSearchParams(undefined).toString()).toBe('');
  });

  it('percent-encodes non-ASCII query values', () => {
    expect(serializeParams({ q: '咖啡' })).toBe('q=%E5%92%96%E5%95%A1');
  });
});
