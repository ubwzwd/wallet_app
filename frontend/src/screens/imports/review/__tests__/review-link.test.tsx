/**
 * The "link / counterparty" cell (04 §4.11.3, §8.4 cases 6–7; decisions §14.34, §14.53b/c).
 *
 * The point of these tests is that pairing has exactly one carrier: unchecking the box
 * sends `{matched_transaction_id: null}` and nothing else, the multi-candidate row carries
 * both flags but no prefill, and the two counterparty controls are mutually exclusive.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import type { ImportRow, Transaction } from '@/api/types';
import { initI18n } from '@/i18n';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import * as breakpoint from '@/theme/useBreakpoint';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  BATCH_ID,
  LEDGER_ID,
  SOURCE_ID,
  apiUrl,
  makeCategoryTree,
  makeCurrencyList,
  makeImportBatch,
  makeImportRow,
  makeLedger,
  makeSource,
  makeTestQueryClient,
  makeTransaction,
  makeUser,
  mockApi,
  mockGet,
  type MockApi,
} from '@/test';

import ImportBatchScreen from '../../ImportBatchScreen';

let queryClient: QueryClient;
let api: MockApi;

const LEDGER = makeLedger({ base_currency: 'CNY' });
const SOURCE = makeSource({ id: SOURCE_ID, name: '招行信用卡', default_currency: 'CNY' });
const SAVINGS = makeSource({ id: 'src-savings', name: '招行储蓄卡' });
const ARCHIVED = makeSource({ id: 'src-old', name: '旧卡', archived: true });
const BATCH_PATH = `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}`;
const ROWS_PATH = `${BATCH_PATH}/rows`;
const TX_PATH = `/ledgers/${LEDGER_ID}/transactions`;
const REVIEW_URL = `/l/${LEDGER_ID}/imports/${BATCH_ID}`;

const OTHER_LEG: Transaction = makeTransaction({
  id: 'tx-leg', source_id: SAVINGS.id, kind: 'transfer', amount: '-1000.0000',
  currency: 'CNY', occurred_at: '2026-08-05', transfer_role: 'out', transfer_pair_id: null,
  category_l1: null, category_l2: null, merchant: null,
});

const ORIGIN: Transaction = makeTransaction({
  id: 'tx-origin', source_id: SOURCE_ID, kind: 'expense', amount: '-259.0000',
  currency: 'CNY', occurred_at: '2026-08-02', merchant: '淘宝',
});

function row(over: Partial<ImportRow>): ImportRow {
  return makeImportRow({ batch_id: BATCH_ID, ...over });
}

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <LedgerProvider ledgerId={LEDGER_ID} ledgers={[LEDGER]}>
            <TopBarProvider>
              <TopBarSurface onPressLedger={() => {}} />
              {children}
            </TopBarProvider>
          </LedgerProvider>
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
  'l/[ledgerId]/imports/[batchId]': ImportBatchScreen,
};

function seed(rows: ImportRow[]): void {
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  // The back button asks which ledger the chrome names; inside the app `RequireLedger`
  // has already cached this list.
  mockGet('/ledgers', { items: [LEDGER], total: 1 });
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', makeCurrencyList());
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [SOURCE, SAVINGS, ARCHIVED], total: 3 });
  mockGet(BATCH_PATH, makeImportBatch({ status: 'ready', row_count: rows.length }));
  mockGet(ROWS_PATH, { items: rows, total: rows.length });
}

const patchBodies = (): unknown[] =>
  api.mock.history.patch.map((r) => JSON.parse(String(r.data ?? '{}')));

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = makeTestQueryClient();
  await initI18n();
  await i18next.changeLanguage('zh');
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------- case 6

test('a single candidate arrives checked, and unchecking it sends only matched_transaction_id', async () => {
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000', transfer_role: 'in', date: '2026-08-05',
    flags: ['transfer_candidate'], matched_transaction_id: 'tx-leg',
  });
  seed([transfer]);
  mockGet(`${TX_PATH}/tx-leg`, OTHER_LEG);
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-3`)).reply(() => [
    200,
    { ...transfer, matched_transaction_id: null },
  ]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  const pair = await screen.findByTestId('review-3-link-pair');
  expect(pair.props.accessibilityState.checked).toBe(true);
  // The other side is named: account, day and amount (04 §4.11.3).
  const summary = await screen.findByTestId('review-3-link-pair-summary');
  expect(String(summary.props.children)).toContain('招行储蓄卡');
  expect(String(summary.props.children)).toContain('2026-08-05');
  // 屏幕稿 03: the 「账户 · 对手」 column of a *paired* leg names this row's own account —
  // the batch's — and leaves the other leg to the band underneath, which is the only
  // place that fetches it. (04 §4.11.2 still prescribes 「—」 here; §14.45 makes the
  // mockup win, and the docs-sync task carries the amendment.)
  expect(screen.getByTestId('review-3-link').props.children).toBe('招商 信用卡');

  fireEvent.press(pair);
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toEqual({ matched_transaction_id: null });
  await waitFor(() =>
    expect(screen.getByTestId('review-3-link-pair')).toBeTruthy(),
  );
  // Unchecked now, and the counterparty controls take its place.
  expect(screen.queryByTestId('review-3-link-pair-summary')).toBeNull();
  expect(screen.getByTestId('review-3-link-counterpart-trigger')).toBeTruthy();
});

test('several candidates carry both flags, no prefill, the hint and a "pick one" button', async () => {
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000', transfer_role: 'in', date: '2026-08-05',
    flags: ['transfer_candidate', 'needs_review'],
    matched_transaction_id: null,
    hint: '找到 3 条可以配对的转账，请选一条',
  });
  seed([transfer]);
  mockGet(TX_PATH, { items: [OTHER_LEG], total: 1, summary: null });
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-3`)).reply(() => [
    200,
    { ...transfer, matched_transaction_id: 'tx-leg' },
  ]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  // Both badges, an empty box, and the hint spelled out under the row.
  expect(await screen.findByTestId('review-3-flag-transfer_candidate')).toBeTruthy();
  expect(screen.getByTestId('review-3-flag-needs_review')).toBeTruthy();
  expect(screen.getByTestId('review-3-link-pair').props.accessibilityState.checked).toBe(false);
  expect(String(screen.getByTestId('review-3-hint').props.children)).toContain('找到 3 条');

  fireEvent.press(screen.getByTestId('review-3-link-pick-one'));
  // The candidate list is the plain transaction list, narrowed to transfers.
  await waitFor(() => {
    const listed = api.mock.history.get.filter((r) => r.url === TX_PATH);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[listed.length - 1].params.kind).toEqual(['transfer']);
  });

  fireEvent.press(await screen.findByTestId('review-3-link-picker-row-tx-leg'));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toEqual({ matched_transaction_id: 'tx-leg' });
});

test('with no candidate nothing is preselected and the two counterparty controls exclude each other', async () => {
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000', transfer_role: 'out', date: '2026-08-05',
    flags: [], matched_transaction_id: null, counterpart_source_id: null, counterparty: null,
  });
  seed([transfer]);
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-3`)).reply(() => [
    200,
    { ...transfer, counterparty: '工资卡' },
  ]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  const trigger = await screen.findByTestId('review-3-link-counterpart-trigger');
  // Nothing is guessed (decision §14.53c).
  expect(trigger.props.accessibilityState.expanded).toBe(false);
  expect(screen.getByTestId('review-3-link-counterparty').props.value).toBe('');

  // The picker never lists an archived account, nor the batch's own target account.
  fireEvent.press(trigger);
  expect(await screen.findByTestId('review-3-link-counterpart-option-src-savings')).toBeTruthy();
  expect(screen.queryByTestId('review-3-link-counterpart-option-src-old')).toBeNull();
  expect(screen.queryByTestId(`review-3-link-counterpart-option-${SOURCE_ID}`)).toBeNull();
  fireEvent.press(screen.getByTestId('review-3-link-counterpart-option-src-savings'));

  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  // Picking an account clears the free text in the same request.
  // `counterparty` was already null, so only the account is in the body.
  expect(patchBodies()[0]).toEqual({ counterpart_source_id: 'src-savings' });
});

test('typing a counterparty greys out the account picker', async () => {
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000', transfer_role: 'out', date: '2026-08-05',
    flags: [], matched_transaction_id: null,
  });
  seed([transfer]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  const text = await screen.findByTestId('review-3-link-counterparty');
  fireEvent.changeText(text, '工资卡');
  await waitFor(() =>
    expect(
      screen.getByTestId('review-3-link-counterpart-trigger').props.accessibilityState.disabled,
    ).toBe(true),
  );
});

// ---------------------------------------------------------------------- case 7

test('a refund candidate shows its prefilled origin, and re-picking or clearing writes matched_transaction_id', async () => {
  const refund = row({
    id: 'row-4', row_no: 4, kind: 'refund', amount: '259.0000', date: '2026-08-07',
    merchant: '淘宝', category_l1: 'clothing', category_l2: null,
    flags: ['refund_candidate'], matched_transaction_id: 'tx-origin',
  });
  seed([refund]);
  mockGet(`${TX_PATH}/tx-origin`, ORIGIN);
  mockGet(TX_PATH, { items: [ORIGIN], total: 1, summary: null });
  let answer: ImportRow = { ...refund, matched_transaction_id: null };
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-4`)).reply(() => [200, answer]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  const origin = await screen.findByTestId('review-4-link-origin');
  expect(String(origin.props.children)).toContain('淘宝');
  // The band under the row is the carrier: the box is checked because the server prefilled
  // `matched_transaction_id` (屏幕稿 03's 「关联原单」 strip).
  expect(screen.getByTestId('review-4-link-pair').props.accessibilityState.checked).toBe(true);

  // Unchecking it means this row will not write `refund_of` on commit (decision §14.7).
  fireEvent.press(screen.getByTestId('review-4-link-pair'));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toEqual({ matched_transaction_id: null });
  await waitFor(() => expect(screen.queryByTestId('review-4-link-origin')).toBeNull());

  // Re-picking goes through the same list endpoint, fixed to expenses (decision §1.1).
  answer = { ...refund, matched_transaction_id: 'tx-origin' };
  fireEvent.press(screen.getByTestId('review-4-link-pick'));
  await waitFor(() => {
    const listed = api.mock.history.get.filter((r) => r.url === TX_PATH);
    expect(listed[listed.length - 1].params.kind).toEqual(['expense']);
  });
  fireEvent.press(await screen.findByTestId('review-4-link-picker-row-tx-origin'));
  await waitFor(() => expect(patchBodies()).toHaveLength(2));
  expect(patchBodies()[1]).toEqual({ matched_transaction_id: 'tx-origin' });
});

// ------------------------------------------------- the leg that was taken (04 §4.11.3)

test('a transfer whose opposite leg is already paired says so in the cell', async () => {
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000', transfer_role: 'out', date: '2026-08-05',
    // The server found the other side, saw it was already half of a transfer, and flagged
    // the row instead of pairing it.
    flags: ['duplicate'], matched_transaction_id: null,
    hint: '对方那笔已经配过对了',
  });
  seed([transfer]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  const line = await screen.findByTestId('review-3-link-already-paired');
  expect(String(line.props.children)).toContain('配过对');
  // The counterparty controls are still there — this row can name its other side by hand.
  expect(screen.getByTestId('review-3-link-counterpart-trigger')).toBeTruthy();
});
