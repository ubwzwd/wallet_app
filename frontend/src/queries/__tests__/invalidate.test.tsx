/** The invalidation matrix of 04 §3.6, row by row. */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { LEDGER_ID, SOURCE_ID, TX_ID, makeSource, makeTransaction } from '@/test/fixtures';
import { mockApi, mockDelete, mockPatch, mockPost, type MockApi } from '@/test/mockApi';

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
import { useUpdateSource } from '../useSources';
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

  test('ledgersApi.remove / leave → global.ledgers + removeQueries(["l", id])', () => {
    const s = spies(qc);
    removeLedger(qc, L);
    expect(keys(s.invalidate)).toEqual([['global', 'ledgers']]);
    expect(keys(s.remove)).toEqual([['l', L]]);
  });

  test('removeMember / transferOwnership → members + detail + global.ledgers', () => {
    const s = spies(qc);
    invalidateMembers(qc, L);
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'members'],
      ['l', L, 'detail'],
      ['global', 'ledgers'],
    ]);
  });

  test('sourcesApi.create → every sources variant; balances add stats', () => {
    const s = spies(qc);
    invalidateSources(qc, L);
    expect(keys(s.invalidate)).toEqual([['l', L, 'sources']]);

    s.invalidate.mockClear();
    invalidateSources(qc, L, { affectsBalances: true });
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'sources'],
      ['l', L, 'stats'],
    ]);
  });

  test('txApi.create / update / remove → tx + sources + stats', () => {
    const s = spies(qc);
    invalidateTransactions(qc, L);
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
    ]);
  });

  test('transfer writes add the pair key', () => {
    const s = spies(qc);
    invalidateTransfer(qc, L, 'p1');
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
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

  test('useUpdateSource adds stats when the opening balance moves', async () => {
    mockPatch(`/ledgers/${L}/sources/${SOURCE_ID}`, makeSource());
    const s = spies(qc);
    const { result } = renderHook(() => useUpdateSource(L, SOURCE_ID), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ name: 'x', updated_at: '2026-09-01T12:00:00.000000Z' });
    expect(keys(s.invalidate)).toEqual([['l', L, 'sources']]);

    s.invalidate.mockClear();
    await result.current.mutateAsync({
      opening_balance: '-10.0000',
      updated_at: '2026-09-01T12:00:00.000000Z',
    });
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'sources'],
      ['l', L, 'stats'],
    ]);
  });

  test('useUpdateSource declares the detail key the 409 handler needs', () => {
    const { result } = renderHook(() => useUpdateSource(L, SOURCE_ID), { wrapper: wrapper(qc) });
    result.current.mutate({ name: 'x', updated_at: '2026-09-01T12:00:00.000000Z' });
    const mutation = qc.getMutationCache().getAll()[0];
    expect(mutation.meta?.detailKey).toEqual(qk.ledger(L).source(SOURCE_ID));
  });

  test('useUnpairTransfer removes the pair key and invalidates both legs', async () => {
    const out = makeTransaction({ id: TX_ID, transfer_role: 'out' });
    const into = makeTransaction({ id: 'bbbb2222-7777-4888-8999-000011112222', transfer_role: 'in' });
    mockPost(`/ledgers/${L}/transactions/transfer/p1/unpair`, { out, in: into });

    const s = spies(qc);
    const { result } = renderHook(() => useUnpairTransfer(L), { wrapper: wrapper(qc) });
    await result.current.mutateAsync('p1');

    await waitFor(() => expect(s.remove).toHaveBeenCalled());
    expect(keys(s.remove)).toEqual([['l', L, 'tx', 'transfer', 'p1']]);
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
      ['l', L, 'tx', 'detail', out.id],
      ['l', L, 'tx', 'detail', into.id],
    ]);
  });

  test('useDeleteTransaction sweeps tx, sources and stats', async () => {
    mockDelete(`/ledgers/${L}/transactions/${TX_ID}`, undefined, 204);
    const s = spies(qc);
    const { result } = renderHook(() => useDeleteTransaction(L), { wrapper: wrapper(qc) });
    await result.current.mutateAsync(TX_ID);
    expect(keys(s.invalidate)).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
    ]);
  });
});
