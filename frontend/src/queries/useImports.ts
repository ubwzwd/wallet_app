/**
 * Imports: batch history, one batch, its draft rows, and the six writes (04 §3.6).
 *
 * Two things set this family apart from the rest of the cache layer:
 *  - upload is *synchronous* (decision §5) — a 201 already carries the batch and every
 *    draft row, so both are seeded straight into the cache and review paints without a
 *    second request;
 *  - the draft rows query turns `refetchOnWindowFocus` off (04 §2.4, exception 1): the
 *    review table is an editor, and a background refetch would overwrite what is being
 *    typed. `patchRow` therefore patches the cache in place and invalidates nothing.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { importsApi, type UploadProgressHandler } from '@/api/imports';
import { normalizeParams } from '@/api/params';
import type {
  ImportBatch,
  ImportBatchListItem,
  ImportCommitResult,
  ImportDeleteResult,
  ImportRow,
  ImportRowListParams,
  ImportRowPatch,
  ImportRowsBulkPatch,
  ImportRowsBulkResult,
  ImportStatus,
  ImportUploadResult,
  Paged,
  Uuid,
} from '@/api/types';

import type { MutationOpts } from './client';
import {
  invalidateAfterCommit,
  invalidateImportBatch,
  invalidateImports,
  removeImportBatch,
} from './invalidate';
import { qk } from './keys';

/** Query params of the batch history (03 §5.38). */
export interface ImportListParams {
  status?: ImportStatus[];
  limit?: number;
  offset?: number;
}

/** Variables of a multipart upload; `onProgress` is per call, not per hook. */
export interface ImportUploadVars {
  source_id: Uuid;
  file: Blob;
  onProgress?: UploadProgressHandler;
}

/** Variables of a pasted-text upload (decision §14.47). */
export interface ImportUploadTextVars {
  source_id: Uuid;
  text: string;
}

/** Variables of the single-row PATCH — which row, and the fields to change. */
export interface ImportRowPatchVars {
  row_id: Uuid;
  patch: ImportRowPatch;
}

/** Variables of DELETE: ask with `dry_run` first, then delete for real (§14.52 B24). */
export interface ImportDeleteVars {
  dry_run?: boolean;
}

// -------------------------------------------------------------------- queries

/**
 * The batch history. Filter params live inside the key so `status=ready` and the
 * unfiltered list are separate entries; both sit under `qk.imports()`, which is what
 * `invalidateImports` sweeps.
 */
export function useImports(
  l: Uuid | undefined,
  params?: ImportListParams,
): UseQueryResult<Paged<ImportBatchListItem>> {
  const p = params ?? {};
  return useQuery({
    queryKey: [...qk.ledger(l ?? '').imports(), normalizeParams(p)] as const,
    queryFn: () => importsApi.list(l as Uuid, p),
    enabled: Boolean(l),
    placeholderData: keepPreviousData,
  });
}

/** One batch — the review header's summary counters and, after a commit, `committed_at`. */
export function useImportBatch(
  l: Uuid | undefined,
  bid: Uuid | undefined,
): UseQueryResult<ImportBatch> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').importB(bid ?? ''),
    queryFn: () => importsApi.get(l as Uuid, bid as Uuid),
    enabled: Boolean(l) && Boolean(bid),
  });
}

/**
 * The draft rows of one batch. `refetchOnWindowFocus` is off on purpose (04 §2.4):
 * this is the data behind an editable table, and a focus refetch would throw away
 * edits that have not been sent yet.
 */
export function useImportRows(
  l: Uuid | undefined,
  bid: Uuid | undefined,
  params?: ImportRowListParams,
): UseQueryResult<Paged<ImportRow>> {
  const p = params ?? {};
  return useQuery({
    queryKey: [...qk.ledger(l ?? '').importRows(bid ?? ''), normalizeParams(p)] as const,
    queryFn: () => importsApi.rows(l as Uuid, bid as Uuid, p),
    enabled: Boolean(l) && Boolean(bid),
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------------ cache writes

/** Seed the batch and its rows from a 201, so review needs no follow-up request. */
function seedUploadResult(qc: QueryClient, l: Uuid, result: ImportUploadResult): void {
  const k = qk.ledger(l);
  const bid = result.batch.id;
  qc.setQueryData(k.importB(bid), result.batch);
  // The unfiltered rows entry — the key `useImportRows(l, bid)` reads with no params.
  qc.setQueryData([...k.importRows(bid), {}] as const, {
    items: result.rows,
    total: result.rows.length,
  } satisfies Paged<ImportRow>);
}

/**
 * Replace one row wherever it is cached, leaving every entry's paging intact. Rows
 * that no longer match a filtered entry are left in place: dropping them under the
 * user's cursor mid-edit is worse than a stale filter until the next real fetch.
 */
function patchCachedRow(qc: QueryClient, l: Uuid, bid: Uuid, row: ImportRow): void {
  qc.setQueriesData<Paged<ImportRow>>(
    { queryKey: qk.ledger(l).importRows(bid) },
    (page) => {
      if (!page) return page;
      let hit = false;
      const items = page.items.map((item) => {
        if (item.id !== row.id) return item;
        hit = true;
        return row;
      });
      return hit ? { ...page, items } : page;
    },
  );
}

// ------------------------------------------------------------------ mutations

/** multipart upload. `onProgress` rides along with the variables (04 §4.10). */
export function useUploadImport(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<ImportUploadResult, Error, ImportUploadVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ImportUploadVars) =>
      importsApi.upload(l, { source_id: v.source_id, file: v.file }, v.onProgress),
    meta: { silent: opts?.silent },
    onSuccess: (result) => {
      seedUploadResult(qc, l, result);
      invalidateImports(qc, l);
    },
  });
}

/** Pasted CSV text — same pipeline, same cache seeding. */
export function useUploadImportText(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<ImportUploadResult, Error, ImportUploadTextVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ImportUploadTextVars) => importsApi.uploadText(l, v),
    meta: { silent: opts?.silent },
    onSuccess: (result) => {
      seedUploadResult(qc, l, result);
      invalidateImports(qc, l);
    },
  });
}

/** One cell edit: the answer is written into the cache and nothing is invalidated. */
export function usePatchImportRow(
  l: Uuid,
  bid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<ImportRow, Error, ImportRowPatchVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ImportRowPatchVars) => importsApi.patchRow(l, bid, v.row_id, v.patch),
    meta: { silent: opts?.silent },
    onSuccess: (row) => patchCachedRow(qc, l, bid, row),
  });
}

/** Bulk "set category" / "skip": safe to re-read the table and the batch counters. */
export function usePatchImportRows(
  l: Uuid,
  bid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<ImportRowsBulkResult, Error, ImportRowsBulkPatch> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: ImportRowsBulkPatch) => importsApi.patchRows(l, bid, b),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateImportBatch(qc, l, bid),
  });
}

/** Commit: real transactions appear, so the tx subtree, balances and stats move too. */
export function useCommitImport(
  l: Uuid,
  bid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<ImportCommitResult, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => importsApi.commit(l, bid),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateAfterCommit(qc, l),
  });
}

/**
 * Discard a draft or revert a committed batch. A `dry_run` call only answers "how much
 * would this delete" and changes nothing, so it must leave the cache alone.
 */
export function useDeleteImport(
  l: Uuid,
  bid: Uuid,
  opts?: MutationOpts,
): UseMutationResult<ImportDeleteResult, Error, ImportDeleteVars | void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v?: ImportDeleteVars | void) =>
      importsApi.remove(l, bid, v ? { dry_run: v.dry_run } : undefined),
    meta: { silent: opts?.silent },
    onSuccess: (result) => {
      if (!result.deleted) return;
      invalidateAfterCommit(qc, l);
      removeImportBatch(qc, l, bid);
    },
  });
}
