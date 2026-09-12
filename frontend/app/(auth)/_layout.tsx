/**
 * `/login` and `/register` (04 §1.2). Anonymous users see them; a signed-in user who lands
 * here is sent on by the same landing logic as `/` (04 §1.5 rule 2).
 */
import React from 'react';
import { Stack } from 'expo-router';

import { AppSkeleton, LandingRedirect } from '@/navigation';
import { useAuth } from '@/store';

export default function AuthLayout(): React.JSX.Element {
  const { status } = useAuth();
  if (status === 'bootstrapping') return <AppSkeleton />;
  if (status === 'authenticated') return <LandingRedirect />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
