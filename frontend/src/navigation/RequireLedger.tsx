/**
 * The ledger guard of 04 §1.5 (rules 3 and 4) and the tiny module-level store behind it.
 *
 * Rule 4's anchor is the *ledger detail* query: when `GET /ledgers/{id}` answers 404 the
 * query cache calls `onLedgerGone(id)` (04 §2.4), which lands in `markLedgerGone` below.
 * A 404 from any other ledger-scoped endpoint means "that record is gone", not "you were
 * removed", so only this one signal is allowed to flip a ledger to unavailable.
 */
import React from 'react';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import type { Ledger } from '@/api/types';
import { routes } from '@/domain/routes';
import { removeLedger, useLedgers } from '@/queries';
import { EmptyState, Page } from '@/ui';

import { AppSkeleton } from './RequireAuth';
import { LedgerGone } from './LedgerGone';

// ------------------------------------------------- the "this ledger is gone" store

let goneIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ReadonlySet<string> {
  return goneIds;
}

/** Registered as the query cache's `onLedgerGone` handler by the root layout. */
export function markLedgerGone(ledgerId: string): void {
  if (goneIds.has(ledgerId)) return;
  goneIds = new Set([...goneIds, ledgerId]);
  emit();
}

/** Called when the user deliberately leaves the unavailable ledger. */
export function clearLedgerGone(ledgerId: string): void {
  if (!goneIds.has(ledgerId)) return;
  const next = new Set(goneIds);
  next.delete(ledgerId);
  goneIds = next;
  emit();
}

/** Test helper: forget every flag. */
export function resetLedgerGone(): void {
  if (goneIds.size === 0) return;
  goneIds = new Set();
  emit();
}

export function useLedgerGone(ledgerId: string): boolean {
  const ids = React.useSyncExternalStore(subscribe, snapshot, snapshot);
  return ids.has(ledgerId);
}

// ------------------------------------------------------------------- the guard

export interface RequireLedgerProps {
  ledgerId: string;
  /** Rendered only once the ledger is known to be ours; receives the whole list. */
  children: (ledgers: readonly Ledger[]) => React.ReactNode;
}

/** The list failed to load: the ledger is neither confirmed nor denied, so offer a retry. */
function LedgersUnavailable({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Page scroll={false} testID="ledgers-unavailable">
      <EmptyState
        icon="refresh-cw"
        title={t('ledger:list.error_retry')}
        primaryAction={{ label: t('common:button.retry'), onPress: onRetry }}
      />
    </Page>
  );
}

export function RequireLedger({ ledgerId, children }: RequireLedgerProps): React.JSX.Element {
  const { data, isPending, isError, refetch } = useLedgers();
  const gone = useLedgerGone(ledgerId);
  const queryClient = useQueryClient();

  // Rule 4: a ledger detail 404 is authoritative. Everything cached under `['l', id]` is
  // now unreadable (and would be served to whatever renders next), so it is dropped rather
  // than merely marked stale; the list is re-read because the two buttons below need to
  // know what is still reachable.
  React.useEffect(() => {
    if (gone) removeLedger(queryClient, ledgerId);
  }, [gone, ledgerId, queryClient]);

  // Leaving the ledger forgets the flag: if the user ever comes back (re-invited, say), a
  // fresh `GET /ledgers/{id}` decides again rather than the stale verdict deciding for it.
  React.useEffect(() => () => clearLedgerGone(ledgerId), [ledgerId]);

  if (isPending) return <AppSkeleton />;
  if (isError) return <LedgersUnavailable onRetry={() => void refetch()} />;

  const ledgers = data.items;
  const found = ledgers.some((l) => l.id === ledgerId);

  if (found && !gone) return <>{children(ledgers)}</>;

  // Nothing to offer and nothing to show: the empty ledger list page guides the user.
  if (ledgers.length === 0) return <Redirect href={routes.ledgers()} />;

  return <LedgerGone ledgerId={ledgerId} ledgers={ledgers} />;
}
