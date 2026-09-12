/**
 * Home block 1 (04 §4.4, decisions §7 / §14.50): assets / liabilities / net worth.
 *
 * The three numbers are summed locally from `GET /ledgers/{id}/sources` — no extra
 * endpoint — by `sumSources`, which is the one place that knows the rules: credit cards
 * are liabilities, archived accounts do not count at all, and an account whose
 * `balance_base` is `null` is counted as "can't be converted" instead of being silently
 * read as zero. Liabilities are stored negative and shown as a positive "owed" figure.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { FinanceSource, Paged } from '@/api/types';
import { absMoney, sumSources } from '@/domain';
import { useLang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { EmptyState, Skeleton, StatTile, Text } from '@/ui';

export interface NetWorthTilesProps {
  query: UseQueryResult<Paged<FinanceSource>>;
  baseCurrency: string;
  /** Opens the account list with the archived group expanded. */
  onPressArchived(): void;
}

const TILE_COUNT = 3;

export function NetWorthTiles({
  query,
  baseCurrency,
  onPressArchived,
}: NetWorthTilesProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();

  if (query.isPending) {
    return (
      <View style={{ flexDirection: 'row', gap: space['3'] }} testID="home-networth-loading">
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <Skeleton key={i} variant="card" height={32} style={{ flex: 1 }} />
        ))}
      </View>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        icon="alert-triangle"
        title={t('stats:home.error_retry')}
        primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
        testID="home-networth-error"
      />
    );
  }

  const summary = sumSources(query.data.items);

  return (
    <View style={{ gap: space['2'] }} testID="home-networth">
      <View
        style={{
          flexDirection: 'row',
          flexWrap: wide ? 'nowrap' : 'wrap',
          gap: space['2'],
        }}
      >
        <StatTile
          label={t('stats:home.assets')}
          value={formatMoney(summary.assets, baseCurrency, lang)}
          style={{ flex: 1, minWidth: 140 }}
          testID="home-assets"
        />
        {/* Stored negative, shown as an absolute amount marked "owed" (04 §4.4). */}
        <StatTile
          label={t('stats:home.liabilities')}
          value={t('stats:home.owed_amount', {
            amount: formatMoney(absMoney(summary.liabilities), baseCurrency, lang),
          })}
          style={{ flex: 1, minWidth: 140 }}
          testID="home-liabilities"
        />
        <StatTile
          label={t('stats:home.net_worth')}
          value={formatMoney(summary.net, baseCurrency, lang)}
          sub={t('stats:home.converted_note', { currency: baseCurrency })}
          style={{ flex: 1, minWidth: 140 }}
          testID="home-net-worth"
        />
      </View>

      {summary.archivedCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('stats:home.excluded_archived', {
            count: summary.archivedCount,
          })}
          onPress={onPressArchived}
          hitSlop={space['2']}
          testID="home-archived-hint"
          // 04 §6.6: no touch target smaller than 44×44, a one-line text link included.
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text variant="caption" tone="secondary">
            {t('stats:home.excluded_archived', { count: summary.archivedCount })}
          </Text>
        </Pressable>
      ) : null}

      {summary.unconvertibleCount > 0 ? (
        <Text variant="caption" tone="warning" testID="home-unconvertible-hint">
          {t('stats:home.no_rate_hint', { count: summary.unconvertibleCount })}
        </Text>
      ) : null}
    </View>
  );
}
