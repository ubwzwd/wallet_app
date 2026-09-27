/**
 * The filter half of the transaction list (04 §4.5; §8.3 的「交易列表」行; decision §14.66 e).
 *
 * The filters are the ledger's browsing state, never the address: a control change lands in
 * the `'transactions.filters'` view state (and empty values never do) and in the request,
 * the address stays the bare `/transactions` with no history entry, a list opened *with*
 * filters (an account's entries, a batch's transactions) shows them all, "清空筛选" goes back
 * to none, the wide pager writes `offset`, `import_batch_id` becomes a dismissible chip, the
 * filters survive a trip to a detail page and back, and an empty result with two conditions
 * fires exactly two `limit=1` probes.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router as expoRouter } from 'expo-router';
import i18next from 'i18next';

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../../app/_layout';
import AppGroupLayout from '../../../../app/(app)/_layout';

import { setAuthToken } from '@/api/client';
import type { Transaction, TransactionListParams, TransactionSummary } from '@/api/types';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import { useLedgerViewState } from '@/store';
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
import { TX_FILTERS_KEY, useOpenTransactions } from '../useTxFilters';

const LEDGER = 'ledger-1';
const BATCH_ID = 'batch1234567890';

/** What the next render enters the list with; `undefined` opens it bare. */
let entryFilters: TransactionListParams | undefined;

/**
 * The home page's stand-in: it opens the list with `entryFilters`, the way the home page's
 * account rows and an import batch's 「看交易」 do (§14.66 e).
 */
function EntryPage(): React.JSX.Element {
  const open = useOpenTransactions();
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current || entryFilters === undefined) return;
    opened.current = true;
    open(entryFilters);
  }, [open]);
  return <RNText>home</RNText>;
}

/** The list, plus a readout of the view state it keeps its filters in. */
function ListRoute(): React.JSX.Element {
  const [filters] = useLedgerViewState<TransactionListParams>(TX_FILTERS_KEY, {});
  return (
    <>
      <TransactionsScreen />
      <RNText testID="tx-filters-state">{JSON.stringify(filters)}</RNText>
    </>
  );
}

const ROUTES = {
  _layout: RootLayout,
  index: () => <RNText>landing</RNText>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <RNText>ledgers</RNText>,
  '(app)/home': EntryPage,
  '(app)/transactions/index': ListRoute,
  '(app)/transactions/new': () => <RNText>new transaction</RNText>,
  '(app)/transactions/[txId]/index': () => <RNText>tx detail</RNText>,
  '(app)/transfers/[pairId]/index': () => <RNText>transfer detail</RNText>,
};

/** Open the list — bare, or entered with `filters` from the home page. */
function renderList(filters?: TransactionListParams): ReturnType<typeof renderRouter> {
  entryFilters = filters;
  return renderRouter(ROUTES, { initialUrl: filters ? '/home' : '/transactions' });
}

/** The filters the list currently keeps. */
function filtersNow(): TransactionListParams {
  return JSON.parse(String(screen.getByTestId('tx-filters-state').props.children));
}

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

beforeEach(async () => {
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

test('picking a kind writes it to the filters and the request, not to the address', async () => {
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  const router = renderList();

  fireEvent.press(await screen.findByTestId('tx-filter-bar-kind-expense'));

  // Only the conditions that are actually set are kept.
  await waitFor(() => expect(filtersNow()).toEqual({ kind: ['expense'] }));
  await waitFor(() =>
    expect(listRequests.some((p) => JSON.stringify(p.kind) === JSON.stringify(['expense']))).toBe(
      true,
    ),
  );
  // §14.66 e: the address is the page and nothing else, and no history entry was made.
  expect(router.getPathname()).toBe('/transactions');
  expect(router.getSearchParams()).toEqual({});
  expect(expoRouter.canGoBack()).toBe(false);
});

test('the narrow layout puts the same controls behind a counted filter button', async () => {
  setWide(false);
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  renderList({ kind: ['expense'], currency: ['SGD'] });

  // 屏幕稿 02 · 375: the button carries how many conditions are on; the fields are inside.
  expect(await screen.findByTestId('tx-filter-bar-open-count')).toHaveTextContent('2');
  expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull();

  fireEvent.press(screen.getByTestId('tx-filter-bar-open'));
  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();

  fireEvent.press(screen.getByTestId('tx-filter-bar-kind-income'));
  await waitFor(() => expect(filtersNow().kind).toEqual(['expense', 'income']));
  // The drawer stays open while a second condition is set.
  expect(screen.getByTestId('tx-filter-bar-controls')).toBeTruthy();

  // 「应用」 only closes the drawer: the filters are already applied.
  fireEvent.press(screen.getByTestId('tx-filter-bar-done'));
  await waitFor(() => expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull());
  expect(filtersNow().kind).toEqual(['expense', 'income']);
});

test('the account filter offers every account the ledger names, grouped, balances mine only', async () => {
  setWide(false);
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  renderList();

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
  await waitFor(() => expect(filtersNow().source_id).toEqual(['s4']));
  fireEvent.press(screen.getByTestId('tx-filter-bar-done'));
  // The chip names it, rather than printing an id.
  expect(await screen.findByTestId('tx-filter-bar-chips-source_id-s4')).toHaveTextContent(
    /Bob 的日元卡/,
  );
});

test('the wide account dropdown groups the same way, and a title is never a filter', async () => {
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  renderList();

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
  await waitFor(() => expect(filtersNow().source_id).toEqual(['s3']));
});

test('leaving the screen for good closes the narrow drawer; coming back never reopens it', async () => {
  setWide(false);
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 1 }));
  const router = renderList();

  fireEvent.press(await screen.findByTestId('tx-filter-bar-open'));
  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();

  act(() => expoRouter.push('/transactions/e1'));
  expect(await screen.findByText('tx detail')).toBeTruthy();
  act(() => expoRouter.back());

  await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
  expect(await screen.findByTestId('tx-filter-bar-open')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull();
});

test('the filters and the page survive a trip to a detail page and back', async () => {
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 120 }));
  const router = renderList();

  fireEvent.press(await screen.findByTestId('tx-filter-bar-kind-expense'));
  fireEvent.press(screen.getByTestId('tx-filter-bar-currency-JPY'));
  await waitFor(() => expect(filtersNow()).toEqual({ kind: ['expense'], currency: ['JPY'] }));
  fireEvent.press(await screen.findByTestId('tx-pagination-next'));
  await waitFor(() => expect(filtersNow().offset).toBe(50));

  fireEvent.press(await screen.findByTestId('tx-row-e1'));
  await waitFor(() => expect(router.getPathname()).toBe('/transactions/e1'));
  // One step back is the list — every filter change before it made no history entry.
  act(() => expoRouter.back());
  await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
  expect(expoRouter.canGoBack()).toBe(false);

  expect(filtersNow()).toEqual({ kind: ['expense'], currency: ['JPY'], offset: 50 });
  expect(await screen.findByTestId('tx-filter-bar-chips-kind-expense')).toBeTruthy();
  expect(screen.getByTestId('tx-pagination-page')).toHaveTextContent('第 2 / 3 页');
  const last = listRequests.filter((p) => p.limit !== 1).at(-1);
  expect(last).toMatchObject({ kind: ['expense'], currency: ['JPY'], offset: 50 });
});

test('typing in the search box writes `q` once, 300ms after the last keystroke', async () => {
  serveList(() => ({ items: [], total: 0 }));
  renderList();

  const box = await screen.findByTestId('tx-filter-bar-q');
  fireEvent.changeText(box, '咖');
  fireEvent.changeText(box, '咖啡');
  // Nothing is applied while the user is typing.
  expect(filtersNow().q).toBeUndefined();

  await waitFor(() => expect(filtersNow().q).toBe('咖啡'));
  expect(listRequests.filter((p) => p.q !== undefined).map((p) => p.q)).toEqual(['咖啡']);
});

test('the wide panel stays open while the search box is being typed in', async () => {
  // §14.59b collapses the wide panel once conditions are on, but the keyword the user is
  // still typing is not a finished condition: collapsing there would unmount the box under
  // the caret and force a press on 「筛选」 to type a second character.
  serveList(() => ({ items: [], total: 0 }));
  renderList();

  fireEvent.changeText(await screen.findByTestId('tx-filter-bar-q'), '咖');
  await waitFor(() => expect(filtersNow().q).toBe('咖'));

  expect(screen.getByTestId('tx-filter-bar-q')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-expand')).toBeNull();

  // And refining it keeps working, which is the whole point.
  fireEvent.changeText(screen.getByTestId('tx-filter-bar-q'), '咖啡');
  await waitFor(() => expect(filtersNow().q).toBe('咖啡'));
  expect(screen.getByTestId('tx-filter-bar-q')).toBeTruthy();
});

test('setting the first condition from inside the wide panel does not collapse it', async () => {
  // §14.59b collapses the panel for someone who *arrives* with conditions on; it must not
  // yank the card away on the first pill pressed inside it — worst for 日期区间 / 金额区间,
  // whose second box would unmount before it could be filled.
  serveList(() => ({ items: [], total: 0 }));
  renderList();

  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tx-filter-bar-kind-expense'));
  await waitFor(() => expect(filtersNow().kind).toEqual(['expense']));

  expect(screen.getByTestId('tx-filter-bar-controls')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-expand')).toBeNull();

  // And a second condition still lands, with the card still under the user's hands.
  fireEvent.press(screen.getByTestId('tx-filter-bar-kind-income'));
  await waitFor(() => expect(filtersNow().kind).toEqual(['expense', 'income']));
  expect(screen.getByTestId('tx-filter-bar-controls')).toBeTruthy();
});

test('a filter set from elsewhere still collapses the wide panel to the chip strip', async () => {
  serveList(() => ({ items: [], total: 0 }));
  renderList({ kind: ['expense'] });

  expect(await screen.findByTestId('tx-filter-bar-expand')).toBeTruthy();
  expect(screen.queryByTestId('tx-filter-bar-controls')).toBeNull();

  fireEvent.press(screen.getByTestId('tx-filter-bar-expand'));
  expect(await screen.findByTestId('tx-filter-bar-controls')).toBeTruthy();
});

test('a list opened with filters shows every one of them, several values included', async () => {
  serveList(() => ({ items: [], total: 0 }));
  const router = renderList({
    kind: ['expense', 'refund'],
    source_id: ['s1', 's2'],
    from: '2026-09-01',
    to: '2026-09-30',
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
  expect(router.getPathname()).toBe('/transactions');
  expect(router.getSearchParams()).toEqual({});
});

test('"清空筛选" drops every condition', async () => {
  serveList(() => ({ items: [], total: 0 }));
  const router = renderList({ kind: ['expense'], q: 'coffee', currency: ['SGD'] });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-chips-clear'));

  await waitFor(() => expect(filtersNow()).toEqual({}));
  expect(router.getPathname()).toBe('/transactions');
  await waitFor(() =>
    expect(listRequests.filter((p) => p.limit !== 1).at(-1)).toEqual({ limit: 50 }),
  );
});

test('one chip can be dropped on its own, leaving the others alone', async () => {
  serveList(() => ({ items: [], total: 0 }));
  renderList({ kind: ['expense', 'refund'], currency: ['SGD'] });

  fireEvent.press(await screen.findByTestId('tx-filter-bar-chips-kind-refund-remove'));

  await waitFor(() => expect(filtersNow().kind).toEqual(['expense']));
  expect(filtersNow().currency).toEqual(['SGD']);
});

test('the wide pager writes `offset` into the filters and into the request', async () => {
  serveList(() => ({ items: [makeTransaction({ id: 'e1' })], total: 120 }));
  const router = renderList();

  expect(await screen.findByTestId('tx-pagination-page')).toHaveTextContent('第 1 / 3 页');
  fireEvent.press(screen.getByTestId('tx-pagination-next'));

  await waitFor(() => expect(filtersNow().offset).toBe(50));
  await waitFor(() => expect(listRequests.some((p) => p.offset === 50)).toBe(true));
  expect(screen.getByTestId('tx-pagination-page')).toHaveTextContent('第 2 / 3 页');
  expect(router.getSearchParams()).toEqual({});
});

test('a batch filter shows a "来自导入" chip that can be dismissed', async () => {
  serveList(() => ({ items: [], total: 0 }));
  renderList({ import_batch_id: BATCH_ID });

  const chip = await screen.findByTestId(`tx-filter-bar-chips-import_batch_id-${BATCH_ID}`);
  expect(chip).toHaveTextContent(`来自导入 #${BATCH_ID.slice(0, 6)}`);
  await waitFor(() => expect(listRequests.some((p) => p.import_batch_id === BATCH_ID)).toBe(true));

  fireEvent.press(screen.getByTestId(`tx-filter-bar-chips-import_batch_id-${BATCH_ID}-remove`));

  await waitFor(() => expect(filtersNow()).toEqual({}));
});

test('an empty result with two conditions fires exactly two limit=1 probes', async () => {
  // Everything the screen asks for is empty except the two probes, which each drop one
  // condition: without `kind` there would be 42 rows, without the date range 17.
  serveList((params) => {
    if (params.limit !== 1) return { items: [], total: 0 };
    if (params.kind === undefined) return { items: [], total: 42 };
    return { items: [], total: 17 };
  });

  renderList({ kind: ['expense'], from: '2026-09-01', to: '2026-09-30' });

  const kindSuggestion = await screen.findByTestId('tx-empty-filtered-kind');
  expect(kindSuggestion).toHaveTextContent('去掉「类型：支出」会有 42 笔');
  expect(screen.getByTestId('tx-empty-filtered-date')).toHaveTextContent(/去掉「.+」会有 17 笔/);

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

  await waitFor(() => expect(filtersNow().kind).toBeUndefined());
  expect(filtersNow().from).toBe('2026-09-01');
  expect(filtersNow().to).toBe('2026-09-30');
});
