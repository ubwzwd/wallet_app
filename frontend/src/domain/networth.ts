/**
 * Assets / liabilities / net-worth summation over finance sources (04 §4.4, §4.8; decision
 * §14.50): credit accounts are liabilities (their `balance_base` is already negative and stays
 * that way), everything else is an asset; archived accounts don't count at all; an account
 * whose `balance_base` couldn't be converted is counted separately, never coerced to zero.
 */
import type { FinanceSource, Money, SourceType } from '@/api/types';
import { formatMoney4, parseMoney } from './money';

/** Fixed display order for account-type groups (decision §14.48 — there is no `savings`). */
export const SOURCE_TYPE_ORDER: SourceType[] = ['checking', 'credit', 'cash', 'other'];

export interface NetWorthSummary {
  assets: Money;
  liabilities: Money; // negative (it's the signed sum of credit balances)
  net: Money; // assets + liabilities
  archivedCount: number;
  unconvertibleCount: number;
  byType: Record<SourceType, { subtotal: Money; count: number }>;
}

export function sumSources(sources: FinanceSource[]): NetWorthSummary {
  let assets = 0n;
  let liabilities = 0n;
  let archivedCount = 0;
  let unconvertibleCount = 0;

  const acc: Record<SourceType, { subtotal: bigint; count: number }> = {
    checking: { subtotal: 0n, count: 0 },
    credit: { subtotal: 0n, count: 0 },
    cash: { subtotal: 0n, count: 0 },
    other: { subtotal: 0n, count: 0 },
  };

  for (const source of sources) {
    if (source.archived) {
      archivedCount++;
      continue;
    }
    if (source.balance_base === null) {
      unconvertibleCount++;
      continue;
    }
    const v = parseMoney(source.balance_base);
    if (source.type === 'credit') liabilities += v;
    else assets += v;
    acc[source.type].subtotal += v;
    acc[source.type].count += 1;
  }

  const byType = Object.fromEntries(
    SOURCE_TYPE_ORDER.map((type) => [
      type,
      { subtotal: formatMoney4(acc[type].subtotal), count: acc[type].count },
    ])
  ) as Record<SourceType, { subtotal: Money; count: number }>;

  return {
    assets: formatMoney4(assets),
    liabilities: formatMoney4(liabilities),
    net: formatMoney4(assets + liabilities),
    archivedCount,
    unconvertibleCount,
    byType,
  };
}
