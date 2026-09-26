/**
 * The way back out of 记一笔 / 编辑 (decision §14.64 e / f, 04 §4.6.5 离开确认).
 *
 * Wide: the page header's round button and its 「交易 · 记一笔」 trail. Narrow: the shell's
 * sub-page top bar (`top-bar-back`), mounted here exactly as the shell mounts it. Either
 * way a cold open goes to the parent of the table in §14.64 f, and a form with unsaved
 * changes asks first — and staying keeps what was typed.
 *
 * Decision §14.65 h: the ‹ and the breadcrumb are one exit — the form's own `?next=` wins at
 * both widths — and the edit screens keep that exit while their record is loading or gone.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router as appRouter } from 'expo-router';
import i18next from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { LeaveGuardProvider, SubPageTopBar, TopBarProvider } from '@/navigation';
import { AuthProvider, LedgerProvider } from '@/store';
import * as breakpoint from '@/theme/useBreakpoint';
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
  apiUrl,
  mockApi,
  mockGet,
  type MockApi,
} from '@/test';

import EditTransactionScreen from '../EditTransactionScreen';
import EditTransferScreen from '../EditTransferScreen';
import TransactionFormScreen from '../TransactionFormScreen';

let queryClient: QueryClient;
let api: MockApi;

const LEDGER = makeLedger();
const CHECKING = makeSource({
  id: 'src-checking',
  name: '招行储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
});
const TX_ID = 'tx-under-edit';
const PAIR_ID = 'pair-under-edit';
const L = `/l/${LEDGER_ID}`;
const NEW_URL = `${L}/transactions/new`;

/** What `AppShell` draws above a sub-page: the ‹ bar on a narrow screen, nothing wide. */
function ShellBar(): React.JSX.Element | null {
  return breakpoint.useIsWide() ? null : <SubPageTopBar />;
}

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <LedgerProvider ledgerId={LEDGER_ID} ledgers={[LEDGER]}>
            {/* As `AppShell` mounts them: the bar reads the page's back override. */}
            <LeaveGuardProvider>
              <TopBarProvider>
                <ShellBar />
                {children}
              </TopBarProvider>
            </LeaveGuardProvider>
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
  'l/[ledgerId]/transactions/[txId]/index': () => <RNText>transaction detail</RNText>,
  'l/[ledgerId]/transactions/[txId]/edit': EditTransactionScreen,
  'l/[ledgerId]/transfers/[pairId]/index': () => <RNText>transfer detail</RNText>,
  'l/[ledgerId]/transfers/[pairId]/edit': EditTransferScreen,
};

function setWide(wide: boolean): void {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
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
  mockGet('/ledgers', { items: [LEDGER], total: 1 });
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', USD: 'US Dollar' } });
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [CHECKING], total: 1 });
  mockGet(
    `/ledgers/${LEDGER_ID}/transactions/${TX_ID}`,
    makeTransaction({ id: TX_ID, source_id: CHECKING.id, merchant: '全家便利店' }),
  );
  mockGet(
    `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`,
    makeTransferPair({ pair_id: PAIR_ID, note: '还 8 月账单' }),
  );
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  jest.restoreAllMocks();
});

describe('wide', () => {
  beforeEach(() => setWide(true));

  test('记一笔 carries 「交易 · 记一笔」, and cold its back goes to the list', async () => {
    const router = renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

    expect(await screen.findByTestId('tx-form-header-back')).toBeTruthy();
    expect(screen.getByText('交易 · 记一笔')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions`));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  test('a dirty 记一笔 asks before the breadcrumb leaves; staying keeps the amount', async () => {
    const router = renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

    fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');
    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-cancel'));
    });
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(router.getPathname()).toBe(NEW_URL);
    expect(screen.getByTestId('tx-amount').props.value).toBe('38.00');

    // Answering "leave" goes, and is asked exactly once.
    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('confirm-accept'));
    });
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions`));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  test('the breadcrumb honours the form’s own ?next= before the table', async () => {
    const router = renderRouter(ROUTES, {
      initialUrl: `${NEW_URL}?next=${encodeURIComponent(L)}`,
      wrapper: Wrapper,
    });

    fireEvent.press(await screen.findByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(L));
  });

  test('编辑 an entry: 「交易 · 编辑」, and cold its back goes to that entry’s detail', async () => {
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transactions/${TX_ID}/edit`,
      wrapper: Wrapper,
    });

    expect(await screen.findByTestId('tx-form-header-back')).toBeTruthy();
    expect(screen.getByText('交易 · 编辑')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions/${TX_ID}`));
  });

  test('编辑 a transfer pair: cold, its back goes to the pair’s detail', async () => {
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transfers/${PAIR_ID}/edit`,
      wrapper: Wrapper,
    });

    expect(await screen.findByTestId('transfer-amount')).toBeTruthy();
    expect(screen.getByText('交易 · 编辑')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transfers/${PAIR_ID}`));
  });

  test('with history, the breadcrumb steps back instead of going to the parent', async () => {
    const router = renderRouter(ROUTES, { initialUrl: L, wrapper: Wrapper });
    act(() => {
      appRouter.push(NEW_URL as never);
    });

    fireEvent.press(await screen.findByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(L));
  });
});

describe('wide, ?next= and the states before the form', () => {
  beforeEach(() => setWide(true));

  test('编辑: the breadcrumb honours ?next= before the detail', async () => {
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transactions/${TX_ID}/edit?next=${encodeURIComponent(L)}`,
      wrapper: Wrapper,
    });

    await waitFor(() => expect(screen.getByTestId('tx-merchant').props.value).toBe('全家便利店'));
    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(L));
  });

  test('an entry that cannot be read still has its breadcrumb, leading to the detail', async () => {
    api.mock.onGet(apiUrl(`/ledgers/${LEDGER_ID}/transactions/${TX_ID}`)).reply(404, {
      detail: 'gone',
    });
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transactions/${TX_ID}/edit`,
      wrapper: Wrapper,
    });

    expect(await screen.findByTestId('tx-edit-error')).toBeTruthy();
    expect(screen.getByText('交易 · 编辑')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions/${TX_ID}`));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  test('a pair that cannot be read still has its breadcrumb, honouring ?next=', async () => {
    api.mock
      .onGet(apiUrl(`/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`))
      .reply(404, { detail: 'gone' });
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transfers/${PAIR_ID}/edit?next=${encodeURIComponent(`${L}/transactions`)}`,
      wrapper: Wrapper,
    });

    expect(await screen.findByTestId('transfer-edit-error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tx-form-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions`));
  });

  test('while the entry is still loading, the breadcrumb is already there', async () => {
    // A reply that never comes: the screen stays on its skeleton.
    api.mock
      .onGet(apiUrl(`/ledgers/${LEDGER_ID}/transactions/${TX_ID}`))
      .reply(() => new Promise(() => undefined));
    renderRouter(ROUTES, { initialUrl: `${L}/transactions/${TX_ID}/edit`, wrapper: Wrapper });

    expect(await screen.findByTestId('tx-edit-skeleton')).toBeTruthy();
    expect(screen.getByTestId('tx-form-header-back')).toBeTruthy();
    expect(screen.getByText('交易 · 编辑')).toBeTruthy();
  });
});

describe('narrow', () => {
  beforeEach(() => setWide(false));

  test('the page draws no back of its own; the shell’s bar is titled 记一笔', async () => {
    renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

    expect(await screen.findByTestId('tx-amount')).toBeTruthy();
    expect(screen.queryByTestId('tx-form-header-back')).toBeNull();
    expect(screen.getByTestId('top-bar-back')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('top-bar-title')).toHaveTextContent('记一笔'));
  });

  test('a dirty 记一笔 asks before the top bar’s ‹ leaves; staying keeps the amount', async () => {
    const router = renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: Wrapper });

    fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');
    fireEvent.press(screen.getByTestId('top-bar-back'));
    expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-cancel'));
    });
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(router.getPathname()).toBe(NEW_URL);
    expect(screen.getByTestId('tx-amount').props.value).toBe('38.00');

    fireEvent.press(screen.getByTestId('top-bar-back'));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('confirm-accept'));
    });
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions`));
  });

  test('a dirty 编辑 asks before the top bar’s ‹ leaves for the detail', async () => {
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transactions/${TX_ID}/edit`,
      wrapper: Wrapper,
    });

    await waitFor(() => expect(screen.getByTestId('tx-merchant').props.value).toBe('全家便利店'));
    fireEvent.changeText(screen.getByTestId('tx-merchant'), '罗森');
    fireEvent.press(screen.getByTestId('top-bar-back'));
    expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-cancel'));
    });
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(router.getPathname()).toBe(`${L}/transactions/${TX_ID}/edit`);
    expect(screen.getByTestId('tx-merchant').props.value).toBe('罗森');

    fireEvent.press(screen.getByTestId('top-bar-back'));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('confirm-accept'));
    });
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions/${TX_ID}`));
  });

  test('a cold 记一笔 with ?next=: the ‹ goes to next, as the breadcrumb does', async () => {
    const router = renderRouter(ROUTES, {
      initialUrl: `${NEW_URL}?next=${encodeURIComponent(L)}`,
      wrapper: Wrapper,
    });

    fireEvent.press(await screen.findByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(L));
  });

  test('a dirty 编辑 with ?next=: the ‹ asks once, then goes to next', async () => {
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transfers/${PAIR_ID}/edit?next=${encodeURIComponent(L)}`,
      wrapper: Wrapper,
    });

    await waitFor(() => expect(screen.getByTestId('transfer-note').props.value).toBe('还 8 月账单'));
    fireEvent.changeText(screen.getByTestId('transfer-note'), '改了');
    fireEvent.press(screen.getByTestId('top-bar-back'));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('confirm-accept'));
    });
    await waitFor(() => expect(router.getPathname()).toBe(L));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  test('an entry that cannot be read: the ‹ is titled and leads to the detail', async () => {
    api.mock.onGet(apiUrl(`/ledgers/${LEDGER_ID}/transactions/${TX_ID}`)).reply(404, {
      detail: 'gone',
    });
    const router = renderRouter(ROUTES, {
      initialUrl: `${L}/transactions/${TX_ID}/edit`,
      wrapper: Wrapper,
    });

    expect(await screen.findByTestId('tx-edit-error')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('top-bar-title')).toHaveTextContent('编辑'));
    fireEvent.press(screen.getByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions/${TX_ID}`));
  });
});
