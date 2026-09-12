import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  apiClient,
  clearAuthToken,
  resetAuthTokenCache,
  setAuthToken,
  setOnUnauthorized,
} from '@/api/client';
import { ApiClientError, isApiClientError, isClientError, normalizeAxiosError } from '@/api/errors';
import { AUTH_TOKEN_KEY, CLIENT_NAME } from '@/constants/config';
import { mockApi, type MockApi } from '@/test/mockApi';

/** axios 1.x hands back `AxiosHeaders`; history entries may hold a plain object. */
function header(config: { headers?: unknown }, name: string): string | undefined {
  const h = config.headers as
    | (Record<string, unknown> & { get?: (n: string) => unknown })
    | undefined;
  const value = typeof h?.get === 'function' ? h.get(name) : h?.[name];
  return value === undefined || value === null ? undefined : String(value);
}

async function expectApiError(p: Promise<unknown>): Promise<ApiClientError> {
  try {
    await p;
  } catch (e) {
    expect(isApiClientError(e)).toBe(true);
    return e as ApiClientError;
  }
  throw new Error('expected the request to reject');
}

describe('api client', () => {
  let api: MockApi;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetAuthTokenCache();
    setOnUnauthorized(null);
    api = mockApi();
  });

  afterEach(() => {
    api.restore();
  });

  describe('request interceptor (03 §4.7)', () => {
    it('sends X-Client on every request and no Authorization when anonymous', async () => {
      api.mockGet('/config', { registration_open: true });
      await apiClient.get('/config');
      const sent = api.mock.history.get[0];
      expect(header(sent, 'X-Client')).toBe(CLIENT_NAME);
      expect(header(sent, 'Authorization')).toBeUndefined();
    });

    it('injects the bearer token once one is stored', async () => {
      await setAuthToken('jwt-abc');
      api.mockGet('/me', {});
      await apiClient.get('/me');
      expect(header(api.mock.history.get[0], 'Authorization')).toBe('Bearer jwt-abc');
      expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('jwt-abc');
    });

    it('reads a token left in storage by a previous session', async () => {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, 'jwt-from-storage');
      resetAuthTokenCache();
      api.mockGet('/me', {});
      await apiClient.get('/me');
      expect(header(api.mock.history.get[0], 'Authorization')).toBe('Bearer jwt-from-storage');
    });

    it('stops sending the header after clearAuthToken()', async () => {
      await setAuthToken('jwt-abc');
      await clearAuthToken();
      api.mockGet('/categories', {});
      await apiClient.get('/categories');
      expect(header(api.mock.history.get[0], 'Authorization')).toBeUndefined();
    });
  });

  describe('401 handling (04 §2.1)', () => {
    it('fires onUnauthorized exactly once for two concurrent 401s', async () => {
      const cb = jest.fn();
      setOnUnauthorized(cb);
      api.mockGet('/ledgers', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);

      const results = await Promise.allSettled([apiClient.get('/ledgers'), apiClient.get('/me')]);
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does not touch storage itself — the callback owns that', async () => {
      await setAuthToken('jwt-abc');
      setOnUnauthorized(jest.fn());
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
      await expectApiError(apiClient.get('/me'));
      expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('jwt-abc');
    });

    it('re-arms after a successful response so a later expiry is reported again', async () => {
      const cb = jest.fn();
      setOnUnauthorized(cb);
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
      api.mockGet('/config', { registration_open: true });

      await expectApiError(apiClient.get('/me'));
      await apiClient.get('/config');
      await expectApiError(apiClient.get('/me'));
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('normalises the 401 body itself', async () => {
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
      const err = await expectApiError(apiClient.get('/me'));
      expect(err.status).toBe(401);
      expect(err.code).toBe('unauthorized');
      expect(err.detail).toBe('Not authenticated');
    });
  });

  describe('error normalisation (04 §3.7)', () => {
    it('splits the backend 422 string into fields', async () => {
      api.mockPost(
        '/auth/register',
        {
          detail:
            'body.email: value is not a valid email address: An email address must have an @-sign.; body.password: Field required',
          code: 'validation_error',
        },
        422,
      );
      const err = await expectApiError(apiClient.post('/auth/register', {}));
      expect(err.status).toBe(422);
      expect(err.code).toBe('validation_error');
      expect(err.fields).toEqual({
        email: 'value is not a valid email address: An email address must have an @-sign.',
        password: 'Field required',
      });
      expect(err.detail).not.toContain('[object Object]');
    });

    it('also understands FastAPI native array detail', async () => {
      api.mockPost(
        '/auth/register',
        {
          detail: [
            { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' },
            { loc: ['body', 'password'], msg: 'Field required', type: 'missing' },
          ],
        },
        422,
      );
      const err = await expectApiError(apiClient.post('/auth/register', {}));
      expect(err.code).toBe('validation_error');
      expect(err.fields).toEqual({
        email: 'value is not a valid email address',
        password: 'Field required',
      });
      expect(err.detail).toBe(
        'body.email: value is not a valid email address; body.password: Field required',
      );
      expect(err.detail).not.toContain('[object Object]');
    });

    it('keeps 409 stale_update intact', async () => {
      api.mockPatch(
        '/ledgers/abc',
        { detail: 'The record changed', code: 'stale_update' },
        409,
      );
      const err = await expectApiError(apiClient.patch('/ledgers/abc', {}));
      expect(err.status).toBe(409);
      expect(err.code).toBe('stale_update');
      expect(err.fields).toBeUndefined();
    });

    it('preserves the structured payload of import_format_invalid', async () => {
      const body = {
        detail: "The file's header does not match",
        code: 'import_format_invalid',
        errors: [
          { line: 2, message: 'header mismatch' },
          { line: 17, message: 'expected 11 columns, got 9' },
        ],
      };
      api.mockPost('/ledgers/abc/imports', body, 400);
      const err = await expectApiError(apiClient.post('/ledgers/abc/imports', {}));
      expect(err.code).toBe('import_format_invalid');
      expect(err.payload).toEqual(body);
      expect((err.payload as typeof body).errors[1].line).toBe(17);
    });

    it('preserves skill_outdated version fields', async () => {
      const body = {
        detail: 'Category table changed',
        code: 'skill_outdated',
        current_version: '2026-09-10',
        file_version: '2026-06-01',
        guide_url: '/l/abc/imports/guide',
      };
      api.mockPost('/ledgers/abc/imports', body, 400);
      const err = await expectApiError(apiClient.post('/ledgers/abc/imports', {}));
      expect(err.payload).toEqual(body);
    });

    it('reads Retry-After off a 429', async () => {
      api.mockPost(
        '/auth/login',
        { detail: 'Too many attempts', code: 'login_rate_limited' },
        429,
        { 'Retry-After': '42' },
      );
      const err = await expectApiError(apiClient.post('/auth/login', {}));
      expect(err.status).toBe(429);
      expect(err.code).toBe('login_rate_limited');
      expect(err.retryAfter).toBe(42);
    });

    it('reports transport failures as status 0 / network_error', async () => {
      api.mockNetworkError('/ledgers');
      const err = await expectApiError(apiClient.get('/ledgers'));
      expect(err.status).toBe(0);
      expect(err.code).toBe('network_error');
      expect(isClientError(err)).toBe(false);
    });

    it('falls back to internal_error for a body without a code', async () => {
      api.mockGet('/ledgers', '<html>502 Bad Gateway</html>', 502);
      const err = await expectApiError(apiClient.get('/ledgers'));
      expect(err.status).toBe(502);
      expect(err.code).toBe('internal_error');
      expect(err.detail).not.toContain('[object Object]');
      expect(err.detail.length).toBeGreaterThan(0);
    });
  });

  describe('normalizeAxiosError as a pure function', () => {
    it('passes an ApiClientError straight through', () => {
      const original = new ApiClientError(409, 'stale_update', 'changed');
      expect(normalizeAxiosError(original)).toBe(original);
    });

    it('treats a plain thrown Error as a transport failure', () => {
      const err = normalizeAxiosError(new Error('boom'));
      expect(err.status).toBe(0);
      expect(err.code).toBe('network_error');
      expect(err.detail).toBe('boom');
    });

    it('isClientError is true for 4xx only', () => {
      expect(isClientError(new ApiClientError(404, 'not_found', 'x'))).toBe(true);
      expect(isClientError(new ApiClientError(503, 'fx_unavailable', 'x'))).toBe(false);
      expect(isClientError(new Error('x'))).toBe(false);
    });
  });
});
