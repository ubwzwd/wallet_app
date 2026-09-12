/**
 * Every `/l/:ledgerId/*` page (04 §1.2): the ledger guard, then the ledger context, then
 * the responsive chrome. `RequireLedger` hands the already-cached ledger list down so the
 * provider itself never issues a request (04 §2.2).
 */
import React from 'react';
import { Slot, useGlobalSearchParams } from 'expo-router';

import { AppShell, RequireLedger } from '@/navigation';
import { LedgerProvider } from '@/store';

export default function LedgerLayout(): React.JSX.Element {
  // Global, not local: a layout's local param bag keeps the value it mounted with, so
  // `switchTo()` — which replaces the URL in place — would not be seen here.
  const { ledgerId } = useGlobalSearchParams<{ ledgerId: string }>();
  const id = typeof ledgerId === 'string' ? ledgerId : '';

  return (
    <RequireLedger ledgerId={id}>
      {(ledgers) => (
        <LedgerProvider ledgerId={id} ledgers={ledgers}>
          <AppShell>
            <Slot />
          </AppShell>
        </LedgerProvider>
      )}
    </RequireLedger>
  );
}
