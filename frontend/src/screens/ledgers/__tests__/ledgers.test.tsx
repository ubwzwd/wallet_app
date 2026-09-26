/**
 * `/ledgers` and `/ledgers/new` (04 §4.3, decisions §2 / §14.65 c / d).
 *
 * `/ledgers` is no longer a list of ledger cards: with a ledger it redirects to the home `/`
 * would open; with none it is screen 15's onboarding; loading and failure keep their states.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import type { Ledger } from '@/api/types';
import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import * as breakpoint from '@/theme/useBreakpoint';
import { AuthProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ToastHost, toast } from '@/ui';
import {
  apiUrl,
  makeLedger,
  makeUser,
  mockApi,
  mockGet,
  mockPost,
  type MockApi,
} from '@/test';
import { PREF_NAMES, setPref } from '@/utils/prefs';

import LedgersScreen from '../LedgersScreen';
import NewLedgerScreen from '../NewLedgerScreen';

let queryClient: QueryClient;
let api: MockApi;

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          {children}
          <ToastHost />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'ledgers/index': LedgersScreen,
  'ledgers/new': NewLedgerScreen,
  'ledgers/join': () => <RNText>join page</RNText>,
  'l/[ledgerId]/index': () => <RNText>ledger home</RNText>,
};

const TWO = {
  items: [makeLedger({ id: 'led-1', name: 'A' }), makeLedger({ id: 'led-2', name: 'B' })],
  total: 2,
};

function manyLedgers(n: number): Ledger[] {
  return Array.from({ length: n }, (_, i) =>
    makeLedger({ id: `ledger-${i}`, name: `账本 ${i}`, role: i === 0 ? 'owner' : 'member' }),
  );
}

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, null);
  mockGet('/me', makeUser({ base_currency: 'SGD' }));
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar' } });
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  jest.restoreAllMocks();
});

test('with no ledgers the page is the onboarding guide, offering create and join', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  // Screen 15: no list, no chrome — a title, one sentence and the two ways forward.
  expect(await screen.findByTestId('ledgers-empty')).toBeTruthy();
  expect(screen.getByText('先有一本账')).toBeTruthy();
  expect(screen.getByTestId('ledgers-empty-secondary')).toBeTruthy();

  fireEvent.press(screen.getByTestId('ledgers-empty-primary'));
  await waitFor(() => expect(router.getPathname()).toBe('/ledgers/new'));
});

test('with ledgers, /ledgers is not a page: it lands on the remembered ledger’s home', async () => {
  await setPref(PREF_NAMES.lastLedgerId, 'led-2');
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  await waitFor(() => expect(router.getPathname()).toBe('/l/led-2'));
  expect(await screen.findByText('ledger home')).toBeTruthy();
  // No cards, no 「账本管理」 anywhere on the way.
  expect(screen.queryByText('账本管理')).toBeNull();
});

test('with nothing remembered, /ledgers lands where `/` would: the first ledger', async () => {
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  await waitFor(() => expect(router.getPathname()).toBe('/l/led-1'));
});

test('a remembered ledger the user no longer belongs to is not a destination', async () => {
  await setPref(PREF_NAMES.lastLedgerId, 'led-gone');
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  await waitFor(() => expect(router.getPathname()).toBe('/l/led-1'));
});

test('while the list is loading /ledgers waits with placeholders and guesses nothing', async () => {
  api.mock.onGet(apiUrl('/ledgers')).reply(() => new Promise(() => undefined));
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  expect(await screen.findByTestId('ledger-skeleton-0')).toBeTruthy();
  expect(router.getPathname()).toBe('/ledgers');
});

test('a load failure offers a retry that refetches, and then lands', async () => {
  mockGet('/ledgers', { detail: 'boom', code: 'internal_error' }, 500);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  expect(await screen.findByTestId('ledgers-error')).toBeTruthy();
  expect(screen.getByText('加载失败，请重试')).toBeTruthy();
  expect(router.getPathname()).toBe('/ledgers');

  mockGet('/ledgers', TWO);
  fireEvent.press(screen.getByText('重试'));
  await waitFor(() => expect(router.getPathname()).toBe('/l/led-1'));
});

test('creating a ledger defaults to the user currency and lands in the new ledger', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  mockPost('/ledgers', makeLedger({ id: 'new-led', name: '旅行账本', base_currency: 'SGD' }));
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  await waitFor(() => expect(screen.getByText('SGD')).toBeTruthy());
  fireEvent.changeText(await screen.findByTestId('new-ledger-name'), '旅行账本');
  fireEvent.press(screen.getByTestId('new-ledger-submit'));

  await waitFor(() => expect(router.getPathname()).toBe('/l/new-led'));
  const body = JSON.parse(api.mock.history.post[0].data as string) as Record<string, string>;
  expect(body).toEqual({ name: '旅行账本', base_currency: 'SGD' });
  expect(await screen.findByTestId('toast-success')).toHaveTextContent('已创建《旅行账本》');
});

test('an empty ledger name is refused before the request', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('new-ledger-submit'));

  expect(await screen.findByText('这是必填项')).toBeTruthy();
  expect(api.mock.history.post.length).toBe(0);
});

test('ten ledgers disable creating and explain why (decision §2)', async () => {
  // The cap used to be shown on the ledger list's 新建 button; with no list page (§14.65 c)
  // the create page itself is where it is enforced and explained.
  mockGet('/ledgers', { items: manyLedgers(10), total: 10 });
  renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-limit')).toHaveTextContent(/10/);
  expect(screen.getByTestId('new-ledger-submit').props.accessibilityState.disabled).toBe(true);
  expect(api.mock.history.post.length).toBe(0);
});

test('宽屏 the create page is a sub-page: 「首页 · 新建账本」, and cold it goes home (§14.65 d)', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  await setPref(PREF_NAMES.lastLedgerId, 'led-2');
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-header-title')).toHaveTextContent('新建账本');
  expect(await screen.findByText('首页 · 新建账本')).toBeTruthy();
  // A cold open has no history, so the crumb goes to the parent: the recent ledger's home.
  fireEvent.press(screen.getByTestId('new-ledger-header-back'));
  await waitFor(() => expect(router.getPathname()).toBe('/l/led-2'));
});

test('宽屏 a cold open reserves the crumb row before the recent ledger is known (no pop-in)', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  // The ledger list never answers, so the back target stays unknown.
  api.mock.onGet(apiUrl('/ledgers')).reply(() => new Promise(() => undefined));
  renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-header-back')).toBeTruthy();
  expect(screen.getByText('首页 · 新建账本')).toBeTruthy();
});

test('outside the shell (a user with no ledger) the create page draws its own way back', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-header-title')).toHaveTextContent('新建账本');
  fireEvent.press(screen.getByTestId('new-ledger-header-back'));
  await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
});
