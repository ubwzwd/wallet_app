/**
 * The landing redirect of 04 §1.5 rule 2: `/` (and `/login` while signed in) lands on the
 * last ledger the device used, else the first ledger, else the ledger list.
 *
 * The stored `last_ledger_id` is a convenience, not state (04 §2.2): everything after this
 * redirect takes the ledger id from the URL. `useLastLedgerId` is the one module that reads
 * it — the chrome and the ledger list use the same hook, for the same reason.
 */
import React from 'react';
import { Redirect } from 'expo-router';

import type { Ledger } from '@/api/types';
import { routes } from '@/domain/routes';
import { useLedgers } from '@/queries';
import { useAuth } from '@/store/AuthContext';

import { AppSkeleton } from './RequireAuth';
import { useLastLedgerId } from './useLastLedgerId';

/** The ledger `/` should open: the remembered one if it is still ours, else the first. */
export function pickLandingLedger(
  ledgers: readonly Ledger[],
  lastLedgerId: string | null,
): Ledger | null {
  if (ledgers.length === 0) return null;
  return ledgers.find((l) => l.id === lastLedgerId) ?? ledgers[0];
}

/** Signed-in half, split out so `GET /ledgers` is never requested while anonymous. */
function AuthenticatedLanding(): React.JSX.Element {
  const { data, isPending, isError } = useLedgers();
  const lastLedgerId = useLastLedgerId();

  // 04 §1.5: while the ledger list is unknown we wait — we never guess a destination.
  if (isPending || lastLedgerId === undefined) return <AppSkeleton />;
  // A failed list is not a "no ledgers" answer; `/ledgers` is the page that owns retrying.
  if (isError) return <Redirect href={routes.ledgers()} />;

  const target = pickLandingLedger(data.items, lastLedgerId);
  if (!target) return <Redirect href={routes.ledgers()} />;
  return <Redirect href={routes.l(target.id).home()} />;
}

export function LandingRedirect(): React.JSX.Element {
  const { status } = useAuth();
  if (status === 'bootstrapping') return <AppSkeleton />;
  if (status === 'anonymous') return <Redirect href={routes.login()} />;
  return <AuthenticatedLanding />;
}

export default LandingRedirect;
