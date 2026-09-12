/**
 * The one form model behind all four kinds (04 §4.6, §4.6.5) and the zod schema that
 * validates it.
 *
 * Like `src/screens/auth/schemas.ts`, a schema `message` is a **key** of the `validation`
 * namespace — never user-facing copy; `txValidationMessage()` maps it. The table in
 * §4.6.5 is implemented in `superRefine`, because almost every rule is conditional on
 * `kind` (and, for transfers, on the "the other side isn't in this app" checkbox).
 */
import type { TFunction } from 'i18next';
import { z } from 'zod';

import type { IsoDate, Money, TransferRole, TransferSubtype, TxKind } from '@/api/types';
import { isValidIsoDate, maxAllowedDate } from '@/domain/dates';
import { applySign } from '@/domain/kinds';
import { cmpMoney, decimalPlaces, isPositiveMoney, normalizeAmountInput } from '@/domain/money';

/** Server-side limits (decisions §1.4, §10). */
export const NOTE_MAX_LENGTH = 500;
export const MERCHANT_MAX_LENGTH = 200;
export const COUNTERPARTY_MAX_LENGTH = 100;

/** 3 uppercase letters, matching `GET /rates/currencies` codes. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Every control on the page, whatever the tab. Fields that belong to one kind only are
 * still present (and simply ignored) on the others, so switching tabs keeps what the user
 * already typed (04 §4.6).
 */
export interface TxFormValues {
  kind: TxKind;
  /** Expense/income/refund: the account. Transfer: the *out* leg (or the only leg). */
  source_id: string;
  /** Raw keyboard input — normalised only at submit time. */
  amount: string;
  currency: string;
  occurred_at: string;
  merchant: string;
  note: string;
  category_l1: string | null;
  category_l2: string | null;
  refund_of: string | null;
  // ---- transfer only (04 §4.6.4)
  subtype: TransferSubtype;
  /** "The other side isn't in this app" — one leg instead of two (decision §1.2). */
  external: boolean;
  /** Single leg only: is this leg money going out or coming in. */
  direction: TransferRole;
  /** Two legs only: the receiving account. */
  to_source_id: string;
  /** Single leg only. */
  counterparty: string;
  /** Two legs, cross-currency only; mirrors `amount` while both sides share a currency. */
  amount_in: string;
  currency_in: string;
}

/** The blank form, before any URL parameter, preference or prefill is applied. */
export function emptyTxFormValues(today: IsoDate): TxFormValues {
  return {
    kind: 'expense',
    source_id: '',
    amount: '',
    currency: '',
    occurred_at: today,
    merchant: '',
    note: '',
    category_l1: null,
    category_l2: null,
    refund_of: null,
    subtype: 'plain',
    external: false,
    direction: 'out',
    to_source_id: '',
    counterparty: '',
    amount_in: '',
    currency_in: '',
  };
}

/**
 * `null` when `raw` is a usable positive amount, otherwise the `validation` key to show.
 * Shared by the two amount boxes of a cross-currency transfer.
 */
export function amountIssue(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 'required';
  if (decimalPlaces(trimmed.replace(/[,\s]/g, '')) > 4) return 'amount_decimal_max';
  const money = normalizeAmountInput(trimmed);
  if (money === null) return 'amount_invalid';
  if (!isPositiveMoney(money)) return 'amount_positive';
  return null;
}

function addIssue(ctx: z.RefinementCtx, path: keyof TxFormValues, message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
}

/** 04 §4.6.5's table, one `if` per row. */
export const txFormSchema = z
  .object({
    kind: z.enum(['expense', 'income', 'refund', 'transfer']),
    source_id: z.string(),
    amount: z.string(),
    currency: z.string(),
    occurred_at: z.string(),
    merchant: z.string(),
    note: z.string(),
    category_l1: z.string().nullable(),
    category_l2: z.string().nullable(),
    refund_of: z.string().nullable(),
    subtype: z.enum(['plain', 'repayment']),
    external: z.boolean(),
    direction: z.enum(['out', 'in']),
    to_source_id: z.string(),
    counterparty: z.string(),
    amount_in: z.string(),
    currency_in: z.string(),
  })
  .superRefine((v, ctx) => {
    const isTransfer = v.kind === 'transfer';
    const twoLegs = isTransfer && !v.external;

    if (v.source_id.trim() === '') addIssue(ctx, 'source_id', 'required');

    const amountKey = amountIssue(v.amount);
    if (amountKey) addIssue(ctx, 'amount', amountKey);

    if (!CURRENCY_PATTERN.test(v.currency)) addIssue(ctx, 'currency', 'currency_invalid');

    if (v.occurred_at.trim() === '') addIssue(ctx, 'occurred_at', 'required');
    else if (!isValidIsoDate(v.occurred_at)) addIssue(ctx, 'occurred_at', 'date_invalid');
    else if (v.occurred_at > maxAllowedDate()) addIssue(ctx, 'occurred_at', 'date_not_future');

    if (v.note.length > NOTE_MAX_LENGTH) addIssue(ctx, 'note', 'note_max_length');

    if (!isTransfer) {
      if (v.merchant.length > MERCHANT_MAX_LENGTH) {
        addIssue(ctx, 'merchant', 'merchant_max_length');
      }
      if (v.category_l1 === null || v.category_l1 === '') {
        addIssue(ctx, 'category_l1', 'category_l1_required');
      }
    }

    if (isTransfer && v.external && v.counterparty.length > COUNTERPARTY_MAX_LENGTH) {
      addIssue(ctx, 'counterparty', 'counterparty_max_length');
    }

    if (twoLegs) {
      if (v.to_source_id.trim() === '') addIssue(ctx, 'to_source_id', 'required');
      else if (v.to_source_id === v.source_id) {
        addIssue(ctx, 'to_source_id', 'transfer_same_source');
      }
      // One amount box means one amount: the second group is only filled in — and only
      // validated — while it is actually on screen (decision §14.52 A11).
      if (showsSecondLeg(v)) {
        if (!CURRENCY_PATTERN.test(v.currency_in)) {
          addIssue(ctx, 'currency_in', 'currency_invalid');
        }
        const inKey = amountIssue(v.amount_in);
        if (inKey) addIssue(ctx, 'amount_in', inKey);
      }
    }
  });

/**
 * The prefix `applyFieldErrors` puts in front of a message that is already copy — a 422's
 * own prose from the server, which must never be looked up as a `validation` key.
 */
export const RAW_MESSAGE_PREFIX = 'raw:';

/** Mark server-authored copy so `txValidationMessage` shows it verbatim. */
export function rawMessage(text: string): string {
  return `${RAW_MESSAGE_PREFIX}${text}`;
}

/**
 * Turn a schema `message` into copy. Unknown keys fall back to `validation:required`
 * rather than leaking a raw key onto the screen; a `raw:`-prefixed message is copy already
 * (the server said it) and is shown as it stands.
 */
export function txValidationMessage(t: TFunction, key: string | undefined): string | null {
  if (!key) return null;
  if (key.startsWith(RAW_MESSAGE_PREFIX)) return key.slice(RAW_MESSAGE_PREFIX.length);
  return t([`validation:${key}`, 'validation:required'], {
    note: NOTE_MAX_LENGTH,
    merchant: MERCHANT_MAX_LENGTH,
    counterparty: COUNTERPARTY_MAX_LENGTH,
  });
}

/** The signed amount a single-entry transaction is submitted with (decision §1). */
export function signedAmount(values: TxFormValues): Money {
  const abs = normalizeAmountInput(values.amount) ?? '0.0000';
  const role = values.kind === 'transfer' && values.external ? values.direction : undefined;
  return applySign(abs, values.kind, role);
}

/** `''` → `null`: the API distinguishes "cleared" from "never mentioned". */
export function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Whether the second amount / currency group is open (04 §4.6.4).
 *
 * Two legs share one amount box only while they really are the same amount in the same
 * currency. A pair built by `POST .../pair` compares neither (decision §14.53a), so an
 * existing 1000 → 995 CNY pair has to keep both boxes: collapsing it would mirror the
 * out leg onto the in leg the first time anyone pressed 保存.
 */
export function showsSecondLeg(values: TxFormValues): boolean {
  if (values.kind !== 'transfer' || values.external) return false;
  if (values.currency_in !== '' && values.currency_in !== values.currency) return true;
  const out = normalizeAmountInput(values.amount);
  const into = normalizeAmountInput(values.amount_in);
  return out !== null && into !== null && cmpMoney(out, into) !== 0;
}
