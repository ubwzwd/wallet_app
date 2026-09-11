/**
 * Build-time configuration (04 §7.2).
 *
 * `EXPO_PUBLIC_API_BASE_URL` is inlined by Expo at bundle time. Production web builds
 * set it to `/api/v1` (same origin behind Caddy); dev and native default to the local
 * backend, because the iOS simulator / Android emulator cannot resolve relative URLs.
 */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1';

/** AsyncStorage key for the JWT — unchanged from v2 so existing sessions survive. */
export const AUTH_TOKEN_KEY = '@wallet_app:auth_token';

/** Value sent as the `X-Client` header on every request (03 §4.7; ≤16 chars). */
export const CLIENT_NAME = 'web';

export const APP_NAME = 'Wallet';
