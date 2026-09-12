/**
 * Transactions, two-leg transfers, pair / unpair (04 §3.4, §3.6).
 *
 * Every write sweeps `['l', id, 'tx']` plus balances and stats: filter combinations are an
 * open set, so per-key surgery would not pay off. PATCH-shaped mutations declare their
 * `meta.detailKey`, which is what the global 409 handler (§3.8) re-reads.
 */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { txApi } from '@/api/transactions';
import type {
  Transaction,
  TransactionCreate,
  TransactionListParams,
  TransactionListResponse,
  TransactionPairRequest,
  TransactionUpdate,
  TransferCreate,
  TransferPair,
  TransferUpdate,
  UnpairResult,
  Uuid,
} from '@/api/types';

import type { MutationOpts } from './client';
import {
  invalidatePair,
  invalidateTransactions,
  invalidateTransfer,
  removeTransfer,
} from './invalidate';
import { qk } from './keys';

/** Page size of the infinite transaction list (03 §4.3 allows 1..200). */
export const TX_PAGE_SIZE = 50;

/** One page of the filtered list. Previous data stays on screen while a filter changes. */
export function useTransactions(
  l: Uuid | undefined,
  params: TransactionListParams,
): UseQueryResult<TransactionListResponse> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').txList(params),
    queryFn: () => txApi.list(l as Uuid, params),
    enabled: Boolean(l),
    placeholderData: keepPreviousData,
  });
}

/** The same list, paged by `offset` — the narrow-layout "load more" list (04 §4.5). */
export function useInfiniteTransactions(
  l: Uuid | undefined,
  params: TransactionListParams,
): UseInfiniteQueryResult<InfiniteData<TransactionListResponse, number>> {
  // The paging fields belong to this hook, not to the caller: dropping any `offset` the
  // caller carried over from `useTransactions` keeps identical filters on one cache entry.
  const { offset: _ignored, ...filters } = params;
  const pageParams: TransactionListParams = { ...filters, limit: TX_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...qk.ledger(l ?? '').txList(pageParams), 'infinite'] as const,
    queryFn: ({ pageParam }) =>
      txApi.list(l as Uuid, { ...pageParams, offset: pageParam }),
    enabled: Boolean(l),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const loaded = lastPageParam + lastPage.items.length;
      if (lastPage.items.length === 0 || loaded >= lastPage.total) return undefined;
      return loaded;
    },
  });
}

export function useTransaction(
  l: Uuid | undefined,
  tid: Uuid | undefined,
): UseQueryResult<Transaction> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').tx(tid ?? ''),
    queryFn: () => txApi.get(l as Uuid, tid as Uuid),
    enabled: Boolean(l) && Boolean(tid),
  });
}

/**
 * A two-leg transfer, keyed by `pair_id` — `GET /ledgers/{id}/transactions/transfer/{pair_id}`
 * (03 §5.30a) returns both legs plus the pair's own `updated_at`, which is what a PATCH has
 * to send back (04 §3.8). The create / update hooks below seed this key with the pair they
 * get back, so a page reached straight from a mutation paints without a second request.
 */
export function useTransfer(
  l: Uuid | undefined,
  pid: Uuid | undefined,
): UseQueryResult<TransferPair> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').transfer(pid ?? ''),
    queryFn: () => txApi.getTransfer(l as Uuid, pid as Uuid),
    enabled: Boolean(l) && Boolean(pid),
  });
}

// ------------------------------------------------------------------ mutations

export function useCreateTransaction(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<Transaction, Error, TransactionCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransactionCreate) => txApi.create(l, b),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateTransactions(qc, l),
  });
}

export function useUpdateTransaction(
  l: Uuid,
  tid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<Transaction, Error, TransactionUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransactionUpdate) => txApi.update(l, tid, b),
    meta: { detailKey: qk.ledger(l).tx(tid), silent: opts?.silent },
    onSuccess: () => invalidateTransactions(qc, l),
  });
}

export function useDeleteTransaction(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tid: Uuid) => txApi.remove(l, tid),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateTransactions(qc, l),
  });
}

export function useCreateTransfer(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<TransferPair, Error, TransferCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransferCreate) => txApi.createTransfer(l, b),
    meta: { silent: opts?.silent },
    onSuccess: (pair) => {
      qc.setQueryData(qk.ledger(l).transfer(pair.pair_id), pair);
      invalidateTransfer(qc, l, pair.pair_id);
    },
  });
}

export function useUpdateTransfer(
  l: Uuid,
  pairId: Uuid,
  opts?: MutationOpts,
): UseMutationResult<TransferPair, Error, TransferUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransferUpdate) => txApi.updateTransfer(l, pairId, b),
    meta: { detailKey: qk.ledger(l).transfer(pairId), silent: opts?.silent },
    onSuccess: (pair) => {
      qc.setQueryData(qk.ledger(l).transfer(pairId), pair);
      invalidateTransfer(qc, l, pairId);
    },
  });
}

export function useDeleteTransfer(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairId: Uuid) => txApi.removeTransfer(l, pairId),
    meta: { silent: opts?.silent },
    onSuccess: (_data, pairId) => {
      invalidateTransactions(qc, l);
      removeTransfer(qc, l, pairId);
    },
  });
}

/** Merge two single legs (decision §14.34): both legs gain a `pair` and a `paired` event. */
export function usePairTransaction(
  l: Uuid,
  tid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<TransferPair, Error, TransactionPairRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransactionPairRequest) => txApi.pair(l, tid, b),
    meta: { silent: opts?.silent },
    onSuccess: (_pair, variables) =>
      invalidatePair(qc, l, tid, variables.other_transaction_id),
  });
}

/** Split a pair back into two legs: the pair itself stops existing, so its key is removed. */
export function useUnpairTransfer(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<UnpairResult, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairId: Uuid) => txApi.unpair(l, pairId),
    meta: { silent: opts?.silent },
    onSuccess: (result, pairId) => {
      invalidatePair(qc, l, result.out.id, result.in.id);
      removeTransfer(qc, l, pairId);
    },
  });
}
