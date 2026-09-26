/** The invalidation matrix of 04 §3.6, row by row. */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { LEDGER_ID, SOURCE_ID, TX_ID, makeSource, makeTransaction } from '@/test/fixtures';
import {
  mockApi,
  mockDelete,
  mockPatch,
  mockPost,
  mockPut,
  type MockApi,
} from '@/test/mockApi';

import {
  invalidateLedger,
  invalidateLedgers,
  invalidateMe,
  invalidateMembers,
  invalidatePair,
  invalidateSources,
  invalidateTransactions,
  invalidateTransfer,
  removeLedger,
  removeTransfer,
} from '../invalidate';
import { qk } from '../keys';
import { useUpdateLedger } from '../useLedgers';
import { useCreateSource, useDeleteSource, useShareSource, useUpdateSource } from '../useSources';
import { useDeleteTransaction, useUnpairTransfer } from '../useTransactions';

const L = LEDGER_ID;
const OTHER = 'other-ledger';

function makeClient(): QueryClient {
  return new QueryClient({
    // `gcTime: Infinity` skips query-core's garbage-collection timers, which would
    // otherwise keep the jest worker alive for five minutes after the last test.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: 0, gcTime: Infinity },
    },
  });
}

function spies(qc: QueryClient) {
  return {
    invalidate: jest.spyOn(qc, 'invalidateQueries'),
    remove: jest.spyOn(qc, 'removeQueries'),
  };
}

/** Every `queryKey` the spy was called with. */
function keys(spy: jest.SpyInstance): unknown[][] {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey as unknown[]);
}

/** Every cached key the last invalidation marked stale, as JSON for easy comparison. */
function staleKeys(qc: QueryClient): string[] {
  return qc
    .getQueryCache()
    .findAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => JSON.stringify(q.queryKey))
    .sort();
}

/**
 * The cache an account change has to reach across (decision §14.62): my own list and an
 * account detail, two ledgers' account lists, and the bystanders it must leave alone.
 */
function seedAccountCache(qc: QueryClient): void {
  const page = { items: [], total: 0 };
  qc.setQueryData(qk.global.sources(), page);
  qc.setQueryData(qk.global.sources({ include_archived: true }), page);
  qc.setQueryData(qk.global.source(SOURCE_ID), makeSource());
  qc.setQueryData(qk.ledger(L).sources({ include_archived: true }), page);
  qc.setQueryData(qk.ledger(OTHER).sources(), page);
  qc.setQueryData(qk.ledger(L).statsSum('2026-09'), {});
  qc.setQueryData(qk.ledger(OTHER).statsSum('2026-09'), {});
  qc.setQueryData(qk.ledger(L).txList({}), page);
  qc.setQueryData(qk.global.ledgers(), page);
}

const EVERY_ACCOUNT_KEY = [
  JSON.stringify(qk.global.sources()),
  JSON.stringify(qk.global.sources({ include_archived: true })),
  JSON.stringify(qk.global.source(SOURCE_ID)),
  JSON.stringify(qk.ledger(L).sources({ include_archived: true })),
  JSON.stringify(qk.ledger(OTHER).sources()),
].sort();

const EVERY_STATS_KEY = [
  JSON.stringify(qk.ledger(L).statsSum('2026-09')),
  JSON.stringify(qk.ledger(OTHER).statsSum('2026-09')),
];

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('invalidation helpers', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeClient();
  });

  afterEach(() => {
    qc.clear();
  });

  test('ledgersApi.create / join → global.ledgers', () => {
    const s = spies(qc);
    invalidateLedgers(qc);
    expect(keys(s.invalidate)).toEqual([['global', 'ledgers']]);
  });

  test('ledgersApi.update → list + detail; base currency adds the whole ledger tree', () => {
    const s = spies(qc);
    invalidateLedger(qc, L);
    expect(keys(s.invalidate)).toEqual([['global', 'ledgers'], ['l', L, 'detail']]);

    s.invalidate.mockClear();
    invalidateLedger(qc, L, { baseCurrencyChanged: true });
    expect(keys(s.invalidate)).toEqual([
      ['global', 'ledgers'],
      ['l', L, 'detail'],
      ['l', L],
    ]);
  });

  test('ledgersApi.remove / leave → global.ledgers + removeQueries(["l", id]) + my accounts', () => {
    const s = spies(qc);
    removeLedger(qc, L);
    // My accounts outlive the ledger, but their `shared_to` stops naming it (§14.62).
    expect(keys(s.invalidate)).toEqual([['global', 'ledgers'], ['global', 'sources']]);
    expect(keys(s.remove)).toEqual([['l', L]]);
  });

  test('removeMember / transferOwnership → members + detail + account list + global.ledgers', () => {
    const s = spies(qc);
    invalidateMembers(qc, L);
    // A removed member's accounts are no longer shared into the ledger (§14.62).
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'members'],
      ['l', L, 'detail'],
      ['l', L, 'sources'],
      ['global', 'ledgers'],
    ]);
  });

  test('sourcesApi.* → my accounts and every ledger’s account list, nothing else', () => {
    seedAccountCache(qc);
    invalidateSources(qc);
    expect(staleKeys(qc)).toEqual(EVERY_ACCOUNT_KEY);
  });

  test('a balance-moving account change adds the stats of every cached ledger', () => {
    seedAccountCache(qc);
    invalidateSources(qc, { affectsBalances: true });
    expect(staleKeys(qc)).toEqual([...EVERY_ACCOUNT_KEY, ...EVERY_STATS_KEY].sort());
  });

  test('txApi.create / update / remove → tx + sources + stats + my accounts', () => {
    const s = spies(qc);
    invalidateTransactions(qc, L);
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
      ['global', 'sources'],
    ]);
  });

  test('transfer writes add the pair key', () => {
    const s = spies(qc);
    invalidateTransfer(qc, L, 'p1');
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
      ['global', 'sources'],
      ['l', L, 'tx', 'transfer', 'p1'],
    ]);
  });

  test('pair adds both legs; removeTransfer drops the pair key', () => {
    const s = spies(qc);
    invalidatePair(qc, L, 't1', 't2');
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
      ['global', 'sources'],
      ['l', L, 'tx', 'detail', 't1'],
      ['l', L, 'tx', 'detail', 't2'],
    ]);

    removeTransfer(qc, L, 'p1');
    expect(keys(s.remove)).toEqual([['l', L, 'tx', 'transfer', 'p1']]);
  });

  test('meApi.update → global.me; a new display name refreshes every cached members list', () => {
    qc.setQueryData(qk.ledger(L).detail(), { id: L });
    qc.setQueryData(qk.ledger(OTHER).sources(), { items: [], total: 0 });
    qc.setQueryData(qk.global.ledgers(), { items: [], total: 0 });

    const s = spies(qc);
    invalidateMe(qc);
    expect(keys(s.invalidate)).toEqual([['global', 'me']]);

    s.invalidate.mockClear();
    invalidateMe(qc, { displayNameChanged: true });
    expect(keys(s.invalidate)).toEqual([
      ['global', 'me'],
      ['l', L, 'members'],
      ['l', OTHER, 'members'],
    ]);
  });

  test('meApi.update with a new base currency refreshes my accounts (balance_base, §14.62)', () => {
    const s = spies(qc);
    invalidateMe(qc, { baseCurrencyChanged: true });
    expect(keys(s.invalidate)).toEqual([['global', 'me'], ['global', 'sources']]);
  });
});

describe('mutations wire themselves to the matrix', () => {
  let api: MockApi;
  let qc: QueryClient;

  beforeEach(() => {
    api = mockApi();
    qc = makeClient();
  });

  afterEach(() => {
    api.restore();
    qc.clear();
  });

  test('useUpdateLedger invalidates the whole ledger when the base currency changes', async () => {
    mockPatch(`/ledgers/${L}`, { id: L });
    const s = spies(qc);
    const { result } = renderHook(() => useUpdateLedger(L), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ name: 'x', updated_at: '2026-09-01T12:00:00.000000Z' });
    expect(keys(s.invalidate)).toEqual([['global', 'ledgers'], ['l', L, 'detail']]);

    s.invalidate.mockClear();
    await result.current.mutateAsync({
      base_currency: 'SGD',
      updated_at: '2026-09-01T12:00:00.000000Z',
    });
    expect(keys(s.invalidate)).toContainEqual(['l', L]);
  });

  test('useCreateSource reaches my accounts and every ledger’s account list', async () => {
    mockPost('/sources', makeSource(), 201);
    seedAccountCache(qc);
    const { result } = renderHook(() => useCreateSource(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ name: 'x', type: 'cash', default_currency: 'CNY' });
    expect(staleKeys(qc)).toEqual(EVERY_ACCOUNT_KEY);
  });

  test('useUpdateSource adds every ledger’s stats when the opening balance moves', async () => {
    mockPatch(`/sources/${SOURCE_ID}`, makeSource());
    seedAccountCache(qc);
    const { result } = renderHook(() => useUpdateSource(SOURCE_ID), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ name: 'x', updated_at: '2026-09-01T12:00:00.000000Z' });
    expect(staleKeys(qc)).toEqual(EVERY_ACCOUNT_KEY);

    seedAccountCache(qc);
    await result.current.mutateAsync({
      opening_balance: '-10.0000',
      updated_at: '2026-09-01T12:00:00.000000Z',
    });
    expect(staleKeys(qc)).toEqual([...EVERY_ACCOUNT_KEY, ...EVERY_STATS_KEY].sort());
  });

  test('useUpdateSource declares the detail key the 409 handler needs', () => {
    const { result } = renderHook(() => useUpdateSource(SOURCE_ID), { wrapper: wrapper(qc) });
    result.current.mutate({ name: 'x', updated_at: '2026-09-01T12:00:00.000000Z' });
    const mutation = qc.getMutationCache().getAll()[0];
    expect(mutation.meta?.detailKey).toEqual(qk.global.source(SOURCE_ID));
  });

  test('useDeleteSource treats the removal as a balance change', async () => {
    mockDelete(`/sources/${SOURCE_ID}`, undefined, 204);
    seedAccountCache(qc);
    const { result } = renderHook(() => useDeleteSource(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync(SOURCE_ID);
    expect(staleKeys(qc)).toEqual([...EVERY_ACCOUNT_KEY, ...EVERY_STATS_KEY].sort());
  });

  test('useShareSource PUTs to share and DELETEs to unshare, each reaching every account list', async () => {
    const path = `/sources/${SOURCE_ID}/ledgers/${OTHER}`;
    mockPut(path, undefined, 204);
    mockDelete(path, undefined, 204);
    seedAccountCache(qc);
    const { result } = renderHook(() => useShareSource(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ sid: SOURCE_ID, lid: OTHER, share: true });
    expect(api.mock.history.put.map((c) => c.url)).toEqual([path]);
    expect(api.mock.history.delete).toHaveLength(0);
    expect(staleKeys(qc)).toEqual(EVERY_ACCOUNT_KEY);

    seedAccountCache(qc);
    await result.current.mutateAsync({ sid: SOURCE_ID, lid: OTHER, share: false });
    expect(api.mock.history.delete.map((c) => c.url)).toEqual([path]);
    expect(api.mock.history.put).toHaveLength(1);
    expect(staleKeys(qc)).toEqual(EVERY_ACCOUNT_KEY);
  });

  test('useUnpairTransfer removes the pair key and invalidates both legs', async () => {
    const out = makeTransaction({ id: TX_ID, transfer_role: 'out' });
    const into = makeTransaction({ id: 'bbbb2222-7777-4888-8999-000011112222', transfer_role: 'in' });
    // 03 §5.34: `{pair_id, unpaired: [leg, leg]}`, not `{out, in}`.
    mockPost(`/ledgers/${L}/transactions/transfer/p1/unpair`, {
      pair_id: 'p1',
      unpaired: [out, into],
    });

    const s = spies(qc);
    const { result } = renderHook(() => useUnpairTransfer(L), { wrapper: wrapper(qc) });
    await result.current.mutateAsync('p1');

    await waitFor(() => expect(s.remove).toHaveBeenCalled());
    expect(keys(s.remove)).toEqual([['l', L, 'tx', 'transfer', 'p1']]);
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
      ['global', 'sources'],
      ['l', L, 'tx', 'detail', out.id],
      ['l', L, 'tx', 'detail', into.id],
    ]);
  });

  test('useDeleteTransaction sweeps tx, sources, stats and my accounts', async () => {
    mockDelete(`/ledgers/${L}/transactions/${TX_ID}`, undefined, 204);
    const s = spies(qc);
    const { result } = renderHook(() => useDeleteTransaction(L), { wrapper: wrapper(qc) });
    await result.current.mutateAsync(TX_ID);
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
      ['global', 'sources'],
    ]);
  });
});
