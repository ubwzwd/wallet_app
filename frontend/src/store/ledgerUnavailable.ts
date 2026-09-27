/**
 * The ledgers the server has told us we can no longer open (04 §1.5 rule 4, decision
 * §14.66 c) — a tiny module-level store.
 *
 * The anchor is the *ledger detail* query: when `GET /ledgers/{id}` answers 404 the query
 * cache calls its ledger-gone handler (04 §2.4), which the root layout points at
 * `markLedgerUnavailable`. A 404 from any other ledger-scoped endpoint means "that record is
 * gone", not "you were removed", so only this one signal flips a ledger to unavailable.
 * `CurrentLedgerProvider` reads the set: a flagged ledger is never current, and when the
 * current one is flagged the tab moves to another.
 */
import React from 'react';

let unavailable: ReadonlySet<string> = new Set();
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
  return unavailable;
}

/** Registered as the query cache's ledger-gone handler by the root layout. */
export function markLedgerUnavailable(ledgerId: string): void {
  if (unavailable.has(ledgerId)) return;
  unavailable = new Set([...unavailable, ledgerId]);
  emit();
}

/**
 * Forget one flag: the user deliberately picked that ledger again (re-invited, say), so a
 * fresh `GET /ledgers/{id}` decides rather than the stale verdict.
 */
export function clearLedgerUnavailable(ledgerId: string): void {
  if (!unavailable.has(ledgerId)) return;
  const next = new Set(unavailable);
  next.delete(ledgerId);
  unavailable = next;
  emit();
}

/** Test helper: forget every flag. */
export function resetLedgerUnavailable(): void {
  if (unavailable.size === 0) return;
  unavailable = new Set();
  emit();
}

/** Every ledger flagged so far; a new set object whenever it changes. */
export function useUnavailableLedgers(): ReadonlySet<string> {
  return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}
