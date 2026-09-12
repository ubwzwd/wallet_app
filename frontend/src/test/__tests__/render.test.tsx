/**
 * `renderWithProviders` itself (04 §8.3): every later screen test depends on it seeding
 * the session, the language, the theme and the breakpoint correctly.
 */
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

import { ApiClientError } from '@/api/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { useAuth } from '@/store/AuthContext';

import { makeUser } from '../fixtures';
import { mockApi, type MockApi } from '../mockApi';
import { authStatus, renderWithProviders, restoreWindowDimensions, waitForAuth } from '../render';

function Probe(): React.JSX.Element {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const { scheme } = useTheme();
  const wide = useIsWide();
  return (
    <Text testID="probe">
      {`${status}|${user?.email ?? 'none'}|${t('common:button.save')}|${scheme}|${wide ? 'wide' : 'narrow'}`}
    </Text>
  );
}

let api: MockApi;

beforeEach(async () => {
  api = mockApi();
  await AsyncStorage.clear();
});

afterEach(() => {
  api.restore();
  restoreWindowDimensions();
});

test('seeds an authenticated session, English, dark theme and a wide window', async () => {
  const { getByTestId, queryClient } = await renderWithProviders(<Probe />, {
    auth: { status: 'authenticated', user: makeUser({ email: 'dana@example.com', language: 'en' }) },
    lang: 'en',
    theme: 'dark',
    wide: true,
  });

  expect(String(getByTestId('probe').props.children)).toBe(
    'authenticated|dana@example.com|Save|dark|wide',
  );
  expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
});

test('seeds an anonymous session, Chinese and a narrow window', async () => {
  const { getByTestId } = await renderWithProviders(<Probe />, {
    auth: 'anonymous',
    lang: 'zh',
    wide: false,
  });

  await waitForAuth('anonymous');
  expect(String(getByTestId('probe').props.children)).toBe('anonymous|none|保存|light|narrow');
});

test('the client is the real one: its global error handlers are the returned spies', async () => {
  const { queryClient, handlers } = await renderWithProviders(<Probe />, { auth: 'anonymous' });

  // A failing mutation goes through the app's own `MutationCache.onError` (04 §3.9).
  const mutation = queryClient
    .getMutationCache()
    .build(queryClient, { mutationFn: () => Promise.reject(new ApiClientError(403, 'not_owner', 'nope')) });
  await mutation.execute(undefined).catch(() => undefined);

  expect(handlers.notify).toHaveBeenCalledWith('error', expect.any(String), 'nope');
  expect(handlers.onUnauthorized).not.toHaveBeenCalled();

  // And a 404 on a ledger detail key still reports the ledger as gone (04 §2.4).
  await queryClient
    .fetchQuery({
      queryKey: ['l', 'ledger-9', 'detail'],
      queryFn: () => Promise.reject(new ApiClientError(404, 'not_found', 'gone')),
    })
    .catch(() => undefined);
  expect(handlers.onLedgerGone).toHaveBeenCalledWith('ledger-9');
});

test('mutations declaring meta.silent keep the global handler quiet', async () => {
  const { queryClient, handlers } = await renderWithProviders(<Probe />, { auth: 'anonymous' });

  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: () => Promise.reject(new ApiClientError(400, 'invite_invalid', 'nope')),
    meta: { silent: true },
  });
  await mutation.execute(undefined).catch(() => undefined);

  expect(handlers.notify).not.toHaveBeenCalled();
});

test('the layout mocks are undone on unmount, so the next render is narrow again', async () => {
  const wideView = await renderWithProviders(<Probe />, { auth: 'anonymous', wide: true });
  expect(String(wideView.getByTestId('probe').props.children)).toContain('wide');
  wideView.unmount();

  // No `restoreWindowDimensions()` in between, and no `wide` option either.
  expect(authStatus()).toBeNull();
  const { getByTestId } = await renderWithProviders(<Probe />, { auth: 'anonymous' });
  expect(String(getByTestId('probe').props.children)).toContain('narrow');
});
