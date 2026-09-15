/**
 * The home page's header (screen 01 / 15, 04 §4.4, decisions §7 / §14.50 / §14.56).
 *
 * The mockup opens with one number, not a row of tiles: 「净资产 · 折算 CNY」 over a 40/34
 * figure, with the month's expense and income as two tinted cards on the right (inside the
 * white card on a narrow screen). Assets and liabilities stay on screen — decision §14.50
 * asks for all three — but as one small line under the number rather than two more cards.
 *
 * The three numbers are summed locally by `sumSources`, the one place that knows the rules:
 * credit cards are liabilities, archived accounts do not count at all, and a balance that
 * could not be converted is counted as "no rate yet" rather than read as zero.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { FinanceSource, Paged } from '@/api/types';
import { absMoney, parseMoney, sumSources } from '@/domain';
import { useLang } from '@/i18n';
import { formatAmountPlain, formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { EmptyState, ListCard, Skeleton, Text } from '@/ui';

/** Figtree with tabular figures: the mockup's big number is sans, not mono (屏幕 01:224). */
const TABULAR = { fontVariant: ['tabular-nums' as const] };

export interface NetWorthHeaderProps {
  query: UseQueryResult<Paged<FinanceSource>>;
  baseCurrency: string;
  /** The two month tint cards. Wide: right of the number; narrow: under it. */
  totals?: React.ReactNode;
  /** Icon buttons / page actions, right-aligned (wide) or next to the label (narrow). */
  actions?: React.ReactNode;
  /** Screen 15: a sentence and a full-width button inside the card. */
  hint?: React.ReactNode;
  /** Screen 15 paints the zero in grey — an empty ledger, not a failed load. */
  muted?: boolean;
  /** Opens the account list with the archived group expanded. */
  onPressArchived(): void;
}

export function NetWorthHeader({
  query,
  baseCurrency,
  totals,
  actions,
  hint,
  muted = false,
  onPressArchived,
}: NetWorthHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();

  const summary = query.data ? sumSources(query.data.items) : null;

  // The month's tint cards come from a different request than the balances, so they stay on
  // screen while this block is loading or has failed (04 §4.4: every block carries its own
  // skeleton and its own retry).
  const labelRow = (
    <View style={styles.labelRow}>
      <Text variant="caption" tone="muted" weight={500} style={styles.label}>
        {t('stats:home.net_worth_line', { currency: baseCurrency })}
      </Text>
      {/* Narrow screens have no header action area; the page actions ride the label line. */}
      {!wide && actions !== undefined ? actions : null}
    </View>
  );

  const block = query.isPending ? (
    <View style={styles.block} testID="home-networth-loading">
      {labelRow}
      <Skeleton variant="card" height={wide ? 44 : 36} />
    </View>
  ) : summary === null ? (
    <View style={styles.block}>
      {labelRow}
      <EmptyState
        icon="alert-triangle"
        title={t('stats:home.error_retry')}
        primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
        style={styles.error}
        testID="home-networth-error"
      />
    </View>
  ) : (
    <View style={styles.block} testID="home-networth">
      {labelRow}

      <Text
        variant={wide ? 'display' : 'title'}
        // An empty ledger's zero is mono and grey (屏幕 15:114) — it reads as "nothing here
        // yet", not as a figure someone should check.
        mono={muted}
        weight={muted ? 450 : 700}
        tone={muted ? 'muted' : parseMoney(summary.net) < 0n ? 'expense' : 'primary'}
        numberOfLines={1}
        style={[TABULAR, wide ? null : styles.narrowNumber]}
        testID="home-net-worth"
      >
        {formatMoney(summary.net, baseCurrency, lang)}
      </Text>

      {muted ? null : (
        <View style={styles.subLine}>
          {/* 屏幕稿 09 writes the same pair bare under the big number — 「资产 37,842.10 ·
              负债 3,215.00」 — the symbol belongs to the net-worth line alone (§14.59a). */}
          <Text variant="caption" tone="muted" mono testID="home-assets">
            {t('stats:home.assets_amount', {
              amount: formatAmountPlain(summary.assets, baseCurrency),
            })}
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="muted" mono testID="home-liabilities">
            {t('stats:home.liabilities_amount', {
              amount: formatAmountPlain(absMoney(summary.liabilities), baseCurrency),
            })}
          </Text>
        </View>
      )}

      {summary.archivedCount > 0 ? (
        // 04 §6.6: a one-line text link still needs a 44-tall target; `hitSlop` gives it one
        // without pushing the number off its baseline.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('stats:home.excluded_archived', { count: summary.archivedCount })}
          onPress={onPressArchived}
          hitSlop={space['3']}
          testID="home-archived-hint"
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

      {hint}
    </View>
  );

  if (wide) {
    return (
      <View style={styles.wideRow}>
        {block}
        <View style={styles.wideActions}>
          {totals}
          {actions}
        </View>
      </View>
    );
  }

  return (
    <ListCard style={styles.narrowCard} testID="home-networth-card">
      {/* One slot, so the card's own gap governs the spacing inside it. */}
      <View style={styles.narrowBody}>
        {block}
        {totals !== undefined ? <View style={styles.narrowTotals}>{totals}</View> : null}
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  error: { alignItems: 'flex-start', paddingVertical: space['4'] },
  wideRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space['5'],
    alignSelf: 'stretch',
  },
  wideActions: { flexDirection: 'row', alignItems: 'center', gap: space['3'], flexShrink: 0 },
  block: { flexShrink: 1, minWidth: 0, gap: space['1'] },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: space['2'],
  },
  label: { flexShrink: 1 },
  // 34/40 at 375 (屏幕 01:70); the wide step is the `display` token's own 40/44.
  narrowNumber: { fontSize: 34, lineHeight: 40 },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' },
  narrowCard: { padding: space['4'] + 2 },
  narrowBody: { gap: space['3'] },
  narrowTotals: { flexDirection: 'row', gap: space['3'] - 2 },
});
