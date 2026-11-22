/**
 * The `/auth` endpoints (03 §5.1–§5.2, decision §14.67). All but `logoutAll` are anonymous.
 *
 * `refresh` deliberately bypasses the intercepted instances (see `requestRefresh` in
 * `./client`), so its own 401 can never start another refresh.
 */
import { apiClient, requestRefresh } from './client';
import type { AuthResponse, LoginRequest, RefreshRequest, RegisterRequest } from './types';

/** `POST /auth/logout` is best effort on the way out; it must never hold logout up long. */
const LOGOUT_TIMEOUT_MS = 5_000;

export const authApi = {
  register: (b: RegisterRequest): Promise<AuthResponse> =>
    apiClient.post<AuthResponse>('/auth/register', b).then((r) => r.data),

  login: (b: LoginRequest): Promise<AuthResponse> =>
    apiClient.post<AuthResponse>('/auth/login', b).then((r) => r.data),

  /** Trade a refresh token for a new access + refresh token pair. */
  refresh: (b: RefreshRequest): Promise<AuthResponse> => requestRefresh(b),

  /** Revoke the refresh token's whole family. Always 204, even for an unknown token. */
  logout: (b: RefreshRequest): Promise<void> =>
    apiClient
      .post<void>('/auth/logout', b, { timeout: LOGOUT_TIMEOUT_MS })
      .then(() => undefined),

  /** Revoke every refresh token of the signed-in user (needs the access token). */
  logoutAll: (): Promise<void> => apiClient.post<void>('/auth/logout-all').then(() => undefined),
};
