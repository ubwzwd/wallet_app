import { apiClient } from './client';
import type { CurrencyList } from '@/types/api';

/**
 * Currency rates API endpoints
 */

/**
 * Get list of all supported currencies from the backend.
 * Returns a map of currency code to full name.
 * Example: { currencies: { "USD": "United States Dollar", "EUR": "Euro", ... } }
 */
export const getCurrencies = async (): Promise<CurrencyList> => {
  const response = await apiClient.get<CurrencyList>('/rates/currencies');
  return response.data;
};
