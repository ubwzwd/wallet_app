/**
 * Everything behind a session (04 §1.5 rules 1 and 5, decision §14.66): the ledger pages
 * (`/home`, `/transactions*`, `/transfers*`, `/imports*`, `/ledger`), `/settings`,
 * `/accounts*` and `/ledgers*`.
 *
 * Every one of them is a direct child of the single `Slot` below — there is no nested
 * navigator anywhere under `(app)` (§14.66 g), so a back step is always a plain step back
 * through one flat history, and entering a page from any other lands on that page.
 *
 * Around the `Slot`, outermost first:
 *
 *   RequireAuth            no session → `/login?next=…`
 *   ViewStateProvider      per-ledger browsing state (month, filters, batch slice), in memory
 *   CurrentLedgerProvider  the tab's current ledger (§14.66 b); waits for the ledger list
 *   AppShell               the one shell of every signed-in page (§14.64 a). It steps aside
 *                          by itself for a user with no ledger on `/ledgers*` (屏幕稿 15).
 *   RequireLedger          the ledger pages only: no ledger at all → `/ledgers`
 *
 * `RequireLedger` stays mounted on every page and is switched by a flag, so the `Slot` keeps
 * its place in the tree when the user moves between a ledger page and a personal one.
 *
 * `ledgers/` deliberately has no `_layout` of its own (and neither has `accounts/`): a stack
 * there would mount `/ledgers` underneath `/ledgers/new` on the way in, and its redirect
 * would fire from behind the page the user asked for.
 */
import React from 'react';
import { Slot, usePathname } from 'expo-router';

import { AppShell, RequireAuth, RequireLedger, isLedgerRoute } from '@/navigation';
import { CurrentLedgerProvider, ViewStateProvider } from '@/store';

export default function AppLayout(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <RequireAuth>
      <ViewStateProvider>
        <CurrentLedgerProvider>
          <AppShell>
            <RequireLedger active={isLedgerRoute(pathname)}>
              <Slot />
            </RequireLedger>
          </AppShell>
        </CurrentLedgerProvider>
      </ViewStateProvider>
    </RequireAuth>
  );
}
