/**
 * `/accounts/new[?ledger=<id>]` and `/accounts/:sourceId/edit` (04 §4.9, §8.3; decisions
 * §14.50, §14.52 A13, §14.62).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { within } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import type { FinanceSource, Ledger } from '@/api/types';
import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { LeaveGuardProvider, SubPageTopBar, TopBarProvider, TopBarSurface } from '@/navigation';
import * as breakpoint from '@/theme/useBreakpoint';
import { AuthProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  LEDGER_ID,
  apiUrl,
  makeLedger,
  makeSource,
  makeTestHandlers,
  makeTestQueryClient,
  makeUser,
  mockApi,
  mockDelete,
  mockGet,
  mockPatch,
  mockPost,
  mockPut,
  type MockApi,
} from '@/test';

import SourceFormScreen from '../SourceFormScreen';

let queryClient: QueryClient;
let api: MockApi;

const TRIP_ID = '9a1b2c3d-4444-4555-8666-777788889999';
const LEDGER = makeLedger({ base_currency: 'CNY' });
const TRIP = makeLedger({ id: TRIP_ID, name: '旅行账本', base_currency: 'SGD' });

/** `/accounts*` lives outside every ledger (decision §14.62): no `LedgerProvider` here. */
function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          {/* The real narrow chrome: the page title is published to it, not printed
              on the page (04 §1.4). */}
          <TopBarProvider>
            <TopBarSurface onPressLedger={() => {}} />
            {children}
          </TopBarProvider>
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

/** As `AppShell` draws a narrow sub-page: the ‹ bar, and the leave-guard registry it asks. */
function ShellWrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <LeaveGuardProvider>
            <TopBarProvider>
              <SubPageTopBar />
              {children}
            </TopBarProvider>
          </LeaveGuardProvider>
          <ConfirmHost labels={{ confirm: '确认', cancel: '取消', confirmAgain: '再点一次确认' }} />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'accounts/index': () => <RNText>account list</RNText>,
  'accounts/new': SourceFormScreen,
  'accounts/[sourceId]/edit': SourceFormScreen,
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
  shared_to: [LEDGER_ID],
  updated_at: '2026-09-01T12:00:00.000000Z',
});

/**
 * My accounts, with the server's net worth. 7000 is deliberately not what the rows add up
 * to (10000 − 3204): the preview has to start from the server's number.
 */
function seedList(items: FinanceSource[] = [checking, creditCard]): void {
  mockGet('/sources', {
    items,
    total: items.length,
    base_currency: 'CNY',
    assets: '10000.0000',
    liabilities: '-3204.0000',
    net_worth: '7000.0000',
  });
}

function seedLedgers(items: Ledger[] = [LEDGER, TRIP]): void {
  mockGet('/ledgers', { items, total: items.length });
}

function renderForm(url: string): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, { initialUrl: url, wrapper: Wrapper });
}

const NEW_URL = '/accounts/new';
const EDIT_URL = '/accounts/src-credit/edit';

function chipShared(lid: string): boolean {
  return screen.getByTestId(`source-share-${lid}`).props.accessibilityState.selected;
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId('source-submit'));
  });
}

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = makeTestQueryClient(makeTestHandlers());
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet('/rates/currencies', {
    currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar', USD: 'US Dollar' },
  });
  seedList();
  seedLedgers();
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  // A `useIsWide` spy from a layout test must not decide the next test's branch.
  jest.restoreAllMocks();
});

test('a new account defaults to my base currency and posts what was typed', async () => {
  mockPost('/sources', makeSource({ id: 'new-src', name: '现金', type: 'cash' }));
  renderForm(NEW_URL);

  expect(await screen.findByText('新建账户')).toBeTruthy();
  await waitFor(() =>
    expect(within(screen.getByTestId('source-currency-trigger')).getByText('CNY')).toBeTruthy(),
  );

  fireEvent.changeText(screen.getByTestId('source-name'), '现金');
  fireEvent.press(screen.getByTestId('source-type-cash'));
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '120.5');

  await submit();

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(api.mock.history.post[0].url).toBe('/sources');
  // Nothing ticked under 共享到, so no `share_to` at all.
  expect(JSON.parse(api.mock.history.post[0].data as string)).toEqual({
    name: '现金',
    type: 'cash',
    default_currency: 'CNY',
    opening_balance: '120.5000',
  });
});

test('the default currency is the user’s own, not any ledger’s (§14.62)', async () => {
  // Every ledger here is CNY or SGD-based; the user's own currency is USD.
  mockGet('/me', makeUser({ base_currency: 'USD' }));
  mockPost('/sources', makeSource({ id: 'new-src', name: '美元卡' }));
  renderForm(NEW_URL);

  await waitFor(() =>
    expect(within(screen.getByTestId('source-currency-trigger')).getByText('USD')).toBeTruthy(),
  );
  fireEvent.changeText(screen.getByTestId('source-name'), '美元卡');
  await submit();

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).default_currency).toBe('USD');
});

test('a credit account takes the amount owed as a positive number and stores it negative', async () => {
  mockPost('/sources', makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-type-credit')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '招行信用卡');
  fireEvent.press(screen.getByTestId('source-type-credit'));
  // The field is relabelled: it asks how much you owe (decision §14.52 A13).
  expect(screen.getByText('当前欠款')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '3204');

  await submit();

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).opening_balance).toBe('-3204.0000');
});

test('switching the type across the credit boundary re-signs the stored opening balance', async () => {
  mockPost('/sources', makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-type-checking')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '某卡');
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '3204');
  // checking (+3204 held) → credit (3204 owed): the magnitude stays, the sign flips.
  fireEvent.press(screen.getByTestId('source-type-credit'));

  expect(await screen.findByText(/已按新类型换算期初余额/)).toBeTruthy();

  await submit();
  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  const body = JSON.parse(api.mock.history.post[0].data as string);
  expect(body.type).toBe('credit');
  expect(body.opening_balance).toBe('-3204.0000');
});

test('editing shows a credit card its positive debt and keeps the currency read-only', async () => {
  mockGet('/sources/src-credit', creditCard);
  mockPatch('/sources/src-credit', { ...creditCard, name: '招行信用卡 2' });
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
  await submit();

  await waitFor(() => expect(api.mock.history.patch.length).toBe(1));
  expect(api.mock.history.patch[0].url).toBe('/sources/src-credit');
  const body = JSON.parse(api.mock.history.patch[0].data as string);
  // Only what changed, plus the concurrency stamp — and never the currency.
  expect(body).toEqual({ name: '招行信用卡 2', updated_at: creditCard.updated_at });
  expect(body).not.toHaveProperty('default_currency');
  // The chips were not touched, so there is no sharing call.
  expect(api.mock.history.put.length + api.mock.history.delete.length).toBe(0);
});

test('changing an opening balance previews my net worth before and after, and only saves on confirm', async () => {
  mockGet('/sources/src-credit', creditCard);
  mockPatch('/sources/src-credit', { ...creditCard, opening_balance: '-4204.0000' });
  renderForm(EDIT_URL);

  await waitFor(() =>
    expect(String(screen.getByTestId('source-opening-balance').props.value)).toContain('3,204'),
  );
  fireEvent.changeText(screen.getByTestId('source-opening-balance'), '4204');
  await submit();

  // The server's net worth is 7000, and 1000 more owed makes it 6000.
  const dialog = await screen.findByTestId('confirm-dialog');
  const body = within(dialog).getByText(/净资产/);
  expect(String(body.props.children)).toContain(formatMoney('7000.0000', 'CNY', 'zh'));
  expect(String(body.props.children)).toContain(formatMoney('6000.0000', 'CNY', 'zh'));

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

test('a name another of my accounts already uses is only a soft hint, never an error', async () => {
  mockPost('/sources', makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-name')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '招行信用卡');
  expect(await screen.findByText('已有同名账户，仍会按账户区分')).toBeTruthy();

  // It does not block the submit.
  await submit();
  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
});

test('the archive switch runs the §4.8 confirmation and PATCHes archived + updated_at', async () => {
  mockGet('/sources/src-credit', creditCard);
  mockPatch('/sources/src-credit', { ...creditCard, archived: true });
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
  mockPost('/sources', makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-name')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '备用金');
  await submit();

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).opening_balance).toBe('0.0000');
});

test('a currency quick chip picks that currency without opening the full list', async () => {
  mockPost('/sources', makeSource({ id: 'new-src' }));
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-currency-quick-CNY')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('source-name'), '现金');
  fireEvent.press(screen.getByTestId('source-currency-quick-CNY'));

  await submit();
  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).default_currency).toBe('CNY');
});

// ------------------------------------------------------------ 共享到 (decision §14.62)

test('?ledger=<id> ticks that ledger up front and the new account is shared into it', async () => {
  mockPost('/sources', makeSource({ id: 'new-src', name: '现金' }));
  renderForm(`${NEW_URL}?ledger=${LEDGER_ID}`);

  expect(await screen.findByTestId(`source-share-${LEDGER_ID}`)).toBeTruthy();
  expect(chipShared(LEDGER_ID)).toBe(true);
  expect(chipShared(TRIP_ID)).toBe(false);
  expect(screen.getByTestId('source-share-hint')).toHaveTextContent(
    '共享后该账本的其他成员也能用这张卡记账；你自己在哪本账都能用',
  );

  fireEvent.changeText(screen.getByTestId('source-name'), '现金');
  await submit();

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).share_to).toEqual([LEDGER_ID]);
});

test('a preset ledger alone does not count as a change to leave behind', async () => {
  const router = renderForm(`${NEW_URL}?ledger=${LEDGER_ID}`);

  expect(await screen.findByTestId(`source-share-${LEDGER_ID}`)).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('source-cancel'));
  });
  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(screen.queryByTestId('confirm-dialog')).toBeNull();
});

test('ticking chips on a new account sends every ledger ticked; a stranger ledger is dropped', async () => {
  mockPost('/sources', makeSource({ id: 'new-src', name: '现金' }));
  // Not a ledger I belong to: no chip, and never sent.
  renderForm(`${NEW_URL}?ledger=not-my-ledger`);

  fireEvent.press(await screen.findByTestId(`source-share-${TRIP_ID}`));
  expect(chipShared(TRIP_ID)).toBe(true);
  fireEvent.press(screen.getByTestId(`source-share-${LEDGER_ID}`));
  fireEvent.press(screen.getByTestId(`source-share-${LEDGER_ID}`));
  expect(chipShared(LEDGER_ID)).toBe(false);

  fireEvent.changeText(screen.getByTestId('source-name'), '现金');
  await submit();

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(JSON.parse(api.mock.history.post[0].data as string).share_to).toEqual([TRIP_ID]);
});

test('editing starts the chips at shared_to and sends the PATCH first, then the diff', async () => {
  mockGet('/sources/src-credit', creditCard);
  const order: string[] = [];
  api.mock.onPatch(apiUrl('/sources/src-credit')).reply(() => {
    order.push('patch');
    return [200, { ...creditCard, name: '招行信用卡 2' }];
  });
  api.mock.onPut(apiUrl(`/sources/src-credit/ledgers/${TRIP_ID}`)).reply(() => {
    order.push(`put ${TRIP_ID}`);
    return [204];
  });
  api.mock.onDelete(apiUrl(`/sources/src-credit/ledgers/${LEDGER_ID}`)).reply(() => {
    order.push(`delete ${LEDGER_ID}`);
    return [204];
  });
  const router = renderForm(EDIT_URL);

  await waitFor(() => expect(chipShared(LEDGER_ID)).toBe(true));
  expect(chipShared(TRIP_ID)).toBe(false);

  fireEvent.changeText(screen.getByTestId('source-name'), '招行信用卡 2');
  fireEvent.press(screen.getByTestId(`source-share-${LEDGER_ID}`));
  fireEvent.press(screen.getByTestId(`source-share-${TRIP_ID}`));
  await submit();

  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(order).toEqual(['patch', `put ${TRIP_ID}`, `delete ${LEDGER_ID}`]);
  expect(JSON.parse(api.mock.history.patch[0].data as string)).toEqual({
    name: '招行信用卡 2',
    updated_at: creditCard.updated_at,
  });
});

test('when only the chips changed, there is no PATCH — only the sharing calls', async () => {
  mockGet('/sources/src-credit', creditCard);
  mockPut(`/sources/src-credit/ledgers/${TRIP_ID}`, undefined, 204);
  const router = renderForm(EDIT_URL);

  await waitFor(() => expect(chipShared(LEDGER_ID)).toBe(true));
  fireEvent.press(screen.getByTestId(`source-share-${TRIP_ID}`));
  await submit();

  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(api.mock.history.patch.length).toBe(0);
  expect(api.mock.history.put.map((r) => r.url)).toEqual([
    `/sources/src-credit/ledgers/${TRIP_ID}`,
  ]);
  expect(api.mock.history.delete.length).toBe(0);
});

test('a failed PATCH stops before any sharing call and keeps the form open', async () => {
  mockGet('/sources/src-credit', creditCard);
  mockPatch('/sources/src-credit', { detail: 'boom', code: 'internal_error' }, 500);
  mockPut(`/sources/src-credit/ledgers/${TRIP_ID}`, undefined, 204);
  const router = renderForm(EDIT_URL);

  await waitFor(() => expect(chipShared(LEDGER_ID)).toBe(true));
  fireEvent.changeText(screen.getByTestId('source-name'), '招行信用卡 2');
  fireEvent.press(screen.getByTestId(`source-share-${TRIP_ID}`));
  await submit();

  await waitFor(() => expect(api.mock.history.patch.length).toBe(1));
  expect(await screen.findByTestId('toast-error')).toBeTruthy();
  expect(api.mock.history.put.length).toBe(0);
  expect(router.getPathname()).toBe(EDIT_URL);
});

test('a failed sharing call after the PATCH says so and keeps the form open', async () => {
  mockGet('/sources/src-credit', creditCard);
  mockDelete(`/sources/src-credit/ledgers/${LEDGER_ID}`, { detail: 'x', code: 'not_found' }, 404);
  const router = renderForm(EDIT_URL);

  await waitFor(() => expect(chipShared(LEDGER_ID)).toBe(true));
  fireEvent.press(screen.getByTestId(`source-share-${LEDGER_ID}`));
  await submit();

  expect(await screen.findByText('账户已保存，但共享设置没有全部改成，请重试')).toBeTruthy();
  expect(router.getPathname()).toBe(EDIT_URL);
});

test('with no ledger to share into, the form says so instead of drawing chips', async () => {
  seedLedgers([]);
  renderForm(NEW_URL);

  expect(await screen.findByTestId('source-share-none')).toHaveTextContent(
    '你还没有加入任何账本；加入或新建账本后再回来共享',
  );
  expect(screen.queryByTestId(`source-share-${LEDGER_ID}`)).toBeNull();
});

// ------------------------------------------------------------ leaving (§14.65 g)

test('cancelling an untouched form goes straight back to the list', async () => {
  const router = renderForm(NEW_URL);

  await act(async () => {
    fireEvent.press(await screen.findByTestId('source-cancel'));
  });

  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(screen.queryByTestId('confirm-dialog')).toBeNull();
});

test('cancelling a half-typed form asks; staying keeps it, leaving sends nothing', async () => {
  const router = renderForm(NEW_URL);

  fireEvent.changeText(await screen.findByTestId('source-name'), '不要了');
  fireEvent.press(screen.getByTestId('source-cancel'));
  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-cancel'));
  });
  await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
  expect(router.getPathname()).toBe(NEW_URL);
  expect(screen.getByTestId('source-name').props.value).toBe('不要了');

  fireEvent.press(screen.getByTestId('source-cancel'));
  await act(async () => {
    fireEvent.press(await screen.findByTestId('confirm-accept'));
  });
  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  expect(api.mock.history.post.length).toBe(0);
});

test('a half-typed form: the shell’s ‹ asks before leaving (§14.65 g)', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(false);
  const router = renderRouter(ROUTES, { initialUrl: NEW_URL, wrapper: ShellWrapper });

  fireEvent.changeText(await screen.findByTestId('source-name'), '现金');
  fireEvent.press(screen.getByTestId('top-bar-back'));
  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-cancel'));
  });
  await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
  expect(router.getPathname()).toBe(NEW_URL);
  expect(screen.getByTestId('source-name').props.value).toBe('现金');

  fireEvent.press(screen.getByTestId('top-bar-back'));
  await act(async () => {
    fireEvent.press(await screen.findByTestId('confirm-accept'));
  });
  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(screen.queryByTestId('confirm-dialog')).toBeNull();
});

test('a saved account leaves for the list without asking about the changes just saved', async () => {
  mockPost('/sources', makeSource({ id: 'new-src', name: '现金', type: 'cash' }));
  const router = renderForm(NEW_URL);

  fireEvent.changeText(await screen.findByTestId('source-name'), '现金');
  await submit();

  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(screen.queryByTestId('confirm-dialog')).toBeNull();
});

test('the wide dialog closes back to the list with its × (屏幕稿 09)', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  const router = renderForm(NEW_URL);

  expect(await screen.findByTestId('source-form-dialog')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('source-form-close'));
  });

  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(api.mock.history.post.length).toBe(0);
});

test('the wide dialog sits over the account list, and the backdrop closes it (屏幕稿 09)', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  const router = renderForm(NEW_URL);

  // 屏幕稿 09 draws the form as a modal over the dimmed list, not as a page of its own:
  // the list the route came from is still on screen behind it.
  expect(await screen.findByTestId('source-form-dialog')).toBeTruthy();
  // The layer behind is `aria-hidden`, so it has to be asked for explicitly — which is
  // itself the point: the pointer and the screen reader stay inside the dialog.
  const behind = screen.getByTestId('source-form-behind', { includeHiddenElements: true });
  expect(within(behind).getByTestId('sources-screen', { includeHiddenElements: true })).toBeTruthy();
  expect(
    await within(behind).findByTestId('source-row-src-checking', { includeHiddenElements: true }),
  ).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('source-form-backdrop', { includeHiddenElements: true }));
  });
  await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  expect(api.mock.history.post.length).toBe(0);
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
