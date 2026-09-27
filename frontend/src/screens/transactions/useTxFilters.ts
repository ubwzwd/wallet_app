/**
 * The transaction list's filter state (04 §4.5, decision §14.66 e).
 *
 * The filters and the wide layout's page cursor (`offset`) are browsing state: they live in
 * the current ledger's view state under `'transactions.filters'`, never in the address. So
 * going to a detail page and back keeps them, the back button walks pages and never undoes
 * a filter, each ledger keeps its own set, and a reload starts over with none.
 *
 * Everything the filter bar, the chips, the pager and the "rescue" suggestions do goes
 * through here. Every write is normalised by the same rules `parseTxFilters` applies (empty
 * values dropped, malformed ones refused), so two equal filter sets are one query. Only the
 * search box is debounced — 300ms of typing would otherwise be 300ms of requests.
 *
 * A page that opens the list *with* a filter (an account's entries on the home page, a
 * batch's transactions) uses `useOpenTransactions`: it writes the filter, then navigates.
 */
import React from 'react';
import { useRouter, type Href } from 'expo-router';

import type { TransactionListParams } from '@/api/types';
import { activeFilterCount, parseTxFilters, removeFilter, serializeTxFilters } from '@/domain/filters';
import { routes } from '@/domain/routes';
import { useLedgerContext, useLedgerViewState, useSetLedgerViewState } from '@/store';

/** The view-state key the list's filters live under (decision §14.66 e). */
export const TX_FILTERS_KEY = 'transactions.filters';

/** 04 §4.5: the search box writes the filters 300ms after the last keystroke. */
export const Q_DEBOUNCE_MS = 300;

/** One identity for "no filters", so an untouched list does not churn its memos. */
const NO_FILTERS: TransactionListParams = {};

/** Empty values dropped, malformed ones refused, `limit` never kept. */
export function normalizeTxFilters(params: TransactionListParams): TransactionListParams {
  return parseTxFilters(serializeTxFilters(params));
}

function sameFilters(a: TransactionListParams, b: TransactionListParams): boolean {
  return JSON.stringify(serializeTxFilters(a)) === JSON.stringify(serializeTxFilters(b));
}

export interface TxFiltersApi {
  /** The current filters, `offset` included. */
  filters: TransactionListParams;
  /** Number of active conditions — the badge on the narrow-layout filter button. */
  activeCount: number;
  /** The search box's own value: it runs ahead of the filters by up to `Q_DEBOUNCE_MS`. */
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
  /** No conditions, first page. */
  clear(): void;
}

/**
 * Open the transaction list showing exactly `filters` (none: the whole ledger). What the
 * list had before is replaced, not merged — the caller is saying what to show.
 */
export function useOpenTransactions(): (filters?: TransactionListParams) => void {
  const router = useRouter();
  const setViewState = useSetLedgerViewState();
  return React.useCallback(
    (filters: TransactionListParams = NO_FILTERS): void => {
      setViewState<TransactionListParams>(TX_FILTERS_KEY, normalizeTxFilters(filters));
      router.navigate(routes.transactions() as Href);
    },
    [router, setViewState],
  );
}

export function useTxFilters(): TxFiltersApi {
  const { ledgerId } = useLedgerContext();
  const [filters, setFilters] = useLedgerViewState<TransactionListParams>(
    TX_FILTERS_KEY,
    NO_FILTERS,
  );

  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;

  const write = React.useCallback(
    (next: TransactionListParams): void => {
      const normalized = normalizeTxFilters(next);
      if (sameFilters(normalized, filtersRef.current)) return;
      filtersRef.current = normalized;
      setFilters(normalized);
    },
    [setFilters],
  );

  // ------------------------------------------------------------- debounced `q`
  const storedQ = filters.q ?? '';
  const [qDraft, setQDraft] = React.useState(storedQ);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingQ = React.useRef<string | null>(null);

  const cancelPendingQ = React.useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pendingQ.current = null;
  }, []);

  // The filters moved on their own ("clear filters", a suggestion, a chip): adopt the
  // keyword — unless the user is mid-edit, whose keystrokes would otherwise be thrown away.
  React.useEffect(() => {
    if (pendingQ.current === null) setQDraft(storedQ);
  }, [storedQ]);

  // Another ledger is another set of filters: a half-typed keyword belonged to the old one,
  // so it is dropped rather than applied to the new one a moment later.
  const lastLedger = React.useRef(ledgerId);
  React.useEffect(() => {
    if (lastLedger.current === ledgerId) return;
    lastLedger.current = ledgerId;
    cancelPendingQ();
    setQDraft(filtersRef.current.q ?? '');
  }, [cancelPendingQ, ledgerId]);

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
