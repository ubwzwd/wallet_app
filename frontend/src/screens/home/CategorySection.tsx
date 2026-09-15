/**
 * Home block 3 (screen 01, 04 §4.4, decisions §7 / §14.21): 「9 月支出 · 按分类」.
 *
 * The mockup's row is one line, not a label over a bar: a 10px colour chip, the category
 * name in a fixed column, a pill-shaped track, the share, the amount, and a chevron that
 * opens the level-2 rows indented under it. The month switcher lives in the section title
 * (decision §14.56) — it stays mounted through loading and error, because it is the only
 * way out of a month whose summary will not load.
 *
 * Bar colours come from `chart.series[0..7]`, never from the four kind colours (§6.2 rule
 * 3), so 餐饮 cannot end up looking like income. Transfers never appear: the endpoint does
 * not report them at all (decision §1). `expense_total` already has the month's refunds
 * deducted (decision §7), so a month with refunds says how much was taken off.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { StatsSummary } from '@/api/types';
import {
  currentMonth,
  isAfterMonth,
  isPositiveMoney,
  isZeroMoney,
  shiftMonth,
  sumMoney,
} from '@/domain';
import type { CategoryIndex } from '@/domain/categories';
import { useLang } from '@/i18n';
import { formatMoney, formatMonthShort } from '@/i18n/format';
import { chartSeries, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { EmptyState, Icon, ListCard, Skeleton, Text } from '@/ui';

import { CategoryRow, toCategoryItems } from './CategoryRow';

/** How many level-1 rows are drawn before the rest collapse into one "N more" row. */
export const TOP_CATEGORIES = 8;

export interface CategorySectionProps {
  query: UseQueryResult<StatsSummary>;
  /** `'YYYY-MM'` — the month in the URL. */
  month: string;
  onChangeMonth(next: string): void;
  baseCurrency: string;
  /** The category cache; supplies the level-1 classification hint the endpoint omits. */
  categoryIndex: CategoryIndex | null;
  onAddTransaction(): void;
}

/** `‹ 9 月支出 · 按分类 ›` — the switcher is part of the title (decision §14.56). */
function MonthTitle({
  month,
  onChangeMonth,
}: {
  month: string;
  onChangeMonth(next: string): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const lang = useLang();
  const wide = useIsWide();
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const nextDisabled = isAfterMonth(next, currentMonth());

  const arrow = (
    direction: 'prev' | 'next',
    target: string,
    disabled: boolean,
  ): React.JSX.Element => (
    // touch-target-exempt: a 28-wide chevron inside a title line; `hitSlop` takes it to 44.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(direction === 'prev' ? 'stats:home.month_prev' : 'stats:home.month_next')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onChangeMonth(target)}
      hitSlop={space['2']}
      testID={`home-month-${direction}`}
      style={({ pressed }) => [
        styles.arrow,
        {
          opacity: disabled ? 0.35 : 1,
          backgroundColor: pressed && !disabled ? colors['bg.hover'] : 'transparent',
        },
      ]}
    >
      <Icon
        name={direction === 'prev' ? 'chevron-left' : 'chevron-right'}
        size={18}
        color={colors[disabled ? 'fg.muted' : 'fg.secondary']}
      />
    </Pressable>
  );

  return (
    <View style={styles.titleLine}>
      {arrow('prev', prev, false)}
      <Text
        variant={wide ? 'heading' : 'subheading'}
        weight={700}
        numberOfLines={1}
        testID="home-month-label"
      >
        {t('stats:home.categories_title', { month: formatMonthShort(month, lang) })}
      </Text>
      {arrow('next', next, nextDisabled)}
    </View>
  );
}

export function CategorySection({
  query,
  month,
  onChangeMonth,
  baseCurrency,
  categoryIndex,
  onAddTransaction,
}: CategorySectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const wide = useIsWide();
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const total = query.data?.expense_total;
  // `SectionHeader` takes a plain string title; this one holds the month arrows, so the
  // row is built here with the same shape (title left, mono meta right).
  const header = (
    <View style={styles.header} testID="home-categories-header">
      <MonthTitle month={month} onChangeMonth={onChangeMonth} />
      {total === undefined ? null : (
        <Text variant="caption" tone="secondary" mono weight={500} testID="home-categories-total">
          {t('stats:home.total_amount', { amount: formatMoney(total, baseCurrency, lang) })}
        </Text>
      )}
    </View>
  );

  if (query.isPending) {
    return (
      <View style={styles.section} testID="home-summary-loading">
        {header}
        <Skeleton variant="table" rows={5} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.section} testID="home-summary">
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
  // This card only ever draws expense rows, so only expense decides whether it has anything
  // to say: a month with a salary and no spending used to fall through to a bare white
  // sliver reading 「共 ¥0.00」 with no rows under it.
  const empty = summary.expense.length === 0 && isZeroMoney(summary.expense_total);

  if (empty) {
    return (
      <View style={styles.section} testID="home-summary">
        {header}
        <ListCard style={styles.card}>
          <EmptyState
            placeholder={{ rows: 4, note: t('stats:home.month_empty_hint') }}
            title={t('stats:home.month_empty')}
            primaryAction={{ label: t('stats:home.add_transaction'), onPress: onAddTransaction }}
            style={styles.emptyState}
            testID="home-summary-empty"
          />
        </ListCard>
      </View>
    );
  }

  const items = toCategoryItems(summary.expense, categoryIndex, lang);
  const shown = items.slice(0, TOP_CATEGORIES);
  const rest = items.slice(TOP_CATEGORIES);
  const series = chartSeries(colors);

  return (
    <View style={styles.section} testID="home-summary">
      {header}

      <ListCard testID="home-categories" style={styles.card}>
        {shown.map((item, i) => (
          <CategoryRow
            key={item.code}
            item={item}
            color={series[i % series.length]}
            currency={baseCurrency}
            lang={lang}
            open={expanded === item.code}
            onToggle={() => setExpanded((cur) => (cur === item.code ? null : item.code))}
          />
        ))}
        {rest.length > 0 ? (
          <View
            style={[styles.rest, wide ? styles.restWide : null]}
            testID="home-categories-rest"
          >
            <View style={[styles.chip, { backgroundColor: colors['border.strong'] }]} />
            <Text variant="body" tone="secondary" style={styles.restLabel}>
              {t('stats:home.category_other_n', { count: rest.length })}
            </Text>
            <Text variant="body" tone="secondary" mono>
              {formatMoney(sumMoney(rest, (item) => item.amount), baseCurrency, lang)}
            </Text>
          </View>
        ) : null}
      </ListCard>

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
    </View>
  );
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: space['2'] + 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['3'],
    paddingHorizontal: space['1'],
    alignSelf: 'stretch',
  },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space['1'], flexShrink: 1 },
  arrow: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { paddingVertical: space['2'] },
  rest: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: space['3'] + 2,
    gap: space['3'],
  },
  restWide: { minHeight: 52, paddingHorizontal: space['4'] + 2, gap: space['3'] + 2 },
  chip: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  restLabel: { flex: 1 },
  emptyState: { paddingVertical: space['5'] },
});
