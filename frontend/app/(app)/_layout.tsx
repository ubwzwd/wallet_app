/** Everything behind a session (04 §1.5 rules 1 and 5): `/ledgers`, `/settings`, `/l/*`. */
import React from 'react';
import { Slot } from 'expo-router';

import { RequireAuth } from '@/navigation';

export default function AppLayout(): React.JSX.Element {
  return (
    <RequireAuth>
      <Slot />
    </RequireAuth>
  );
}
