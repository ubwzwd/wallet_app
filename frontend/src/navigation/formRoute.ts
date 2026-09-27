/**
 * The form pages (decision §14.65 f): 记一笔, editing an entry, editing a transfer pair,
 * and the new / edit account form. On a narrow screen they have no bottom tab bar —
 * screens 04 / 05 / 06 / 09 at 375 draw none, and a tab one thumb away from a half-filled
 * form is an exit waiting to happen.
 *
 *   /transactions/new
 *   /transactions/:tx/edit
 *   /transfers/:pair/edit
 *   /accounts/new
 *   /accounts/:sid/edit
 *
 * Pure: the ids are sliced out only as candidates, and every match goes through the
 * `routes` builders, so this table cannot drift from the one the app links with.
 */
import { routes } from '@/domain/routes';

import { barePath } from './ledgerRoute';

export function isFormRoute(pathname: string): boolean {
  const path = barePath(pathname);
  if (path === routes.transactionNew() || path === routes.accountNew()) return true;

  const [section, resourceId] = path.split('/').filter(Boolean);
  if (!resourceId) return false;
  switch (section) {
    case 'transactions':
      return path === routes.transactionEdit(resourceId);
    case 'transfers':
      return path === routes.transferEdit(resourceId);
    case 'accounts':
      return path === routes.accountEdit(resourceId);
    default:
      return false;
  }
}
