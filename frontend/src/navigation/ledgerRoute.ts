/**
 * Which paths are ledger pages, and where a ledger switch leaves the page it happens on
 * (decision §14.66 a, c, d).
 *
 * The ledger pages are `/home`, `/transactions*`, `/transfers*`, `/imports*` and `/ledger`:
 * they show the current ledger and are guarded by `RequireLedger`. `/settings`,
 * `/accounts*` and `/ledgers*` are not — they must open with no ledger at all.
 *
 * Switching ledger keeps the page (the path does not change and no history entry is made);
 * only a page that names one of the old ledger's records — a detail, an edit form, a batch —
 * falls back to that record's list, since the record does not belong to the new ledger.
 *
 * Pure: no React, no router. Leaf module — the store imports it, so it imports nothing from
 * `@/navigation` or `@/store`.
 */
import { type RouteHref, routes } from '@/domain/routes';

/** The path alone: no query string, no hash, no trailing slash. */
export function barePath(pathname: string): string {
  const path = pathname.split('?')[0].split('#')[0];
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** `path` is `section` itself or one of its sub-paths. */
function within(path: string, section: string): boolean {
  return path === section || path.startsWith(`${section}/`);
}

/** Whether `pathname` is one of the ledger pages (the `RequireLedger` set). */
export function isLedgerRoute(pathname: string): boolean {
  const path = barePath(pathname);
  return (
    path === routes.home() ||
    path === routes.ledgerSettings() ||
    within(path, routes.transactions()) ||
    within(path, '/transfers') ||
    within(path, routes.imports())
  );
}

/**
 * Where to go when the ledger is switched on `pathname`: the list page when the path names
 * a record of the old ledger, `null` to stay put.
 *
 *   /transactions/:id, /transactions/:id/edit → /transactions
 *   /transfers/:id,    /transfers/:id/edit    → /transactions (there is no transfer list)
 *   /imports/:batchId                         → /imports
 */
export function ledgerSwitchTarget(pathname: string): RouteHref | null {
  const path = barePath(pathname);
  const [section, resourceId] = path.split('/').filter(Boolean);
  if (!resourceId) return null;
  switch (section) {
    case 'transactions':
      return path === routes.transactionNew() ? null : routes.transactions();
    case 'transfers':
      return routes.transactions();
    case 'imports':
      return path === routes.importsNew() || path === routes.importsGuide()
        ? null
        : routes.imports();
    default:
      return null;
  }
}
