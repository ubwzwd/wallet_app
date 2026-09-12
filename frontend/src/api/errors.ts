/**
 * Error normalisation for the API layer (04 §3.7).
 *
 * Every failure — HTTP or transport — becomes an `ApiClientError` carrying the
 * status, the backend `code` (03 §4.2) and the raw `detail`. Pages never show
 * `detail` directly; they look the `code` up in the i18n `errors.*` namespace.
 */
import type { AxiosError, AxiosResponse } from 'axios';

import type { ApiError } from './types';

/** Code used when the request never reached the server (timeout / offline / CORS). */
export const NETWORK_ERROR_CODE = 'network_error';
/** Fallback code for non-2xx responses that carry no `{detail, code}` body. */
export const INTERNAL_ERROR_CODE = 'internal_error';
/** Code the backend uses for request-validation failures (422, and 400 in a few places). */
export const VALIDATION_ERROR_CODE = 'validation_error';

export class ApiClientError extends Error {
  /** HTTP status; `0` means the request never got a response. */
  readonly status: number;
  /** snake_case code from 03 §4.2, or `network_error` / `internal_error`. */
  readonly code: string;
  /** Server-side text. For logging and the "details" disclosure only. */
  readonly detail: string;
  /** 422 only: field name (last `loc` segment) → message, ready to feed a form. */
  readonly fields?: Record<string, string>;
  /** The whole response body, so structured errors (e.g. `ImportFileError`) survive. */
  readonly payload?: unknown;
  /** 429 only: seconds from the `Retry-After` response header. */
  readonly retryAfter?: number;

  constructor(
    status: number,
    code: string,
    detail: string,
    extra?: {
      fields?: Record<string, string>;
      payload?: unknown;
      retryAfter?: number;
    },
  ) {
    super(detail);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    if (extra?.fields) this.fields = extra.fields;
    if (extra?.payload !== undefined) this.payload = extra.payload;
    if (extra?.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
    // Keep `instanceof` working after TypeScript's ES5 class downlevelling.
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }
}

export function isApiClientError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}

/** True for 4xx responses — used by the retry policy, which must not retry those. */
export function isClientError(e: unknown): boolean {
  return isApiClientError(e) && e.status >= 400 && e.status < 500;
}

/** A single entry of FastAPI's native 422 body. */
interface RawValidationItem {
  loc?: unknown;
  msg?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** `['body', 'email']` → `'email'`; falls back to the joined path when empty. */
function fieldNameFromLoc(loc: string): string {
  const parts = loc.split('.').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : loc;
}

/** Render FastAPI's native array form as `"body.email: msg; body.password: msg"`. */
function renderValidationItems(items: RawValidationItem[]): string {
  return items
    .map((item) => {
      const loc = Array.isArray(item.loc) ? item.loc.map((p) => String(p)).join('.') : '';
      const msg = typeof item.msg === 'string' ? item.msg : String(item.msg ?? '');
      return loc ? `${loc}: ${msg}` : msg;
    })
    .filter((s) => s.length > 0)
    .join('; ');
}

function fieldsFromValidationItems(items: RawValidationItem[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const item of items) {
    if (!Array.isArray(item.loc) || item.loc.length === 0) continue;
    const name = String(item.loc[item.loc.length - 1]);
    const msg = typeof item.msg === 'string' ? item.msg : String(item.msg ?? '');
    if (name && !(name in fields)) fields[name] = msg;
  }
  return fields;
}

/**
 * Parse the backend's flattened 422 text: `"body.email: not an email; body.password: Field required"`.
 *
 * The real backend sends a string here, not FastAPI's array (03 §4.1 vs 04 §3.7);
 * both shapes are handled so the client keeps working if that ever changes back.
 */
export function parseValidationDetail(detail: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const chunk of detail.split('; ')) {
    const sep = chunk.indexOf(': ');
    if (sep <= 0) continue;
    const loc = chunk.slice(0, sep);
    // A real `loc` is a dotted path — anything with whitespace is prose, not a location.
    if (/\s/.test(loc)) continue;
    const name = fieldNameFromLoc(loc);
    const msg = chunk.slice(sep + 2).trim();
    if (name && msg && !(name in fields)) fields[name] = msg;
  }
  return fields;
}

/** Never let an object reach `detail` as `"[object Object]"` (the v2 bug, 04 §8.2). */
function stringifyDetail(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value)) {
    const rendered = renderValidationItems(value as RawValidationItem[]);
    if (rendered) return rendered;
  }
  if (isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseRetryAfter(response: AxiosResponse): number | undefined {
  const headers = response.headers as
    | (Record<string, unknown> & { get?: (name: string) => unknown })
    | undefined;
  const raw =
    typeof headers?.get === 'function'
      ? headers.get('retry-after')
      : (headers?.['retry-after'] ?? headers?.['Retry-After']);
  if (raw === undefined || raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function fromResponse(response: AxiosResponse): ApiClientError {
  const status = response.status;
  const body: unknown = response.data;
  const statusText = response.statusText || `HTTP ${status}`;
  const retryAfter = parseRetryAfter(response);

  const rawDetail = isRecord(body) ? (body as Partial<ApiError>).detail : undefined;
  const rawCode = isRecord(body) ? (body as Partial<ApiError>).code : undefined;

  const detail = stringifyDetail(rawDetail, statusText);
  let code =
    typeof rawCode === 'string' && rawCode.length > 0
      ? rawCode
      : status === 422
        ? VALIDATION_ERROR_CODE
        : INTERNAL_ERROR_CODE;

  let fields: Record<string, string> | undefined;
  if (status === 422 || code === VALIDATION_ERROR_CODE) {
    code = VALIDATION_ERROR_CODE;
    fields = Array.isArray(rawDetail)
      ? fieldsFromValidationItems(rawDetail as RawValidationItem[])
      : parseValidationDetail(detail);
    if (Object.keys(fields).length === 0) fields = undefined;
  }

  return new ApiClientError(status, code, detail, {
    fields,
    payload: body,
    retryAfter,
  });
}

function isAxiosLikeError(e: unknown): e is AxiosError {
  return isRecord(e) && (e as { isAxiosError?: boolean }).isAxiosError === true;
}

/**
 * Turn anything axios rejects with into an `ApiClientError`. Pure: unit-testable
 * without a network or an interceptor.
 */
export function normalizeAxiosError(err: unknown): ApiClientError {
  if (isApiClientError(err)) return err;

  if (isAxiosLikeError(err)) {
    if (err.response) return fromResponse(err.response);
    const detail = err.message || 'Network request failed';
    return new ApiClientError(0, NETWORK_ERROR_CODE, detail);
  }

  const detail = isRecord(err) && typeof err.message === 'string' ? err.message : String(err);
  return new ApiClientError(0, NETWORK_ERROR_CODE, detail);
}
