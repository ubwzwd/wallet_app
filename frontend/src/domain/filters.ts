/**
 * URL query ↔ `TransactionListParams` conversion (04 §1.3). Query keys match the
 * `GET /ledgers/{id}/transactions` params verbatim; `limit` never appears in the URL (it's
 * fixed at 50 per §1.3) and an invalid value for any field is dropped rather than kept.
 */
import type { TransactionListParams, TxKind } from '@/api/types';
import { isValidIsoDate } from './dates';

const VALID_KINDS: readonly string[] = ['expense', 'income', 'refund', 'transfer'];

function firstOf(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Plain decimal digits only — `Number()` alone would happily swallow `''`, `'  '`,
 *  `'0x10'`, `'1e3'` and `'Infinity'`, none of which survive a serialize → parse round
 *  trip unchanged (04 §1.3). */
const DECIMAL = /^-?\d+(\.\d+)?$/;

function decimalOrUndefined(raw: string | undefined): number | undefined {
  if (raw === undefined || !DECIMAL.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parse a query-string dict (repeated keys already collapsed to arrays by the router) into
 *  `TransactionListParams`. Unrecognized or malformed values are silently dropped. */
export function parseTxFilters(
  search: Record<string, string | string[] | undefined>
): TransactionListParams {
  const params: TransactionListParams = {};

  const q = firstOf(search.q);
  if (q) params.q = q;

  const kinds = toArray(search.kind).filter((k) => VALID_KINDS.includes(k)) as TxKind[];
  if (kinds.length > 0) params.kind = kinds;

  const l1 = firstOf(search.category_l1);
  if (l1) params.category_l1 = l1;
  const l2 = firstOf(search.category_l2);
  if (l2) params.category_l2 = l2;

  const sourceIds = toArray(search.source_id).filter((s) => s !== '');
  if (sourceIds.length > 0) params.source_id = sourceIds;

  const from = firstOf(search.from);
  if (from && isValidIsoDate(from)) params.from = from;
  const to = firstOf(search.to);
  if (to && isValidIsoDate(to)) params.to = to;

  const currency = firstOf(search.currency);
  if (currency && /^[A-Z]{3}$/.test(currency)) params.currency = currency;

  const minAmount = decimalOrUndefined(firstOf(search.min_amount));
  if (minAmount !== undefined) params.min_amount = minAmount;
  const maxAmount = decimalOrUndefined(firstOf(search.max_amount));
  if (maxAmount !== undefined) params.max_amount = maxAmount;

  const importBatchId = firstOf(search.import_batch_id);
  if (importBatchId) params.import_batch_id = importBatchId;

  // `offset=0` is the default and is never written back to the URL, so it is dropped here
  // too — otherwise parse → serialize → parse would not be idempotent.
  const offset = decimalOrUndefined(firstOf(search.offset));
  if (offset !== undefined && Number.isInteger(offset) && offset > 0) params.offset = offset;

  return params;
}

/** Serialize `TransactionListParams` back to a query dict: empty values are omitted, array
 *  params keep repeated-key semantics, keys come out in a stable (lexicographic) order, and
 *  `limit` is never written. */
export function serializeTxFilters(p: TransactionListParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (p.q) out.q = p.q;
  if (p.kind && p.kind.length > 0) out.kind = p.kind;
  if (p.source_id && p.source_id.length > 0) out.source_id = p.source_id;
  if (p.category_l1) out.category_l1 = p.category_l1;
  if (p.category_l2) out.category_l2 = p.category_l2;
  if (p.from) out.from = p.from;
  if (p.to) out.to = p.to;
  if (p.currency) out.currency = p.currency;
  if (p.min_amount !== undefined) out.min_amount = String(p.min_amount);
  if (p.max_amount !== undefined) out.max_amount = String(p.max_amount);
  if (p.import_batch_id) out.import_batch_id = p.import_batch_id;
  if (p.offset) out.offset = String(p.offset);

  const sorted: Record<string, string | string[]> = {};
  for (const key of Object.keys(out).sort()) sorted[key] = out[key];
  return sorted;
}

const COUNTED_KEYS = [
  'q',
  'kind',
  'source_id',
  'category_l1',
  'category_l2',
  'from',
  'to',
  'currency',
  'min_amount',
  'max_amount',
  'import_batch_id',
] as const;

/** Number of active filter dimensions (not counting `offset`/`limit`) — the badge on the
 *  filter drawer. Each field counts once regardless of how many values an array field has. */
export function activeFilterCount(p: TransactionListParams): number {
  let count = 0;
  for (const key of COUNTED_KEYS) {
    const v = p[key];
    if (Array.isArray(v)) {
      if (v.length > 0) count++;
    } else if (v !== undefined && v !== '') {
      count++;
    }
  }
  return count;
}

export interface FilterChip {
  key: keyof TransactionListParams;
  value: string;
}

/** One chip per active condition — array fields (`kind`, `source_id`) produce one chip per
 *  value so each can be removed independently. */
export function filterChips(p: TransactionListParams): FilterChip[] {
  const chips: FilterChip[] = [];
  if (p.q) chips.push({ key: 'q', value: p.q });
  for (const k of p.kind ?? []) chips.push({ key: 'kind', value: k });
  for (const s of p.source_id ?? []) chips.push({ key: 'source_id', value: s });
  if (p.category_l1) chips.push({ key: 'category_l1', value: p.category_l1 });
  if (p.category_l2) chips.push({ key: 'category_l2', value: p.category_l2 });
  if (p.from) chips.push({ key: 'from', value: p.from });
  if (p.to) chips.push({ key: 'to', value: p.to });
  if (p.currency) chips.push({ key: 'currency', value: p.currency });
  if (p.min_amount !== undefined) chips.push({ key: 'min_amount', value: String(p.min_amount) });
  if (p.max_amount !== undefined) chips.push({ key: 'max_amount', value: String(p.max_amount) });
  if (p.import_batch_id) chips.push({ key: 'import_batch_id', value: p.import_batch_id });
  return chips;
}

/** Remove one filter (or, for array fields, one `value` out of the array) from `p`, returning
 *  a new object. */
export function removeFilter(
  p: TransactionListParams,
  key: keyof TransactionListParams,
  value?: string
): TransactionListParams {
  const next: TransactionListParams = { ...p };
  if (key === 'kind' && value !== undefined) {
    const remaining = (p.kind ?? []).filter((k) => k !== value);
    if (remaining.length > 0) next.kind = remaining;
    else delete next.kind;
  } else if (key === 'source_id' && value !== undefined) {
    const remaining = (p.source_id ?? []).filter((s) => s !== value);
    if (remaining.length > 0) next.source_id = remaining;
    else delete next.source_id;
  } else {
    delete next[key];
  }
  return next;
}
