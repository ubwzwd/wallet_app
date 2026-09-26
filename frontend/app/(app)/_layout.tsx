/**
 * Everything behind a session (04 §1.5 rules 1 and 5): `/ledgers`, `/settings`, `/l/*`.
 *
 * Decision §14.64 a: every signed-in page wears the same shell, so personal settings and
 * `/ledgers*` get it from this layout — at both widths, with the tab bar (§14.64 b). `/l/*`
 * brings its own shell inside its ledger context. The shell itself steps aside for a user
 * with no ledger at all on `/ledgers*` (屏幕稿 15 is full-bleed, §14.59).
 */
import React from 'react';
import { Slot, usePathname } from 'expo-router';

import { routes } from '@/domain/routes';
import { AppShell, RequireAuth, isActivePath, useRememberLedgerHistory } from '@/navigation';

export default function AppLayout(): React.JSX.Element {
  const pathname = usePathname();
  // So a back step from `/ledgers*` or `/settings` returns to the ledger page the user
  // left, not to that ledger's first page (§14.64 f; see `ledgerHistory.ts`).
  useRememberLedgerHistory();
  const withShell =
    pathname === routes.settings() || isActivePath(pathname, routes.ledgers(), false);

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
