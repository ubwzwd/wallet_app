/**
 * The two pieces of the old `MoneyText` the kit still needs after §14.59a moved amount
 * writing to `formatLedgerAmount` and the rows to `RowAmount` (screens/transactions/amount).
 */
import type { Money, TxKind } from '@/api/types';
import type { TextTone } from './Text';

/** 04 §6.2 rule 2: a transfer amount is never painted with `kind.transfer`. */
export const KIND_AMOUNT_TONE: Readonly<Record<TxKind, TextTone>> = {
  expense: 'expense',
  income: 'income',
  refund: 'refund',
  transfer: 'primary',
};

export interface MoneyBase {
  amount_base: Money | null;
  base_currency: string;
}
