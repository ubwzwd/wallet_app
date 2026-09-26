/**
 * Pure conversions between the account form and the server row (04 §4.9), kept apart from
 * `SourceFormScreen` so the screen stays about layout and flow.
 */
import type { FinanceSource, Money, SourceType, Uuid } from '@/api/types';
import { formatMoney4, parseMoney } from '@/domain/money';
import { openingBalanceForDisplay, openingBalanceForSubmit } from '@/domain/sources';

import { openingBalanceInput, trimTrailingZeros, type SourceFormValues } from './schemas';

/** `'0.0000'` — what an empty opening-balance field submits (decision §3). */
export const ZERO: Money = '0.0000';

/** The form's starting values for an existing account. */
export function valuesOf(source: FinanceSource): SourceFormValues {
  return {
    name: source.name,
    type: source.type,
    default_currency: source.default_currency,
    opening_balance: trimTrailingZeros(
      openingBalanceForDisplay(source.opening_balance ?? ZERO, source.type),
    ),
    share_to: [...(source.shared_to ?? [])],
  };
}

/** The stored (signed) money a raw field value plus a type submit as. */
export function storedValue(raw: string, type: SourceType): Money {
  return openingBalanceForSubmit(openingBalanceInput(raw), type) ?? ZERO;
}

/**
 * A delta in the account's own currency, expressed in my base currency, using the same rate
 * the balance was converted with. Without a rate there is nothing to show, so the preview
 * falls back to "no change" rather than inventing a number.
 */
export function toBase(delta: Money, source: FinanceSource, baseCurrency: string): Money {
  if (source.default_currency === baseCurrency) return delta;
  if (source.balance_rate === null) return ZERO;
  return formatMoney4(BigInt(Math.round(Number(parseMoney(delta)) * Number(source.balance_rate))));
}

export interface ShareDiff {
  share: Uuid[];
  unshare: Uuid[];
}

/**
 * What the edit form has to send after its PATCH (decision §14.62): the ledgers ticked that
 * were not shared before, and the ones un-ticked that were. Only ledgers I still belong to
 * (`known`) are touched — `shared_to` never names any other, but a stale form might.
 */
export function shareDiff(
  before: readonly Uuid[],
  after: readonly Uuid[],
  known: ReadonlySet<Uuid>,
): ShareDiff {
  const was = new Set(before);
  const now = new Set(after);
  return {
    share: after.filter((id) => !was.has(id) && known.has(id)),
    unshare: before.filter((id) => !now.has(id) && known.has(id)),
  };
}
