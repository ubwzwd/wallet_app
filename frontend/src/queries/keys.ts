/**
 * Query key factory (04 §3.5).
 *
 * Two namespaces. Every ledger-scoped key starts with `['l', ledgerId, ...]`, so
 * `removeQueries({ queryKey: ['l', ledgerId] })` wipes one ledger in a single call
 * (switching ledger, being removed from one, logging out).
 */
import { normalizeParams } from '@/api/params';
import type { TransactionListParams, Uuid } from '@/api/types';

/** Keys for everything that is not scoped to a ledger. */
const global = {
  me: () => ['global', 'me'] as const,
  config: () => ['global', 'config'] as const,
  categories: () => ['global', 'categories'] as const,
  importFormat: () => ['global', 'import-format'] as const,
  currencies: () => ['global', 'currencies'] as const,
  ledgers: () => ['global', 'ledgers'] as const,
  /**
   * My own accounts (decision §14.62): an account belongs to a user, not to a ledger, so
   * its list (with the net-worth totals) and its detail live here. `sourcesRoot` is the
   * prefix both sit under.
   */
  sourcesRoot: () => ['global', 'sources'] as const,
  sources: (p?: { include_archived?: boolean }) => ['global', 'sources', p ?? {}] as const,
  source: (sid: Uuid) => ['global', 'sources', 'detail', sid] as const,
};

/**
 * Ledger-scoped keys. The `*Root()` entries are not query keys of their own: they are
 * the prefixes the invalidation matrix (§3.6) works with — `txRoot` covers every filter
 * combination, `sourcesRoot` both variants of the accounts this ledger can see
 * (`GET /ledgers/{id}/sources`; an account's own detail is global, see above).
 */
function ledger(l: Uuid) {
  return {
    root: () => ['l', l] as const,
    detail: () => ['l', l, 'detail'] as const,
    members: () => ['l', l, 'members'] as const,
    sourcesRoot: () => ['l', l, 'sources'] as const,
    sources: (p?: { include_archived?: boolean }) => ['l', l, 'sources', p ?? {}] as const,
    txRoot: () => ['l', l, 'tx'] as const,
    txList: (p: TransactionListParams) => ['l', l, 'tx', 'list', normalizeParams(p)] as const,
    tx: (tid: Uuid) => ['l', l, 'tx', 'detail', tid] as const,
    transfer: (pid: Uuid) => ['l', l, 'tx', 'transfer', pid] as const,
    statsRoot: () => ['l', l, 'stats'] as const,
    statsSum: (month: string) => ['l', l, 'stats', 'summary', month] as const,
    statsTrend: (months: number) => ['l', l, 'stats', 'trend', months] as const,
    imports: () => ['l', l, 'imports', 'list'] as const,
    importB: (bid: Uuid) => ['l', l, 'imports', 'detail', bid] as const,
    importRows: (bid: Uuid) => ['l', l, 'imports', 'rows', bid] as const,
  };
}

export const qk = { global, ledger };

/** First segment of every ledger-scoped key. */
export const LEDGER_KEY_PREFIX = 'l';
