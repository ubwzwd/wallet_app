/**
 * Everything behind a session (04 §1.5 rules 1 and 5): `/ledgers`, `/settings`,
 * `/accounts`, `/l/*`.
 *
 * Decision §14.64 a: every signed-in page wears the same shell, so personal settings, my
 * accounts (`/accounts*`, decision §14.62) and `/ledgers*` get it from this layout — at both widths, with the tab bar (§14.64 b). `/l/*`
 * brings its own shell inside its ledger context. The shell itself steps aside for a user
 * with no ledger at all on `/ledgers*` (屏幕稿 15 is full-bleed, §14.59). For everyone else
 * `/ledgers` only redirects to a ledger's home (§14.65 c), and `/ledgers/new` and
 * `/ledgers/join` are sub-pages of that home.
 *
 * `ledgers/` deliberately has no `_layout` of its own: a stack there would mount
 * `/ledgers` underneath `/ledgers/new` on the way in, and its redirect would fire from
 * behind the page the user asked for.
 */
import React from 'react';
import { Slot, usePathname } from 'expo-router';

import { routes } from '@/domain/routes';
import {
  AppShell,
  RequireAuth,
  isActivePath,
  useNestedEntrySync,
  useRememberLedgerHistory,
} from '@/navigation';

export default function AppLayout(): React.JSX.Element {
  const pathname = usePathname();
  // So a back step from `/ledgers*` returns to the ledger page the user left, not to that
  // ledger's first page (§14.64 f; see `ledgerHistory.ts`).
  useRememberLedgerHistory();
  // Entering a ledger (or `/accounts*`) from outside lands on its first page in expo-router 6
  // even when the URL names a deeper one; this puts the named page in place (`nestedEntry.ts`).
  useNestedEntrySync();
  const withShell =
    pathname === routes.settings() ||
    isActivePath(pathname, routes.accounts(), false) ||
    isActivePath(pathname, routes.ledgers(), false);

  return (
    <RequireAuth>
      {withShell ? (
        <AppShell>
          <Slot />
        </AppShell>
      ) : (
        <Slot />
      )}
    </RequireAuth>
  );
}
