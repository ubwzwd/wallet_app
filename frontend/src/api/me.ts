/** `GET /me` and `PATCH /me` (03 §5.3–§5.4). `/auth/me` does not exist (decision §14.42). */
import { apiClient } from './client';
import type { User, UserUpdate } from './types';

export const meApi = {
  get: (): Promise<User> => apiClient.get<User>('/me').then((r) => r.data),

  update: (b: UserUpdate): Promise<User> => apiClient.patch<User>('/me', b).then((r) => r.data),
};
