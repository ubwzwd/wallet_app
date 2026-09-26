/**
 * The account lookups both detail screens need (屏幕稿 07 / 08).
 *
 * Kept out of either screen so neither has to import the other: the transfer page and the
 * transaction page both name accounts, and both want the *whole* list — archived accounts
 * included, because a detail page shows history and history outlives an account.
 */
import React from 'react';

import type { LedgerSource, Uuid } from '@/api/types';
import { useLedgerSources } from '@/queries';

import type { SourceMap } from './TransferLegs';

/**
 * Every account the ledger can see — archived ones, and ones no longer shared but still
 * referenced by its entries (`usable: false`), included: a detail page shows history.
 */
export function useSourceMap(ledgerId: Uuid): SourceMap {
  const sources = useLedgerSources(ledgerId, { include_archived: true });
  const items = sources.data?.items;
  return React.useMemo(() => {
    const out: Record<Uuid, LedgerSource> = {};
    for (const s of items ?? []) out[s.id] = s;
    return out;
  }, [items]);
}

/** `source_id → name`, the lookup the pickers and the timeline need. */
export function useSourceNames(ledgerId: Uuid): Record<Uuid, string> {
  const map = useSourceMap(ledgerId);
  return React.useMemo(() => {
    const out: Record<Uuid, string> = {};
    for (const [id, s] of Object.entries(map)) out[id] = s.name;
    return out;
  }, [map]);
}
