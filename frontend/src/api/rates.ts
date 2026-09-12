/** `GET /rates/currencies` (03 §5.45) — anonymous; the currency picker's source. */
import { apiClient } from './client';
import type { CurrencyList } from './types';

export const ratesApi = {
  currencies: (): Promise<CurrencyList> =>
    apiClient.get<CurrencyList>('/rates/currencies').then((r) => r.data),
};
