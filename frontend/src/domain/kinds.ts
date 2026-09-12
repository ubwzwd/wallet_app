/**
 * Transaction `kind` → sign rules and kind-change legality (decisions §1, §14.3).
 */
import type { Money, TransferRole, TxKind } from '@/api/types';
import { absMoney, negMoney } from './money';

export const KINDS: TxKind[] = ['expense', 'income', 'refund', 'transfer'];

/**
 * The sign a `kind` (and, for transfers, `transfer_role`) carries. `expense` is always
 * negative, `income`/`refund` always positive, and a `transfer` is negative for the `out`
 * leg and positive for the `in` leg (decisions §1). A transfer without a role defaults to
 * `out`'s sign — callers building a two-leg transfer apply signs explicitly per leg instead.
 */
export function signForKind(kind: TxKind, role?: TransferRole): 1 | -1 {
  switch (kind) {
    case 'expense':
      return -1;
    case 'income':
    case 'refund':
      return 1;
    case 'transfer':
      return role === 'in' ? 1 : -1;
  }
}

/** Apply the kind's sign to an unsigned magnitude, regardless of any sign already on it. */
export function applySign(amountAbs: Money, kind: TxKind, role?: TransferRole): Money {
  const abs = absMoney(amountAbs);
  return signForKind(kind, role) === -1 ? negMoney(abs) : abs;
}

/** Which category tree a `kind` draws from: expense/refund use the expense tree, income the
 *  income tree, transfer none (decisions §1.3). */
export function kindOfCategoryTree(kind: TxKind): 'expense' | 'income' | null {
  if (kind === 'expense' || kind === 'refund') return 'expense';
  if (kind === 'income') return 'income';
  return null;
}

/**
 * Whether a PATCH may change a transaction's `kind` from `from` to `to`. `expense` / `income`
 * / `refund` freely interchange; `transfer` may never change into, or out of, any of them
 * (decisions §14.3 — server enforces this with 400 `kind_change_not_allowed`).
 */
export function isKindChangeAllowed(from: TxKind, to: TxKind): boolean {
  return (from === 'transfer') === (to === 'transfer');
}
