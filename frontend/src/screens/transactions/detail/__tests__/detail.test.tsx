/**
 * 交易详情 (04 §4.7, §8.3 的「交易详情」行): the expense / income / refund shapes.
 *
 * The whole route tree is mounted (root layout → app group → ledger layout) so the screen
 * runs against the real guards, the real `LedgerContext` and the real navigation, and the
 * assertions are on what the server was asked for, what was sent back to it, and what ended
 * up on screen. The transfer shapes live in `transfer-detail.test.tsx`.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree; fonts never
// gate rendering, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../../../app/_layout';
import AppGroupLayout from '../../../../../app/(app)/_layout';
import LedgerLayout from '../../../../../app/(app)/l/[ledgerId]/_layout';
import TransactionDetailRoute from '../../../../../app/(app)/l/[ledgerId]/transactions/[txId]/index';

import { setAuthToken } from '@/api/client';
import type { LedgerMember, Transaction, TransactionEvent } from '@/api/types';
import { initI18n } from '@/i18n';
import { resetLedgerGone } from '@/navigation';
import { qk, queryClient } from '@/queries';
import * as breakpoint from '@/theme/useBreakpoint';
import {
  USER_ID,
  makeCategoryTree,
  makeCurrencyList,
  makeLedger,
  makeSource,
  makeStatsSummary,
  makeTransaction,
  makeUser,
} from '@/test/fixtures';
import { mockApi, mockGet, mockPatch, type MockApi } from '@/test/mockApi';
import { toast } from '@/ui';

const LEDGER = 'ledger-detail';
const BOB = 'user-bob';

const SOURCE_A = makeSource({ id: 's1', name: '招行储蓄卡', type: 'checking' });
const SOURCE_B = makeSource({ id: 's2', name: '建行信用卡', type: 'credit' });

const ROUTES = {
  _layout: RootLayout,
  index: () => <RNText>landing</RNText>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <RNText>ledgers</RNText>,
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': () => <RNText>home</RNText>,
  '(app)/l/[ledgerId]/transactions/index': () => <RNText>transactions-page</RNText>,
  '(app)/l/[ledgerId]/transactions/new': () => <RNText>new-transaction-page</RNText>,
  '(app)/l/[ledgerId]/transactions/[txId]/index': TransactionDetailRoute,
  '(app)/l/[ledgerId]/transactions/[txId]/edit': () => <RNText>edit-page</RNText>,
  '(app)/l/[ledgerId]/transfers/[pairId]/index': () => <RNText>transfer-page</RNText>,
  '(app)/l/[ledgerId]/imports/[batchId]/index': () => <RNText>batch-page</RNText>,
};

function members(): { items: LedgerMember[]; total: number } {
  return {
    items: [
      {
        user_id: USER_ID,
        email: 'alice@example.com',
        display_name: 'Alice',
        role: 'owner',
        joined_at: '2026-02-01T09:00:00.000000Z',
        is_me: true,
      },
      {
        // No display name: the timeline has to fall back to the email prefix (§14.40 01-7).
        user_id: BOB,
        email: 'bob@example.com',
        display_name: null,
        role: 'member',
        joined_at: '2026-02-02T09:00:00.000000Z',
        is_me: false,
      },
    ],
    total: 2,
  };
}

function txPath(id: string): string {
  return `/ledgers/${LEDGER}/transactions/${id}`;
}

/** `toHaveTextContent` compares the WHOLE subtree's text, so a substring needs a regexp. */
function containing(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** Register `GET /transactions/{id}` and open that page. */
function open(tx: Transaction): ReturnType<typeof renderRouter> {
  mockGet(txPath(tx.id), tx);
  return renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions/${tx.id}` });
}

/**
 * 屏幕稿 08 at 375 puts the operations in a sheet behind the pinned 「修改」 bar, so a
 * narrow test opens the sheet before it can press one.
 */
async function openActions(
  router: ReturnType<typeof renderRouter>,
): Promise<void> {
  fireEvent.press(await router.findByTestId('tx-detail-actions-open'));
  await router.findByTestId('tx-detail-actions-delete');
}

let api: MockApi;
let wideSpy: jest.SpyInstance;

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false, gcTime: 0 },
  });
  resetLedgerGone();
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
  mockGet(`/ledgers/${LEDGER}/sources`, { items: [SOURCE_A, SOURCE_B], total: 2 });
  mockGet(`/ledgers/${LEDGER}/members`, members());
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(false);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
});

// ------------------------------------------------------------------- expense

const EXPENSE = makeTransaction({
  id: 'e-1',
  source_id: 's1',
  amount: '-598.0000',
  amount_base: '-598.0000',
  currency: 'CNY',
  occurred_at: '2026-09-02',
  merchant: '京东订单',
  category_l1: 'shopping',
  category_l2: 'electronics',
  note: null,
  refunded_total: '399.0000',
  refundable: '199.0000',
  refunds: [
    {
      id: 'r-1',
      occurred_at: '2026-09-05',
      amount: '399.0000',
      currency: 'CNY',
      note: '第一次退款',
      source_id: 's2',
    },
  ],
  events: [],
});

test('an expense lists its refunds with the account the money went back to, plus 已退 / 可退', async () => {
  const router = open(EXPENSE);

  // The header says what it is, and never shows the transaction id (decision §14.52 A6).
  expect(await router.findByTestId('tx-detail-header-account-title')).toHaveTextContent(
    '京东订单',
  );
  expect(router.getByTestId('tx-detail-header-account-sub')).toHaveTextContent(
    containing('招行储蓄卡'),
  );
  expect(router.getByTestId('tx-detail-header-category')).toHaveTextContent('消费购物 / 数码');
  expect(router.queryByText(EXPENSE.id)).toBeNull();

  expect(router.getByTestId('tx-detail-refunds-summary')).toHaveTextContent(
    '已退 399.00 / 可退 199.00',
  );
  // `source_id` on a refund row is the returning account, mapped to its name (§14.53f).
  expect(router.getByTestId('tx-detail-refunds-account-r-1')).toHaveTextContent('建行信用卡');
  expect(router.getByTestId('tx-detail-refunds-amount-r-1')).toHaveTextContent('399.00');

  // And the row opens that refund.
  fireEvent.press(router.getByTestId('tx-detail-refunds-row-r-1'));
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/r-1`),
  );
});

test('「登记退款」is offered on an expense and nowhere else', async () => {
  const router = open(EXPENSE);
  await openActions(router);
  expect(router.getByTestId('tx-detail-actions-refund')).toBeTruthy();
  router.unmount();

  queryClient.clear();
  const income = makeTransaction({
    id: 'i-1',
    kind: 'income',
    amount: '18000.0000',
    amount_base: '18000.0000',
    category_l1: 'salary',
    category_l2: 'base_salary',
    merchant: null,
    events: [],
  });
  const second = open(income);
  await second.findByTestId('tx-detail-header');
  await openActions(second);
  expect(second.queryByTestId('tx-detail-actions-refund')).toBeNull();
  // 分享 was dropped for good (decision §14.52 A8).
  expect(second.queryByText('分享')).toBeNull();
});

test('「复制一笔」opens the form with copy_of, and 「登记退款」with kind + refund_of', async () => {
  const router = open(EXPENSE);

  await openActions(router);
  fireEvent.press(router.getByTestId('tx-detail-actions-duplicate'));
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/new`),
  );
  expect(router.getSearchParams().copy_of).toBe('e-1');
  router.unmount();

  queryClient.clear();
  const second = open(EXPENSE);
  await openActions(second);
  fireEvent.press(second.getByTestId('tx-detail-actions-refund'));
  await waitFor(() =>
    expect(second.getPathname()).toBe(`/l/${LEDGER}/transactions/new`),
  );
  expect(second.getSearchParams().kind).toBe('refund');
  expect(second.getSearchParams().refund_of).toBe('e-1');
});

// -------------------------------------------------------------------- refund

const REFUND = makeTransaction({
  id: 'rf-1',
  kind: 'refund',
  source_id: 's1',
  amount: '199.0000',
  amount_base: '199.0000',
  occurred_at: '2026-09-08',
  merchant: '京东退款',
  category_l1: 'shopping',
  category_l2: 'electronics',
  refund_of: 'e-1',
  updated_at: '2026-09-08T11:00:00.000000Z',
  refund_of_detail: {
    id: 'e-1',
    occurred_at: '2026-09-02',
    merchant: '京东订单',
    amount: '-598.0000',
    currency: 'CNY',
    source_id: 's1',
    category_l1: 'shopping',
    category_l2: 'electronics',
    refunded_total: '598.0000',
    refundable: '0.0000',
    // Deliberately out of order: the page sorts them oldest first (decision §14.52 A25).
    other_refunds: [
      { id: 'r-late', occurred_at: '2026-09-07', amount: '200.0000', currency: 'CNY', note: '尾款' },
      { id: 'r-early', occurred_at: '2026-09-05', amount: '199.0000', currency: 'CNY', note: '首笔' },
    ],
  },
  events: [],
});

test('a refund shows the original expense and the other refunds against it, oldest first', async () => {
  const router = open(REFUND);

  expect(await router.findByTestId('tx-detail-origin-merchant')).toHaveTextContent('京东订单');
  // Date, category and the original's own account all come off `refund_of_detail` (§14.53f).
  expect(router.getByTestId('tx-detail-origin-meta')).toHaveTextContent(containing('2026-09-02'));
  expect(router.getByTestId('tx-detail-origin-meta')).toHaveTextContent(
    containing('消费购物 / 数码'),
  );
  expect(router.getByTestId('tx-detail-origin-meta')).toHaveTextContent(
    containing('招行储蓄卡'),
  );
  expect(router.getByTestId('tx-detail-origin-amount')).toHaveTextContent('−598.00');
  expect(router.getByTestId('tx-detail-origin-summary')).toHaveTextContent(
    '已退 598.00 / 可退 0.00',
  );

  const others = router.getAllByTestId(/^tx-detail-origin-other-/);
  expect(others.map((n) => n.props.testID)).toEqual([
    'tx-detail-origin-other-r-early',
    'tx-detail-origin-other-r-late',
  ]);
  // 03 §5.27 gives these elements no `source_id`, so no account name may appear on them.
  expect(others[0]).not.toHaveTextContent(containing('招行储蓄卡'));
  expect(others[0]).toHaveTextContent(containing('首笔'));

  // The card opens the original expense.
  fireEvent.press(router.getByTestId('tx-detail-origin-open'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/e-1`));
});

test('「解除关联」PATCHes refund_of to null with the row\'s updated_at', async () => {
  const router = open(REFUND);
  mockPatch(txPath('rf-1'), { ...REFUND, refund_of: null, refund_of_detail: null });

  fireEvent.press(await router.findByTestId('tx-detail-origin-unlink'));
  fireEvent.press(await router.findByTestId('confirm-accept'));

  await waitFor(() => expect(api.mock.history.patch).toHaveLength(1));
  expect(JSON.parse(api.mock.history.patch[0].data as string)).toEqual({
    refund_of: null,
    updated_at: '2026-09-08T11:00:00.000000Z',
  });
});

test('「改选」picks another expense and PATCHes refund_of to it', async () => {
  const router = open(REFUND);
  mockGet(`/ledgers/${LEDGER}/transactions`, {
    items: [makeTransaction({ id: 'e-2', merchant: '天猫订单', amount: '-300.0000' })],
    total: 1,
    summary: {
      base_currency: 'CNY',
      expense: '300',
      income: '0',
      net: '-300',
      count: 1,
      rate_missing_count: 0,
    },
  });
  mockPatch(txPath('rf-1'), { ...REFUND, refund_of: 'e-2' });

  fireEvent.press(await router.findByTestId('tx-detail-origin-pick'));
  // The picker can only ever offer expenses (decision §14.52 B11).
  expect(await router.findByTestId('tx-detail-origin-picker-fixed')).toHaveTextContent('只看支出');
  fireEvent.press(await router.findByTestId('tx-detail-origin-picker-row-e-2'));

  await waitFor(() => expect(api.mock.history.patch).toHaveLength(1));
  expect(JSON.parse(api.mock.history.patch[0].data as string)).toEqual({
    refund_of: 'e-2',
    updated_at: '2026-09-08T11:00:00.000000Z',
  });
});

test('a refund whose original was deleted says so, instead of showing an empty card', async () => {
  const router = open(
    makeTransaction({
      ...REFUND,
      id: 'rf-2',
      refund_of: 'gone-1',
      refund_of_detail: null,
    }),
  );

  expect(await router.findByTestId('tx-detail-origin-none')).toHaveTextContent('原单已删除');
  // Still fixable from here: decision §14.34 keeps both relations editable after an import.
  // A dangling link is re-pointed, so the button says 「改选」, not 「去关联」.
  expect(router.getByTestId('tx-detail-origin-pick')).toHaveTextContent('改选');
});

test('a refund that was never linked offers 「去关联」', async () => {
  const router = open(
    makeTransaction({
      ...REFUND,
      id: 'rf-3',
      refund_of: null,
      refund_of_detail: null,
    }),
  );

  expect(await router.findByTestId('tx-detail-origin-none')).toHaveTextContent('未关联原支出');
  expect(router.getByTestId('tx-detail-origin-pick')).toHaveTextContent('去关联');
  expect(router.queryByTestId('tx-detail-origin-unlink')).toBeNull();
});

// ---------------------------------------------------------------------- wide

/** The month's summary the card works off. */
function summaryBody(): ReturnType<typeof makeStatsSummary> {
  return makeStatsSummary({
    month: '2026-09',
    expense_total: '8421.6600',
    expense: [
      {
        code: 'shopping',
        name_zh: '消费购物',
        name_en: 'Shopping',
        amount: '2310.5000',
        share: 0.2743,
        count: 4,
        children: [],
      },
    ],
  });
}

/** The same summary, put where the home screen would have left it. */
function seedSummary(): void {
  queryClient.setQueryData(qk.ledger(LEDGER).statsSum('2026-09'), summaryBody());
}

/**
 * 04 §4.7's 「来源」 row: a row that came out of an import names its batch and links to it;
 * one typed in by hand says 手动录入 and is not a link at all.
 */
test('来源 names the import batch a row came from and opens that batch', async () => {
  const router = open(makeTransaction({ ...EXPENSE, id: 'e-imported', import_batch_id: 'batch-1' }));

  // A batch turns the row into a link, so the value lives inside it rather than in the
  // plain `-value-origin` text node.
  const link = await router.findByTestId('tx-detail-facts-link-origin');
  expect(link).toHaveTextContent(containing('batch-1'));
  expect(router.queryByTestId('tx-detail-facts-value-origin')).toBeNull();
  fireEvent.press(link);
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/imports/batch-1`));
});

test('a hand-typed row says 手动录入 and offers no link', async () => {
  const router = open(EXPENSE);

  expect(await router.findByTestId('tx-detail-facts-value-origin')).toHaveTextContent('手动录入');
  expect(router.queryByTestId('tx-detail-facts-link-origin')).toBeNull();
});

/**
 * 屏幕稿 08 at 1440: 「对 9 月的影响」 answers the question the 删除 button raises, and the
 * operations sit beside the headline instead of behind the sheet. The arithmetic is the
 * card's own (the month's summary minus this row), so it is asserted on both signs of it.
 */
test('宽屏 prices what deleting this row would change, and keeps the actions in the headline', async () => {
  wideSpy.mockReturnValue(true);
  // The arithmetic is the card's own (§14.52 A9); the month's summary is the ledger's
  // ordinary `GET /stats/summary`, so a cache the home screen has already filled costs
  // nothing and a cold one is fetched — see the deep-link test below.
  seedSummary();

  const router = open(EXPENSE);

  expect(await router.findByTestId('tx-detail-impact-total')).toHaveTextContent(
    containing('8,421.66 · 含本笔 598.00'),
  );
  expect(router.getByTestId('tx-detail-impact-category')).toHaveTextContent(
    containing('2,310.50 · 含本笔 598.00'),
  );
  // 8,421.66 − 598.00: an expense leaving the month takes its own magnitude with it.
  expect(router.getByTestId('tx-detail-impact-after-delete')).toHaveTextContent(
    containing('删除后支出7,823.66'),
  );

  // Wide has no sheet: every operation is already on screen.
  expect(router.getByTestId('tx-detail-actions-delete')).toBeTruthy();
  expect(router.queryByTestId('tx-detail-actions-open')).toBeNull();
  router.unmount();

  // A refund lives on the expense side of the summary, offsetting it, so deleting one
  // *raises* the month: 8,421.66 + 199.00.
  queryClient.clear();
  seedSummary();
  const second = open(REFUND);
  expect(await second.findByTestId('tx-detail-impact-total')).toHaveTextContent(
    containing('已冲减本笔 199.00'),
  );
  expect(second.getByTestId('tx-detail-impact-after-delete')).toHaveTextContent(
    containing('删除后支出8,620.66'),
  );
});

/**
 * The card subscribes to the row's own month, so a link straight into a detail page — no
 * home screen visited, nothing in the cache — still draws it (04 §4.7, 屏幕稿 08 · 1440
 * leads the right column with it).
 */
test('宽屏 深链: 「对 N 月的影响」 fetches the row\'s own month instead of staying blank', async () => {
  wideSpy.mockReturnValue(true);
  mockGet(`/ledgers/${LEDGER}/stats/summary`, summaryBody());

  const router = open(EXPENSE);

  expect(await router.findByTestId('tx-detail-impact-total')).toHaveTextContent(
    containing('8,421.66 · 含本笔 598.00'),
  );
  expect(api.mock.history.get.some((r) => (r.url ?? '').includes('/stats/summary'))).toBe(true);
});

/**
 * A category the summary does not report has no figure to print: 「0.00 · 含本笔 299.00」
 * would be a number invented by the card, so the row drops out instead.
 */
test('宽屏 drops the category line when the month\'s summary has no such node', async () => {
  wideSpy.mockReturnValue(true);
  mockGet(`/ledgers/${LEDGER}/stats/summary`, summaryBody());

  // `dining` is nowhere in the seeded summary (only `shopping` is).
  const router = open(
    makeTransaction({ ...EXPENSE, id: 'e-dining', category_l1: 'dining', category_l2: null }),
  );

  expect(await router.findByTestId('tx-detail-impact-total')).toBeTruthy();
  expect(router.queryByTestId('tx-detail-impact-category')).toBeNull();
});

// -------------------------------------------------------------------- events

function event(over: Partial<TransactionEvent> & Pick<TransactionEvent, 'id'>): TransactionEvent {
  return {
    transaction_id: 'e-ev',
    actor_id: USER_ID,
    at: '2026-09-02T10:00:00.000000Z',
    event: 'created',
    changes: null,
    import_batch_id: null,
    client: 'web',
    ...over,
  };
}

test('the timeline runs newest first, names me 「我」 and falls back to the email prefix', async () => {
  const router = open(
    makeTransaction({
      ...EXPENSE,
      id: 'e-ev',
      refunds: [],
      refunded_total: '0.0000',
      refundable: '598.0000',
      // Oldest first on the wire; the timeline is the thing that orders them (§14.51).
      events: [
        event({ id: 'ev-1', actor_id: BOB, at: '2026-09-02T10:00:00.000000Z', event: 'created' }),
        event({
          id: 'ev-2',
          actor_id: USER_ID,
          at: '2026-09-06T14:02:00.000000Z',
          event: 'updated',
          changes: { amount: { before: '-38.0000', after: '-42.0000' } },
        }),
      ],
    }),
  );

  const rows = await router.findAllByTestId(/^tx-detail-events-row-/);
  expect(rows.map((n) => n.props.testID)).toEqual([
    'tx-detail-events-row-ev-2',
    'tx-detail-events-row-ev-1',
  ]);
  expect(rows[0]).toHaveTextContent(containing('我'));
  expect(rows[0]).toHaveTextContent(containing('改动'));
  expect(rows[0]).toHaveTextContent(containing('金额 −¥38.00 → −¥42.00'));
  // `display_name` is null for Bob, so the email prefix stands in.
  expect(rows[1]).toHaveTextContent(containing('bob'));
  expect(rows[1]).not.toHaveTextContent(containing('bob@example.com'));
});

// ---------------------------------------------------------------- rate + pair

test('a foreign-currency row shows the rate it was converted at, and says when it fell back', async () => {
  const router = open(
    makeTransaction({
      ...EXPENSE,
      id: 'e-usd',
      refunds: [],
      refunded_total: '0.0000',
      refundable: '12.4000',
      currency: 'SGD',
      amount: '-12.4000',
      occurred_at: '2026-08-14',
      // The quote is a day older than the transaction (decision §8).
      amount_base: '-66.2000',
      rate_used: '5.33870000',
      rate_date: '2026-08-13',
    }),
  );

  const line = await router.findByTestId('tx-detail-rate-text');
  expect(line).toHaveTextContent(containing('≈ ¥66.20'));
  expect(line).toHaveTextContent(containing('1 SGD = 5.3387 CNY'));
  expect(router.getByTestId('tx-detail-rate-fallback')).toHaveTextContent(
    containing('该日无行情'),
  );
});

test('a row without a rate says 暂无汇率 rather than showing a converted zero', async () => {
  const router = open(
    makeTransaction({
      ...EXPENSE,
      id: 'e-norate',
      refunds: [],
      refunded_total: '0.0000',
      refundable: '12.4000',
      currency: 'JPY',
      amount: '-1200.0000',
      amount_base: null,
      rate_used: null,
      rate_date: null,
    }),
  );

  expect(await router.findByTestId('tx-detail-rate-missing')).toHaveTextContent('暂无汇率');
});

test('opening a leg of a two-leg transfer redirects to the pair\'s own page', async () => {
  const pairId = 'pair-77';
  const router = open(
    makeTransaction({
      id: 'leg-out',
      kind: 'transfer',
      amount: '-3000.0000',
      amount_base: '-3000.0000',
      merchant: null,
      category_l1: null,
      category_l2: null,
      transfer_role: 'out',
      transfer_subtype: 'repayment',
      transfer_pair_id: pairId,
      events: [],
      pair: {
        pair_id: pairId,
        out: { transaction_id: 'leg-out', source_id: 's1', amount: '-3000.0000', currency: 'CNY' },
        in: { transaction_id: 'leg-in', source_id: 's2', amount: '3000.0000', currency: 'CNY' },
      },
    }),
  );

  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transfers/${pairId}`));
  expect(screen.getByText('transfer-page')).toBeTruthy();
});
