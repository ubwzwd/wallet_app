/**
 * TypeScript types for API requests and responses
 * These should match the backend Pydantic schemas
 */

// User types
export interface User {
  id: string;
  email: string;
  base_currency: string;
  default_source_id: string | null;
  created_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  base_currency: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

// Finance Source types
export interface FinanceSource {
  id: string;
  user_id: string;
  name: string;
  type: string;
  default_currency: string;
  archived: boolean;
  created_at: string;
}

export interface FinanceSourceCreate {
  name: string;
  type: string;
  default_currency: string;
}

export interface FinanceSourceUpdate {
  name?: string;
  archived?: boolean;
}

// Transaction types
export interface Transaction {
  id: string;
  user_id: string;
  source_id: string;
  amount: string;
  currency: string;
  occurred_at: string;
  description: string | null;
  merchant: string | null;
  transfer_pair_id: string | null;
  created_at: string;
  converted_amount: string | null;
  conversion_rate: string | null;
  conversion_date: string | null;
  tags: string[];
}

export interface TransactionCreate {
  source_id?: string;
  amount: number;
  currency: string;
  occurred_at: string;
  description?: string;
  merchant?: string;
  tags?: string[];
  transfer_pair_id?: string;
}

export interface TransactionUpdate {
  amount?: number;
  currency?: string;
  occurred_at?: string;
  description?: string;
  merchant?: string;
  tags?: string[];
}

// Currency types
export interface CurrencyList {
  currencies: Record<string, string>;
}

export interface ExchangeRate {
  base: string;
  date: string;
  rates: Record<string, number>;
}

export interface ConversionRequest {
  amount: number;
  from_currency: string;
  to_currency: string;
}

export interface ConversionResult {
  amount: number;
  from_currency: string;
  to_currency: string;
  converted_amount: number;
  rate: number;
  date: string;
}

// API Error types
export interface ApiError {
  detail: string;
}

