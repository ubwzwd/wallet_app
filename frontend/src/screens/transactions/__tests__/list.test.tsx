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
import LedgerLayout from '../../../../app/(app)/l/[ledgerId]/_layout';

import { setAuthToken } from '@/api/client';
import type { Transaction, TransactionListResponse, TransactionSummary } from '@/api/types';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import * as breakpoint from '@/theme/useBreakpoint';
import {
  makeCategoryTree,
  makeCurrencyList,
  makeLedger,
  makeSource,
  makeTransaction,
  makeUser,
  mockApi,
  mockDelete,
  mockGet,
  type MockApi,
} from '@/test';
import { toast } from '@/ui';

import { resetLedgerGone } from '@/navigation';

import TransactionsScreen from '../TransactionsScreen';

const LEDGER = 'ledger-1';
const PAIR_ID = 'pair-777';
const BATCH_ID = 'batch1234567890';

const ROUTES = {
  _layout: RootLayout,
  index: () => <RNText>landing</RNText>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <RNText>ledgers</RNText>,
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': () => <RNText>home</RNText>,
  '(app)/l/[ledgerId]/transactions/index': TransactionsScreen,
  '(app)/l/[ledgerId]/transactions/new': () => <RNText>new transaction</RNText>,
  '(app)/l/[ledgerId]/transactions/[txId]/index': () => <RNText>tx detail</RNText>,
  '(app)/l/[ledgerId]/transfers/[pairId]/index': () => <RNText>transfer detail</RNText>,
};

const SOURCE_A = makeSource({ id: 's1', name: '招行储蓄卡', type: 'checking' });
const SOURCE_B = makeSource({ id: 's2', name: '建行信用卡', type: 'credit' });

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
  setWide(false);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
});

test('the two legs of a transfer render as one row, and "共 N 笔" counts it once', async () => {
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

  // Six legs came back; five rows are shown, and the count follows the rows.
  expect(screen.getByTestId('tx-count')).toHaveTextContent('共 5 笔');
});

test('each day header carries that day\'s expense and income subtotal', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-day-2026-09-10-total')).toHaveTextContent(
    '当日支出 ¥45.00 · 收入 ¥18,000.00',
  );
  // The transfer pair is excluded from the day it falls on (decision §14.52 A14): only the
  // imported 66.20 expense counts there.
  expect(screen.getByTestId('tx-day-2026-09-08-total')).toHaveTextContent(
    '当日支出 ¥66.20 · 收入 ¥0.00',
  );
});

test('the bottom summary comes from the response, not from the rows on screen', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  const expense = await screen.findByTestId('tx-summary-expense');
  // The page's own expenses add up to 111.20; the envelope says 999.99 and that is what wins.
  expect(expense).toHaveTextContent('¥999.99');
  expect(screen.getByTestId('tx-summary-income')).toHaveTextContent('¥18,000.00');
  expect(screen.getByTestId('tx-summary-net')).toHaveTextContent('+¥17,000.01');
  expect(screen.getByTestId('tx-summary-rate-missing')).toHaveTextContent('3 笔因暂无汇率未计入');
});

test('deleting a merged transfer row confirms once and calls DELETE .../transfer/{pair_id}', async () => {
  setWide(true);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  mockDelete(`/ledgers/${LEDGER}/transactions/transfer/${PAIR_ID}`, undefined, 204);
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  fireEvent.press(await screen.findByTestId(`tx-row-${PAIR_ID}-delete`));

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
  setWide(true);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  mockDelete(`/ledgers/${LEDGER}/transactions/e1`, undefined, 204);
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  fireEvent.press(await screen.findByTestId('tx-row-e1-delete'));
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

  expect(await screen.findByTestId('tx-empty')).toHaveTextContent(/这个账本还没有交易/);
  expect(screen.queryByTestId('tx-empty-filtered-state')).toBeNull();

  router.unmount();
  queryClient.clear();

  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions?q=没有这个词` });

  expect(await screen.findByTestId('tx-empty-filtered-state')).toHaveTextContent(
    /没有符合筛选条件的交易/,
  );
  expect(screen.queryByTestId('tx-empty')).toBeNull();
  // One condition is not enough for the rescue block (decision §14.52 A15).
  expect(screen.queryByTestId('tx-empty-filtered')).toBeNull();
});

test('an imported row carries a badge that leads to its import batch', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse());
  renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions` });

  expect(await screen.findByTestId('tx-row-im1-badge-imported')).toHaveTextContent('导入');
});
