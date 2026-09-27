/**
 * Where creating or joining a ledger lands (04 §4.3, decision §14.66 c/d): in that ledger,
 * at `/home`. The address names no ledger, so "in that ledger" means the tab's current
 * ledger becomes it (`switchTo`), and the step replaces the form, so back does not reopen it.
 *
 * The new ledger is not in the cached ledger list yet (the mutation has only just asked for
 * a re-read), so the move waits for that re-read: going to `/home` first would show the old
 * current ledger for a moment — or, for a user who had none, bounce off the ledger guard to
 * the onboarding page and back.
 */
import React from 'react';
import { type Href, useRouter } from 'expo-router';

import type { Ledger } from '@/api/types';
import { routes } from '@/domain/routes';
import { useLedgers } from '@/queries';
import { useOptionalLedgerContext } from '@/store';

export function useEnterLedger(): (ledger: Ledger) => void {
  const router = useRouter();
  const { refetch } = useLedgers();
  // Absent for a user who had no ledger: the new one will be the only one, and so current.
  const switchTo = useOptionalLedgerContext()?.switchTo;

  return React.useCallback(
    (ledger: Ledger): void => {
      switchTo?.(ledger.id);
      void refetch().then(() => router.replace(routes.home() as Href));
    },
    [refetch, router, switchTo],
  );
}
