/**
 * Bulk operations and keyboard navigation (04 §4.11.6, §4.11.7; §8.4 cases 9 and 12;
 * decisions §14.52 A4 / A19).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import type { ImportRow } from '@/api/types';
import { initI18n } from '@/i18n';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { lightColors } from '@/theme/tokens';
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
  makeLedgerSource,
  makeTestQueryClient,
  makeUser,
  mockApi,
  mockGet,
  type MockApi,
} from '@/test';

import ImportBatchScreen from '../../ImportBatchScreen';

let queryClient: QueryClient;
let api: MockApi;
/** What `GET .../rows` answers right now; a bulk edit swaps it before the refetch. */
let serverRows: ImportRow[] = [];

const LEDGER = makeLedger({ base_currency: 'CNY' });
const SOURCE = makeLedgerSource({ id: SOURCE_ID, name: '招行信用卡', default_currency: 'CNY' });
const BATCH_PATH = `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}`;
const ROWS_PATH = `${BATCH_PATH}/rows`;
const REVIEW_URL = `/imports/${BATCH_ID}`;

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
  'imports/[batchId]': ImportBatchScreen,
};

function seed(rows: ImportRow[], tree = makeCategoryTree()): void {
  serverRows = rows;
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet('/categories', tree);
  mockGet('/rates/currencies', makeCurrencyList());
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [SOURCE], total: 1 });
  mockGet(BATCH_PATH, makeImportBatch({ status: 'ready', row_count: rows.length }));
  api.mock
    .onGet(apiUrl(ROWS_PATH))
    .reply(() => [200, { items: serverRows, total: serverRows.length }]);
}

const bulkCalls = (): Array<{ row_ids: string[]; patch: Record<string, unknown> }> =>
  api.mock.history.patch
    .filter((r) => r.url === ROWS_PATH)
    .map((r) => JSON.parse(String(r.data ?? '{}')));

/** A `document` stand-in: the shortcut hook only ever touches add/removeEventListener. */
function stubDocument(): { press(event: Record<string, unknown>): void; restore(): void } {
  const registered = new Set<(event: unknown) => void>();
  const host = globalThis as unknown as { document?: unknown };
  const previous = host.document;
  const had = 'document' in host;
  host.document = {
    addEventListener: (_type: string, fn: (event: unknown) => void) => registered.add(fn),
    removeEventListener: (_type: string, fn: (event: unknown) => void) => registered.delete(fn),
  };
  return {
    // Wrapped in `act`, because a shortcut sets state exactly like a press does.
    press: (event) =>
      act(() => {
        registered.forEach((fn) =>
          fn({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null,
               preventDefault: () => {}, ...event }),
        );
      }),
    restore: () => {
      if (had) host.document = previous;
      else delete host.document;
    },
  };
}

/** The focus ring colour of a cell, whatever shape its style prop arrived in. */
function borderColorOf(testID: string): unknown {
  const style = screen.getByTestId(testID).props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  return flat?.borderColor;
}

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

// ---------------------------------------------------------------------- case 9

test('setting a category on a selection is one request, and the answer lands in the table', async () => {
  const rows = [1, 2, 3].map((n) =>
    row({ id: `row-${n}`, row_no: n, category_l1: null, category_l2: null }),
  );
  seed(rows);
  const updated = rows.map((r) => ({ ...r, category_l1: 'food', category_l2: 'lunch' }));
  api.mock.onPatch(apiUrl(ROWS_PATH)).reply(() => {
    serverRows = updated;
    return [200, { updated: updated.length, rows: updated }];
  });
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  for (const n of [1, 2, 3]) {
    fireEvent.press(await screen.findByTestId(`review-table-select-row-${n}`));
  }
  fireEvent.press(screen.getByTestId('review-bulk-category'));
  fireEvent.press(await screen.findByTestId('review-bulk-category-l1-food'));
  fireEvent.press(await screen.findByTestId('review-bulk-category-l2-lunch'));

  await waitFor(() => expect(bulkCalls()).toHaveLength(1));
  // One request for the whole selection — not one per row (decision §14.52 A4).
  expect(api.mock.history.patch).toHaveLength(1);
  expect(bulkCalls()[0].row_ids).toEqual(['row-1', 'row-2', 'row-3']);
  expect(bulkCalls()[0].patch).toEqual({ category_l1: 'food', category_l2: 'lunch' });
  // The rows come back categorized, so the blocker is gone.
  await waitFor(() => expect(screen.queryByTestId('review-commit-block')).toBeNull());
});

test('a refused bulk edit changes nothing, names the row and highlights it', async () => {
  const rows = [
    row({ id: 'row-1', row_no: 1, category_l1: null, category_l2: null }),
    row({ id: 'row-12', row_no: 12, category_l1: null, category_l2: null }),
  ];
  seed(rows);
  api.mock
    .onPatch(apiUrl(ROWS_PATH))
    .reply(400, { detail: '第 12 行是收入行', code: 'category_kind_mismatch' });
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-12'));
  fireEvent.press(screen.getByTestId('review-bulk-category'));
  fireEvent.press(await screen.findByTestId('review-bulk-category-l1-food'));
  fireEvent.press(await screen.findByTestId('review-bulk-category-l2-lunch'));

  const error = await screen.findByTestId('review-bulk-error');
  expect(String(error.props.children)).toContain('12');
  // Nothing was applied: no row-level PATCH, and both rows are still uncategorized.
  expect(api.mock.history.patch.filter((r) => r.url !== ROWS_PATH)).toHaveLength(0);
  expect(screen.getByTestId('review-commit-block').props.children).toContain('2');
  expect(screen.getByTestId('review-1-l1-trigger')).toBeTruthy();
});

test('a selection that mixes category trees cannot even open the picker', async () => {
  seed([
    row({ id: 'row-1', row_no: 1, kind: 'expense' }),
    row({ id: 'row-2', row_no: 2, kind: 'income', category_l1: 'salary', category_l2: null }),
  ]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  expect(screen.getByTestId('review-bulk-category').props.accessibilityState.disabled).toBeFalsy();
  // Adding an income row leaves no category both rows could take (03 §5.42).
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  expect(screen.getByTestId('review-bulk-category').props.accessibilityState.disabled).toBe(true);
});

test('bulk skip is one request and takes the rows out of the submit count', async () => {
  const rows = [1, 2].map((n) => row({ id: `row-${n}`, row_no: n }));
  seed(rows);
  const updated = rows.map((r) => ({ ...r, status: 'skipped' as const }));
  api.mock.onPatch(apiUrl(ROWS_PATH)).reply(() => {
    serverRows = updated;
    return [200, { updated: updated.length, rows: updated }];
  });
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  expect((await screen.findByTestId('review-commit-submit')).props.accessibilityLabel).toContain(
    '2',
  );
  fireEvent.press(screen.getByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  fireEvent.press(screen.getByTestId('review-bulk-skip'));

  await waitFor(() => expect(bulkCalls()).toHaveLength(1));
  expect(bulkCalls()[0].patch).toEqual({ status: 'skipped' });
  await waitFor(() =>
    expect(screen.getByTestId('review-commit-submit').props.accessibilityLabel).toContain('0'),
  );
});

// --------------------------------------------------------------------- case 12

test('the keyboard moves, edits, cancels, skips, jumps and refuses to commit while blocked', async () => {
  const doc = stubDocument();
  const rows = [
    row({ id: 'row-1', row_no: 1 }),
    row({ id: 'row-2', row_no: 2, merchant: '京东' }),
    row({ id: 'row-3', row_no: 3, category_l1: null, category_l2: null }),
  ];
  seed(rows);
  api.mock.onPatch(apiUrl(`${ROWS_PATH}/row-2`)).reply(() => [
    200,
    { ...rows[1], status: 'skipped' },
  ]);
  api.mock.onPost(apiUrl(`${BATCH_PATH}/commit`)).reply(200, {});
  try {
    renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });
    // Row 3 has no category, so the table opens on the "uncategorized" slice; switch to
    // "all" to navigate the whole batch.
    fireEvent.press(await screen.findByText('全部 3'));
    expect(await screen.findByTestId('review-table-row-row-1')).toBeTruthy();

    // ↓ then → five times lands on row 2's merchant cell.
    doc.press({ key: 'ArrowDown' });
    for (let i = 0; i < 5; i += 1) doc.press({ key: 'ArrowRight' });
    await waitFor(() =>
      expect(borderColorOf('review-table-cell-row-2-merchant')).toBe(lightColors['border.focus']),
    );

    // Enter opens the editor, Esc puts the original value back.
    doc.press({ key: 'Enter' });
    const input = await screen.findByTestId('review-2-merchant-input');
    fireEvent.changeText(input, '半句话');
    doc.press({ key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('review-2-merchant-input')).toBeNull());
    expect(screen.getByTestId('review-2-merchant').props.children).toBe('京东');

    // `S` skips the focused row.
    doc.press({ key: 's' });
    await waitFor(() => expect(api.mock.history.patch).toHaveLength(1));
    expect(JSON.parse(String(api.mock.history.patch[0].data))).toEqual({ status: 'skipped' });

    // `]` jumps to the next uncategorized row (row 3).
    doc.press({ key: ']' });
    await waitFor(() =>
      expect(borderColorOf('review-table-cell-row-3-merchant')).toBe(lightColors['border.focus']),
    );

    // `C` opens that row's category picker with every level-1 category listed — there is no
    // search box to type into (decision §14.57).
    doc.press({ key: 'c' });
    expect(await screen.findByTestId('review-3-l1-l1-food')).toBeTruthy();
    expect(screen.getByTestId('review-3-l1-l1-transport')).toBeTruthy();
    expect(screen.queryByTestId('review-3-l1-search')).toBeNull();

    // ⌘+Enter is inert while a row is still uncategorized (04 §4.11.8).
    doc.press({ key: 'Enter', metaKey: true });
    await waitFor(() => expect(screen.getByTestId('review-commit-block')).toBeTruthy());
    expect(api.mock.history.post.filter((r) => r.url === `${BATCH_PATH}/commit`)).toHaveLength(0);
  } finally {
    doc.restore();
  }
});

// ------------------------------------------- the kind a bulk edit has to spell out in full

test('setting the kind to transfer in bulk carries the transfer fields and drops the category', async () => {
  const rows = [1, 2].map((n) =>
    row({ id: `row-${n}`, row_no: n, category_l1: 'food', category_l2: 'lunch' }),
  );
  seed(rows);
  const updated = rows.map((r) => ({
    ...r,
    kind: 'transfer' as const,
    merchant: null,
    category_l1: null,
    category_l2: null,
    transfer_role: 'out' as const,
    transfer_subtype: 'plain' as const,
  }));
  api.mock.onPatch(apiUrl(ROWS_PATH)).reply(() => {
    serverRows = updated;
    return [200, { updated: updated.length, rows: updated }];
  });
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  fireEvent.press(screen.getByTestId('review-bulk-kind-trigger'));
  fireEvent.press(await screen.findByTestId('review-bulk-kind-option-transfer'));

  await waitFor(() => expect(bulkCalls()).toHaveLength(1));
  // One patch for every selected row, so it has to be valid on its own: a transfer leg
  // needs its two fields (03 §5.41) and must shed the category it is carrying.
  expect(bulkCalls()[0].patch).toEqual({
    kind: 'transfer',
    transfer_role: 'out',
    transfer_subtype: 'plain',
    category_l1: null,
    category_l2: null,
    // A leg carries no merchant (decision §14.52 B16). The link fields are deliberately
    // absent: §14.55 keeps them out of the bulk body and the server clears them itself.
    merchant: null,
  });
  // …and a bulk edit is never applied row by row (decision §14.52 A4).
  expect(api.mock.history.patch.filter((r) => r.url !== ROWS_PATH)).toHaveLength(0);
});

// ------------------------------------------------------ Shift-click selects a range (§4.11.2)

test('Shift-clicking a row checkbox selects everything between it and the last one clicked', async () => {
  const rows = [1, 2, 3, 4, 5].map((n) => row({ id: `row-${n}`, row_no: n }));
  seed(rows);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-5'), {
    nativeEvent: { shiftKey: true },
  });

  expect(String(screen.getByTestId('review-bulk-count').props.children)).toContain('5');
  for (const n of [1, 2, 3, 4, 5]) {
    expect(
      screen.getByTestId(`review-table-select-row-${n}`).props.accessibilityState.checked,
    ).toBe(true);
  }
});

// ------------------------------- "set kind" in bulk: the impossible options, and the wording

test("a bulk kind is only offered where the selection's signs allow it", async () => {
  seed([
    row({ id: 'row-1', row_no: 1, kind: 'expense', amount: '-128.5000' }),
    row({
      id: 'row-2', row_no: 2, kind: 'income', amount: '3000.0000',
      category_l1: 'salary', category_l2: null,
    }),
  ]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  // Both rows at once: one patch cannot carry two signs, so no kind is possible at all.
  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  expect(screen.getByTestId('review-bulk-kind-trigger').props.accessibilityState.disabled).toBe(
    true,
  );

  // The negative row on its own: a patch carrying `kind` makes the server re-derive the
  // sign from the row's own amount (03 §5.41), so income and refund could only 400.
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  expect(
    screen.getByTestId('review-bulk-kind-trigger').props.accessibilityState.disabled,
  ).toBeFalsy();
  fireEvent.press(screen.getByTestId('review-bulk-kind-trigger'));
  expect(await screen.findByTestId('review-bulk-kind-option-expense')).toBeTruthy();
  expect(screen.getByTestId('review-bulk-kind-option-transfer')).toBeTruthy();
  expect(screen.queryByTestId('review-bulk-kind-option-income')).toBeNull();
  expect(screen.queryByTestId('review-bulk-kind-option-refund')).toBeNull();
});

test('a mixed-sign selection says why the kind picker is out, a zero amount does not', async () => {
  seed([
    row({ id: 'row-1', row_no: 1, kind: 'expense', amount: '-128.5000' }),
    row({
      id: 'row-2', row_no: 2, kind: 'income', amount: '3000.0000',
      category_l1: 'salary', category_l2: null,
    }),
    // 02 §2.8 rule 10: an amount that could not be parsed is stored as 0.
    row({ id: 'row-3', row_no: 3, kind: 'expense', amount: '0.0000' }),
  ]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  // A dead control with no reason is the weakest form of "block the impossible option".
  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  expect(screen.getByTestId('review-bulk-kind-hint')).toBeTruthy();

  // The server's own sign check treats 0 as non-positive and skips it for expense and
  // transfer, so one unparseable amount must not cost the user the whole picker.
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  fireEvent.press(screen.getByTestId('review-table-select-row-3'));
  expect(screen.queryByTestId('review-bulk-kind-hint')).toBeNull();
  fireEvent.press(screen.getByTestId('review-bulk-kind-trigger'));
  expect(await screen.findByTestId('review-bulk-kind-option-expense')).toBeTruthy();
  expect(screen.getByTestId('review-bulk-kind-option-transfer')).toBeTruthy();
  expect(screen.queryByTestId('review-bulk-kind-option-income')).toBeNull();
  expect(screen.queryByTestId('review-bulk-kind-option-refund')).toBeNull();
});

test('a refused bulk kind change says nothing about categories and highlights the row', async () => {
  const rows = [1, 2].map((n) => row({ id: `row-${n}`, row_no: n, amount: '-10.0000' }));
  seed(rows);
  api.mock
    .onPatch(apiUrl(ROWS_PATH))
    .reply(400, { detail: '第 2 行的符号与类型冲突', code: 'validation_error' });
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  fireEvent.press(screen.getByTestId('review-bulk-kind-trigger'));
  fireEvent.press(await screen.findByTestId('review-bulk-kind-option-transfer'));

  const message = String((await screen.findByTestId('review-bulk-error')).props.children);
  expect(message).toContain('2');
  // The user pressed "set kind": blaming a category would be a lie about what happened.
  expect(message).not.toContain('分类');
  await waitFor(() =>
    expect(screen.getByTestId('review-table-row-row-2').props.style.backgroundColor).toBe(
      lightColors['status.warning.bg'],
    ),
  );
});

test('a failure that names no row clears the highlight instead of blaming a row', async () => {
  const rows = [1, 2].map((n) => row({ id: `row-${n}`, row_no: n, amount: '-10.0000' }));
  seed(rows);
  let detail = '第 2 行的符号与类型冲突';
  api.mock.onPatch(apiUrl(ROWS_PATH)).reply(() => [400, { detail, code: 'validation_error' }]);
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  fireEvent.press(screen.getByTestId('review-bulk-skip'));
  await waitFor(() =>
    expect(screen.getByTestId('review-table-row-row-2').props.style.backgroundColor).toBe(
      lightColors['status.warning.bg'],
    ),
  );

  // Nothing in this refusal points at a row, so leaving row 2 tinted would send the user
  // after an innocent row while the message only says "check the selected rows".
  detail = '这一批没有通过校验';
  fireEvent.press(screen.getByTestId('review-bulk-unskip'));
  await waitFor(() =>
    expect(screen.getByTestId('review-table-row-row-2').props.style.backgroundColor).not.toBe(
      lightColors['status.warning.bg'],
    ),
  );
});

test('the bulk bar accepts no second command while one is in flight', async () => {
  const rows = [1, 2].map((n) => row({ id: `row-${n}`, row_no: n }));
  seed(rows);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  api.mock.onPatch(apiUrl(ROWS_PATH)).reply(async () => {
    await gate;
    serverRows = rows.map((r) => ({ ...r, status: 'skipped' as const }));
    return [200, { updated: serverRows.length, rows: serverRows }];
  });
  renderRouter(ROUTES, { initialUrl: REVIEW_URL, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('review-table-select-row-1'));
  fireEvent.press(screen.getByTestId('review-table-select-row-2'));
  fireEvent.press(screen.getByTestId('review-bulk-skip'));

  // Every control, not only the three buttons: a second pick would send a second batch
  // PATCH over rows the first one is still changing.
  await waitFor(() =>
    expect(screen.getByTestId('review-bulk-skip').props.accessibilityState.disabled).toBe(true),
  );
  expect(screen.getByTestId('review-bulk-kind-trigger').props.accessibilityState.disabled).toBe(
    true,
  );
  expect(
    screen.getByTestId('review-bulk-currency-trigger').props.accessibilityState.disabled,
  ).toBe(true);
  expect(screen.getByTestId('review-bulk-category').props.accessibilityState.disabled).toBe(true);

  await act(async () => {
    release();
    await Promise.resolve();
  });
  await waitFor(() => expect(bulkCalls()).toHaveLength(1));
});
