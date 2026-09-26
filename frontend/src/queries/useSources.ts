/**
 * Finance accounts (04 §3.4, §3.6 — the `sourcesApi.*` rows).
 *
 * Decision §14.62: an account belongs to its owner and is shared into ledgers. The `useMy*`
 * hooks and the mutations work on my own accounts (`/sources*`, cached under
 * `global.sources`); `useLedgerSources` is what one ledger can see — mine, the ones members
 * shared in, and any account its transactions still reference — and feeds the pickers.
 */
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
  LedgerSource,
  Paged,
  SourceListResponse,
  Uuid,
} from '@/api/types';

import type { MutationOpts } from './client';
import { invalidateSources } from './invalidate';
import { qk } from './keys';

export interface SourceListParams {
  include_archived?: boolean;
}

/** My accounts, with my net worth (`GET /sources`). */
export function useMySources(p?: SourceListParams): UseQueryResult<SourceListResponse> {
  return useQuery({
    queryKey: qk.global.sources(p),
    queryFn: () => sourcesApi.list(p),
  });
}

/** One of my accounts. Someone else's id is a 404. */
export function useMySource(sid: Uuid | undefined): UseQueryResult<FinanceSource> {
  return useQuery({
    queryKey: qk.global.source(sid ?? ''),
    queryFn: () => sourcesApi.get(sid as Uuid),
    enabled: Boolean(sid),
  });
}

/** What ledger `l` can see (`GET /ledgers/{l}/sources`); `usable` says which I may use. */
export function useLedgerSources(
  l: Uuid | undefined,
  p?: SourceListParams,
): UseQueryResult<Paged<LedgerSource>> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').sources(p),
    queryFn: () => sourcesApi.listInLedger(l as Uuid, p),
    enabled: Boolean(l),
  });
}

export function useCreateSource(
  opts?: MutationOpts,
): UseMutationResult<FinanceSource, Error, FinanceSourceCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: FinanceSourceCreate) => sourcesApi.create(b),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateSources(qc),
  });
}

/**
 * A changed `opening_balance` or `archived` moves balances, net worth and the monthly
 * stats as well (decision §14.50), so those get invalidated too.
 */
export function useUpdateSource(
  sid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<FinanceSource, Error, FinanceSourceUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: FinanceSourceUpdate) => sourcesApi.update(sid, b),
    meta: { detailKey: qk.global.source(sid), silent: opts?.silent },
    onSuccess: (_data, variables) =>
      invalidateSources(qc, {
        affectsBalances:
          variables.opening_balance !== undefined || variables.archived !== undefined,
      }),
  });
}

/**
 * Only an account no transaction or import batch references can be deleted (409
 * `source_has_transactions` otherwise), but its opening balance leaves net worth, so this
 * counts as a balance change.
 */
export function useDeleteSource(opts?: MutationOpts): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: Uuid) => sourcesApi.remove(sid),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateSources(qc, { affectsBalances: true }),
  });
}

export interface ShareSourceVars {
  sid: Uuid;
  lid: Uuid;
  /** `true` shares the account into the ledger (PUT), `false` stops sharing it (DELETE). */
  share: boolean;
}

/**
 * Share one of my accounts into a ledger I belong to, or stop sharing it. Both directions
 * are idempotent; stopping keeps the entries already written with it.
 */
export function useShareSource(
  opts?: MutationOpts,
): UseMutationResult<void, Error, ShareSourceVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sid, lid, share }: ShareSourceVars) =>
      share ? sourcesApi.share(sid, lid) : sourcesApi.unshare(sid, lid),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateSources(qc),
  });
}
