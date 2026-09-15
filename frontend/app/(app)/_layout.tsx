/**
 * Everything behind a session (04 §1.5 rules 1 and 5): `/ledgers`, `/settings`, `/l/*`.
 *
 * Two of these are neither ledger-scoped nor a standalone full-page flow, so they get the
 * shell from this layout. Personal settings, because the sidebar and the "me" sheet both
 * lead to it and dropping the chrome on arrival would strand the user (04 §1.4); and
 * `/ledgers*`, because mockup 13 at 1440 draws the column too — with 「账本管理 · N 本」 at
 * its head instead of one ledger (§14.56). Their 375 frames draw their own headers, so the
 * ledger pages take the wide column only. `/l/*` brings its own shell inside its ledger
 * context.
 */
import React from 'react';
import { Slot, usePathname } from 'expo-router';

import { routes } from '@/domain/routes';
import { AppShell, RequireAuth } from '@/navigation';

export default function AppLayout(): React.JSX.Element {
  const pathname = usePathname();
  const inLedgers = pathname.startsWith(routes.ledgers());
  const withShell = pathname === routes.settings() || inLedgers;

  return (
    <RequireAuth>
      {withShell ? (
        <AppShell narrowChrome={!inLedgers}>
          <Slot />
        </AppShell>
      ) : (
        <Slot />
      )}
    </RequireAuth>
  );
}
