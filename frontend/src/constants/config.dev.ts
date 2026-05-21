/**
 * AUTO-MANAGED SOURCE: dev / native default.
 * Active config.ts is restored to this file after `npm run build:web`.
 * Native dev (iOS simulator / Android emulator) cannot resolve relative paths,
 * so we keep the absolute URL here. (D-03)
 */
export const API_BASE_URL = 'http://localhost:8000/api/v1';

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
