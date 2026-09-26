/**
 * The landing redirect of 04 §1.5 rule 2: `/` (and `/login` while signed in) lands on the
 * last ledger the device used, else the first ledger, else the no-ledger onboarding page.
 *
 * `/ledgers` asks the same question (decision §14.65 c: with a ledger it is not a page, only
 * a redirect), so the answer lives in one hook, `useLandingTarget`, and both use it.
 *
 * The stored `last_ledger_id` is a convenience, not state (04 §2.2): everything after this
 * redirect takes the ledger id from the URL. `useLastLedgerId` is the one module that reads
 * it — the chrome uses the same hook, for the same reason.
 */
import React from 'react';
import { Redirect } from 'expo-router';

import type { Ledger } from '@/api/types';
import { type RouteHref, routes } from '@/domain/routes';
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

/** Where a signed-in user lands, once that is known. */
export type LandingTarget =
  /** The ledger list or the remembered id is still on its way — never guess meanwhile. */
  | { kind: 'pending' }
  /** `GET /ledgers` failed: that is not a "no ledgers" answer. */
  | { kind: 'error'; retry(): void }
  /** The user belongs to no ledger at all. */
  | { kind: 'none' }
  | { kind: 'ledger'; href: RouteHref };

/**
 * The answer `/` and `/ledgers` share. Only call it while signed in: it requests
 * `GET /ledgers`.
 */
export function useLandingTarget(): LandingTarget {
  const { data, isPending, isError, refetch } = useLedgers();
  const lastLedgerId = useLastLedgerId();

  if (isError) return { kind: 'error', retry: () => void refetch() };
  if (isPending || lastLedgerId === undefined) return { kind: 'pending' };
  const target = pickLandingLedger(data.items, lastLedgerId);
  if (!target) return { kind: 'none' };
  return { kind: 'ledger', href: routes.l(target.id).home() };
}

/** Signed-in half, split out so `GET /ledgers` is never requested while anonymous. */
function AuthenticatedLanding(): React.JSX.Element {
  const target = useLandingTarget();

  // 04 §1.5: while the ledger list is unknown we wait — we never guess a destination.
  if (target.kind === 'pending') return <AppSkeleton />;
  // A failure and "no ledgers" both belong to `/ledgers`: it owns retrying and onboarding.
  if (target.kind !== 'ledger') return <Redirect href={routes.ledgers()} />;
  return <Redirect href={target.href} />;
}

export function LandingRedirect(): React.JSX.Element {
  const { status } = useAuth();
  if (status === 'bootstrapping') return <AppSkeleton />;
  if (status === 'anonymous') return <Redirect href={routes.login()} />;
  return <AuthenticatedLanding />;
}

export default LandingRedirect;
