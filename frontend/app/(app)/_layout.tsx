/**
 * Everything behind a session (04 §1.5 rules 1 and 5): `/ledgers`, `/settings`, `/l/*`.
 *
 * Personal settings is the one page here that is neither ledger-scoped nor a standalone
 * full-page flow, so it gets the shell from this layout (04 §1.4 — the sidebar and the
 * "me" sheet both lead to it, and dropping the chrome on arrival would strand the user).
 * `/l/*` brings its own shell inside its ledger context; `/ledgers*` is deliberately
 * chrome-less, because there is no ledger to put in the chrome yet.
 */
import React from 'react';
import { Slot, usePathname } from 'expo-router';

import { routes } from '@/domain/routes';
import { AppShell, RequireAuth } from '@/navigation';

export default function AppLayout(): React.JSX.Element {
  const pathname = usePathname();
  const withShell = pathname === routes.settings();

  return (
    <RequireAuth>{withShell ? <AppShell><Slot /></AppShell> : <Slot />}</RequireAuth>
  );
}
