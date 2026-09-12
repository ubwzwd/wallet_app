/**
 * `/l/:ledgerId?month=YYYY-MM` — the home page (04 §4.4, decisions §7 / §8 / §14.50).
 *
 * Four blocks, three queries, no coupling: accounts, the month's summary and the 12-month
 * trend each carry their own skeleton and their own retry, so a failing `/stats/summary`
 * still leaves the balances readable. The month lives in the URL — the switcher and the
 * trend chart both write it there, which makes a month shareable and the back button right.
 *
 * Refreshing is offered twice on purpose and without a platform switch: the header button
 * is what a mouse reaches for, the pull-to-refresh is what a thumb reaches for, and both
 * refetch the same three queries.
 */
import React from 'react';
import { RefreshControl, ScrollView, View, type ViewStyle } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Uuid } from '@/api/types';
import { currentMonth, isAfterMonth, routes } from '@/domain';
import { useTopBar } from '@/navigation';
import { TREND_MONTHS, useCategories, useSources, useStatsSummary, useStatsTrend } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Page, Text } from '@/ui';

import { BalanceCards } from './BalanceCards';
import { MonthSummary } from './MonthSummary';
import { NetWorthTiles } from './NetWorthTiles';
import { OnboardingHint } from './OnboardingHint';
import { TrendSection } from './TrendSection';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The month the page shows: `?month=` when it is a real month at or before `now`, the
 * current month otherwise. A future month is clamped rather than refused — there is
 * nothing to summarise past today, and a hand-edited URL should still land somewhere sane.
 */
export function resolveMonth(
  raw: string | string[] | undefined,
  now: string = currentMonth(),
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !MONTH_RE.test(value)) return now;
  return isAfterMonth(value, now) ? now : value;
}

export default function HomeScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const l = routes.l(ledgerId);

  useTopBar(t('common:nav.home'));

  const params = useLocalSearchParams<{ month?: string }>();
  const month = resolveMonth(params.month);

  // Archived accounts are asked for: block 1 needs to say how many it is leaving out
  // (decision §14.50), and `sumSources` is the one that drops them from the totals.
  const sources = useSources(ledgerId, { include_archived: true });
  const summary = useStatsSummary(ledgerId, month);
  const trend = useStatsTrend(ledgerId, TREND_MONTHS);
  const categories = useCategories();

  const setMonth = React.useCallback(
    (next: string): void => router.setParams({ month: next }),
    [router],
  );

  const refetchSources = sources.refetch;
  const refetchSummary = summary.refetch;
  const refetchTrend = trend.refetch;
  const refreshAll = React.useCallback((): void => {
    void refetchSources();
    void refetchSummary();
    void refetchTrend();
  }, [refetchSources, refetchSummary, refetchTrend]);

  const refreshing = sources.isRefetching || summary.isRefetching || trend.isRefetching;

  const goSources = React.useCallback(
    () => router.navigate(l.sources(true) as Href),
    [l, router],
  );
  const goNewSource = React.useCallback(
    () => router.navigate(l.sourceNew() as Href),
    [l, router],
  );
  const goSourceTransactions = React.useCallback(
    (sourceId: Uuid) => router.navigate(l.transactions({ source_id: [sourceId] }) as Href),
    [l, router],
  );
  const goNewExpense = React.useCallback(
    () => router.navigate(l.transactionNew({ kind: 'expense' }) as Href),
    [l, router],
  );

  const activeSourceCount = sources.data?.items.filter((s) => !s.archived).length;

  const column: ViewStyle = wide
    ? { flex: 1, gap: space['4'] }
    : { width: '100%', gap: space['4'] };

  const left = (
    <View style={column}>
      <NetWorthTiles query={sources} baseCurrency={baseCurrency} onPressArchived={goSources} />
      <BalanceCards
        query={sources}
        baseCurrency={baseCurrency}
        onPressSource={goSourceTransactions}
        onAddSource={goNewSource}
      />
    </View>
  );

  const right = (
    <View style={column}>
      <MonthSummary
        query={summary}
        month={month}
        onChangeMonth={setMonth}
        baseCurrency={baseCurrency}
        categoryIndex={categories.index}
        onAddTransaction={goNewExpense}
      />
      <TrendSection
        query={trend}
        baseCurrency={baseCurrency}
        month={month}
        onPressMonth={setMonth}
      />
    </View>
  );

  return (
    <Page scroll={false} testID="home-screen">
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: space['4'], paddingBottom: space['6'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
        testID="home-scroll"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          {/* The narrow layout already carries the title in the top bar (04 §1.4). */}
          {wide ? (
            <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
              {t('common:nav.home')}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="refresh-cw"
            iconOnly
            accessibilityLabel={t('stats:home.refresh')}
            onPress={refreshAll}
            testID="home-refresh"
          />
        </View>

        <OnboardingHint sourceCount={activeSourceCount} onAddSource={goNewSource} />

        {wide ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space['4'] }}>
            {left}
            {right}
          </View>
        ) : (
          <>
            {left}
            {right}
          </>
        )}
      </ScrollView>
    </Page>
  );
}
