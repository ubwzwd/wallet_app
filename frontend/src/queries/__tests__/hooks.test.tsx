/** The hooks, driven through the mocked API (04 §8.2). */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationResult,
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { LedgerMember, Transaction, TransactionListResponse } from '@/api/types';
import {
  CATEGORY_VERSION,
  LEDGER_ID,
  USER_ID,
  makeCategoryTree,
  makeCurrencyList,
  makeTransaction,
  makeTransferPair,
} from '@/test/fixtures';
import { apiUrl, mockApi, mockGet, mockPost, type MockApi } from '@/test/mockApi';
import { PREF_NAMES, getJsonPref, getJsonPrefSync, setJsonPref } from '@/utils/prefs';

import { useCategories, useCurrencies } from '../useGlobal';
import {
  useCreateInvite,
  useCreateLedger,
  useDeleteLedger,
  useJoinLedger,
  useLeaveLedger,
  useMemberNames,
  useRemoveMember,
  useRevokeInvite,
  useTransferOwnership,
  useUpdateLedger,
} from '../useLedgers';
import { useUpdateMe } from '../useMe';
import {
  useCreateSource,
  useDeleteSource,
  useShareSource,
  useUpdateSource,
} from '../useSources';
import {
  useCreateTransaction,
  useCreateTransfer,
  useDeleteTransaction,
  useDeleteTransfer,
  useInfiniteTransactions,
  usePairTransaction,
  useTransfer,
  useUnpairTransfer,
  useUpdateTransaction,
  useUpdateTransfer,
} from '../useTransactions';
import { useStatsTrend } from '../useStats';

// jest-expo runs as native, where `getJsonPrefSync` always returns null; mocking it lets
// the web branch (synchronous `initialData`) be exercised too.
jest.mock('@/utils/prefs', () => ({
  ...jest.requireActual('@/utils/prefs'),
  getJsonPrefSync: jest.fn(() => null),
}));

const syncPref = jest.mocked(getJsonPrefSync);

const L = LEDGER_ID;

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

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function member(over: Partial<LedgerMember>): LedgerMember {
  return {
    user_id: USER_ID,
    email: 'alice@example.com',
    display_name: 'Alice',
    role: 'owner',
    joined_at: '2026-02-01T09:00:00.000000Z',
    is_me: true,
    ...over,
  };
}

function listPage(items: Transaction[], total: number): TransactionListResponse {
  return {
    items,
    total,
    summary: {
      base_currency: 'CNY',
      expense: '0.0000',
      income: '0.0000',
      net: '0.0000',
      count: total,
      rate_missing_count: 0,
    },
  };
}

describe('query hooks', () => {
  let api: MockApi;
  let qc: QueryClient;

  beforeEach(async () => {
    await AsyncStorage.clear();
    syncPref.mockReturnValue(null);
    api = mockApi();
    qc = makeClient();
  });

  afterEach(() => {
    api.restore();
    qc.clear();
  });

  test('useCategories paints from the stored copy first, then replaces it on a new version', async () => {
    const stored = makeCategoryTree({ version: '2026-01-01' });
    const fresh = makeCategoryTree({ version: CATEGORY_VERSION });
    await setJsonPref(PREF_NAMES.categories, stored);

    // Delay the network so the cached copy is observably on screen first.
    api.mock.onGet(apiUrl('/categories')).reply(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([200, fresh]), 300);
        }),
    );

    const { result } = renderHook(() => useCategories(), { wrapper: wrapper(qc) });

    // The persisted copy arrives first and is marked as such.
    await waitFor(() => expect(result.current.tree?.version).toBe('2026-01-01'));
    expect(result.current.index?.byL1['food']).toBeTruthy();
    expect(result.current.isPlaceholderData).toBe(true);

    await waitFor(() => expect(result.current.tree?.version).toBe(CATEGORY_VERSION));
    await waitFor(async () =>
      expect((await getJsonPref<{ version: string }>(PREF_NAMES.categories))?.version).toBe(
        CATEGORY_VERSION,
      ),
    );
  });

  test('useCategories paints from the web preference on the very first render', async () => {
    const stored = makeCategoryTree({ version: '2026-01-01' });
    const fresh = makeCategoryTree({ version: CATEGORY_VERSION });
    syncPref.mockReturnValue(stored);
    mockGet('/categories', fresh);

    const { result } = renderHook(() => useCategories(), { wrapper: wrapper(qc) });

    // No `waitFor`: the stored tree is `initialData`, so it is there before the first paint.
    expect(result.current.tree?.version).toBe('2026-01-01');
    expect(result.current.index?.byL1['food']).toBeTruthy();
    expect(result.current.isPlaceholderData).toBe(false);

    // `initialDataUpdatedAt: 0` keeps it stale, so the background request still replaces it.
    await waitFor(() => expect(result.current.tree?.version).toBe(CATEGORY_VERSION));
    await waitFor(async () =>
      expect((await getJsonPref<{ version: string }>(PREF_NAMES.categories))?.version).toBe(
        CATEGORY_VERSION,
      ),
    );
  });

  test('useCategories writes the tree to prefs when nothing was stored', async () => {
    const fresh = makeCategoryTree({ version: CATEGORY_VERSION });
    mockGet('/categories', fresh);

    const { result } = renderHook(() => useCategories(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.tree?.version).toBe(CATEGORY_VERSION));
    await waitFor(async () =>
      expect((await getJsonPref<{ version: string }>(PREF_NAMES.categories))?.version).toBe(
        CATEGORY_VERSION,
      ),
    );
  });

  test('useCategories drops a malformed stored tree and forgets the preference', async () => {
    // `expense` is not an array: `buildCategoryIndex` would throw on it.
    const broken = { version: '2026-01-01', expense: 'not-a-list', income: [] };
    syncPref.mockReturnValue(broken);
    await setJsonPref(PREF_NAMES.categories, broken);
    // The request fails, so nothing writes the preference back and the clean-up is visible.
    mockGet('/categories', { detail: 'boom', code: 'internal_error' }, 500);

    const { result } = renderHook(() => useCategories(), { wrapper: wrapper(qc) });

    expect(result.current.tree).toBeNull();
    expect(result.current.index).toBeNull();
    await waitFor(async () =>
      expect(await getJsonPref(PREF_NAMES.categories)).toBeNull(),
    );
  });

  test('useCategories drops a malformed tree read asynchronously too', async () => {
    // A version that is not a string — the shape check has to look past `expense`/`income`.
    const broken = { version: 20260101, expense: [], income: [] };
    syncPref.mockReturnValue(null);
    await setJsonPref(PREF_NAMES.categories, broken);
    mockGet('/categories', { detail: 'boom', code: 'internal_error' }, 500);

    const { result } = renderHook(() => useCategories(), { wrapper: wrapper(qc) });

    await waitFor(async () =>
      expect(await getJsonPref(PREF_NAMES.categories)).toBeNull(),
    );
    expect(result.current.tree).toBeNull();
  });

  test('useTransfer reads the pair through its own endpoint, by pair id alone', async () => {
    const pairId = 'pair-77';
    mockGet(
      `/ledgers/${L}/transactions/transfer/${pairId}`,
      makeTransferPair({ pair_id: pairId }),
    );

    const { result } = renderHook(() => useTransfer(L, pairId), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pair_id).toBe(pairId);
    // One request, and no `GET /transactions/{tid}` for either leg.
    expect(api.mock.history.get.map((c) => c.url)).toEqual([
      `/ledgers/${L}/transactions/transfer/${pairId}`,
    ]);
  });

  test('useTransfer stays idle without a pair id', async () => {
    const { result } = renderHook(() => useTransfer(L, undefined), { wrapper: wrapper(qc) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.mock.history.get.length).toBe(0);
  });

  test('every mutation hook forwards opts.silent into its meta', async () => {
    api.mock.onAny().reply(500, { detail: 'boom', code: 'internal_error' });

    type AnyMutation = UseMutationResult<unknown, Error, never>;
    const hooks: Record<string, () => AnyMutation> = {
      useCreateLedger: () => useCreateLedger({ silent: true }) as AnyMutation,
      useUpdateLedger: () => useUpdateLedger(L, { silent: true }) as AnyMutation,
      useDeleteLedger: () => useDeleteLedger(L, { silent: true }) as AnyMutation,
      useJoinLedger: () => useJoinLedger({ silent: true }) as AnyMutation,
      useCreateInvite: () => useCreateInvite(L, { silent: true }) as AnyMutation,
      useRevokeInvite: () => useRevokeInvite(L, { silent: true }) as AnyMutation,
      useRemoveMember: () => useRemoveMember(L, { silent: true }) as AnyMutation,
      useTransferOwnership: () => useTransferOwnership(L, { silent: true }) as AnyMutation,
      useLeaveLedger: () => useLeaveLedger(L, { silent: true }) as AnyMutation,
      useCreateSource: () => useCreateSource({ silent: true }) as AnyMutation,
      useUpdateSource: () => useUpdateSource('s1', { silent: true }) as AnyMutation,
      useDeleteSource: () => useDeleteSource({ silent: true }) as AnyMutation,
      useShareSource: () => useShareSource({ silent: true }) as AnyMutation,
      useCreateTransaction: () => useCreateTransaction(L, { silent: true }) as AnyMutation,
      useUpdateTransaction: () => useUpdateTransaction(L, 't1', { silent: true }) as AnyMutation,
      useDeleteTransaction: () => useDeleteTransaction(L, { silent: true }) as AnyMutation,
      useCreateTransfer: () => useCreateTransfer(L, { silent: true }) as AnyMutation,
      useUpdateTransfer: () => useUpdateTransfer(L, 'p1', { silent: true }) as AnyMutation,
      useDeleteTransfer: () => useDeleteTransfer(L, { silent: true }) as AnyMutation,
      usePairTransaction: () => usePairTransaction(L, 't1', { silent: true }) as AnyMutation,
      useUnpairTransfer: () => useUnpairTransfer(L, { silent: true }) as AnyMutation,
      useUpdateMe: () => useUpdateMe({ silent: true }) as AnyMutation,
    };

    for (const [name, useHook] of Object.entries(hooks)) {
      const { result } = renderHook(useHook, { wrapper: wrapper(qc) });
      await result.current.mutateAsync({} as never).catch(() => undefined);
      const mutations = qc.getMutationCache().getAll();
      const meta = mutations[mutations.length - 1]?.meta;
      expect([name, meta?.silent]).toEqual([name, true]);
    }
  });

  test('a mutation hook without opts leaves the global toast in charge', async () => {
    api.mock.onAny().reply(500, { detail: 'boom', code: 'internal_error' });

    const { result } = renderHook(() => useDeleteTransaction(L), { wrapper: wrapper(qc) });
    await result.current.mutateAsync('t1').catch(() => undefined);

    expect(qc.getMutationCache().getAll()[0]?.meta?.silent).toBeUndefined();
  });

  test('the PATCH-shaped hooks keep their 409 detail key alongside silent', async () => {
    api.mock.onAny().reply(500, { detail: 'boom', code: 'internal_error' });

    const { result } = renderHook(() => useUpdateTransaction(L, 't1', { silent: true }), {
      wrapper: wrapper(qc),
    });
    await result.current
      .mutateAsync({ updated_at: '2026-09-01T00:00:00.000000Z' })
      .catch(() => undefined);

    expect(qc.getMutationCache().getAll()[0]?.meta).toEqual({
      detailKey: ['l', L, 'tx', 'detail', 't1'],
      silent: true,
    });
  });

  test('useCurrencies sorts the codes', async () => {
    mockGet('/rates/currencies', makeCurrencyList({ currencies: { USD: 'US Dollar', CNY: 'Yuan' } }));
    const { result } = renderHook(() => useCurrencies(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.codes.length).toBe(2));
    expect(result.current.codes).toEqual(['CNY', 'USD']);
    expect(result.current.names.USD).toBe('US Dollar');
  });

  test('useMemberNames falls back to the email prefix when there is no display name', async () => {
    mockGet(`/ledgers/${L}/members`, {
      items: [
        member({ user_id: 'u1', display_name: 'Alice' }),
        member({ user_id: 'u2', display_name: null, email: 'bob@example.com', is_me: false }),
        member({ user_id: 'u3', display_name: '   ', email: 'carol@example.com', is_me: false }),
      ],
      total: 3,
    });

    const { result } = renderHook(() => useMemberNames(L), { wrapper: wrapper(qc) });
    await waitFor(() => expect(Object.keys(result.current).length).toBe(3));
    expect(result.current).toEqual({ u1: 'Alice', u2: 'bob', u3: 'carol' });
  });

  test('hooks stay disabled while their ids are missing', async () => {
    const { result } = renderHook(() => useStatsTrend(undefined), { wrapper: wrapper(qc) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.mock.history.get.length).toBe(0);
  });

  test('useInfiniteTransactions walks the offset and stops at total', async () => {
    const offsets: number[] = [];
    api.mock.onGet(apiUrl(`/ledgers/${L}/transactions`)).reply((config) => {
      const params = (config.params ?? {}) as { offset?: number };
      const offset = params.offset ?? 0;
      offsets.push(offset);
      const items = Array.from({ length: 50 }, (_, i) =>
        makeTransaction({ id: `tx-${offset + i}` }),
      );
      return [200, listPage(offset === 0 ? items : items.slice(0, 20), 70)];
    });

    const { result } = renderHook(() => useInfiniteTransactions(L, { kind: ['expense'] }), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(offsets).toEqual([0]);
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(offsets).toEqual([0, 50]);
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.data?.pages.flatMap((p) => p.items).length).toBe(70);
  });

  test('useCreateTransaction invalidates transactions, sources, stats and my accounts', async () => {
    mockPost(`/ledgers/${L}/transactions`, makeTransaction(), 201);
    const invalidate = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useCreateTransaction(L), { wrapper: wrapper(qc) });
    await result.current.mutateAsync({
      source_id: 's1',
      kind: 'expense',
      amount: '-10.0000',
      currency: 'CNY',
      occurred_at: '2026-09-01',
    });

    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([
      ['l', L, 'tx'],
      ['l', L, 'sources'],
      ['l', L, 'stats'],
      // A balance sums every ledger the account is used in (decision §14.62).
      ['global', 'sources'],
    ]);
  });
});
