/** `GET /config` (03 §5.6) — anonymous; the register page reads it on mount. */
import { apiClient } from './client';
import type { AppConfig } from './types';

export const configApi = {
  get: (): Promise<AppConfig> => apiClient.get<AppConfig>('/config').then((r) => r.data),
};
