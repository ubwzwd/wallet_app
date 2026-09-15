/**
 * `/ledgers` and `/ledgers/new` (04 §4.3, decisions §2 / §14.52 A16).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import type { Ledger } from '@/api/types';
import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { AuthProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ToastHost, toast } from '@/ui';
import { makeLedger, makeUser, mockApi, mockGet, mockPost, type MockApi } from '@/test';
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

test('a ledger card shows currency, members and role but never net worth', async () => {
  const ledger = makeLedger({ id: 'led-1', name: '家庭账本', base_currency: 'CNY', member_count: 3 });
  mockGet('/ledgers', { items: [ledger], total: 1 });
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  expect(await screen.findByTestId('ledger-card-led-1')).toBeTruthy();
  expect(screen.getByText('CNY')).toBeTruthy();
  expect(screen.getByText('3 人')).toBeTruthy();
  expect(screen.getByTestId('ledger-role-led-1')).toHaveTextContent(/你是 owner/);
  expect(screen.queryByText(/净资产/)).toBeNull();
  expect(screen.queryByText(/笔交易/)).toBeNull();

  fireEvent.press(screen.getByTestId('ledger-card-led-1'));
  await waitFor(() => expect(router.getPathname()).toBe('/l/led-1'));
});

test('the ledger the user was last in is the one marked as current', async () => {
  await setPref(PREF_NAMES.lastLedgerId, 'led-2');
  mockGet('/ledgers', {
    items: [makeLedger({ id: 'led-1', name: 'A' }), makeLedger({ id: 'led-2', name: 'B' })],
    total: 2,
  });
  renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  const current = await screen.findByTestId('ledger-card-led-2');
  await waitFor(() => expect(current.props.accessibilityState.selected).toBe(true));
  expect(screen.getByTestId('ledger-card-led-1').props.accessibilityState.selected).toBe(false);
});

test('ten ledgers disable the create button and explain why (decision §2)', async () => {
  mockGet('/ledgers', { items: manyLedgers(10), total: 10 });
  renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  const create = await screen.findByTestId('ledgers-create');
  expect(create.props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('ledgers-limit-hint')).toBeTruthy();
  // The join entry stays available — the cap is on ledgers you own or belong to, and
  // the server is the one that refuses (04 §4.3).
  expect(screen.getByTestId('ledgers-join').props.accessibilityState.disabled).toBe(false);
});

test('a load failure offers a retry that refetches', async () => {
  mockGet('/ledgers', { detail: 'boom', code: 'internal_error' }, 500);
  renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  expect(await screen.findByTestId('ledgers-error')).toBeTruthy();
  expect(screen.getByText('加载失败，请重试')).toBeTruthy();
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
