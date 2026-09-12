/**
 * `renderWithProviders` itself (04 §8.3): every later screen test depends on it seeding
 * the session, the language, the theme and the breakpoint correctly.
 */
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { useAuth } from '@/store/AuthContext';

import { makeUser } from '../fixtures';
import { mockApi, type MockApi } from '../mockApi';
import { renderWithProviders, restoreWindowDimensions, waitForAuth } from '../render';

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
