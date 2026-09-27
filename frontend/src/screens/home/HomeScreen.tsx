/**
 * `/home` — the current ledger's home page (screen 01 / 15, 04 §4.4, decisions §7 / §8 /
 * §14.50 / §14.56 / §14.66).
 *
 * The mockup's composition: a header carrying the net worth and the month's two totals,
 * then a 1.12fr / 1fr grid — accounts over the 12-month chart on the left, the month's
 * categories over the five newest transactions on the right. Narrow screens stack the same
 * five blocks. Each block owns its query, its skeleton and its retry, so a failing
 * `/stats/summary` still leaves the balances readable.
 *
 * The month is browsing state (decision §14.66 e): the switcher in the category title and
 * the chart both write the ledger's `'home.month'` view state, never the address. So going
 * to the list and back keeps the month, the back button never steps through months, each
 * ledger keeps its own, and a reload starts over at this month.
 *
 * Refreshing is offered twice and without a platform switch: the header button is what a
 * mouse reaches for, the pull-to-refresh is what a thumb reaches for, and both refetch the
 * same queries.
 *
 * Accounts belong to people (decision §14.62): the net worth and the 「账户」 card are mine
 * (`GET /sources`, every ledger's entries on my accounts), while the ledger's own account
 * list (`GET /ledgers/{id}/sources`) names the accounts in 「最近」 and says whether anything
 * here can be booked onto at all. A ledger with no entries yet shows the guide (screen 15);
 * its 「建一个账户」 step only appears while no account is usable here.
 */
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Uuid } from '@/api/types';
import { currentMonth, isAfterMonth, routes, type ListRow as TxListRow } from '@/domain';
import { useLang } from '@/i18n';
import { formatAmountPlain, formatMonthShort } from '@/i18n/format';
import {
  TREND_MONTHS,
  useCategories,
  useLedgerSources,
  useMySources,
  useStatsSummary,
  useStatsTrend,
  useTransactions,
} from '@/queries';
import { useOpenTransactions } from '@/screens/transactions/useTxFilters';
import { useLedgerContext, useLedgerViewState } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Page, Text, TintCard } from '@/ui';

import { AccountsSection } from './AccountsSection';
import { CategorySection } from './CategorySection';
import {
  EmptyHeaderActions,
  EmptyLedgerCard,
  EmptyMonthCard,
  EmptyNetWorthHint,
  EmptyTransactionsCard,
} from './EmptyLedger';
import { NetWorthHeader } from './NetWorthHeader';
import { RECENT_LIMIT, RecentSection } from './RecentSection';
import { TrendSection } from './TrendSection';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The view-state key of the month the home page shows (decision §14.66 e). */
export const HOME_MONTH_KEY = 'home.month';

/**
 * The month the page shows: the stored one when it is a real month at or before `now`, the
 * current month otherwise (nothing stored yet, or a month that has since become the
 * future — the app left open across midnight at a month's end still lands somewhere sane).
 */
export function resolveMonth(raw: string | null | undefined, now: string = currentMonth()): string {
  if (typeof raw !== 'string' || !MONTH_RE.test(raw)) return now;
  return isAfterMonth(raw, now) ? now : raw;
}

export default function HomeScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const lang = useLang();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const openTransactions = useOpenTransactions();

  const [storedMonth, setStoredMonth] = useLedgerViewState<string | null>(HOME_MONTH_KEY, null);
  const month = resolveMonth(storedMonth);

  // My accounts, archived ones included: the header says how many it is leaving out
  // (decision §14.50) — the totals themselves come from the server.
  const sources = useMySources({ include_archived: true });
  // What this ledger can see, under the key the entry form and the list share.
  const ledgerSources = useLedgerSources(ledgerId, { include_archived: true });
  const summary = useStatsSummary(ledgerId, month);
  const trend = useStatsTrend(ledgerId, TREND_MONTHS);
  const recent = useTransactions(ledgerId, { limit: RECENT_LIMIT });
  const categories = useCategories();

  const setMonth = React.useCallback(
    (next: string): void => setStoredMonth(next),
    [setStoredMonth],
  );

  const refetchSources = sources.refetch;
  const refetchLedgerSources = ledgerSources.refetch;
  const refetchSummary = summary.refetch;
  const refetchTrend = trend.refetch;
  const refetchRecent = recent.refetch;
  const refreshAll = React.useCallback((): void => {
    void refetchSources();
    void refetchLedgerSources();
    void refetchSummary();
    void refetchTrend();
    void refetchRecent();
  }, [refetchSources, refetchLedgerSources, refetchSummary, refetchTrend, refetchRecent]);

  const refreshing =
    sources.isRefetching ||
    ledgerSources.isRefetching ||
    summary.isRefetching ||
    trend.isRefetching ||
    recent.isRefetching;

  const goSources = React.useCallback(
    () => router.navigate(routes.accounts(true) as Href),
    [router],
  );
  const goSourceList = React.useCallback(
    () => router.navigate(routes.accounts() as Href),
    [router],
  );
  const goNewSource = React.useCallback(
    () => router.navigate(routes.accountNew(ledgerId) as Href),
    [ledgerId, router],
  );
  // Both open the list showing what they name — one account's entries, or everything — in
  // place of whatever filters it was last left with (decision §14.66 e).
  const goSourceTransactions = React.useCallback(
    (sourceId: Uuid): void => openTransactions({ source_id: [sourceId] }),
    [openTransactions],
  );
  const goTransactions = React.useCallback(() => openTransactions(), [openTransactions]);
  const goNewExpense = React.useCallback(
    () => router.navigate(routes.transactionNew({ kind: 'expense' }) as Href),
    [router],
  );
  const goNewTransaction = React.useCallback(
    () => router.navigate(routes.transactionNew() as Href),
    [router],
  );
  const goImport = React.useCallback(() => router.navigate(routes.importsNew() as Href), [router]);
  const goLedgerSettings = React.useCallback(
    () => router.navigate(routes.ledgerSettings() as Href),
    [router],
  );
  const goRow = React.useCallback(
    (row: TxListRow) =>
      router.navigate(
        (row.kind === 'pair' ? routes.transfer(row.pairId) : routes.transaction(row.tx.id)) as Href,
      ),
    [router],
  );

  const ledgerSourceItems = ledgerSources.data?.items ?? [];
  // Both stay false until their data is in: an empty ledger must not flash the guide at a
  // user who simply has a slow connection. 「最近」 already carries the ledger's entry count,
  // so the guide costs no request of its own; a placeholder page left over from another
  // ledger does not count.
  const noEntries =
    recent.data !== undefined && !recent.isPlaceholderData && recent.data.total === 0;
  // Nothing to book onto here: none of my own accounts is live, and no member shared one in.
  const needsAccount = ledgerSources.data
    ? !ledgerSourceItems.some((s) => s.usable)
    : false;
  const emptyLedger = noEntries && ledgerSources.data !== undefined;
  // Screen 15's grey zero: nothing of mine to count yet, not a figure to check.
  const mutedNetWorth = emptyLedger && needsAccount;
  const myCurrency = sources.data?.base_currency ?? baseCurrency;

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
    emptyLedger || summary.data === undefined ? undefined : (
      <>
        {/* 屏幕稿 01 writes the two tiles bare — 「6,842.50」, 「18,000.00」 — because the
            net-worth line right above them already says 「折算 CNY」 (§14.59a). */}
        {tile(
          'expense',
          formatAmountPlain(summary.data.expense_total, baseCurrency),
          t('stats:home.month_expense', { month: shortMonth }),
          'home-expense-total',
        )}
        {tile(
          'income',
          formatAmountPlain(summary.data.income_total, baseCurrency),
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

  // Screen 15 A: the ledger has no entry yet. Wide puts the two ways forward in the header's
  // action area — the first account while none is usable here, the first entry otherwise;
  // narrow puts the account button inside the net-worth card.
  const header = (
    <NetWorthHeader
      query={sources}
      baseCurrency={myCurrency}
      totals={totals}
      muted={mutedNetWorth}
      onPressArchived={goSources}
      actions={
        // 04 §4.4 wants refresh reachable on every frame: an empty wide ledger gets the two
        // ways forward *and* the refresh icon, not one instead of the other (pull-to-refresh
        // does nothing with a mouse).
        emptyLedger && wide ? (
          <EmptyHeaderActions
            needsAccount={needsAccount}
            onInvite={goLedgerSettings}
            onAddSource={goNewSource}
            onAddTransaction={goNewTransaction}
            refresh={refresh}
          />
        ) : (
          refresh
        )
      }
      hint={
        mutedNetWorth && !wide ? <EmptyNetWorthHint onAddSource={goNewSource} /> : undefined
      }
    />
  );

  const accounts = (
    <AccountsSection
      query={sources}
      baseCurrency={myCurrency}
      onManage={goSourceList}
      onCreate={goNewSource}
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
      sources={ledgerSourceItems}
      baseCurrency={baseCurrency}
      categoryIndex={categories.index}
      onSeeAll={goTransactions}
      onPressRow={goRow}
      onAddTransaction={goNewExpense}
    />
  );

  let body: React.ReactNode;
  if (emptyLedger) {
    body = wide ? (
      <EmptyLedgerCard {...emptyActions} needsAccount={needsAccount} />
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
});
