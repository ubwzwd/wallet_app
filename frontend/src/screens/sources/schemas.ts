/**
 * The account form's schema (04 §4.9).
 *
 * Like every other form in the app, the schema carries **keys**, never copy: a `message`
 * is either a `validation` namespace key (mapped by `validationMessage`) or one of the
 * two local keys below, which live in the `source` namespace because they are specific to
 * this form (04 §5.2 — no literal strings outside the language packs).
 */
import type { TFunction } from 'i18next';
import { z } from 'zod';

import type { Money, SourceType } from '@/api/types';
import { normalizeAmountInput } from '@/domain/money';
import { validationMessage } from '@/screens/auth/schemas';

/** Server-side `max_length` for an account name (03 §5.11, decision §14.13). */
export const SOURCE_NAME_MAX_LENGTH = 100;

/** The four account types, in the order §14.48 froze them. There is no `savings`. */
export const SOURCE_TYPES: readonly SourceType[] = ['checking', 'credit', 'cash', 'other'];

/** Local `source:form.*` message keys (not `validation` ones). */
const OPENING_BALANCE_INVALID = 'form.opening_balance_invalid';

export const sourceFormSchema = z.object({
  name: z.string().trim().min(1, 'required').max(SOURCE_NAME_MAX_LENGTH, 'max_length'),
  type: z.enum(['checking', 'credit', 'cash', 'other']),
  // 3 uppercase letters; ignored entirely when editing (the currency is locked, §14.50).
  default_currency: z.string().trim().regex(/^[A-Z]{3}$/, 'currency_invalid'),
  // Free text while typing; an empty field means "0" (decision §3: the default is 0).
  opening_balance: z
    .string()
    .refine(
      (raw) => raw.trim() === '' || normalizeAmountInput(raw) !== null,
      OPENING_BALANCE_INVALID,
    ),
  // The ledgers this account is shared into (decision §14.62). Not validated: the chips
  // only ever offer ledgers I belong to, and the server re-checks every id.
  share_to: z.array(z.string()),
});

export type SourceFormValues = z.infer<typeof sourceFormSchema>;

/**
 * Map a schema `message` onto copy. The two form-local keys resolve inside the `source`
 * namespace; everything else falls through to the shared `validation` mapping.
 */
export function sourceValidationMessage(t: TFunction, key: string | undefined): string | null {
  if (!key) return null;
  if (key === OPENING_BALANCE_INVALID) return t(`source:${key}`);
  return validationMessage(t, key);
}

/** `''` counts as zero, so a cleared field submits the documented default (decision §3). */
export function openingBalanceInput(raw: string): string {
  return raw.trim() === '' ? '0' : raw;
}

/** `'3204.0000'` → `'3204'` for a form field: trailing zeros only get in the user's way. */
export function trimTrailingZeros(amount: Money): string {
  if (!amount.includes('.')) return amount;
  const trimmed = amount.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}
