/**
 * `/l/:ledgerId/sources/new` and `/…/:sourceId/edit` (04 §4.9, §8.3; decisions §14.50,
 * §14.52 A13).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { within } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import type { FinanceSource } from '@/api/types';
import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { formatMoney } from '@/i18n/format';
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
  mockGet,
  mockPatch,
  mockPost,
  type MockApi,
} from '@/test';

import SourceFormScreen from '../SourceFormScreen';

let queryClient: QueryClient;
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
  'l/[ledgerId]/sources/index': () => <RNText>account list</RNText>,
  'l/[ledgerId]/sources/new': SourceFormScreen,
  'l/[ledgerId]/sources/[sourceId]/edit': SourceFormScreen,
};

const checking = makeSource({
  id: 'src-checking',
  name: '招行储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
  opening_balance: '0.0000',
  balance: '10000.0000',
  balance_base: '10000.0000',
});
const creditCard = makeSource({
  id: 'src-credit',
  name: '招行信用卡',
  type: 'credit',
  default_currency: 'CNY',
  opening_balance: '-3204.0000',
  balance: '-3204.0000',
  balance_base: '-3204.0000',
  updated_at: '2026-09-01T12:00:00.000000Z',
});

function seedList(items: FinanceSource[] = [checking, creditCard]): void {
  mockGet(SOURCES_PATH, { items, total: items.length });
}

function renderForm(url: string): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, { initialUrl: url, wrapper: Wrapper });
}

const NEW_URL = `/l/${LEDGER_ID}/sources/new`;
const EDIT_URL = `/l/${LEDGER_ID}/sources/src-credit/edit`;

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = makeTestQueryClient(makeTestHandlers());
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar' } });
  seedList();
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  // A `useIsWide` spy from a layout test must not decide the next test's branch.
  jest.restoreAllMocks();
});

test('a new account defaults to the ledger base currency and posts what was typed', async () => {
  mockPost(SOURCES_PATH, makeSource({ id: 'new-src', name: '现金', type: 'cash' }));
  renderForm(NEW_URL);

  expect(await screen.findByText('新建账户')).toBeTruthy();
  expect(within(screen.getByTestId('source-currency-trigger')).getByText('CNY')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('source-name'), '现金');
  fireEvent.press(screen.getByTestId('source-type-cash'));
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '120.5');

  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string)).toEqual({
    name: '现金',
    type: 'cash',
    default_currency: 'CNY',
    opening_balance: '120.5000',
  });
});

test('a credit account takes the amount owed as a positive number and stores it negative', async () => {
  mockPost(SOURCES_PATH, makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-type-credit')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '招行信用卡');
  fireEvent.press(screen.getByTestId('source-type-credit'));
  // The field is relabelled: it asks how much you owe (decision §14.52 A13).
  expect(screen.getByText('当前欠款')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '3204');

  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).opening_balance).toBe('-3204.0000');
});

test('switching the type across the credit boundary re-signs the stored opening balance', async () => {
  mockPost(SOURCES_PATH, makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-type-checking')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '某卡');
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '3204');
  // checking (+3204 held) → credit (3204 owed): the magnitude stays, the sign flips.
  fireEvent.press(screen.getByTestId('source-type-credit'));

  expect(await screen.findByText(/已按新类型换算期初余额/)).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });
  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  const body = JSON.parse(api.mock.history.post[0].data as string);
  expect(body.type).toBe('credit');
  expect(body.opening_balance).toBe('-3204.0000');
});

test('editing shows a credit card its positive debt and keeps the currency read-only', async () => {
  mockGet(`${SOURCES_PATH}/src-credit`, creditCard);
  mockPatch(`${SOURCES_PATH}/src-credit`, { ...creditCard, name: '招行信用卡 2' });
  renderForm(EDIT_URL);

  expect(await screen.findByText('编辑账户')).toBeTruthy();
  // Stored as -3204.0000, shown as 3,204.00 (decision §14.52 A13).
  await waitFor(() =>
    expect(String(screen.getByTestId('source-opening-balance').props.value)).toContain('3,204'),
  );
  // Read-only currency row plus the explanation (decision §14.50).
  expect(screen.getByTestId('source-currency').props.children).toBe('CNY');
  expect(screen.getByTestId('source-currency-locked')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('source-name'), '招行信用卡 2');
  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });

  await waitFor(() => expect(api.mock.history.patch.length).toBe(1));
  const body = JSON.parse(api.mock.history.patch[0].data as string);
  // Only what changed, plus the concurrency stamp — and never the currency.
  expect(body).toEqual({ name: '招行信用卡 2', updated_at: creditCard.updated_at });
  expect(body).not.toHaveProperty('default_currency');
});

test('changing an opening balance previews net worth before and after, and only saves on confirm', async () => {
  mockGet(`${SOURCES_PATH}/src-credit`, creditCard);
  mockPatch(`${SOURCES_PATH}/src-credit`, { ...creditCard, opening_balance: '-4204.0000' });
  renderForm(EDIT_URL);

  await waitFor(() =>
    expect(String(screen.getByTestId('source-opening-balance').props.value)).toContain('3,204'),
  );
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '4204');
  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });

  // net worth = 10000 − 3204 = 6796, and 1000 more owed makes it 5796.
  const dialog = await screen.findByTestId('confirm-dialog');
  const body = within(dialog).getByText(/净资产/);
  expect(String(body.props.children)).toContain(formatMoney('6796.0000', 'CNY', 'zh'));
  expect(String(body.props.children)).toContain(formatMoney('5796.0000', 'CNY', 'zh'));

  expect(api.mock.history.patch.length).toBe(0);
  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-accept'));
  });

  await waitFor(() => expect(api.mock.history.patch.length).toBe(1));
  expect(JSON.parse(api.mock.history.patch[0].data as string)).toEqual({
    opening_balance: '-4204.0000',
    updated_at: creditCard.updated_at,
  });
});

test('a name another account already uses is only a soft hint, never an error', async () => {
  mockPost(SOURCES_PATH, makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-name')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '招行信用卡');
  expect(await screen.findByText('已有同名账户，仍会按账户区分')).toBeTruthy();

  // It does not block the submit.
  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });
  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
});

test('the archive switch runs the §4.8 confirmation and PATCHes archived + updated_at', async () => {
  mockGet(`${SOURCES_PATH}/src-credit`, creditCard);
  mockPatch(`${SOURCES_PATH}/src-credit`, { ...creditCard, archived: true });
  renderForm(EDIT_URL);

  const toggle = await screen.findByTestId('source-archived');
  fireEvent(toggle, 'valueChange', true);

  const dialog = await screen.findByTestId('confirm-dialog');
  expect(within(dialog).getByText(/将从净资产中移除/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-accept'));
  });

  await waitFor(() => expect(api.mock.history.patch.length).toBe(1));
  expect(JSON.parse(api.mock.history.patch[0].data as string)).toEqual({
    archived: true,
    updated_at: creditCard.updated_at,
  });
});

test('an empty opening balance submits the documented default of 0', async () => {
  mockPost(SOURCES_PATH, makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-name')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '备用金');
  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).opening_balance).toBe('0.0000');
});

// ----------------------------------------------------------- the title (04 §1.4)

test('the narrow layout puts the title in the top bar and not on the page as well', async () => {
  renderForm(NEW_URL);

  expect(await screen.findByTestId('top-bar-title')).toHaveTextContent('新建账户');
  expect(screen.queryByTestId('source-form-title')).toBeNull();
});

test('the wide layout has no top bar, so the page carries the title itself', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-form-title')).toHaveTextContent('新建账户');
});
