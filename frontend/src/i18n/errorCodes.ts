/**
 * Backend error-code registry (03 §4.2) and the `{detail, code}` → copy mapping
 * (04 §3.7). The `errors.json` language packs must be an exact, bidirectional match
 * with `BACKEND_ERROR_CODES` plus the two local-only keys below — enforced by
 * `__tests__/locales.test.ts`.
 *
 * `errorMessage` takes `e: unknown` rather than importing `ApiClientError` from
 * `src/api/` (a different task's scope in this wave): it duck-types the
 * `{code: string, detail: string}` shape instead, which is structurally compatible
 * with whatever `src/api/errors.ts` ends up exporting.
 */
import type { TFunction } from 'i18next';

/** Order matches 03 §4.2 exactly — 44 codes. */
export const BACKEND_ERROR_CODES = [
  'validation_error',
  'unauthorized',
  'invalid_credentials',
  'not_found',
  'forbidden',
  'not_owner',
  'registration_closed',
  'email_exists',
  'stale_update',
  'use_transfer_endpoint',
  'ledger_limit_reached',
  'member_limit_reached',
  'already_member',
  'owner_must_transfer',
  'cannot_remove_owner',
  'member_not_found',
  'invite_invalid',
  'invite_expired',
  'invite_rate_limited',
  'login_rate_limited',
  'register_rate_limited',
  'import_rate_limited',
  'source_archived',
  'source_has_transactions',
  'currency_locked',
  'same_source',
  'repayment_target_not_credit',
  'category_invalid',
  'category_kind_mismatch',
  'kind_change_not_allowed',
  'refund_target_invalid',
  'transfer_pair_incomplete',
  'pair_invalid',
  'unpair_invalid',
  'skill_outdated',
  'import_format_invalid',
  'file_too_large',
  'rows_exceed_limit',
  'batch_not_ready',
  'batch_already_committed',
  'rows_uncategorized',
  'rows_all_skipped',
  'fx_unavailable',
  'internal_error',
] as const;

/** Frontend-local keys that are NOT backend codes (04 §3.7): `network_error` for a
 *  response-less request (timeout/offline/CORS), `unknown` as `errorMessage`'s
 *  catch-all fallback key. */
export const LOCAL_ERROR_CODES = ['network_error', 'unknown'] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];
export type LocalErrorCode = (typeof LOCAL_ERROR_CODES)[number];
export type ErrorCode = BackendErrorCode | LocalErrorCode;

interface ApiErrorLike {
  code: string;
  detail: string;
}

function asApiErrorLike(e: unknown): ApiErrorLike | null {
  if (e && typeof e === 'object' && 'code' in e && 'detail' in e) {
    const code = (e as Record<string, unknown>).code;
    const detail = (e as Record<string, unknown>).detail;
    if (typeof code === 'string' && typeof detail === 'string') return { code, detail };
  }
  return null;
}

/**
 * `errors.${code}` with a fallback to `errors.unknown` (04 §3.7). Never throws:
 * anything that isn't `{code, detail}`-shaped (a thrown `Error`, a plain string, a
 * rejected promise's reason, ...) is treated as unknown with its best-effort detail.
 */
export function errorMessage(t: TFunction, e: unknown): string {
  const err = asApiErrorLike(e);
  if (err) {
    return t([`errors:${err.code}`, 'errors:unknown'], { detail: err.detail });
  }
  const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return t('errors:unknown', { detail });
}
