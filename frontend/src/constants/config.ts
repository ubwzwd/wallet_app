/**
 * Build-time configuration (04 §7.2).
 *
 * `EXPO_PUBLIC_API_BASE_URL` is inlined by Expo at bundle time. Production web builds
 * set it to `/api/v1` (same origin behind Caddy); dev and native default to the local
 * backend, because the iOS simulator / Android emulator cannot resolve relative URLs. A
 * `{host}` placeholder is filled in from the page's own host at runtime (dev on a LAN).
 */
const API_BASE_URL_SETTING = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1';

/**
 * A `{host}` placeholder in the setting stands for the host the page was loaded from, so
 * one dev bundle serves the desktop (`localhost`) and a phone on the same Wi-Fi (the LAN
 * IP) alike. Only the web knows its own host; native keeps the literal setting.
 */
export function resolveApiBaseUrl(setting: string, pageHost: string | undefined): string {
  if (!setting.includes('{host}')) return setting;
  return setting.replace('{host}', pageHost && pageHost.length > 0 ? pageHost : 'localhost');
}

export const API_BASE_URL: string = resolveApiBaseUrl(
  API_BASE_URL_SETTING,
  typeof window === 'undefined' ? undefined : window.location?.hostname,
);

/** AsyncStorage key for the JWT — unchanged from v2 so existing sessions survive. */
export const AUTH_TOKEN_KEY = '@wallet_app:auth_token';

/** AsyncStorage key for the opaque refresh token (decision §14.67; localStorage on web). */
export const REFRESH_TOKEN_KEY = '@wallet_app:refresh_token';

/** Value sent as the `X-Client` header on every request (03 §4.7; ≤16 chars). */
export const CLIENT_NAME = 'web';

export const APP_NAME = 'Wallet';
