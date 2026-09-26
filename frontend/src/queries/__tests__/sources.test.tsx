/**
 * The account queries after decision §14.62: my own accounts are global (`/sources`, with
 * the net-worth totals), and a ledger lists what it can see (`/ledgers/{id}/sources`).
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import {
  LEDGER_ID,
  SOURCE_ID,
  makeLedgerSource,
  makeSource,
} from '@/test/fixtures';
import { apiUrl, mockApi, mockGet, type MockApi } from '@/test/mockApi';

import { qk } from '../keys';
import { useLedgerSources, useMySource, useMySources } from '../useSources';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: 0, gcTime: Infinity },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('account queries', () => {
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

  test('useMySources reads GET /sources with its totals, cached under global.sources', async () => {
    const reply = {
      items: [makeSource()],
      total: 1,
      base_currency: 'SGD',
      assets: '0.0000',
      liabilities: '-4120.5500',
      net_worth: '-4120.5500',
    };
    mockGet('/sources', reply);

    const { result } = renderHook(() => useMySources({ include_archived: true }), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(reply);
    expect(api.mock.history.get[0]?.params).toEqual({ include_archived: true });
    expect(qc.getQueryData(qk.global.sources({ include_archived: true }))).toEqual(reply);
  });

  test('useMySource reads one of my accounts, and stays idle without an id', async () => {
    const idle = renderHook(() => useMySource(undefined), { wrapper: wrapper(qc) });
    expect(idle.result.current.fetchStatus).toBe('idle');
    expect(api.mock.history.get).toHaveLength(0);

    mockGet(`/sources/${SOURCE_ID}`, makeSource());
    const { result } = renderHook(() => useMySource(SOURCE_ID), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.owner_id).toBe(makeSource().owner_id);
    expect(qc.getQueryData(qk.global.source(SOURCE_ID))).toEqual(makeSource());
  });

  test('useLedgerSources reads what one ledger can see, and stays idle without a ledger', async () => {
    const idle = renderHook(() => useLedgerSources(undefined), { wrapper: wrapper(qc) });
    expect(idle.result.current.fetchStatus).toBe('idle');
    expect(api.mock.history.get).toHaveLength(0);

    // A member's card: what only its owner may see arrives as null.
    const theirs = makeLedgerSource({ id: 'their-card', mine: false, owner_id: 'someone-else' });
    const reply = { items: [makeLedgerSource(), theirs], total: 2 };
    api.mock.onGet(apiUrl(`/ledgers/${LEDGER_ID}/sources`)).reply(200, reply);

    const { result } = renderHook(() => useLedgerSources(LEDGER_ID, { include_archived: true }), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.items.map((s) => [s.id, s.mine, s.usable])).toEqual([
      [SOURCE_ID, true, true],
      ['their-card', false, true],
    ]);
    expect(result.current.data?.items[1]).toMatchObject({
      opening_balance: null,
      balance: null,
      balance_base: null,
      shared_to: null,
    });
    expect(api.mock.history.get[0]?.params).toEqual({ include_archived: true });
    expect(qc.getQueryData(qk.ledger(LEDGER_ID).sources({ include_archived: true }))).toEqual(
      reply,
    );
  });
});
