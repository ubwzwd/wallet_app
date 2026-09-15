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
 * The second journey is the import flow of 04 §4.10 / §8.5, every step of it on the same
 * real route tree:
 *
 *   /l/<id>/imports  (history, empty)  →  /l/<id>/imports/guide  →  /l/<id>/imports/new
 *       →  pick the account, paste a CSV  →  /l/<id>/imports/<batch>  (review)
 *       →  fill the one blank category in  →  commit  →  the committed panel
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
import type { ImportRow, Transaction, TransactionListResponse } from '@/api/types';
import { initI18n } from '@/i18n';
import { resetLedgerGone } from '@/navigation';
import { queryClient } from '@/queries';
import * as breakpoint from '@/theme/useBreakpoint';
import {
  apiUrl,
  makeCategoryTree,
  makeCurrencyList,
  makeImportBatch,
  makeImportCommitResult,
  makeImportFormat,
  makeImportRow,
  makeLedger,
  makeSource,
  makeStatsSummary,
  makeStatsTrend,
  makeTransaction,
  makeUser,
  mockApi,
  mockGet,
  mockPatch,
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

// ── the import journey's server state ─────────────────────────────────────────────
const BATCH = 'batch-app-flow';
const IMPORTS_PATH = `/ledgers/${LEDGER}/imports`;
const BATCH_PATH = `${IMPORTS_PATH}/${BATCH}`;

/**
 * The two rows the pasted text below parses into. Deliberately tiny: `DataTable` windows
 * its rows, so a long batch would mount only the visible slice and this journey is about
 * the route tree, not about scrolling.
 */
const PASTED_CSV = [
  '# version: 2026-09-10',
  'date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref',
  '2026-09-01,-45.00,CNY,expense,,,瑞幸咖啡,,food,lunch,p1:2',
  '2026-09-02,-238.00,CNY,expense,,,淘宝,,,,p1:3',
].join('\n');

function draftRows(): ImportRow[] {
  return [
    makeImportRow({
      id: 'draft-coffee', batch_id: BATCH, row_no: 1, date: '2026-09-01',
      amount: '-45.0000', merchant: '瑞幸咖啡', note: null,
      category_l1: 'food', category_l2: 'lunch', source_ref: 'p1:2',
    }),
    // The one row the user has to finish by hand (04 §4.11.4).
    makeImportRow({
      id: 'draft-taobao', batch_id: BATCH, row_no: 2, date: '2026-09-02',
      amount: '-238.0000', merchant: '淘宝', note: null,
      category_l1: null, category_l2: null, source_ref: 'p1:3',
    }),
  ];
}

function uploadedBatch(over: Parameters<typeof makeImportBatch>[0] = {}) {
  return makeImportBatch({
    id: BATCH, source_id: CREDIT.id, source_name: CREDIT.name, source: 'paste',
    filename: null, size_bytes: PASTED_CSV.length, status: 'ready', row_count: 2,
    net_amount: '-283.0000', uncategorized_count: 1,
    flags_summary: { duplicate: 0, refund_candidate: 0, transfer_candidate: 0, needs_review: 0 },
    row_status_summary: { pending: 2, edited: 0, skipped: 0 },
    ...over,
  });
}

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

test('the import tab walks guide → paste → review → commit (04 §4.10, §8.5)', async () => {
  const rows = draftRows();
  mockGet(IMPORTS_PATH, { items: [], total: 0 });
  mockGet(`/ledgers/${LEDGER}/members`, { items: [], total: 0 });
  mockGet('/import-format', makeImportFormat());
  // The 201 seeds batch and rows into the cache, so review needs no follow-up request;
  // these two answer anyway, because this journey must not depend on cache retention.
  mockGet(BATCH_PATH, uploadedBatch());
  mockGet(`${BATCH_PATH}/rows`, { items: rows, total: rows.length });
  mockPost(IMPORTS_PATH, { batch: uploadedBatch(), rows }, 201);
  mockPatch(`${BATCH_PATH}/rows/draft-taobao`, {
    ...rows[1], category_l1: 'shopping', category_l2: null, status: 'edited',
  });
  mockPost(
    `${BATCH_PATH}/commit`,
    makeImportCommitResult({
      batch_id: BATCH, created_transactions: 2, created_transfer_pairs: 0,
      paired_existing_transfers: 0, linked_refunds: 0, skipped_rows: 0,
    }),
  );
  const router = renderRouter(APP_ROUTES, { initialUrl: `/l/${LEDGER}/imports` });

  // ── 1. no session yet, so the guard sends us through sign-in first ────────────────
  await waitFor(() => expect(router.getPathname()).toBe('/login'));
  fireEvent.changeText(await screen.findByTestId('login-email'), EMAIL);
  fireEvent.changeText(screen.getByTestId('login-password'), PASSWORD);
  fireEvent.press(screen.getByTestId('login-submit'));

  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/imports`));
  expect(await screen.findByTestId('imports-history-screen')).toBeTruthy();
  expect(await screen.findByTestId('imports-empty')).toBeTruthy();

  // ── 2. the empty state's action is the import page, step one of the flow ─────────
  fireEvent.press(screen.getByTestId('imports-empty-primary'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/imports/new`));
  expect(await screen.findByTestId('guide-skill-text')).toBeTruthy();

  // ── 3. pick the target account, paste the statement, send it ─────────────────────
  fireEvent.press(await screen.findByTestId('upload-source-picker-trigger'));
  fireEvent.press(await screen.findByTestId(`upload-source-picker-option-${CREDIT.id}`));
  fireEvent.changeText(await screen.findByTestId('upload-paste-input'), PASTED_CSV);
  fireEvent.press(screen.getByTestId('upload-submit'));

  // ── 4. review, on the batch the 201 came back with ────────────────────────────────
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER}/imports/${BATCH}`));
  expect(requestedPaths('post')).toEqual(['/auth/login', IMPORTS_PATH]);
  expect(JSON.parse(String(api.mock.history.post[1].data))).toEqual({
    source_id: CREDIT.id,
    text: PASTED_CSV,
  });
  expect(await screen.findByTestId('import-batch-screen')).toBeTruthy();
  expect(await screen.findByTestId('review-cards-row-2')).toHaveTextContent(/淘宝/);

  // The blank category blocks the commit until it is filled in (04 §4.11.8).
  expect(screen.getByTestId('review-commit-block')).toBeTruthy();
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBe(
    true,
  );

  // ── 5. fill the category in — one PATCH, and the blocker goes away ───────────────
  // The category picker only wakes up once `GET /categories` has landed.
  fireEvent.press(await screen.findByTestId('review-2-l1-trigger'));
  fireEvent.press(await screen.findByTestId('review-2-l1-l1-shopping'));
  await waitFor(() => expect(api.mock.history.patch).toHaveLength(1));
  // Only what changed goes on the wire — `category_l2` was already null (04 §4.11.5).
  expect(JSON.parse(String(api.mock.history.patch[0].data))).toEqual({
    category_l1: 'shopping',
  });
  await waitFor(() => expect(screen.queryByTestId('review-commit-block')).toBeNull());

  // ── 6. commit, and land on the committed panel (step three of 04 §4.10) ──────────
  fireEvent.press(screen.getByTestId('review-commit-submit'));
  expect(await screen.findByTestId('import-committed')).toBeTruthy();
  // The detailed sentence, built from the commit response's five counters — not the
  // shorter fallback a page opened later has to settle for.
  expect(screen.getByTestId('import-committed-summary')).toHaveTextContent(
    i18next.t('import:committed.summary', {
      created: 2, pairs: 0, paired: 0, refunds: 0, skipped: 0,
    }),
  );
  expect(requestedPaths('post')).toContain(`${BATCH_PATH}/commit`);
  // The review table is gone; the URL is the same batch it always was.
  expect(screen.queryByTestId('review-commit-submit')).toBeNull();
  expect(router.getPathname()).toBe(`/l/${LEDGER}/imports/${BATCH}`);
});
