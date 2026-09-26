/**
 * The form pages (decision §14.65 f): 记一笔, editing an entry, editing a transfer pair,
 * and the new / edit account form. On a narrow screen they have no bottom tab bar —
 * screens 04 / 05 / 06 / 09 at 375 draw none, and a tab one thumb away from a half-filled
 * form is an exit waiting to happen.
 *
 *   /l/:id/transactions/new
 *   /l/:id/transactions/:tx/edit
 *   /l/:id/transfers/:pair/edit
 *   /accounts/new
 *   /accounts/:sid/edit
 *
 * Pure: the ids are sliced out only as candidates, and every match goes through the
 * `routes` builders, so this table cannot drift from the one the app links with.
 */
import { routes } from '@/domain/routes';

import { LEDGER_PREFIX, barePath } from './backTarget';

/** My accounts' form (decision §14.62): `/accounts/new` and `/accounts/:sid/edit`. */
function isAccountForm(path: string): boolean {
  if (path === routes.accountNew()) return true;
  const prefix = `${routes.accounts()}/`;
  if (!path.startsWith(prefix)) return false;
  const [resourceId] = path.slice(prefix.length).split('/');
  return Boolean(resourceId) && path === routes.accountEdit(resourceId);
}

export function isFormRoute(pathname: string): boolean {
  const path = barePath(pathname);
  if (isAccountForm(path)) return true;
  if (!path.startsWith(LEDGER_PREFIX)) return false;
  const ledgerId = path.slice(LEDGER_PREFIX.length).split('/')[0];
  if (!ledgerId) return false;
  const l = routes.l(ledgerId);

  if (path === l.transactionNew()) return true;

  const resourceId = path.slice(l.home().length + 1).split('/')[1];
  if (!resourceId) return false;
  return (
    path === l.transactionEdit(resourceId) ||
    path === l.transferEdit(resourceId)
  );
}
