import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  apiClient,
  authRefreshClient,
  clearAuthToken,
  getAuthToken,
  getRefreshToken,
  readStoredTokens,
  resetAuthTokenCache,
  setAuthToken,
  setAuthTokens,
  setOnUnauthorized,
  uploadClient,
} from '@/api/client';
import { ApiClientError, isApiClientError, isClientError, normalizeAxiosError } from '@/api/errors';
import { AUTH_TOKEN_KEY, CLIENT_NAME, REFRESH_TOKEN_KEY } from '@/constants/config';
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

  describe('token storage (§14.67)', () => {
    it('setAuthTokens() writes both keys and both in-memory copies', async () => {
      await setAuthTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
      expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('access-1');
      expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1');
      expect(await getAuthToken()).toBe('access-1');
      expect(await getRefreshToken()).toBe('refresh-1');
    });

    it('hydrates the refresh token from storage on first use', async () => {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, 'access-stored');
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-stored');
      resetAuthTokenCache();
      expect(await getRefreshToken()).toBe('refresh-stored');
      expect(await getAuthToken()).toBe('access-stored');
    });

    it('clearAuthToken() forgets both tokens', async () => {
      await setAuthTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
      await clearAuthToken();
      expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
      expect(await getAuthToken()).toBeNull();
      expect(await getRefreshToken()).toBeNull();
    });

    it('setAuthToken() replaces the access token alone', async () => {
      await setAuthTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
      await setAuthToken('access-2');
      expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('access-2');
      expect(await getRefreshToken()).toBe('refresh-1');
    });

    it('readStoredTokens() bypasses the in-memory copies', async () => {
      await setAuthTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
      // Another tab writes storage; this tab's memory is not told.
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, 'access-tab2');
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-tab2');
      expect(await getAuthToken()).toBe('access-1');
      expect(await readStoredTokens()).toEqual({
        accessToken: 'access-tab2',
        refreshToken: 'refresh-tab2',
      });
    });

    it('authRefreshClient carries no interceptors', () => {
      const count = (manager: { handlers?: ReadonlyArray<unknown> }): number =>
        (manager.handlers ?? []).filter(Boolean).length;
      expect(count(authRefreshClient.interceptors.request)).toBe(0);
      expect(count(authRefreshClient.interceptors.response)).toBe(0);
      expect(count(apiClient.interceptors.response)).toBe(1);
      expect(count(uploadClient.interceptors.response)).toBe(1);
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

    it('does not clear storage itself on a 401 — the callback owns that', async () => {
      await setAuthToken('jwt-abc');
      setOnUnauthorized(jest.fn());
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
      await expectApiError(apiClient.get('/me'));
      expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('jwt-abc');
    });

    it('stays quiet when a public 200 is interleaved with concurrent 401s', async () => {
      const cb = jest.fn();
      setOnUnauthorized(cb);
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
      api.mockGet('/config', { registration_open: true });
      api.mockGet('/ledgers', { detail: 'Not authenticated', code: 'unauthorized' }, 401);

      await Promise.allSettled([
        apiClient.get('/me'),
        apiClient.get('/config'),
        apiClient.get('/ledgers'),
      ]);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('re-arms once a new token is stored so a later expiry is reported again', async () => {
      const cb = jest.fn();
      setOnUnauthorized(cb);
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);

      await expectApiError(apiClient.get('/me'));
      await setAuthToken('jwt-fresh');
      await expectApiError(apiClient.get('/me'));
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('stays quiet for a 401 from POST /auth/login — that is invalid_credentials', async () => {
      const cb = jest.fn();
      setOnUnauthorized(cb);
      api.mockPost('/auth/login', { detail: 'Wrong', code: 'invalid_credentials' }, 401);
      const err = await expectApiError(apiClient.post('/auth/login', {}));
      expect(err.code).toBe('invalid_credentials');
      expect(cb).not.toHaveBeenCalled();
    });

    it('stays quiet for a 401 from POST /auth/register', async () => {
      const cb = jest.fn();
      setOnUnauthorized(cb);
      api.mockPost('/auth/register', { detail: 'Nope', code: 'registration_closed' }, 401);
      await expectApiError(apiClient.post('/auth/register', {}));
      expect(cb).not.toHaveBeenCalled();
    });

    it('still reports a 401 from another endpoint after a login 401', async () => {
      const cb = jest.fn();
      setOnUnauthorized(cb);
      api.mockPost('/auth/login', { detail: 'Wrong', code: 'invalid_credentials' }, 401);
      api.mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);

      await expectApiError(apiClient.post('/auth/login', {}));
      await expectApiError(apiClient.get('/me'));
      expect(cb).toHaveBeenCalledTimes(1);
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
        guide_url: '/imports/guide',
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

/** The adapters as axios built them — captured before any harness is installed. */
const PRISTINE_API_ADAPTER = apiClient.defaults.adapter;
const PRISTINE_UPLOAD_ADAPTER = uploadClient.defaults.adapter;

describe('mockApi() is re-entrant (04 §8.2)', () => {
  afterEach(() => {
    apiClient.defaults.adapter = PRISTINE_API_ADAPTER;
    uploadClient.defaults.adapter = PRISTINE_UPLOAD_ADAPTER;
  });

  it('a second mockApi() takes over and restoring it leaves no dead adapter behind', async () => {
    const first = mockApi();
    first.mockGet('/config', { registration_open: false });
    const second = mockApi(); // the first is never restored
    second.mockGet('/config', { registration_open: true });

    // The newest harness serves the request, and its history records it.
    const res = await apiClient.get('/config');
    expect(res.data).toEqual({ registration_open: true });
    expect(second.mock.history.get).toHaveLength(1);
    expect(first.mock.history.get).toHaveLength(0);

    second.restore();
    expect(apiClient.defaults.adapter).toBe(PRISTINE_API_ADAPTER);
    expect(uploadClient.defaults.adapter).toBe(PRISTINE_UPLOAD_ADAPTER);
  });

  it('a harness installed after a nested one still serves uploadClient', async () => {
    mockApi();
    const second = mockApi();
    second.restore();

    const third = mockApi();
    third.mockPost('/ledgers/abc/imports', { ok: true }, 201);
    const res = await uploadClient.post('/ledgers/abc/imports', new FormData());
    expect(res.status).toBe(201);
    third.restore();
  });
});
