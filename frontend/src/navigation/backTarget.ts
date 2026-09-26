/**
 * Where a page's back button leads when there is no in-app history to step back through
 * (decision §14.64 d / f) — a deep link opened in a new tab, a reload.
 *
 * A top-level page (one the navigation reaches directly) has no back button at all and
 * answers `null`. Everything else is a sub-page with a fixed parent:
 *
 *   transaction / transfer detail  → the transaction list
 *   transaction / transfer edit    → its detail
 *   new transaction                → the transaction list
 *   new / edit account             → the account list
 *   account list (narrow only)     → home
 *   import upload, import batch    → the import history
 *   import format guide            → the import upload
 *   ledger settings                → home
 *   `/ledgers`                     → home of the ledger the chrome names (none: no button)
 *   `/ledgers/new`, `/ledgers/join`→ `/ledgers`
 *   `/settings`                    → `/ledgers`, but only for a user with no ledger at all
 *
 * Pure: no React, no router — `useBack` feeds it the live answers.
 */
import { type RouteHref, routes } from '@/domain/routes';

export type BackParentKey = 'home' | 'transactions' | 'sources' | 'imports' | 'ledgers';

export type BackTarget = { href: RouteHref; parentKey: BackParentKey };

export interface BackTargetOptions {
  /** Wide layouts reach the account list from the sidebar, so it is top-level there. */
  wide: boolean;
  /** The ledger the chrome names outside a ledger route (`useChromeLedger`). */
  chromeLedgerId: string | null;
  /** Whether the user belongs to at least one ledger. */
  hasLedgers: boolean;
}

const LEDGER_PREFIX = '/l/';

/** The path alone: no query string, no trailing slash. */
function bare(pathname: string): string {
  const path = pathname.split('?')[0].split('#')[0];
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function inLedger(path: string, wide: boolean): BackTarget | null {
  const ledgerId = path.slice(LEDGER_PREFIX.length).split('/')[0];
  if (!ledgerId) return null;
  const l = routes.l(ledgerId);
  const to = (href: RouteHref, parentKey: BackParentKey): BackTarget => ({ href, parentKey });

  // Top-level pages: the sidebar's five and the tab bar's four.
  if (path === l.home() || path === l.transactions() || path === l.imports()) return null;
  if (path === l.sources()) return wide ? null : to(l.home(), 'home');

  // Fixed sub-pages.
  if (path === l.transactionNew()) return to(l.transactions(), 'transactions');
  if (path === l.sourceNew()) return to(l.sources(), 'sources');
  if (path === l.importsNew()) return to(l.imports(), 'imports');
  if (path === l.importsGuide()) return to(l.importsNew(), 'imports');
  if (path === l.settings()) return to(l.home(), 'home');

  // Sub-pages that carry a resource id: `<section>/<id>` and `<section>/<id>/edit`.
  const [section, resourceId] = path.slice(l.home().length + 1).split('/');
  if (!resourceId) return null;
  switch (section) {
    case 'transactions':
      if (path === l.transaction(resourceId)) return to(l.transactions(), 'transactions');
      if (path === l.transactionEdit(resourceId)) {
        return to(l.transaction(resourceId), 'transactions');
      }
      return null;
    case 'transfers':
      if (path === l.transfer(resourceId)) return to(l.transactions(), 'transactions');
      if (path === l.transferEdit(resourceId)) return to(l.transfer(resourceId), 'transactions');
      return null;
    case 'sources':
      return path === l.sourceEdit(resourceId) ? to(l.sources(), 'sources') : null;
    case 'imports':
      return path === l.importBatch(resourceId) ? to(l.imports(), 'imports') : null;
    default:
      return null;
  }
}

export function backTargetFor(pathname: string, opts: BackTargetOptions): BackTarget | null {
  const path = bare(pathname);

  if (path === routes.settings()) {
    return opts.hasLedgers ? null : { href: routes.ledgers(), parentKey: 'ledgers' };
  }
  if (path === routes.ledgers()) {
    return opts.chromeLedgerId === null
      ? null
      : { href: routes.l(opts.chromeLedgerId).home(), parentKey: 'home' };
  }
  if (path === routes.ledgersNew() || path === routes.ledgersJoin()) {
    return { href: routes.ledgers(), parentKey: 'ledgers' };
  }
  if (path.startsWith(LEDGER_PREFIX)) {
    return inLedger(path, opts.wide);
  }
  return null;
}
