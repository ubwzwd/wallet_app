/**
 * The transaction list itself (04 §4.5, §8.3 的「交易列表」行): merged transfer rows, the
 * per-day subtotals, the bottom summary that comes from the response rather than from the
 * page, the two empty states, and deleting a pair through `DELETE .../transfer/{pair_id}`.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree; fonts never
// gate rendering, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../../app/_layout';
import AppGroupLayout from '../../../../app/(app)/_layout';

import { setAuthToken } from '@/api/client';
import type { Transaction, TransactionListResponse, TransactionSummary } from '@/api/types';
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
  mockDelete,
  mockGet,
  type MockApi,
} from '@/test';
import { toast } from '@/ui';

import { resetLedgerUnavailable } from '@/navigation';

import TransactionsScreen from '../TransactionsScreen';

const LEDGER = 'ledger-1';
const PAIR_ID = 'pair-777';
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

/**
 * Six legs → five rows: the two transfer legs of `PAIR_ID` merge. The summary below is
 * deliberately inconsistent with the sum of these rows, so a screen that added the page up
 * itself would show different numbers.
 */
function pageItems(): Transaction[] {
  return [
    makeTransaction({
      id: 'e1',
      source_id: 's1',
      occurred_at: '2026-09-10',
      amount: '-45.0000',
      amount_base: '-45.0000',
      category_l1: 'food',
      category_l2: 'lunch',
      merchant: '瑞幸咖啡',
      note: '和老婆下午茶',
    }),
    makeTransaction({
      id: 'i1',
      source_id: 's1',
      kind: 'income',
      occurred_at: '2026-09-10',
      amount: '18000.0000',
      amount_base: '18000.0000',
      category_l1: 'salary',
      category_l2: 'base_salary',
      merchant: null,
      note: null,
    }),
    makeTransaction({
      id: 'r1',
      source_id: 's1',
      kind: 'refund',
      occurred_at: '2026-09-09',
      amount: '199.0000',
      amount_base: '199.0000',
      category_l1: 'shopping',
      category_l2: null,
      merchant: '京东退款',
      refund_of: 'e-origin',
    }),
    makeTransaction({
      id: 'tout',
      source_id: 's1',
      kind: 'transfer',
      occurred_at: '2026-09-08',
      amount: '-3000.0000',
      amount_base: '-3000.0000',
      category_l1: null,
      category_l2: null,
      merchant: null,
      note: '信用卡还款',
      transfer_role: 'out',
      transfer_subtype: 'repayment',
      transfer_pair_id: PAIR_ID,
    }),
    makeTransaction({
      id: 'tin',
      source_id: 's2',
      kind: 'transfer',
      occurred_at: '2026-09-08',
      amount: '3000.0000',
      amount_base: '3000.0000',
      category_l1: null,
      category_l2: null,
      merchant: null,
      note: '信用卡还款',
      transfer_role: 'in',
      transfer_subtype: 'repayment',
      transfer_pair_id: PAIR_ID,
    }),
    makeTransaction({
      id: 'im1',
      source_id: 's1',
      occurred_at: '2026-09-08',
      amount: '-66.2000',
      amount_base: '-66.2000',
      category_l1: 'transport',
      category_l2: 'taxi',
      merchant: 'Grab',
      note: null,
      import_batch_id: BATCH_ID,
    }),
  ];
}

/** Numbers that match nothing on the page — that is the point (decision §14.52 A14). */
const WHOLE_RESULT_SUMMARY: TransactionSummary = {
  base_currency: 'CNY',
  expense: '999.9900',
  income: '18000.0000',
  net: '17000.0100',
  count: 42,
  rate_missing_count: 3,
};

function listResponse(over: Partial<TransactionListResponse> = {}): TransactionListResponse {
  const items = over.items ?? pageItems();
  return {
    items,
    total: over.total ?? items.length,
    summary: over.summary ?? WHOLE_RESULT_SUMMARY,
  };
}

let api: MockApi;
let wideSpy: jest.SpyInstance;

function setWide(wide: boolean): void {
  wideSpy?.mockRestore();
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

beforeEach(async () => {
  api = mockApi();
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
  mockGet(`/ledgers/${LEDGER}/sources`, { items: [SOURCE_A, SOURCE_B], total: 2 });
  setWide(false);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
});

test('the two legs of a transfer render as one row, and the header counts the entries', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  // One row keyed by the pair id, and neither leg on its own.
  expect(await screen.findByTestId(`tx-row-${PAIR_ID}`)).toBeTruthy();
  expect(screen.queryByTestId('tx-row-tout')).toBeNull();
  expect(screen.queryByTestId('tx-row-tin')).toBeNull();

  // "招行储蓄卡 → 建行信用卡", not a leg's own account name.
  expect(screen.getByTestId(`tx-row-${PAIR_ID}-title`)).toHaveTextContent(
    '招行储蓄卡 → 建行信用卡',
  );
  expect(screen.getByTestId(`tx-row-${PAIR_ID}-badge-repayment`)).toHaveTextContent('还款');

  // Six legs came back and five rows are shown, but the header counts what the *server*
  // matched — a number that does not move as more pages arrive (see the paging test below).
  expect(screen.getByTestId('tx-count')).toHaveTextContent('共 6 笔');
});

test('the header count does not drift when a second page is loaded', async () => {
  const first = listResponse({ total: 8 });
  const second = listResponse({
    items: [
      makeTransaction({
        id: 'older',
        source_id: 's1',
        occurred_at: '2026-09-01',
        amount: '-12.0000',
        amount_base: '-12.0000',
        category_l1: 'food',
        category_l2: 'lunch',
        merchant: '沙县',
      }),
    ],
    total: 8,
  });
  api.mock.onGet(apiUrl(`/ledgers/${LEDGER}/transactions`)).replyOnce(200, first);
  api.mock.onGet(apiUrl(`/ledgers/${LEDGER}/transactions`)).reply(200, second);

  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  // Five rows out of six legs, and the header still says what the server matched.
  expect(await screen.findByTestId('tx-count')).toHaveTextContent('共 8 笔');

  fireEvent.press(screen.getByTestId('tx-load-more'));

  // The second page arrives and the total stays the number the envelope gave: neither
  // merging the pair on page one nor appending a page may move it.
  expect(await screen.findByTestId('tx-row-older')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('tx-count')).toHaveTextContent('共 8 笔'));
});

test('the wide pager counts the whole filtered result, not the page', async () => {
  setWide(true);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse({ total: 42 }));
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-count')).toHaveTextContent('共 42 笔');
});

test('the wide layout is a seven-column table with a counted foot strip', async () => {
  setWide(true);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse({ total: 6 }));
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  // 屏幕稿 02 · 1440: 日期 / 种类 / 商户 / 分类 / 账户 / 备注 / 金额.
  expect(await screen.findByTestId('tx-table-head-date')).toHaveTextContent('日期');
  for (const [key, title] of [
    ['kind', '种类'],
    ['merchant', '商户'],
    ['category', '分类'],
    ['source', '账户'],
    ['note', '备注'],
    ['amount', '金额'],
  ] as const) {
    expect(screen.getByTestId(`tx-table-head-${key}`)).toHaveTextContent(title);
  }

  // One expense spread across its own columns, the merged pair naming both accounts.
  expect(screen.getByTestId('tx-row-e1-date')).toHaveTextContent('09-10');
  expect(screen.getByTestId('tx-row-e1-title')).toHaveTextContent('瑞幸咖啡');
  expect(screen.getByTestId('tx-row-e1-category')).toHaveTextContent('餐饮 / 午餐');
  expect(screen.getByTestId('tx-row-e1-source')).toHaveTextContent('招行储蓄卡');
  expect(screen.getByTestId('tx-row-e1-note')).toHaveTextContent('和老婆下午茶');
  // A row with no note shows the mockup's em dash rather than an empty cell.
  expect(screen.getByTestId('tx-row-i1-note')).toHaveTextContent('—');
  expect(screen.getByTestId(`tx-row-${PAIR_ID}-source`)).toHaveTextContent(
    '招行储蓄卡 → 建行信用卡',
  );

  // The foot strip counts the merged rows on screen against the server's `total`, and
  // takes the net from the response envelope — never from this page.
  expect(screen.getByTestId('tx-table-shown')).toHaveTextContent('5 / 6 笔已显示');
  expect(screen.getByTestId('tx-table-net')).toHaveTextContent('净额 +17,000.01');
});

test('each day header carries that day\'s expense and income subtotal', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-day-2026-09-10-total')).toHaveTextContent(
    '当日支出 45.00 · 收入 18,000.00',
  );
  // The transfer pair is excluded from the day it falls on (decision §14.52 A14): only the
  // imported 66.20 expense counts there — and 屏幕稿 02 · 375 names only the non-zero kinds,
  // so that day's header says nothing about income.
  const quiet = screen.getByTestId('tx-day-2026-09-08-total');
  expect(quiet).toHaveTextContent('当日支出 66.20');
  expect(quiet).not.toHaveTextContent('收入');
});

test('the bottom summary comes from the response, not from the rows on screen', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  const expense = await screen.findByTestId('tx-summary-expense');
  // The page's own expenses add up to 111.20; the envelope says 999.99 and that is what wins.
  expect(expense).toHaveTextContent('999.99');
  expect(screen.getByTestId('tx-summary-income')).toHaveTextContent('18,000.00');
  expect(screen.getByTestId('tx-summary-net')).toHaveTextContent('+17,000.01');
  expect(screen.getByTestId('tx-summary-rate-missing')).toHaveTextContent('3 笔因暂无汇率未计入');
});

/**
 * The footnote under that card names the refund total, which the API does not report: it
 * is recovered from §5.25's `net = income − expense + refund`. A change to that definition
 * would silently print a wrong number, so both halves of the derivation are pinned here.
 */
test('the narrow summary footnote states the refund the net includes, and is absent at zero', async () => {
  mockGet(
    `/ledgers/${LEDGER}/transactions`,
    listResponse({
      summary: { ...WHOLE_RESULT_SUMMARY, net: '17199.0100', rate_missing_count: 0 },
    }),
  );
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  // 18,000.00 − 999.99 + 199.00 = 17,199.01, so the refunds came to 199.00.
  expect(await screen.findByTestId('tx-summary-refund-note')).toHaveTextContent(
    '退款 199.00 计入净额；转账不计入。',
  );

  // The default envelope's net is exactly income − expense: no refunds, no footnote.
  api.restore();
  api = mockApi();
  queryClient.clear();
  mockGet('/me', makeUser());
  mockGet('/ledgers', {
    items: [makeLedger({ id: LEDGER, name: '家庭账本', base_currency: 'CNY' })],
    total: 1,
  });
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', makeCurrencyList());
  mockGet(`/ledgers/${LEDGER}/sources`, { items: [SOURCE_A, SOURCE_B], total: 2 });
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-summary-net')).toHaveTextContent('+17,000.01');
  expect(screen.queryByTestId('tx-summary-refund-note')).toBeNull();
});

/**
 * 编辑 / 删除 have no per-row button any more (决策 §14.56 / 屏幕稿 02); the row's own menu
 * is behind a long press, and that is where the two delete paths are exercised from.
 */
async function openRowMenu(rowTestId: string): Promise<void> {
  fireEvent(await screen.findByTestId(rowTestId), 'longPress');
  await screen.findByTestId('tx-row-menu-delete');
}

test('deleting a merged transfer row confirms once and calls DELETE .../transfer/{pair_id}', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  mockDelete(`/ledgers/${LEDGER}/transactions/transfer/${PAIR_ID}`, undefined, 204);
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  await openRowMenu(`tx-row-${PAIR_ID}`);
  fireEvent.press(screen.getByTestId('tx-row-menu-delete'));

  const dialog = await screen.findByTestId('confirm-dialog');
  expect(dialog).toHaveTextContent(/这是一笔两腿转账，删除会同时删除两腿。/);
  fireEvent.press(screen.getByTestId('confirm-accept'));

  await waitFor(() => {
    expect(api.mock.history.delete.map((r) => r.url)).toContain(
      `/ledgers/${LEDGER}/transactions/transfer/${PAIR_ID}`,
    );
  });
});

test('deleting a plain row calls DELETE on the transaction, not on a pair', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  mockDelete(`/ledgers/${LEDGER}/transactions/e1`, undefined, 204);
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  await openRowMenu('tx-row-e1');
  fireEvent.press(screen.getByTestId('tx-row-menu-delete'));
  const dialog = await screen.findByTestId('confirm-dialog');
  expect(dialog).not.toHaveTextContent(/两腿/);
  fireEvent.press(screen.getByTestId('confirm-accept'));

  await waitFor(() => {
    expect(api.mock.history.delete.map((r) => r.url)).toContain(
      `/ledgers/${LEDGER}/transactions/e1`,
    );
  });
});

test('an empty ledger and an empty filter result say different things', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse({ items: [], total: 0 }));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  // 屏幕稿 15 · 空交易列表: "nothing recorded yet" offers the two ways to put something in.
  expect(await screen.findByTestId('tx-empty')).toHaveTextContent(/还没有任何交易/);
  expect(screen.getByTestId('tx-empty-primary')).toBeTruthy();
  expect(screen.getByTestId('tx-empty-secondary')).toBeTruthy();
  expect(screen.queryByTestId('tx-empty-filtered-state')).toBeNull();

  router.unmount();
  queryClient.clear();

  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions?q=没有这个词` });

  // 屏幕稿 15 · 筛选无结果: a different problem, so a different block and a different way out.
  expect(await screen.findByTestId('tx-empty-filtered-state')).toHaveTextContent(
    /这些条件下没有交易/,
  );
  expect(screen.getByTestId('tx-empty-filtered-clear')).toBeTruthy();
  expect(screen.queryByTestId('tx-empty')).toBeNull();
  // One condition is not enough for the rescue block (decision §14.52 A15).
  expect(screen.queryByTestId('tx-empty-filtered')).toBeNull();
});

/**
 * 04 §4.5's marks are marks, not controls: 屏幕稿 02 draws nothing pressable in the 商户
 * column, and a button nested inside the row's own button is invalid HTML. 「看原单」 /
 * 「看批次」 live on the detail page's fact list instead.
 */
test('an imported row carries a badge, and the badge is not a button', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  const badge = await screen.findByTestId('tx-row-im1-badge-imported');
  expect(badge).toHaveTextContent('导入');
  expect(badge.props.accessibilityRole).not.toBe('button');
  // Pressing it does nothing of its own; the row underneath is what opens.
  fireEvent.press(badge);
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/im1`),
  );
});

test('the wide table repeats the same non-interactive badge', async () => {
  setWide(true);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  const badge = await screen.findByTestId('tx-row-im1-badge-imported');
  expect(badge).toHaveTextContent('导入');
  expect(badge.props.accessibilityRole).not.toBe('button');
});

/**
 * 屏幕稿 15 · 空交易列表 1440 prints counts and nothing else — 「支出 ¥0.00 · 收入 ¥0.00 ·
 * 净额 ¥0.00」 on a ledger with no rows is noise. The server's total keeps its place
 * (04 §4.5).
 */
test('an empty wide result keeps the count but prints no money', async () => {
  setWide(true);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse({ items: [], total: 0 }));
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-count')).toHaveTextContent('共 0 笔');
  expect(screen.queryByTestId('tx-summary-line')).toBeNull();
  expect(screen.queryByTestId('tx-table-net')).toBeNull();
  // The 「N / M 笔已显示」 line is a count, so it stays.
  expect(screen.getByTestId('tx-table-shown')).toBeTruthy();
});
