/**
 * Credit-card opening-balance sign convention (04 §4.9, decision §14.52 A13): the user always
 * types a positive "how much I owe" number for a credit account; the server stores it negative
 * like every other liability amount. Every other account type stores what the user typed.
 */
import type { Money, SourceType } from '@/api/types';
import { formatMoney4, normalizeAmountInput, parseMoney } from './money';

/** User input (e.g. `'3204'`) → the signed `Money` to submit, or `null` if not a valid amount.
 *  For `credit`, the magnitude the user typed is stored negative regardless of the sign they
 *  typed it with. */
export function openingBalanceForSubmit(input: string, type: SourceType): Money | null {
  const normalized = normalizeAmountInput(input);
  if (normalized === null) return null;
  if (type !== 'credit') return normalized;
  const v = parseMoney(normalized);
  const magnitude = v < 0n ? -v : v;
  return formatMoney4(-magnitude);
}

/** Stored `Money` → what to show in the form field. For `credit` this is the positive "amount
 *  owed" (the inverse of `openingBalanceForSubmit`); every other type is shown as stored. */
export function openingBalanceForDisplay(stored: Money, type: SourceType): Money {
  if (type !== 'credit') return stored;
  const v = parseMoney(stored);
  const magnitude = v < 0n ? -v : v;
  return formatMoney4(magnitude);
}

/**
 * Convert a stored opening-balance value when the account `type` changes. The storage sign
 * convention only differs between `credit` and non-credit types, so the value is negated
 * exactly when crossing that boundary (either direction) and left untouched otherwise.
 */
export function convertOpeningBalanceOnTypeChange(
  value: Money,
  from: SourceType,
  to: SourceType
): Money {
  const crossesCreditBoundary = (from === 'credit') !== (to === 'credit');
  if (!crossesCreditBoundary) return value;
  return formatMoney4(-parseMoney(value));
}
