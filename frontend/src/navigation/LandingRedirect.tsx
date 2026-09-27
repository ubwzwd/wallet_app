/**
 * The landing redirect of 04 §1.5 rule 2 (decision §14.66 h): `/` (and `/login` while signed
 * in) goes to `/home` when the user has a ledger, and to the onboarding page `/ledgers` when
 * they have none.
 *
 * Which ledger `/home` shows is not decided here: the address does not name one, and
 * `CurrentLedgerProvider` picks it with `pickCurrentLedger` (this tab's, else the device's
 * last, else the first). `/ledgers` asks the same question as `/` (§14.65 c: with a ledger it
 * is not a page, only a redirect), so the answer lives in one hook, `useLandingTarget`, and
 * both use it.
 */
import React from 'react';
import { Redirect } from 'expo-router';

import { type RouteHref, routes } from '@/domain/routes';
import { useLedgers } from '@/queries';
import { useAuth } from '@/store/AuthContext';

import { AppSkeleton } from './RequireAuth';

/** Where a signed-in user lands, once that is known. */
export type LandingTarget =
  /** The ledger list (or its re-read) is still on its way — never guess. */
  | { kind: 'pending' }
  /** `GET /ledgers` failed: that is not a "no ledgers" answer. */
  | { kind: 'error'; retry(): void }
  /** The user belongs to no ledger at all. */
  | { kind: 'none' }
  | { kind: 'ledger'; href: RouteHref };

/**
 * The answer `/` and `/ledgers` share. Only call it while signed in: it requests
 * `GET /ledgers`.
 *
 * A list that is being re-read is not an answer to redirect on: deleting or leaving the
 * last ledger invalidates the list and goes to `/ledgers` at once, while the cache still
 * names the ledger that is gone — trusting it would land straight back in `/home`. So a
 * ledger destination waits for the re-read. "No ledgers" does not: showing the onboarding a
 * moment longer is harmless, and it must not flash a skeleton on every background refetch.
 */
export function useLandingTarget(): LandingTarget {
  const { data, isPending, isFetching, isError, refetch } = useLedgers();

  if (isError) return { kind: 'error', retry: () => void refetch() };
  if (isPending) return { kind: 'pending' };
  if (data.items.length === 0) return { kind: 'none' };
  if (isFetching) return { kind: 'pending' };
  return { kind: 'ledger', href: routes.home() };
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
