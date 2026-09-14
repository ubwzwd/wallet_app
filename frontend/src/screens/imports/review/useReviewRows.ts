/**
 * The review table's editing controller (04 §4.11.5, §4.11.6).
 *
 * Every cell edit goes through `patch`, which:
 *  - drops the fields that did not actually change, so the request body carries *only* the
 *    edit (04 §4.11.5) — that is what makes a failed PATCH safe to roll back;
 *  - applies the change locally first (the optimistic layer below) and hands the row back
 *    to the table on the next render;
 *  - on failure puts the row back the way it was and remembers the patch, so the cell can
 *    offer "retry" instead of silently losing the edit.
 *
 * The optimistic layer is a per-row overlay rather than a cache rewrite: the query cache
 * stays the server's answer, `useImports`'s `patchCachedRow` writes the real row into it on
 * success, and the overlay for those fields is dropped in the same tick. A rollback is then
 * just "forget the overlay" — there is no second copy of the row to keep consistent.
 *
 * Bulk edits (04 §4.11.6, decision §14.52 A4) are one request for the whole selection and
 * are all-or-nothing on the server (03 §5.42), so nothing here is applied optimistically:
 * a 400 must leave every row exactly as it was.
 */
import React from 'react';

import type { ImportRow, ImportRowPatch, ImportRowsBulkResult, Uuid } from '@/api/types';
import { usePatchImportRow, usePatchImportRows } from '@/queries';

/** The dot beside the row number (04 §4.11.5): grey saved, blue saving, red failed. */
export type RowSaveState = 'saved' | 'saving' | 'failed';

type Overlay = Partial<Record<Uuid, ImportRowPatch>>;

interface FailedEdit {
  patch: ImportRowPatch;
}

export interface ReviewRowsController {
  /** The batch's rows with any in-flight edit applied, in `row_no` order. */
  rows: ImportRow[];
  saveStateOf(rowId: Uuid): RowSaveState;
  /**
   * How many times this row has been rolled back. Cells fold it into their own "restore
   * the original value" trigger: a rejected PATCH leaves the server row untouched, so
   * nothing else would tell a half-typed cell that its value is gone (04 §4.11.5).
   */
  revisionOf(rowId: Uuid): number;
  /** `true` while at least one row failed to save — a commit blocker (04 §4.11.8). */
  hasFailures: boolean;
  patch(row: ImportRow, patch: ImportRowPatch): void;
  retry(rowId: Uuid): void;
  bulk(rowIds: readonly Uuid[], patch: ImportRowPatch): Promise<ImportRowsBulkResult>;
  bulkPending: boolean;
}

/** The subset of `patch` that differs from the row as it stands (04 §4.11.5). */
export function changedFields(row: ImportRow, patch: ImportRowPatch): ImportRowPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((row as unknown as Record<string, unknown>)[key] !== value) out[key] = value;
  }
  return out as ImportRowPatch;
}

function withoutKeys(overlay: ImportRowPatch | undefined, keys: string[]): ImportRowPatch {
  const next: Record<string, unknown> = { ...(overlay ?? {}) };
  for (const key of keys) delete next[key];
  return next as ImportRowPatch;
}

export function useReviewRows(
  ledgerId: Uuid,
  batchId: Uuid,
  serverRows: readonly ImportRow[],
): ReviewRowsController {
  // Errors are rendered inside the offending cell, so the global toast stays out of it.
  const patchRow = usePatchImportRow(ledgerId, batchId, { silent: true });
  const patchRows = usePatchImportRows(ledgerId, batchId, { silent: true });

  const [overlay, setOverlay] = React.useState<Overlay>({});
  const [saving, setSaving] = React.useState<ReadonlySet<Uuid>>(() => new Set<Uuid>());
  const [failed, setFailed] = React.useState<Partial<Record<Uuid, FailedEdit>>>({});
  const [rollbacks, setRollbacks] = React.useState<Partial<Record<Uuid, number>>>({});

  const rows = React.useMemo(() => {
    const merged = serverRows.map((row) => {
      const pending = overlay[row.id];
      return pending && Object.keys(pending).length > 0 ? { ...row, ...pending } : row;
    });
    return [...merged].sort((a, b) => a.row_no - b.row_no);
  }, [serverRows, overlay]);

  const send = React.useCallback(
    (rowId: Uuid, fields: ImportRowPatch): void => {
      const keys = Object.keys(fields);
      if (keys.length === 0) return;
      setOverlay((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), ...fields } }));
      setSaving((prev) => new Set(prev).add(rowId));
      setFailed((prev) => {
        if (!prev[rowId]) return prev;
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
      patchRow.mutate(
        { row_id: rowId, patch: fields },
        {
          onSuccess: () => {
            // The server row is in the cache now; the overlay for these fields is spent.
            setOverlay((prev) => ({ ...prev, [rowId]: withoutKeys(prev[rowId], keys) }));
          },
          onError: () => {
            // Roll back exactly what this request tried to change (04 §4.11.5).
            setOverlay((prev) => ({ ...prev, [rowId]: withoutKeys(prev[rowId], keys) }));
            setFailed((prev) => ({ ...prev, [rowId]: { patch: fields } }));
            setRollbacks((prev) => ({ ...prev, [rowId]: (prev[rowId] ?? 0) + 1 }));
          },
          onSettled: () => {
            setSaving((prev) => {
              const next = new Set(prev);
              next.delete(rowId);
              return next;
            });
          },
        },
      );
    },
    [patchRow],
  );

  const patch = React.useCallback(
    (row: ImportRow, fields: ImportRowPatch): void => {
      send(row.id, changedFields(row, fields));
    },
    [send],
  );

  const retry = React.useCallback(
    (rowId: Uuid): void => {
      const entry = failed[rowId];
      if (!entry) return;
      send(rowId, entry.patch);
    },
    [failed, send],
  );

  const saveStateOf = React.useCallback(
    (rowId: Uuid): RowSaveState => {
      if (saving.has(rowId)) return 'saving';
      if (failed[rowId]) return 'failed';
      return 'saved';
    },
    [saving, failed],
  );

  const bulk = React.useCallback(
    (rowIds: readonly Uuid[], fields: ImportRowPatch): Promise<ImportRowsBulkResult> =>
      patchRows.mutateAsync({ row_ids: [...rowIds], patch: fields }),
    [patchRows],
  );

  const revisionOf = React.useCallback((rowId: Uuid): number => rollbacks[rowId] ?? 0, [rollbacks]);

  return {
    rows,
    saveStateOf,
    revisionOf,
    hasFailures: Object.keys(failed).length > 0,
    patch,
    retry,
    bulk,
    bulkPending: patchRows.isPending,
  };
}
