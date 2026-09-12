/**
 * Route-path construction for the table in 04 §1.2, plus the two safety helpers the router
 * guard needs: `safeNext` (04 §1.5 rule 1: only a same-site relative path is a legal `next`)
 * and `withLedger` (04 §2.2: rewrite a path to another ledger, dropping id-scoped query params
 * and any path-embedded resource id that doesn't carry over).
 */
import type { TransactionListParams, TxKind, Uuid } from '@/api/types';
import { serializeTxFilters } from './filters';

function buildQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    usp.append(k, v);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function paramsToQueryString(params: Record<string, string | string[]>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, item);
    } else {
      usp.append(k, v);
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export const routes = {
  login: (next?: string) => `/login${buildQuery({ next })}`,
  register: (next?: string) => `/register${buildQuery({ next })}`,
  ledgers: () => '/ledgers',
  ledgersNew: () => '/ledgers/new',
  ledgersJoin: () => '/ledgers/join',
  /** Personal settings — `/settings`, distinct from a ledger's own `l(id).settings()`. */
  settings: () => '/settings',

  l: (ledgerId: Uuid) => ({
    home: (month?: string) => `/l/${ledgerId}${buildQuery({ month })}`,
    transactions: (params?: TransactionListParams) =>
      `/l/${ledgerId}/transactions${paramsToQueryString(serializeTxFilters(params ?? {}))}`,
    transactionNew: (opts?: {
      kind?: TxKind;
      source_id?: Uuid;
      refund_of?: Uuid;
      /** "Copy this transaction": the form opens prefilled from `copy_of` (04 §4.7). */
      copy_of?: Uuid;
      next?: string;
    }) =>
      `/l/${ledgerId}/transactions/new${buildQuery({
        kind: opts?.kind,
        source_id: opts?.source_id,
        refund_of: opts?.refund_of,
        copy_of: opts?.copy_of,
        next: opts?.next,
      })}`,
    transaction: (txId: Uuid) => `/l/${ledgerId}/transactions/${txId}`,
    transactionEdit: (txId: Uuid) => `/l/${ledgerId}/transactions/${txId}/edit`,
    transfer: (pairId: Uuid) => `/l/${ledgerId}/transfers/${pairId}`,
    transferEdit: (pairId: Uuid) => `/l/${ledgerId}/transfers/${pairId}/edit`,
    sources: (includeArchived?: boolean) =>
      `/l/${ledgerId}/sources${buildQuery({ include_archived: includeArchived ? '1' : undefined })}`,
    sourceNew: () => `/l/${ledgerId}/sources/new`,
    sourceEdit: (sourceId: Uuid) => `/l/${ledgerId}/sources/${sourceId}/edit`,
    imports: () => `/l/${ledgerId}/imports`,
    importsGuide: () => `/l/${ledgerId}/imports/guide`,
    importsNew: () => `/l/${ledgerId}/imports/new`,
    importBatch: (batchId: Uuid, opts?: { row?: string; filter?: string }) =>
      `/l/${ledgerId}/imports/${batchId}${buildQuery({ row: opts?.row, filter: opts?.filter })}`,
    /** This ledger's settings — `/l/:ledgerId/settings`. */
    settings: () => `/l/${ledgerId}/settings`,
  }),
};

/** Any ASCII control character, not just CR/LF: NUL, tab and the C0/DEL range can all
 *  smuggle a second line or a hidden segment past a naive check. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * Validate a `?next=` value: only a single-`/`-leading, same-site relative path is accepted.
 * Rejects `//host/...` (protocol-relative), any scheme (`javascript:`, `https:`, ...),
 * backslashes, every ASCII control character, and `..` path segments (04 §1.5 rule 1).
 */
export function safeNext(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value === '') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  if (CONTROL_CHARS.test(value)) return null;
  if (value.includes(':')) return null;
  const [path] = value.split('?');
  if (path.split('/').some((segment) => segment === '..')) return null;
  return value;
}

const LEDGER_SCOPED_QUERY_KEYS = new Set([
  'kind',
  'from',
  'to',
  'q',
  'currency',
  'min_amount',
  'max_amount',
  'month',
  'include_archived',
  'category_l1',
  'category_l2',
]);

/** The top-level-route-shaped fallback for a path's segments once any embedded resource id is
 *  dropped — e.g. `['transactions', '<txId>', 'edit']` → `/transactions` (its list page). */
function fallbackPath(segments: string[]): string {
  const top = segments[0];
  switch (top) {
    case undefined:
      return '';
    case 'transactions':
      return segments[1] === 'new' ? '/transactions/new' : '/transactions';
    case 'transfers':
      // There's no standalone transfers list route; the transactions list is the closest one.
      return '/transactions';
    case 'sources':
      return segments[1] === 'new' ? '/sources/new' : '/sources';
    case 'imports':
      if (segments[1] === 'guide') return '/imports/guide';
      if (segments[1] === 'new') return '/imports/new';
      return '/imports';
    case 'settings':
      return '/settings';
    default:
      return '';
  }
}

/**
 * Rewrite a `/l/:fromLedgerId/...` path to `/l/:toLedgerId/...`, preserving the route's shape
 * but falling back to that resource's list page when the path embeds a resource id (a
 * transaction, source, or import batch id doesn't carry over to another ledger), and keeping
 * only the query params that are meaningful across ledgers (04 §2.2) — `source_id`,
 * `import_batch_id`, and `offset` are dropped along with any path-embedded id.
 */
export function withLedger(path: string, fromLedgerId: string, toLedgerId: string): string {
  const [rawPath, rawQuery = ''] = path.split('?');
  const prefix = `/l/${fromLedgerId}`;
  if (rawPath !== prefix && !rawPath.startsWith(`${prefix}/`)) return path;

  const rest = rawPath.slice(prefix.length);
  const segments = rest.split('/').filter(Boolean);
  const newRest = fallbackPath(segments);

  const kept = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(rawQuery).entries()) {
    if (LEDGER_SCOPED_QUERY_KEYS.has(k)) kept.append(k, v);
  }
  const qs = kept.toString();

  return `/l/${toLedgerId}${newRest}${qs ? `?${qs}` : ''}`;
}
