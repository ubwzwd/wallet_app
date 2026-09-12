/** `/ledgers/{id}/sources*` — finance accounts (03 §5.20–§5.24). */
import { apiClient } from './client';
import type {
  FinanceSource,
  FinanceSourceCreate,
  FinanceSourceUpdate,
  Paged,
  Uuid,
} from './types';

export const sourcesApi = {
  list: (l: Uuid, p?: { include_archived?: boolean }): Promise<Paged<FinanceSource>> =>
    apiClient
      .get<Paged<FinanceSource>>(`/ledgers/${l}/sources`, { params: p })
      .then((r) => r.data),

  create: (l: Uuid, b: FinanceSourceCreate): Promise<FinanceSource> =>
    apiClient.post<FinanceSource>(`/ledgers/${l}/sources`, b).then((r) => r.data),

  get: (l: Uuid, sid: Uuid): Promise<FinanceSource> =>
    apiClient.get<FinanceSource>(`/ledgers/${l}/sources/${sid}`).then((r) => r.data),

  update: (l: Uuid, sid: Uuid, b: FinanceSourceUpdate): Promise<FinanceSource> =>
    apiClient.patch<FinanceSource>(`/ledgers/${l}/sources/${sid}`, b).then((r) => r.data),

  remove: (l: Uuid, sid: Uuid): Promise<void> =>
    apiClient.delete<void>(`/ledgers/${l}/sources/${sid}`).then(() => undefined),
};
