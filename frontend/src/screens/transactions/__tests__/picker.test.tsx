/**
 * `TransactionPicker` (04 §4.6.3, §4.7): the shared "pick a transaction" overlay — the
 * refund form uses it for the original expense, the detail page for the opposite leg of a
 * transfer. What it must guarantee: `fixed` conditions always travel with the request and
 * can never be clicked away (decision §14.52 B11), `filterRows` narrows what is listed,
 * and picking a row hands the whole transaction back.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setAuthToken } from '@/api';
import type { Transaction } from '@/api/types';
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
  type MockApi,
} from '@/test';

import { PICKER_Q_DEBOUNCE_MS, TransactionPicker } from '../TransactionPicker';

let queryClient: QueryClient;
let api: MockApi;

const CHECKING = makeLedgerSource({ id: 'src-checking', name: '招行储蓄卡', type: 'checking' });

const CHEAP = makeTransaction({ id: 'tx-cheap', amount: '-38.0000', merchant: '便利店' });
const PRICEY = makeTransaction({ id: 'tx-pricey', amount: '-1299.0000', merchant: '京东' });

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

const onSelect = jest.fn<void, [Transaction]>();
const onClose = jest.fn<void, []>();
let filterRows: ((tx: Transaction) => boolean) | undefined;
/** The picker is mounted by its caller whether or not it is showing (see the last test). */
let pickerOpen = true;

function Harness(): React.JSX.Element {
  return (
    <TransactionPicker
      open={pickerOpen}
      onClose={onClose}
      onSelect={onSelect}
      title="选择原支出"
      fixed={{ kind: ['expense'] }}
      initial={{ from: '2026-06-01' }}
      filterRows={filterRows}
    />
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  home: Harness,
};

function listRequests(): Array<{ url?: string; params?: Record<string, unknown> }> {
  return api.mock.history.get.filter((r) => (r.url ?? '').endsWith('/transactions')) as Array<{
    url?: string;
    params?: Record<string, unknown>;
  }>;
}

function listRequest(): { url?: string; params?: Record<string, unknown> } | undefined {
  return listRequests()[0];
}

beforeEach(async () => {
  api = mockApi();
  await AsyncStorage.clear();
  await setAuthToken('test-token');
  toast.clear();
  onSelect.mockClear();
  onClose.mockClear();
  filterRows = undefined;
  pickerOpen = true;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser());
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan' } });
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [CHECKING], total: 1 });
  mockGet(`/ledgers/${LEDGER_ID}/transactions`, {
    items: [CHEAP, PRICEY],
    total: 2,
    limit: 20,
    offset: 0,
    summary: {
      base_currency: 'CNY',
      expense: '0',
      income: '0',
      net: '0',
      count: 2,
      rate_missing_count: 0,
    },
  });
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
});

test('a fixed condition travels with the request and has no way to be removed', async () => {
  renderRouter(ROUTES, { initialUrl: '/home', wrapper: Wrapper });

  const label = await screen.findByTestId('tx-picker-fixed');
  expect(label).toHaveTextContent('只看支出');
  // A static label, not a chip: no × and nothing to press.
  expect(label.props.accessibilityRole).toBe('text');
  expect(screen.queryByLabelText('去掉这个条件')).toBeNull();

  await waitFor(() => expect(listRequest()).toBeDefined());
  expect(listRequest()?.params).toMatchObject({ kind: ['expense'], from: '2026-06-01' });
});

test('filterRows narrows the list on the client', async () => {
  filterRows = (tx) => Number(tx.amount) < -1000;
  renderRouter(ROUTES, { initialUrl: '/home', wrapper: Wrapper });

  expect(await screen.findByTestId(`tx-picker-row-${PRICEY.id}`)).toBeTruthy();
  expect(screen.queryByTestId(`tx-picker-row-${CHEAP.id}`)).toBeNull();
});

test('picking a row hands the transaction back and closes', async () => {
  renderRouter(ROUTES, { initialUrl: '/home', wrapper: Wrapper });

  const row = await screen.findByTestId(`tx-picker-row-${CHEAP.id}`);
  // 04 §6.6: a row is a touch target, never a 32px-tall line of text.
  const style = Object.assign(
    {},
    ...[row.props.style].flat(Infinity).filter((part) => part && typeof part === 'object'),
  ) as { minHeight?: number };
  expect(style.minHeight).toBeGreaterThanOrEqual(44);

  fireEvent.press(row);

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect.mock.calls[0][0].id).toBe(CHEAP.id);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the editable filters go into the request; the fixed one stays put', async () => {
  renderRouter(ROUTES, { initialUrl: '/home', wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-picker-search'), '京东');

  await waitFor(() => {
    const withQuery = api.mock.history.get.filter(
      (r) => (r.url ?? '').endsWith('/transactions') && r.params?.q === '京东',
    );
    expect(withQuery).toHaveLength(1);
    expect(withQuery[0].params).toMatchObject({ kind: ['expense'] });
  });
});

test('typing three characters costs one request, not three', async () => {
  renderRouter(ROUTES, { initialUrl: '/home', wrapper: Wrapper });

  const box = await screen.findByTestId('tx-picker-search');
  // The unfiltered candidate list; everything after this is the search box's doing.
  await waitFor(() => expect(listRequests()).toHaveLength(1));

  fireEvent.changeText(box, '京');
  fireEvent.changeText(box, '京东');
  fireEvent.changeText(box, '京东超');

  // The box keeps up with every keystroke, the request does not: nothing has gone out yet.
  expect(box.props.value).toBe('京东超');
  expect(listRequests()).toHaveLength(1);

  // One request, once the typing stops — and it carries the whole word, not a prefix.
  await waitFor(() => expect(listRequests()).toHaveLength(2));
  expect(listRequests()[1].params?.q).toBe('京东超');
  expect(listRequests().some((r) => r.params?.q === '京' || r.params?.q === '京东')).toBe(false);

  // Nothing trails in afterwards either.
  await act(async () => {
    jest.advanceTimersByTime(PICKER_Q_DEBOUNCE_MS * 4);
  });
  expect(listRequests()).toHaveLength(2);
});

test('a picker that is only mounted, not shown, asks the server for nothing', async () => {
  // The refund tab keeps it mounted the whole time it is open; a closed overlay must not
  // cost a list request, nor a second `GET /sources` under a key the form does not share.
  pickerOpen = false;
  renderRouter(ROUTES, { initialUrl: '/home', wrapper: Wrapper });

  await waitFor(() => expect(api.mock.history.get.length).toBeGreaterThan(0));
  expect(listRequest()).toBeUndefined();
  expect(api.mock.history.get.filter((r) => (r.url ?? '').endsWith('/sources'))).toHaveLength(0);
});
