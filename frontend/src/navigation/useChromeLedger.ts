/**
 * Which ledger the chrome aims at (decision §14.64 a): inside a ledger route that is the
 * ledger in the URL; outside one (`/settings`, `/ledgers*`) it is the ledger the user last
 * had open — the same one `/` would land on.
 *
 * Shared by the sidebar, both top bars, the bottom tab bar, the "me" sheet and the ledger
 * switcher, so every piece of chrome outside a ledger names the same ledger.
 */
import type { Ledger } from '@/api/types';
import { useLedgers } from '@/queries';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';

import { pickLandingLedger } from './LandingRedirect';
import { useLastLedgerId } from './useLastLedgerId';

export interface ChromeLedger {
  ledgerId: string | null;
  ledger: Ledger | null;
  /** Every ledger the user belongs to — what the switchers list. */
  ledgers: readonly Ledger[];
  pending: boolean;
}

/**
 * The ledger the chrome names, and whether that answer is known yet.
 *
 * Cold-opening `/settings` — a bookmark, a reload — has neither the preference nor the
 * ledger list in hand on the first frame. Guessing there is what made the sidebar's card
 * flicker, so while either answer is outstanding this reports `pending` and names nothing.
 * Once both have landed the remembered ledger wins, and `pickLandingLedger` falls back to
 * the first one — the same ledger `/` would have opened.
 */
export function useChromeLedger(): ChromeLedger {
  const ledgerContext = useOptionalLedgerContext();
  const lastLedgerId = useLastLedgerId();
  // Outside a ledger route the list has to come from the cache; inside one the context
  // already holds it, and this is the same query key, so it costs nothing extra.
  const { data, isPending } = useLedgers();
  const known = data?.items;

  if (ledgerContext) {
    return {
      ledgerId: ledgerContext.ledgerId,
      ledger: ledgerContext.ledger,
      ledgers: ledgerContext.ledgers,
      pending: false,
    };
  }
  const pending = lastLedgerId === undefined || (known === undefined && isPending);
  const ledger = pending ? null : pickLandingLedger(known ?? [], lastLedgerId ?? null);
  return { ledgerId: ledger?.id ?? null, ledger, ledgers: known ?? [], pending };
}

/**
 * Whether the signed-in user belongs to no ledger at all — the one state with no global
 * chrome on `/ledgers*` (屏幕稿 15, §14.59) and no bottom tab bar anywhere (§14.64 b).
 *
 * The ledger list is the authority once it is in the cache; until then `/me`'s
 * `ledger_count` answers on the first frame, so the chrome does not flash in and out.
 */
export function useHasNoLedgers(): boolean {
  const ledgerContext = useOptionalLedgerContext();
  const { user } = useAuth();
  const { data } = useLedgers();
  if (ledgerContext) return false;
  if (data) return data.items.length === 0;
  return user !== null && user.ledger_count === 0;
}
