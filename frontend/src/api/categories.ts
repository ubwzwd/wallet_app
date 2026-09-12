/** `GET /categories` (03 §5.5) — anonymous, immutable, cached forever by `version`. */
import { apiClient } from './client';
import type { CategoryTree } from './types';

export const categoriesApi = {
  get: (): Promise<CategoryTree> => apiClient.get<CategoryTree>('/categories').then((r) => r.data),
};
