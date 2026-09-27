/**
 * A batch's browsing state (04 §4.11.6, §8 「导入批次切片」; decision §14.66 e).
 *
 * The slice on screen and the row pointed at live in the ledger's view state under
 * `imports.batch.<batchId>`, never in the address: `/imports/:batchId` stays bare, changing
 * the slice leaves no history entry (back returns to the page before the batch), leaving the
 * batch and coming back finds the same slice, every batch keeps its own, and an entry that
 * writes `{ row }` opens the batch on that row. A committed batch's 「查看这批交易」 opens the
 * transaction list filtered to it — through the list's view state too.
 *
 * The routes sit under one flat `Slot`, as in the app (§14.66 g), so leaving a page really
 * unmounts it and anything that survives did so through the view state.
 */
import React from 'react';
import { Pressable, Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot, router as expoRouter, useRouter } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import type { ImportRow } from '@/api/types';
import { initI18n } from '@/i18n';
import {
  AuthProvider,
  LedgerProvider,
  ViewStateProvider,
  useLedgerViewState,
  useSetLedgerViewState,
} from '@/store';
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
  makeImportCommitResult,
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
import { batchViewKey } from '../useBatchView';

let queryClient: QueryClient;
let api: MockApi;

const OTHER_BATCH_ID = 'b2b2b2b2-1111-4222-8333-444455556666';
const LEDGER = makeLedger({ base_currency: 'CNY' });
const SOURCE = makeLedgerSource({ id: SOURCE_ID, name: '招行信用卡', default_currency: 'CNY' });

/** Slow `waitFor` ticks under the router's fake timers; see history.test.tsx. */
const VIEW_TEST_TIMEOUT = 20_000;

const batchPath = (id: string): string => `/ledgers/${LEDGER_ID}/imports/${id}`;

/** Four rows, one per slice: plain, flagged, skipped, uncategorized. */
function rowsOf(batchId: string): ImportRow[] {
  const at = (over: Partial<ImportRow>): ImportRow =>
    makeImportRow({ batch_id: batchId, ...over });
  return [
    at({ id: `${batchId}-1`, row_no: 1 }),
    at({ id: `${batchId}-2`, row_no: 2, flags: ['duplicate'] }),
    at({ id: `${batchId}-3`, row_no: 3, status: 'skipped' }),
    at({ id: `${batchId}-4`, row_no: 4, category_l1: null, category_l2: null }),
  ];
}

function seedBatch(id: string, rows: ImportRow[], status: 'ready' | 'committed' = 'ready'): void {
  mockGet(batchPath(id), makeImportBatch({ id, status, row_count: rows.length }));
  mockGet(`${batchPath(id)}/rows`, { items: rows, total: rows.length });
}

/** The history page, reduced to its ways into a batch. */
function HistoryStub(): React.JSX.Element {
  const router = useRouter();
  const setViewState = useSetLedgerViewState();
  return (
    <>
      <RNText>history</RNText>
      <Pressable testID="open-batch" onPress={() => router.push(`/imports/${BATCH_ID}`)} />
      <Pressable
        testID="open-other-batch"
        onPress={() => router.push(`/imports/${OTHER_BATCH_ID}`)}
      />
      {/* What a transaction's 「导入」 mark does: point the batch at a row, then open it. */}
      <Pressable
        testID="open-batch-at-row"
        onPress={() => {
          setViewState(batchViewKey(BATCH_ID), { row: `${BATCH_ID}-1` });
          router.push(`/imports/${BATCH_ID}`);
        }}
      />
    </>
  );
}

/** The transaction list, reduced to the filters it would open with. */
function TransactionListProbe(): React.JSX.Element {
  const [filters] = useLedgerViewState<Record<string, unknown>>('transactions.filters', {});
  return <RNText testID="tx-filters">{JSON.stringify(filters)}</RNText>;
}

const ROUTES = {
  _layout: () => <Slot />,
  index: () => <RNText>landing</RNText>,
  'imports/index': HistoryStub,
  'imports/new': () => <RNText>upload</RNText>,
  'imports/[batchId]': ImportBatchScreen,
  'transactions/index': TransactionListProbe,
};

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <ViewStateProvider>
            <LedgerProvider ledgerId={LEDGER_ID} ledgers={[LEDGER]}>
              {children}
            </LedgerProvider>
          </ViewStateProvider>
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

function renderFromHistory(): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, { initialUrl: '/imports', wrapper: Wrapper });
}

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = makeTestQueryClient();
  await initI18n();
  await i18next.changeLanguage('zh');
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', makeCurrencyList());
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [SOURCE], total: 1 });
  mockGet('/ledgers', { items: [LEDGER], total: 1 });
  seedBatch(BATCH_ID, rowsOf(BATCH_ID));
  seedBatch(OTHER_BATCH_ID, rowsOf(OTHER_BATCH_ID));
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  jest.restoreAllMocks();
});

const shown = (id: string): boolean => screen.queryByTestId(`review-table-row-${id}`) !== null;

test(
  'a slice change keeps the address bare, back skips it, and coming back finds the same slice',
  async () => {
    const router = renderFromHistory();

    fireEvent.press(await screen.findByTestId('open-batch'));
    // First paint: 「待归类」, because the batch has an uncategorized row (§4.11.6).
    expect(await screen.findByTestId(`review-table-row-${BATCH_ID}-4`)).toBeTruthy();
    expect(shown(`${BATCH_ID}-2`)).toBe(false);

    fireEvent.press(screen.getByText('有标记 1'));
    expect(await screen.findByTestId(`review-table-row-${BATCH_ID}-2`)).toBeTruthy();
    expect(shown(`${BATCH_ID}-4`)).toBe(false);
    // No `?filter=`: the address is the batch and nothing else.
    expect(router.getPathname()).toBe(`/imports/${BATCH_ID}`);
    expect(router.getSearchParams()).toEqual({ batchId: BATCH_ID });

    // One step back is the page before the batch — the slice made no history entry.
    act(() => expoRouter.back());
    await waitFor(() => expect(router.getPathname()).toBe('/imports'));
    expect(screen.queryByTestId('import-batch-screen')).toBeNull();

    // In again: still 「有标记」, not the first-paint default.
    fireEvent.press(screen.getByTestId('open-batch'));
    expect(await screen.findByTestId(`review-table-row-${BATCH_ID}-2`)).toBeTruthy();
    expect(shown(`${BATCH_ID}-4`)).toBe(false);
  },
  VIEW_TEST_TIMEOUT,
);

test(
  'every batch keeps its own slice',
  async () => {
    const router = renderFromHistory();

    fireEvent.press(await screen.findByTestId('open-batch'));
    fireEvent.press(await screen.findByText('已跳过 1'));
    expect(await screen.findByTestId(`review-table-row-${BATCH_ID}-3`)).toBeTruthy();

    act(() => expoRouter.back());
    await waitFor(() => expect(router.getPathname()).toBe('/imports'));
    fireEvent.press(screen.getByTestId('open-other-batch'));

    // The other batch never had a slice picked: it opens on its own first-paint default.
    expect(await screen.findByTestId(`review-table-row-${OTHER_BATCH_ID}-4`)).toBeTruthy();
    expect(shown(`${OTHER_BATCH_ID}-3`)).toBe(false);
  },
  VIEW_TEST_TIMEOUT,
);

test(
  'an entry that writes { row } opens the batch pointing at that row',
  async () => {
    renderFromHistory();

    fireEvent.press(await screen.findByTestId('open-batch-at-row'));

    // Row 1 is in none of the narrow slices, so the batch widens to 「全部」 to show it, and
    // paints it as the row pointed at.
    const target = await screen.findByTestId(`review-table-row-${BATCH_ID}-1`);
    await waitFor(() =>
      expect(target.props.style.backgroundColor).toBe(lightColors['status.warning.bg']),
    );
    expect(shown(`${BATCH_ID}-4`)).toBe(true);
  },
  VIEW_TEST_TIMEOUT,
);

test(
  '「查看这批交易」 opens /transactions filtered to the batch through its view state',
  async () => {
    seedBatch(BATCH_ID, rowsOf(BATCH_ID), 'committed');
    api.mock
      .onPost(apiUrl(`${batchPath(BATCH_ID)}/commit`))
      .reply(200, makeImportCommitResult({ created_transactions: 4, skipped_rows: 0 }));
    const router = renderRouter(ROUTES, {
      initialUrl: `/imports/${BATCH_ID}`,
      wrapper: Wrapper,
    });

    fireEvent.press(await screen.findByTestId('import-committed-view'));

    await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
    expect(router.getSearchParams()).toEqual({});
    expect(JSON.parse(String(screen.getByTestId('tx-filters').props.children))).toEqual({
      import_batch_id: BATCH_ID,
    });
  },
  VIEW_TEST_TIMEOUT,
);
