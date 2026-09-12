/** Monthly summary and expense trend (04 §3.4, §4.4). */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { statsApi } from '@/api/stats';
import type { StatsSummary, StatsTrend, Uuid } from '@/api/types';

import { qk } from './keys';

/** Default length of the home-page trend series (04 §4.4). */
export const TREND_MONTHS = 12;

/** `GET /stats/summary?month=YYYY-MM`. */
export function useStatsSummary(
  l: Uuid | undefined,
  month: string | undefined,
): UseQueryResult<StatsSummary> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').statsSum(month ?? ''),
    queryFn: () => statsApi.summary(l as Uuid, { month: month as string }),
    enabled: Boolean(l) && Boolean(month),
  });
}

/** `GET /stats/trend?months=` — the series ends with the current month (03 §5.36). */
export function useStatsTrend(
  l: Uuid | undefined,
  months: number = TREND_MONTHS,
): UseQueryResult<StatsTrend> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').statsTrend(months),
    queryFn: () => statsApi.trend(l as Uuid, { months }),
    enabled: Boolean(l) && months > 0,
  });
}
