/**
 * `/l/:ledgerId/transactions` — the transaction list (04 §4.5, 屏幕稿 02 / 15).
 *
 * Two frames over one query family. **Wide** (屏幕稿 02 · 1440) is the page header with its
 * inline stats and 「＋ 记一笔」, the 「筛选」 card, and a real seven-column table whose foot
 * strip carries 「N / M 笔已显示」, the net of the whole result and the pager. **Narrow**
 * (屏幕稿 02 · 375) is the search box plus a filter button, a stat line, day-grouped cards
 * and a summary card at the end, scrolling infinitely.
 *
 * The URL owns the filters (04 §1.3), so this screen holds almost no state of its own. Two
 * numbers are deliberately *not* computed from the rows: the summary comes from the
 * response's `summary` (the whole filtered result, not this page) and the count from its
 * `total` — subtracting the pairs merged *on this page* (a transfer's two legs render as
 * one row) would make either drift as more pages arrive.
 */
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
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
  useDeleteTransaction,
  useDeleteTransfer,
  useInfiniteTransactions,
  useSources,
  useTransactions,
} from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  Card,
  Divider,
  GhostBlock,
  Page,
  PageHeader,
  Skeleton,
  Text,
  confirm,
  toast,
} from '@/ui';

import { DayGroup } from './DayGroup';
import { type CandidateCtx } from './EmptyFiltered';
import { FilterBar } from './FilterBar';
import { Pagination } from './Pagination';
import { SummaryBar } from './SummaryBar';
import { RowMenu, leadTransaction } from './TransactionRow';
import { EmptyFilteredState, EmptyNoData, ListError } from './TransactionsEmpty';
import { TransactionsTable } from './TransactionsTable';
import { useTxFilters } from './useTxFilters';

/** 04 §4.5: eight skeleton rows while the first page is in flight. */
const SKELETON_ROWS = 8;

export default function TransactionsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const l = routes.l(ledgerId);
  // The narrow layout's chrome carries the page title (04 §1.4); the wide one has no top
  // bar, so there the `PageHeader` below is the only one (decision §14.56).
  useTopBar(t('transaction:list.title'));

  const f = useTxFilters(ledgerId);

  // Archived accounts are included: they can't take new entries, but they still own old
  // ones, and a filter that couldn't name them would hide those rows' account (§4.8).
  const sourcesQuery = useSources(ledgerId, { include_archived: true });
  const categories = useCategories();

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

  const items: Transaction[] = React.useMemo(() => pages.flatMap((p) => p.items), [pages]);
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
      router.push(
        (pairId
          ? l.transfer(pairId)
          : l.transaction(row.kind === 'pair' ? row.out.id : row.tx.id)) as Href,
      );
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

  // -------------------------------------------------------------------- parts
  const countLabel = wide
    ? t('transaction:list.count', { count: total })
    : t('transaction:list.count_loaded', { loaded, count: total });

  const summaryLabel = summary
    ? t(wide ? 'transaction:list.summary' : 'transaction:list.summary_short', {
        expense: formatMoney(summary.expense, summary.base_currency, lang),
        income: formatMoney(summary.income, summary.base_currency, lang),
        net: formatMoney(summary.net, summary.base_currency, lang, { signDisplay: 'always' }),
      })
    : null;

  const filterBar = (
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
      baseCurrency={baseCurrency}
      lang={lang}
      total={total}
    />
  );

  const candidateCtx: CandidateCtx = {
    t,
    lang,
    index: categories.index,
    sourceName,
    baseCurrency,
  };

  // ------------------------------------------------------------- empty states
  const errorBlock = <ListError onRetry={() => void refetch()} />;

  const emptyBlock =
    f.activeCount === 0 ? (
      <EmptyNoData
        onAdd={() => router.push(l.transactionNew() as Href)}
        onImport={() => router.push(l.importsNew() as Href)}
      />
    ) : (
      <EmptyFilteredState
        ledgerId={ledgerId}
        filters={f.filters}
        activeCount={f.activeCount}
        ctx={candidateCtx}
        onApply={f.replaceAll}
        onClear={f.clear}
      />
    );

  // ---------------------------------------------------------------- wide page
  if (wide) {
    return (
      <Page testID="transactions-screen">
        <PageHeader
          title={t('transaction:list.title')}
          meta={
            <View style={styles.statLine}>
              <Text variant="body" tone="secondary" mono weight={500} testID="tx-count">
                {countLabel}
              </Text>
              {/* 屏幕稿 15 · 空交易列表 1440 prints counts and nothing else: 「支出 ¥0.00 ·
                  收入 ¥0.00」 on a ledger with no rows is noise, not information. */}
              {total > 0 && summaryLabel !== null ? (
                <Text variant="body" tone="muted" mono testID="tx-summary-line">
                  {`· ${summaryLabel}`}
                </Text>
              ) : null}
            </View>
          }
          actions={
            <Button
              icon="plus"
              label={t('common:nav.add')}
              onPress={() => router.push(l.transactionNew() as Href)}
              testID="tx-add"
            />
          }
          testID="tx-header"
        />
        {filterBar}
        {isError ? (
          errorBlock
        ) : (
          <TransactionsTable
            rows={isPending ? [] : rows}
            baseCurrency={baseCurrency}
            lang={lang}
            index={categories.index}
            sourceName={sourceName}
            onPressRow={openRow}
            total={total}
            shown={rows.length}
            summary={summary}
            empty={isPending ? undefined : emptyBlock}
            pager={
              <Pagination
                total={total}
                offset={f.filters.offset ?? 0}
                limit={TX_PAGE_SIZE}
                onChange={f.setOffset}
              />
            }
          />
        )}
      </Page>
    );
  }

  // -------------------------------------------------------------- narrow page
  const narrowHeader = (
    <View style={{ gap: space['3'], paddingBottom: space['1'] }}>
      {filterBar}
      {/* 屏幕稿 15 draws no stat line when the result is empty — neither on a ledger that
          holds nothing nor on a filter that matched nothing; the card says it instead. */}
      {total > 0 ? (
        <View style={[styles.statLine, styles.statRow]}>
          {/* 屏幕稿 02 · 375 keeps both halves on one line — the count left, the summary
              right — so neither may wrap and both may shrink. */}
          <Text
            variant="caption"
            tone="secondary"
            mono
            numberOfLines={1}
            style={styles.statCell}
            testID="tx-count"
          >
            {countLabel}
          </Text>
          {summaryLabel !== null ? (
            <Text
              variant="caption"
              tone="secondary"
              mono
              numberOfLines={1}
              style={styles.statCell}
              testID="tx-summary-line"
            >
              {summaryLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const narrowEmpty = isPending ? (
    <View style={{ gap: space['2'] }} testID="tx-skeletons">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <Skeleton key={i} variant="row" testID={`tx-skeleton-${i}`} />
      ))}
    </View>
  ) : isError ? (
    errorBlock
  ) : (
    <Card style={{ padding: space['5'] - 2, gap: space['4'] }}>
      {f.activeCount === 0 ? (
        <>
          <GhostBlock rows={3} />
          <Divider />
        </>
      ) : null}
      {emptyBlock}
    </Card>
  );

  const narrowFooter = (
    <View style={{ gap: space['3'], paddingTop: space['2'] }}>
      {infiniteQuery.isFetchingNextPage ? (
        <View style={{ alignItems: 'center' }} testID="tx-loading-more">
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
      {summary && total > 0 ? <SummaryBar summary={summary} lang={lang} /> : null}
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
              onOpenMenu={setMenuRow}
            />
          )}
          ListHeaderComponent={narrowHeader}
          ListEmptyComponent={narrowEmpty}
          ListFooterComponent={narrowFooter}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (infiniteQuery.hasNextPage && !infiniteQuery.isFetchingNextPage) {
              void infiniteQuery.fetchNextPage();
            }
          }}
          testID="tx-list"
        />
      </Page>
      <RowMenu
        row={menuRow}
        onClose={() => setMenuRow(null)}
        onEdit={editRow}
        onDelete={(row) => void deleteRow(row)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  statLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: space['2'],
  },
  statRow: {
    justifyContent: 'space-between',
    flexWrap: 'nowrap',
    paddingHorizontal: space['1'],
  },
  statCell: { flexShrink: 1, minWidth: 0 },
});
