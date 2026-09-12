/** `GET /import-format` (03 §5.7) — everything the import guide page renders. */
import { apiClient } from './client';
import type { ImportFormat } from './types';

export const importFormatApi = {
  get: (): Promise<ImportFormat> => apiClient.get<ImportFormat>('/import-format').then((r) => r.data),
};
