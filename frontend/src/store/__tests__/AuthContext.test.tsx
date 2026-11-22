/**
 * `AuthContext` behaviour (04 §2.1): the three-state machine, the two sign-in paths,
 * logout's and logoutAll's clean-up, the interceptor's 401 notification and how the
 * refresh token (decision §14.67) survives a bootstrap that could not reach the server.
 */
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { apiClient, ApiClientError, setAuthToken, setAuthTokens } from '@/api';
import { AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY } from '@/constants/config';
import * as i18n from '@/i18n';
import { AuthProvider, useAuth } from '@/store/AuthContext';
import { apiUrl, makeUser, mockApi, mockGet, mockPost, type MockApi } from '@/test';
import * as prefs from '@/utils/prefs';
import { PREF_NAMES, prefKey, setPref } from '@/utils/prefs';

let api: MockApi;
let queryClient: QueryClient;

function Probe(): React.JSX.Element {
  const { status, user } = useAuth();
  return (
    <Text testID="probe">{`${status}:${user ? user.email : 'none'}`}</Text>
  );
}

// The context value the last render exposed, so tests can call login/logout directly,
// plus every status the provider went through.
let captured: ReturnType<typeof useAuth> | null = null;
let statuses: string[] = [];

function Capture(): null {
  const value = useAuth();
  captured = value;
  if (statuses[statuses.length - 1] !== value.status) statuses.push(value.status);
  return null;
}

function renderAuth(): void {
  captured = null;
  statuses = [];
  render(
    <AuthProvider queryClient={queryClient}>
      <Probe />
      <Capture />
    </AuthProvider>,
  );
}

const UNAUTHORIZED = { detail: 'Not authenticated', code: 'unauthorized' };

function issued(access: string, refresh: string): Record<string, unknown> {
  return { access_token: access, token_type: 'bearer', refresh_token: refresh, expires_in: 1800 };
}

function postsTo(path: string): Array<{ data?: unknown }> {
  return api.mock.history.post.filter((c) => c.url === path);
}

function probeText(): string {
  return String(screen.getByTestId('probe').props.children);
}

async function expectProbe(text: string): Promise<void> {
  await waitFor(() => expect(probeText()).toBe(text));
}

beforeEach(async () => {
  api = mockApi();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  await i18n.initI18n();
});

afterEach(() => {
  jest.restoreAllMocks();
  api.restore();
  queryClient.clear();
});

test('no stored token boots straight to anonymous', async () => {
  renderAuth();
  await expectProbe('anonymous:none');
  expect(api.mock.history.get).toHaveLength(0);
});

test('a stored token plus GET /me 200 boots to authenticated and applies the user language', async () => {
  const applySpy = jest.spyOn(i18n, 'applyLanguage');
  await setAuthToken('stored-token');
  mockGet('/me', makeUser({ email: 'bob@example.com', language: 'en' }));

  renderAuth();

  await expectProbe('authenticated:bob@example.com');
  expect(applySpy).toHaveBeenCalledWith('en', { persist: false });
});

test('language: null leaves the language initI18n already resolved alone', async () => {
  const applySpy = jest.spyOn(i18n, 'applyLanguage');
  await setAuthToken('stored-token');
  // "Follow the system" (04 §5.1 / §4.13): the device choice was resolved on boot, and
  // applying `null` here would re-resolve it and discard a local preference.
  mockGet('/me', makeUser({ email: 'bob@example.com', language: null }));

  renderAuth();

  await expectProbe('authenticated:bob@example.com');
  expect(applySpy).not.toHaveBeenCalled();
});

test('a 401 that lands while GET /me is in flight wins: the session stays anonymous', async () => {
  await setAuthToken('stored-token');
  let releaseMe: (() => void) | null = null;
  api.mock.onGet(apiUrl('/me')).reply(
    () =>
      new Promise((resolve) => {
        releaseMe = () => resolve([200, makeUser()]);
      }),
  );
  mockGet('/ledgers', { detail: 'Not authenticated', code: 'unauthorized' }, 401);

  renderAuth();
  await waitFor(() => expect(releaseMe).not.toBeNull());

  // Another request comes back 401 first — the session is over.
  await act(async () => {
    await apiClient.get('/ledgers').catch(() => undefined);
  });
  await expectProbe('anonymous:none');

  // The profile request finally answers 200. It must not resurrect the session.
  await act(async () => {
    releaseMe?.();
    await Promise.resolve();
  });

  await waitFor(() => expect(probeText()).toBe('anonymous:none'));
  expect(statuses).toEqual(['bootstrapping', 'anonymous']);
});

test('a stored token rejected with 401 drops to anonymous and forgets the token', async () => {
  await setAuthToken('expired-token');
  mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);

  renderAuth();

  await expectProbe('anonymous:none');
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
});

test('a stored pair whose refresh is refused with 401 forgets both tokens', async () => {
  await setAuthTokens({ accessToken: 'expired-token', refreshToken: 'revoked-refresh' });
  mockGet('/me', UNAUTHORIZED, 401);
  mockPost(
    '/auth/refresh',
    { detail: 'Refresh token is invalid or expired', code: 'refresh_invalid' },
    401,
  );

  renderAuth();

  await expectProbe('anonymous:none');
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
});

test('an expired access token is renewed during bootstrap without the user noticing', async () => {
  await setAuthTokens({ accessToken: 'expired-token', refreshToken: 'good-refresh' });
  api.mock.onGet(apiUrl('/me')).reply((config) => {
    const auth = (config.headers as { get?: (n: string) => unknown } | undefined)?.get?.(
      'Authorization',
    );
    return auth === 'Bearer renewed-token'
      ? [200, makeUser({ email: 'bob@example.com' })]
      : [401, UNAUTHORIZED];
  });
  mockPost('/auth/refresh', issued('renewed-token', 'renewed-refresh'));

  renderAuth();

  await expectProbe('authenticated:bob@example.com');
  expect(statuses).toEqual(['bootstrapping', 'authenticated']);
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('renewed-token');
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('renewed-refresh');
});

test.each([
  ['a 500', () => mockGet('/me', { detail: 'boom', code: 'internal_error' }, 500)],
  ['a network error', () => api.mockNetworkError('/me')],
])('a bootstrap that fails with %s lands on anonymous but keeps the tokens', async (_l, fail) => {
  await setAuthTokens({ accessToken: 'stored-token', refreshToken: 'stored-refresh' });
  fail();

  renderAuth();

  await expectProbe('anonymous:none');
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('stored-token');
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh');
});

test('a bootstrap whose refresh cannot reach the server keeps the tokens too', async () => {
  await setAuthTokens({ accessToken: 'expired-token', refreshToken: 'stored-refresh' });
  mockGet('/me', UNAUTHORIZED, 401);
  api.mockNetworkError('/auth/refresh');

  renderAuth();

  await expectProbe('anonymous:none');
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('expired-token');
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh');
});

test('login stores the token, loads the profile, and never passes through bootstrapping', async () => {
  renderAuth();
  await expectProbe('anonymous:none');

  mockPost('/auth/login', issued('fresh-token', 'fresh-refresh'));
  mockGet('/me', makeUser({ email: 'alice@example.com' }));

  statuses = ['anonymous'];
  await act(async () => {
    await captured!.login({ email: 'alice@example.com', password: 'pw' });
  });

  await expectProbe('authenticated:alice@example.com');
  // 04 §2.1 item 1: the only transition is anonymous → authenticated.
  expect(statuses).toEqual(['anonymous', 'authenticated']);
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('fresh-token');
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('fresh-refresh');
  // The profile request carried the token the login response returned.
  const meCall = api.mock.history.get.find((c) => c.url?.endsWith('/me'));
  expect(meCall?.headers?.Authorization).toBe('Bearer fresh-token');
});

test('a failed login rejects with ApiClientError and leaves the session anonymous', async () => {
  renderAuth();
  await expectProbe('anonymous:none');

  mockPost('/auth/login', { detail: 'Incorrect email or password', code: 'invalid_credentials' }, 401);

  await act(async () => {
    await expect(captured!.login({ email: 'a@b.c', password: 'nope' })).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  expect(probeText()).toBe('anonymous:none');
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
});

test('register signs in the same way as login', async () => {
  renderAuth();
  await expectProbe('anonymous:none');

  mockPost('/auth/register', issued('new-token', 'new-refresh'), 201);
  mockGet('/me', makeUser({ email: 'carol@example.com' }));

  await act(async () => {
    await captured!.register({
      email: 'carol@example.com',
      password: 'pw123456',
      base_currency: 'CNY',
    });
  });

  await expectProbe('authenticated:carol@example.com');
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('new-token');
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('new-refresh');
});

test('logout clears the token, the query cache and the last- and current-ledger preferences', async () => {
  await setAuthToken('stored-token');
  mockGet('/me', makeUser());
  await setPref(PREF_NAMES.lastLedgerId, 'ledger-42');
  renderAuth();
  await expectProbe('authenticated:alice@example.com');

  queryClient.setQueryData(['global', 'ledgers'], [{ id: 'ledger-42' }]);
  const clearSpy = jest.spyOn(queryClient, 'clear');
  const sessionSpy = jest.spyOn(prefs, 'setSessionPref');

  await act(async () => {
    await captured!.logout();
  });

  expect(probeText()).toBe('anonymous:none');
  expect(clearSpy).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(['global', 'ledgers'])).toBeUndefined();
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(prefKey(PREF_NAMES.lastLedgerId))).toBeNull();
  // This tab's current ledger (sessionStorage on the web) is dropped too.
  expect(sessionSpy).toHaveBeenCalledWith(PREF_NAMES.currentLedgerId, null);
});

test('logout revokes the refresh token server-side before forgetting it', async () => {
  await setAuthTokens({ accessToken: 'stored-token', refreshToken: 'stored-refresh' });
  mockGet('/me', makeUser());
  mockPost('/auth/logout', undefined, 204);
  renderAuth();
  await expectProbe('authenticated:alice@example.com');

  await act(async () => {
    await captured!.logout();
  });

  expect(probeText()).toBe('anonymous:none');
  await waitFor(() => expect(postsTo('/auth/logout')).toHaveLength(1));
  expect(JSON.parse(String(postsTo('/auth/logout')[0].data))).toEqual({
    refresh_token: 'stored-refresh',
  });
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
});

test('logout sends the freshest stored refresh token when it differs from the cached one', async () => {
  await setAuthTokens({ accessToken: 'stored-token', refreshToken: 'cached-refresh' });
  mockGet('/me', makeUser());
  mockPost('/auth/logout', undefined, 204);
  renderAuth();
  await expectProbe('authenticated:alice@example.com');

  // Another tab rotated the refresh token behind this tab's in-memory copy.
  await AsyncStorage.setItem(REFRESH_TOKEN_KEY, 'rotated-refresh');

  await act(async () => {
    await captured!.logout();
  });

  expect(probeText()).toBe('anonymous:none');
  await waitFor(() => expect(postsTo('/auth/logout')).toHaveLength(1));
  expect(JSON.parse(String(postsTo('/auth/logout')[0].data))).toEqual({
    refresh_token: 'rotated-refresh',
  });
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
});

test.each([
  ['fails', () => api.mockNetworkError('/auth/logout')],
  [
    'never answers',
    () => api.mock.onPost(apiUrl('/auth/logout')).reply(() => new Promise(() => undefined)),
  ],
])('logout still signs out when POST /auth/logout %s', async (_label, breakLogout) => {
  await setAuthTokens({ accessToken: 'stored-token', refreshToken: 'stored-refresh' });
  mockGet('/me', makeUser());
  breakLogout();
  renderAuth();
  await expectProbe('authenticated:alice@example.com');

  await act(async () => {
    await captured!.logout();
  });

  expect(probeText()).toBe('anonymous:none');
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
});

test('logout without a stored refresh token sends no POST /auth/logout', async () => {
  await setAuthToken('stored-token');
  mockGet('/me', makeUser());
  renderAuth();
  await expectProbe('authenticated:alice@example.com');

  await act(async () => {
    await captured!.logout();
  });

  expect(probeText()).toBe('anonymous:none');
  expect(postsTo('/auth/logout')).toHaveLength(0);
});

test('logoutAll revokes every session, then cleans up exactly like logout', async () => {
  await setAuthTokens({ accessToken: 'stored-token', refreshToken: 'stored-refresh' });
  mockGet('/me', makeUser());
  mockPost('/auth/logout-all', undefined, 204);
  await setPref(PREF_NAMES.lastLedgerId, 'ledger-42');
  renderAuth();
  await expectProbe('authenticated:alice@example.com');
  const clearSpy = jest.spyOn(queryClient, 'clear');
  const sessionSpy = jest.spyOn(prefs, 'setSessionPref');

  await act(async () => {
    await captured!.logoutAll();
  });

  expect(probeText()).toBe('anonymous:none');
  const call = postsTo('/auth/logout-all');
  expect(call).toHaveLength(1);
  const sentHeaders = (call[0] as { headers?: { get?: (n: string) => unknown } }).headers;
  expect(sentHeaders?.get?.('Authorization')).toBe('Bearer stored-token');
  // Every refresh token is already revoked server-side: no per-device logout on top.
  expect(postsTo('/auth/logout')).toHaveLength(0);
  expect(clearSpy).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(prefKey(PREF_NAMES.lastLedgerId))).toBeNull();
  expect(sessionSpy).toHaveBeenCalledWith(PREF_NAMES.currentLedgerId, null);
});

test('a failed logoutAll throws and leaves the session and its tokens untouched', async () => {
  await setAuthTokens({ accessToken: 'stored-token', refreshToken: 'stored-refresh' });
  mockGet('/me', makeUser());
  mockPost('/auth/logout-all', { detail: 'boom', code: 'internal_error' }, 500);
  await setPref(PREF_NAMES.lastLedgerId, 'ledger-42');
  renderAuth();
  await expectProbe('authenticated:alice@example.com');
  const clearSpy = jest.spyOn(queryClient, 'clear');

  await act(async () => {
    await expect(captured!.logoutAll()).rejects.toMatchObject({ status: 500 });
  });

  expect(probeText()).toBe('authenticated:alice@example.com');
  expect(clearSpy).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('stored-token');
  expect(await AsyncStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh');
  expect(await AsyncStorage.getItem(prefKey(PREF_NAMES.lastLedgerId))).not.toBeNull();
});

test('a 401 on any protected request moves the session to anonymous exactly once', async () => {
  await setAuthToken('stored-token');
  mockGet('/me', makeUser());
  renderAuth();
  await expectProbe('authenticated:alice@example.com');

  const clearSpy = jest.spyOn(queryClient, 'clear');
  mockGet('/ledgers', { detail: 'Not authenticated', code: 'unauthorized' }, 401);

  await act(async () => {
    await Promise.all([
      apiClient.get('/ledgers').catch(() => undefined),
      apiClient.get('/ledgers').catch(() => undefined),
    ]);
  });

  await expectProbe('anonymous:none');
  expect(clearSpy).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
});

test('useAuth() outside a provider throws', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Probe />)).toThrow(/AuthProvider/);
  spy.mockRestore();
});
