/** `/ledgers/{id}/stats/*` — monthly summary and expense trend (03 §5.35–§5.36). */
import { apiClient } from './client';
import type { StatsSummary, StatsTrend, Uuid } from './types';

export const statsApi = {
  summary: (l: Uuid, p: { month: string }): Promise<StatsSummary> =>
    apiClient
      .get<StatsSummary>(`/ledgers/${l}/stats/summary`, { params: p })
      .then((r) => r.data),

  /** `months` is 1..36; `end` is the last month of the series, default the current UTC month. */
  trend: (l: Uuid, p: { months: number; end?: string }): Promise<StatsTrend> =>
    apiClient.get<StatsTrend>(`/ledgers/${l}/stats/trend`, { params: p }).then((r) => r.data),
};
