/**
 * Form schemas for the sign-in / register / new-ledger forms (04 §4.1–§4.3).
 *
 * The schemas never hold user-facing copy: every `message` is a **key** of the
 * `validation` namespace, which the screen maps with `t()` (04 §5.2 — no literal
 * strings outside the language packs). `validationMessage()` is that mapping,
 * including the one key that interpolates (`max_length`).
 */
import type { TFunction } from 'i18next';
import { z } from 'zod';

/** `x@y.z` — deliberately loose; the server is the authority (04 §4.1). */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 3 uppercase letters, matching `GET /rates/currencies` codes. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Server-side `min_length` for a password (03 §5.1). */
export const PASSWORD_MIN_LENGTH = 8;

/** Ledger names share the account-name limit (decision §14.13). */
export const LEDGER_NAME_MAX_LENGTH = 100;

const email = z
  .string()
  .trim()
  .min(1, 'required')
  .regex(EMAIL_PATTERN, 'email_invalid');

const currency = z.string().trim().regex(CURRENCY_PATTERN, 'currency_invalid');

/** 04 §4.1: email shape + non-empty password. Length rules belong to the server. */
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'required'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

/** 04 §4.2 / decision §14.54: email, password, confirmation, default currency — no display name. */
export const registerSchema = z
  .object({
    email,
    password: z.string().min(PASSWORD_MIN_LENGTH, 'password_min_length'),
    confirm_password: z.string().min(1, 'required'),
    base_currency: currency,
  })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirm_password'],
        message: 'password_mismatch',
      });
    }
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

/** 04 §4.3: 1–100 characters plus the base currency (defaults to `user.base_currency`). */
export const ledgerCreateSchema = z.object({
  name: z.string().trim().min(1, 'required').max(LEDGER_NAME_MAX_LENGTH, 'max_length'),
  base_currency: currency,
});

export type LedgerCreateFormValues = z.infer<typeof ledgerCreateSchema>;

/**
 * Turn a schema `message` (a `validation` key) into copy. Unknown keys fall back to
 * `validation:required` rather than leaking a raw key onto the screen.
 */
export function validationMessage(t: TFunction, key: string | undefined): string | null {
  if (!key) return null;
  return t([`validation:${key}`, 'validation:required'], { max: LEDGER_NAME_MAX_LENGTH });
}
