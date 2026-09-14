/**
 * 转账详情 (04 §4.7, §8.3 的「交易详情」行; decisions §1.2, §14.34, §14.53a).
 *
 * Two shapes, both mounted through the real route tree: the two-leg pair at
 * `/transfers/:pairId` (both legs, 拆开, 删除) and the single leg at `/transactions/:txId`
 * (关联为转账对腿). The candidate picker is the interesting half: it must offer only rows
 * that the backend would actually accept as the other leg, and the confirm box has to say
 * what pairing does to the subtype before it happens.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../../../app/_layout';
import AppGroupLayout from '../../../../../app/(app)/_layout';
import LedgerLayout from '../../../../../app/(app)/l/[ledgerId]/_layout';
import TransactionDetailRoute from '../../../../../app/(app)/l/[ledgerId]/transactions/[txId]/index';
import TransferDetailRoute from '../../../../../app/(app)/l/[ledgerId]/transfers/[pairId]/index';

import { setAuthToken } from '@/api/client';
import type { Transaction, TransactionListResponse, TransferPair } from '@/api/types';
import { initI18n } from '@/i18n';
import { resetLedgerGone } from '@/navigation';
import { queryClient } from '@/queries';
import * as breakpoint from '@/theme/useBreakpoint';
import {
  makeCategoryTree,
  makeCurrencyList,
  makeLedger,
  makeSource,
  makeTransaction,
  makeUser,
} from '@/test/fixtures';
import { apiUrl, mockApi, mockDelete, mockGet, mockPost, type MockApi } from '@/test/mockApi';
import { toast } from '@/ui';

const LEDGER = 'ledger-transfer';
const PAIR = 'pair-77';

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
  '(app)/l/[ledgerId]/transfers/[pairId]/index': TransferDetailRoute,
  '(app)/l/[ledgerId]/transfers/[pairId]/edit': () => <RNText>transfer-edit-page</RNText>,
};

const OUT = makeTransaction({
  id: 'leg-out',
  source_id: 's1',
  kind: 'transfer',
  amount: '-3000.0000',
  amount_base: '-3000.0000',
  currency: 'CNY',
  occurred_at: '2026-09-08',
  merchant: null,
  category_l1: null,
  category_l2: null,
  note: '信用卡还款',
  transfer_role: 'out',
  transfer_subtype: 'repayment',
  transfer_pair_id: PAIR,
});

const IN = makeTransaction({
  ...OUT,
  id: 'leg-in',
  source_id: 's2',
  amount: '3000.0000',
  amount_base: '3000.0000',
  transfer_role: 'in',
});

function pairResponse(): TransferPair {
  return {
    pair_id: PAIR,
    occurred_at: '2026-09-08',
    subtype: 'repayment',
    note: '信用卡还款',
    out: OUT,
    in: IN,
    updated_at: '2026-09-08T11:00:00.000000Z',
  };
}

function listResponse(items: Transaction[]): TransactionListResponse {
  return {
    items,
    total: items.length,
    summary: {
      base_currency: 'CNY',
      expense: '0',
      income: '0',
      net: '0',
      count: items.length,
      rate_missing_count: 0,
    },
  };
}

/** `toHaveTextContent` compares the WHOLE subtree's text, so a substring needs a regexp. */
function containing(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** The query params of every `GET` the adapter recorded for `path`, oldest first. */
function getsFor(path: string): Array<Record<string, unknown>> {
  return api.mock.history.get
    .filter((entry) => entry.url === path || entry.url === apiUrl(path))
    .map((entry) => (entry.params ?? {}) as Record<string, unknown>);
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
  mockGet(`/ledgers/${LEDGER}/members`, { items: [], total: 0 });
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(false);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
});

// ------------------------------------------------------------- the two-leg page

test('both legs are shown with their own account and amount, and no running balance', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions/transfer/${PAIR}`, pairResponse());
  mockGet(`/ledgers/${LEDGER}/transactions/leg-out`, { ...OUT, events: [] });
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transfers/${PAIR}` });

  expect(await router.findByTestId('transfer-detail-legs-out-source')).toHaveTextContent(
    '招行储蓄卡',
  );
  expect(router.getByTestId('transfer-detail-legs-out-amount')).toHaveTextContent('−¥3,000.00');
  expect(router.getByTestId('transfer-detail-legs-in-source')).toHaveTextContent('建行信用卡');
  expect(router.getByTestId('transfer-detail-legs-in-amount')).toHaveTextContent('¥3,000.00');

  // Header fields come off the out leg / the pair (decision §14.53a); no 余后 (§14.52 A7).
  expect(router.getByTestId('transfer-detail-header-extra')).toHaveTextContent('信用卡还款');
  expect(router.queryByText(containing('余后'))).toBeNull();

  // 屏幕稿 07 (B16): the bar names the move, not just 「交易」.
  expect(router.getByTestId('top-bar-title')).toHaveTextContent(
    '交易 · 9月8日 · 招行储蓄卡 → 建行信用卡',
  );
});

test('a cross-currency pair gives each leg its own rate line', async () => {
  const out = {
    ...OUT,
    currency: 'USD',
    amount: '-100.0000',
    amount_base: '-716.9400',
    rate_used: '7.16940000',
    rate_date: '2026-09-08',
  };
  const into = {
    ...IN,
    currency: 'EUR',
    amount: '92.0000',
    amount_base: '716.9400',
    rate_used: '7.79280000',
    // A day behind the transfer: the fallback hint belongs to this leg alone.
    rate_date: '2026-09-07',
  };
  mockGet(`/ledgers/${LEDGER}/transactions/transfer/${PAIR}`, {
    ...pairResponse(),
    out,
    in: into,
  });
  mockGet(`/ledgers/${LEDGER}/transactions/leg-out`, { ...out, events: [] });
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transfers/${PAIR}` });

  expect(await router.findByTestId('transfer-detail-legs-out-rate-text')).toHaveTextContent(
    containing('按 9月8日 汇率 1 USD = 7.1694 CNY'),
  );
  expect(router.getByTestId('transfer-detail-legs-in-rate-text')).toHaveTextContent(
    containing('按 9月7日 汇率 1 EUR = 7.7928 CNY'),
  );
  // Only the in leg fell back to another day's quote.
  expect(router.getByTestId('transfer-detail-legs-in-rate-fallback')).toHaveTextContent(
    containing('该日无行情'),
  );
  expect(router.queryByTestId('transfer-detail-legs-out-rate-fallback')).toBeNull();
});

test('「拆开」warns what unpairing does, then lands on the out leg\'s own page', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions/transfer/${PAIR}`, pairResponse());

  // The leg answers as 03 §5.27 does while it is still paired — `pair` expanded — and only
  // the unpair call turns it into a single leg. A screen that navigates to the leg without
  // dropping the cached `pair` would bounce straight back to the pair page it just deleted.
  const pairedLeg = {
    ...OUT,
    events: [],
    pair: {
      pair_id: PAIR,
      out: { transaction_id: 'leg-out', source_id: 's1', amount: OUT.amount, currency: 'CNY' },
      in: { transaction_id: 'leg-in', source_id: 's2', amount: IN.amount, currency: 'CNY' },
    },
  };
  const single = { ...OUT, transfer_pair_id: null, pair: null, events: [] };
  let unpaired = false;
  api.mock.onGet(apiUrl(`/ledgers/${LEDGER}/transactions/leg-out`)).reply(async () => {
    // The refetch the unpair triggers takes a moment, exactly as a network round trip does:
    // the navigation happens first, so whatever sits in the cache is what the leg's page
    // renders from.
    if (unpaired) await new Promise((resolve) => setTimeout(resolve, 50));
    return [200, unpaired ? single : pairedLeg];
  });
  api.mock
    .onPost(apiUrl(`/ledgers/${LEDGER}/transactions/transfer/${PAIR}/unpair`))
    .reply(() => {
      unpaired = true;
      // 03 §5.34's own shape, plus the `{out, in}` the api layer currently types (that
      // mismatch is escalated); the screen must not depend on either.
      return [
        200,
        {
          pair_id: PAIR,
          unpaired: [single, { ...IN, transfer_pair_id: null }],
          out: single,
          in: { ...IN, transfer_pair_id: null },
        },
      ];
    });
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transfers/${PAIR}` });

  fireEvent.press(await router.findByTestId('transfer-detail-actions-unpair'));
  expect(await router.findByTestId('confirm-dialog')).toHaveTextContent(
    containing('拆开后两条各自变成单腿转账，仍计入账户余额，但不再互相关联'),
  );

  fireEvent.press(router.getByTestId('confirm-accept'));
  await waitFor(() =>
    expect(api.mock.history.post.filter((r) => (r.url ?? '').endsWith('/unpair'))).toHaveLength(1),
  );
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/leg-out`),
  );
  // ...and stays there: the leg's page must not redirect back to the pair that is gone.
  expect(await router.findByTestId('tx-detail-header')).toBeTruthy();
  await waitFor(() => expect(router.getByTestId('tx-detail-pair')).toBeTruthy());
  expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/leg-out`);
});

test('deleting a two-leg transfer goes through the pair endpoint, not a leg', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions/transfer/${PAIR}`, pairResponse());
  mockGet(`/ledgers/${LEDGER}/transactions/leg-out`, { ...OUT, events: [] });
  mockDelete(`/ledgers/${LEDGER}/transactions/transfer/${PAIR}`, undefined, 204);
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transfers/${PAIR}` });

  fireEvent.press(await router.findByTestId('transfer-detail-actions-delete'));
  expect(await router.findByTestId('confirm-dialog')).toHaveTextContent(
    containing('删除会同时删除两腿'),
  );
  fireEvent.press(router.getByTestId('confirm-accept'));

  await waitFor(() => expect(api.mock.history.delete).toHaveLength(1));
  expect(api.mock.history.delete[0].url).toBe(
    `/ledgers/${LEDGER}/transactions/transfer/${PAIR}`,
  );
});

// ------------------------------------------------------------ the single-leg page

const SOLO = makeTransaction({
  id: 'solo',
  source_id: 's1',
  kind: 'transfer',
  amount: '-5000.0000',
  amount_base: '-5000.0000',
  occurred_at: '2026-09-05',
  merchant: null,
  category_l1: null,
  category_l2: null,
  note: null,
  counterparty: '工资卡',
  transfer_role: 'out',
  transfer_subtype: 'plain',
  transfer_pair_id: null,
  events: [],
});

/** One legal candidate and three the backend would reject with 400 `pair_invalid`. */
function candidates(): Transaction[] {
  const base = {
    kind: 'transfer' as const,
    occurred_at: '2026-09-05',
    merchant: null,
    category_l1: null,
    category_l2: null,
    currency: 'CNY',
  };
  return [
    makeTransaction({
      ...base,
      id: 'cand-ok',
      source_id: 's2',
      amount: '5000.0000',
      amount_base: '5000.0000',
      transfer_role: 'in',
      // Subtype deliberately differs from the leg's: pairing must not filter on it (§14.53a).
      transfer_subtype: 'repayment',
      transfer_pair_id: null,
    }),
    makeTransaction({
      ...base,
      id: 'cand-same-direction',
      source_id: 's2',
      amount: '-5000.0000',
      amount_base: '-5000.0000',
      transfer_role: 'out',
      transfer_subtype: 'plain',
      transfer_pair_id: null,
    }),
    makeTransaction({
      ...base,
      id: 'cand-already-paired',
      source_id: 's2',
      amount: '5000.0000',
      amount_base: '5000.0000',
      transfer_role: 'in',
      transfer_subtype: 'plain',
      transfer_pair_id: 'some-other-pair',
    }),
    makeTransaction({
      ...base,
      id: 'cand-same-source',
      source_id: 's1',
      amount: '5000.0000',
      amount_base: '5000.0000',
      transfer_role: 'in',
      transfer_subtype: 'plain',
      transfer_pair_id: null,
    }),
  ];
}

test('a single leg names the other side and offers 「关联为转账对腿」', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions/solo`, SOLO);
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions/solo` });

  expect(await router.findByTestId('tx-detail-pair-counterparty')).toHaveTextContent('工资卡');
  expect(router.getByTestId('tx-detail-pair-action')).toBeTruthy();
  // 屏幕稿 07 (B16): 「交易 · 9月5日 · 对方：工资卡」.
  expect(router.getByTestId('top-bar-title')).toHaveTextContent('交易 · 9月5日 · 对方：工资卡');
  // A single leg has nothing to unpair.
  expect(router.queryByTestId('tx-detail-actions-unpair')).toBeNull();
});

test('a single leg with no counterparty text says 对方不在应用里', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions/solo2`, { ...SOLO, id: 'solo2', counterparty: null });
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions/solo2` });

  expect(await router.findByTestId('tx-detail-pair-counterparty')).toHaveTextContent(
    '对方不在应用里',
  );
});

test('the picker lists only a legal other leg, and pairing lands on the pair page', async () => {
  mockGet(`/ledgers/${LEDGER}/transactions/solo`, SOLO);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse(candidates()));
  mockGet(`/ledgers/${LEDGER}/transactions/transfer/${PAIR}`, pairResponse());
  mockGet(`/ledgers/${LEDGER}/transactions/leg-out`, { ...OUT, events: [] });
  mockPost(`/ledgers/${LEDGER}/transactions/solo/pair`, pairResponse());
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions/solo` });

  fireEvent.press(await router.findByTestId('tx-detail-pair-action'));

  // Only the opposite-direction, still-single, other-account row survives.
  expect(await router.findByTestId('tx-detail-pair-picker-row-cand-ok')).toBeTruthy();
  expect(router.queryByTestId('tx-detail-pair-picker-row-cand-same-direction')).toBeNull();
  expect(router.queryByTestId('tx-detail-pair-picker-row-cand-already-paired')).toBeNull();
  expect(router.queryByTestId('tx-detail-pair-picker-row-cand-same-source')).toBeNull();

  // `kind=transfer` travels with the request and cannot be clicked away; the ±3-day window
  // is prefilled and stays editable.
  const params = getsFor(`/ledgers/${LEDGER}/transactions`);
  expect(params[0]).toMatchObject({
    kind: ['transfer'],
    from: '2026-09-02',
    to: '2026-09-08',
  });

  fireEvent.press(router.getByTestId('tx-detail-pair-picker-row-cand-ok'));
  // The confirm box states the subtype rule of decision §14.53a before anything is sent.
  expect(await router.findByTestId('confirm-dialog')).toHaveTextContent(
    containing('配对后两条的子类型会统一'),
  );

  fireEvent.press(router.getByTestId('confirm-accept'));
  await waitFor(() =>
    expect(api.mock.history.post.filter((r) => (r.url ?? '').endsWith('/pair'))).toHaveLength(1),
  );
  expect(JSON.parse(api.mock.history.post[0].data as string)).toEqual({
    other_transaction_id: 'cand-ok',
  });
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transfers/${PAIR}`));
});

test('turning the same-currency-same-amount filter off widens the candidate list', async () => {
  const odd = makeTransaction({
    id: 'cand-odd',
    source_id: 's2',
    kind: 'transfer',
    amount: '4999.0000',
    amount_base: '4999.0000',
    occurred_at: '2026-09-05',
    merchant: null,
    category_l1: null,
    category_l2: null,
    transfer_role: 'in',
    transfer_subtype: 'plain',
    transfer_pair_id: null,
  });
  mockGet(`/ledgers/${LEDGER}/transactions/solo`, SOLO);
  mockGet(`/ledgers/${LEDGER}/transactions`, listResponse([odd]));
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER}/transactions/solo` });

  fireEvent.press(await router.findByTestId('tx-detail-pair-action'));
  // Nothing matches at the same amount, and the empty state explains what a leg must be.
  expect(await router.findByTestId('tx-detail-pair-picker-empty')).toHaveTextContent(
    '没有能配对的转账',
  );

  fireEvent.press(router.getByTestId('tx-detail-pair-strict'));
  expect(await router.findByTestId('tx-detail-pair-picker-row-cand-odd')).toBeTruthy();
});
