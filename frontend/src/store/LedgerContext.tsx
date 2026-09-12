/**
 * Ledger context (04 §2.2).
 *
 * The single source of truth for "which ledger am I in" is the URL: `ledgerId` arrives as
 * a prop from the `/l/[ledgerId]` layout and this module never keeps its own copy, so the
 * browser's back button is correct for free. The provider issues no requests either — the
 * ledger list is already in the query cache and is handed in by `RequireLedger`.
 */
import React from 'react';
import { useRouter } from 'expo-router';

import type { Ledger, Uuid } from '@/api/types';
import { withLedger } from '@/domain/routes';
import { useCurrentUrl } from '@/navigation/RequireAuth';
import { PREF_NAMES, setPref } from '@/utils/prefs';

export interface LedgerContextValue {
  /** From the route parameter — never from internal state. */
  ledgerId: Uuid;
  ledger: Ledger;
  myRole: 'owner' | 'member';
  /** `ledger.base_currency` (decision §2: the base currency belongs to the ledger). */
  baseCurrency: string;
  /** Every ledger the user belongs to, for the switcher. */
  ledgers: readonly Ledger[];
  /** Stay on the same kind of page in another ledger, dropping id-shaped filters. */
  switchTo(id: Uuid): void;
}

const LedgerContext = React.createContext<LedgerContextValue | null>(null);

export interface LedgerProviderProps {
  ledgerId: Uuid;
  ledgers: readonly Ledger[];
  children: React.ReactNode;
}

export function LedgerProvider({
  ledgerId,
  ledgers,
  children,
}: LedgerProviderProps): React.JSX.Element | null {
  const router = useRouter();
  const currentUrl = useCurrentUrl();

  // Remember the choice for the landing redirect (04 §1.5 rule 2). Writing it here rather
  // than in `switchTo` also covers arriving through a shared deep link.
  React.useEffect(() => {
    void setPref(PREF_NAMES.lastLedgerId, ledgerId);
  }, [ledgerId]);

  const ledger = ledgers.find((l) => l.id === ledgerId);

  // `switchTo` must not be re-created on every keystroke elsewhere, but it does depend on
  // the current URL — a ref keeps the identity stable while the value stays fresh.
  const urlRef = React.useRef(currentUrl);
  urlRef.current = currentUrl;

  const switchTo = React.useCallback(
    (id: Uuid): void => {
      if (id === ledgerId) return;
      router.replace(withLedger(urlRef.current, ledgerId, id));
    },
    [ledgerId, router],
  );

  const value = React.useMemo<LedgerContextValue | null>(() => {
    if (!ledger) return null;
    return {
      ledgerId,
      ledger,
      myRole: ledger.role,
      baseCurrency: ledger.base_currency,
      ledgers,
      switchTo,
    };
  }, [ledger, ledgerId, ledgers, switchTo]);

  // `RequireLedger` only renders this provider for a ledger it found in the list, so a
  // miss here means the list changed mid-render; the guard re-decides on the next pass.
  if (!value) return null;
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedgerContext(): LedgerContextValue {
  const value = React.useContext(LedgerContext);
  if (!value) throw new Error('useLedgerContext() must be used inside a <LedgerProvider>');
  return value;
}

/** `null` outside a ledger route — for shared chrome that may render on `/ledgers`. */
export function useOptionalLedgerContext(): LedgerContextValue | null {
  return React.useContext(LedgerContext);
}
