/**
 * Application configuration constants
 */

// API Base URL - will point to backend API
// For mobile development: Set EXPO_PUBLIC_API_HOST in .env to your machine's IP
// For web development: Uses localhost by default
const getApiBaseUrl = () => {
  if (!__DEV__) {
    return 'https://api.yourapp.com/api/v1';  // Production
  }
  
  // In development, check for custom API host from environment variable
  // This allows each developer to set their own IP without committing it
  const customHost = process.env.EXPO_PUBLIC_API_HOST;
  if (customHost) {
    return `http://${customHost}:8000/api/v1`;
  }
  
  // Default to localhost for web development
  return 'http://localhost:8000/api/v1';
};

export const API_BASE_URL = getApiBaseUrl();

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

