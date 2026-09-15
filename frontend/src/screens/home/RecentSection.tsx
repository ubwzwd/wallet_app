/**
 * Home block 5 (screen 01, 04 §4.4): 「最近」 — the five newest transactions.
 *
 * The two legs of a transfer arrive as two rows from the API and are merged here by
 * `mergeTransferRows` (decision §14.52 B15), so a transfer reads as one 「A → B」 line; a
 * leg whose partner fell outside the five still renders on its own. Wide rows carry the
 * kind badge between the text and the amount, as the mockup draws it; narrow rows drop it
 * — the icon well already says which kind it is (04 §6.2 rule 7).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { FinanceSource, Transaction, TransactionListResponse, Uuid } from '@/api/types';
import { absMoney, mergeTransferRows, type ListRow as TxListRow } from '@/domain';
import type { CategoryIndex } from '@/domain/categories';
import { useLang, type Lang } from '@/i18n';
import { categoryName } from '@/i18n/category';
import { formatConverted, formatDateShort, formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  EmptyState,
  KindBadge,
  KindIcon,
  KIND_AMOUNT_TONE,
  ListCard,
  ListRow,
  SectionHeader,
  Skeleton,
  Text,
} from '@/ui';

/** How many rows the mockup's 「最近」 card holds. */
export const RECENT_LIMIT = 5;

export interface RecentSectionProps {
  query: UseQueryResult<TransactionListResponse>;
  sources: readonly FinanceSource[];
  baseCurrency: string;
  categoryIndex: CategoryIndex | null;
  onSeeAll(): void;
  onPressRow(row: TxListRow): void;
  onAddTransaction(): void;
}

/** The row's leading transaction — the "out" leg for a merged pair. */
function lead(row: TxListRow): Transaction {
  return row.kind === 'pair' ? row.out : row.tx;
}

function rowKey(row: TxListRow): string {
  return row.kind === 'pair' ? row.pairId : row.tx.id;
}

/** 「餐饮 / 零食饮料」 — the category path the mockup puts under the merchant. */
function categoryPath(tx: Transaction, index: CategoryIndex | null, lang: Lang): string | null {
  const l1 = tx.category_l1 ? index?.byCode[tx.category_l1] : undefined;
  const l2 = tx.category_l2 ? index?.byCode[tx.category_l2] : undefined;
  const parts = [
    l1 ? categoryName(l1, lang) : tx.category_l1,
    l2 ? categoryName(l2, lang) : tx.category_l2,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' / ') : null;
}

export function RecentSection({
  query,
  sources,
  baseCurrency,
  categoryIndex,
  onSeeAll,
  onPressRow,
  onAddTransaction,
}: RecentSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();

  const sourceName = React.useCallback(
    (id: Uuid): string => sources.find((s) => s.id === id)?.name ?? '',
    [sources],
  );

  const header = (
    <SectionHeader
      title={t('stats:home.recent_title')}
      link={{ label: t('stats:home.all_transactions'), onPress: onSeeAll }}
      testID="home-recent-header"
    />
  );

  if (query.isPending) {
    return (
      <View style={styles.section} testID="home-recent-loading">
        {header}
        <Skeleton variant="table" rows={RECENT_LIMIT} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.section} testID="home-recent">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('stats:home.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="home-recent-error"
        />
      </View>
    );
  }

  const rows = mergeTransferRows([...query.data.items]).slice(0, RECENT_LIMIT);

  if (rows.length === 0) {
    return (
      <View style={styles.section} testID="home-recent">
        {header}
        <ListCard style={styles.emptyCard}>
          <EmptyState
            icon="plus"
            title={t('stats:home.recent_empty')}
            primaryAction={{ label: t('stats:home.add_transaction'), onPress: onAddTransaction }}
            style={styles.emptyState}
            testID="home-recent-empty"
          />
        </ListCard>
      </View>
    );
  }

  return (
    <View style={styles.section} testID="home-recent">
      {header}
      <ListCard testID="home-recent-card">
        {rows.map((row) => {
          const tx = lead(row);
          const id = `home-recent-${rowKey(row)}`;

          // ------------------------------------------------------------- title
          let title: string;
          if (row.kind === 'pair') {
            title = t('transaction:list.row.transfer_pair', {
              from: sourceName(row.out.source_id),
              to: sourceName(row.in.source_id),
            });
          } else if (tx.kind === 'transfer') {
            const here = sourceName(tx.source_id);
            const other = tx.counterparty
              ? t('transaction:list.row.counterparty', { name: tx.counterparty })
              : null;
            if (other === null) title = here;
            else if (tx.transfer_role === 'in') {
              title = t('transaction:list.row.transfer_pair', { from: other, to: here });
            } else {
              title = t('transaction:list.row.transfer_pair', { from: here, to: other });
            }
          } else {
            title =
              tx.merchant ??
              categoryPath(tx, categoryIndex, lang) ??
              t('transaction:list.row.uncategorized');
          }

          // ---------------------------------------------------------- subtitle
          const parts =
            tx.kind === 'transfer'
              ? [tx.note, row.kind === 'pair' ? null : sourceName(tx.source_id)]
              : [categoryPath(tx, categoryIndex, lang), sourceName(tx.source_id)];
          const subtitle = parts.filter((part): part is string => Boolean(part)).join(' · ');

          // ------------------------------------------------------------ amount
          const amount =
            row.kind === 'pair'
              ? formatMoney(absMoney(row.out.amount), row.out.currency, lang)
              : formatMoney(tx.amount, tx.currency, lang);
          const converted =
            row.kind === 'pair'
              ? ''
              : formatConverted(tx.amount, tx.currency, tx.amount_base ?? 0, baseCurrency, lang);
          const amountSub =
            tx.currency !== baseCurrency && tx.amount_base === null
              ? t('transaction:list.rate_missing')
              : converted !== ''
                ? converted
                : undefined;

          return (
            <ListRow
              key={rowKey(row)}
              icon={<KindIcon kind={tx.kind} size={wide ? 36 : 34} />}
              title={title}
              subtitle={subtitle === '' ? undefined : subtitle}
              onPress={() => onPressRow(row)}
              testID={id}
              trailing={
                <View style={styles.trailing}>
                  {wide ? <KindBadge kind={tx.kind} testID={`${id}-kind`} /> : null}
                  <View style={styles.amountBlock}>
                    <Text
                      variant="subheading"
                      mono
                      weight={500}
                      tone={KIND_AMOUNT_TONE[tx.kind]}
                      numberOfLines={1}
                      style={wide ? styles.amountWide : undefined}
                      testID={`${id}-amount`}
                    >
                      {amount}
                    </Text>
                    <Text
                      variant="caption"
                      tone="muted"
                      mono
                      numberOfLines={1}
                      testID={`${id}-meta`}
                    >
                      {amountSub ?? formatDateShort(tx.occurred_at)}
                    </Text>
                  </View>
                </View>
              }
            />
          );
        })}
      </ListCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: space['2'] + 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space['3'], flexShrink: 0 },
  amountBlock: { alignItems: 'flex-end', minWidth: 96 },
  amountWide: { fontSize: 17, lineHeight: 23 },
  emptyCard: { paddingVertical: space['4'] },
  emptyState: { paddingVertical: space['5'] },
});
