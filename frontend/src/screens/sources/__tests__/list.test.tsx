/**
 * `/l/:ledgerId/sources` — the account list (04 §4.8, §8.3; decisions §3, §14.48, §14.50).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { within } from '@testing-library/react-native';
import i18next from 'i18next';

import type { FinanceSource } from '@/api/types';
import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { formatDate, formatMoney } from '@/i18n/format';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import * as breakpoint from '@/theme/useBreakpoint';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  LEDGER_ID,
  makeLedger,
  makeSource,
  makeTestHandlers,
  makeTestQueryClient,
  makeUser,
  mockApi,
  mockDelete,
  mockGet,
  mockPatch,
  type MockApi,
  type TestQueryHandlers,
} from '@/test';

import SourcesScreen from '../SourcesScreen';

let queryClient: QueryClient;
let handlers: TestQueryHandlers;
let api: MockApi;

const LEDGER = makeLedger({ base_currency: 'CNY' });
const SOURCES_PATH = `/ledgers/${LEDGER_ID}/sources`;

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <LedgerProvider ledgerId={LEDGER_ID} ledgers={[LEDGER]}>
            {/* The real narrow chrome: the page title is published to it, not printed
                on the page (04 §1.4). */}
            <TopBarProvider>
              <TopBarSurface onPressLedger={() => {}} />
              {children}
            </TopBarProvider>
          </LedgerProvider>
          <ToastHost />
          <ConfirmHost
            labels={{
              confirm: i18next.t('common:button.confirm'),
              cancel: i18next.t('common:button.cancel'),
              confirmAgain: i18next.t('common:button.confirm_again'),
            }}
          />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'l/[ledgerId]/sources/index': SourcesScreen,
  'l/[ledgerId]/sources/new': () => <RNText>new account form</RNText>,
  'l/[ledgerId]/sources/[sourceId]/edit': () => <RNText>edit account form</RNText>,
};

const checking = makeSource({
  id: 'src-checking',
  name: '招行储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
  opening_balance: '0.0000',
  balance: '10000.0000',
  balance_base: '10000.0000',
  updated_at: '2026-09-01T12:00:00.000000Z',
});
const credit = makeSource({
  id: 'src-credit',
  name: '招行信用卡',
  type: 'credit',
  default_currency: 'CNY',
  opening_balance: '-3204.0000',
  balance: '-3204.0000',
  balance_base: '-3204.0000',
});
const cash = makeSource({
  id: 'src-cash',
  name: '钱包现金',
  type: 'cash',
  default_currency: 'CNY',
  balance: '500.0000',
  balance_base: '500.0000',
});
const other = makeSource({
  id: 'src-other',
  name: '新加坡账户',
  type: 'other',
  default_currency: 'SGD',
  balance: '200.0000',
  balance_base: '1000.0000',
  balance_rate: '5.00000000',
  balance_rate_date: '2026-09-11',
});
const archived = makeSource({
  id: 'src-archived',
  name: '旧储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
  balance: '700.0000',
  balance_base: '700.0000',
  archived: true,
  archived_at: '2026-08-20T03:00:00.000000Z',
});

const ALL: FinanceSource[] = [checking, credit, cash, other, archived];

function seedList(items: FinanceSource[] = ALL): void {
  mockGet(SOURCES_PATH, { items, total: items.length });
}

function renderList(url = `/l/${LEDGER_ID}/sources`): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, { initialUrl: url, wrapper: Wrapper });
}

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  handlers = makeTestHandlers();
  queryClient = makeTestQueryClient(handlers);
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar' } });
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  // A `useIsWide` spy from a layout test must not decide the next test's branch.
  jest.restoreAllMocks();
});

test('accounts are grouped into the four types, each with its converted subtotal', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('source-group-checking')).toBeTruthy();
  for (const type of ['checking', 'credit', 'cash', 'other']) {
    expect(screen.getByTestId(`source-group-${type}`)).toBeTruthy();
  }
  // The archived checking account is NOT part of its group's subtotal (decision §14.50).
  expect(screen.getByTestId('source-subtotal-checking').props.children).toContain(
    formatMoney('10000.0000', 'CNY', 'zh'),
  );
  expect(screen.getByTestId('source-subtotal-credit').props.children).toContain(
    formatMoney('-3204.0000', 'CNY', 'zh'),
  );
  expect(screen.getByTestId('source-subtotal-cash').props.children).toContain(
    formatMoney('500.0000', 'CNY', 'zh'),
  );
  // The SGD account's subtotal is its converted value, not its own-currency balance.
  expect(screen.getByTestId('source-subtotal-other').props.children).toContain(
    formatMoney('1000.0000', 'CNY', 'zh'),
  );
});

test('a credit card reads as "owes", and a foreign account shows its converted value and rate date', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('source-balance-src-credit')).toBeTruthy();
  expect(screen.getByTestId('source-balance-src-credit').props.children).toContain(
    formatMoney('3204.0000', 'CNY', 'zh'),
  );
  expect(screen.getByText(/欠 /)).toBeTruthy();

  expect(screen.getByTestId('source-balance-base-src-other').props.children).toContain(
    formatMoney('1000.0000', 'CNY', 'zh'),
  );
  expect(screen.getByTestId('source-rate-date-src-other')).toBeTruthy();
  // A base-currency account has no second line.
  expect(screen.queryByTestId('source-balance-base-src-cash')).toBeNull();
});

test('archived accounts stay out of the three numbers and are folded away by default', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('sources-assets')).toBeTruthy();
  // assets = 10000 + 500 + 1000 (SGD converted); the archived 700 is excluded.
  expect(screen.getByText(formatMoney('11500.0000', 'CNY', 'zh'))).toBeTruthy();
  expect(screen.getByText(formatMoney('3204.0000', 'CNY', 'zh'))).toBeTruthy();
  expect(screen.getByText(formatMoney('8296.0000', 'CNY', 'zh'))).toBeTruthy();

  // Folded: the section names the count but no archived row is on screen.
  expect(screen.getByTestId('sources-archived-toggle')).toBeTruthy();
  expect(screen.getByText('已归档（1）')).toBeTruthy();
  expect(screen.queryByTestId('source-row-src-archived')).toBeNull();
});

test('?include_archived=1 expands the section, greying each row with its archive date', async () => {
  seedList();
  renderList(`/l/${LEDGER_ID}/sources?include_archived=1`);

  expect(await screen.findByTestId('source-row-src-archived')).toBeTruthy();
  expect(screen.getByTestId('source-archived-at-src-archived').props.children).toContain(
    formatDate('2026-08-20', 'zh'),
  );
  expect(screen.getByTestId('source-archived-hint-src-archived').props.children).toBe(
    '余额不计入净资产',
  );
  // Still out of the three numbers while expanded.
  expect(screen.getByText(formatMoney('8296.0000', 'CNY', 'zh'))).toBeTruthy();
});

test('toggling the archived section writes include_archived into the URL', async () => {
  seedList();
  const router = renderList();

  fireEvent.press(await screen.findByTestId('sources-archived-toggle'));
  await waitFor(() => expect(router.getSearchParams().include_archived).toBe('1'));
  expect(await screen.findByTestId('source-row-src-archived')).toBeTruthy();

  fireEvent.press(screen.getByTestId('sources-archived-toggle'));
  await waitFor(() => expect(router.getSearchParams().include_archived).toBeUndefined());
});

test('the empty state offers the create action', async () => {
  seedList([]);
  renderList();

  expect(await screen.findByText('还没有账户，添加一个开始记账')).toBeTruthy();
  fireEvent.press(screen.getByTestId('sources-empty-primary'));
  await waitFor(() => expect(screen.getByText('new account form')).toBeTruthy());
});

test('pressing a row opens that account for editing', async () => {
  seedList();
  const router = renderList();

  fireEvent.press(await screen.findByTestId('source-row-src-cash'));
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/sources/src-cash/edit`),
  );
});

test('archiving confirms with the balance leaving net worth, then PATCHes archived + updated_at', async () => {
  seedList();
  mockPatch(`${SOURCES_PATH}/src-checking`, { ...checking, archived: true });
  renderList();

  fireEvent.press(await screen.findByTestId('source-archive-src-checking'));

  const dialog = await screen.findByTestId('confirm-dialog');
  const body = within(dialog).getByText(/将从净资产中移除/);
  expect(String(body.props.children)).toContain(formatMoney('10000.0000', 'CNY', 'zh'));

  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-accept'));
  });

  await waitFor(() => expect(api.mock.history.patch.length).toBe(1));
  const sent = api.mock.history.patch[0];
  expect(sent.url).toContain('/sources/src-checking');
  expect(JSON.parse(sent.data as string)).toEqual({
    archived: true,
    updated_at: checking.updated_at,
  });
});

test('cancelling the archive confirmation sends nothing', async () => {
  seedList();
  renderList();

  fireEvent.press(await screen.findByTestId('source-archive-src-checking'));
  await act(async () => {
    fireEvent.press(await screen.findByTestId('confirm-cancel'));
  });

  expect(api.mock.history.patch.length).toBe(0);
});

test('a delete refused with source_has_transactions explains that archiving is the way out', async () => {
  seedList();
  mockDelete(
    `${SOURCES_PATH}/src-checking`,
    { detail: 'has transactions', code: 'source_has_transactions' },
    409,
  );
  renderList();

  fireEvent.press(await screen.findByTestId('source-delete-src-checking'));
  // The delete confirmation is double-tap (it cannot be undone).
  await act(async () => {
    fireEvent.press(await screen.findByTestId('confirm-accept'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-accept'));
  });

  expect(
    (await screen.findByTestId('source-delete-blocked-src-checking')).props.children,
  ).toBe('这个账户下有交易，只能归档');
  // The global error toast carried the server's copy as well (04 §3.9).
  await waitFor(() => expect(handlers.notify).toHaveBeenCalledWith('error', expect.any(String), expect.anything()));
});

// ----------------------------------------------------------- the title (04 §1.4)

test('the narrow layout publishes the title to the top bar instead of printing it twice', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('top-bar-title')).toHaveTextContent('账户');
  expect(screen.queryByTestId('sources-title')).toBeNull();
});

test('the wide layout carries the title on the page', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  seedList();
  renderList();

  expect(await screen.findByTestId('sources-title')).toHaveTextContent('账户');
});
