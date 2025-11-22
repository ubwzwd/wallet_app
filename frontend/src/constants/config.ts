/**
 * Application configuration constants
 */

// API Base URL - will point to backend API
// 在移动设备上开发时，需要使用电脑的实际 IP 地址而不是 localhost
export const API_BASE_URL = __DEV__ 
  ? 'http://192.168.1.72:8000/api/v1'  // Local development (使用电脑IP，支持手机访问)
  : 'https://api.yourapp.com/api/v1';  // Production

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

