/**
 * axios instances and the shared interceptor pair (04 §3.2, 03 §4.7).
 *
 * The request interceptor injects `Authorization` and `X-Client`; the response
 * interceptor normalises every failure into an `ApiClientError` (§3.7). A 401 first
 * tries to renew the session (decision §14.67): one single-flight `POST /auth/refresh`
 * shared by every concurrent 401, then the failed request is replayed once with the new
 * access token. On that success path the interceptor writes the new token pair to
 * storage itself. Only when the server rejects the refresh token (any 4xx but 408/429)
 * is `AuthContext` told through the registered callback — and clearing the tokens then
 * stays its job (04 §2.1 item 2). A refresh that fails transiently (offline, timeout,
 * 408, 429, 5xx) leaves the tokens alone and rejects the original request with that error.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, {
  AxiosHeaders,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import {
  API_BASE_URL,
  AUTH_TOKEN_KEY,
  CLIENT_NAME,
  REFRESH_TOKEN_KEY,
} from '@/constants/config';

import { ApiClientError, normalizeAxiosError } from './errors';
import { serializeParams } from './params';
import type { AuthResponse, RefreshRequest } from './types';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
  paramsSerializer: { serialize: serializeParams },
});

/**
 * Uploads get their own instance: no default `Content-Type`, so the platform can
 * set the multipart boundary itself, and a longer timeout because import validation
 * is synchronous (decision §5).
 */
export const uploadClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60_000,
  paramsSerializer: { serialize: serializeParams },
});

/**
 * The bare instance `POST /auth/refresh` goes through: no interceptors at all, so a 401
 * from the refresh itself can never recurse into the refresh logic. It carries
 * `X-Client` as a default header instead (03 §4.7) and never an `Authorization` header —
 * the endpoint is public and the access token is presumed expired.
 */
export const authRefreshClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json', 'X-Client': CLIENT_NAME },
});

/**
 * `POST /auth/refresh` (03 §5, decision §14.67) through `authRefreshClient`. Failures are
 * normalised here because that instance has no response interceptor to do it.
 * `authApi.refresh` is this function; it lives here so this module needs no import of
 * `./auth` (which imports this one).
 */
export function requestRefresh(body: RefreshRequest): Promise<AuthResponse> {
  return authRefreshClient.post<AuthResponse>('/auth/refresh', body).then(
    (r) => r.data,
    (err: unknown) => Promise.reject(normalizeAxiosError(err)),
  );
}

// ---------------------------------------------------------------- auth tokens

let cachedToken: string | null = null;
let cachedRefreshToken: string | null = null;
let tokensLoaded = false;

/**
 * Bumped by every write or wipe that does not come from the refresh flow itself
 * (sign-in, logout, a 401 clean-up). A refresh that started under an older generation
 * must not write its result back: it would resurrect a session the user just ended.
 */
let tokenGeneration = 0;

/** Hydrate the in-memory copies of both tokens from storage on first use. */
async function hydrateTokens(): Promise<void> {
  if (tokensLoaded) return;
  const [access, refresh] = await Promise.all([
    AsyncStorage.getItem(AUTH_TOKEN_KEY),
    AsyncStorage.getItem(REFRESH_TOKEN_KEY),
  ]);
  // A write that landed while storage was being read is newer than what was read.
  if (tokensLoaded) return;
  cachedToken = access;
  cachedRefreshToken = refresh;
  tokensLoaded = true;
}

/** Read the access token, hydrating the in-memory copy from storage on first use. */
export async function getAuthToken(): Promise<string | null> {
  await hydrateTokens();
  return cachedToken;
}

/** Read the refresh token, hydrating the in-memory copy from storage on first use. */
export async function getRefreshToken(): Promise<string | null> {
  await hydrateTokens();
  return cachedRefreshToken;
}

export interface AuthTokens {
  accessToken: string;
  /** `null` stores no refresh token (a sign-in reply without one). */
  refreshToken: string | null;
}

/** Persist a freshly issued token pair — both storage keys and the in-memory copies. */
export async function setAuthTokens({ accessToken, refreshToken }: AuthTokens): Promise<void> {
  tokenGeneration += 1;
  cachedToken = accessToken;
  cachedRefreshToken = refreshToken;
  tokensLoaded = true;
  unauthorizedInFlight = false; // a new session can be expired again

  await AsyncStorage.setItem(AUTH_TOKEN_KEY, accessToken);
  if (refreshToken) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * Persist an access token alone, leaving the stored refresh token as it is. Kept for
 * the tests that seed a signed-in session; the app itself always writes the pair
 * through `setAuthTokens()`.
 */
export async function setAuthToken(token: string): Promise<void> {
  tokenGeneration += 1;
  await hydrateTokens();
  cachedToken = token;
  unauthorizedInFlight = false; // a new session can be expired again

  await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
}

/** Forget both tokens. Called by `AuthContext` on logout and on a 401. */
export async function clearAuthToken(): Promise<void> {
  tokenGeneration += 1;
  cachedToken = null;
  cachedRefreshToken = null;
  tokensLoaded = true;
  await Promise.all([
    AsyncStorage.removeItem(AUTH_TOKEN_KEY),
    AsyncStorage.removeItem(REFRESH_TOKEN_KEY),
  ]);
}

/**
 * Read both keys straight from storage, bypassing the in-memory copies — another tab
 * may have refreshed the session since this one last looked (04 §3.2).
 */
export async function readStoredTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> {
  const [accessToken, refreshToken] = await Promise.all([
    AsyncStorage.getItem(AUTH_TOKEN_KEY),
    AsyncStorage.getItem(REFRESH_TOKEN_KEY),
  ]);
  return { accessToken, refreshToken };
}

/**
 * Test seam: forget the in-memory copies (and any refresh in flight) so the next read
 * hits storage again. For `src/test` only — do not import it from `@/api`.
 */
export function resetAuthTokenCache(): void {
  tokenGeneration += 1;
  cachedToken = null;
  cachedRefreshToken = null;
  tokensLoaded = false;
  refreshInFlight = null;
}

// ------------------------------------------------------------- 401 handling

let onUnauthorized: (() => void) | null = null;
let unauthorizedInFlight = false;

/**
 * Register the callback the interceptor fires once a session is really over (a 401 the
 * refresh could not cure). Registering also re-arms the one-shot guard, so a session that
 * signs in again can be expired again.
 *
 * The guard is re-armed only here and when a token is stored — never on a successful
 * response, because a 200 from a public endpoint (/config, /categories) interleaved
 * with concurrent 401s would otherwise fire the callback twice.
 */
export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
  unauthorizedInFlight = false;
}

function fireUnauthorized(): void {
  if (unauthorizedInFlight) return;
  unauthorizedInFlight = true;
  onUnauthorized?.();
}

/** What one attempt at renewing the session came to. */
type RefreshOutcome =
  /** A usable access token is in place (freshly issued, or another tab's). */
  | { kind: 'refreshed'; accessToken: string }
  /** The server rejected the refresh token, or there is none: the session is over. */
  | { kind: 'expired' }
  /** The refresh could not be carried out (offline, timeout, 5xx, 429): try again later. */
  | { kind: 'unavailable'; error: ApiClientError }
  /** The tokens were replaced or wiped (sign-in, logout) while the refresh ran. */
  | { kind: 'superseded' };

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** A stored access token this close to its `exp` is treated as already expired. */
const ADOPT_EXPIRY_MARGIN_MS = 5_000;

/**
 * The `exp` claim of a JWT as epoch milliseconds, or `null` when the token is not a
 * readable JWT. Only used to avoid adopting another tab's token that has itself expired;
 * the signature is the server's business.
 */
function jwtExpiresAtMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || typeof atob !== 'function') return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload !== 'object' || payload === null || !('exp' in payload)) return null;
    const { exp } = payload;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Whether a stored access token is still worth replaying with (unknown expiry: yes). */
function isAdoptable(token: string): boolean {
  const exp = jwtExpiresAtMs(token);
  return exp === null || exp > Date.now() + ADOPT_EXPIRY_MARGIN_MS;
}

/**
 * Whether a refresh failure means "try again later" rather than "the session is over":
 * no response at all (offline, timeout), 408, 429 and 5xx. Any other 4xx — 401 above all,
 * but also a 422 for a mangled stored token — is the server refusing the refresh token.
 */
function isTransientRefreshFailure(error: ApiClientError): boolean {
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

async function runRefresh(failedToken: string | null, generation: number): Promise<RefreshOutcome> {
  try {
    const stored = await readStoredTokens();
    if (generation !== tokenGeneration) return { kind: 'superseded' };

    // Another tab already renewed the session: adopt its pair instead of spending ours —
    // unless that token has itself expired since (both tabs idle past its lifetime); then
    // fall through and spend the stored refresh token, which is the other tab's rotated one.
    if (
      stored.accessToken &&
      stored.accessToken !== failedToken &&
      isAdoptable(stored.accessToken)
    ) {
      cachedToken = stored.accessToken;
      cachedRefreshToken = stored.refreshToken;
      tokensLoaded = true;
      return { kind: 'refreshed', accessToken: stored.accessToken };
    }
    if (!stored.refreshToken) return { kind: 'expired' };

    let res: AuthResponse;
    try {
      res = await requestRefresh({ refresh_token: stored.refreshToken });
    } catch (err) {
      if (generation !== tokenGeneration) return { kind: 'superseded' };
      // requestRefresh already normalises its rejection; this only guards the type.
      const error = err instanceof ApiClientError ? err : normalizeAxiosError(err);
      return isTransientRefreshFailure(error)
        ? { kind: 'unavailable', error }
        : { kind: 'expired' };
    }
    if (generation !== tokenGeneration) return { kind: 'superseded' };

    await setAuthTokens({ accessToken: res.access_token, refreshToken: res.refresh_token });
    return { kind: 'refreshed', accessToken: res.access_token };
  } catch (err) {
    // Storage itself failed: nothing was decided about the session.
    return { kind: 'unavailable', error: normalizeAxiosError(err) };
  }
}

/** Single-flight: every 401 that arrives while a refresh runs waits for that same one. */
function refreshSession(failedToken: string | null): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  const flight = runRefresh(failedToken, tokenGeneration);
  refreshInFlight = flight;
  void flight.finally(() => {
    if (refreshInFlight === flight) refreshInFlight = null;
  });
  return flight;
}

// ------------------------------------------------------------- interceptors

/** A request config that may already have been replayed after a refresh. */
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

async function attachHeaders(
  config: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> {
  config.headers.set('X-Client', CLIENT_NAME);
  const token = await getAuthToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
}

function onFulfilled(response: AxiosResponse): AxiosResponse {
  return response;
}

/**
 * The endpoints whose 401 never means "this session's access token expired":
 *  - `/auth/login` and `/auth/register` answer `invalid_credentials` (03 §5.2/§5.1) —
 *    signing in cannot expire a session that does not exist yet, and firing
 *    `onUnauthorized` there would bounce the user off the very form they are typing into
 *    (04 §2.1);
 *  - `/auth/refresh` and `/auth/logout` are themselves part of the session machinery, so a
 *    401 there must not start another refresh.
 */
const CREDENTIAL_CHECK_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
] as const;

function isCredentialCheck(error: unknown): boolean {
  const config = (error as { config?: { url?: string; method?: string } } | null)?.config;
  const url = config?.url;
  if (typeof url !== 'string') return false;
  if ((config?.method ?? 'get').toLowerCase() !== 'post') return false;
  const path = url.split('?')[0].replace(/\/+$/, '');
  return CREDENTIAL_CHECK_PATHS.some((p) => path === p || path.endsWith(p));
}

/** The access token a failed request actually carried, if any. */
function bearerOf(config: InternalAxiosRequestConfig): string | null {
  const headers = config.headers as
    | (Record<string, unknown> & { get?: (name: string) => unknown })
    | undefined;
  const raw =
    typeof headers?.get === 'function' ? headers.get('Authorization') : headers?.['Authorization'];
  if (typeof raw !== 'string') return null;
  return raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
}

async function onRejected(instance: AxiosInstance, error: unknown): Promise<AxiosResponse> {
  const normalized: ApiClientError = normalizeAxiosError(error);
  if (normalized.status !== 401 || isCredentialCheck(error)) throw normalized;

  const config: RetriableConfig | undefined = axios.isAxiosError(error) ? error.config : undefined;
  if (!config || config._retried === true) {
    // Already replayed once with a fresh token and still refused: the session is over.
    fireUnauthorized();
    throw normalized;
  }

  const outcome = await refreshSession(bearerOf(config));
  switch (outcome.kind) {
    case 'refreshed': {
      // A copy, so the failed attempt's config (and anything holding it) stays as sent.
      const headers = new AxiosHeaders(config.headers);
      headers.set('Authorization', `Bearer ${outcome.accessToken}`);
      const replay: RetriableConfig = { ...config, headers, _retried: true };
      return instance.request(replay);
    }
    case 'expired':
      fireUnauthorized();
      throw normalized;
    case 'unavailable':
      throw outcome.error;
    case 'superseded':
      throw normalized;
  }
}

for (const instance of [apiClient, uploadClient]) {
  instance.interceptors.request.use(attachHeaders);
  instance.interceptors.response.use(onFulfilled, (error: unknown) => onRejected(instance, error));
}
