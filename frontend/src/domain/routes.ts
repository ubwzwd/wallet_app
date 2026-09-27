/**
 * Route-path construction for the table in 04 §1.2 (decision §14.66 a), plus the one safety
 * helper the router guard needs: `safeNext` (04 §1.5 rule 1: only a same-site relative path
 * is a legal `next`).
 *
 * The path names the page and nothing else: the current ledger lives in the tab
 * (`CurrentLedgerProvider`) and a page's browsing state — the home month, the list filters, a
 * batch's slice — lives in `ViewState`, so neither is ever serialized here. The only query
 * parameters left are the ones that mean something at the moment a page is entered (§14.66 f):
 * the new-transaction form's `kind / source_id / refund_of / copy_of / next`, the account
 * form's `ledger`, and sign-in's `next`.
 */
import type { Href } from 'expo-router';
import type { TransactionListParams, TxKind, Uuid } from '@/api/types';

/**
 * A string `Href`. With typed routes generated, expo-router's `Href` is a union of the
 * route table's literal shapes; every helper below builds exactly those shapes, so its
 * result is stated as one — a string at runtime, which is what the guards compare and split.
 */
export type RouteHref = Extract<Href, string>;
const href = (path: string): RouteHref => path as RouteHref;

function buildQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    usp.append(k, v);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

/** What 记一笔 may be opened with (§14.66 f): read once, when the form mounts. */
export interface TransactionNewOptions {
  kind?: TxKind;
  source_id?: Uuid;
  refund_of?: Uuid;
  /** "Copy this transaction": the form opens prefilled from `copy_of` (04 §4.7). */
  copy_of?: Uuid;
  next?: string;
}

// The ledger pages (§14.66 a), `/home` … `/ledger`. None of them names a ledger.
const home = (): RouteHref => href('/home');
const transactions = (): RouteHref => href('/transactions');
const transactionNew = (opts?: TransactionNewOptions): RouteHref =>
  href(
    `/transactions/new${buildQuery({
      kind: opts?.kind,
      source_id: opts?.source_id,
      refund_of: opts?.refund_of,
      copy_of: opts?.copy_of,
      next: opts?.next,
    })}`,
  );
const transaction = (txId: Uuid): RouteHref => href(`/transactions/${txId}`);
const transactionEdit = (txId: Uuid): RouteHref => href(`/transactions/${txId}/edit`);
const transfer = (pairId: Uuid): RouteHref => href(`/transfers/${pairId}`);
const transferEdit = (pairId: Uuid): RouteHref => href(`/transfers/${pairId}/edit`);
const imports = (): RouteHref => href('/imports');
const importsNew = (): RouteHref => href('/imports/new');
const importsGuide = (): RouteHref => href('/imports/guide');
const importBatch = (batchId: Uuid): RouteHref => href(`/imports/${batchId}`);
const ledgerSettings = (): RouteHref => href('/ledger');

export const routes = {
  login: (next?: string) => href(`/login${buildQuery({ next })}`),
  register: (next?: string) => href(`/register${buildQuery({ next })}`),
  /** The no-ledger onboarding; with a ledger it only redirects to `/home` (§14.65 c). */
  ledgers: () => href('/ledgers'),
  ledgersNew: () => href('/ledgers/new'),
  ledgersJoin: () => href('/ledgers/join'),
  /** Personal settings — `/settings`, distinct from the current ledger's `/ledger`. */
  settings: () => href('/settings'),
  /**
   * My accounts (decision §14.62): an account belongs to its owner, not to a ledger.
   * `?ledger=` preselects that ledger in the new form's 「共享到」.
   */
  accounts: (includeArchived?: boolean) =>
    href(`/accounts${buildQuery({ include_archived: includeArchived ? '1' : undefined })}`),
  accountNew: (ledgerId?: Uuid) => href(`/accounts/new${buildQuery({ ledger: ledgerId })}`),
  accountEdit: (sourceId: Uuid) => href(`/accounts/${sourceId}/edit`),

  home,
  /**
   * The transaction list. It takes no filters: a caller that opens the list with one (an
   * account's entries, a batch's transactions) writes `'transactions.filters'` into the
   * ledger's view state first and then navigates here (§14.66 e).
   */
  transactions,
  transactionNew,
  transaction,
  transactionEdit,
  transfer,
  transferEdit,
  imports,
  importsNew,
  importsGuide,
  /** One batch. Its slice and the row it is scrolled to are view state, not query. */
  importBatch,
  /** The current ledger's settings — `/ledger`, distinct from personal `/settings`. */
  ledgerSettings,

  /**
   * @deprecated Transitional shim for §14.66: the old per-ledger builders, answering the
   * ledger-free paths. The id, the month, the filters and the batch slice are all ignored —
   * the ledger is the tab's current one and the rest is view state. It goes as soon as no
   * screen calls it.
   */
  l: (_ledgerId: Uuid) => ({
    home: (_month?: string) => home(),
    transactions: (_params?: TransactionListParams) => transactions(),
    transactionNew,
    transaction,
    transactionEdit,
    transfer,
    transferEdit,
    imports,
    importsGuide,
    importsNew,
    importBatch: (batchId: Uuid, _opts?: { row?: string; filter?: string }) =>
      importBatch(batchId),
    settings: ledgerSettings,
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
