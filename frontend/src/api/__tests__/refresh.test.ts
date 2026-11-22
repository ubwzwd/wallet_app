/**
 * Transparent session renewal in the response interceptor (decision §14.67, 04 §3.2):
 * a 401 triggers one single-flight `POST /auth/refresh`, the failed request is replayed
 * once with the new access token, and only a refused refresh ends the session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AxiosRequestConfig } from 'axios';

import {
  apiClient,
  clearAuthToken,
  getAuthToken,
  getRefreshToken,
  resetAuthTokenCache,
  setAuthToken,
  setAuthTokens,
  setOnUnauthorized,
  uploadClient,
} from '@/api/client';
import { ApiClientError, isApiClientError } from '@/api/errors';
import { AUTH_TOKEN_KEY, CLIENT_NAME, REFRESH_TOKEN_KEY } from '@/constants/config';
import { apiUrl, mockApi, type MockApi } from '@/test/mockApi';

const UNAUTHORIZED = { detail: 'Not authenticated', code: 'unauthorized' };
const REFRESH_INVALID = { detail: 'Refresh token is invalid or expired', code: 'refresh_invalid' };

function header(config: { headers?: unknown }, name: string): string | undefined {
  const h = config.headers as
    | (Record<string, unknown> & { get?: (n: string) => unknown })
    | undefined;
  const value = typeof h?.get === 'function' ? h.get(name) : h?.[name];
  return value === undefined || value === null ? undefined : String(value);
}

function issued(access: string, refresh: string): Record<string, unknown> {
  return { access_token: access, token_type: 'bearer', refresh_token: refresh, expires_in: 1800 };
}

/** A JWT-shaped token (unsigned) carrying `claims` as its payload. */
function jwt(claims: Record<string, unknown>): string {
  const b64url = (v: unknown): string =>
    btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.sig`;
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

/** Let pending promise callbacks and mock-adapter timers run. */
async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('401 → refresh → replay (§14.67)', () => {
  let api: MockApi;
  let onUnauthorized: jest.Mock<void, []>;

  /** `GET path` answers 200 for `Bearer <good>` and 401 for anything else. */
  function acceptOnly(path: string, good: string, body: unknown = { ok: true }): void {
    api.mock.onGet(apiUrl(path)).reply((config: AxiosRequestConfig) =>
      header(config, 'Authorization') === `Bearer ${good}` ? [200, body] : [401, UNAUTHORIZED],
    );
  }

  function refreshCalls(): AxiosRequestConfig[] {
    return api.mock.history.post.filter((c) => c.url === '/auth/refresh');
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetAuthTokenCache();
    api = mockApi();
    onUnauthorized = jest.fn();
    setOnUnauthorized(onUnauthorized);
  });

  afterEach(() => {
    api.restore();
  });

  it('renews the session and replays the request; the caller only sees the 200', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    acceptOnly('/ledgers', 'access-new', { items: ['x'] });
    api.mockPost('/auth/refresh', issued('access-new', 'refresh-new'));

    const res = await apiClient.get('/ledgers');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ items: ['x'] });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('access-new');
    expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-new');
    expect(await getAuthToken()).toBe('access-new');
    expect(await getRefreshToken()).toBe('refresh-new');

    // The original request went out twice: once with the old token, once replayed.
    const sent = api.mock.history.get.map((c) => header(c, 'Authorization'));
    expect(sent).toEqual(['Bearer access-old', 'Bearer access-new']);

    // The refresh spent the stored refresh token, through the interceptor-free instance:
    // it carries X-Client but no Authorization header.
    const [refresh] = refreshCalls();
    expect(JSON.parse(String(refresh.data))).toEqual({ refresh_token: 'refresh-old' });
    expect(header(refresh, 'X-Client')).toBe(CLIENT_NAME);
    expect(header(refresh, 'Authorization')).toBeUndefined();
  });

  it('later requests carry the renewed token without another refresh', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    acceptOnly('/ledgers', 'access-new');
    api.mockPost('/auth/refresh', issued('access-new', 'refresh-new'));

    await apiClient.get('/ledgers');
    await apiClient.get('/ledgers');

    expect(refreshCalls()).toHaveLength(1);
    expect(header(api.mock.history.get[2], 'Authorization')).toBe('Bearer access-new');
  });

  it('three concurrent 401s share one refresh and all three are replayed', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    acceptOnly('/ledgers', 'access-new', { which: 'ledgers' });
    acceptOnly('/me', 'access-new', { which: 'me' });
    acceptOnly('/categories', 'access-new', { which: 'categories' });

    // Hold the refresh answer until every 401 has reached the interceptor, so a second
    // refresh could not hide behind an already-updated storage.
    let release: (() => void) | null = null;
    api.mock.onPost(apiUrl('/auth/refresh')).reply(
      () =>
        new Promise((resolve) => {
          release = () => resolve([200, issued('access-new', 'refresh-new')]);
        }),
    );

    const pending = Promise.all([
      apiClient.get('/ledgers'),
      apiClient.get('/me'),
      apiClient.get('/categories'),
    ]);
    await settle();
    expect(api.mock.history.get).toHaveLength(3);
    expect(refreshCalls()).toHaveLength(1);
    expect(release).not.toBeNull();
    release!();

    const results = await pending;
    expect(results.map((r) => r.data)).toEqual([
      { which: 'ledgers' },
      { which: 'me' },
      { which: 'categories' },
    ]);
    expect(refreshCalls()).toHaveLength(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('adopts a pair another tab already refreshed instead of calling /auth/refresh', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    // Another tab renewed the session: storage moved on, this tab's memory did not.
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, 'access-other-tab');
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-other-tab');
    acceptOnly('/ledgers', 'access-other-tab', { ok: 'replayed' });
    api.mockPost('/auth/refresh', issued('never', 'never'));

    const res = await apiClient.get('/ledgers');

    expect(res.data).toEqual({ ok: 'replayed' });
    expect(refreshCalls()).toHaveLength(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(await getAuthToken()).toBe('access-other-tab');
    expect(await getRefreshToken()).toBe('refresh-other-tab');
  });

  it("refreshes with the other tab's refresh token when its access token expired too", async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    // Another tab renewed the session, then both sat idle past that token's lifetime.
    const expiredOtherTab = jwt({ sub: '1', exp: Math.floor(Date.now() / 1000) - 60 });
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, expiredOtherTab);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-other-tab');
    acceptOnly('/ledgers', 'access-new', { ok: 'replayed' });
    api.mockPost('/auth/refresh', issued('access-new', 'refresh-new'));

    const res = await apiClient.get('/ledgers');

    expect(res.data).toEqual({ ok: 'replayed' });
    const calls = refreshCalls();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].data))).toEqual({ refresh_token: 'refresh-other-tab' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    const sent = api.mock.history.get.map((c) => header(c, 'Authorization'));
    expect(sent).toEqual(['Bearer access-old', 'Bearer access-new']);
    expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('access-new');
    expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-new');
  });

  it("still adopts another tab's JWT that has not expired yet", async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    const liveOtherTab = jwt({ sub: '1', exp: Math.floor(Date.now() / 1000) + 600 });
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, liveOtherTab);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-other-tab');
    acceptOnly('/ledgers', liveOtherTab, { ok: 'replayed' });
    api.mockPost('/auth/refresh', issued('never', 'never'));

    const res = await apiClient.get('/ledgers');

    expect(res.data).toEqual({ ok: 'replayed' });
    expect(refreshCalls()).toHaveLength(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a refresh refused with another 4xx (422) ends the session like a 401', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'x'.repeat(600) });
    api.mockGet('/ledgers', UNAUTHORIZED, 401);
    api.mockPost('/auth/refresh', { detail: 'Invalid body', code: 'validation_error' }, 422);

    const err = await expectApiError(apiClient.get('/ledgers'));

    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(refreshCalls()).toHaveLength(1);
    expect(api.mock.history.get).toHaveLength(1);
  });

  it('a refresh refused with 401 ends the session once and rejects with the original 401', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-revoked' });
    api.mockGet('/ledgers', UNAUTHORIZED, 401);
    api.mockGet('/me', UNAUTHORIZED, 401);
    api.mockPost('/auth/refresh', REFRESH_INVALID, 401);

    const results = await Promise.allSettled([apiClient.get('/ledgers'), apiClient.get('/me')]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      const err = (r as PromiseRejectedResult).reason as ApiClientError;
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.status).toBe(401);
      expect(err.code).toBe('unauthorized');
    }
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    // The refresh's own 401 never re-entered the refresh logic.
    expect(refreshCalls()).toHaveLength(1);
    expect(api.mock.history.get).toHaveLength(2);
  });

  it.each([
    ['a network error', (m: MockApi) => m.mockNetworkError('/auth/refresh'), 0, 'network_error'],
    [
      'a 500',
      (m: MockApi) => m.mockPost('/auth/refresh', { detail: 'boom', code: 'internal_error' }, 500),
      500,
      'internal_error',
    ],
  ])(
    'a refresh that fails with %s keeps the session and its tokens',
    async (_label, failRefresh, status, code) => {
      await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
      api.mockGet('/ledgers', UNAUTHORIZED, 401);
      failRefresh(api);

      const err = await expectApiError(apiClient.get('/ledgers'));

      expect(err.status).toBe(status);
      expect(err.code).toBe(code);
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('access-old');
      expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-old');
      // No replay: the original request went out once.
      expect(api.mock.history.get).toHaveLength(1);
    },
  );

  it('retries the refresh on the next 401 once the network is back', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    acceptOnly('/ledgers', 'access-new');
    api.mockNetworkError('/auth/refresh');
    await expectApiError(apiClient.get('/ledgers'));

    api.mock.resetHandlers();
    acceptOnly('/ledgers', 'access-new');
    api.mockPost('/auth/refresh', issued('access-new', 'refresh-new'));
    const res = await apiClient.get('/ledgers');

    expect(res.status).toBe(200);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('with no refresh token stored a 401 ends the session straight away', async () => {
    await setAuthToken('access-only');
    api.mockGet('/ledgers', UNAUTHORIZED, 401);
    api.mockPost('/auth/refresh', issued('never', 'never'));

    const err = await expectApiError(apiClient.get('/ledgers'));

    expect(err.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(refreshCalls()).toHaveLength(0);
  });

  it('a replay that is refused again ends the session without a second refresh', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    api.mockGet('/ledgers', UNAUTHORIZED, 401);
    api.mockPost('/auth/refresh', issued('access-new', 'refresh-new'));

    const err = await expectApiError(apiClient.get('/ledgers'));

    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
    expect(refreshCalls()).toHaveLength(1);
    expect(api.mock.history.get.map((c) => header(c, 'Authorization'))).toEqual([
      'Bearer access-old',
      'Bearer access-new',
    ]);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('a 401 from POST /auth/login neither refreshes nor ends the session', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    api.mockPost('/auth/login', { detail: 'Wrong', code: 'invalid_credentials' }, 401);
    api.mockPost('/auth/refresh', issued('never', 'never'));

    const err = await expectApiError(apiClient.post('/auth/login', {}));

    expect(err.code).toBe('invalid_credentials');
    expect(refreshCalls()).toHaveLength(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a 401 from POST /auth/logout is left alone too', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    api.mockPost('/auth/logout', UNAUTHORIZED, 401);
    api.mockPost('/auth/refresh', issued('never', 'never'));

    await expectApiError(apiClient.post('/auth/logout', { refresh_token: 'refresh-old' }));

    expect(refreshCalls()).toHaveLength(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('POST /auth/logout-all is an ordinary protected call: its 401 refreshes', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    api.mock.onPost(apiUrl('/auth/logout-all')).reply((config: AxiosRequestConfig) =>
      header(config, 'Authorization') === 'Bearer access-new' ? [204] : [401, UNAUTHORIZED],
    );
    api.mockPost('/auth/refresh', issued('access-new', 'refresh-new'));

    const res = await apiClient.post('/auth/logout-all');

    expect(res.status).toBe(204);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('uploadClient renews the session too and replays through itself', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    api.mock.onPost(apiUrl('/ledgers/abc/imports')).reply((config: AxiosRequestConfig) =>
      header(config, 'Authorization') === 'Bearer access-new'
        ? [201, { ok: true }]
        : [401, UNAUTHORIZED],
    );
    api.mockPost('/auth/refresh', issued('access-new', 'refresh-new'));

    const res = await uploadClient.post('/ledgers/abc/imports', new FormData());

    expect(res.status).toBe(201);
    const uploads = api.mock.history.post.filter((c) => c.url === '/ledgers/abc/imports');
    expect(uploads).toHaveLength(2);
    // uploadClient's own timeout proves the replay did not go through apiClient.
    expect(uploads[1].timeout).toBe(60_000);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a logout that lands while the refresh is in flight is not undone by it', async () => {
    await setAuthTokens({ accessToken: 'access-old', refreshToken: 'refresh-old' });
    acceptOnly('/ledgers', 'access-new');
    let release: (() => void) | null = null;
    api.mock.onPost(apiUrl('/auth/refresh')).reply(
      () =>
        new Promise((resolve) => {
          release = () => resolve([200, issued('access-new', 'refresh-new')]);
        }),
    );

    const pending = expectApiError(apiClient.get('/ledgers'));
    await settle();
    expect(release).not.toBeNull();
    await clearAuthToken(); // the user signed out meanwhile
    release!();

    const err = await pending;
    expect(err.status).toBe(401);
    expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(await getAuthToken()).toBeNull();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(api.mock.history.get).toHaveLength(1);
  });
});
