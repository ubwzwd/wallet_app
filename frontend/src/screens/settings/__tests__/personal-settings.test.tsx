/**
 * `/settings` (04 §4.13, §8.3): appearance stays on the device, language switches i18n
 * and persists as `null` for "follow the system", and an empty display name is sent as
 * an explicit `null`.
 */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import i18next from 'i18next';

import { AppShell } from '@/navigation';
import { PREF_NAMES, getPref, setPref } from '@/utils/prefs';
import {
  makeUser,
  mockApi,
  mockGet,
  mockPatch,
  renderWithProviders,
  type MockApi,
} from '@/test';
import { toast } from '@/ui';

import PersonalSettingsScreen from '../PersonalSettingsScreen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/settings',
  useGlobalSearchParams: () => ({}),
  useSegments: () => ['settings'],
}));

let api: MockApi;

beforeEach(async () => {
  api = mockApi();
  toast.clear();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  await setPref(PREF_NAMES.theme, null);
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar' } });
});

afterEach(async () => {
  api.restore();
  toast.clear();
  await setPref(PREF_NAMES.theme, null);
  await setPref(PREF_NAMES.lang, null);
  await i18next.changeLanguage('zh');
});

async function renderSettings(
  user = makeUser(),
): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  mockGet('/me', user);
  return renderWithProviders(<PersonalSettingsScreen />, {
    auth: { status: 'authenticated', user },
  });
}

/** The `PATCH /me` bodies this test has seen, oldest first. */
function patchBodies(): unknown[] {
  return api.mock.history.patch
    .filter((r) => (r.url ?? '').endsWith('/me'))
    .map((r) => JSON.parse(r.data as string));
}

test('the read-only identity is on screen', async () => {
  await renderSettings(makeUser({ email: 'alice@example.com' }));

  expect(await screen.findByTestId('settings-email')).toHaveTextContent(/alice@example\.com/);
  expect(screen.getByTestId('settings-created-at')).toHaveTextContent(/2026-01-05/);
});

test('appearance is written to the device pref and never to the server', async () => {
  await renderSettings();
  await screen.findByTestId('settings-appearance');

  await act(async () => {
    fireEvent.press(within(screen.getByTestId('settings-appearance')).getByText('深色'));
  });

  await waitFor(async () => expect(await getPref(PREF_NAMES.theme)).toBe('dark'));
  expect(patchBodies()).toEqual([]);
});

test('picking 中文 switches i18n and persists `language: "zh"`', async () => {
  const user = makeUser({ language: 'en' });
  await renderSettings(user);
  mockPatch('/me', { ...user, language: 'zh' });

  await act(async () => {
    await i18next.changeLanguage('en');
  });
  await screen.findByText('中文');

  await act(async () => {
    fireEvent.press(within(screen.getByTestId('settings-language')).getByText('中文'));
  });

  await waitFor(() => expect(patchBodies()).toEqual([{ language: 'zh' }]));
  expect(i18next.language).toBe('zh');
  // The page itself is in Chinese again — its title lives in the narrow top bar (04 §1.4),
  // so the language card's own note is what proves it here.
  await waitFor(() =>
    expect(screen.getByTestId('settings-language-note')).toHaveTextContent(/金额格式/),
  );
});

test('"follow the system" sends an explicit null', async () => {
  const user = makeUser({ language: 'zh' });
  await renderSettings(user);
  mockPatch('/me', { ...user, language: null });

  await act(async () => {
    fireEvent.press(within(screen.getByTestId('settings-language')).getByText('跟随系统'));
  });

  await waitFor(() => expect(patchBodies()).toEqual([{ language: null }]));
  // Decision §14.6: following the system means no stored language either.
  expect(await getPref(PREF_NAMES.lang)).toBeNull();
});

test('clearing the display name sends an explicit null', async () => {
  const user = makeUser({ display_name: 'Alice' });
  await renderSettings(user);
  mockPatch('/me', { ...user, display_name: null });

  fireEvent.changeText(await screen.findByTestId('settings-display-name'), '   ');
  fireEvent.press(screen.getByTestId('settings-display-name-save'));

  await waitFor(() => expect(patchBodies()).toEqual([{ display_name: null }]));
});

test('a new display name is saved on its own, trimmed', async () => {
  const user = makeUser({ display_name: null });
  await renderSettings(user);
  mockPatch('/me', { ...user, display_name: '小王' });

  // 屏幕稿 14: one 保存 in the page head, dark only once something actually differs.
  const save = await screen.findByTestId('settings-display-name-save');
  expect(save.props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(await screen.findByTestId('settings-display-name'), ' 小王 ');
  fireEvent.press(screen.getByTestId('settings-display-name-save'));

  await waitFor(() => expect(patchBodies()).toEqual([{ display_name: '小王' }]));
  expect(await screen.findByTestId('toast-success')).toHaveTextContent(/显示名已更新/);
});

test('the default currency is patched on its own', async () => {
  const user = makeUser({ base_currency: 'CNY' });
  await renderSettings(user);
  mockPatch('/me', { ...user, base_currency: 'SGD' });

  // 屏幕稿 14 reads 「CNY 人民币」 on the closed field, not the code alone and not the
  // server's un-localised 「Chinese Yuan」.
  const trigger = await screen.findByTestId('settings-base-currency-trigger');
  expect(trigger).toHaveTextContent('CNY 人民币');
  expect(trigger).not.toHaveTextContent('Chinese Yuan');

  fireEvent.press(await screen.findByTestId('settings-base-currency-trigger'));
  fireEvent.press(await screen.findByTestId('settings-base-currency-option-SGD'));

  await waitFor(() => expect(patchBodies()).toEqual([{ base_currency: 'SGD' }]));
});

test('without a ledger in context the ledger-settings entry falls back to /ledgers', async () => {
  await renderSettings();

  fireEvent.press(await screen.findByTestId('settings-ledger-settings'));
  expect(mockRouter.push).toHaveBeenCalledWith('/ledgers');
});

test('logging out clears the session and lands on /login', async () => {
  await renderSettings();

  fireEvent.press(await screen.findByTestId('settings-logout'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/login'));
});

test('re-picking the language already in use sends nothing', async () => {
  await renderSettings(makeUser({ language: 'zh' }));

  await act(async () => {
    fireEvent.press(within(screen.getByTestId('settings-language')).getByText('中文'));
  });

  expect(patchBodies()).toEqual([]);
});

// ----------------------------------------------------------- the title (04 §1.4)

test('the narrow shell carries the title, so the page does not print it twice', async () => {
  // `/settings` sits outside any ledger, so `AppShell` gives it the plain top bar — the
  // page publishes its title to it rather than heading the page with it.
  mockGet('/me', makeUser());
  await renderWithProviders(
    <AppShell>
      <PersonalSettingsScreen />
    </AppShell>,
    { auth: { status: 'authenticated', user: makeUser() }, wide: false },
  );

  expect(await screen.findByTestId('top-bar-title')).toHaveTextContent('我的');
  expect(screen.queryByTestId('personal-settings-title')).toBeNull();
});

test('the wide layout has no top bar, so the page carries the title itself', async () => {
  mockGet('/me', makeUser());
  await renderWithProviders(<PersonalSettingsScreen />, {
    auth: { status: 'authenticated', user: makeUser() },
    wide: true,
  });

  expect(await screen.findByTestId('personal-settings-title')).toHaveTextContent('我的');
});
