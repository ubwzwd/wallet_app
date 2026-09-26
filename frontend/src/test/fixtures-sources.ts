/** Account fixtures (03 §5.20 / §5.24c shapes), split out of fixtures.ts for the 400-line limit. */
import type { FinanceSource, LedgerSource } from '@/api/types';

import { LEDGER_ID, SOURCE_ID, USER_ID } from './ids';

export function makeSource(over: Partial<FinanceSource> = {}): FinanceSource {
  return {
    id: SOURCE_ID,
    owner_id: USER_ID,
    name: '招商 信用卡',
    type: 'credit',
    default_currency: 'CNY',
    opening_balance: '-3204.0000',
    archived: false,
    archived_at: null,
    created_by: USER_ID,
    updated_by: null,
    created_at: '2026-02-01T09:05:00.000000Z',
    updated_at: '2026-09-01T12:00:00.000000Z',
    shared_to: [LEDGER_ID],
    balance: '-4120.5500',
    balance_base: '-4120.5500',
    balance_rate: '1.00000000',
    balance_rate_date: '2026-09-11',
    rate_missing_count: 0,
    ...over,
  };
}

/** A `GET /ledgers/{id}/sources` row: mine by default; `mine: false` nulls owner-only fields. */
export function makeLedgerSource(over: Partial<LedgerSource> = {}): LedgerSource {
  const { mine = true, usable = true, ...rest } = over;
  const ownerOnly = { opening_balance: null, balance: null, balance_base: null, shared_to: null };
  const hidden = mine ? {} : { ...ownerOnly, balance_rate: null, balance_rate_date: null };
  return { ...makeSource({ ...hidden, ...rest }), mine, usable };
}
