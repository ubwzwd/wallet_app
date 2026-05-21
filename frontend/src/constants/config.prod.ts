/**
 * AUTO-MANAGED SOURCE: web production build (same-origin via Caddy reverse-proxy).
 * MUST NOT contain the dev backend URL — D-06 grep test enforces zero hits for it in dist/.
 */
export const API_BASE_URL = '/api/v1';

// Storage keys for AsyncStorage
export const STORAGE_KEYS = {
  AUTH_TOKEN: '@wallet_app:auth_token',
  USER_DATA: '@wallet_app:user_data',
} as const;

// App metadata
export const APP_NAME = 'Wallet App';
export const APP_VERSION = '1.0.0';

// Query keys for TanStack Query
export const QUERY_KEYS = {
  USER: 'user',
  FINANCE_SOURCES: 'finance_sources',
  TRANSACTIONS: 'transactions',
  CURRENCIES: 'currencies',
  EXCHANGE_RATES: 'exchange_rates',
} as const;
