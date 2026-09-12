/**
 * `/login` and `/register` (04 §1.2). Anonymous users see them; a signed-in user who lands
 * here is sent on — to the `?next=` they were bounced off (04 §1.5 rule 1), so a deep link
 * survives a sign-in that happens in another tab or through a still-valid session, and
 * otherwise by the same landing logic as `/` (rule 2).
 */
import React from 'react';
import { Redirect, Stack, useGlobalSearchParams, type Href } from 'expo-router';

import { safeNext } from '@/domain/routes';
import { AppSkeleton, LandingRedirect } from '@/navigation';
import { useAuth } from '@/store';

export default function AuthLayout(): React.JSX.Element {
  const { status } = useAuth();
  // Global, not local: this is a layout, whose own param bag does not carry the child
  // route's query string.
  const params = useGlobalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);

  if (status === 'bootstrapping') return <AppSkeleton />;
  if (status === 'authenticated') {
    return next ? <Redirect href={next as Href} /> : <LandingRedirect />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
