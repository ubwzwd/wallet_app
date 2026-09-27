/**
 * One batch's browsing state (04 §4.11.6, decision §14.66 e): the slice on screen and the
 * row last pointed at, kept per ledger under `imports.batch.<batchId>` — in memory, never in
 * the address. Switching slices therefore leaves no history entry (back returns to the page
 * before the batch), leaving the batch and coming back finds the same slice, and a reload
 * starts over at the §4.11.6 default.
 *
 * A page that wants the batch to open on a particular row writes `{ row: <rowId> }` there
 * with `useSetLedgerViewState()` before navigating; the batch points at it as soon as that
 * row has been read.
 */
import React from 'react';

import type { ImportRow, Uuid } from '@/api/types';
import { useLedgerViewState } from '@/store';

import type { ReviewHighlight } from './ReviewTable';
import { parseReviewSlice, type ReviewSelection, useReviewSelection } from './useReviewSelection';

/** The value stored under `imports.batch.<batchId>`. */
export interface BatchViewState {
  /** The id of the row the batch points at. */
  row?: string;
  /** The slice on screen (`ReviewSlice`). */
  filter?: string;
}

/** The view-state key of one batch. */
export function batchViewKey(batchId: Uuid): string {
  return `imports.batch.${batchId}`;
}

const EMPTY: BatchViewState = {};

export interface BatchView {
  selection: ReviewSelection;
  highlight: ReviewHighlight | null;
  /**
   * "Put this row in front of the user" (04 §4.11.8), from the commit bar, a bulk failure,
   * a "jump to the first one" link or the stored row. `null` clears the highlight.
   */
  jumpTo(rowNo: number | null): void;
}

export function useBatchView(
  batchId: Uuid,
  rows: readonly ImportRow[],
  options: { preferUncategorized: boolean },
): BatchView {
  const [view, setView] = useLedgerViewState<BatchViewState>(batchViewKey(batchId), EMPTY);
  // A slice picked by hand means the user has moved on from the row pointed at before.
  const onSliceChange = React.useCallback(
    (filter: string): void => setView({ filter }),
    [setView],
  );
  const selection = useReviewSelection(rows, {
    preferUncategorized: options.preferUncategorized,
    initialSlice: parseReviewSlice(view.filter),
    onSliceChange,
  });
  const [highlight, setHighlight] = React.useState<ReviewHighlight | null>(null);

  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  /** Whether the stored row has been dealt with (pointed at, or superseded by a jump). */
  const located = React.useRef(false);
  const { setSlice } = selection;

  const jumpTo = React.useCallback(
    (rowNo: number | null): void => {
      located.current = true;
      // A failure nobody could pin on a row must *clear* the previous highlight rather than
      // leave an innocent earlier row painted as the culprit — no widening, no new seq.
      if (rowNo === null) {
        setHighlight(null);
        setView((prev) => ({ filter: prev.filter }));
        return;
      }
      // The row the server (or a blocker) points at is very often *not* in the slice on
      // screen — a refused pairing is neither uncategorized nor flagged — so the jump widens
      // the view to "all" first, and the highlight carries a sequence number: pressing the
      // same link twice has to scroll twice, which a bare row number could not express.
      setSlice('all');
      const id = rowsRef.current.find((row) => row.row_no === rowNo)?.id;
      setView((prev) => ({ ...prev, row: id }));
      setHighlight((prev) => ({ rowNo, seq: (prev?.seq ?? 0) + 1 }));
    },
    [setSlice, setView],
  );

  // Entering with a stored row: point at it once it has been read (it may sit on a later
  // page of the batch than the first one).
  const storedRow = view.row;
  React.useEffect(() => {
    if (located.current || storedRow === undefined) return;
    const target = rows.find((row) => row.id === storedRow);
    if (target) jumpTo(target.row_no);
  }, [jumpTo, rows, storedRow]);

  return { selection, highlight, jumpTo };
}
