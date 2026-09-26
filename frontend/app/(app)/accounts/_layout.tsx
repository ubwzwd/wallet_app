/**
 * `/accounts`, `/accounts/new` and `/accounts/:sourceId/edit` (decision §14.62): my own
 * accounts, which belong to me rather than to a ledger. Headless — the app shell in
 * `app/(app)/_layout.tsx` already draws all the chrome these pages need.
 *
 * A `Slot`, not a `Stack`: a stack would mount the list underneath the form on the way in
 * (the reason `ledgers/` has no stack either), and `TopBar` / `ledgerHistory` are written
 * for the `Slot`-only tree under `(app)`.
 */
import React from 'react';
import { Slot } from 'expo-router';

export default function AccountsLayout(): React.JSX.Element {
  return <Slot />;
}
