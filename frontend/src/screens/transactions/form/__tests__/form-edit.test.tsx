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
  // A second field, to prove every conflicting one is named in the user's own language.
  fireEvent.press(screen.getByTestId('tx-amount-currency-trigger'));
  fireEvent.press(await screen.findByTestId('tx-amount-currency-option-USD'));
  fireEvent.press(screen.getByTestId('tx-submit'));

  // 04 §3.8: warning toast from the one global handler, the detail key re-read…
  await waitFor(() => expect(screen.queryByTestId('tx-edit-conflict')).not.toBeNull());
  expect(handlers.notify).toHaveBeenCalledWith('warning', expect.any(String));
  expect(getsTo(TX_PATH)).toBeGreaterThan(1);

  // …my own edit survives, the server's value is offered next to it, nothing is re-sent.
  expect(screen.getByTestId('tx-merchant').props.value).toBe('我改的商户');
  expect(screen.getByText(`商户 · 服务器上现在是：${server.merchant}`)).toBeTruthy();
  // Every field name comes from the language pack, the currency included.
  expect(screen.getByText(`币种 · 服务器上现在是：${server.currency}`)).toBeTruthy();
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

test('a 409 on the two-leg pair names the fields that differ, and re-sends nothing', async () => {
  const pair = makeTransferPair({ pair_id: PAIR_ID, note: '还 8 月账单' });
  const fresh = { ...pair, note: '别人改的备注', updated_at: '2026-08-04T09:00:00.000000Z' };
  const pairPath = `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`;
  api.mock.onGet(apiUrl(pairPath)).replyOnce(200, pair);
  api.mock.onGet(apiUrl(pairPath)).reply(200, fresh);
  mockPatch(pairPath, { detail: '这条记录刚被改过', code: 'stale_update' }, 409);

  renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER_ID}/transfers/${PAIR_ID}/edit`,
    wrapper: Wrapper,
  });

  fireEvent.changeText(await screen.findByTestId('transfer-note'), '我改的备注');
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(screen.queryByTestId('transfer-edit-conflict')).not.toBeNull());
  expect(handlers.notify).toHaveBeenCalledWith('warning', expect.any(String));
  expect(screen.getByText(`备注 · 服务器上现在是：${fresh.note}`)).toBeTruthy();
  // The user's own edit stands, and nothing went out a second time (04 §3.8 step 5).
  expect(screen.getByTestId('transfer-note').props.value).toBe('我改的备注');
  expect(patches(pairPath)).toHaveLength(1);

  fireEvent.press(screen.getByTestId('transfer-edit-use-server-note'));
  expect(screen.getByTestId('transfer-note').props.value).toBe(fresh.note);
  expect(patches(pairPath)).toHaveLength(1);
});

test('a transfer detail that cannot be read offers a way out instead of a skeleton', async () => {
  const pairPath = `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`;
  api.mock.onGet(apiUrl(pairPath)).reply(500, { detail: 'boom' });

  renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER_ID}/transfers/${PAIR_ID}/edit`,
    wrapper: Wrapper,
  });

  expect(await screen.findByTestId('transfer-edit-error')).toBeTruthy();
  expect(screen.queryByTestId('transfer-edit-skeleton')).toBeNull();
});

test('a single entry that cannot be read offers a way out instead of a skeleton', async () => {
  api.mock.onGet(apiUrl(TX_PATH)).reply(500, { detail: 'boom' });

  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  expect(await screen.findByTestId('tx-edit-error')).toBeTruthy();
  expect(screen.queryByTestId('tx-edit-skeleton')).toBeNull();
});

// ----------------------------------------------------- single-leg transfer (decision §1.2)

const SINGLE_LEG = makeTransaction({
  id: TX_ID,
  source_id: CHECKING.id,
  kind: 'transfer',
  amount: '-500.0000',
  currency: 'CNY',
  occurred_at: '2026-08-03',
  merchant: null,
  note: null,
  category_l1: null,
  category_l2: null,
  transfer_role: 'out',
  transfer_subtype: 'plain',
  transfer_pair_id: null,
  counterparty: '老婆',
  updated_at: '2026-08-03T11:00:00.000000Z',
});

test('one leg cannot grow a second one here: no 对方不在应用里 checkbox, no 转入账户', async () => {
  mockGet(TX_PATH, SINGLE_LEG);
  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  // The direction is still a real choice; turning the entry into a two-leg transfer is not
  // (there is no second account on `PATCH .../transactions/{id}`).
  expect(await screen.findByTestId('transfer-direction')).toBeTruthy();
  expect(screen.queryByTestId('transfer-external')).toBeNull();
  expect(screen.queryByTestId('transfer-to-trigger')).toBeNull();
});

test('flipping the direction PATCHes transfer_role together with the flipped sign', async () => {
  mockGet(TX_PATH, SINGLE_LEG);
  mockPatch(TX_PATH, { ...SINGLE_LEG, amount: '500.0000', transfer_role: 'in' });
  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('transfer-direction-in'));
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(patches(TX_PATH)).toHaveLength(1));
  // The sign and the role are one fact — sending only the amount would fail the backend's
  // `transfer_role` check with a 400 the user could not act on.
  expect(patches(TX_PATH)[0]).toEqual({
    updated_at: SINGLE_LEG.updated_at,
    amount: '500.0000',
    transfer_role: 'in',
  });
});

// ------------------------------------------------ leaving the refund tab (decision §14.3)

const ORIGIN_ID = 'origin-under-edit';
const LINKED_REFUND = makeTransaction({
  id: TX_ID,
  source_id: CHECKING.id,
  kind: 'refund',
  amount: '128.5000',
  currency: 'CNY',
  occurred_at: '2026-08-03',
  merchant: '京东',
  note: null,
  category_l1: 'shopping',
  category_l2: 'electronics',
  refund_of: ORIGIN_ID,
  updated_at: '2026-08-03T11:00:00.000000Z',
});

test('a linked refund asks to be unlinked before it stops being one — on the same screen', async () => {
  mockGet(TX_PATH, LINKED_REFUND);
  mockGet(`/ledgers/${LEDGER_ID}/transactions/${ORIGIN_ID}`, makeTransaction({ id: ORIGIN_ID }));
  mockPatch(TX_PATH, { ...LINKED_REFUND, kind: 'expense', refund_of: null });
  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('tx-kind-expense'));

  // The block names an action, and that action is right next to it.
  expect(await screen.findByTestId('tx-edit-refund-lock')).toBeTruthy();
  expect(screen.getByTestId('tx-submit').props.accessibilityState.disabled).toBe(true);

  fireEvent.press(screen.getByTestId('tx-edit-refund-unlink'));
  await waitFor(() => expect(screen.queryByTestId('tx-edit-refund-lock')).toBeNull());
  expect(screen.getByTestId('tx-submit').props.accessibilityState.disabled).toBe(false);

  fireEvent.press(screen.getByTestId('tx-submit'));
  await waitFor(() => expect(patches(TX_PATH)).toHaveLength(1));
  expect(patches(TX_PATH)[0]).toEqual({
    updated_at: LINKED_REFUND.updated_at,
    kind: 'expense',
    amount: '-128.5000',
    refund_of: null,
  });
});

test('a 422 shows the server’s own wording on the field, not a validation key', async () => {
  mockGet(TX_PATH, EXISTING);
  mockPatch(TX_PATH, { detail: 'body.merchant: 商户名最多 200 个字符' }, 422);
  renderRouter(ROUTES, { initialUrl: EDIT_URL, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-merchant'), '太长的商户名');
  fireEvent.press(screen.getByTestId('tx-submit'));

  expect(await screen.findByText('商户名最多 200 个字符')).toBeTruthy();
  // Not the generic 「这是必填项」 the key channel would have produced.
  expect(screen.queryByText('这是必填项')).toBeNull();
});
