/**
 * 编辑单笔 / 编辑两腿转账 (04 §4.7, §3.8, §8.3) — kind rules, a minimal PATCH, the 409
 * merge, and the single request behind a two-leg edit.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  LEDGER_ID,
  apiUrl,
  makeCategoryTree,
  makeLedger,
  makeSource,
  makeTestHandlers,
  makeTestQueryClient,
  makeTransaction,
  makeTransferPair,
  makeUser,
  mockApi,
  mockGet,
  mockPatch,
  type MockApi,
  type TestQueryHandlers,
} from '@/test';

import EditTransactionScreen from '../EditTransactionScreen';
import EditTransferScreen from '../EditTransferScreen';

let queryClient: QueryClient;
let handlers: TestQueryHandlers;
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

const TX_ID = 'tx-under-edit';
const PAIR_ID = 'pair-under-edit';

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
  'l/[ledgerId]/transactions/[txId]/index': () => <RNText>transaction detail</RNText>,
  'l/[ledgerId]/transactions/[txId]/edit': EditTransactionScreen,
  'l/[ledgerId]/transfers/[pairId]/index': () => <RNText>transfer detail</RNText>,
  'l/[ledgerId]/transfers/[pairId]/edit': EditTransferScreen,
};

const EDIT_URL = `/l/${LEDGER_ID}/transactions/${TX_ID}/edit`;
const TX_PATH = `/ledgers/${LEDGER_ID}/transactions/${TX_ID}`;

function patches(suffix: string): Array<Record<string, unknown>> {
  return api.mock.history.patch
    .filter((r) => (r.url ?? '').endsWith(suffix))
    .map((r) => JSON.parse(String(r.data)) as Record<string, unknown>);
}

function getsTo(suffix: string): number {
  return api.mock.history.get.filter((r) => (r.url ?? '').endsWith(suffix)).length;
}

const EXISTING = makeTransaction({
  id: TX_ID,
  source_id: CHECKING.id,
  kind: 'expense',
  amount: '-128.5000',
  currency: 'CNY',
  occurred_at: '2026-08-03',
  merchant: '全家便利店',
  note: '原备注',
  category_l1: 'food',
  category_l2: 'snacks_drinks',
  updated_at: '2026-08-03T11:00:00.000000Z',
});

beforeEach(async () => {
  api = mockApi();
  await AsyncStorage.clear();
  await setAuthToken('test-token');
  toast.clear();
  handlers = makeTestHandlers();
  queryClient = makeTestQueryClient(handlers);
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser());
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', USD: 'US Dollar' } });
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [CHECKING, CREDIT], total: 2 });
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
});

test('the transfer tab is disabled while editing a non-transfer entry (decision §14.3)', async () => {
  mockGet(TX_PATH, EXISTING);
  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  const transferTab = await screen.findByTestId('tx-kind-transfer');
  expect(transferTab.props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('tx-kind-hint')).toBeTruthy();
  // The other two are open: expense ⇄ income ⇄ refund are all allowed.
  expect(screen.getByTestId('tx-kind-income').props.accessibilityState.disabled).toBe(false);
});

test('the PATCH carries updated_at and only the fields that changed', async () => {
  mockGet(TX_PATH, EXISTING);
  mockPatch(TX_PATH, { ...EXISTING, note: '改过的备注' });
  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-note'), '改过的备注');
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(patches(TX_PATH)).toHaveLength(1));
  expect(patches(TX_PATH)[0]).toEqual({
    updated_at: EXISTING.updated_at,
    note: '改过的备注',
  });
});

test('a 409 merges the server values in, keeps my edit and never re-sends', async () => {
  const server = {
    ...EXISTING,
    merchant: '别人改的商户',
    updated_at: '2026-08-04T09:00:00.000000Z',
  };
  // First read is the stale one; the refetch the 409 handler triggers sees the new version.
  api.mock.onGet(apiUrl(TX_PATH)).replyOnce(200, EXISTING);
  api.mock.onGet(apiUrl(TX_PATH)).reply(200, server);
  mockPatch(TX_PATH, { detail: '这条记录刚被改过', code: 'stale_update' }, 409);

  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-merchant'), '我改的商户');
  fireEvent.press(screen.getByTestId('tx-submit'));

  // 04 §3.8: warning toast from the one global handler, the detail key re-read…
  await waitFor(() => expect(screen.queryByTestId('tx-edit-conflict')).not.toBeNull());
  expect(handlers.notify).toHaveBeenCalledWith('warning', expect.any(String));
  expect(getsTo(TX_PATH)).toBeGreaterThan(1);

  // …my own edit survives, the server's value is offered next to it, nothing is re-sent.
  expect(screen.getByTestId('tx-merchant').props.value).toBe('我改的商户');
  expect(screen.getByText(`商户 · 服务器上现在是：${server.merchant}`)).toBeTruthy();
  expect(patches(TX_PATH)).toHaveLength(1);

  // Taking the server's value is explicit, and still not an automatic re-send.
  fireEvent.press(screen.getByTestId('tx-edit-use-server-merchant'));
  expect(screen.getByTestId('tx-merchant').props.value).toBe(server.merchant);
  expect(patches(TX_PATH)).toHaveLength(1);
});

test('editing a two-leg transfer sends exactly one PATCH to the pair endpoint', async () => {
  const pair = makeTransferPair({ pair_id: PAIR_ID, note: '还 8 月账单' });
  const pairPath = `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`;
  mockGet(pairPath, pair);
  mockPatch(pairPath, pair);

  renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER_ID}/transfers/${PAIR_ID}/edit`,
    wrapper: Wrapper,
  });

  // One form, both legs, no kind tabs and no single-leg checkbox.
  expect(await screen.findByTestId('transfer-amount')).toBeTruthy();
  expect(screen.queryByTestId('tx-kind')).toBeNull();
  expect(screen.queryByTestId('transfer-external')).toBeNull();

  fireEvent.changeText(screen.getByTestId('transfer-note'), '还 8 月账单（改）');
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(patches(pairPath)).toHaveLength(1));
  expect(patches(pairPath)[0]).toEqual({
    from_source_id: pair.out.source_id,
    to_source_id: pair.in.source_id,
    amount_out: '1000.0000',
    currency_out: 'CNY',
    amount_in: '1000.0000',
    currency_in: 'CNY',
    occurred_at: pair.occurred_at,
    subtype: 'plain',
    note: '还 8 月账单（改）',
    updated_at: pair.updated_at,
  });
});
