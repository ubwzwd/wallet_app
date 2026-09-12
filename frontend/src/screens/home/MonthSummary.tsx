/**
 * Home block 3 (04 §4.4, decisions §7 / §14.21): the month switcher, the two totals, and
 * the level-1 category ranking.
 *
 * `expense_total` already has the month's refunds deducted (decision §7), so when
 * `refund_total > 0` a small line says how much was taken off — otherwise the number looks
 * wrong to anyone who remembers the receipts. Transfers never appear: the endpoint does not
 * report them at all (decision §1). The bar colours come from `chart.series`, never from the
 * four kind colours (§6.2 rule 3) — that is `BarList`'s job.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { StatsCategoryNode, StatsSummary } from '@/api/types';
import { cmpMoney, isPositiveMoney, isZeroMoney } from '@/domain';
import type { CategoryIndex } from '@/domain/categories';
import { useLang, type Lang } from '@/i18n';
import { categoryDesc } from '@/i18n/category';
import { formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { BarList, type BarListItem, EmptyState, MonthSwitcher, Skeleton, Text } from '@/ui';

/** How many level-1 bars are drawn before the rest collapse into one "N more" row. */
export const TOP_CATEGORIES = 8;

export interface MonthSummaryProps {
  query: UseQueryResult<StatsSummary>;
  /** `'YYYY-MM'` — the month in the URL. */
  month: string;
  onChangeMonth(next: string): void;
  baseCurrency: string;
  /** The category cache; supplies the level-1 classification hint the endpoint omits. */
  categoryIndex: CategoryIndex | null;
  onAddTransaction(): void;
}

/** Category name in the active language — the stats endpoint ships both spellings. */
function nodeLabel(node: { name_zh: string; name_en: string }, lang: Lang): string {
  return lang === 'zh' ? node.name_zh : node.name_en;
}

/** Level-1 nodes as `BarList` items, biggest first, each carrying its classification hint. */
export function toBarItems(
  nodes: readonly StatsCategoryNode[],
  index: CategoryIndex | null,
  lang: Lang,
): BarListItem[] {
  return [...nodes]
    .sort((a, b) => cmpMoney(b.amount, a.amount))
    .map((node) => {
      const category = index?.byL1[node.code];
      return {
        code: node.code,
        label: nodeLabel(node, lang),
        amount: node.amount,
        share: node.share,
        desc: category ? categoryDesc(category, lang) : null,
        children: node.children.map((child) => ({
          code: child.code,
          label: nodeLabel(child, lang),
          amount: child.amount,
        })),
      };
    });
}

function Total({
  label,
  amount,
  currency,
  lang,
  tone,
  testID,
}: {
  label: string;
  amount: string;
  currency: string;
  lang: Lang;
  tone: 'expense' | 'income';
  testID: string;
}): React.JSX.Element {
  return (
    <View style={{ flex: 1, gap: space['1'], minWidth: 120 }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="title" tone={tone} mono numberOfLines={1} testID={testID}>
        {formatMoney(amount, currency, lang)}
      </Text>
    </View>
  );
}

export function MonthSummary({
  query,
  month,
  onChangeMonth,
  baseCurrency,
  categoryIndex,
  onAddTransaction,
}: MonthSummaryProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();

  // The switcher stays mounted through loading and error states: it is the only way out
  // of a month whose summary will not load.
  const header = (
    <View style={{ gap: space['2'] }}>
      <Text variant="heading" accessibilityRole="header">
        {t('stats:home.month_summary_title')}
      </Text>
      <MonthSwitcher value={month} onChange={onChangeMonth} testID="home-month" />
    </View>
  );

  if (query.isPending) {
    return (
      <View style={{ gap: space['3'] }} testID="home-summary-loading">
        {header}
        <Skeleton variant="card" height={36} />
        <Skeleton variant="table" rows={4} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={{ gap: space['3'] }} testID="home-summary">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('stats:home.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="home-summary-error"
        />
      </View>
    );
  }

  const summary = query.data;
  const empty =
    summary.expense.length === 0 &&
    summary.income.length === 0 &&
    isZeroMoney(summary.expense_total) &&
    isZeroMoney(summary.income_total);

  if (empty) {
    return (
      <View style={{ gap: space['3'] }} testID="home-summary">
        {header}
        <EmptyState
          icon="info"
          title={t('stats:home.month_empty')}
          primaryAction={{ label: t('stats:home.add_transaction'), onPress: onAddTransaction }}
          testID="home-summary-empty"
        />
      </View>
    );
  }

  return (
    <View style={{ gap: space['3'] }} testID="home-summary">
      {header}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['3'] }}>
        <Total
          label={t('stats:home.expense')}
          amount={summary.expense_total}
          currency={baseCurrency}
          lang={lang}
          tone="expense"
          testID="home-expense-total"
        />
        <Total
          label={t('stats:home.income')}
          amount={summary.income_total}
          currency={baseCurrency}
          lang={lang}
          tone="income"
          testID="home-income-total"
        />
      </View>

      {isPositiveMoney(summary.refund_total) ? (
        <Text variant="caption" tone="muted" testID="home-refund-note">
          {t('stats:home.refund_deducted', {
            amount: formatMoney(summary.refund_total, baseCurrency, lang),
          })}
        </Text>
      ) : null}

      {summary.rate_missing_count > 0 ? (
        <Text variant="caption" tone="warning" testID="home-summary-rate-missing">
          {t('stats:home.rate_missing', { count: summary.rate_missing_count })}
        </Text>
      ) : null}

      <BarList
        items={toBarItems(summary.expense, categoryIndex, lang)}
        currency={baseCurrency}
        max={TOP_CATEGORIES}
        testID="home-categories"
      />
    </View>
  );
}
