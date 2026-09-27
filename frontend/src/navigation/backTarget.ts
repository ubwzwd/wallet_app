/**
 * Where a page's back button leads when there is no in-app history to step back through
 * (decisions §14.64 d / f, §14.65 d, §14.66 g) — a deep link opened in a new tab, a reload.
 *
 * A top-level page (one the navigation reaches directly: `/home`, `/transactions`,
 * `/imports`, `/settings`, and `/accounts` on a wide screen) has no back button at all and
 * answers `null`. Everything else is a sub-page with a fixed parent:
 *
 *   /transactions/:id, /transfers/:id      → /transactions
 *   /transactions/:id/edit                 → /transactions/:id
 *   /transfers/:id/edit                    → /transfers/:id
 *   /transactions/new                      → /transactions
 *   /accounts/new, /accounts/:sid/edit     → /accounts
 *   /accounts (narrow only)                → /home (no button for a user with no ledger)
 *   /imports/new, /imports/:batchId        → /imports
 *   /imports/guide                         → /imports/new
 *   /ledger                                → /home
 *   /ledgers/new, /ledgers/join            → /home; for a user with no ledger at all, the
 *                                            onboarding page `/ledgers`
 *   /settings                              → `/ledgers`, but only for a user with no ledger
 *
 * `/ledgers` itself is not a page any more (§14.65 c): with a ledger it redirects to `/home`,
 * and without one it is the onboarding page, which has nowhere to go back to.
 *
 * Pure: no React, no router — `useBack` feeds it the live answers.
 */
import { type RouteHref, routes } from '@/domain/routes';

import { barePath } from './ledgerRoute';

export type BackParentKey = 'home' | 'transactions' | 'sources' | 'imports' | 'ledgers';

export type BackTarget = { href: RouteHref; parentKey: BackParentKey };

export interface BackTargetOptions {
  /** Wide layouts reach `/accounts` from the sidebar, so it is top-level there. */
  wide: boolean;
  /** Whether the user belongs to at least one ledger. */
  hasLedgers: boolean;
}

const to = (href: RouteHref, parentKey: BackParentKey): BackTarget => ({ href, parentKey });

/**
 * My accounts (decision §14.62). The list is one of the sidebar's five on a wide screen; the
 * narrow tab bar has no slot for it (the "me" sheet leads there), so there it is a sub-page
 * of home — screen 09 at 375 is 「‹ 账户」. The form is a sub-page of the list at both widths.
 */
function inAccounts(path: string, opts: BackTargetOptions): BackTarget | null {
  const list = routes.accounts();
  if (path === list) {
    return opts.wide || !opts.hasLedgers ? null : to(routes.home(), 'home');
  }
  if (path === routes.accountNew()) return to(list, 'sources');
  const [resourceId] = path.slice(list.length + 1).split('/');
  if (resourceId && path === routes.accountEdit(resourceId)) return to(list, 'sources');
  return null;
}

/** The ledger pages: `/home` … `/ledger` (§14.66 a). */
function inLedger(path: string): BackTarget | null {
  // Top-level pages: the sidebar's five and the tab bar's four.
  if (path === routes.home() || path === routes.transactions() || path === routes.imports()) {
    return null;
  }

  // Fixed sub-pages.
  if (path === routes.transactionNew()) return to(routes.transactions(), 'transactions');
  if (path === routes.importsNew()) return to(routes.imports(), 'imports');
  if (path === routes.importsGuide()) return to(routes.importsNew(), 'imports');
  if (path === routes.ledgerSettings()) return to(routes.home(), 'home');

  // Sub-pages that carry a resource id: `/<section>/<id>` and `/<section>/<id>/edit`.
  const [section, resourceId] = path.split('/').filter(Boolean);
  if (!resourceId) return null;
  switch (section) {
    case 'transactions':
      if (path === routes.transaction(resourceId)) return to(routes.transactions(), 'transactions');
      if (path === routes.transactionEdit(resourceId)) {
        return to(routes.transaction(resourceId), 'transactions');
      }
      return null;
    case 'transfers':
      if (path === routes.transfer(resourceId)) return to(routes.transactions(), 'transactions');
      if (path === routes.transferEdit(resourceId)) {
        return to(routes.transfer(resourceId), 'transactions');
      }
      return null;
    case 'imports':
      return path === routes.importBatch(resourceId) ? to(routes.imports(), 'imports') : null;
    default:
      return null;
  }
}

export function backTargetFor(pathname: string, opts: BackTargetOptions): BackTarget | null {
  const path = barePath(pathname);

  if (path === routes.settings()) {
    return opts.hasLedgers ? null : to(routes.ledgers(), 'ledgers');
  }
  if (path === routes.ledgers()) return null;
  if (path === routes.ledgersNew() || path === routes.ledgersJoin()) {
    return opts.hasLedgers ? to(routes.home(), 'home') : to(routes.ledgers(), 'ledgers');
  }
  if (path === routes.accounts() || path.startsWith(`${routes.accounts()}/`)) {
    return inAccounts(path, opts);
  }
  return inLedger(path);
}
