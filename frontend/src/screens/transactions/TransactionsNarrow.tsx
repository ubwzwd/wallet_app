/**
 * 屏幕稿 02 · 交易列表 375 — the narrow frame of the transaction list.
 *
 * The search box plus filter button, one stat line, day-grouped cards that scroll
 * infinitely, and the 支出 / 收入 / 净额 summary card at the end. `TransactionsScreen.tsx`
 * owns the queries and every action; this file is the phone-sized composition of them.
 */
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TransactionSummary, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import type { DayGroup as DayGroupData, ListRow } from '@/domain/transfers';
import type { Lang } from '@/i18n';
import { space } from '@/theme/tokens';
import { Button, Card, Divider, GhostBlock, Page, Skeleton, Text } from '@/ui';

import { DayGroup } from './DayGroup';
import { SummaryBar } from './SummaryBar';
import { RowMenu } from './TransactionRow';

/** 04 §4.5: eight skeleton rows while the first page is in flight. */
const SKELETON_ROWS = 8;

export interface TransactionsNarrowProps {
  groups: readonly DayGroupData[];
  baseCurrency: string;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  /** The filter card of 屏幕稿 02 · 375, built by the screen. */
  filterBar: React.ReactElement;
  countLabel: string;
  summaryLabel: string | null;
  total: number;
  summary: TransactionSummary | undefined;
  isPending: boolean;
  isError: boolean;
  /** How many filters are on: it decides which of the two empty blocks is drawn. */
  activeCount: number;
  errorBlock: React.ReactElement;
  emptyBlock: React.ReactElement;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore(): void;
  onPressRow(row: ListRow): void;
  onEditRow(row: ListRow): void;
  onDeleteRow(row: ListRow): void;
}

export function TransactionsNarrow({
  groups,
  baseCurrency,
  lang,
  index,
  sourceName,
  filterBar,
  countLabel,
  summaryLabel,
  total,
  summary,
  isPending,
  isError,
  activeCount,
  errorBlock,
  emptyBlock,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onPressRow,
  onEditRow,
  onDeleteRow,
}: TransactionsNarrowProps): React.JSX.Element {
  const { t } = useTranslation();
  const [menuRow, setMenuRow] = React.useState<ListRow | null>(null);

  const header = (
    <View style={styles.header}>
      {filterBar}
      {/* 屏幕稿 15 draws no stat line when the result is empty — neither on a ledger that
          holds nothing nor on a filter that matched nothing; the card says it instead. */}
      {total > 0 ? (
        <View style={[styles.statLine, styles.statRow]}>
          {/* 屏幕稿 02 · 375 keeps both halves on one line — the count left, the summary
              right. Neither may wrap; the count is the half that never gives way, because
              「共 140 笔」 cut to 「共 14…」 would read as a different number. */}
          <Text
            variant="caption"
            tone="secondary"
            mono
            numberOfLines={1}
            style={styles.statCount}
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

  const empty = isPending ? (
    <View style={styles.skeletons} testID="tx-skeletons">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <Skeleton key={i} variant="row" testID={`tx-skeleton-${i}`} />
      ))}
    </View>
  ) : isError ? (
    errorBlock
  ) : (
    <Card style={styles.emptyCard}>
      {activeCount === 0 ? (
        <>
          <GhostBlock rows={3} />
          <Divider />
        </>
      ) : null}
      {emptyBlock}
    </Card>
  );

  const footer = (
    <View style={styles.footer}>
      {isFetchingNextPage ? (
        <View style={styles.centre} testID="tx-loading-more">
          <ActivityIndicator accessibilityLabel={t('transaction:list.loading_more')} />
        </View>
      ) : hasNextPage ? (
        <Button
          variant="secondary"
          label={t('transaction:list.load_more')}
          onPress={onLoadMore}
          testID="tx-load-more"
        />
      ) : null}
      {summary && total > 0 ? <SummaryBar summary={summary} /> : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <Page scroll={false} testID="transactions-screen">
        <FlatList
          data={groups}
          keyExtractor={(group) => group.date}
          renderItem={({ item }) => (
            <DayGroup
              group={item}
              baseCurrency={baseCurrency}
              lang={lang}
              index={index}
              sourceName={sourceName}
              onPressRow={onPressRow}
              onOpenMenu={setMenuRow}
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) onLoadMore();
          }}
          testID="tx-list"
        />
      </Page>
      <RowMenu
        row={menuRow}
        onClose={() => setMenuRow(null)}
        onEdit={onEditRow}
        onDelete={onDeleteRow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: space['3'], paddingBottom: space['1'] },
  statLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space['2'] },
  statRow: {
    justifyContent: 'space-between',
    flexWrap: 'nowrap',
    paddingHorizontal: space['1'],
  },
  statCount: { flexShrink: 0 },
  statCell: { flexShrink: 1, minWidth: 0 },
  skeletons: { gap: space['2'] },
  emptyCard: { padding: space['5'] - 2, gap: space['4'] },
  footer: { gap: space['3'], paddingTop: space['2'] },
  centre: { alignItems: 'center' },
});

export default TransactionsNarrow;
