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
import { KINDS } from '@/domain/kinds';
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

/** The router's search params (`useGlobalSearchParams`), or a query string. */
export type SearchInput = string | Record<string, string | string[] | undefined>;

/** Each key's first value, from the query inside `pathname` and then from `search`. */
function queryOf(pathname: string, search: SearchInput | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const add = (key: string, value: string | undefined): void => {
    if (value !== undefined && value !== '' && !out.has(key)) out.set(key, value);
  };
  const addQuery = (query: string): void => {
    new URLSearchParams(query).forEach((value, key) => add(key, value));
  };
  const [, inPath] = pathname.split('#')[0].split('?');
  if (inPath) addQuery(inPath);
  if (typeof search === 'string') addQuery(search.replace(/^\?/, ''));
  else if (search) {
    for (const [key, value] of Object.entries(search)) {
      add(key, Array.isArray(value) ? value[0] : value);
    }
  }
  return out;
}

/** 记一笔's entry parameters that name one of the current ledger's records (§14.66 f). */
const FORM_RECORD_PARAMS = ['source_id', 'refund_of', 'copy_of'] as const;

/**
 * 记一笔 stays 记一笔 across a switch, but an entry parameter naming one of the old ledger's
 * records (an account, the original of a refund, the entry to copy) would be applied to the
 * new ledger on a reload — so the address drops them, keeping only the tab it was opened on
 * (`next`, a page of the old ledger, goes too).
 */
function newTransactionTarget(pathname: string, search: SearchInput | undefined): RouteHref | null {
  const query = queryOf(pathname, search);
  if (!FORM_RECORD_PARAMS.some((key) => query.has(key))) return null;
  const kind = KINDS.find((k) => k === query.get('kind'));
  // `?refund_of=` alone opens the refund tab; without the parameter it has to be said.
  return routes.transactionNew({
    kind: kind ?? (query.has('refund_of') ? 'refund' : undefined),
  });
}

/**
 * Where to go when the ledger is switched on `pathname`: the list page when the path names
 * a record of the old ledger, `null` to stay put.
 *
 *   /transactions/:id, /transactions/:id/edit → /transactions
 *   /transfers/:id,    /transfers/:id/edit    → /transactions (there is no transfer list)
 *   /imports/:batchId                         → /imports
 *   /transactions/new?source_id=|refund_of=|copy_of=… → /transactions/new?kind=… (the form
 *     stays; only the parameters naming the old ledger's records are dropped)
 *
 * The query is read from `pathname` itself when it carries one, and from `search` — pass
 * `useGlobalSearchParams()` there, since `usePathname()` has no query.
 */
export function ledgerSwitchTarget(pathname: string, search?: SearchInput): RouteHref | null {
  const path = barePath(pathname);
  const [section, resourceId] = path.split('/').filter(Boolean);
  if (!resourceId) return null;
  switch (section) {
    case 'transactions':
      return path === routes.transactionNew()
        ? newTransactionTarget(pathname, search)
        : routes.transactions();
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
