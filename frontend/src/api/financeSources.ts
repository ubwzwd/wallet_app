import { apiClient } from './client';
import type {
  FinanceSource,
  FinanceSourceCreate,
  FinanceSourceUpdate,
} from '@/types/api';

/**
 * Finance Source API endpoints
 */

/**
 * Get all finance sources for the current user
 */
export const getFinanceSources = async (includeArchived = false): Promise<FinanceSource[]> => {
  const response = await apiClient.get<FinanceSource[]>('/finance-sources', {
    params: { include_archived: includeArchived },
  });
  return response.data;
};

/**
 * Get a single finance source by ID
 */
export const getFinanceSource = async (id: string): Promise<FinanceSource> => {
  const response = await apiClient.get<FinanceSource>(`/finance-sources/${id}`);
  return response.data;
};

/**
 * Create a new finance source
 */
export const createFinanceSource = async (data: FinanceSourceCreate): Promise<FinanceSource> => {
  const response = await apiClient.post<FinanceSource>('/finance-sources', data);
  return response.data;
};

/**
 * Update a finance source
 */
export const updateFinanceSource = async (
  id: string,
  data: FinanceSourceUpdate
): Promise<FinanceSource> => {
  const response = await apiClient.patch<FinanceSource>(`/finance-sources/${id}`, data);
  return response.data;
};

