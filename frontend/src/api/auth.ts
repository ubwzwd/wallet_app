import { apiClient } from './client';
import type {
  User,
  LoginRequest,
  RegisterRequest,
  AuthResponse,
} from '@/types/api';

/**
 * Authentication API endpoints
 */

/**
 * Register a new user
 */
export const register = async (data: RegisterRequest): Promise<AuthResponse> => {
  const response = await apiClient.post<AuthResponse>('/auth/register', data);
  return response.data;
};

/**
 * Login with email and password
 */
export const login = async (data: LoginRequest): Promise<AuthResponse> => {
  const response = await apiClient.post<AuthResponse>('/auth/login', data);
  return response.data;
};

/**
 * Get current user profile (requires authentication)
 */
export const getCurrentUser = async (): Promise<User> => {
  const response = await apiClient.get<User>('/auth/me');
  return response.data;
};

/**
 * Logout (client-side only - just clear token)
 */
export const logout = async (): Promise<void> => {
  // Backend doesn't have a logout endpoint (stateless JWT)
  // Just clear local storage
};

