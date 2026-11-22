/** Public surface of the API layer (04 §3.1). Nothing here imports TanStack Query. */
export * from './types';
export {
  ApiClientError,
  INTERNAL_ERROR_CODE,
  NETWORK_ERROR_CODE,
  VALIDATION_ERROR_CODE,
  isApiClientError,
  isClientError,
  normalizeAxiosError,
  parseValidationDetail,
} from './errors';
export {
  apiClient,
  uploadClient,
  clearAuthToken,
  getAuthToken,
  getRefreshToken,
  readStoredTokens,
  setAuthToken,
  setAuthTokens,
  setOnUnauthorized,
  type AuthTokens,
} from './client';
export { normalizeParams, serializeParams, toSearchParams } from './params';

export { authApi } from './auth';
export { meApi } from './me';
export { configApi } from './config';
export { categoriesApi } from './categories';
export { importFormatApi } from './importFormat';
export { ledgersApi } from './ledgers';
export { sourcesApi } from './sources';
export { txApi } from './transactions';
export { statsApi } from './stats';
export { importsApi, type UploadProgressHandler } from './imports';
export { ratesApi } from './rates';
