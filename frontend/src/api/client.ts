/**
 * axios instances and the shared interceptor pair (04 §3.2, 03 §4.7).
 *
 * The request interceptor injects `Authorization` and `X-Client`; the response
 * interceptor normalises every failure into an `ApiClientError` (§3.7) and tells
 * `AuthContext` about 401s through a registered callback. It never writes storage
 * itself — clearing the token is `AuthContext`'s job (04 §2.1 item 2).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { API_BASE_URL, AUTH_TOKEN_KEY, CLIENT_NAME } from '@/constants/config';

import { ApiClientError, normalizeAxiosError } from './errors';
import { serializeParams } from './params';

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

// ---------------------------------------------------------------- auth token

let cachedToken: string | null = null;
let tokenLoaded = false;

/** Read the token, hydrating the in-memory copy from storage on first use. */
export async function getAuthToken(): Promise<string | null> {
  if (!tokenLoaded) {
    cachedToken = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    tokenLoaded = true;
  }
  return cachedToken;
}

/** Persist a freshly issued token. Called by `AuthContext`, never by an interceptor. */
export async function setAuthToken(token: string): Promise<void> {
  cachedToken = token;
  tokenLoaded = true;
  await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
}

/** Forget the token. Called by `AuthContext` on logout and on a 401. */
export async function clearAuthToken(): Promise<void> {
  cachedToken = null;
  tokenLoaded = true;
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
}

/** Test seam: forget the in-memory copy so the next read hits storage again. */
export function resetAuthTokenCache(): void {
  cachedToken = null;
  tokenLoaded = false;
}

// ------------------------------------------------------------- 401 handling

let onUnauthorized: (() => void) | null = null;
let unauthorizedInFlight = false;

/**
 * Register the callback the interceptor fires on a 401. Registering also re-arms
 * the one-shot guard, so a session that signs in again can be expired again.
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

// ------------------------------------------------------------- interceptors

async function attachHeaders(
  config: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> {
  config.headers.set('X-Client', CLIENT_NAME);
  const token = await getAuthToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
}

function onFulfilled(response: AxiosResponse): AxiosResponse {
  // A successful round trip means the session works again: re-arm the 401 guard.
  unauthorizedInFlight = false;
  return response;
}

function onRejected(error: unknown): Promise<never> {
  const normalized: ApiClientError = normalizeAxiosError(error);
  if (normalized.status === 401) fireUnauthorized();
  return Promise.reject(normalized);
}

for (const instance of [apiClient, uploadClient]) {
  instance.interceptors.request.use(attachHeaders);
  instance.interceptors.response.use(onFulfilled, onRejected);
}
