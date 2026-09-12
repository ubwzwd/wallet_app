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
 * A two-leg transfer, keyed by `pair_id`.
 *
 * There is no `GET .../transfer/{pair_id}` endpoint (03 §5.30–§5.34 only has POST / PATCH /
 * DELETE / unpair), so the pair is read through one of its legs: `GET /transactions/{tid}`
 * carries the whole `pair` (04 §3.3, §4.7). `legTxId` is the leg the caller came from; the
 * create / update transfer hooks below seed this key with the `TransferPair` they get back,
 * so a page reached straight from a mutation already has it. Without a leg id and without a
 * seeded pair the query stays idle.
 */
export function useTransfer(
  l: Uuid | undefined,
  pid: Uuid | undefined,
  legTxId?: Uuid,
): UseQueryResult<TransferPair> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').transfer(pid ?? ''),
    queryFn: async () => {
      const leg = await txApi.get(l as Uuid, legTxId as Uuid);
      const ref = leg.pair;
      if (!ref) throw new Error(`transaction ${leg.id} is not part of a transfer pair`);
      // `pair` is only a reference (04 §3.3), so both legs are read in full.
      const [out, into] = await Promise.all([
        leg.id === ref.out.transaction_id
          ? Promise.resolve(leg)
          : txApi.get(l as Uuid, ref.out.transaction_id),
        leg.id === ref.in.transaction_id
          ? Promise.resolve(leg)
          : txApi.get(l as Uuid, ref.in.transaction_id),
      ]);
      const pair: TransferPair = {
        pair_id: ref.pair_id,
        occurred_at: out.occurred_at,
        subtype: out.transfer_subtype ?? 'plain',
        note: out.note,
        out,
        in: into,
        // 04 §3.8: the newer of the two legs is what a PATCH must send back.
        updated_at: out.updated_at >= into.updated_at ? out.updated_at : into.updated_at,
      };
      return pair;
    },
    enabled: Boolean(l) && Boolean(pid) && Boolean(legTxId),
  });
}

// ------------------------------------------------------------------ mutations

export function useCreateTransaction(
  l: Uuid,
): UseMutationResult<Transaction, Error, TransactionCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransactionCreate) => txApi.create(l, b),
    onSuccess: () => invalidateTransactions(qc, l),
  });
}

export function useUpdateTransaction(
  l: Uuid,
  tid: Uuid,
): UseMutationResult<Transaction, Error, TransactionUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransactionUpdate) => txApi.update(l, tid, b),
    meta: { detailKey: qk.ledger(l).tx(tid) },
    onSuccess: () => invalidateTransactions(qc, l),
  });
}

export function useDeleteTransaction(l: Uuid): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tid: Uuid) => txApi.remove(l, tid),
    onSuccess: () => invalidateTransactions(qc, l),
  });
}

export function useCreateTransfer(
  l: Uuid,
): UseMutationResult<TransferPair, Error, TransferCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransferCreate) => txApi.createTransfer(l, b),
    onSuccess: (pair) => {
      qc.setQueryData(qk.ledger(l).transfer(pair.pair_id), pair);
      invalidateTransfer(qc, l, pair.pair_id);
    },
  });
}

export function useUpdateTransfer(
  l: Uuid,
  pairId: Uuid,
): UseMutationResult<TransferPair, Error, TransferUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransferUpdate) => txApi.updateTransfer(l, pairId, b),
    meta: { detailKey: qk.ledger(l).transfer(pairId) },
    onSuccess: (pair) => {
      qc.setQueryData(qk.ledger(l).transfer(pairId), pair);
      invalidateTransfer(qc, l, pairId);
    },
  });
}

export function useDeleteTransfer(l: Uuid): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairId: Uuid) => txApi.removeTransfer(l, pairId),
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
): UseMutationResult<TransferPair, Error, TransactionPairRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransactionPairRequest) => txApi.pair(l, tid, b),
    onSuccess: (_pair, variables) =>
      invalidatePair(qc, l, tid, variables.counterpart_transaction_id),
  });
}

/** Split a pair back into two legs: the pair itself stops existing, so its key is removed. */
export function useUnpairTransfer(l: Uuid): UseMutationResult<UnpairResult, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairId: Uuid) => txApi.unpair(l, pairId),
    onSuccess: (result, pairId) => {
      invalidatePair(qc, l, result.out.id, result.in.id);
      removeTransfer(qc, l, pairId);
    },
  });
}
