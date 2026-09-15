/**
 * The home page (screen 01 / 15, 04 §4.4; decisions §7, §8, §14.50, §14.52 A21/B20, §14.56).
 *
 * The whole route tree is mounted (root layout → app group → ledger layout) so the screen
 * runs against the real guards, the real `LedgerContext` and the real shell, and the
 * assertions are on what the server was asked for and what ended up on screen.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { within } from '@testing-library/react-native';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`; fonts never gate rendering, so the root layout's
// `useAppFonts()` is stubbed exactly as the navigation tests do.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../../app/_layout';
import AppGroupLayout from '../../../../app/(app)/_layout';
import LedgerLayout from '../../../../app/(app)/l/[ledgerId]/_layout';
import HomeRoute from '../../../../app/(app)/l/[ledgerId]/index';

import type {
  FinanceSource,
  Money,
  StatsCategoryNode,
  StatsSummary,
  StatsTrend,
  Transaction,
} from '@/api/types';
import { setAuthToken } from '@/api/client';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import { resetLedgerGone } from '@/navigation';
import * as breakpoint from '@/theme/useBreakpoint';
import {
  makeCategoryTree,
  makeLedger,
  makeSource,
  makeStatsSummary,
  makeStatsTrend,
  makeTransaction,
  makeTransferPair,
  makeUser,
} from '@/test/fixtures';
import { apiUrl, mockApi, mockGet, type MockApi } from '@/test/mockApi';
import { toast } from '@/ui';
import { PREF_NAMES, setJsonPref, setPref } from '@/utils/prefs';

import { resolveMonth } from '../HomeScreen';
import { trendStats } from '../TrendSection';

const LEDGER = 'ledger-home';
const MONTH = '2026-09';
const HOME_URL = `/l/${LEDGER}?month=${MONTH}`;
const SOURCES_PATH = `/ledgers/${LEDGER}/sources`;
const SUMMARY_PATH = `/ledgers/${LEDGER}/stats/summary`;
const TREND_PATH = `/ledgers/${LEDGER}/stats/trend`;
const TX_PATH = `/ledgers/${LEDGER}/transactions`;

const SERVER_ERROR = { detail: 'boom', code: 'internal_error' };

const ROUTES = {
  _layout: RootLayout,
  index: () => <RNText>landing</RNText>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <RNText>ledgers-page</RNText>,
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': HomeRoute,
  '(app)/l/[ledgerId]/transactions/index': () => <RNText>transactions-page</RNText>,
  '(app)/l/[ledgerId]/transactions/new': () => <RNText>new-transaction-page</RNText>,
  '(app)/l/[ledgerId]/transactions/[txId]/index': () => <RNText>transaction-page</RNText>,
  '(app)/l/[ledgerId]/transfers/[pairId]/index': () => <RNText>transfer-page</RNText>,
  '(app)/l/[ledgerId]/sources/index': () => <RNText>sources-page</RNText>,
  '(app)/l/[ledgerId]/sources/new': () => <RNText>new-source-page</RNText>,
  '(app)/l/[ledgerId]/imports/new': () => <RNText>new-import-page</RNText>,
  '(app)/l/[ledgerId]/settings/index': () => <RNText>ledger-settings-page</RNText>,
};

let api: MockApi;

/** Four accounts covering every rule of `sumSources` (decision §14.50). */
function mixedSources(): FinanceSource[] {
  return [
    makeSource({
      id: 'src-checking',
      name: '招商 储蓄卡',
      type: 'checking',
      default_currency: 'CNY',
      balance: '1000.0000',
      balance_base: '1000.0000',
    }),
    makeSource({
      id: 'src-credit',
      name: '中信 信用卡',
      type: 'credit',
      default_currency: 'CNY',
      balance: '-400.0000',
      balance_base: '-400.0000',
    }),
    makeSource({
      id: 'src-archived',
      name: '旧账户',
      type: 'checking',
      archived: true,
      archived_at: '2026-05-01T00:00:00.000000Z',
      balance: '9999.0000',
      balance_base: '9999.0000',
    }),
    makeSource({
      id: 'src-no-rate',
      name: '日元现金',
      type: 'cash',
      default_currency: 'JPY',
      balance: '50000.0000',
      balance_base: null,
      balance_rate: null,
      balance_rate_date: null,
    }),
  ];
}

/** `GET /transactions` as the home page's 「最近」 block asks for it. */
function txList(items: Transaction[]): unknown {
  return {
    items,
    total: items.length,
    summary: {
      base_currency: 'CNY',
      expense: '0.0000',
      income: '0.0000',
      net: '0.0000',
      count: items.length,
      rate_missing_count: 0,
    },
  };
}

/**
 * The four home-page endpoints. Handlers are registered per test rather than in
 * `beforeEach` because axios-mock-adapter keeps the FIRST handler that matches a URL — a
 * second registration would be ignored, not an override.
 */
function mockHome(
  opts: {
    sources?: FinanceSource[];
    sourcesStatus?: number;
    summary?: StatsSummary;
    summaryStatus?: number;
    trend?: StatsTrend;
    recent?: Transaction[];
    recentStatus?: number;
  } = {},
): void {
  if (opts.sourcesStatus !== undefined) {
    mockGet(SOURCES_PATH, SERVER_ERROR, opts.sourcesStatus);
  } else {
    const items = opts.sources ?? mixedSources();
    mockGet(SOURCES_PATH, { items, total: items.length });
  }

  if (opts.summaryStatus !== undefined) {
    mockGet(SUMMARY_PATH, SERVER_ERROR, opts.summaryStatus);
  } else {
    mockGet(SUMMARY_PATH, opts.summary ?? makeStatsSummary({ month: MONTH }));
  }

  mockGet(TREND_PATH, opts.trend ?? makeStatsTrend());

  if (opts.recentStatus !== undefined) {
    mockGet(TX_PATH, SERVER_ERROR, opts.recentStatus);
  } else {
    mockGet(TX_PATH, txList(opts.recent ?? []));
  }
}

function node(code: string, amount: Money, share: number): StatsCategoryNode {
  return {
    code,
    name_zh: `分类${code}`,
    name_en: `Category ${code}`,
    amount,
    share,
    count: 1,
    children: [],
  };
}

/** A month with nothing in it — what `GET /stats/summary` returns for an untouched month. */
function emptySummary(month: string): StatsSummary {
  return makeStatsSummary({
    month,
    expense_total: '0.0000',
    income_total: '0.0000',
    net: '0.0000',
    expense: [],
    income: [],
    refund_total: '0.0000',
  });
}

/** The query params of every `GET` the adapter recorded for `path`, oldest first. */
function getsFor(path: string): Array<Record<string, unknown>> {
  return api.mock.history.get
    .filter((entry) => entry.url === path || entry.url === apiUrl(path))
    .map((entry) => (entry.params ?? {}) as Record<string, unknown>);
}

/** `toHaveTextContent` compares the WHOLE subtree's text, so a composite node needs a
 *  substring match — hence the escaped regexp rather than a bare string. */
function containing(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** The mockups give the wide layout a different composition, not different behaviour. */
function useWideLayout(): void {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
}

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  // The app's own client retries a 5xx twice with backoff (04 §2.4); a test asserting on
  // the error branch would otherwise sit through the waits.
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false, gcTime: 0 },
  });
  resetLedgerGone();
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, null);
  await setJsonPref(PREF_NAMES.categories, null);
  await setAuthToken('test-access-token');

  mockGet('/me', makeUser());
  mockGet('/ledgers', {
    items: [makeLedger({ id: LEDGER, name: '家庭账本', base_currency: 'CNY', role: 'owner' })],
    total: 1,
  });
  mockGet('/categories', makeCategoryTree());
});

afterEach(async () => {
  api.restore();
  queryClient.clear();
  toast.clear();
  jest.restoreAllMocks();
  await setJsonPref(PREF_NAMES.categories, null);
});

// --------------------------------------------------------------- pure helpers

describe('resolveMonth', () => {
  test('keeps a valid past month and falls back for anything else', () => {
    expect(resolveMonth('2026-03', '2026-09')).toBe('2026-03');
    expect(resolveMonth(undefined, '2026-09')).toBe('2026-09');
    expect(resolveMonth('nonsense', '2026-09')).toBe('2026-09');
    expect(resolveMonth('2026-13', '2026-09')).toBe('2026-09');
  });

  test('never walks past the current month', () => {
    expect(resolveMonth('2027-01', '2026-09')).toBe('2026-09');
    expect(resolveMonth(['2027-01'], '2026-09')).toBe('2026-09');
  });
});

describe('trendStats', () => {
  test('the average is the decimal sum over the number of months, not a float mean', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      expense: (i === 6 ? '3600.0000' : '1200.0000') as Money,
    }));
    expect(trendStats(months)).toEqual({
      average: '1400.0000',
      peak: '3600.0000',
      peakMonth: '2026-07',
    });
  });
});

// ------------------------------------------------- the header: net worth, assets, liabilities

test('assets, liabilities and net worth follow the sumSources rules', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  // Credit cards go to liabilities and are shown as a positive "owed" figure; the archived
  // account is in none of the three numbers; the unconvertible one is not read as 0.
  // §14.59a: the two sums are bare, only the net-worth figure keeps the 「¥」.
  expect(await router.findByTestId('home-assets')).toHaveTextContent(containing('1,000.00'));
  expect(router.getByTestId('home-liabilities')).toHaveTextContent(containing('负债 400.00'));
  expect(router.getByTestId('home-net-worth')).toHaveTextContent(containing('¥600.00'));
  expect(router.getByTestId('home-archived-hint')).toHaveTextContent('不含 1 个已归档账户');
  expect(router.getByTestId('home-unconvertible-hint')).toHaveTextContent(
    '有 1 个账户暂时无法折算',
  );
});

test('the month totals sit in the header, expense first (screen 01)', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  // `expense_total` already has the month's refunds deducted (decision §7). 屏幕稿 01 writes
  // both tiles bare — 「6,842.50」 — so neither carries a 「¥」 (§14.59a).
  expect(await router.findByTestId('home-expense-total')).toHaveTextContent(
    containing('8,421.66'),
  );
  expect(router.getByTestId('home-expense-total')).not.toHaveTextContent(containing('¥'));
  expect(router.getByTestId('home-expense-total')).toHaveTextContent(containing('9月支出'));
  expect(router.getByTestId('home-income-total')).toHaveTextContent(containing('23,500.00'));
});

test('the narrow shell keeps its ledger pill and adds no page title (screen 01 at 375)', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  await router.findByTestId('home-assets');
  expect(router.getByTestId('top-bar-ledger')).toHaveTextContent('家庭账本');
  expect(router.queryByTestId('top-bar-title')).toBeNull();
});

test('the archived line opens the account list with the archived group expanded', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  fireEvent.press(await router.findByTestId('home-archived-hint'));

  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/sources`));
  expect(router.getSearchParams().include_archived).toBe('1');
});

test('the account list is requested with the archived accounts included', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });
  await router.findByTestId('home-assets');

  expect(getsFor(SOURCES_PATH)).toEqual([{ include_archived: true }]);
});

// ------------------------------------------------------------------ block: the accounts

test('an account row links to the transaction list filtered to that account', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  const row = await router.findByTestId('home-balance-src-checking');
  // A base-currency balance is bare in the accounts card too (屏幕稿 01: 「12,480.35」).
  expect(router.getByTestId('home-balance-src-checking-amount')).toHaveTextContent('1,000.00');
  // The archived account never shows up as a row.
  expect(router.queryByTestId('home-balance-src-archived')).toBeNull();

  fireEvent.press(row);
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions`));
  expect(router.getSearchParams().source_id).toBe('src-checking');
});

/**
 * The home card and 04 §4.8's account page list the same accounts, so they list them in the
 * same order: the frozen §14.48 type order 储蓄卡 → 信用卡 → 现金 → 其他, whatever order the
 * server happened to send.
 */
test('the accounts card reads in the frozen type order, not the order the server sent', async () => {
  mockHome({
    sources: [
      makeSource({ id: 'src-cash', name: '钱包现金', type: 'cash', balance: '100.0000' }),
      makeSource({ id: 'src-other', name: '其他账户', type: 'other', balance: '100.0000' }),
      makeSource({ id: 'src-credit', name: '信用卡', type: 'credit', balance: '-100.0000' }),
      makeSource({ id: 'src-checking', name: '储蓄卡', type: 'checking', balance: '100.0000' }),
    ],
  });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  await router.findByTestId('home-balance-src-checking');
  const order = ['src-checking', 'src-credit', 'src-cash', 'src-other'];
  order.forEach((id, i) => {
    const slot = router.getByTestId(`home-balances-card-slot-${i}`);
    expect(within(slot).getByTestId(`home-balance-${id}`)).toBeTruthy();
  });
});

test('a foreign-currency account without a rate says so instead of showing a converted 0', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-balance-src-no-rate-amount-sub')).toHaveTextContent(
    '暂无汇率',
  );
});

test('the accounts header links to the account list', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  fireEvent.press(await router.findByTestId('home-accounts-header-link'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/sources`));
});

// ------------------------------------------------------------ block: the month's categories

test('the ranking shows the top 8 level-1 categories plus one "N more" row', async () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    node(`cat${i}`, `${(10 - i) * 100}.0000` as Money, (10 - i) / 55),
  );
  mockHome({
    summary: makeStatsSummary({ month: MONTH, expense: many, expense_total: '5500.0000' }),
  });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-categories-row-cat0')).toBeTruthy();
  expect(router.getByTestId('home-categories-row-cat7')).toBeTruthy();
  expect(router.queryByTestId('home-categories-row-cat8')).toBeNull();
  expect(router.getByTestId('home-categories-rest')).toHaveTextContent(containing('其他 2 项'));
});

test('a level-1 row carries the category cache’s classification hint', async () => {
  mockHome({
    summary: makeStatsSummary({
      month: MONTH,
      expense: [
        {
          ...node('food', '2310.5000', 0.4),
          children: [
            { code: 'lunch', name_zh: '午餐', name_en: 'Lunch', amount: '980.0000', count: 22 },
          ],
        },
      ],
    }),
  });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  // The stats endpoint sends no `desc_*`; it comes from `GET /categories` (decision §14.21)
  // and is revealed when the row is opened. Opening it also drills into level 2.
  fireEvent.press(await router.findByTestId('home-categories-row-food'));
  expect(await router.findByTestId('home-categories-desc-food')).toHaveTextContent(
    '餐饮的归类判据',
  );
  expect(router.getByText('午餐')).toBeTruthy();
});

test('the month total, the deducted refunds and the missing-rate count are all shown', async () => {
  mockHome({
    summary: makeStatsSummary({ month: MONTH, refund_total: '82.9800', rate_missing_count: 3 }),
  });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-categories-total')).toHaveTextContent(
    containing('8,421.66'),
  );
  expect(router.getByTestId('home-refund-note')).toHaveTextContent('其中已冲减退款 82.98');
  expect(router.getByTestId('home-summary-rate-missing')).toHaveTextContent(
    '3 笔因暂无汇率未计入',
  );
});

test('a month with no transactions offers "add a transaction" prefilled as an expense', async () => {
  mockHome({ summary: emptySummary(MONTH) });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-summary-empty')).toHaveTextContent(
    containing('这个月还没有记账'),
  );
  // Screen 15: the striped placeholder shows what will grow here instead of a blank card.
  expect(router.getByTestId('home-summary-empty-ghost')).toBeTruthy();
  fireEvent.press(router.getByTestId('home-summary-empty-primary'));

  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/new`));
  expect(router.getSearchParams().kind).toBe('expense');
});

/**
 * 「N 月支出 · 按分类」 only ever draws expense rows, so a month that holds nothing but a
 * salary has nothing to put in the card: it gets the same empty block as a month with no
 * entries at all, not a bare white sliver headed 「共 ¥0.00」.
 */
test('a month with income but no expenses still shows the empty block, not an empty card', async () => {
  mockHome({
    summary: makeStatsSummary({
      month: MONTH,
      expense_total: '0.0000',
      expense: [],
      income_total: '18000.0000',
      income: [
        {
          code: 'salary',
          name_zh: '工资',
          name_en: 'Salary',
          amount: '18000.0000',
          share: 1,
          count: 1,
          children: [],
        },
      ],
      refund_total: '0.0000',
    }),
  });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  // ...and it says 「这个月还没有支出」, not 「这个月还没有记账」, which the 「9月收入 ¥18,000.00」
  // in the header right above it would contradict.
  expect(await router.findByTestId('home-summary-empty')).toHaveTextContent(
    containing('这个月还没有支出'),
  );
  expect(router.queryByTestId('home-categories')).toBeNull();
  expect(router.queryByTestId('home-categories-rest')).toBeNull();
});

test('switching the month rewrites ?month= and refetches the summary for it', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });
  await router.findByTestId('home-categories-total');
  expect(getsFor(SUMMARY_PATH)).toEqual([{ month: '2026-09' }]);

  fireEvent.press(router.getByTestId('home-month-prev'));

  await waitFor(() => expect(router.getSearchParams().month).toBe('2026-08'));
  await waitFor(() => expect(getsFor(SUMMARY_PATH)).toContainEqual({ month: '2026-08' }));
  // The trend is keyed on the ledger, not the month: changing months must not refetch it.
  expect(getsFor(TREND_PATH)).toEqual([{ months: 12 }]);
});

test('the month switcher never walks past the current month', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  const next = await router.findByTestId('home-month-next');
  expect(next).toBeDisabled();
});

// ------------------------------------------------------------------- block: the trend

test('the trend keeps the monthly average and the peak, and a column switches the month', async () => {
  useWideLayout();
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    expense: (i === 3 ? '3600.0000' : '1200.0000') as Money,
  }));
  mockHome({ trend: makeStatsTrend({ months }) });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-trend-average')).toHaveTextContent('月均 1,400.00');
  expect(router.getByTestId('home-trend-peak')).toHaveTextContent('峰值 3,600.00（4月）');

  fireEvent.press(router.getByTestId('home-trend-chart-point-2026-04'));
  await waitFor(() => expect(router.getSearchParams().month).toBe('2026-04'));
  await waitFor(() => expect(getsFor(SUMMARY_PATH)).toContainEqual({ month: '2026-04' }));
});

test('the narrow trend header keeps the average alone (screen 01 at 375)', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-trend-average')).toBeTruthy();
  expect(router.queryByTestId('home-trend-peak')).toBeNull();
});

// ------------------------------------------------------------------ block: 「最近」

test('the recent block asks for five transactions and merges a transfer into one row', async () => {
  const pair = makeTransferPair();
  mockHome({
    recent: [
      makeTransaction({ id: 'tx-coffee', merchant: '瑞幸咖啡', source_id: 'src-checking' }),
      makeTransaction({
        id: 'tx-salary', kind: 'income', merchant: '公司', amount: '3000.0000',
        source_id: 'src-checking', category_l1: 'salary', category_l2: null,
      }),
      pair.out,
      pair.in,
    ],
  });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  const row = await router.findByTestId('home-recent-tx-coffee');
  expect(row).toHaveTextContent(containing('瑞幸咖啡'));
  expect(router.getByTestId('home-recent-tx-coffee-amount')).toHaveTextContent('−128.50');
  // 屏幕稿 01 signs both directions in the 最近 list: 「+199.00」, not 「199.00」.
  expect(router.getByTestId('home-recent-tx-salary-amount')).toHaveTextContent('+3,000.00');
  // One row for the pair, not two legs.
  expect(router.getByTestId(`home-recent-${pair.pair_id}`)).toBeTruthy();
  expect(router.queryByTestId(`home-recent-${pair.out.id}`)).toBeNull();
  expect(getsFor(TX_PATH)).toEqual([{ limit: 5 }]);

  fireEvent.press(row);
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/tx-coffee`),
  );
});

test('the recent header links to the full transaction list', async () => {
  mockHome({ recent: [makeTransaction({ id: 'tx-1' })] });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  fireEvent.press(await router.findByTestId('home-recent-header-link'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions`));
  expect(router.getSearchParams().source_id).toBeUndefined();
});

// ------------------------------------------------------- the blocks load independently

test('a failing stats request only breaks its own block', async () => {
  mockHome({ summaryStatus: 500 });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-summary-error')).toHaveTextContent(
    containing('加载失败，请重试'),
  );
  expect(router.getByTestId('home-summary-error-primary')).toBeTruthy();
  // The balances and the header numbers came from a different request and are unaffected.
  expect(router.getByTestId('home-balance-src-checking')).toBeTruthy();
  expect(router.getByTestId('home-assets')).toHaveTextContent(containing('1,000.00'));
  expect(router.getByTestId('home-trend')).toBeTruthy();
  // The month switcher survives a failed summary — it is the only way out of that month.
  expect(router.getByTestId('home-month-prev')).toBeTruthy();
});

test('a failing accounts request leaves the summary and the trend readable', async () => {
  mockHome({ sourcesStatus: 500 });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-networth-error')).toBeTruthy();
  expect(router.getByTestId('home-balances-error')).toBeTruthy();
  expect(router.getByTestId('home-expense-total')).toHaveTextContent(containing('8,421.66'));
  expect(router.getByTestId('home-trend')).toBeTruthy();
});

test('a failing recent request only breaks its own block', async () => {
  mockHome({ recentStatus: 500 });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-recent-error')).toBeTruthy();
  expect(router.getByTestId('home-balance-src-checking')).toBeTruthy();
  expect(router.getByTestId('home-categories-row-food')).toBeTruthy();
});

test('the refresh button refetches every block', async () => {
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });
  await router.findByTestId('home-assets');
  expect(getsFor(SOURCES_PATH).length).toBe(1);

  await act(async () => {
    fireEvent.press(router.getByTestId('home-refresh'));
  });

  await waitFor(() => expect(getsFor(SOURCES_PATH).length).toBe(2));
  expect(getsFor(SUMMARY_PATH).length).toBe(2);
  expect(getsFor(TREND_PATH).length).toBe(2);
  expect(getsFor(TX_PATH).length).toBe(2);
});

test('the wide layout drops the top bar and lays the blocks out in two columns', async () => {
  useWideLayout();
  mockHome();
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  await router.findByTestId('home-assets');
  expect(router.queryByTestId('top-bar')).toBeNull();
  expect(router.getByTestId('app-shell-wide')).toBeTruthy();
  expect(router.getByTestId('home-balances')).toBeTruthy();
  expect(router.getByTestId('home-recent')).toBeTruthy();
});

// ------------------------------------------- an empty ledger (screen 15 A), both widths

test('no accounts at all: the narrow home offers the three ways in', async () => {
  mockHome({ sources: [] });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  // The net worth still reads zero, in grey — the ledger is empty, the page did not fail.
  expect(await router.findByTestId('home-net-worth')).toHaveTextContent('¥0.00');
  expect(router.getByTestId('home-empty-month')).toBeTruthy();
  expect(router.getByTestId('home-empty-transactions')).toHaveTextContent(
    containing('还没有交易'),
  );
  // The account rows and the category ranking are gone: there is nothing to rank yet.
  expect(router.queryByTestId('home-balances')).toBeNull();
  expect(router.queryByTestId('home-categories')).toBeNull();

  fireEvent.press(router.getByTestId('home-empty-source'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/sources/new`));
});

test('no accounts at all: the wide home shows the three-step card', async () => {
  useWideLayout();
  mockHome({ sources: [] });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-empty')).toHaveTextContent(containing('这本账还是空的'));
  // The striped panel previews what the page will look like once there is data.
  expect(router.getByTestId('home-empty-preview')).toBeTruthy();

  fireEvent.press(router.getByTestId('home-empty-step-1'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/sources/new`));
});

/**
 * 04 §4.4 wants refresh on every frame. The wide empty header carries the two ways forward
 * *and* the refresh icon: pull-to-refresh is not reachable with a mouse.
 */
test('no accounts at all: the wide home keeps its refresh button next to the two ways in', async () => {
  useWideLayout();
  mockHome({ sources: [] });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  await router.findByTestId('home-empty');
  expect(router.getByTestId('home-empty-invite')).toBeTruthy();
  expect(router.getByTestId('home-empty-source')).toBeTruthy();
  expect(getsFor(SOURCES_PATH).length).toBe(1);

  await act(async () => {
    fireEvent.press(router.getByTestId('home-refresh'));
  });
  await waitFor(() => expect(getsFor(SOURCES_PATH).length).toBe(2));
});

test('the empty home sends step 2 to the transaction form', async () => {
  useWideLayout();
  mockHome({ sources: [] });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  fireEvent.press(await router.findByTestId('home-empty-step-2'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/new`));
});

test('the empty home sends step 3 to the ledger settings, where invites live', async () => {
  useWideLayout();
  mockHome({ sources: [] });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  fireEvent.press(await router.findByTestId('home-empty-step-3'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/settings`));
});

test('an archived-only ledger counts as empty', async () => {
  mockHome({
    sources: [makeSource({ id: 'src-old', archived: true, balance_base: '10.0000' })],
  });
  const router = renderRouter(ROUTES, { initialUrl: HOME_URL });

  expect(await router.findByTestId('home-empty-transactions')).toBeTruthy();
});
