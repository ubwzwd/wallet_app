/**
 * Finance accounts (decision §14.62; 03 §5.20–§5.24): an account belongs to its owner and is
 * shared into ledgers. `/sources*` is the owner's own view; `/ledgers/{id}/sources` lists what
 * one ledger can see — the caller's accounts, the ones members shared in, and any account the
 * ledger's transactions still reference.
 */
import { apiClient } from './client';
import type {
  FinanceSource,
  FinanceSourceCreate,
  FinanceSourceUpdate,
  LedgerSource,
  Paged,
  SourceListResponse,
  Uuid,
} from './types';

export interface SourceListQuery {
  include_archived?: boolean;
}

export const sourcesApi = {
  /** `GET /sources` — my accounts, with my net worth. */
  list: (p?: SourceListQuery): Promise<SourceListResponse> =>
    apiClient.get<SourceListResponse>('/sources', { params: p }).then((r) => r.data),

  create: (b: FinanceSourceCreate): Promise<FinanceSource> =>
    apiClient.post<FinanceSource>('/sources', b).then((r) => r.data),

  get: (sid: Uuid): Promise<FinanceSource> =>
    apiClient.get<FinanceSource>(`/sources/${sid}`).then((r) => r.data),

  update: (sid: Uuid, b: FinanceSourceUpdate): Promise<FinanceSource> =>
    apiClient.patch<FinanceSource>(`/sources/${sid}`, b).then((r) => r.data),

  remove: (sid: Uuid): Promise<void> =>
    apiClient.delete<void>(`/sources/${sid}`).then(() => undefined),

  /** `PUT /sources/{sid}/ledgers/{lid}` — share into a ledger I belong to (idempotent). */
  share: (sid: Uuid, lid: Uuid): Promise<void> =>
    apiClient.put<void>(`/sources/${sid}/ledgers/${lid}`).then(() => undefined),

  /** `DELETE /sources/{sid}/ledgers/{lid}` — stop sharing (idempotent). */
  unshare: (sid: Uuid, lid: Uuid): Promise<void> =>
    apiClient.delete<void>(`/sources/${sid}/ledgers/${lid}`).then(() => undefined),

  /** `GET /ledgers/{l}/sources` — the accounts one ledger can see; no totals. */
  listInLedger: (l: Uuid, p?: SourceListQuery): Promise<Paged<LedgerSource>> =>
    apiClient
      .get<Paged<LedgerSource>>(`/ledgers/${l}/sources`, { params: p })
      .then((r) => r.data),
};
