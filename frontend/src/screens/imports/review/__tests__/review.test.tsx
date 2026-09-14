/**
 * The review table (04 §4.11, §8.4 cases 1–5, 8, 10, 11, 13, 14).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import type { ImportRow } from '@/api/types';
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
  makeImportCommitResult,
  makeImportRow,
  makeLedger,
  makeSource,
  makeTestHandlers,
  makeTestQueryClient,
  makeUser,
  mockApi,
  mockGet,
  mockPatch,
  type MockApi,
  type TestQueryHandlers,
} from '@/test';

import ImportBatchScreen from '../../ImportBatchScreen';

let queryClient: QueryClient;
let handlers: TestQueryHandlers;
let api: MockApi;

const LEDGER = makeLedger({ base_currency: 'CNY' });
const SOURCE = makeSource({ id: SOURCE_ID, name: '招行信用卡', default_currency: 'CNY' });
const OTHER_SOURCE = makeSource({ id: 'src-other', name: '招行储蓄卡' });
const BATCH_PATH = `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}`;
const ROWS_PATH = `${BATCH_PATH}/rows`;
const REVIEW_URL = `/l/${LEDGER_ID}/imports/${BATCH_ID}`;

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
  'l/[ledgerId]/imports/index': () => <RNText>history</RNText>,
  'l/[ledgerId]/imports/new': () => <RNText>upload</RNText>,
  'l/[ledgerId]/imports/[batchId]': ImportBatchScreen,
  'l/[ledgerId]/transactions/index': () => <RNText>transactions</RNText>,
};

/** Describe the server, then mount the review route. */
function seed(rows: ImportRow[], batchOver: Parameters<typeof makeImportBatch>[0] = {}): void {
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', makeCurrencyList());
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [SOURCE, OTHER_SOURCE], total: 2 });
  mockGet(
    BATCH_PATH,
    makeImportBatch({ status: 'ready', row_count: rows.length, ...batchOver }),
  );
  mockGet(ROWS_PATH, { items: rows, total: rows.length });
}

function renderReview(): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });
}

const patchBodies = (): unknown[] =>
  api.mock.history.patch.map((r) => JSON.parse(String(r.data ?? '{}')));

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  handlers = makeTestHandlers();
  queryClient = makeTestQueryClient(handlers);
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

// ----------------------------------------------------------------- cases 1 & 2

test('uncategorized rows block the commit; skipping or filling one unblocks it, and a transfer row never counts', async () => {
  const uncategorized1 = row({
    id: 'row-1', row_no: 1, category_l1: null, category_l2: null, merchant: '星巴克',
  });
  const uncategorized2 = row({
    id: 'row-2', row_no: 2, category_l1: null, category_l2: null, merchant: '京东',
  });
  // A transfer has no category by definition — it must not be counted (§8.4 case 2).
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000', transfer_role: 'in',
  });
  seed([uncategorized1, uncategorized2, transfer]);
  renderReview();

  // Two, not three: the transfer row is not uncategorized.
  const block = await screen.findByTestId('review-commit-block');
  expect(block.props.children).toContain('2');
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBe(true);

  // Skipping one takes it out of the count.
  mockPatch(`${ROWS_PATH}/row-1`, { ...uncategorized1, status: 'skipped' });
  fireEvent.press(screen.getByTestId('review-1-skip'));
  await waitFor(() =>
    expect(screen.getByTestId('review-commit-block').props.children).toContain('1'),
  );

  // Filling the last one in clears the blocker and enables the button.
  mockPatch(`${ROWS_PATH}/row-2`, { ...uncategorized2, category_l1: 'food', status: 'edited' });
  fireEvent.press(screen.getByTestId('review-2-l1-trigger'));
  fireEvent.press(await screen.findByTestId('review-2-l1-l1-food'));
  await waitFor(() => expect(screen.queryByTestId('review-commit-block')).toBeNull());
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBeFalsy();
});

test('a transfer row has no merchant cell and no category cell, and neither accepts input', async () => {
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000',
  });
  seed([transfer]);
  renderReview();

  // Both cells render the em dash, and pressing the merchant cell opens no editor.
  expect((await screen.findByTestId('review-3-merchant')).props.children).toBe('—');
  expect(screen.getByTestId('review-3-l1').props.children).toBe('—');
  fireEvent.press(screen.getByTestId('review-table-cell-row-3-merchant'));
  expect(screen.queryByTestId('review-3-merchant-input')).toBeNull();
});

// ---------------------------------------------------------------------- case 3

test('changing kind rewrites the sign, clears the category and wakes the link cell up', async () => {
  const income = row({
    id: 'row-2', row_no: 2, kind: 'income', amount: '3000.0000',
    category_l1: 'salary', category_l2: null, merchant: '公司',
  });
  seed([income]);
  renderReview();

  // One handler, one mutable answer: axios-mock-adapter keeps the first matching handler,
  // so a second `mockPatch` on the same URL would never be reached.
  let answer: ImportRow = { ...income, kind: 'expense', amount: '-3000.0000' };
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-2`)).reply(() => [200, answer]);
  fireEvent.press(await screen.findByTestId('review-2-kind-trigger'));
  fireEvent.press(await screen.findByTestId('review-2-kind-option-expense'));

  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  // The sign follows the kind (04 §4.11.2); the category is not touched by an expense.
  expect(patchBodies()[0]).toEqual({ kind: 'expense', amount: '-3000.0000' });

  // …and moving to a transfer clears the category and turns the link cell on.
  answer = {
    ...income, kind: 'transfer', amount: '-3000.0000', category_l1: null, category_l2: null,
    merchant: null,
  };
  fireEvent.press(screen.getByTestId('review-2-kind-trigger'));
  fireEvent.press(await screen.findByTestId('review-2-kind-option-transfer'));
  await waitFor(() => expect(patchBodies()).toHaveLength(2));
  // `category_l2` was already null, so it is not in the body — only what changed is sent.
  expect(patchBodies()[1]).toEqual({ kind: 'transfer', category_l1: null });
  expect(await screen.findByTestId('review-2-link-role')).toBeTruthy();
  expect(screen.getByTestId('review-2-l1').props.children).toBe('—');
});

// ------------------------------------------------------------------ cases 4 & 5

test('a text cell sends exactly one PATCH carrying only that field, 500ms after the last keystroke', async () => {
  const expense = row({ id: 'row-1', row_no: 1, merchant: '星巴克' });
  seed([expense]);
  renderReview();

  fireEvent.press(await screen.findByTestId('review-table-cell-row-1-merchant'));
  const input = await screen.findByTestId('review-1-merchant-input');

  jest.useFakeTimers();
  try {
    mockPatch(`${ROWS_PATH}/row-1`, { ...expense, merchant: '瑞幸', status: 'edited' });
    fireEvent.changeText(input, '瑞');
    fireEvent.changeText(input, '瑞幸');
    // Nothing goes out while the user is still typing.
    expect(api.mock.history.patch).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
  } finally {
    jest.useRealTimers();
  }

  await waitFor(() => expect(api.mock.history.patch).toHaveLength(1));
  expect(api.mock.history.patch[0].url).toBe(`${ROWS_PATH}/row-1`);
  expect(patchBodies()[0]).toEqual({ merchant: '瑞幸' });
});

test('a rejected cell edit rolls the value back and offers a retry', async () => {
  const expense = row({ id: 'row-1', row_no: 1, merchant: '星巴克' });
  seed([expense]);
  renderReview();

  fireEvent.press(await screen.findByTestId('review-table-cell-row-1-merchant'));
  const input = await screen.findByTestId('review-1-merchant-input');
  mockPatch(`${ROWS_PATH}/row-1`, { detail: 'nope', code: 'validation_error' }, 400);
  fireEvent.changeText(input, '打错了');
  fireEvent(input, 'blur');

  await waitFor(() => expect(screen.getByTestId('review-1-row-no-retry')).toBeTruthy());
  // The draft is gone: the cell shows the value the server still holds.
  expect(screen.getByTestId('review-1-merchant-input').props.value).toBe('星巴克');
  expect(screen.getByTestId('review-1-row-no-save-failed')).toBeTruthy();
});

test('a window focus does not refetch the rows out from under an edit', async () => {
  const expense = row({ id: 'row-1', row_no: 1, merchant: '星巴克' });
  seed([expense]);
  renderReview();

  fireEvent.press(await screen.findByTestId('review-table-cell-row-1-merchant'));
  const input = await screen.findByTestId('review-1-merchant-input');
  fireEvent.changeText(input, '半句话');

  const rowRequests = (): number =>
    api.mock.history.get.filter((r) => r.url === ROWS_PATH).length;
  const before = rowRequests();
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(rowRequests()).toBe(before);
  expect(screen.getByTestId('review-1-merchant-input').props.value).toBe('半句话');
  focusManager.setFocused(undefined);
});

// ---------------------------------------------------------------------- case 8

test('two identical rows both stay, both flagged, with the hint naming the other one', async () => {
  const first = row({
    id: 'row-1', row_no: 1, flags: ['needs_review'], hint: '本批内有相同的行（第 9 行）',
  });
  const second = row({
    id: 'row-9', row_no: 9, flags: ['needs_review'], hint: '本批内有相同的行（第 1 行）',
  });
  seed([first, second]);
  renderReview();

  expect(await screen.findByTestId('review-table-row-row-1')).toBeTruthy();
  expect(screen.getByTestId('review-table-row-row-9')).toBeTruthy();
  expect(screen.getByTestId('review-1-flag-needs_review')).toBeTruthy();
  expect(screen.getByTestId('review-9-flag-needs_review')).toBeTruthy();
  expect(screen.getByTestId('review-1-hint').props.children).toContain('第 9 行');
  // There is no "merged" badge — decision §14.31 keeps both rows.
  expect(screen.queryByText(/已合并/)).toBeNull();
});

// --------------------------------------------------------------- cases 10 & 11

test('the four slices count correctly and switching them keeps the selection', async () => {
  const plain = row({ id: 'row-1', row_no: 1 });
  const flagged = row({ id: 'row-2', row_no: 2, flags: ['duplicate', 'needs_review'] });
  const skipped = row({ id: 'row-3', row_no: 3, status: 'skipped' });
  const uncategorized = row({ id: 'row-4', row_no: 4, category_l1: null, category_l2: null });
  seed([plain, flagged, skipped, uncategorized]);
  renderReview();

  // The first paint lands on "uncategorized" because there is one (04 §4.11.6).
  expect(await screen.findByTestId('review-table-row-row-4')).toBeTruthy();
  expect(screen.queryByTestId('review-table-row-row-1')).toBeNull();
  expect(screen.getByText('全部 4')).toBeTruthy();
  expect(screen.getByText('待归类 1')).toBeTruthy();
  expect(screen.getByText('有标记 1')).toBeTruthy();
  expect(screen.getByText('已跳过 1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('review-table-select-row-4'));
  expect(screen.getByTestId('review-bulk-count').props.children).toContain('1');

  fireEvent.press(screen.getByText('有标记 1'));
  expect(await screen.findByTestId('review-table-row-row-2')).toBeTruthy();
  expect(screen.queryByTestId('review-table-row-row-4')).toBeNull();
  // The selection is untouched by a slice change.
  expect(screen.getByTestId('review-bulk-count').props.children).toContain('1');

  fireEvent.press(screen.getByText('全部 4'));
  expect(await screen.findByTestId('review-table-row-row-1')).toBeTruthy();
  expect(screen.getByTestId('review-table-select-row-4').props.accessibilityState.checked).toBe(
    true,
  );
});

test('every badge carries a text label and an unknown flag renders nothing', async () => {
  const flagged = row({
    id: 'row-2',
    row_no: 2,
    // The fifth value is not one of the four flags (03 §5.40) and must be ignored.
    flags: ['duplicate', 'needs_review', 'made_up_flag'] as ImportRow['flags'],
  });
  seed([flagged]);
  renderReview();

  expect(await screen.findByTestId('review-2-flag-duplicate')).toBeTruthy();
  expect(screen.getByTestId('review-2-flag-needs_review')).toBeTruthy();
  expect(screen.getByText('可能重复')).toBeTruthy();
  expect(screen.getByText('需核对')).toBeTruthy();
  expect(screen.queryByTestId('review-2-flag-made_up_flag')).toBeNull();
});

// --------------------------------------------------------------------- case 13

test('commit posts once with no body and lands on the committed panel', async () => {
  const expense = row({ id: 'row-1', row_no: 1 });
  seed([expense]);
  const result = makeImportCommitResult({ created_transactions: 1, skipped_rows: 0 });
  api.mock.onPost(apiUrl(`${BATCH_PATH}/commit`)).reply(200, result);
  renderReview();

  fireEvent.press(await screen.findByTestId('review-commit-submit'));
  await waitFor(() => expect(screen.getByTestId('import-committed')).toBeTruthy());

  const posts = api.mock.history.post.filter((r) => r.url === `${BATCH_PATH}/commit`);
  expect(posts).toHaveLength(1);
  expect(posts[0].data === undefined || posts[0].data === '').toBe(true);
  // There is no submit button left to press a second time.
  expect(screen.queryByTestId('review-commit-submit')).toBeNull();
});

test('a second submit while the first is in flight is dropped, so 409 can only toast once', async () => {
  const expense = row({ id: 'row-1', row_no: 1 });
  seed([expense]);
  api.mock.onPost(apiUrl(`${BATCH_PATH}/commit`)).reply(
    () =>
      new Promise((resolve) => {
        setTimeout(
          () => resolve([409, { detail: '这批已经提交过了', code: 'batch_already_committed' }]),
          20,
        );
      }),
  );
  renderReview();

  const submit = await screen.findByTestId('review-commit-submit');
  fireEvent.press(submit);
  fireEvent.press(submit);

  await waitFor(() => expect(handlers.notify).toHaveBeenCalledTimes(1));
  expect(
    api.mock.history.post.filter((r) => r.url === `${BATCH_PATH}/commit`),
  ).toHaveLength(1);
  expect(handlers.notify.mock.calls[0][0]).toBe('error');
});

// --------------------------------------------------------------------- case 14

test('a narrow viewport renders the card flow, with kind, category and the pairing checkbox on the card', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(false);
  const expense = row({ id: 'row-1', row_no: 1 });
  const transfer = row({
    id: 'row-3', row_no: 3, kind: 'transfer', category_l1: null, category_l2: null,
    merchant: null, amount: '1000.0000', flags: ['transfer_candidate'],
    matched_transaction_id: 'tx-leg', transfer_role: 'in',
  });
  seed([expense, transfer]);
  mockGet(`/ledgers/${LEDGER_ID}/transactions/tx-leg`, {
    ...makeImportRow(), id: 'tx-leg',
  });
  renderReview();

  expect(await screen.findByTestId('review-cards')).toBeTruthy();
  expect(screen.queryByTestId('review-table')).toBeNull();
  expect(screen.getByTestId('review-1-kind-trigger')).toBeTruthy();
  expect(screen.getByTestId('review-1-l1-trigger')).toBeTruthy();
  // The prefilled pairing checkbox has to be visible (and clearable) without opening anything.
  const pair = screen.getByTestId('review-3-link-pair');
  expect(pair.props.accessibilityState.checked).toBe(true);
});
