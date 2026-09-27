/**
 * `/accounts` — my account list (04 §4.8, §8.3; decisions §3, §14.48, §14.50, §14.62).
 *
 * The screen has two shapes since 屏幕稿 09 (决策 §14.45): narrow keeps one white card per
 * account type with its converted subtotal, wide draws a single table with a
 * 「合计 · 在用」 foot strip. Every rule below holds in both. Since §14.62 the accounts are
 * mine rather than a ledger's: the three numbers are the server's, and every active account
 * carries a 「共享到」 chip per ledger I belong to.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { within } from '@testing-library/react-native';
import i18next from 'i18next';

import type { FinanceSource, Money } from '@/api/types';
import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { formatAmountPlain, formatDate, formatMoney } from '@/i18n/format';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { lightColors } from '@/theme/tokens';
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
  mockPut,
  type MockApi,
  type TestQueryHandlers,
} from '@/test';

import SourcesScreen from '../SourcesScreen';

let queryClient: QueryClient;
let handlers: TestQueryHandlers;
let api: MockApi;

const TRIP_ID = '9a1b2c3d-4444-4555-8666-777788889999';
const LEDGER = makeLedger({ base_currency: 'CNY' });
const TRIP = makeLedger({ id: TRIP_ID, name: '旅行账本', base_currency: 'SGD' });

/** `/accounts` lives outside every ledger (decision §14.62): no `LedgerProvider` here. */
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

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'accounts/index': SourcesScreen,
  'accounts/new': () => <RNText>new account form</RNText>,
  'accounts/[sourceId]/edit': () => <RNText>edit account form</RNText>,
};

const checking = makeSource({
  id: 'src-checking',
  name: '招行储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
  opening_balance: '0.0000',
  balance: '10000.0000',
  balance_base: '10000.0000',
  shared_to: [LEDGER_ID],
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
  shared_to: [],
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
  shared_to: [LEDGER_ID],
});

const ALL: FinanceSource[] = [checking, credit, cash, other, archived];

interface Totals {
  assets: Money | null;
  liabilities: Money | null;
  net_worth: Money | null;
}

/** What the server says for ALL: 10000 + 500 + 1000 (SGD converted), −3204, and the sum. */
const ALL_TOTALS: Totals = {
  assets: '11500.0000',
  liabilities: '-3204.0000',
  net_worth: '8296.0000',
};
const NO_TOTALS: Totals = { assets: '0.0000', liabilities: '0.0000', net_worth: '0.0000' };

function seedList(items: FinanceSource[] = ALL, totals: Totals = ALL_TOTALS): void {
  mockGet('/sources', { items, total: items.length, base_currency: 'CNY', ...totals });
}

function renderList(url = '/accounts'): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, { initialUrl: url, wrapper: Wrapper });
}

/** Switches the layout under test to the 1440 frame. */
function goWide(): void {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
}

/** The three actions moved behind the row's 「···」 menu (屏幕稿 09). */
async function openRowMenu(id: string): Promise<void> {
  fireEvent.press(await screen.findByTestId(`source-menu-${id}`));
}

/** The text a `<Text>` node renders, whatever shape its children take. */
function textOf(testID: string): string {
  return String(screen.getByTestId(testID).props.children);
}

/** Whether a 「共享到」 chip reads as shared (solid, `selected`). */
function chipShared(sid: string, lid: string): boolean {
  return screen.getByTestId(`source-share-${sid}-${lid}`).props.accessibilityState.selected;
}

function chipDisabled(sid: string, lid: string): boolean {
  return screen.getByTestId(`source-share-${sid}-${lid}`).props.accessibilityState.disabled;
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
  mockGet('/ledgers', { items: [LEDGER, TRIP], total: 2 });
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar' } });
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  // A `useIsWide` spy from a layout test must not decide the next test's branch.
  jest.restoreAllMocks();
});

test('it lists my accounts from GET /sources, not a ledger’s', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('source-row-src-checking')).toBeTruthy();
  const gets = api.mock.history.get.map((r) => r.url);
  expect(gets).toContain('/sources');
  expect(gets.some((url) => url?.includes('/ledgers/') && url.endsWith('/sources'))).toBe(false);
  expect(api.mock.history.get.find((r) => r.url === '/sources')?.params).toEqual({
    include_archived: true,
  });
});

test('accounts are grouped into the four types, each with its converted subtotal', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('source-group-checking')).toBeTruthy();
  for (const type of ['checking', 'credit', 'cash', 'other']) {
    expect(screen.getByTestId(`source-group-${type}`)).toBeTruthy();
  }
  // The archived checking account is NOT part of its group's subtotal (decision §14.50).
  // A group subtotal is a standalone figure, so it keeps its symbol like 屏幕稿 09 (§14.59 f).
  expect(textOf('source-subtotal-checking')).toContain(formatMoney('10000.0000', 'CNY', 'zh'));
  expect(textOf('source-subtotal-credit')).toContain(formatMoney('-3204.0000', 'CNY', 'zh'));
  expect(textOf('source-subtotal-cash')).toContain(formatMoney('500.0000', 'CNY', 'zh'));
  // The SGD account's subtotal is its converted value, not its own-currency balance.
  expect(textOf('source-subtotal-other')).toContain(formatMoney('1000.0000', 'CNY', 'zh'));
});

test('a credit card shows its debt as a negative amount, and a foreign account its converted value', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('source-row-src-credit-amount')).toBeTruthy();
  // 屏幕稿 09 paints the debt as a signed number in the expense colour.
  const debt = screen.getByTestId('source-row-src-credit-amount');
  expect(String(debt.props.children)).toBe(formatAmountPlain('-3204.0000', 'CNY'));
  expect(debt).toHaveStyle({ color: lightColors['kind.expense'] });

  expect(String(screen.getByTestId('source-row-src-other-amount-sub').props.children)).toContain(
    formatMoney('1000.0000', 'CNY', 'zh'),
  );
  // A base-currency account has no second line.
  expect(screen.queryByTestId('source-row-src-cash-amount-sub')).toBeNull();
});

test('the wide table gives every account a row, and the foot strip the total of the active ones', async () => {
  goWide();
  seedList();
  renderList();

  expect(await screen.findByTestId('sources-table')).toBeTruthy();
  for (const id of ['src-checking', 'src-credit', 'src-cash', 'src-other']) {
    expect(screen.getByTestId(`source-row-${id}`)).toBeTruthy();
  }
  // The archived account is not in the table above the foot strip.
  expect(screen.queryByTestId('source-row-src-archived')).toBeNull();

  // 折算 column: the converted value plus the rate date, 「—」 in the base currency.
  expect(textOf('source-balance-base-src-other')).toContain('1,000.00');
  expect(textOf('source-converted-src-cash')).toBe('—');

  // 余额 · 原币: 屏幕稿 09 writes a base-currency balance bare — the 币种 column already
  // names the currency — and keeps the symbol only where the two would disagree.
  expect(textOf('source-balance-src-checking')).toBe(formatAmountPlain('10000.0000', 'CNY'));
  expect(textOf('source-balance-src-checking')).not.toContain('¥');
  expect(textOf('source-balance-src-other')).toBe(formatMoney('200.0000', 'SGD', 'zh'));

  // 合计 · 在用 = 10000 − 3204 + 500 + 1000, and the currencies are mixed.
  expect(textOf('sources-net-worth')).toBe(formatAmountPlain('8296.0000', 'CNY'));
  expect(screen.getByTestId('sources-table-mixed')).toBeTruthy();
  // The one column the mockup predates sits between 折算 and 「···」.
  expect(screen.getByTestId('sources-table-head-shared')).toHaveTextContent('共享到');
});

test('the wide page header carries the counts and net worth inline', async () => {
  goWide();
  seedList();
  renderList();

  const meta = String((await screen.findByTestId('sources-meta')).props.children);
  expect(meta).toContain('4 个在用');
  expect(meta).toContain('1 个已归档');
  expect(meta).toContain(formatMoney('8296.0000', 'CNY', 'zh'));
});

test('archived accounts stay out of the three numbers and are folded away by default', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('sources-assets')).toBeTruthy();
  // 屏幕稿 09 · 375: 「资产 37,842.10 · 负债 3,215.00」 — bare; only the net worth keeps 「¥」.
  expect(textOf('sources-assets')).toContain(formatAmountPlain('11500.0000', 'CNY'));
  expect(textOf('sources-liabilities')).toContain(formatAmountPlain('3204.0000', 'CNY'));
  expect(textOf('sources-net-worth')).toContain(formatMoney('8296.0000', 'CNY', 'zh'));
  expect(textOf('sources-excluded-archived')).toContain('1');

  // Folded: the section names the count but no archived row is on screen.
  expect(screen.getByTestId('sources-archived-toggle')).toBeTruthy();
  expect(textOf('sources-archived-count')).toContain('1');
  expect(screen.queryByTestId('source-row-src-archived')).toBeNull();
});

// ------------------------------------------- the three numbers are the server's (§14.62)

test('the three numbers are the server’s totals, not a sum of the rows', async () => {
  // Deliberately not what the rows add up to: the server counts every ledger's entries in
  // my own base currency, and the page must print what it said.
  seedList(ALL, { assets: '20000.0000', liabilities: '-5000.0000', net_worth: '15000.0000' });
  renderList();

  expect(await screen.findByTestId('sources-assets')).toBeTruthy();
  expect(textOf('sources-assets')).toContain(formatAmountPlain('20000.0000', 'CNY'));
  expect(textOf('sources-liabilities')).toContain(formatAmountPlain('5000.0000', 'CNY'));
  expect(textOf('sources-net-worth')).toContain(formatMoney('15000.0000', 'CNY', 'zh'));
  expect(textOf('sources-net-worth')).not.toContain('8,296');
});

test('the wide foot strip and header print the server’s net worth too', async () => {
  goWide();
  seedList(ALL, { assets: '20000.0000', liabilities: '-5000.0000', net_worth: '15000.0000' });
  renderList();

  expect(await screen.findByTestId('sources-table')).toBeTruthy();
  expect(textOf('sources-net-worth')).toBe(formatAmountPlain('15000.0000', 'CNY'));
  expect(textOf('sources-meta')).toContain(formatMoney('15000.0000', 'CNY', 'zh'));
});

test('when the server cannot total my accounts, all three read 「—」 and the page says why', async () => {
  const noRate = { ...other, balance_base: null, balance_rate: null, balance_rate_date: null };
  seedList([checking, credit, cash, noRate, archived], {
    assets: null,
    liabilities: null,
    net_worth: null,
  });
  renderList();

  expect(await screen.findByTestId('sources-assets')).toBeTruthy();
  expect(textOf('sources-net-worth')).toBe('—');
  expect(textOf('sources-assets')).toContain('—');
  expect(textOf('sources-liabilities')).toContain('—');
  expect(textOf('sources-no-rate')).toContain('1');
});

test('?include_archived=1 expands the section, greying each row with its archive date', async () => {
  seedList();
  renderList('/accounts?include_archived=1');

  expect(await screen.findByTestId('source-row-src-archived')).toBeTruthy();
  expect(
    String(screen.getByTestId('source-row-src-archived-amount-sub').props.children),
  ).toContain(formatDate('2026-08-20'));
  // The block says out loud that these balances are out of net worth.
  expect(textOf('sources-archived-hint')).toContain('不计入净资产');
  // Still out of the three numbers while expanded.
  expect(textOf('sources-net-worth')).toContain(formatMoney('8296.0000', 'CNY', 'zh'));
  // Sharing an account nobody can record with means nothing: no chips on archived rows.
  expect(screen.queryByTestId(`source-share-src-archived-${LEDGER_ID}`)).toBeNull();
});

test('the expanded archived block keeps the table columns and stamps each row', async () => {
  goWide();
  seedList();
  renderList('/accounts?include_archived=1');

  // The head strip names what archiving costs and how many accounts are folded in.
  expect(await screen.findByTestId('sources-archived-section')).toBeTruthy();
  expect(textOf('sources-archived-hint')).toContain('不计入净资产');
  expect(textOf('sources-archived-count')).toContain('1');
  // The wide rows reuse the table grid, with 折算 swapped for 「归档于 …」.
  expect(screen.getByTestId('source-row-src-archived')).toBeTruthy();
  expect(textOf('source-archived-at-src-archived')).toContain(formatDate('2026-08-20'));
  // Both cards sit in the same horizontal scroller, so their columns stay lined up.
  expect(screen.getByTestId('sources-archived-hscroll')).toBeTruthy();
  expect(screen.queryByTestId(`source-share-src-archived-${LEDGER_ID}`)).toBeNull();
});

test('both layouts list accounts in the frozen §14.48 type order', async () => {
  // Server order is deliberately shuffled: 现金 first, 储蓄卡 last.
  seedList([cash, other, credit, checking, archived]);
  goWide();
  renderList();

  const table = await screen.findByTestId('sources-table');
  const names = within(table)
    .getAllByTestId(/^source-name-/)
    .map((node) => String(node.props.children));
  expect(names).toEqual([checking.name, credit.name, cash.name, other.name]);
});

test('toggling the archived section is page state: the URL is never rewritten (§14.66 j)', async () => {
  seedList();
  const router = renderList();

  fireEvent.press(await screen.findByTestId('sources-archived-toggle'));
  expect(await screen.findByTestId('source-row-src-archived')).toBeTruthy();
  expect(router.getPathname()).toBe('/accounts');
  expect(router.getSearchParams().include_archived).toBeUndefined();

  fireEvent.press(screen.getByTestId('sources-archived-toggle'));
  await waitFor(() => expect(screen.queryByTestId('source-row-src-archived')).toBeNull());
  expect(router.getSearchParams().include_archived).toBeUndefined();
});

test('?include_archived=1 is read once on entry: folding the section leaves the URL alone', async () => {
  seedList();
  const router = renderList('/accounts?include_archived=1');

  expect(await screen.findByTestId('source-row-src-archived')).toBeTruthy();
  fireEvent.press(screen.getByTestId('sources-archived-toggle'));
  await waitFor(() => expect(screen.queryByTestId('source-row-src-archived')).toBeNull());
  // The entry parameter stays what it was — the fold is not written back as history.
  expect(router.getSearchParams().include_archived).toBe('1');
});

test('the empty state offers the create action', async () => {
  seedList([], NO_TOTALS);
  const router = renderList();

  expect(await screen.findByText('你还没有账户')).toBeTruthy();
  fireEvent.press(screen.getByTestId('sources-empty-primary'));
  await waitFor(() => expect(screen.getByText('new account form')).toBeTruthy());
  expect(router.getPathname()).toBe('/accounts/new');
});

/**
 * The wide header already carries 「新建账户」, so the empty state must not put a second
 * identical primary button under it (屏幕稿 09 shows one call to action, not two).
 */
test('the wide empty page offers exactly one 新建账户 button', async () => {
  goWide();
  seedList([], NO_TOTALS);
  renderList();

  expect(await screen.findByTestId('sources-empty')).toBeTruthy();
  expect(screen.queryByTestId('sources-empty-primary')).toBeNull();

  fireEvent.press(screen.getByTestId('sources-new'));
  await waitFor(() => expect(screen.getByText('new account form')).toBeTruthy());
});

test('pressing a row opens that account for editing', async () => {
  seedList();
  const router = renderList();

  fireEvent.press(await screen.findByTestId('source-row-src-cash'));
  await waitFor(() => expect(router.getPathname()).toBe('/accounts/src-cash/edit'));
});

test('the row menu opens the edit form as well', async () => {
  seedList();
  const router = renderList();

  await openRowMenu('src-cash');
  fireEvent.press(await screen.findByTestId('source-edit-src-cash'));
  await waitFor(() => expect(router.getPathname()).toBe('/accounts/src-cash/edit'));
});

test('archiving confirms with the balance leaving net worth, then PATCHes archived + updated_at', async () => {
  seedList();
  mockPatch('/sources/src-checking', { ...checking, archived: true });
  renderList();

  await openRowMenu('src-checking');
  fireEvent.press(await screen.findByTestId('source-archive-src-checking'));

  const dialog = await screen.findByTestId('confirm-dialog');
  const body = within(dialog).getByText(/将从净资产中移除/);
  expect(String(body.props.children)).toContain(formatMoney('10000.0000', 'CNY', 'zh'));

  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-accept'));
  });

  await waitFor(() => expect(api.mock.history.patch.length).toBe(1));
  const sent = api.mock.history.patch[0];
  expect(sent.url).toBe('/sources/src-checking');
  expect(JSON.parse(sent.data as string)).toEqual({
    archived: true,
    updated_at: checking.updated_at,
  });
});

test('cancelling the archive confirmation sends nothing', async () => {
  seedList();
  renderList();

  await openRowMenu('src-checking');
  fireEvent.press(await screen.findByTestId('source-archive-src-checking'));
  await act(async () => {
    fireEvent.press(await screen.findByTestId('confirm-cancel'));
  });

  expect(api.mock.history.patch.length).toBe(0);
});

test('a delete refused with source_has_transactions explains that archiving is the way out', async () => {
  seedList();
  mockDelete(
    '/sources/src-checking',
    { detail: 'has transactions', code: 'source_has_transactions' },
    409,
  );
  renderList();

  await openRowMenu('src-checking');
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
  expect(api.mock.history.delete[0].url).toBe('/sources/src-checking');
  // The global error toast carried the server's copy as well (04 §3.9).
  await waitFor(() =>
    expect(handlers.notify).toHaveBeenCalledWith('error', expect.any(String), expect.anything()),
  );
});

// ------------------------------------------------------------ 共享到 (decision §14.62)

test('every active account has a chip per ledger I belong to, solid where it is shared', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId(`source-share-src-checking-${LEDGER_ID}`)).toBeTruthy();
  expect(chipShared('src-checking', LEDGER_ID)).toBe(true);
  expect(chipShared('src-checking', TRIP_ID)).toBe(false);
  expect(screen.getByTestId(`source-share-src-checking-${TRIP_ID}`)).toHaveTextContent('旅行账本');
  expect(chipShared('src-credit', LEDGER_ID)).toBe(false);
});

test('the wide table carries the same chips in its 共享到 column', async () => {
  goWide();
  seedList();
  renderList();

  expect(await screen.findByTestId('sources-table')).toBeTruthy();
  expect(await screen.findByTestId(`source-share-src-credit-${TRIP_ID}`)).toBeTruthy();
  expect(chipShared('src-checking', LEDGER_ID)).toBe(true);
});

test('pressing an unshared chip PUTs the share, disabled until the answer lands', async () => {
  seedList();
  let answer: (value: [number]) => void = () => undefined;
  api.mock
    .onPut(apiUrl(`/sources/src-credit/ledgers/${TRIP_ID}`))
    .reply(() => new Promise<[number]>((resolve) => (answer = resolve)));
  renderList();

  fireEvent.press(await screen.findByTestId(`source-share-src-credit-${TRIP_ID}`));

  await waitFor(() => expect(api.mock.history.put.length).toBe(1));
  expect(api.mock.history.put[0].url).toBe(`/sources/src-credit/ledgers/${TRIP_ID}`);
  // Flipped at once, and not pressable again while the request is in flight.
  expect(chipShared('src-credit', TRIP_ID)).toBe(true);
  expect(chipDisabled('src-credit', TRIP_ID)).toBe(true);

  seedList([checking, { ...credit, shared_to: [TRIP_ID] }, cash, other, archived]);
  await act(async () => {
    answer([204]);
  });
  await waitFor(() => expect(chipDisabled('src-credit', TRIP_ID)).toBe(false));
  expect(chipShared('src-credit', TRIP_ID)).toBe(true);
  expect(await screen.findByText('已把「招行信用卡」共享到「旅行账本」')).toBeTruthy();
});

test('pressing a shared chip DELETEs the share', async () => {
  seedList();
  mockDelete(`/sources/src-checking/ledgers/${LEDGER_ID}`, undefined, 204);
  renderList();

  fireEvent.press(await screen.findByTestId(`source-share-src-checking-${LEDGER_ID}`));
  // What the invalidation refetch will find once the DELETE has gone through.
  seedList([{ ...checking, shared_to: [] }, credit, cash, other, archived]);

  await waitFor(() => expect(api.mock.history.delete.length).toBe(1));
  expect(api.mock.history.delete[0].url).toBe(`/sources/src-checking/ledgers/${LEDGER_ID}`);
  expect(api.mock.history.put.length).toBe(0);
  expect(await screen.findByText(/已取消共享「招行储蓄卡」到「家庭账本」/)).toBeTruthy();
  expect(chipShared('src-checking', LEDGER_ID)).toBe(false);
});

test('a failed share rolls the chip back and says which ledger it was about', async () => {
  seedList();
  mockPut(`/sources/src-credit/ledgers/${TRIP_ID}`, { detail: 'nope', code: 'not_found' }, 404);
  renderList();

  fireEvent.press(await screen.findByTestId(`source-share-src-credit-${TRIP_ID}`));

  expect(await screen.findByText('「招行信用卡」在「旅行账本」的共享设置没有改成')).toBeTruthy();
  await waitFor(() => expect(chipShared('src-credit', TRIP_ID)).toBe(false));
  expect(chipDisabled('src-credit', TRIP_ID)).toBe(false);
  // The screen's own toast replaces the global one — the failure is said once.
  expect(handlers.notify).not.toHaveBeenCalledWith('error', expect.anything(), expect.anything());
});

// ----------------------------------------------------------- the title (04 §1.4)

test('the narrow layout publishes the title to the top bar instead of printing it twice', async () => {
  seedList();
  renderList();

  expect(await screen.findByTestId('top-bar-title')).toHaveTextContent('账户');
  expect(screen.queryByTestId('sources-title')).toBeNull();
});

test('the wide layout carries the title on the page', async () => {
  goWide();
  seedList();
  renderList();

  expect(await screen.findByTestId('sources-title')).toHaveTextContent('账户');
});
