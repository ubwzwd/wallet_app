import type { TransactionListParams } from '@/api/types';

import { qk } from '../keys';

const L = 'ledger-1';

describe('query keys (04 §3.5)', () => {
  test('global keys match the spec verbatim', () => {
    expect(qk.global.me()).toEqual(['global', 'me']);
    expect(qk.global.config()).toEqual(['global', 'config']);
    expect(qk.global.categories()).toEqual(['global', 'categories']);
    expect(qk.global.importFormat()).toEqual(['global', 'import-format']);
    expect(qk.global.currencies()).toEqual(['global', 'currencies']);
    expect(qk.global.ledgers()).toEqual(['global', 'ledgers']);
  });

  test('ledger keys all start with ["l", ledgerId]', () => {
    const k = qk.ledger(L);
    expect(k.root()).toEqual(['l', L]);
    expect(k.detail()).toEqual(['l', L, 'detail']);
    expect(k.members()).toEqual(['l', L, 'members']);
    expect(k.sources()).toEqual(['l', L, 'sources', {}]);
    expect(k.sources({ include_archived: true })).toEqual([
      'l',
      L,
      'sources',
      { include_archived: true },
    ]);
    expect(k.source('s1')).toEqual(['l', L, 'sources', 'detail', 's1']);
    expect(k.tx('t1')).toEqual(['l', L, 'tx', 'detail', 't1']);
    expect(k.transfer('p1')).toEqual(['l', L, 'tx', 'transfer', 'p1']);
    expect(k.statsSum('2026-09')).toEqual(['l', L, 'stats', 'summary', '2026-09']);
    expect(k.statsTrend(12)).toEqual(['l', L, 'stats', 'trend', 12]);
    expect(k.imports()).toEqual(['l', L, 'imports', 'list']);
    expect(k.importB('b1')).toEqual(['l', L, 'imports', 'detail', 'b1']);
    expect(k.importRows('b1')).toEqual(['l', L, 'imports', 'rows', 'b1']);
  });

  test('the invalidation prefixes are prefixes of the keys they cover', () => {
    const k = qk.ledger(L);
    expect(k.txRoot()).toEqual(['l', L, 'tx']);
    expect(k.statsRoot()).toEqual(['l', L, 'stats']);
    expect(k.sourcesRoot()).toEqual(['l', L, 'sources']);
    expect(k.tx('t1').slice(0, 3)).toEqual([...k.txRoot()]);
    expect(k.statsSum('2026-09').slice(0, 3)).toEqual([...k.statsRoot()]);
    expect(k.source('s1').slice(0, 3)).toEqual([...k.sourcesRoot()]);
  });

  test('txList: the same filter state gives a deeply equal key whatever the input order', () => {
    const a: TransactionListParams = {
      to: '2026-09-30',
      kind: ['refund', 'expense'],
      q: 'coffee',
      from: '2026-09-01',
      source_id: ['s2', 's1'],
    };
    const b: TransactionListParams = {
      source_id: ['s1', 's2'],
      from: '2026-09-01',
      q: 'coffee',
      kind: ['expense', 'refund'],
      to: '2026-09-30',
      category_l1: undefined,
    };
    expect(qk.ledger(L).txList(a)).toEqual(qk.ledger(L).txList(b));
    expect(JSON.stringify(qk.ledger(L).txList(a))).toBe(JSON.stringify(qk.ledger(L).txList(b)));
  });

  test('txList: empty values drop out, real differences stay', () => {
    expect(qk.ledger(L).txList({ q: '', kind: [], from: undefined })).toEqual([
      'l',
      L,
      'tx',
      'list',
      {},
    ]);
    expect(qk.ledger(L).txList({ q: 'a' })).not.toEqual(qk.ledger(L).txList({ q: 'b' }));
  });
});
