/**
 * Home block 4 (screen 01, 04 §4.4, decisions §7 / §14.52 B20 / A21): 「近 12 个月支出」.
 *
 * Twelve columns, expenses only — income deliberately stays out. The monthly average and
 * the peak are the section header's meta (decision §14.52 A21, confirmed 2026-09-11); both
 * are computed with the decimal money helpers, never with floats. The narrow header keeps
 * the average alone, as the mockup draws it. Tapping a column switches the month above it.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { Money, StatsTrend } from '@/api/types';
import { cmpMoney, formatMoney4, parseMoney } from '@/domain';
import { useLang } from '@/i18n';
import { formatAmountPlain, formatMonthShort } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  BarChart,
  type BarChartPoint,
  EmptyState,
  ListCard,
  SectionHeader,
  Skeleton,
  Text,
} from '@/ui';

export interface TrendSectionProps {
  query: UseQueryResult<StatsTrend>;
  baseCurrency: string;
  /** The month the page is showing; drawn as the solid column. */
  month: string;
  onPressMonth(month: string): void;
}

export interface TrendStats {
  /** Sum of the series divided by its length — twelve months, so this is "÷ 12". */
  average: Money;
  peak: Money;
  peakMonth: string | null;
}

export function trendStats(months: readonly BarChartPoint[]): TrendStats {
  if (months.length === 0) return { average: '0.0000', peak: '0.0000', peakMonth: null };
  const total = months.reduce((acc, m) => acc + parseMoney(m.expense), 0n);
  let peak = months[0];
  for (const m of months) if (cmpMoney(m.expense, peak.expense) > 0) peak = m;
  return {
    average: formatMoney4(total / BigInt(months.length)),
    peak: peak.expense,
    peakMonth: peak.month,
  };
}

export function TrendSection({
  query,
  baseCurrency,
  month,
  onPressMonth,
}: TrendSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();

  const stats = query.data ? trendStats(query.data.months) : null;

  const meta =
    stats === null || stats.peakMonth === null ? undefined : (
      <View style={styles.meta}>
        <Text variant="caption" tone="secondary" mono weight={500} testID="home-trend-average">
          {/* 屏幕稿 01 writes 「月均 6,220 · 峰值 8,100（4 月）」 bare (§14.59a). */}
          {t('stats:home.trend_average', {
            amount: formatAmountPlain(stats.average, baseCurrency),
          })}
        </Text>
        {wide ? (
          <>
            <Text variant="caption" tone="muted">
              ·
            </Text>
            <Text variant="caption" tone="secondary" mono weight={500} testID="home-trend-peak">
              {t('stats:home.trend_peak', {
                amount: formatAmountPlain(stats.peak, baseCurrency),
                month: formatMonthShort(stats.peakMonth, lang),
              })}
            </Text>
          </>
        ) : null}
      </View>
    );

  const header = (
    <SectionHeader title={t('stats:home.trend_title')} meta={meta} testID="home-trend-header" />
  );

  if (query.isPending) {
    return (
      <View style={styles.section} testID="home-trend-loading">
        {header}
        <Skeleton variant="card" height={wide ? 160 : 100} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.section} testID="home-trend">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('stats:home.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="home-trend-error"
        />
      </View>
    );
  }

  return (
    <View style={styles.section} testID="home-trend">
      {header}
      <ListCard style={wide ? styles.cardWide : styles.cardNarrow}>
        <BarChart
          months={query.data.months}
          currency={baseCurrency}
          selected={month}
          onPressMonth={onPressMonth}
          testID="home-trend-chart"
        />
      </ListCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: space['2'] + 2 },
  meta: { flexDirection: 'row', alignItems: 'baseline', gap: space['2'], flexShrink: 1 },
  cardWide: { paddingHorizontal: space['5'], paddingVertical: space['4'] },
  cardNarrow: { paddingHorizontal: space['3'] + 2, paddingVertical: space['3'] },
});
