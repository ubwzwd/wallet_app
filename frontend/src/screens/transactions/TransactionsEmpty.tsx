/**
 * The transaction list's two empty states (屏幕稿 15 · 空交易列表 / 筛选无结果) and its error
 * block. Two different problems get two different answers:
 *
 *  - **nothing recorded yet** — show what will grow here (the striped ghost rows the wide
 *    table and the narrow card draw around this block), then say so, then offer the two
 *    ways to put something in: 记一笔 and 导入账单.
 *  - **filtered down to nothing** — do not preach about bookkeeping. Say how many
 *    conditions are on, offer to drop the one or two that cost the most rows
 *    (`EmptyFiltered`, decision §14.52 A15), and offer to clear the lot.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TransactionListParams, Uuid } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, EmptyState, Icon, Text } from '@/ui';

import { EmptyFiltered, type CandidateCtx } from './EmptyFiltered';

/** 屏幕稿 15: the 52×52 rounded well over the 「这些条件下没有交易」 headline. */
const ICON_WELL = 52;
/** Decision §14.52 A15: the rescue block only appears once two conditions are active. */
const RESCUE_MIN_FILTERS = 2;

export interface EmptyNoDataProps {
  onAdd(): void;
  onImport(): void;
}

export function EmptyNoData({ onAdd, onImport }: EmptyNoDataProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.block} testID="tx-empty">
      <Text variant="heading" style={styles.centered}>
        {t('transaction:list.empty_no_data')}
      </Text>
      <Text variant="body" tone="muted" style={styles.body}>
        {t('transaction:list.empty_no_data_body')}
      </Text>
      <View style={styles.actions}>
        <Button
          label={t('transaction:list.empty_no_data_action')}
          size="lg"
          fullWidth
          onPress={onAdd}
          testID="tx-empty-primary"
        />
        <Button
          variant="soft"
          label={t('transaction:list.empty_no_data_import')}
          size="lg"
          fullWidth
          onPress={onImport}
          testID="tx-empty-secondary"
        />
      </View>
    </View>
  );
}

export interface EmptyFilteredStateProps {
  ledgerId: Uuid;
  filters: TransactionListParams;
  activeCount: number;
  ctx: CandidateCtx;
  onApply(next: TransactionListParams): void;
  onClear(): void;
}

export function EmptyFilteredState(props: EmptyFilteredStateProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={styles.block} testID="tx-empty-filtered-state">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.well, { backgroundColor: colors['status.warning.bg'] }]}
      >
        <Icon name="search" size={24} color={colors['status.warning.fg']} />
      </View>
      <Text variant="heading" style={styles.centered}>
        {t('transaction:list.empty_filtered')}
      </Text>
      <Text variant="body" tone="muted" style={styles.body}>
        {t('transaction:list.empty_filtered_body', { count: props.activeCount })}
      </Text>
      {props.activeCount >= RESCUE_MIN_FILTERS ? (
        <EmptyFiltered
          ledgerId={props.ledgerId}
          filters={props.filters}
          ctx={props.ctx}
          onApply={props.onApply}
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          label={t('transaction:list.empty_filtered_clear')}
          size="lg"
          fullWidth
          onPress={props.onClear}
          testID="tx-empty-filtered-clear"
        />
      </View>
    </View>
  );
}

export function ListError({ onRetry }: { onRetry(): void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="alert-triangle"
      title={t('transaction:list.error_title')}
      primaryAction={{ label: t('common:button.retry'), onPress: onRetry }}
      testID="tx-error"
    />
  );
}

const styles = StyleSheet.create({
  block: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: space['3'],
    paddingVertical: space['6'],
    paddingHorizontal: space['4'],
  },
  actions: { alignSelf: 'center', width: '100%', maxWidth: 360, gap: space['2'] },
  centered: { textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: 420 },
  well: {
    width: ICON_WELL,
    height: ICON_WELL,
    borderRadius: radius.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
