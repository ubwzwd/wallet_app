/**
 * Home block 4 (04 §4.4, decisions §7 / §14.52 B20 / A21): the 12-month expense trend.
 *
 * One line, expenses only — income deliberately stays out (two lines plus a legend do not
 * fit). The monthly average and the peak are kept as two small figures in the block's top
 * right (decision §14.52 A21, confirmed 2026-09-11); both are computed with the decimal
 * money helpers, never with floats. Tapping a month switches the summary block above to it.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { Money, StatsTrend } from '@/api/types';
import { cmpMoney, formatMoney4, parseMoney } from '@/domain';
import { useLang } from '@/i18n';
import { formatMoney, formatMonthShort } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { EmptyState, Skeleton, Text, TrendChart, type TrendPoint } from '@/ui';

export interface TrendSectionProps {
  query: UseQueryResult<StatsTrend>;
  baseCurrency: string;
  /** The month the summary block is showing; drawn with a larger dot. */
  month: string;
  onPressMonth(month: string): void;
}

export interface TrendStats {
  /** Sum of the series divided by its length — twelve months, so this is "÷ 12". */
  average: Money;
  peak: Money;
  peakMonth: string | null;
}

export function trendStats(months: readonly TrendPoint[]): TrendStats {
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

  const title = (
    <Text variant="heading" accessibilityRole="header">
      {t('stats:home.trend_title')}
    </Text>
  );

  if (query.isPending) {
    return (
      <View style={{ gap: space['2'] }} testID="home-trend-loading">
        {title}
        <Skeleton variant="card" height={140} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={{ gap: space['2'] }} testID="home-trend">
        {title}
        <EmptyState
          icon="alert-triangle"
          title={t('stats:home.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="home-trend-error"
        />
      </View>
    );
  }

  const months = query.data.months;
  const stats = trendStats(months);

  return (
    <View style={{ gap: space['2'] }} testID="home-trend">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: space['2'],
        }}
      >
        <View style={{ flex: 1, minWidth: 140 }}>{title}</View>
        {stats.peakMonth !== null ? (
          <View style={{ flexDirection: 'row', gap: space['2'], flexWrap: 'wrap' }}>
            <Text variant="caption" tone="secondary" mono testID="home-trend-average">
              {t('stats:home.trend_average', {
                amount: formatMoney(stats.average, baseCurrency, lang),
              })}
            </Text>
            <Text variant="caption" tone="secondary" mono testID="home-trend-peak">
              {t('stats:home.trend_peak', {
                amount: formatMoney(stats.peak, baseCurrency, lang),
                month: formatMonthShort(stats.peakMonth, lang),
              })}
            </Text>
          </View>
        ) : null}
      </View>

      <TrendChart
        months={months}
        currency={baseCurrency}
        selected={month}
        onPressMonth={onPressMonth}
        testID="home-trend-chart"
      />
    </View>
  );
}
