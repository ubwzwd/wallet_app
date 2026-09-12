/** `POST /auth/register` and `POST /auth/login` (03 §5.1–§5.2). Both are anonymous. */
import { apiClient } from './client';
import type { AuthResponse, LoginRequest, RegisterRequest } from './types';

export const authApi = {
  register: (b: RegisterRequest): Promise<AuthResponse> =>
    apiClient.post<AuthResponse>('/auth/register', b).then((r) => r.data),

  login: (b: LoginRequest): Promise<AuthResponse> =>
    apiClient.post<AuthResponse>('/auth/login', b).then((r) => r.data),
};
