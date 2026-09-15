/**
 * The narrow layout's headline card (屏幕稿 09 · 账户列表 375): 「净资产 · 折算 CNY」, the
 * number itself, and 资产 / 负债 under it — the three sums of 04 §4.8, with archived
 * accounts left out of every one of them (decision §14.50).
 *
 * The wide layout has no such card: its three numbers live inline in the page header and
 * in the table's foot strip. The 「＋」 button rides in this card's corner, because the
 * narrow chrome's top bar has no action slot of its own.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { absMoney } from '@/domain/money';
import type { NetWorthSummary } from '@/domain/networth';
import type { Lang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { Button, Card, Text } from '@/ui';

export interface NetWorthCardProps {
  summary: NetWorthSummary;
  baseCurrency: string;
  lang: Lang;
  onNew(): void;
}

export function NetWorthCard({
  summary,
  baseCurrency,
  lang,
  onNew,
}: NetWorthCardProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Card variant="raised" style={styles.card} testID="sources-summary">
      <View style={styles.row}>
        <View style={styles.text}>
          <Text variant="caption" tone="muted" weight={500}>
            {t('source:list.net_worth_caption', { currency: baseCurrency })}
          </Text>
          <Text variant="title" mono weight={450} numberOfLines={1} testID="sources-net-worth">
            {formatMoney(summary.net, baseCurrency, lang)}
          </Text>
        </View>
        <Button
          testID="sources-new"
          icon="plus"
          iconOnly
          accessibilityLabel={t('source:list.new_button')}
          onPress={onNew}
        />
      </View>

      <View style={styles.sums}>
        <Text variant="caption" tone="muted" mono testID="sources-assets">
          {`${t('source:list.assets')} ${formatMoney(summary.assets, baseCurrency, lang)}`}
        </Text>
        {/* 屏幕稿 09 keeps both sums in the same muted grey: the labels carry the
            difference, not colour (04 §6.2 rule 7). */}
        <Text variant="caption" tone="muted" mono testID="sources-liabilities">
          {`${t('source:list.liabilities')} ${formatMoney(
            absMoney(summary.liabilities),
            baseCurrency,
            lang,
          )}`}
        </Text>
      </View>

      {summary.archivedCount > 0 ? (
        <Text variant="caption" tone="muted" testID="sources-excluded-archived">
          {t('source:list.excluded_archived', { count: summary.archivedCount })}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: space['4'], gap: space['2'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  text: { flex: 1, minWidth: 0, gap: 2 },
  sums: { flexDirection: 'row', flexWrap: 'wrap', gap: space['4'] - 2 },
});
