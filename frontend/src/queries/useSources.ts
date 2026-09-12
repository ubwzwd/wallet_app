/** Finance accounts (04 §3.4, §3.6 — the `sourcesApi.*` rows). */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { sourcesApi } from '@/api/sources';
import type {
  FinanceSource,
  FinanceSourceCreate,
  FinanceSourceUpdate,
  Paged,
  Uuid,
} from '@/api/types';

import type { MutationOpts } from './client';
import { invalidateSources, invalidateTransactions } from './invalidate';
import { qk } from './keys';

export interface SourceListParams {
  include_archived?: boolean;
}

export function useSources(
  l: Uuid | undefined,
  p?: SourceListParams,
): UseQueryResult<Paged<FinanceSource>> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').sources(p),
    queryFn: () => sourcesApi.list(l as Uuid, p),
    enabled: Boolean(l),
  });
}

export function useSource(
  l: Uuid | undefined,
  sid: Uuid | undefined,
): UseQueryResult<FinanceSource> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').source(sid ?? ''),
    queryFn: () => sourcesApi.get(l as Uuid, sid as Uuid),
    enabled: Boolean(l) && Boolean(sid),
  });
}

export function useCreateSource(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<FinanceSource, Error, FinanceSourceCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: FinanceSourceCreate) => sourcesApi.create(l, b),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateSources(qc, l),
  });
}

/**
 * A changed `opening_balance` or `archived` moves balances, net worth and the monthly
 * stats as well (decision §14.50), so those get invalidated too.
 */
export function useUpdateSource(
  l: Uuid,
  sid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<FinanceSource, Error, FinanceSourceUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: FinanceSourceUpdate) => sourcesApi.update(l, sid, b),
    meta: { detailKey: qk.ledger(l).source(sid), silent: opts?.silent },
    onSuccess: (_data, variables) =>
      invalidateSources(qc, l, {
        affectsBalances:
          variables.opening_balance !== undefined || variables.archived !== undefined,
      }),
  });
}

/** Deleting an account touches transactions as well, so it sweeps the transaction keys. */
export function useDeleteSource(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: Uuid) => sourcesApi.remove(l, sid),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateTransactions(qc, l),
  });
}
