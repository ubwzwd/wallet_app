import { apiClient } from './client';
import type { Transaction, TransactionCreate, TransactionUpdate } from '@/types/api';

/**
 * Transaction API endpoints
 */

export interface TransactionListParams {
  source_id?: string;
  from_date?: string;
  to_date?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

/**
 * Get all transactions with optional filters
 */
export const getTransactions = async (
  params?: TransactionListParams
): Promise<Transaction[]> => {
  const response = await apiClient.get<Transaction[]>('/transactions', {
    params,
  });
  return response.data;
};

/**
 * Get a single transaction by ID
 */
export const getTransaction = async (id: string): Promise<Transaction> => {
  const response = await apiClient.get<Transaction>(`/transactions/${id}`);
  return response.data;
};

/**
 * Create a new transaction
 */
export const createTransaction = async (data: TransactionCreate): Promise<Transaction> => {
  const response = await apiClient.post<Transaction>('/transactions', data);
  return response.data;
};

/**
 * Update a transaction
 */
export const updateTransaction = async (
  id: string,
  data: TransactionUpdate
): Promise<Transaction> => {
  const response = await apiClient.patch<Transaction>(`/transactions/${id}`, data);
  return response.data;
};

/**
 * Delete a transaction (or paired transfer transactions)
 */
export const deleteTransaction = async (id: string): Promise<void> => {
  await apiClient.delete(`/transactions/${id}`);
};
