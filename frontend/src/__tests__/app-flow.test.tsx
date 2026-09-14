/**
 * One pass through the whole application, on the real route tree (04 §8.3).
 *
 * Every other integration test mounts the routes it needs and stubs the rest. This one
 * stubs nothing: the map below is the actual `app/` directory, every route module of it,
 * so the root layout's provider stack, both group layouts, the ledger layout, the three
 * guards, the shell chrome and the five screens under test all run exactly as they do in
 * the browser. Only the server is fake. (Keep it that way: a tab or sidebar link whose
 * module is missing from the map lands on `+not-found` instead of failing loudly.)
 *
 * The journey is the one a new user takes on their first deep link:
 *
 *   /l/<id>  (anonymous)  →  /login?next=/l/<id>  →  sign in  →  /l/<id>
 *       →  bottom tab 交易  →  /l/<id>/transactions
 *       →  bottom tab ＋     →  /l/<id>/transactions/new
 *
 * The assertions are on what the server was asked for (POST /auth/login, GET /me,
 * GET /ledgers), which URL the router ended up at, and what actually rendered.
 */
import React from 'react';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`; fonts never gate rendering, so the root layout's
// `useAppFonts()` is stubbed, exactly as the other route-tree tests do.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../app/_layout';
import LandingRoute from '../../app/index';
import NotFoundRoute from '../../app/+not-found';
import AuthGroupLayout from '../../app/(auth)/_layout';
import LoginRoute from '../../app/(auth)/login';
import RegisterRoute from '../../app/(auth)/register';
import AppGroupLayout from '../../app/(app)/_layout';
import LedgersRoute from '../../app/(app)/ledgers/index';
import LedgersGroupLayout from '../../app/(app)/ledgers/_layout';
import PersonalSettingsRoute from '../../app/(app)/settings';
import LedgerLayout from '../../app/(app)/l/[ledgerId]/_layout';
import LedgerHomeRoute from '../../app/(app)/l/[ledgerId]/index';
import TransactionsRoute from '../../app/(app)/l/[ledgerId]/transactions/index';
import NewTransactionRoute from '../../app/(app)/l/[ledgerId]/transactions/new';
import SourcesRoute from '../../app/(app)/l/[ledgerId]/sources/index';
import ImportsRoute from '../../app/(app)/l/[ledgerId]/imports/index';
import ImportsGuideRoute from '../../app/(app)/l/[ledgerId]/imports/guide';
import NewImportRoute from '../../app/(app)/l/[ledgerId]/imports/new';
import ImportBatchRoute from '../../app/(app)/l/[ledgerId]/imports/[batchId]';
import LedgerSettingsRoute from '../../app/(app)/l/[ledgerId]/settings';
import NewSourceRoute from '../../app/(app)/l/[ledgerId]/sources/new';
import EditSourceRoute from '../../app/(app)/l/[ledgerId]/sources/[sourceId]/edit';
import TransactionDetailRoute from '../../app/(app)/l/[ledgerId]/transactions/[txId]/index';
import EditTransactionRoute from '../../app/(app)/l/[ledgerId]/transactions/[txId]/edit';
import TransferDetailRoute from '../../app/(app)/l/[ledgerId]/transfers/[pairId]/index';
import EditTransferRoute from '../../app/(app)/l/[ledgerId]/transfers/[pairId]/edit';
import JoinLedgerRoute from '../../app/(app)/ledgers/join';
import NewLedgerRoute from '../../app/(app)/ledgers/new';

import { clearAuthToken } from '@/api/client';
import type { Transaction, TransactionListResponse } from '@/api/types';
import { initI18n } from '@/i18n';
import { resetLedgerGone } from '@/navigation';
import { queryClient } from '@/queries';
import * as breakpoint from '@/theme/useBreakpoint';
import {
  apiUrl,
  makeCategoryTree,
  makeCurrencyList,
  makeLedger,
  makeSource,
  makeStatsSummary,
  makeStatsTrend,
  makeTransaction,
  makeUser,
  mockApi,
  mockGet,
  mockPost,
  type MockApi,
} from '@/test';
import { toast } from '@/ui';
import { PREF_NAMES, setJsonPref, setPref } from '@/utils/prefs';

const LEDGER = 'ledger-flow';
const EMAIL = 'alice@example.com';
const PASSWORD = 'hunter2';
const FRESH_TOKEN = 'fresh-access-token';

/**
 * The `app/` directory, as it is on disk. Keys are the route paths Expo Router derives
 * from the file names; values are the real route modules.
 */
const APP_ROUTES = {
  _layout: RootLayout,
  index: LandingRoute,
  '+not-found': NotFoundRoute,
  '(auth)/_layout': AuthGroupLayout,
  '(auth)/login': LoginRoute,
  '(auth)/register': RegisterRoute,
  '(app)/_layout': AppGroupLayout,
  '(app)/settings': PersonalSettingsRoute,
  '(app)/ledgers/_layout': LedgersGroupLayout,
  '(app)/ledgers/index': LedgersRoute,
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': LedgerHomeRoute,
  '(app)/l/[ledgerId]/transactions/index': TransactionsRoute,
  '(app)/l/[ledgerId]/transactions/new': NewTransactionRoute,
  '(app)/l/[ledgerId]/sources/index': SourcesRoute,
  '(app)/l/[ledgerId]/imports/index': ImportsRoute,
  '(app)/l/[ledgerId]/imports/guide': ImportsGuideRoute,
  '(app)/l/[ledgerId]/imports/new': NewImportRoute,
  '(app)/l/[ledgerId]/imports/[batchId]': ImportBatchRoute,
  '(app)/l/[ledgerId]/settings': LedgerSettingsRoute,
  '(app)/l/[ledgerId]/sources/new': NewSourceRoute,
  '(app)/l/[ledgerId]/sources/[sourceId]/edit': EditSourceRoute,
  '(app)/l/[ledgerId]/transactions/[txId]/index': TransactionDetailRoute,
  '(app)/l/[ledgerId]/transactions/[txId]/edit': EditTransactionRoute,
  '(app)/l/[ledgerId]/transfers/[pairId]/index': TransferDetailRoute,
  '(app)/l/[ledgerId]/transfers/[pairId]/edit': EditTransferRoute,
  '(app)/ledgers/join': JoinLedgerRoute,
  '(app)/ledgers/new': NewLedgerRoute,
};

const CHECKING = makeSource({
  id: 'src-checking',
  name: '招行储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
  balance: '1200.0000',
  balance_base: '1200.0000',
});
const CREDIT = makeSource({
  id: 'src-credit',
  name: '招行信用卡',
  type: 'credit',
  default_currency: 'CNY',
  balance: '-300.0000',
  balance_base: '-300.0000',
});

function txItems(): Transaction[] {
  return [
    makeTransaction({
      id: 'tx-lunch',
      source_id: CHECKING.id,
      occurred_at: '2026-09-10',
      amount: '-45.0000',
      amount_base: '-45.0000',
      category_l1: 'food',
      category_l2: 'lunch',
      merchant: '瑞幸咖啡',
      note: null,
    }),
  ];
}

const TX_PAGE: TransactionListResponse = {
  items: txItems(),
  total: 1,
  summary: {
    base_currency: 'CNY',
    expense: '45.0000',
    income: '0.0000',
    net: '-45.0000',
    count: 1,
    rate_missing_count: 0,
  },
};

let api: MockApi;
let wideSpy: jest.SpyInstance;

/** Every GET the adapter saw, as paths relative to the API base. */
function requestedPaths(verb: 'get' | 'post'): string[] {
  return api.mock.history[verb].map((entry) => (entry.url ?? '').replace(apiUrl(''), ''));
}

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  // The app client retries 5xx twice with backoff; nothing here needs that, and it only
  // slows a failing assertion down.
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false, gcTime: 0 },
  });
  resetLedgerGone();
  toast.clear();
  await initI18n();
  await i18next.changeLanguage('zh');
  await clearAuthToken();
  await setPref(PREF_NAMES.lastLedgerId, null);
  await setPref(PREF_NAMES.onboardingHint, null);
  await setJsonPref(PREF_NAMES.categories, null);
  await setPref(PREF_NAMES.lastSource(LEDGER), null);

  // The narrow layout is the one with the bottom tab bar, which is how this journey
  // moves between pages.
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(false);

  // The server. Handlers are first-match-wins, so each path is registered once.
  mockPost('/auth/login', { access_token: FRESH_TOKEN, token_type: 'bearer' });
  mockGet('/me', makeUser({ email: EMAIL }));
  mockGet('/config', { registration_open: true });
  mockGet('/ledgers', {
    items: [makeLedger({ id: LEDGER, name: '家庭账本', base_currency: 'CNY' })],
    total: 1,
  });
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', makeCurrencyList());
  mockGet(`/ledgers/${LEDGER}/sources`, { items: [CHECKING, CREDIT], total: 2 });
  mockGet(`/ledgers/${LEDGER}/stats/summary`, makeStatsSummary());
  mockGet(`/ledgers/${LEDGER}/stats/trend`, makeStatsTrend());
  mockGet(`/ledgers/${LEDGER}/transactions`, TX_PAGE);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
});

test('a deep link, a sign-in, and the walk from home to the new-transaction form', async () => {
  const router = renderRouter(APP_ROUTES, { initialUrl: `/l/${LEDGER}` });

  // ── 1. anonymous deep link → the sign-in page, with the destination kept ──────────
  await waitFor(() => expect(router.getPathname()).toBe('/login'));
  expect(router.getSearchParams().next).toBe(`/l/${LEDGER}`);
  expect(await screen.findByTestId('login-screen')).toBeTruthy();
  // Nothing was fetched on the user's behalf while they were anonymous.
  expect(requestedPaths('get')).not.toContain(`/ledgers/${LEDGER}/stats/summary`);

  // ── 2. sign in ───────────────────────────────────────────────────────────────────
  fireEvent.changeText(screen.getByTestId('login-email'), EMAIL);
  fireEvent.changeText(screen.getByTestId('login-password'), PASSWORD);
  fireEvent.press(screen.getByTestId('login-submit'));

  await waitFor(() => expect(api.mock.history.post.length).toBe(1));
  expect(requestedPaths('post')).toEqual(['/auth/login']);
  expect(JSON.parse(String(api.mock.history.post[0].data))).toEqual({
    email: EMAIL,
    password: PASSWORD,
  });

  // ── 3. back at the destination, with the session bootstrapped ────────────────────
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}`));
  const afterLogin = requestedPaths('get');
  expect(afterLogin).toContain('/me');
  expect(afterLogin).toContain('/ledgers');

  // The home page's three numbers and the per-account balance cards.
  expect(await screen.findByTestId('home-networth')).toBeTruthy();
  expect(screen.getByTestId('home-assets')).toBeTruthy();
  expect(screen.getByTestId('home-liabilities')).toBeTruthy();
  expect(screen.getByTestId('home-net-worth')).toBeTruthy();
  expect(await screen.findByTestId(`home-balance-${CHECKING.id}`)).toHaveTextContent(
    /招行储蓄卡/,
  );
  expect(screen.getByTestId(`home-balance-${CREDIT.id}`)).toHaveTextContent(/招行信用卡/);

  // ── 4. the bottom tab bar takes us to the transaction list ───────────────────────
  fireEvent.press(screen.getByTestId('tab-transactions'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions`));

  expect(await screen.findByTestId('transactions-screen')).toBeTruthy();
  expect(await screen.findByTestId('tx-row-tx-lunch')).toHaveTextContent(/瑞幸咖啡/);
  // The footer reads the server's summary, not the page.
  expect(screen.getByTestId('tx-count')).toBeTruthy();

  // ── 5. ＋ opens the new-transaction form ─────────────────────────────────────────
  fireEvent.press(screen.getByTestId('tab-add'));
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER}/transactions/new`),
  );
  expect(router.getSearchParams().kind).toBe('expense');

  expect(await screen.findByTestId('tx-new')).toBeTruthy();
  expect(screen.getByTestId('tx-kind')).toBeTruthy();
  expect(screen.getByTestId('tx-submit')).toBeTruthy();
});

test('the import tab reaches the batch history and its guide (04 §4.10)', async () => {
  mockGet(`/ledgers/${LEDGER}/imports`, { items: [], total: 0 });
  mockGet(`/ledgers/${LEDGER}/members`, { items: [], total: 0 });
  const router = renderRouter(APP_ROUTES, { initialUrl: `/l/${LEDGER}/imports` });

  // No session yet, so the guard sends us through sign-in first — the same round trip as
  // above, which is what makes `/imports` reachable at all from a cold deep link.
  await waitFor(() => expect(router.getPathname()).toBe('/login'));
  fireEvent.changeText(await screen.findByTestId('login-email'), EMAIL);
  fireEvent.changeText(screen.getByTestId('login-password'), PASSWORD);
  fireEvent.press(screen.getByTestId('login-submit'));

  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/imports`));
  expect(await screen.findByTestId('imports-history-screen')).toBeTruthy();
  expect(await screen.findByTestId('imports-empty')).toBeTruthy();

  // The empty state's action is the guide, which is the first step of the flow.
  fireEvent.press(screen.getByTestId('imports-empty-primary'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/imports/guide`));
});
