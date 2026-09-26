/**
 * 记一笔 — which accounts the form offers (decision §14.62; 04 §4.6).
 *
 * Accounts belong to people and are shared into ledgers. The form reads the ledger's list
 * (`GET /ledgers/{id}/sources`): my own accounts and the ones members shared in are usable,
 * an account the ledger's entries still reference but that is no longer shared is not. The
 * picker groups the usable ones under 「我的」 / 「成员共享的」 and never shows a balance that
 * is not mine.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setAuthToken } from '@/api';
import type { LedgerSource } from '@/api/types';
import { initI18n } from '@/i18n';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  LEDGER_ID,
  makeCategoryTree,
  makeLedger,
  makeLedgerSource,
  makeTransaction,
  makeUser,
  mockApi,
  mockGet,
  mockPost,
  type MockApi,
} from '@/test';

import TransactionFormScreen from '../TransactionFormScreen';

let queryClient: QueryClient;
let api: MockApi;

const MINE = makeLedgerSource({
  id: 'src-mine',
  name: '我的储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
  balance: '12480.3500',
});
/** Bob's card, shared into this ledger: usable, but its balance is Bob's business. */
const SHARED = makeLedgerSource({
  id: 'src-bob',
  name: 'Bob 的信用卡',
  type: 'credit',
  default_currency: 'CNY',
  owner_id: 'user-bob',
  mine: false,
});
/** Named by old entries here, but Bob stopped sharing it. */
const UNSHARED = makeLedgerSource({
  id: 'src-bob-old',
  name: 'Bob 的旧卡',
  type: 'checking',
  owner_id: 'user-bob',
  mine: false,
  usable: false,
});

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <LedgerProvider ledgerId={LEDGER_ID} ledgers={[makeLedger()]}>
            {children}
          </LedgerProvider>
          <ToastHost />
          <ConfirmHost
            labels={{ confirm: '确认', cancel: '取消', confirmAgain: '再点一次确认' }}
          />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'accounts/new': () => <RNText>new-account-page</RNText>,
  'l/[ledgerId]/index': () => <RNText>ledger home</RNText>,
  'l/[ledgerId]/transactions/index': () => <RNText>transactions</RNText>,
  'l/[ledgerId]/transactions/new': TransactionFormScreen,
};

const NEW_URL = `/l/${LEDGER_ID}/transactions/new?kind=expense`;

/** Handlers are first-match, so each test registers the ledger's account list itself. */
function mockSources(items: LedgerSource[]): void {
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items, total: items.length });
}

beforeEach(async () => {
  api = mockApi();
  await AsyncStorage.clear();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser());
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan' } });
  mockPost(`/ledgers/${LEDGER_ID}/transactions`, makeTransaction());
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
});

test('the account list splits into mine and shared, and only offers usable accounts', async () => {
  mockSources([SHARED, UNSHARED, MINE]);
  renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('tx-source-trigger'));

  expect(await screen.findByTestId('tx-source-group-mine')).toHaveTextContent('我的');
  expect(screen.getByTestId('tx-source-group-shared')).toHaveTextContent('成员共享的');
  expect(screen.getByTestId(`tx-source-option-${MINE.id}`)).toHaveTextContent(/12,480\.35/);
  // Bob's card is offered, without a balance — not even a made-up zero.
  const shared = screen.getByTestId(`tx-source-option-${SHARED.id}`);
  expect(shared).toHaveTextContent(/Bob 的信用卡/);
  expect(shared).not.toHaveTextContent(/\d\.\d\d/);
  // The card Bob stopped sharing is no longer a choice.
  expect(screen.queryByTestId(`tx-source-option-${UNSHARED.id}`)).toBeNull();
});

test('with nothing remembered, the form starts on my own account, not a shared one', async () => {
  mockSources([SHARED, MINE]);
  renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

  await waitFor(() =>
    expect(screen.getByTestId('tx-source-trigger-value')).toHaveTextContent(MINE.name),
  );
});

test('an account a member shared in is enough to book with', async () => {
  mockSources([SHARED]);
  renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

  await waitFor(() =>
    expect(screen.getByTestId('tx-source-trigger-value')).toHaveTextContent(SHARED.name),
  );
  expect(screen.queryByTestId('tx-form-no-sources')).toBeNull();
});

test('with no usable account the form sends me to create one, shared into this ledger', async () => {
  mockSources([UNSHARED]);
  const router = renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

  expect(await screen.findByTestId('tx-form-no-sources')).toHaveTextContent(
    /还没有你能用的账户/,
  );
  fireEvent.press(screen.getByTestId('tx-form-no-sources-primary'));

  await waitFor(() => expect(router.getPathname()).toBe('/accounts/new'));
  expect(router.getSearchParams().ledger).toBe(LEDGER_ID);
});
