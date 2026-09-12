/**
 * Two-leg transfer merging for the transaction list (04 §4.5, decision §14.52 B15): the API
 * always returns one row per leg; merging the two legs of a `transfer_pair_id` into one row is
 * entirely a front-end concern.
 */
import type { IsoDate, Money, Transaction, Uuid } from '@/api/types';
import { formatMoney4, parseMoney } from './money';

export type ListRow =
  | { kind: 'single'; tx: Transaction }
  | { kind: 'pair'; pairId: Uuid; out: Transaction; in: Transaction }
  | { kind: 'half'; tx: Transaction; missing: 'out' | 'in' };

/**
 * Merge same-`transfer_pair_id` legs into one `pair` row. Row order follows the position the
 * *first* leg of each pair appears at in `items`. A leg whose partner isn't in `items` (it fell
 * on another page) renders as `half`; a single-leg transfer (`transfer_pair_id === null`) and
 * any non-transfer transaction render as `single`.
 */
export function mergeTransferRows(items: Transaction[]): ListRow[] {
  const rows: ListRow[] = [];
  const indexByPairId = new Map<Uuid, number>();

  for (const tx of items) {
    if (tx.kind === 'transfer' && tx.transfer_pair_id) {
      const pairId = tx.transfer_pair_id;
      const existingIndex = indexByPairId.get(pairId);
      if (existingIndex === undefined) {
        const missing = tx.transfer_role === 'out' ? 'in' : 'out';
        rows.push({ kind: 'half', tx, missing });
        indexByPairId.set(pairId, rows.length - 1);
      } else {
        const existing = rows[existingIndex];
        if (existing.kind === 'half') {
          const out = existing.tx.transfer_role === 'out' ? existing.tx : tx;
          const inTx = existing.tx.transfer_role === 'in' ? existing.tx : tx;
          rows[existingIndex] = { kind: 'pair', pairId, out, in: inTx };
        }
        // A third row for the same pair id (shouldn't happen) is dropped rather than
        // clobbering the already-merged pair.
      }
    } else {
      rows.push({ kind: 'single', tx });
    }
  }

  return rows;
}

/** Row count as shown in "共 N 笔" — a merged pair counts once. */
export function countRows(rows: ListRow[]): number {
  return rows.length;
}

export interface DayGroup {
  date: IsoDate;
  rows: ListRow[];
  expense: Money;
  income: Money;
  /** Rows excluded from `expense`/`income` because `amount_base` was `null` (no rate available). */
  rateMissing: number;
}

function dayOf(row: ListRow): IsoDate {
  return row.kind === 'pair' ? row.out.occurred_at : row.tx.occurred_at;
}

interface Bucket {
  rows: ListRow[];
  expenseAcc: bigint;
  incomeAcc: bigint;
  rateMissing: number;
}

function accumulate(row: ListRow, bucket: Bucket): void {
  if (row.kind === 'pair') return; // transfers never count toward the day's expense/income
  const tx = row.tx;
  if (tx.kind === 'transfer') return;
  if (tx.amount_base === null) {
    bucket.rateMissing++;
    return;
  }
  const v = parseMoney(tx.amount_base);
  if (v < 0n) bucket.expenseAcc += -v;
  else bucket.incomeAcc += v;
}

/** Group rows by `occurred_at`, each with a per-day expense/income subtotal (transfers
 *  excluded, decision §14.52 A14) and a count of rows skipped for lack of a conversion rate. */
export function groupByDay(rows: ListRow[]): DayGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const date = dayOf(row);
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = { rows: [], expenseAcc: 0n, incomeAcc: 0n, rateMissing: 0 };
      buckets.set(date, bucket);
      order.push(date);
    }
    bucket.rows.push(row);
    accumulate(row, bucket);
  }

  return order.map((date) => {
    const b = buckets.get(date)!;
    return {
      date,
      rows: b.rows,
      expense: formatMoney4(b.expenseAcc),
      income: formatMoney4(b.incomeAcc),
      rateMissing: b.rateMissing,
    };
  });
}
