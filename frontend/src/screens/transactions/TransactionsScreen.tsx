/**
 * `/l/:ledgerId/transactions` — the transaction list (04 §4.5).
 *
 * The URL owns the filters (04 §1.3), so this screen holds almost no state of its own: it
 * reads `useTxFilters`, hands the parameters to the query layer, and paints what comes
 * back. Two paging modes over one query family: infinite scroll on a narrow layout, a
 * pager whose `offset` lives in the URL on a wide one.
 *
 * Two of the numbers on screen are deliberately *not* computed from the rows: the bottom
 * summary comes from the response's `summary` (the whole filtered result, not this page),
 * and the count is the response's `total` as it stands — the number of entries the filters
 * match on the server. Subtracting the pairs merged *on this page* (the two legs of a
 * transfer render as one row) would make the count drift as more pages arrive, so the
 * header counts entries, and the narrow layout says how many of them are loaded.
 */
import React from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type {
  Transaction,
  TransactionListResponse,
  TransactionSummary,
  Uuid,
} from '@/api/types';
import { routes } from '@/domain/routes';
import { groupByDay, mergeTransferRows, type DayGroup as DayGroupData, type ListRow } from '@/domain/transfers';
import { useLang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { useTopBar } from '@/navigation';
import {
  TX_PAGE_SIZE,
  useCategories,
  useCurrencies,
  useDeleteTransaction,
  useDeleteTransfer,
  useInfiniteTransactions,
  useSources,
  useTransactions,
} from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, EmptyState, Page, Sheet, Skeleton, Text, confirm, toast } from '@/ui';

import { DayGroup } from './DayGroup';
import { EmptyFiltered, type CandidateCtx } from './EmptyFiltered';
import { FilterBar } from './FilterBar';
import { Pagination } from './Pagination';
import { SummaryBar } from './SummaryBar';
import { leadTransaction } from './TransactionRow';
import { useTxFilters } from './useTxFilters';

/** 04 §4.5: eight skeleton rows while the first page is in flight. */
const SKELETON_ROWS = 8;
/** Decision §14.52 A15: the rescue block only appears once two conditions are active. */
const RESCUE_MIN_FILTERS = 2;

export default function TransactionsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const l = routes.l(ledgerId);
  // The narrow layout's chrome carries the page title (04 §1.4); the wide one has no top
  // bar, so there the heading below is the only one.
  useTopBar(t('transaction:list.title'));

  const f = useTxFilters(ledgerId);

  // Archived accounts are included: they can't take new entries, but they still own old
  // ones, and a filter that couldn't name them would hide those rows' account (§4.8).
  const sourcesQuery = useSources(ledgerId, { include_archived: true });
  const categories = useCategories();
  const currencies = useCurrencies();

  const listParams = { ...f.filters, limit: TX_PAGE_SIZE };
  const pageQuery = useTransactions(wide ? ledgerId : undefined, listParams);
  const infiniteQuery = useInfiniteTransactions(wide ? undefined : ledgerId, listParams);

  const pages: TransactionListResponse[] = wide
    ? pageQuery.data
      ? [pageQuery.data]
      : []
    : (infiniteQuery.data?.pages ?? []);

  const isPending = wide ? pageQuery.isPending : infiniteQuery.isPending;
  const isError = wide ? pageQuery.isError : infiniteQuery.isError;
  const refetch = wide ? pageQuery.refetch : infiniteQuery.refetch;

  const items: Transaction[] = React.useMemo(
    () => pages.flatMap((p) => p.items),
    [pages],
  );
  const rows: ListRow[] = React.useMemo(() => mergeTransferRows(items), [items]);
  const groups: DayGroupData[] = React.useMemo(() => groupByDay(rows), [rows]);

  // The whole filtered result, straight from the server: a number that does not move when
  // another page arrives. `loaded` is what the infinite list has in hand so far.
  const total = pages[0]?.total ?? 0;
  const loaded = items.length;
  const summary: TransactionSummary | undefined = pages[pages.length - 1]?.summary;

  const sourceName = React.useCallback(
    (sid: Uuid): string =>
      sourcesQuery.data?.items.find((s) => s.id === sid)?.name ?? sid.slice(0, 6),
    [sourcesQuery.data],
  );

  // ------------------------------------------------------------------ actions
  const deleteTransaction = useDeleteTransaction(ledgerId);
  const deleteTransfer = useDeleteTransfer(ledgerId);
  const [menuRow, setMenuRow] = React.useState<ListRow | null>(null);

  const pairIdOf = (row: ListRow): Uuid | null =>
    row.kind === 'pair' ? row.pairId : row.tx.transfer_pair_id;

  const openRow = React.useCallback(
    (row: ListRow): void => {
      const pairId = pairIdOf(row);
      router.push((pairId ? l.transfer(pairId) : l.transaction(row.kind === 'pair' ? row.out.id : row.tx.id)) as Href);
    },
    [l, router],
  );

  const editRow = React.useCallback(
    (row: ListRow): void => {
      const pairId = pairIdOf(row);
      router.push(
        (pairId
          ? l.transferEdit(pairId)
          : l.transactionEdit(row.kind === 'pair' ? row.out.id : row.tx.id)) as Href,
      );
    },
    [l, router],
  );

  const deleteRow = React.useCallback(
    async (row: ListRow): Promise<void> => {
      const pairId = pairIdOf(row);
      const ok = await confirm({
        title: t('transaction:list.delete_confirm'),
        body: pairId ? t('transaction:list.delete_transfer_confirm') : undefined,
        tone: 'danger',
        confirmLabel: t('common:button.delete'),
        cancelLabel: t('common:button.cancel'),
      });
      if (!ok) return;
      const done = { onSuccess: () => toast.success(t('transaction:list.deleted_toast')) };
      // No `silent`: a failure is a one-shot action with nowhere of its own to show an
      // error, so the global mutation toast (04 §3.9) is exactly right.
      if (pairId) deleteTransfer.mutate(pairId, done);
      else deleteTransaction.mutate(leadTransaction(row).id, done);
    },
    [deleteTransaction, deleteTransfer, t],
  );

  const runRowAction = (action: (row: ListRow) => void | Promise<void>): void => {
    const row = menuRow;
    setMenuRow(null);
    if (row) void action(row);
  };

  // -------------------------------------------------------------------- parts
  const candidateCtx: CandidateCtx = {
    t,
    lang,
    index: categories.index,
    sourceName,
    baseCurrency,
  };

  const header = (
    <View style={{ gap: space['3'] }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'baseline', gap: space['3'], flexWrap: 'wrap' }}
      >
        {wide ? (
          <Text variant="title" accessibilityRole="header">
            {t('transaction:list.title')}
          </Text>
        ) : null}
        <Text variant="caption" tone="secondary" mono testID="tx-count">
          {wide
            ? t('transaction:list.count', { count: total })
            : t('transaction:list.count_loaded', { loaded, count: total })}
        </Text>
        {summary ? (
          <Text variant="caption" tone="muted" mono testID="tx-summary-line">
            {t('transaction:list.summary', {
              expense: formatMoney(summary.expense, summary.base_currency, lang),
              income: formatMoney(summary.income, summary.base_currency, lang),
              net: formatMoney(summary.net, summary.base_currency, lang, {
                signDisplay: 'always',
              }),
            })}
          </Text>
        ) : null}
      </View>

      <FilterBar
        filters={f.filters}
        activeCount={f.activeCount}
        qDraft={f.qDraft}
        onQChange={f.setQ}
        onPatch={f.patch}
        onRemove={f.remove}
        onClear={f.clear}
        sources={sourcesQuery.data?.items ?? []}
        index={categories.index}
        currencyCodes={currencies.codes}
        currencyNames={currencies.names}
        baseCurrency={baseCurrency}
        lang={lang}
      />
    </View>
  );

  const empty = (): React.JSX.Element => {
    if (isPending) {
      return (
        <View style={{ gap: space['2'] }} testID="tx-skeletons">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} variant="row" testID={`tx-skeleton-${i}`} />
          ))}
        </View>
      );
    }
    if (isError) {
      return (
        <EmptyState
          icon="alert-triangle"
          title={t('transaction:list.error_title')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void refetch() }}
          testID="tx-error"
        />
      );
    }
    if (f.activeCount === 0) {
      return (
        <EmptyState
          icon="list"
          title={t('transaction:list.empty_no_data')}
          primaryAction={{
            label: t('transaction:list.empty_no_data_action'),
            onPress: () => router.push(l.transactionNew() as Href),
          }}
          testID="tx-empty"
        />
      );
    }
    return (
      <View style={{ gap: space['3'] }}>
        <EmptyState
          icon="search"
          title={t('transaction:list.empty_filtered')}
          primaryAction={{ label: t('transaction:list.filter.clear_filters'), onPress: f.clear }}
          testID="tx-empty-filtered-state"
        />
        {f.activeCount >= RESCUE_MIN_FILTERS ? (
          <EmptyFiltered
            ledgerId={ledgerId}
            filters={f.filters}
            ctx={candidateCtx}
            onApply={f.replaceAll}
          />
        ) : null}
      </View>
    );
  };

  const footer = (
    <View style={{ gap: space['3'], paddingTop: space['3'] }}>
      {wide ? (
        <Pagination
          total={total}
          offset={f.filters.offset ?? 0}
          limit={TX_PAGE_SIZE}
          onChange={f.setOffset}
        />
      ) : infiniteQuery.isFetchingNextPage ? (
        <View style={{ alignItems: 'center', gap: space['2'] }} testID="tx-loading-more">
          <ActivityIndicator accessibilityLabel={t('transaction:list.loading_more')} />
        </View>
      ) : infiniteQuery.hasNextPage ? (
        <Button
          variant="secondary"
          label={t('transaction:list.load_more')}
          onPress={() => void infiniteQuery.fetchNextPage()}
          testID="tx-load-more"
        />
      ) : null}
      {!wide && summary ? <SummaryBar summary={summary} lang={lang} /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Page scroll={false} testID="transactions-screen">
        <FlatList
          data={groups}
          keyExtractor={(group) => group.date}
          renderItem={({ item }) => (
            <DayGroup
              group={item}
              baseCurrency={baseCurrency}
              lang={lang}
              index={categories.index}
              sourceName={sourceName}
              onPressRow={openRow}
              onEditRow={editRow}
              onDeleteRow={(row) => void deleteRow(row)}
              onOpenMenu={setMenuRow}
              onOpenBatch={(batchId) => router.push(l.importBatch(batchId) as Href)}
              onOpenRefundOrigin={(txId) => router.push(l.transaction(txId) as Href)}
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={empty()}
          ListFooterComponent={footer}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (wide) return;
            if (infiniteQuery.hasNextPage && !infiniteQuery.isFetchingNextPage) {
              void infiniteQuery.fetchNextPage();
            }
          }}
          testID="tx-list"
        />
      </Page>

      {wide && summary ? <SummaryBar summary={summary} lang={lang} pinned /> : null}

      <Sheet
        open={menuRow !== null}
        onClose={() => setMenuRow(null)}
        title={t('transaction:list.row.menu_title')}
        closeLabel={t('common:button.close')}
        testID="tx-row-menu"
      >
        <View style={{ gap: space['2'] }}>
          <Button
            variant="secondary"
            icon="pencil"
            label={t('common:button.edit')}
            fullWidth
            onPress={() => runRowAction(editRow)}
            testID="tx-row-menu-edit"
          />
          <Button
            variant="danger"
            icon="trash-2"
            label={t('common:button.delete')}
            fullWidth
            onPress={() => runRowAction(deleteRow)}
            testID="tx-row-menu-delete"
          />
        </View>
      </Sheet>
    </View>
  );
}
