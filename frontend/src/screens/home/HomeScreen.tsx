/**
 * `/l/:ledgerId?month=YYYY-MM` — the home page (screen 01 / 15, 04 §4.4, decisions §7 / §8
 * / §14.50 / §14.56).
 *
 * The mockup's composition: a header carrying the net worth and the month's two totals,
 * then a 1.12fr / 1fr grid — accounts over the 12-month chart on the left, the month's
 * categories over the five newest transactions on the right. Narrow screens stack the same
 * five blocks. Each block owns its query, its skeleton and its retry, so a failing
 * `/stats/summary` still leaves the balances readable.
 *
 * The month lives in the URL: the switcher in the category title and the chart both write
 * it there, which makes a month shareable and the back button right.
 *
 * Refreshing is offered twice and without a platform switch: the header button is what a
 * mouse reaches for, the pull-to-refresh is what a thumb reaches for, and both refetch the
 * same four queries.
 */
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Uuid } from '@/api/types';
import { currentMonth, isAfterMonth, routes, type ListRow as TxListRow } from '@/domain';
import { useLang } from '@/i18n';
import { formatMoney, formatMonthShort } from '@/i18n/format';
import {
  TREND_MONTHS,
  useCategories,
  useSources,
  useStatsSummary,
  useStatsTrend,
  useTransactions,
} from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Page, Text, TintCard } from '@/ui';

import { AccountsSection } from './AccountsSection';
import { CategorySection } from './CategorySection';
import { EmptyLedgerCard, EmptyMonthCard, EmptyTransactionsCard } from './EmptyLedger';
import { NetWorthHeader } from './NetWorthHeader';
import { RECENT_LIMIT, RecentSection } from './RecentSection';
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
  const lang = useLang();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const l = routes.l(ledgerId);

  const params = useLocalSearchParams<{ month?: string }>();
  const month = resolveMonth(params.month);

  // Archived accounts are asked for: the header needs to say how many it is leaving out
  // (decision §14.50), and `sumSources` is the one that drops them from the totals.
  const sources = useSources(ledgerId, { include_archived: true });
  const summary = useStatsSummary(ledgerId, month);
  const trend = useStatsTrend(ledgerId, TREND_MONTHS);
  const recent = useTransactions(ledgerId, { limit: RECENT_LIMIT });
  const categories = useCategories();

  const setMonth = React.useCallback(
    (next: string): void => router.setParams({ month: next }),
    [router],
  );

  const refetchSources = sources.refetch;
  const refetchSummary = summary.refetch;
  const refetchTrend = trend.refetch;
  const refetchRecent = recent.refetch;
  const refreshAll = React.useCallback((): void => {
    void refetchSources();
    void refetchSummary();
    void refetchTrend();
    void refetchRecent();
  }, [refetchSources, refetchSummary, refetchTrend, refetchRecent]);

  const refreshing =
    sources.isRefetching || summary.isRefetching || trend.isRefetching || recent.isRefetching;

  const goSources = React.useCallback(
    () => router.navigate(l.sources(true) as Href),
    [l, router],
  );
  const goSourceList = React.useCallback(() => router.navigate(l.sources() as Href), [l, router]);
  const goNewSource = React.useCallback(() => router.navigate(l.sourceNew() as Href), [l, router]);
  const goSourceTransactions = React.useCallback(
    (sourceId: Uuid) => router.navigate(l.transactions({ source_id: [sourceId] }) as Href),
    [l, router],
  );
  const goTransactions = React.useCallback(
    () => router.navigate(l.transactions() as Href),
    [l, router],
  );
  const goNewExpense = React.useCallback(
    () => router.navigate(l.transactionNew({ kind: 'expense' }) as Href),
    [l, router],
  );
  const goImport = React.useCallback(() => router.navigate(l.importsNew() as Href), [l, router]);
  const goLedgerSettings = React.useCallback(
    () => router.navigate(l.settings() as Href),
    [l, router],
  );
  const goRow = React.useCallback(
    (row: TxListRow) =>
      router.navigate(
        (row.kind === 'pair' ? l.transfer(row.pairId) : l.transaction(row.tx.id)) as Href,
      ),
    [l, router],
  );

  const sourceItems = sources.data?.items ?? [];
  // `undefined` while the list is still loading: an empty ledger must not flash the
  // onboarding card at a user who simply has a slow connection.
  const noAccounts = sources.data ? sourceItems.every((s) => s.archived) : false;

  const shortMonth = formatMonthShort(month, lang);
  // `TintCard`'s own `value` is the wide 22/28 step; the mockup's narrow tile is 17/24, so
  // the number is passed as a child and painted in the tile's own tone.
  const tile = (
    tone: 'expense' | 'income',
    amount: string,
    label: string,
    testID: string,
  ): React.JSX.Element => (
    <TintCard
      tone={tone}
      icon={tone === 'expense' ? 'arrow-down' : 'arrow-up'}
      label={label}
      style={wide ? styles.tileWide : styles.tileNarrow}
      testID={testID}
    >
      <Text
        variant="heading"
        mono
        weight={500}
        tone={tone}
        numberOfLines={1}
        adjustsFontSizeToFit
        style={wide ? styles.tileValueWide : styles.tileValueNarrow}
      >
        {amount}
      </Text>
    </TintCard>
  );
  const totals =
    noAccounts || summary.data === undefined ? undefined : (
      <>
        {tile(
          'expense',
          formatMoney(summary.data.expense_total, baseCurrency, lang),
          t('stats:home.month_expense', { month: shortMonth }),
          'home-expense-total',
        )}
        {tile(
          'income',
          formatMoney(summary.data.income_total, baseCurrency, lang),
          t('stats:home.month_income', { month: shortMonth }),
          'home-income-total',
        )}
      </>
    );

  const refresh = (
    <Button
      variant="ghost"
      size="sm"
      icon="refresh-cw"
      iconOnly
      accessibilityLabel={t('stats:home.refresh')}
      onPress={refreshAll}
      testID="home-refresh"
    />
  );

  const emptyActions = {
    onAddSource: goNewSource,
    onAddTransaction: goNewExpense,
    onImport: goImport,
    onInvite: goLedgerSettings,
  };

  // Screen 15 A: the ledger has no account yet. Wide puts the two ways forward in the
  // header's action area; narrow puts the account button inside the net-worth card.
  const header = (
    <NetWorthHeader
      query={sources}
      baseCurrency={baseCurrency}
      totals={totals}
      muted={noAccounts}
      onPressArchived={goSources}
      actions={
        noAccounts && wide ? (
          <>
            <Button
              label={t('stats:home.empty.invite')}
              variant="secondary"
              icon="users"
              onPress={goLedgerSettings}
              testID="home-empty-invite"
            />
            <Button
              label={t('stats:home.empty.create_source')}
              icon="wallet"
              onPress={goNewSource}
              testID="home-empty-source"
            />
          </>
        ) : (
          refresh
        )
      }
      hint={
        noAccounts && !wide ? (
          <View style={styles.hint}>
            <Text variant="body" tone="muted">
              {t('stats:home.empty.net_worth_hint')}
            </Text>
            <Button
              label={t('stats:home.empty.create_source')}
              icon="wallet"
              size="lg"
              fullWidth
              onPress={goNewSource}
              testID="home-empty-source"
            />
          </View>
        ) : undefined
      }
    />
  );

  const accounts = (
    <AccountsSection
      query={sources}
      baseCurrency={baseCurrency}
      onManage={goSourceList}
      onPressSource={goSourceTransactions}
    />
  );
  const categoriesBlock = (
    <CategorySection
      query={summary}
      month={month}
      onChangeMonth={setMonth}
      baseCurrency={baseCurrency}
      categoryIndex={categories.index}
      onAddTransaction={goNewExpense}
    />
  );
  const trendBlock = (
    <TrendSection query={trend} baseCurrency={baseCurrency} month={month} onPressMonth={setMonth} />
  );
  const recentBlock = (
    <RecentSection
      query={recent}
      sources={sourceItems}
      baseCurrency={baseCurrency}
      categoryIndex={categories.index}
      onSeeAll={goTransactions}
      onPressRow={goRow}
      onAddTransaction={goNewExpense}
    />
  );

  let body: React.ReactNode;
  if (noAccounts) {
    body = wide ? (
      <EmptyLedgerCard {...emptyActions} />
    ) : (
      <>
        <EmptyMonthCard />
        <EmptyTransactionsCard
          onAddTransaction={goNewExpense}
          onImport={goImport}
          onInvite={goLedgerSettings}
        />
      </>
    );
  } else if (wide) {
    body = (
      <View style={styles.grid}>
        <View style={styles.columnLeft}>
          {accounts}
          {trendBlock}
        </View>
        <View style={styles.columnRight}>
          {categoriesBlock}
          {recentBlock}
        </View>
      </View>
    );
  } else {
    body = (
      <>
        {accounts}
        {categoriesBlock}
        {trendBlock}
        {recentBlock}
      </>
    );
  }

  return (
    <Page scroll={false} testID="home-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={wide ? styles.contentWide : styles.contentNarrow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
        testID="home-scroll"
      >
        {header}
        {body}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  contentWide: { gap: space['6'], paddingBottom: space['6'] },
  contentNarrow: { gap: space['3'], paddingBottom: space['6'] },
  grid: { flexDirection: 'row', alignItems: 'flex-start', gap: space['6'] },
  columnLeft: { flex: 1.12, minWidth: 0, gap: space['6'] },
  columnRight: { flex: 1, minWidth: 0, gap: space['6'] },
  tileWide: { minWidth: 170 },
  tileNarrow: { flex: 1, minWidth: 0, paddingHorizontal: space['3'] },
  tileValueWide: { fontSize: 22, lineHeight: 28 },
  tileValueNarrow: { fontSize: 17, lineHeight: 24 },
  hint: { gap: space['3'], marginTop: space['2'] },
});
