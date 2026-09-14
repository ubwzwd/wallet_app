/**
 * The review table's row slices and its selection set (04 §4.11.6).
 *
 * Two rules the spec is explicit about and this hook encodes:
 *  - a slice only decides what is *shown*; switching slices never touches the selection,
 *    so "select a page of rows, look at the flagged ones, come back" keeps the selection;
 *  - "uncategorized" is derived, never a server field: a transfer row has no category by
 *    definition and a skipped row is not going to be committed, so neither counts
 *    (04 §4.11.4, decision §1.3).
 */
import React from 'react';

import type { ImportRow, Uuid } from '@/api/types';

export type ReviewSlice = 'all' | 'uncategorized' | 'flagged' | 'skipped';

export const REVIEW_SLICES: readonly ReviewSlice[] = ['all', 'uncategorized', 'flagged', 'skipped'];

/** 04 §4.11.4: `category_l1 == null && kind !== 'transfer' && status !== 'skipped'`. */
export function isUncategorized(row: ImportRow): boolean {
  return row.category_l1 === null && row.kind !== 'transfer' && row.status !== 'skipped';
}

/** A row that will produce a transaction on commit (04 §4.11.8: the submit count). */
export function isCommittable(row: ImportRow): boolean {
  return row.status !== 'skipped';
}

export function matchesSlice(row: ImportRow, slice: ReviewSlice): boolean {
  switch (slice) {
    case 'all':
      return true;
    case 'uncategorized':
      return isUncategorized(row);
    case 'flagged':
      return row.flags.length > 0;
    case 'skipped':
      return row.status === 'skipped';
  }
}

export type SliceCounts = Record<ReviewSlice, number>;

export function sliceCounts(rows: readonly ImportRow[]): SliceCounts {
  return {
    all: rows.length,
    uncategorized: rows.filter(isUncategorized).length,
    flagged: rows.filter((r) => r.flags.length > 0).length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
  };
}

export interface ReviewSelection {
  slice: ReviewSlice;
  setSlice(next: ReviewSlice): void;
  /** The rows the current slice shows, in `row_no` order. */
  visible: ImportRow[];
  counts: SliceCounts;
  selected: ReadonlySet<Uuid>;
  count: number;
  toggle(row: ImportRow, index: number): void;
  /** `Shift + click` / `Shift + ↑↓`: select everything between the anchor and `index`. */
  extendTo(index: number): void;
  toggleAll(next: boolean): void;
  clear(): void;
  /** Rows of the current selection, resolved against the freshest row list. */
  selectedRows(): ImportRow[];
}

/**
 * `rows` is the whole batch (already merged with any optimistic edits); the hook derives
 * the visible slice from it, so a row that stops matching the slice — the moment its
 * category is filled in, say — leaves the list without any extra bookkeeping.
 */
export function useReviewSelection(rows: readonly ImportRow[]): ReviewSelection {
  const [slice, setSliceState] = React.useState<ReviewSlice | null>(null);
  const [selected, setSelected] = React.useState<ReadonlySet<Uuid>>(() => new Set<Uuid>());
  const anchor = React.useRef<number | null>(null);
  const didInit = React.useRef(false);

  const counts = React.useMemo(() => sliceCounts(rows), [rows]);

  // 04 §4.11.6: the *first* paint with rows in it lands on "uncategorized" when there is
  // anything to fix, and on "all" otherwise — then it is settled. Deriving it from the
  // counts on every render instead would yank the user back to "all" the instant they
  // categorize the last row, which is the opposite of what the spec asks for.
  React.useEffect(() => {
    if (didInit.current || rows.length === 0) return;
    didInit.current = true;
    setSliceState(counts.uncategorized > 0 ? 'uncategorized' : 'all');
  }, [rows.length, counts.uncategorized]);

  const current = slice ?? 'all';

  const visible = React.useMemo(
    () => rows.filter((row) => matchesSlice(row, current)),
    [rows, current],
  );

  const setSlice = React.useCallback((next: ReviewSlice): void => {
    // Deliberately does not touch `selected` (04 §4.11.6).
    anchor.current = null;
    setSliceState(next);
  }, []);

  const toggle = React.useCallback((row: ImportRow, index: number): void => {
    anchor.current = index;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;

  const extendTo = React.useCallback((index: number): void => {
    const list = visibleRef.current;
    const from = anchor.current ?? index;
    const [lo, hi] = from <= index ? [from, index] : [index, from];
    anchor.current = index;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of list.slice(lo, hi + 1)) next.add(row.id);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback((on: boolean): void => {
    const list = visibleRef.current;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of list) {
        if (on) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }, []);

  const clear = React.useCallback((): void => {
    anchor.current = null;
    setSelected(new Set<Uuid>());
  }, []);

  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const selectedRows = React.useCallback(
    (): ImportRow[] => rowsRef.current.filter((row) => selected.has(row.id)),
    [selected],
  );

  return {
    slice: current,
    setSlice,
    visible,
    counts,
    selected,
    count: selected.size,
    toggle,
    extendTo,
    toggleAll,
    clear,
    selectedRows,
  };
}
