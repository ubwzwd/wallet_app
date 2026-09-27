/**
 * Whether the signed-in user belongs to no ledger at all — the one state with no global
 * chrome on `/ledgers*` (屏幕稿 15, §14.59) and no bottom tab bar anywhere (§14.64 b).
 *
 * Under the signed-in layout `CurrentLedgerProvider` has already read the ledger list, so a
 * missing context is the answer. Outside it (a screen rendered on its own) the cached list
 * decides, and until that lands `/me`'s `ledger_count` answers on the first frame, so the
 * chrome does not flash in and out.
 */
import { useLedgers } from '@/queries';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';

export function useHasNoLedgers(): boolean {
  const ledgerContext = useOptionalLedgerContext();
  const { user } = useAuth();
  const { data } = useLedgers();
  if (ledgerContext) return false;
  if (data) return data.items.length === 0;
  return user !== null && user.ledger_count === 0;
}
