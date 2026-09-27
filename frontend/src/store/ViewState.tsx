/**
 * Browsing state (decision §14.66 e): the home page's month, the transaction list's filters
 * and page, an import batch's slice and the row it points at. None of it is in the address
 * any more, so none of it is in the browser's history either — the back button walks pages,
 * it never undoes a filter or a month.
 *
 * It lives here instead: in memory, one bucket per ledger (the current ledger's id, `'-'`
 * with none), keyed by name. Moving between pages keeps it, switching ledger shows that
 * ledger's own values (and switching back brings the first ones back), a reload starts over
 * at the defaults (this month, no filters, the first page).
 *
 * Key names in use:
 *   'home.month'              string | null
 *   'transactions.filters'    TransactionListParams (offset included)
 *   `imports.batch.${id}`     { row?: string; filter?: string }
 *   'imports.status'          'all' | 'ready' | 'committed' (the history's slice, §14.66 j)
 *
 * A caller that opens a page *with* some state — an account's entries, a batch's
 * transactions — writes it with `useSetLedgerViewState()` and then navigates.
 *
 * `ViewStateProvider` sits at the signed-in layout, so signing out drops all of it. Outside
 * one (a screen rendered on its own in a test) `useLedgerViewState` degrades to plain
 * component state and `useSetLedgerViewState` does nothing.
 */
import React from 'react';

import { useOptionalLedgerContext } from './LedgerContext';

/** The bucket used while the user has no ledger at all. */
export const NO_LEDGER_BUCKET = '-';

/** Marks "nothing stored under this key", distinct from a stored `undefined` or `null`. */
const MISSING: unique symbol = Symbol('missing');

interface ViewStore {
  read(bucket: string, key: string): unknown;
  write(bucket: string, key: string, value: unknown): void;
  subscribe(listener: () => void): () => void;
}

function createViewStore(): ViewStore {
  const buckets = new Map<string, Map<string, unknown>>();
  const listeners = new Set<() => void>();
  return {
    read: (bucket, key) => {
      const values = buckets.get(bucket);
      return values !== undefined && values.has(key) ? values.get(key) : MISSING;
    },
    write: (bucket, key, value) => {
      let values = buckets.get(bucket);
      if (!values) {
        values = new Map();
        buckets.set(bucket, values);
      }
      if (values.has(key) && Object.is(values.get(key), value)) return;
      values.set(key, value);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const ViewStateContext = React.createContext<ViewStore | null>(null);

export function ViewStateProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [store] = React.useState(createViewStore);
  return <ViewStateContext.Provider value={store}>{children}</ViewStateContext.Provider>;
}

function useBucket(): string {
  return useOptionalLedgerContext()?.ledgerId ?? NO_LEDGER_BUCKET;
}

const noSubscribe = (): (() => void) => () => undefined;
const readMissing = (): typeof MISSING => MISSING;

export type ViewStateUpdate<T> = T | ((prev: T) => T);

/**
 * `useState`, but kept per ledger for as long as the app is open: `[value, setValue]` for
 * `key` in the current ledger's bucket, `initial` until something is stored. `setValue`
 * takes a value or an updater (so `T` itself must not be a function type).
 */
export function useLedgerViewState<T>(
  key: string,
  initial: T,
): [T, (next: ViewStateUpdate<T>) => void] {
  const store = React.useContext(ViewStateContext);
  const bucket = useBucket();
  const initialRef = React.useRef(initial);
  initialRef.current = initial;

  const subscribe = store ? store.subscribe : noSubscribe;
  const read = React.useCallback(
    () => (store ? store.read(bucket, key) : MISSING),
    [store, bucket, key],
  );
  const stored = React.useSyncExternalStore(subscribe, store ? read : readMissing, read);

  // Without a provider: ordinary component state (still one value per ledger bucket).
  const [local, setLocal] = React.useState<Record<string, T>>({});
  const localKey = `${bucket}\u0000${key}`;

  const value: T = store
    ? stored === MISSING
      ? initial
      : (stored as T)
    : localKey in local
      ? local[localKey]
      : initial;

  const setValue = React.useCallback(
    (next: ViewStateUpdate<T>): void => {
      const resolve = (prev: T): T =>
        typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      if (store) {
        const current = store.read(bucket, key);
        const prev = current === MISSING ? initialRef.current : (current as T);
        store.write(bucket, key, resolve(prev));
        return;
      }
      setLocal((all) => ({
        ...all,
        [localKey]: resolve(localKey in all ? all[localKey] : initialRef.current),
      }));
    },
    [store, bucket, key, localKey],
  );

  return [value, setValue];
}

/**
 * A writer for the current ledger's view state that does not subscribe to it — for the
 * caller that sets up a page's state just before navigating there.
 */
export function useSetLedgerViewState(): <T>(key: string, value: T) => void {
  const store = React.useContext(ViewStateContext);
  const bucket = useBucket();
  return React.useCallback(
    <T,>(key: string, value: T): void => {
      store?.write(bucket, key, value);
    },
    [store, bucket],
  );
}
