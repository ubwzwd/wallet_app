/**
 * `/l/:ledgerId/imports` — the batch history and the two destructive actions
 * (04 §4.10, §8.5 cases 7–8; decisions §14.22, §14.40, §14.43, §14.52 A17 / B24, §14.56).
 *
 * The wide table (屏幕稿 11) and the narrow cards name the same things with the same test
 * ids, so most cases run on the default (wide) layout and only the layout-specific ones
 * flip `useIsWide`.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import type { ImportBatchListItem, LedgerMember } from '@/api/types';
import { initI18n } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { AuthProvider, LedgerProvider } from '@/store';
import * as breakpoint from '@/theme/useBreakpoint';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  BATCH_ID,
  LEDGER_ID,
  USER_ID,
  apiUrl,
  makeImportBatch,
  makeImportDeleteResult,
  makeLedger,
  makeTestQueryClient,
  makeUser,
  mockApi,
  mockGet,
  type MockApi,
} from '@/test';

import ImportsHistoryScreen from '../ImportsHistoryScreen';

let queryClient: QueryClient;
let api: MockApi;
let wideSpy: jest.SpyInstance;

function setWide(wide: boolean): void {
  wideSpy?.mockRestore();
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

const LEDGER = makeLedger({ base_currency: 'CNY' });
const IMPORTS_PATH = `/ledgers/${LEDGER_ID}/imports`;
const OTHER_USER = '9a9a9a9a-1111-4222-8333-444455556666';
const PASTED_ID = 'aabbccdd-1111-4222-8333-444455556666';

/** Two members: one with a display name, one without — 04 §4.10 falls back to the prefix. */
const MEMBERS: LedgerMember[] = [
  {
    user_id: USER_ID,
    email: 'mia@example.com',
    display_name: '米娅',
    role: 'owner',
    joined_at: '2026-01-01T00:00:00.000000Z',
    is_me: true,
  },
  {
    user_id: OTHER_USER,
    email: 'liang@example.com',
    display_name: null,
    role: 'member',
    joined_at: '2026-02-01T00:00:00.000000Z',
    is_me: false,
  },
];

const READY = makeImportBatch({
  id: BATCH_ID,
  status: 'ready',
  filename: '2026-08-cmb.csv',
  size_bytes: 18432,
  row_count: 128,
  net_amount: '-4210.5500',
  base_currency: 'CNY',
  created_by: USER_ID,
  flags_summary: { duplicate: 3, refund_candidate: 1, transfer_candidate: 2, needs_review: 7 },
});
const COMMITTED = makeImportBatch({
  id: PASTED_ID,
  status: 'committed',
  source: 'paste',
  filename: null,
  size_bytes: 512,
  row_count: 12,
  net_amount: '900.0000',
  created_by: OTHER_USER,
  committed_at: '2026-09-10T02:00:00.000000Z',
  flags_summary: { duplicate: 0, refund_candidate: 0, transfer_candidate: 0, needs_review: 0 },
});

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
  'l/[ledgerId]/imports/index': ImportsHistoryScreen,
  'l/[ledgerId]/imports/new': () => <RNText>upload page</RNText>,
  'l/[ledgerId]/imports/guide': () => <RNText>guide page</RNText>,
  'l/[ledgerId]/imports/[batchId]': () => <RNText>review table</RNText>,
  'l/[ledgerId]/transactions/index': () => <RNText>transaction list</RNText>,
};

function seed(items: ImportBatchListItem[] = [READY, COMMITTED]): void {
  mockGet(IMPORTS_PATH, { items, total: items.length });
}

function renderHistory(): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_ID}/imports`, wrapper: Wrapper });
}

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = makeTestQueryClient();
  await initI18n();
  await i18next.changeLanguage('zh');
  setWide(true);
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet(`/ledgers/${LEDGER_ID}/members`, { items: MEMBERS, total: MEMBERS.length });
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
  jest.restoreAllMocks();
});

test('each row carries the uploader, the net amount, the flag count and its status badge', async () => {
  seed();
  renderHistory();

  expect(await screen.findByTestId(`import-batch-${BATCH_ID}`)).toBeTruthy();
  // `created_by` mapped through the member list …
  expect(screen.getByTestId(`import-batch-${BATCH_ID}-uploader`).props.children).toBe('米娅');
  // … and the email prefix when nobody set a display name (decision §14.40).
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-uploader`).props.children).toBe('liang');

  expect(screen.getByTestId(`import-batch-${BATCH_ID}-net`).props.children).toBe(
    formatMoney('-4210.5500', 'CNY', 'zh', { signDisplay: 'always' }),
  );
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-net`).props.children).toBe(
    formatMoney('900.0000', 'CNY', 'zh', { signDisplay: 'always' }),
  );
  expect(screen.getByTestId(`import-batch-${BATCH_ID}-flags`).props.children).toBe('⚑ 13');
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-flags`).props.children).toBe('⚑ 0');

  // Only two statuses exist — no "reverted" (decision §14.22). The badges carry them; the
  // same two words also name two of the filter's segments, so they are read by test id.
  expect(screen.getByTestId(`import-batch-${BATCH_ID}-status`)).toHaveTextContent('待提交');
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-status`)).toHaveTextContent('已提交');
  expect(screen.queryByText('已撤销')).toBeNull();
});

test('a pasted batch shows the placeholder and its badge instead of an empty filename', async () => {
  seed();
  renderHistory();

  expect(await screen.findByTestId(`import-batch-${PASTED_ID}-filename`)).toBeTruthy();
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-filename`).props.children).toBe(
    '粘贴的 CSV 文本',
  );
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-paste-badge`)).toBeTruthy();
  // A real file shows its name and a human-readable size instead.
  expect(screen.getByTestId(`import-batch-${BATCH_ID}-filename`).props.children).toBe(
    '2026-08-cmb.csv',
  );
  expect(screen.getByTestId(`import-batch-${BATCH_ID}-size`).props.children).toBe('18 KB');
  expect(screen.queryByTestId(`import-batch-${BATCH_ID}-paste-badge`)).toBeNull();
});

test('the two status rows offer different actions and lead to the right places', async () => {
  seed();
  const router = renderHistory();

  expect(await screen.findByTestId(`import-batch-${BATCH_ID}-continue`)).toBeTruthy();
  expect(screen.getByTestId(`import-batch-${BATCH_ID}-discard`)).toBeTruthy();
  expect(screen.queryByTestId(`import-batch-${BATCH_ID}-undo`)).toBeNull();
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-view`)).toBeTruthy();
  expect(screen.getByTestId(`import-batch-${PASTED_ID}-undo`)).toBeTruthy();
  expect(screen.queryByTestId(`import-batch-${PASTED_ID}-continue`)).toBeNull();

  fireEvent.press(screen.getByTestId(`import-batch-${PASTED_ID}-view`));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/transactions`));
  expect(router.getSearchParams().import_batch_id).toBe(PASTED_ID);
});

test('undo asks with dry_run first, words both counters separately, then deletes for real', async () => {
  seed();
  api.mock
    .onDelete(apiUrl(`${IMPORTS_PATH}/${PASTED_ID}`))
    .replyOnce(
      200,
      makeImportDeleteResult({
        batch_id: PASTED_ID,
        deleted: false,
        would_delete_transactions: 128,
        orphaned_refunds: 2,
        refunds_in_batch: 3,
      }),
    )
    .onDelete(apiUrl(`${IMPORTS_PATH}/${PASTED_ID}`))
    .replyOnce(
      200,
      makeImportDeleteResult({
        batch_id: PASTED_ID,
        deleted: true,
        deleted_transactions: 128,
        orphaned_refunds: 2,
        refunds_in_batch: 3,
      }),
    );
  renderHistory();

  fireEvent.press(await screen.findByTestId(`import-batch-${PASTED_ID}-undo`));

  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  // The dry run came first and changed nothing.
  expect(api.mock.history.delete).toHaveLength(1);
  expect(api.mock.history.delete[0].params).toEqual({ dry_run: true });

  // Two counters, two different sentences (decision §14.52 B24).
  expect(screen.getByText(/批外有 2 笔退款指向这批里的支出/)).toBeTruthy();
  expect(screen.getByText(/这批里有 3 笔退款/)).toBeTruthy();

  // `doubleTap`: the first press only arms the button.
  fireEvent.press(screen.getByTestId('confirm-accept'));
  expect(api.mock.history.delete).toHaveLength(1);
  fireEvent.press(screen.getByTestId('confirm-accept'));

  await waitFor(() => expect(api.mock.history.delete).toHaveLength(2));
  expect(api.mock.history.delete[1].params).toBeUndefined();
  expect(await screen.findByText('已撤销，删除了 128 条交易')).toBeTruthy();
});

test('a counter of zero contributes no line to the confirmation', async () => {
  seed();
  api.mock.onDelete(apiUrl(`${IMPORTS_PATH}/${PASTED_ID}`)).reply(
    200,
    makeImportDeleteResult({
      batch_id: PASTED_ID,
      deleted: false,
      would_delete_transactions: 12,
      orphaned_refunds: 0,
      refunds_in_batch: 4,
    }),
  );
  renderHistory();

  fireEvent.press(await screen.findByTestId(`import-batch-${PASTED_ID}-undo`));

  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  expect(screen.getByText(/这批里有 4 笔退款/)).toBeTruthy();
  expect(screen.queryByText(/批外有/)).toBeNull();
});

test('cancelling the confirmation leaves the batch alone', async () => {
  seed();
  api.mock
    .onDelete(apiUrl(`${IMPORTS_PATH}/${PASTED_ID}`))
    .reply(200, makeImportDeleteResult({ batch_id: PASTED_ID, deleted: false }));
  renderHistory();

  fireEvent.press(await screen.findByTestId(`import-batch-${PASTED_ID}-undo`));
  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  fireEvent.press(screen.getByTestId('confirm-cancel'));

  await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
  // Only the dry run was ever sent.
  expect(api.mock.history.delete).toHaveLength(1);
});

test('discarding a draft uses its own wording and needs no dry run', async () => {
  seed();
  api.mock
    .onDelete(apiUrl(`${IMPORTS_PATH}/${BATCH_ID}`))
    .reply(
      200,
      makeImportDeleteResult({ batch_id: BATCH_ID, mode: 'discard', deleted: true }),
    );
  renderHistory();

  fireEvent.press(await screen.findByTestId(`import-batch-${BATCH_ID}-discard`));

  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  expect(screen.getByText('丢弃这批草稿？')).toBeTruthy();
  expect(screen.queryByText('撤销这批导入？')).toBeNull();
  expect(api.mock.history.delete).toEqual([]);

  fireEvent.press(screen.getByTestId('confirm-accept'));
  await waitFor(() => expect(api.mock.history.delete).toHaveLength(1));
  expect(api.mock.history.delete[0].params).toBeUndefined();
  expect(await screen.findByText('已丢弃这批草稿')).toBeTruthy();
});

test('the empty state offers the import page and the guide, and the header keeps both entries', async () => {
  seed([]);
  const router = renderHistory();

  expect(await screen.findByTestId('imports-empty')).toBeTruthy();
  expect(screen.getByText('还没导入过账单')).toBeTruthy();
  expect(screen.getByTestId('imports-new')).toBeTruthy();

  fireEvent.press(screen.getByTestId('imports-empty-primary'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/new`));
});

test('the empty state still leads to the guide', async () => {
  seed([]);
  const router = renderHistory();

  fireEvent.press(await screen.findByTestId('imports-empty-secondary'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/guide`));
});

test('the header counts the batches and the status filter narrows the list through the URL', async () => {
  seed();
  const router = renderHistory();

  // 「2 批 · 1 批待提交 · 已入账 12 笔」: the committed batch's rows are the ones on the books.
  const meta = await screen.findByTestId('imports-header-meta');
  expect(String(meta.props.children)).toBe(
    i18next.t('import:history.stats', { batches: 2, ready: 1, rows: 12 }),
  );

  fireEvent.press(screen.getByTestId('imports-filter-ready'));
  await waitFor(() => expect(router.getSearchParams().status).toBe('ready'));
  expect(screen.getByTestId(`import-batch-${BATCH_ID}`)).toBeTruthy();
  expect(screen.queryByTestId(`import-batch-${PASTED_ID}`)).toBeNull();

  fireEvent.press(screen.getByTestId('imports-filter-committed'));
  await waitFor(() => expect(router.getSearchParams().status).toBe('committed'));
  expect(screen.getByTestId(`import-batch-${PASTED_ID}`)).toBeTruthy();
  expect(screen.queryByTestId(`import-batch-${BATCH_ID}`)).toBeNull();

  // Filtering is a view over the page in hand — it costs no second request.
  const listed = api.mock.history.get.filter((r) => (r.url ?? '').endsWith('/imports'));
  expect(listed).toHaveLength(1);
});

test('a draft row says how many rows still need a category, on both layouts', async () => {
  seed([{ ...READY, uncategorized_count: 3 }]);
  renderHistory();

  expect(await screen.findByText('3 行待归类')).toBeTruthy();

  setWide(false);
  seed([{ ...READY, uncategorized_count: 3 }]);
  renderHistory();
  expect(await screen.findByText('还有 3 行待归类，补齐后才能提交')).toBeTruthy();
});

test('the history pages 20 at a time', async () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    makeImportBatch({ id: `batch-${i}`, filename: `f${i}.csv` }),
  );
  mockGet(IMPORTS_PATH, { items: many, total: 43 });
  renderHistory();

  expect(await screen.findByTestId('imports-pagination')).toBeTruthy();
  expect(screen.getByTestId('imports-pagination-page').props.children).toBe('第 1 / 3 页');

  fireEvent.press(screen.getByTestId('imports-pagination-next'));
  await waitFor(() =>
    expect(screen.getByTestId('imports-pagination-page').props.children).toBe('第 2 / 3 页'),
  );
  const listed = api.mock.history.get.filter((r) => (r.url ?? '').endsWith('/imports'));
  expect(listed[listed.length - 1].params).toEqual({ limit: 20, offset: 20 });
});
