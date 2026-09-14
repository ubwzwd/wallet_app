/**
 * The review table (04 §4.11, §8.4 cases 1–5, 8, 10, 11, 13, 14).
 */
import React from 'react';
import { ScrollView, Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import type { ImportRow } from '@/api/types';
import { initI18n } from '@/i18n';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { lightColors, space } from '@/theme/tokens';
import * as breakpoint from '@/theme/useBreakpoint';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import { DATA_TABLE_ROW_HEIGHT } from '@/ui/DataTable';
import {
  BATCH_ID,
  LEDGER_ID,
  SOURCE_ID,
  apiUrl,
  makeCategoryTree,
  makeCurrencyList,
  makeImportBatch,
  makeImportCommitResult,
  makeImportDeleteResult,
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

  // …and moving to a transfer clears the category and turns the link cell on. The answer
  // is the row the *server* would now hold — it keeps nothing the patch did not clear.
  answer = {
    ...income, kind: 'transfer', amount: '-3000.0000', category_l1: null, category_l2: null,
    merchant: null, matched_transaction_id: null,
  };
  fireEvent.press(screen.getByTestId('review-2-kind-trigger'));
  fireEvent.press(await screen.findByTestId('review-2-kind-option-transfer'));
  await waitFor(() => expect(patchBodies()).toHaveLength(2));
  // `category_l2` was already null, so it is not in the body — only what changed is sent.
  // The two transfer fields *are*: 03 §5.41 refuses a transfer row with either one null,
  // and the row has no way to set them before it is a transfer.
  // `merchant` goes with them: 03 §5.41 and decision §14.52 B16 refuse a transfer that
  // still carries one, and this row had "公司" in that column.
  expect(patchBodies()[1]).toEqual({
    kind: 'transfer',
    category_l1: null,
    merchant: null,
    transfer_role: 'out',
    transfer_subtype: 'plain',
  });
  expect(await screen.findByTestId('review-2-link-role')).toBeTruthy();
  expect(screen.getByTestId('review-2-l1').props.children).toBe('—');
});

test('a refund turned into a transfer drops the link it had to the original expense', async () => {
  const refund = row({
    id: 'row-4', row_no: 4, kind: 'refund', amount: '50.0000', merchant: '京东',
    category_l1: 'shopping', category_l2: null, flags: ['refund_candidate'],
    matched_transaction_id: 'tx-origin',
  });
  seed([refund]);
  mockGet(`/ledgers/${LEDGER_ID}/transactions/tx-origin`, {
    ...makeImportRow(), id: 'tx-origin',
  });
  renderReview();

  // It starts out linked: the origin is named in the cell.
  expect(await screen.findByTestId('review-4-link-origin')).toBeTruthy();

  mockPatch(`${ROWS_PATH}/row-4`, {
    ...refund, kind: 'transfer', amount: '-50.0000', merchant: null, category_l1: null,
    matched_transaction_id: null, transfer_role: 'out', transfer_subtype: 'plain',
  });
  fireEvent.press(screen.getByTestId('review-4-kind-trigger'));
  fireEvent.press(await screen.findByTestId('review-4-kind-option-transfer'));

  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  // The link cannot survive the kind: kept, it would be drawn as a confirmed pairing with
  // that expense as the opposite leg, and the commit would answer 400 `pair_invalid` —
  // whose detail names no row, so nothing could jump to it either.
  expect(patchBodies()[0]).toMatchObject({
    kind: 'transfer',
    matched_transaction_id: null,
    merchant: null,
    category_l1: null,
  });
  // …and the cell is not showing a checked "pair these two" box.
  await waitFor(() => expect(screen.queryByTestId('review-4-link-origin')).toBeNull());
  expect(screen.queryByTestId('review-4-link-pair')).toBeNull();
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
  // One mutable handler: axios-mock-adapter keeps the first match for a URL, so the retry
  // below has to reuse this one rather than register a second.
  let fail = true;
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-1`)).reply(() =>
    fail
      ? [400, { detail: 'nope', code: 'validation_error' }]
      : [200, { ...expense, merchant: '打错了', status: 'edited' }],
  );
  fireEvent.changeText(input, '打错了');
  fireEvent(input, 'blur');

  await waitFor(() => expect(screen.getByTestId('review-1-row-no-retry')).toBeTruthy());
  // The draft is gone: the cell shows the value the server still holds.
  expect(screen.getByTestId('review-1-merchant-input').props.value).toBe('星巴克');
  expect(screen.getByTestId('review-1-row-no-save-failed')).toBeTruthy();
  // …and the failure is marked in the cell the user was typing in, not only ten columns
  // away beside the row number (04 §4.11.5).
  expect(screen.getByTestId('review-1-merchant-error')).toBeTruthy();
  const cellRetry = screen.getByTestId('review-1-merchant-retry');

  // Retrying from inside the cell resends the same edit and clears the marker.
  fail = false;
  fireEvent.press(cellRetry);
  await waitFor(() => expect(screen.queryByTestId('review-1-merchant-error')).toBeNull());
  expect(patchBodies()[1]).toEqual({ merchant: '打错了' });
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
  // 04 §4.11.9: the phone opens on "uncategorized" whatever the counts say, and says why.
  expect(screen.getByTestId('review-mobile-filter-hint')).toBeTruthy();
  expect(screen.getByTestId('review-cards-empty')).toBeTruthy();

  // The slices are the same ones the wide grid has; "all" brings the batch back.
  fireEvent.press(screen.getByText('全部 2'));
  expect(await screen.findByTestId('review-1-kind-trigger')).toBeTruthy();
  expect(screen.getByTestId('review-1-l1-trigger')).toBeTruthy();
  // The prefilled pairing checkbox has to be visible (and clearable) without opening anything.
  const pair = screen.getByTestId('review-3-link-pair');
  expect(pair.props.accessibilityState.checked).toBe(true);
});

// ------------------------------------------------- the batch is not one page (03 §5.40)

test('a batch bigger than the first page fetches the rest, and holds the commit until it has', async () => {
  const all = Array.from({ length: 128 }, (_, i) =>
    row({ id: `row-${i + 1}`, row_no: i + 1 }),
  );
  seed(all);
  // Registered after `seed`, which replaces the handler it installed for this URL: this
  // one pages the way the server does (03 §5.40) and holds the follow-up page back.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  api.mock.onGet(apiUrl(ROWS_PATH)).reply(async (config) => {
    const params = (config.params ?? {}) as { offset?: number; limit?: number };
    const offset = Number(params.offset ?? 0);
    // The server's own default — the parameterless first request gets 100 rows.
    const limit = Number(params.limit ?? 100);
    if (offset > 0) await gate;
    return [200, { items: all.slice(offset, offset + limit), total: all.length }];
  });
  renderReview();

  // The first page paints, but 28 rows are still missing, so the commit is held back:
  // every blocker is counted over the rows at hand (04 §4.11.8).
  expect(await screen.findByTestId('review-table-row-row-100')).toBeTruthy();
  expect(screen.queryByTestId('review-table-row-row-128')).toBeNull();
  expect(screen.getByTestId('review-commit-block-loading')).toBeTruthy();
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBe(true);
  // The header counts the batch, not the page.
  expect(String(screen.getByTestId('import-batch-summary').props.children)).toContain('128');

  await act(async () => {
    release();
    await Promise.resolve();
  });

  // The follow-up page asked for the rest, and every row is now editable.
  await waitFor(() => expect(screen.getByTestId('review-table-row-row-128')).toBeTruthy());
  const offsets = api.mock.history.get
    .filter((r) => r.url === ROWS_PATH)
    .map((r) => Number((r.params as { offset?: number } | undefined)?.offset ?? 0));
  expect(offsets).toContain(100);
  await waitFor(() => expect(screen.queryByTestId('review-commit-block-loading')).toBeNull());
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBeFalsy();
});

// ----------------------------------------------------- failures are per cell, not per row

test('a cell that failed to save keeps its dot when the cell next to it saves fine', async () => {
  const expense = row({ id: 'row-1', row_no: 1, merchant: '星巴克', note: null });
  seed([expense]);
  // The merchant is refused; anything else is accepted.
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-1`)).reply((config) => {
    const body = JSON.parse(String(config.data ?? '{}')) as Record<string, unknown>;
    if ('merchant' in body) return [400, { detail: 'nope', code: 'validation_error' }];
    return [200, { ...expense, ...body, status: 'edited' }];
  });
  renderReview();

  fireEvent.press(await screen.findByTestId('review-table-cell-row-1-merchant'));
  const merchant = await screen.findByTestId('review-1-merchant-input');
  fireEvent.changeText(merchant, '打错了');
  fireEvent(merchant, 'blur');
  await waitFor(() => expect(screen.getByTestId('review-1-row-no-save-failed')).toBeTruthy());

  fireEvent.press(screen.getByTestId('review-table-cell-row-1-note'));
  const note = await screen.findByTestId('review-1-note-input');
  fireEvent.changeText(note, '记一下');
  fireEvent(note, 'blur');
  await waitFor(() => expect(patchBodies()).toHaveLength(2));
  expect(patchBodies()[1]).toEqual({ note: '记一下' });

  // The successful note did not bury the merchant that never landed.
  expect(screen.getByTestId('review-1-row-no-save-failed')).toBeTruthy();
  expect(screen.getByTestId('review-1-row-no-retry')).toBeTruthy();
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBe(true);
  expect(String(screen.getByTestId('review-commit-block-failed').props.children)).toContain('1');
});

// ---------------------------------------------------- the first slice is chosen only once

test('the uncategorized slice is picked on the first paint and then left alone', async () => {
  const first = row({ id: 'row-1', row_no: 1, category_l1: null, category_l2: null });
  const second = row({ id: 'row-2', row_no: 2, category_l1: null, category_l2: null });
  seed([first, second]);
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-1`)).reply(() => [
    200,
    { ...first, category_l1: 'food', status: 'edited' },
  ]);
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-2`)).reply(() => [
    200,
    { ...second, category_l1: 'food', status: 'edited' },
  ]);
  renderReview();

  expect(await screen.findByTestId('review-table-row-row-1')).toBeTruthy();
  fireEvent.press(screen.getByTestId('review-1-l1-trigger'));
  fireEvent.press(await screen.findByTestId('review-1-l1-l1-food'));

  // Row 1 leaves the slice; the slice itself does not move.
  await waitFor(() => expect(screen.queryByTestId('review-table-row-row-1')).toBeNull());
  expect(screen.getByTestId('review-table-row-row-2')).toBeTruthy();

  fireEvent.press(screen.getByTestId('review-2-l1-trigger'));
  fireEvent.press(await screen.findByTestId('review-2-l1-l1-food'));

  // …not even when the last one is done: the list empties, it does not jump back to "all".
  await waitFor(() => expect(screen.queryByTestId('review-table-row-row-2')).toBeNull());
  expect(screen.queryByTestId('review-table-row-row-1')).toBeNull();
  expect(screen.getByTestId('review-table-empty')).toBeTruthy();
});

// --------------------------------------------- the server's other commit refusals (§5.43)

test('a batch with every row skipped cannot be submitted', async () => {
  seed([
    row({ id: 'row-1', row_no: 1, status: 'skipped' }),
    row({ id: 'row-2', row_no: 2, status: 'skipped' }),
  ]);
  renderReview();

  const submit = await screen.findByTestId('review-commit-submit');
  expect(screen.getByTestId('review-commit-block-all-skipped')).toBeTruthy();
  expect(submit.props.accessibilityState.disabled).toBe(true);
  fireEvent.press(submit);
  expect(api.mock.history.post.filter((r) => r.url === `${BATCH_PATH}/commit`)).toHaveLength(0);
});

test('a row with a zero amount or no currency blocks the commit', async () => {
  seed([
    row({ id: 'row-1', row_no: 1, amount: '0.0000' }),
    row({ id: 'row-2', row_no: 2, currency: null }),
  ]);
  renderReview();

  expect(String((await screen.findByTestId('review-commit-block-incomplete')).props.children))
    .toContain('2');
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBe(true);
});

// ------------------------------------------------ the phone is not a dead end (§4.11.9)

test('a failed edit on the phone shows the dot and the retry button on the card', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(false);
  const expense = row({ id: 'row-1', row_no: 1, merchant: '星巴克' });
  seed([expense]);
  let fail = true;
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-1`)).reply(() =>
    fail
      ? [400, { detail: 'nope', code: 'validation_error' }]
      : [200, { ...expense, merchant: '瑞幸', status: 'edited' }],
  );
  renderReview();

  // The phone lands on "uncategorized" (04 §4.11.9); this row is categorized.
  fireEvent.press(await screen.findByText('全部 1'));
  fireEvent.press(await screen.findByTestId('review-cards-details-1'));
  const input = await screen.findByTestId('review-detail-merchant-input');
  fireEvent.changeText(input, '瑞幸');
  fireEvent(input, 'blur');

  // The card carries the same save-state cell as the wide grid.
  await waitFor(() => expect(screen.getByTestId('review-1-row-no-retry')).toBeTruthy());
  expect(screen.getByTestId('review-1-row-no-save-failed')).toBeTruthy();
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBe(true);
  expect(String(screen.getByTestId('review-commit-block-failed').props.children)).toContain('1');

  // Retrying resends exactly the same body, and the batch can be submitted again.
  fail = false;
  fireEvent.press(screen.getByTestId('review-1-row-no-retry'));
  await waitFor(() => expect(patchBodies()).toHaveLength(2));
  expect(patchBodies()[1]).toEqual({ merchant: '瑞幸' });
  await waitFor(() =>
    expect(screen.queryByTestId('review-commit-block-failed')).toBeNull(),
  );
  expect(screen.getByTestId('review-commit-submit').props.accessibilityState.disabled).toBeFalsy();
});

// ------------------------------------ the commit refusal names its rows in the body (§5.43)

test('a commit refused for one row jumps to it even when the slice on screen hides it', async () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) =>
    row({ id: `row-${n}`, row_no: n, flags: n === 1 ? ['needs_review'] : [] }),
  );
  seed(rows);
  // 03 §5.43 / 05 §4.3: the row numbers are an extension field of the error body; `detail`
  // itself carries no number at all, so nothing else could point at row 7.
  api.mock.onPost(apiUrl(`${BATCH_PATH}/commit`)).reply(400, {
    detail: '这一行的转账配对不合法',
    code: 'pair_invalid',
    rows: [7],
  });
  renderReview();

  // The user is looking at the flagged rows: row 7 is not rendered at all.
  fireEvent.press(await screen.findByText('有标记 1'));
  expect(await screen.findByTestId('review-table-row-row-1')).toBeTruthy();
  expect(screen.queryByTestId('review-table-row-row-7')).toBeNull();

  fireEvent.press(screen.getByTestId('review-commit-submit'));

  // The slice widens to the whole batch and row 7 is the one painted as the problem.
  const seven = await screen.findByTestId('review-table-row-row-7');
  await waitFor(() =>
    expect(seven.props.style.backgroundColor).toBe(lightColors['status.warning.bg']),
  );
  expect(screen.getByTestId('review-table-row-row-1').props.style.backgroundColor).not.toBe(
    lightColors['status.warning.bg'],
  );
});

test('the same refusal on a phone widens the slice and scrolls the card into view', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(false);
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row({ id: `row-${n}`, row_no: n }));
  seed(rows);
  api.mock.onPost(apiUrl(`${BATCH_PATH}/commit`)).reply(400, {
    detail: '这一行的转账配对不合法',
    code: 'pair_invalid',
    rows: [7],
  });
  renderReview();

  // The phone opens on "uncategorized" whatever the counts say (04 §4.11.9), and every row
  // here is categorized — so the card of row 7 is not even mounted.
  expect(await screen.findByTestId('review-cards-empty')).toBeTruthy();

  fireEvent.press(screen.getByTestId('review-commit-submit'));

  const card = await screen.findByTestId('review-cards-row-7');
  // Layout is never measured in a test renderer, so tell the list where the card landed —
  // in the order a real device reports it: the card mounts (widened slice), *then* lays out.
  // The very first jump has to scroll, which is the only order that ever happens in practice.
  fireEvent(card, 'layout', { nativeEvent: { layout: { x: 0, y: 900, width: 320, height: 96 } } });
  // A card flow that cannot scroll is a dead end on the one device where row 7 is furthest
  // from the submit button (04 §4.11.8).
  await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  expect(scrollTo.mock.calls.some((call) => (call[0] as { y: number }).y === 900 - space['2'])).toBe(
    true,
  );

  // And once the card's position is known, pressing submit again scrolls again: the
  // highlight's sequence number, not the row number, is what the effect reacts to.
  scrollTo.mockClear();
  fireEvent.press(screen.getByTestId('review-commit-submit'));
  await waitFor(() =>
    expect(
      scrollTo.mock.calls.some((call) => (call[0] as { y: number }).y === 900 - space['2']),
    ).toBe(true),
  );
});

test('pressing submit twice on the wide grid scrolls to the refused row both times', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row({ id: `row-${n}`, row_no: n }));
  seed(rows);
  api.mock.onPost(apiUrl(`${BATCH_PATH}/commit`)).reply(400, {
    detail: '这一行的转账配对不合法',
    code: 'pair_invalid',
    rows: [7],
  });
  renderReview();

  // Row 7 is the seventh row of the full slice, and the grid keeps one row of headroom
  // above the target (`DataTable`).
  const targetY = 6 * DATA_TABLE_ROW_HEIGHT - DATA_TABLE_ROW_HEIGHT;
  const jumped = (): boolean =>
    scrollTo.mock.calls.some((call) => (call[0] as { y: number }).y === targetY);

  fireEvent.press(await screen.findByTestId('review-commit-submit'));
  await waitFor(() => expect(jumped()).toBe(true));

  // The same row again is a *new* request: the highlight's sequence number is in the
  // scroll effect's dependencies precisely so that a repeated jump still moves the grid.
  scrollTo.mockClear();
  fireEvent.press(screen.getByTestId('review-commit-submit'));
  await waitFor(() => expect(jumped()).toBe(true));
});

// ------------------------------- the committed panel undoes through the shared flow (§14.22)

test('undoing from the committed panel dry-runs, double-taps and leaves for the history', async () => {
  seed([row({ id: 'row-1', row_no: 1 })]);
  api.mock
    .onPost(apiUrl(`${BATCH_PATH}/commit`))
    .reply(200, makeImportCommitResult({ created_transactions: 1, skipped_rows: 0 }));
  api.mock
    .onDelete(apiUrl(BATCH_PATH))
    .replyOnce(
      200,
      makeImportDeleteResult({ deleted: false, would_delete_transactions: 1 }),
    )
    .onDelete(apiUrl(BATCH_PATH))
    .replyOnce(200, makeImportDeleteResult({ deleted: true, deleted_transactions: 1 }));
  const router = renderReview();

  fireEvent.press(await screen.findByTestId('review-commit-submit'));
  expect(await screen.findByTestId('import-committed')).toBeTruthy();

  fireEvent.press(screen.getByTestId('import-committed-undo'));
  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  // Same shared flow as the history list: ask with `dry_run` first, change nothing yet.
  expect(api.mock.history.delete).toHaveLength(1);
  expect(api.mock.history.delete[0].params).toEqual({ dry_run: true });

  // `doubleTap`: the first press only arms the button.
  fireEvent.press(screen.getByTestId('confirm-accept'));
  expect(api.mock.history.delete).toHaveLength(1);
  fireEvent.press(screen.getByTestId('confirm-accept'));

  await waitFor(() => expect(api.mock.history.delete).toHaveLength(2));
  expect(api.mock.history.delete[1].params).toBeUndefined();
  // This screen's own URL 404s once the batch is gone, so it leaves for the list (§14.22).
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports`));
});
