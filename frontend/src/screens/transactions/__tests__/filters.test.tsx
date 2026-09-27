/**
 * The filter half of the transaction list (04 §1.3, §4.5; §8.3 的「交易列表」行).
 *
 * The URL is the only filter state there is, so every test here reads or writes it: a
 * control change lands in the query string (and empty values never do), a shared link is
 * restored verbatim (repeated keys included), "清空筛选" goes back to the bare path, the
 * wide pager writes `offset`, `?import_batch_id=` becomes a dismissible chip, and an empty
 * result with two conditions fires exactly two `limit=1` probes.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../../app/_layout';
import AppGroupLayout from '../../../../app/(app)/_layout';

import { setAuthToken } from '@/api/client';
import type { Transaction, TransactionListParams, TransactionSummary } from '@/api/types';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import * as breakpoint from '@/theme/useBreakpoint';
import {
  apiUrl,
  makeCategoryTree,
  makeCurrencyList,
  makeLedger,
  makeLedgerSource,
  makeTransaction,
  makeUser,
  mockApi,
  mockGet,
  type MockApi,
} from '@/test';
import { toast } from '@/ui';
import { resetLedgerUnavailable } from '@/navigation';

import TransactionsScreen from '../TransactionsScreen';

const LEDGER = 'ledger-1';
const BATCH_ID = 'batch1234567890';

const ROUTES = {
  _layout: RootLayout,
  index: () => <RNText>landing</RNText>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <RNText>ledgers</RNText>,
  '(app)/l/[ledgerId]/index': () => <RNText>home</RNText>,
  '(app)/l/[ledgerId]/transactions/index': TransactionsScreen,
  '(app)/l/[ledgerId]/transactions/new': () => <RNText>new transaction</RNText>,
  '(app)/l/[ledgerId]/transactions/[txId]/index': () => <RNText>tx detail</RNText>,
  '(app)/l/[ledgerId]/transfers/[pairId]/index': () => <RNText>transfer detail</RNText>,
};

const SOURCE_A = makeLedgerSource({ id: 's1', name: '招行储蓄卡', type: 'checking' });
const SOURCE_B = makeLedgerSource({ id: 's2', name: '建行信用卡', type: 'credit' });
/** Bob's card, shared into this ledger (decision §14.62): no balance of his reaches me. */
const SOURCE_SHARED = makeLedgerSource({
  id: 's3',
  name: 'Bob 的储蓄卡',
  type: 'checking',
  owner_id: 'user-bob',
  mine: false,
});
/** Bob stopped sharing this one; old entries here still sit on it. */
const SOURCE_GONE = makeLedgerSource({
  id: 's4',
  name: 'Bob 的日元卡',
  type: 'cash',
  default_currency: 'JPY',
  owner_id: 'user-bob',
  mine: false,
  usable: false,
});

const SUMMARY: TransactionSummary = {
  base_currency: 'CNY',
  expense: '0.0000',
  income: '0.0000',
  net: '0.0000',
  count: 0,
  rate_missing_count: 0,
};

let api: MockApi;
let wideSpy: jest.SpyInstance;
/** Every `GET .../transactions` the screen made, in order, with its params. */
let listRequests: TransactionListParams[];

function setWide(wide: boolean): void {
  wideSpy?.mockRestore();
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

/**
 * One handler for the list endpoint; `reply` decides what each combination of params
 * returns, which is what the probe test needs (the URL is the same for all of them).
 */
function serveList(
  reply: (params: TransactionListParams) => { items?: Transaction[]; total: number },
): void {
  api.mock.onGet(apiUrl(`/ledgers/${LEDGER}/transactions`)).reply((config) => {
    const params = (config.params ?? {}) as TransactionListParams;
    listRequests.push(params);
    const { items = [], total } = reply(params);
    return [200, { items, total, summary: SUMMARY }];
  });
}

/** The query string, minus the path parameter the router mixes in. */
function searchOf(router: { getSearchParams(): Record<string, string | string[] | undefined> }): Record<
  string,
  string | string[] | undefined
> {
  const { ledgerId: _ledgerId, ...rest } = router.getSearchParams();
  return rest;
}

beforeEach(async () => {
  // The filter bar keeps 「drawer open」 / 「panel open」 in module-level flags so they
  // survive the remount every URL write causes (FilterBar.tsx). The previous test's
  // unmount armed the reset; let it land, or one test's open panel leaks into the next.
  act(() => {
    jest.advanceTimersByTime(1);
  });
  api = mockApi();
  listRequests = [];
  queryClient.clear();
  resetLedgerUnavailable();
  toast.clear();
  await initI18n();
  await i18next.changeLanguage('zh');
  await setAuthToken('test-access-token');

  mockGet('/me', makeUser());
  mockGet('/ledgers', {
    items: [makeLedger({ id: LEDGER, name: '家庭账本', base_currency: 'CNY' })],
    total: 1,
  });
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', makeCurrencyList());
  mockGet(`/ledgers/${LEDGER}/sources`, {
    items: [SOURCE_A, SOURCE_B, SOURCE_SHARED, SOURCE_GONE],
    total: 4,
  });
  setWide(true);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
});

test('picking a kind writes it to the URL, and nothing empty goes with it', async () => {
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-kind-expense'));

  await waitFor(() => expect(searchOf(router).kind).toBe('expense'));
  // 04 §1.3: only the conditions that are actually set are written.
  expect(searchOf(router)).toEqual({ kind: 'expense' });
  expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions`);

  await waitFor(() =>
    expect(listRequests.some((p) => JSON.stringify(p.kind) === JSON.stringify(['expense']))).toBe(
      true,
    ),
  );
});

test('the narrow layout puts the same controls behind a counted filter button', async () => {
  setWide(false);
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER}/transactions?kind=expense&currency=SGD`,
  });

  // 屏幕稿 02 · 375: the button carries how many conditions are on; the fields are inside.
  expect(await screen.findByTestId('tx-filter-bar-open-count')).toHaveTextContent('2');
  expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull();

  fireEvent.press(screen.getByTestId('tx-filter-bar-open'));
  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();

  fireEvent.press(screen.getByTestId('tx-filter-bar-kind-income'));
  await waitFor(() => expect(searchOf(router).kind).toEqual(['expense', 'income']));
  // A filter change replaces the URL and remounts the screen; the drawer has to survive
  // that, or no one could ever set a second condition.
  expect(screen.getByTestId('tx-filter-bar-controls')).toBeTruthy();

  // 「应用」 only closes the drawer: the URL is already the filter state (04 §1.3).
  fireEvent.press(screen.getByTestId('tx-filter-bar-done'));
  await waitFor(() => expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull());
  expect(searchOf(router).kind).toEqual(['expense', 'income']);
});

test('the account filter offers every account the ledger names, grouped, balances mine only', async () => {
  setWide(false);
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-open'));
  expect(await screen.findByTestId('tx-filter-bar-source-group-mine')).toHaveTextContent('我的');
  expect(screen.getByTestId('tx-filter-bar-source-group-shared')).toHaveTextContent('成员共享的');
  // Filtering is about entries already written: an account no longer shared still filters.
  expect(screen.getByTestId('tx-filter-bar-source-s4')).toHaveTextContent(/Bob 的日元卡/);
  // Mine carries its balance; Bob's do not.
  expect(screen.getByTestId('tx-filter-bar-source-s1')).toHaveTextContent(/4,120\.55/);
  expect(screen.getByTestId('tx-filter-bar-source-s3')).not.toHaveTextContent(/\d\.\d\d/);
  // The currency pills come from the same list.
  expect(screen.getByTestId('tx-filter-bar-currency-JPY')).toBeTruthy();

  fireEvent.press(screen.getByTestId('tx-filter-bar-source-s4'));
  await waitFor(() => expect(searchOf(router).source_id).toBe('s4'));
  fireEvent.press(screen.getByTestId('tx-filter-bar-done'));
  // The chip names it, rather than printing an id.
  expect(await screen.findByTestId('tx-filter-bar-chips-source_id-s4')).toHaveTextContent(
    /Bob 的日元卡/,
  );
});

test('the wide account dropdown groups the same way, and a title is never a filter', async () => {
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-source-trigger'));
  const titleMine = await screen.findByTestId('tx-filter-bar-source-option-__group-mine');
  expect(titleMine).toHaveTextContent('我的');
  expect(screen.getByTestId('tx-filter-bar-source-option-__group-shared')).toHaveTextContent(
    '成员共享的',
  );
  const order = screen
    .getAllByTestId(/^tx-filter-bar-source-option-/)
    .map((node) => String(node.props.testID).replace('tx-filter-bar-source-option-', ''));
  expect(order).toEqual(['__group-mine', 's1', 's2', '__group-shared', 's3', 's4']);

  fireEvent.press(titleMine);
  fireEvent.press(screen.getByTestId('tx-filter-bar-source-option-s3'));
  await waitFor(() => expect(searchOf(router).source_id).toBe('s3'));
});

test('leaving the screen for good closes the narrow drawer; coming back never reopens it', async () => {
  setWide(false);
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  const first = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-open'));
  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();

  // Unlike the remount a filter change causes, this is a real departure: one tick passes
  // with nothing mounted, so the drawer flag is dropped.
  first.unmount();
  act(() => {
    jest.advanceTimersByTime(1);
  });

  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });
  expect(await screen.findByTestId('tx-filter-bar-open')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull();
});

test('typing in the search box writes `q` once, 300ms after the last keystroke', async () => {
  serveList(() => ({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  const box = await screen.findByTestId('tx-filter-bar-q');
  fireEvent.changeText(box, '咖');
  fireEvent.changeText(box, '咖啡');
  // Still nothing in the URL while the user is typing.
  expect(searchOf(router).q).toBeUndefined();

  await waitFor(() => expect(searchOf(router).q).toBe('咖啡'));
  expect(listRequests.filter((p) => p.q !== undefined).map((p) => p.q)).toEqual(['咖啡']);
});

test('the wide panel stays open while the search box is being typed in', async () => {
  // §14.59b collapses the wide panel once conditions are on, but the keyword the user is
  // still typing is not a finished condition: collapsing there would unmount the box under
  // the caret and force a press on 「筛选」 to type a second character.
  serveList(() => ({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  fireEvent.changeText(await screen.findByTestId('tx-filter-bar-q'), '咖');
  await waitFor(() => expect(searchOf(router).q).toBe('咖'));

  expect(screen.getByTestId('tx-filter-bar-q')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-expand')).toBeNull();

  // And refining it keeps working, which is the whole point.
  fireEvent.changeText(screen.getByTestId('tx-filter-bar-q'), '咖啡');
  await waitFor(() => expect(searchOf(router).q).toBe('咖啡'));
  expect(screen.getByTestId('tx-filter-bar-q')).toBeTruthy();
});

test('setting the first condition from inside the wide panel does not collapse it', async () => {
  // §14.59b collapses the panel for someone who *arrives* with conditions on; it must not
  // yank the card away on the first pill pressed inside it — worst for 日期区间 / 金额区间,
  // whose second box would unmount before it could be filled.
  serveList(() => ({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tx-filter-bar-kind-expense'));
  await waitFor(() => expect(searchOf(router).kind).toBe('expense'));

  expect(screen.getByTestId('tx-filter-bar-controls')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-expand')).toBeNull();

  // And a second condition still lands, with the card still under the user's hands.
  fireEvent.press(screen.getByTestId('tx-filter-bar-kind-income'));
  await waitFor(() => expect(searchOf(router).kind).toEqual(['expense', 'income']));
  expect(screen.getByTestId('tx-filter-bar-controls')).toBeTruthy();
});

test('a filter set from elsewhere still collapses the wide panel to the chip strip', async () => {
  serveList(() => ({ items: [], total: 0 }));
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions?kind=expense` });

  expect(await screen.findByTestId('tx-filter-bar-expand')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull();

  fireEvent.press(screen.getByTestId('tx-filter-bar-expand'));
  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();
});

test('a shared URL is restored verbatim, repeated keys included', async () => {
  serveList(() => ({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER}/transactions?kind=expense&kind=refund&source_id=s1&source_id=s2&from=2026-09-01&to=2026-09-30`,
  });

  await screen.findByTestId('tx-filter-bar');
  await waitFor(() => expect(listRequests.length).toBeGreaterThan(0));

  // The list request itself — the empty result also triggers the two `limit=1` probes.
  const sent = listRequests.filter((p) => p.limit !== 1)[0];
  expect(sent.kind).toEqual(['expense', 'refund']);
  expect(sent.source_id).toEqual(['s1', 's2']);
  expect(sent.from).toBe('2026-09-01');
  expect(sent.to).toBe('2026-09-30');

  // Both kinds and both accounts get their own chip, named rather than coded.
  expect(screen.getByTestId('tx-filter-bar-chips-kind-expense')).toHaveTextContent('类型：支出');
  expect(screen.getByTestId('tx-filter-bar-chips-kind-refund')).toHaveTextContent('类型：退款');
  expect(screen.getByTestId('tx-filter-bar-chips-source_id-s1')).toHaveTextContent(
    '账户：招行储蓄卡',
  );
  expect(searchOf(router).kind).toEqual(['expense', 'refund']);
});

test('"清空筛选" goes back to the bare path', async () => {
  serveList(() => ({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER}/transactions?kind=expense&q=coffee&currency=SGD`,
  });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-chips-clear'));

  await waitFor(() => expect(searchOf(router)).toEqual({}));
  expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions`);
});

test('one chip can be dropped on its own, leaving the others alone', async () => {
  serveList(() => ({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER}/transactions?kind=expense&kind=refund&currency=SGD`,
  });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-chips-kind-refund-remove'));

  await waitFor(() => expect(searchOf(router).kind).toBe('expense'));
  expect(searchOf(router).currency).toBe('SGD');
});

test('the wide pager writes `offset` into the URL and into the request', async () => {
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 120 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-pagination-page')).toHaveTextContent('第 1 / 3 页');
  fireEvent.press(screen.getByTestId('tx-pagination-next'));

  await waitFor(() => expect(searchOf(router).offset).toBe('50'));
  await waitFor(() => expect(listRequests.some((p) => p.offset === 50)).toBe(true));
  expect(screen.getByTestId('tx-pagination-page')).toHaveTextContent('第 2 / 3 页');
});

test('?import_batch_id= shows a "来自导入" chip that can be dismissed', async () => {
  serveList(() => ({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER}/transactions?import_batch_id=${BATCH_ID}`,
  });

  const chip = await screen.findByTestId(`tx-filter-bar-chips-import_batch_id-${BATCH_ID}`);
  expect(chip).toHaveTextContent(`来自导入 #${BATCH_ID.slice(0, 6)}`);
  await waitFor(() =>
    expect(listRequests.some((p) => p.import_batch_id === BATCH_ID)).toBe(true),
  );

  fireEvent.press(
    screen.getByTestId(`tx-filter-bar-chips-import_batch_id-${BATCH_ID}-remove`),
  );

  await waitFor(() => expect(searchOf(router)).toEqual({}));
});

test('an empty result with two conditions fires exactly two limit=1 probes', async () => {
  // Everything the screen asks for is empty except the two probes, which each drop one
  // condition: without `kind` there would be 42 rows, without the date range 17.
  serveList((params) => {
    if (params.limit !== 1) return { items: [], total: 0 };
    if (params.kind === undefined) return { items: [], total: 42 };
    return { items: [], total: 17 };
  });

  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER}/transactions?kind=expense&from=2026-09-01&to=2026-09-30`,
  });

  const kindSuggestion = await screen.findByTestId('tx-empty-filtered-kind');
  expect(kindSuggestion).toHaveTextContent('去掉「类型：支出」会有 42 笔');
  expect(screen.getByTestId('tx-empty-filtered-date')).toHaveTextContent(
    /去掉「.+」会有 17 笔/,
  );

  // The page header's own 「共 M 笔」 probe is a `limit=1` request too, but it carries no
  // condition at all; the rescue probes are the ones that keep the rest of the filter set.
  const headerProbes = listRequests.filter(
    (p) => p.limit === 1 && p.kind === undefined && p.from === undefined,
  );
  expect(headerProbes).toHaveLength(1);
  const probes = listRequests.filter(
    (p) => p.limit === 1 && (p.kind !== undefined || p.from !== undefined),
  );
  expect(probes).toHaveLength(2);
  // Decision §14.52 A15: one probe per candidate, never a full sweep.
  expect(probes[0].kind).toBeUndefined();
  expect(probes[0].from).toBe('2026-09-01');
  expect(probes[1].kind).toEqual(['expense']);
  expect(probes[1].from).toBeUndefined();

  fireEvent.press(kindSuggestion);

  await waitFor(() => expect(searchOf(router).kind).toBeUndefined());
  expect(searchOf(router).from).toBe('2026-09-01');
  expect(searchOf(router).to).toBe('2026-09-30');
});
