/**
 * The `QueryClient` and its two global error hooks (04 §2.4, §3.7, §3.8).
 *
 * `createQueryClient` takes its side effects as dependencies so tests can observe them;
 * the app uses the `queryClient` singleton below, whose `onUnauthorized` / `onLedgerGone`
 * are registered by the store layer through `registerQueryHandlers`.
 */
import {
  MutationCache,
  QueryCache,
  QueryClient,
  type Query,
  type Mutation,
} from '@tanstack/react-query';
import i18next from 'i18next';
import type { TFunction } from 'i18next';

import { isApiClientError, isClientError } from '@/api/errors';
import type { ApiClientError } from '@/api/errors';
import { errorMessage } from '@/i18n/errorCodes';
import { toast, type ToastKind } from '@/ui/Toast';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Detail key of the resource this mutation writes, invalidated on a 409 (§3.8). */
      detailKey?: readonly unknown[];
      /** `true` keeps the global error toast quiet — the page shows the error itself. */
      silent?: boolean;
    };
  }
}

/** Side effects the two caches need; injected so they can be asserted in tests. */
export interface QueryHandlers {
  /** A 401 came back: `AuthContext` clears the session (04 §2.1 item 2). */
  onUnauthorized(): void;
  /** A ledger detail query 404'd: the user lost access or it was deleted (04 §1.5 item 4). */
  onLedgerGone(ledgerId: string): void;
  /** Raise a toast (04 §3.9). `detail` is the technical text behind an error. */
  notify(kind: ToastKind, message: string, detail?: string): void;
}

/** 04 §2.4: at most two retries, and never for a 4xx (a 409 or 422 will not heal). */
export function shouldRetry(count: number, err: unknown): boolean {
  return count < 2 && !isClientError(err);
}

/** `['l', <id>, 'detail']` — the ledger detail key, and nothing else. */
function ledgerIdOfDetailKey(key: readonly unknown[]): string | null {
  if (key.length !== 3) return null;
  if (key[0] !== 'l' || key[2] !== 'detail') return null;
  return typeof key[1] === 'string' ? key[1] : null;
}

function translate(e: unknown): string {
  return errorMessage(i18next.t.bind(i18next) as TFunction, e);
}

export function createQueryClient(deps: QueryHandlers): QueryClient {
  let client: QueryClient | undefined;

  const queryCache = new QueryCache({
    onError: (error: Error, query: Query<unknown, unknown, unknown, readonly unknown[]>) => {
      if (!isApiClientError(error)) return;
      const e: ApiClientError = error;
      if (e.status === 401) {
        deps.onUnauthorized();
        return;
      }
      if (e.status === 404 && e.code === 'not_found') {
        const ledgerId = ledgerIdOfDetailKey(query.queryKey);
        if (ledgerId) deps.onLedgerGone(ledgerId);
      }
      // Everything else belongs to the page that asked for the data.
    },
  });

  const mutationCache = new MutationCache({
    onError: async (
      error: Error,
      _variables: unknown,
      _context: unknown,
      mutation: Mutation<unknown, unknown, unknown, unknown>,
    ) => {
      if (!isApiClientError(error)) {
        if (mutation.meta?.silent !== true) deps.notify('error', translate(error));
        return;
      }
      const e: ApiClientError = error;
      if (e.status === 401) return; // the query cache's 401 path already signed the user out

      // 04 §3.8: 409 `stale_update` is handled in exactly one place.
      if (e.status === 409 && e.code === 'stale_update') {
        // §3.8 step 1: await the refetch so the form's own `onError` (step 3) merges
        // against fresh server values; query-core awaits this callback.
        const detailKey = mutation.meta?.detailKey;
        if (detailKey) await client?.invalidateQueries({ queryKey: detailKey });
        deps.notify('warning', translate(e));
        return;
      }

      if (mutation.meta?.silent !== true) deps.notify('error', translate(e), e.detail);
    },
  });

  client = new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: 0 },
    },
  });

  return client;
}

// ------------------------------------------------------- the app's singleton

type RegisteredHandlers = Pick<QueryHandlers, 'onUnauthorized' | 'onLedgerGone'>;

let handlers: Partial<RegisteredHandlers> = {};

/**
 * Let the store layer plug its navigation-aware callbacks into the singleton.
 * Returns an unregister function, so a provider can clean up on unmount.
 */
export function registerQueryHandlers(next: Partial<RegisteredHandlers>): () => void {
  const previous = handlers;
  handlers = { ...handlers, ...next };
  return () => {
    handlers = previous;
  };
}

export const queryClient: QueryClient = createQueryClient({
  onUnauthorized: () => handlers.onUnauthorized?.(),
  onLedgerGone: (ledgerId) => handlers.onLedgerGone?.(ledgerId),
  notify: (kind, message, detail) => toast[kind](message, detail ? { detail } : undefined),
});
