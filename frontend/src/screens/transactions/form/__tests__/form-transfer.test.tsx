/**
 * 记一笔 — the transfer tab (04 §4.6.4, §8.3; decisions §1.2 / §14.52 A10 / A11 / B16).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import * as breakpoint from '@/theme/useBreakpoint';
import { todayLocalIso } from '@/i18n/format';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  LEDGER_ID,
  makeCategoryTree,
  makeLedger,
  makeSource,
  makeTransaction,
  makeTransferPair,
  makeUser,
  mockApi,
  mockGet,
  mockPost,
  type MockApi,
} from '@/test';

import TransactionFormScreen from '../TransactionFormScreen';

let queryClient: QueryClient;
let api: MockApi;

const CHECKING = makeSource({
  id: 'src-checking',
  name: '招行储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
});
const CREDIT = makeSource({
  id: 'src-credit',
  name: '招行信用卡',
  type: 'credit',
  default_currency: 'CNY',
});
const USD_ACCOUNT = makeSource({
  id: 'src-usd',
  name: 'US 账户',
  type: 'checking',
  default_currency: 'USD',
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
  'l/[ledgerId]/index': () => <RNText>ledger home</RNText>,
  'l/[ledgerId]/transactions/index': () => <RNText>transactions</RNText>,
  'l/[ledgerId]/transactions/new': TransactionFormScreen,
};

const TRANSFER_URL = `/l/${LEDGER_ID}/transactions/new?kind=transfer`;

function postsTo(suffix: string): Array<Record<string, unknown>> {
  return api.mock.history.post
    .filter((r) => (r.url ?? '').endsWith(suffix))
    .map((r) => JSON.parse(String(r.data)) as Record<string, unknown>);
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
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', USD: 'US Dollar' } });
  mockGet(`/ledgers/${LEDGER_ID}/sources`, {
    items: [CHECKING, CREDIT, USD_ACCOUNT],
    total: 3,
  });
  mockPost(`/ledgers/${LEDGER_ID}/transactions`, makeTransaction({ kind: 'transfer' }));
  mockPost(`/ledgers/${LEDGER_ID}/transactions/transfer`, makeTransferPair());
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
});

async function chooseTo(id: string): Promise<void> {
  fireEvent.press(await screen.findByTestId('transfer-to-trigger'));
  fireEvent.press(await screen.findByTestId(`transfer-to-option-${id}`));
}

test('two legs in one currency show a single amount box and POST one flat body', async () => {
  renderRouter(ROUTES, { initialUrl: TRANSFER_URL, wrapper: Wrapper });

  await chooseTo(CREDIT.id);
  fireEvent.changeText(screen.getByTestId('transfer-amount'), '1000');
  expect(screen.queryByTestId('transfer-amount-in')).toBeNull();

  fireEvent.press(screen.getByTestId('tx-submit'));
  await waitFor(() => expect(postsTo('/transactions/transfer')).toHaveLength(1));

  expect(postsTo('/transactions/transfer')[0]).toEqual({
    from_source_id: CHECKING.id,
    to_source_id: CREDIT.id,
    amount_out: '1000.0000',
    currency_out: 'CNY',
    amount_in: '1000.0000',
    currency_in: 'CNY',
    occurred_at: todayLocalIso(),
    subtype: 'plain',
    note: null,
  });
  // One request, not two (decision §1.2), and never the single-entry endpoint.
  expect(postsTo('/transactions')).toHaveLength(0);
});

test('a second currency opens the second amount group and the rate chip is read-only', async () => {
  renderRouter(ROUTES, { initialUrl: TRANSFER_URL, wrapper: Wrapper });

  await chooseTo(CREDIT.id);
  fireEvent.changeText(screen.getByTestId('transfer-amount'), '1000');
  expect(screen.queryByTestId('transfer-amount-in')).toBeNull();

  await chooseTo(USD_ACCOUNT.id);
  expect(await screen.findByTestId('transfer-amount-in')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('transfer-amount-in'), '140');
  const rate = await screen.findByTestId('transfer-rate');
  expect(rate).toHaveTextContent(/1 CNY ≈ 0\.1400 USD/);
  // A chip, not a field: there is no input to type a rate into (decision §14.52 A10).
  expect(screen.queryByTestId('transfer-rate-field')).toBeNull();

  fireEvent.press(screen.getByTestId('tx-submit'));
  await waitFor(() => expect(postsTo('/transactions/transfer')).toHaveLength(1));
  const body = postsTo('/transactions/transfer')[0];
  expect(body.amount_out).toBe('1000.0000');
  expect(body.currency_out).toBe('CNY');
  expect(body.amount_in).toBe('140.0000');
  expect(body.currency_in).toBe('USD');
});

test('choosing 信用卡还款 leaves only credit accounts on the receiving side', async () => {
  renderRouter(ROUTES, { initialUrl: TRANSFER_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('transfer-subtype-repayment'));
  fireEvent.press(screen.getByTestId('transfer-to-trigger'));

  expect(await screen.findByTestId(`transfer-to-option-${CREDIT.id}`)).toBeTruthy();
  expect(screen.queryByTestId(`transfer-to-option-${CHECKING.id}`)).toBeNull();
  expect(screen.queryByTestId(`transfer-to-option-${USD_ACCOUNT.id}`)).toBeNull();
});

test('a non-credit account already chosen is cleared when the subtype becomes 还款', async () => {
  renderRouter(ROUTES, { initialUrl: TRANSFER_URL, wrapper: Wrapper });

  await chooseTo(USD_ACCOUNT.id);
  expect(screen.getByTestId('transfer-to-trigger-value')).toHaveTextContent(USD_ACCOUNT.name);

  fireEvent.press(screen.getByTestId('transfer-subtype-repayment'));
  expect(screen.getByTestId('transfer-to-trigger-value')).not.toHaveTextContent(
    USD_ACCOUNT.name,
  );
  expect(screen.getByText('还款的转入方必须是信用卡账户')).toBeTruthy();
});

test('"对方不在这个应用里" locks the currency and posts a single-leg transfer', async () => {
  renderRouter(ROUTES, { initialUrl: TRANSFER_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('transfer-external'));

  // Read-only currency: plain text, no trigger to open (decision §14.52 A11).
  expect(screen.queryByTestId('transfer-amount-currency-trigger')).toBeNull();
  expect(screen.getByTestId('transfer-amount-currency')).toHaveTextContent('CNY');
  expect(screen.getByTestId('transfer-single-leg-hint')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('transfer-amount'), '500');
  fireEvent.press(screen.getByTestId('transfer-direction-in'));
  fireEvent.changeText(screen.getByTestId('transfer-counterparty'), '老婆');

  // Money coming in from outside: the form suggests recording it as income instead.
  expect(screen.getByTestId('transfer-income-suggestion')).toBeTruthy();

  fireEvent.press(screen.getByTestId('tx-submit'));
  await waitFor(() => expect(postsTo('/transactions')).toHaveLength(1));

  expect(postsTo('/transactions')[0]).toEqual({
    source_id: CHECKING.id,
    kind: 'transfer',
    amount: '500.0000',
    currency: 'CNY',
    occurred_at: todayLocalIso(),
    note: null,
    transfer_role: 'in',
    transfer_subtype: 'plain',
    counterparty: '老婆',
  });
  expect(postsTo('/transactions/transfer')).toHaveLength(0);
});

test('"改记为收入" switches to the income tab with the social-income category', async () => {
  renderRouter(ROUTES, { initialUrl: TRANSFER_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('transfer-external'));
  fireEvent.press(screen.getByTestId('transfer-direction-in'));
  fireEvent.press(screen.getByTestId('transfer-switch-income'));

  expect(await screen.findByTestId('tx-category-path')).toHaveTextContent('人情收入');
  expect(screen.getByTestId('tx-merchant')).toBeTruthy();
});

/**
 * 屏幕稿 04 / 05 / 06 give the wide header's grey line a different sentence per kind:
 * 转账 and 退款 explain what the entry does to the books rather than repeating the ledger.
 */
test('宽屏 页头 explains what a transfer does, and says so differently for a single leg', async () => {
  const wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  try {
    renderRouter(ROUTES, { initialUrl: TRANSFER_URL, wrapper: Wrapper });

    expect(await screen.findByTestId('tx-form-ledger-meta')).toHaveTextContent(
      '转账不计入收支，只在账户之间移动',
    );

    fireEvent.press(screen.getByTestId('transfer-external'));
    expect(screen.getByTestId('tx-form-ledger-meta')).toHaveTextContent(
      '单腿转账 · 对方不在本账本内',
    );
    // 屏幕稿 05 单腿 says this once: the wide frame carries it in 「这一笔」, not twice — so
    // the amber note in the summary card is there, and the form's own copy is not.
    expect(
      screen.getAllByText(i18next.t('transaction:transfer.single_leg_hint')),
    ).toHaveLength(1);
    expect(screen.queryByTestId('transfer-single-leg-hint')).toBeNull();
  } finally {
    wideSpy.mockRestore();
  }
});
