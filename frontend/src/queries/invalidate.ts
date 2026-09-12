/**
 * The invalidation matrix of 04 §3.6, one helper per row group.
 *
 * Pages never write key arrays themselves: they call these. `invalidate` marks a key
 * stale (and refetches it while it is being observed); `remove` drops it outright.
 */
import type { QueryClient } from '@tanstack/react-query';

import type { Uuid } from '@/api/types';

import { LEDGER_KEY_PREFIX, qk } from './keys';

/** `ledgersApi.create` / `join` — the ledger list changed. */
export function invalidateLedgers(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: qk.global.ledgers() });
}

export interface LedgerUpdateScope {
  /** The base currency moved: every balance, total and conversion under the ledger changed. */
  baseCurrencyChanged?: boolean;
}

/** `ledgersApi.update`: list + detail, and the whole ledger tree when the currency changed. */
export function invalidateLedger(qc: QueryClient, l: Uuid, scope?: LedgerUpdateScope): void {
  const k = qk.ledger(l);
  invalidateLedgers(qc);
  void qc.invalidateQueries({ queryKey: k.detail() });
  if (scope?.baseCurrencyChanged) void qc.invalidateQueries({ queryKey: k.root() });
}

/** `ledgersApi.remove` / `leave`: the ledger is gone, drop everything cached under it. */
export function removeLedger(qc: QueryClient, l: Uuid): void {
  invalidateLedgers(qc);
  qc.removeQueries({ queryKey: qk.ledger(l).root() });
}

/** `removeMember` / `transferOwnership`: members, detail, and the list (`role` may flip). */
export function invalidateMembers(qc: QueryClient, l: Uuid): void {
  const k = qk.ledger(l);
  void qc.invalidateQueries({ queryKey: k.members() });
  void qc.invalidateQueries({ queryKey: k.detail() });
  invalidateLedgers(qc);
}

export interface SourceChangeScope {
  /** `opening_balance` or `archived` changed, so net worth and stats move too (decision §14.50). */
  affectsBalances?: boolean;
}

/** `sourcesApi.create` / `update`: every source key (list variants and details) at once. */
export function invalidateSources(qc: QueryClient, l: Uuid, scope?: SourceChangeScope): void {
  const k = qk.ledger(l);
  void qc.invalidateQueries({ queryKey: k.sourcesRoot() });
  if (scope?.affectsBalances) void qc.invalidateQueries({ queryKey: k.statsRoot() });
}

/**
 * Anything that writes a transaction: the whole `tx` subtree (filter combinations are an
 * open set, so per-key surgery does not pay off), balances and stats.
 */
export function invalidateTransactions(qc: QueryClient, l: Uuid): void {
  const k = qk.ledger(l);
  void qc.invalidateQueries({ queryKey: k.txRoot() });
  void qc.invalidateQueries({ queryKey: k.sourcesRoot() });
  void qc.invalidateQueries({ queryKey: k.statsRoot() });
}

/** Two-leg transfer writes: the transaction sweep plus that pair's own detail key. */
export function invalidateTransfer(qc: QueryClient, l: Uuid, pairId: Uuid): void {
  invalidateTransactions(qc, l);
  void qc.invalidateQueries({ queryKey: qk.ledger(l).transfer(pairId) });
}

/** `txApi.pair` / `unpair`: both legs gained or lost their `pair` and an event (§14.34, §14.51). */
export function invalidatePair(qc: QueryClient, l: Uuid, tid1: Uuid, tid2: Uuid): void {
  const k = qk.ledger(l);
  invalidateTransactions(qc, l);
  void qc.invalidateQueries({ queryKey: k.tx(tid1) });
  void qc.invalidateQueries({ queryKey: k.tx(tid2) });
}

/** `txApi.unpair`: the pair no longer exists, so its cached entry must go. */
export function removeTransfer(qc: QueryClient, l: Uuid, pairId: Uuid): void {
  qc.removeQueries({ queryKey: qk.ledger(l).transfer(pairId) });
}

export interface MeChangeScope {
  /** `display_name` changed — it is shown on every member list (decision §14.40). */
  displayNameChanged?: boolean;
}

/** `meApi.update`: `global.me`, plus the members list of every ledger already in cache. */
export function invalidateMe(qc: QueryClient, scope?: MeChangeScope): void {
  void qc.invalidateQueries({ queryKey: qk.global.me() });
  if (!scope?.displayNameChanged) return;
  for (const ledgerId of cachedLedgerIds(qc)) {
    void qc.invalidateQueries({ queryKey: qk.ledger(ledgerId).members() });
  }
}

/** Ledger ids that currently have at least one cached query under `['l', id, ...]`. */
export function cachedLedgerIds(qc: QueryClient): string[] {
  const ids = new Set<string>();
  for (const query of qc.getQueryCache().findAll({ queryKey: [LEDGER_KEY_PREFIX] })) {
    const id = query.queryKey[1];
    if (typeof id === 'string') ids.add(id);
  }
  return [...ids];
}
