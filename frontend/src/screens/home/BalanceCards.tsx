/**
 * Home block 2 (04 §4.4): one card per account — a horizontally scrolling row on narrow
 * layouts, a wrapping grid on wide ones.
 *
 * Archived accounts are never shown here (they are only counted in block 1's "not counting
 * N archived accounts" line). A card whose account is not in the ledger's base currency
 * carries the converted amount on a second line; `balance_base === null` says "no rate yet"
 * rather than reading as zero — both come from `MoneyText`.
 */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { FinanceSource, Paged, Uuid } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Card, EmptyState, Icon, MoneyText, SOURCE_TYPE_ICON, Skeleton, Text } from '@/ui';

export interface BalanceCardsProps {
  query: UseQueryResult<Paged<FinanceSource>>;
  baseCurrency: string;
  /** Opens the transaction list pre-filtered to that account. */
  onPressSource(sourceId: Uuid): void;
  onAddSource(): void;
}

const CARD_WIDTH = 200;
const SKELETON_CARDS = 3;

function BalanceCard({
  source,
  baseCurrency,
  onPress,
}: {
  source: FinanceSource;
  baseCurrency: string;
  onPress(): void;
}): React.JSX.Element {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={source.name}
      onPress={onPress}
      testID={`home-balance-${source.id}`}
      style={({ pressed }) => ({
        width: CARD_WIDTH,
        minHeight: 44, // 04 §6.6: no touch target smaller than 44×44
        borderRadius: radius.lg,
        backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
      })}
    >
      <Card variant="outlined" style={{ gap: space['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          <Icon name={SOURCE_TYPE_ICON[source.type]} size={18} color={colors['fg.secondary']} />
          <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
            {source.name}
          </Text>
        </View>
        <MoneyText
          amount={source.balance}
          currency={source.default_currency}
          base={{ amount_base: source.balance_base, base_currency: baseCurrency }}
          testID={`home-balance-amount-${source.id}`}
        />
      </Card>
    </Pressable>
  );
}

export function BalanceCards({
  query,
  baseCurrency,
  onPressSource,
  onAddSource,
}: BalanceCardsProps): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();

  const header = (
    <Text variant="heading" accessibilityRole="header">
      {t('stats:home.balances_title')}
    </Text>
  );

  if (query.isPending) {
    return (
      <View style={{ gap: space['2'] }} testID="home-balances-loading">
        {header}
        <View style={{ flexDirection: 'row', gap: space['3'] }}>
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <Skeleton key={i} variant="card" height={28} style={{ width: CARD_WIDTH }} />
          ))}
        </View>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={{ gap: space['2'] }} testID="home-balances">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('stats:home.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="home-balances-error"
        />
      </View>
    );
  }

  const active = query.data.items.filter((source) => !source.archived);

  if (active.length === 0) {
    return (
      <View style={{ gap: space['2'] }} testID="home-balances">
        {header}
        <EmptyState
          icon="wallet"
          title={t('stats:home.balances_empty')}
          primaryAction={{ label: t('stats:home.add_source'), onPress: onAddSource }}
          testID="home-balances-empty"
        />
      </View>
    );
  }

  const cards = active.map((source) => (
    <BalanceCard
      key={source.id}
      source={source}
      baseCurrency={baseCurrency}
      onPress={() => onPressSource(source.id)}
    />
  ));

  return (
    <View style={{ gap: space['2'] }} testID="home-balances">
      {header}
      {wide ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['3'] }}>{cards}</View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space['3'], paddingRight: space['2'] }}
          testID="home-balances-scroller"
        >
          {cards}
        </ScrollView>
      )}
    </View>
  );
}
