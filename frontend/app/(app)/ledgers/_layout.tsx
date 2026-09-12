/**
 * Headless stack for `/ledgers`, `/ledgers/new` and `/ledgers/join` (04 §1.2): the app
 * shell in `app/(app)/_layout.tsx` already draws all the chrome these pages need.
 */
import { Stack } from 'expo-router';

export default function LedgersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
