/**
 * The authentication guard of 04 §1.5 (rules 1 and 5), plus the two small pieces every
 * guard in this folder shares: the full-screen skeleton shown while a decision is still
 * pending, and `useCurrentUrl()` — the URL the guards reason about.
 *
 * Nothing here ever navigates imperatively: a guard renders `<Redirect>`, so a decision
 * taken during the first render does not produce a visible flash of the wrong screen.
 */
import React from 'react';
import { View } from 'react-native';
import { Redirect, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';

import { routes } from '@/domain/routes';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/AuthContext';
import { Skeleton } from '@/ui';

/** `['transactions', '[txId]', 'edit']` → `{'txId'}`. */
function dynamicParamNames(segments: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const segment of segments) {
    const match = /^\[(?:\.\.\.)?(.+)\]$/.exec(segment);
    if (match) names.add(match[1]);
  }
  return names;
}

/** Keys react-navigation adds to the param bag that are not part of the URL. */
const NON_URL_PARAMS = new Set(['screen', 'params']);

/**
 * The current location as a relative URL — `/transactions/new?kind=expense`.
 *
 * `usePathname()` already has the dynamic segments substituted, so the params that came
 * from the path (`txId`, ...) are dropped here and only the query string is rebuilt.
 * Note this reads `useGlobalSearchParams()` rather than `useLocalSearchParams()`: its
 * caller sits in a *layout*, where the local bag does not carry the child route's query.
 */
export function useCurrentUrl(): string {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const segments = useSegments();

  const pathParams = dynamicParamNames(segments as readonly string[]);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (pathParams.has(key) || NON_URL_PARAMS.has(key)) continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) search.append(key, item);
    else search.append(key, value);
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The full-screen placeholder of 04 §1.5: render a skeleton, never navigate. */
export function AppSkeleton(): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID="app-skeleton"
      style={{
        flex: 1,
        backgroundColor: colors['bg.canvas'],
        padding: space['4'],
        gap: space['3'],
      }}
    >
      <Skeleton variant="card" />
      <Skeleton variant="table" rows={4} />
    </View>
  );
}

export interface RequireAuthProps {
  children: React.ReactNode;
}

/**
 * 04 §1.5: `bootstrapping` waits, `anonymous` goes to `/login?next=<current URL>`, and
 * `authenticated` renders. Rule 5 needs nothing extra — a 401 moves `AuthContext` to
 * `anonymous`, which re-runs this guard on the very next render.
 */
export function RequireAuth({ children }: RequireAuthProps): React.JSX.Element {
  const { status } = useAuth();
  const next = useCurrentUrl();

  if (status === 'bootstrapping') return <AppSkeleton />;
  if (status === 'anonymous') return <Redirect href={routes.login(next)} />;
  return <>{children}</>;
}
