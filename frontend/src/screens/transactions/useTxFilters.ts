/**
 * The URL is the transaction list's only filter state (04 §1.3).
 *
 * Everything the filter bar, the chips, the pager and the "rescue" suggestions do goes
 * through here: read with `parseTxFilters`, write with `serializeTxFilters` (empty values
 * never reach the URL) and always through `router.replace`, so a filter change does not
 * pile up on the back stack. Only the search box is debounced — 300ms of typing would
 * otherwise be 300ms of history entries and requests.
 */
import React from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import type { TransactionListParams, Uuid } from '@/api/types';
import { activeFilterCount, parseTxFilters, removeFilter, serializeTxFilters } from '@/domain/filters';
import { routes } from '@/domain/routes';

/** 04 §4.5: the search box writes the URL 300ms after the last keystroke. */
export const Q_DEBOUNCE_MS = 300;

export interface TxFiltersApi {
  /** What the URL currently says, `offset` included. */
  filters: TransactionListParams;
  /** Number of active conditions — the badge on the narrow-layout filter button. */
  activeCount: number;
  /** The search box's own value: it runs ahead of the URL by up to `Q_DEBOUNCE_MS`. */
  qDraft: string;
  setQ(value: string): void;
  /** Merge a change in and drop the page cursor (a new filter means page 1). */
  patch(next: Partial<TransactionListParams>): void;
  /** Wide-layout paging: the only writer of `offset`. */
  setOffset(offset: number): void;
  /** Drop one condition (or one value of an array condition). */
  remove(key: keyof TransactionListParams, value?: string): void;
  /** Replace the whole filter set — used by the "drop this condition" suggestions. */
  replaceAll(next: TransactionListParams): void;
  /** Back to the bare path. */
  clear(): void;
}

export function useTxFilters(ledgerId: Uuid): TxFiltersApi {
  const router = useRouter();
  const search = useLocalSearchParams<Record<string, string | string[]>>();

  // `useLocalSearchParams` hands back a fresh object every render, so the parsed value is
  // stabilised on its serialisation — otherwise every consumer's `useMemo` would churn.
  const parsed = parseTxFilters(search as Record<string, string | string[] | undefined>);
  const parsedKey = JSON.stringify(serializeTxFilters(parsed));
  const filters = React.useMemo<TransactionListParams>(
    () => parsed,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsedKey],
  );

  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;

  const write = React.useCallback(
    (next: TransactionListParams): void => {
      router.replace(routes.l(ledgerId).transactions(next) as Href);
    },
    [ledgerId, router],
  );

  // ------------------------------------------------------------- debounced `q`
  const urlQ = filters.q ?? '';
  const [qDraft, setQDraft] = React.useState(urlQ);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingQ = React.useRef<string | null>(null);

  const cancelPendingQ = React.useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pendingQ.current = null;
  }, []);

  // The URL moved on its own (back button, "clear filters", a suggestion): adopt it —
  // unless the user is mid-edit, whose keystrokes would otherwise be thrown away.
  React.useEffect(() => {
    if (pendingQ.current === null) setQDraft(urlQ);
  }, [urlQ]);

  React.useEffect(() => () => cancelPendingQ(), [cancelPendingQ]);

  const setQ = React.useCallback(
    (value: string): void => {
      setQDraft(value);
      pendingQ.current = value;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const next = pendingQ.current ?? '';
        pendingQ.current = null;
        write({ ...filtersRef.current, q: next === '' ? undefined : next, offset: undefined });
      }, Q_DEBOUNCE_MS);
    },
    [write],
  );

  // ------------------------------------------------------------------- writers
  const patch = React.useCallback(
    (next: Partial<TransactionListParams>): void => {
      write({ ...filtersRef.current, ...next, offset: undefined });
    },
    [write],
  );

  const setOffset = React.useCallback(
    (offset: number): void => {
      write({ ...filtersRef.current, offset: offset > 0 ? offset : undefined });
    },
    [write],
  );

  const remove = React.useCallback(
    (key: keyof TransactionListParams, value?: string): void => {
      const next = removeFilter(filtersRef.current, key, value);
      if (key === 'q') {
        cancelPendingQ();
        setQDraft('');
      }
      write({ ...next, offset: undefined });
    },
    [cancelPendingQ, write],
  );

  const replaceAll = React.useCallback(
    (next: TransactionListParams): void => {
      cancelPendingQ();
      setQDraft(next.q ?? '');
      write({ ...next, offset: undefined });
    },
    [cancelPendingQ, write],
  );

  const clear = React.useCallback((): void => {
    cancelPendingQ();
    setQDraft('');
    write({});
  }, [cancelPendingQ, write]);

  return {
    filters,
    activeCount: activeFilterCount(filters),
    qDraft,
    setQ,
    patch,
    setOffset,
    remove,
    replaceAll,
    clear,
  };
}
