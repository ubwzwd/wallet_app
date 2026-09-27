/**
 * The ledger guard of 04 §1.5 (decision §14.66 c): the ledger pages (`/home` … `/ledger`,
 * `isLedgerRoute`) need a current ledger, and a user with none belongs on `/ledgers`, the
 * onboarding page (§14.65 c).
 *
 * Everything else the guard used to do now happens one level up, in
 * `CurrentLedgerProvider`: waiting for the ledger list (a skeleton), a list that failed to
 * load (an error with a retry), and a ledger the user was removed from (the tab moves to
 * another one). So by the time this renders the answer is known, and there is only one
 * thing left to decide.
 */
import React from 'react';
import { Redirect } from 'expo-router';

import { routes } from '@/domain/routes';
import { useOptionalLedgerContext } from '@/store/LedgerContext';

export interface RequireLedgerProps {
  /**
   * Whether the page underneath needs a ledger. The layout keeps this component mounted on
   * every page and flips the flag, so its `Slot` never remounts between page kinds.
   */
  active?: boolean;
  children: React.ReactNode;
}

export function RequireLedger({ active = true, children }: RequireLedgerProps): React.JSX.Element {
  const ledger = useOptionalLedgerContext();
  if (!active || ledger !== null) return <>{children}</>;
  return <Redirect href={routes.ledgers()} />;
}
