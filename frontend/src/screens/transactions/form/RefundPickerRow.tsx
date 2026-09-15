/**
 * One candidate inside 「关联原支出」 (mockup 06): on 1440 a real table row — 日期 / 商户 /
 * 分类 / 原支出 / 已退 / 可退 with a little progress bar under the refundable figure — and
 * on 375 the same facts as a card.
 *
 * An original that has already been refunded in full stays selectable (decision §14.52
 * B10); it simply says 「已退完」 instead of a balance, and the form warns afterwards.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Transaction } from '@/api/types';
import { absMoney, cmpMoney } from '@/domain/money';
import { categoryName } from '@/i18n/category';
import type { Lang } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { useCategories } from '@/queries';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, KindIcon, ProgressBar, Text } from '@/ui';
import { useColors } from '@/theme/ThemeProvider';

import { useAmountText } from '../amount';

/** `refundable` as the endpoints report it, or the full amount as a fallback. */
export function refundableOf(tx: Transaction): string {
  return tx.refundable ?? absMoney(tx.amount);
}

/** The table head of the wide dialog; narrow layouts show nothing. */
export function RefundPickerHeader(): React.JSX.Element | null {
  const { t } = useTranslation();
  const wide = useIsWide();
  if (!wide) return null;
  const cell = (key: string, style: object) => (
    <Text key={key} variant="micro" weight={600} tone="muted" style={style} numberOfLines={1}>
      {t(`transaction:form.picker_col_${key}`)}
    </Text>
  );
  return (
    <View style={styles.headRow}>
      {cell('date', styles.colDate)}
      {cell('merchant', styles.colMerchant)}
      {cell('category', styles.colCategory)}
      {cell('expense', styles.colNumber)}
      {cell('refunded', styles.colNumber)}
      {cell('refundable', styles.colRefundable)}
    </View>
  );
}

export function RefundCandidateRow({
  tx,
  lang,
  selected,
}: {
  tx: Transaction;
  lang: Lang;
  selected: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const { index } = useCategories();
  // 屏幕稿 06 writes 原支出 / 已退 / 可退 bare — one table, one currency (§14.59a).
  const money = useAmountText();

  const full = absMoney(tx.amount);
  const refunded = tx.refunded_total ?? '0';
  const remaining = refundableOf(tx);
  const left = cmpMoney(remaining, '0') > 0;
  const done = Number(full) > 0 ? Number(refunded) / Number(full) : 0;
  const l1 = tx.category_l1 === null ? null : index?.byCode[tx.category_l1];
  const l2 = tx.category_l2 === null ? null : index?.byCode[tx.category_l2];
  const category =
    l1 === null || l1 === undefined
      ? '—'
      : l2
        ? `${categoryName(l1, lang)} / ${categoryName(l2, lang)}`
        : categoryName(l1, lang);
  const name = tx.merchant ?? tx.note ?? formatDate(tx.occurred_at, lang);

  const remainingLine = (
    <Text
      variant="caption"
      mono
      tone={left ? 'secondary' : 'muted'}
      testID={`refund-candidate-remaining-${tx.id}`}
      numberOfLines={1}
    >
      {left
        ? t('transaction:form.refund_remaining_label', {
            amount: money(remaining, tx.currency),
          })
        : t('transaction:picker.refunded_out')}
    </Text>
  );

  if (!wide) {
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <KindIcon kind="expense" size={34} />
          <View style={styles.grow}>
            <Text variant="body" weight={600} numberOfLines={1}>
              {name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {`${formatDate(tx.occurred_at, lang)} · ${category}`}
            </Text>
          </View>
          <View style={styles.cardRight}>
            <Text variant="body" mono weight={500} tone="expense" numberOfLines={1}>
              {money(tx.amount, tx.currency)}
            </Text>
            {remainingLine}
          </View>
          {selected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
        </View>
        <ProgressBar value={done} accessibilityLabel={name} style={styles.bar} />
        <Text variant="caption" tone="muted" mono numberOfLines={1}>
          {t('transaction:form.picker_refunded_of', {
            refunded: money(refunded, tx.currency),
            total: money(full, tx.currency),
          })}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Text variant="caption" mono tone="secondary" style={styles.colDate} numberOfLines={1}>
        {formatDate(tx.occurred_at, lang)}
      </Text>
      <View style={[styles.colMerchant, styles.merchantCell]}>
        <KindIcon kind="expense" size={30} />
        <Text variant="body" weight={500} numberOfLines={1} style={styles.grow}>
          {name}
        </Text>
      </View>
      <Text variant="body" tone="secondary" style={styles.colCategory} numberOfLines={1}>
        {category}
      </Text>
      <Text variant="body" mono weight={500} tone="expense" style={styles.colNumber} numberOfLines={1}>
        {money(tx.amount, tx.currency)}
      </Text>
      <Text variant="body" mono tone="secondary" style={styles.colNumber} numberOfLines={1}>
        {money(refunded, tx.currency)}
      </Text>
      <View style={styles.colRefundable}>
        {remainingLine}
        <ProgressBar value={done} accessibilityLabel={name} style={styles.bar} />
      </View>
      <View style={styles.tick}>
        {selected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingVertical: space['2'],
    paddingRight: space['5'] + 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  colDate: { width: 62, flexShrink: 0 },
  colMerchant: { flexGrow: 1.1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  merchantCell: { flexDirection: 'row', alignItems: 'center', gap: space['2'] + 2 },
  colCategory: { flexGrow: 1.2, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  colNumber: { width: 96, flexShrink: 0, textAlign: 'right' },
  colRefundable: { width: 108, flexShrink: 0, alignItems: 'flex-end', gap: space['1'] },
  tick: { width: 18, flexShrink: 0 },
  bar: { alignSelf: 'stretch' },
  card: { gap: space['2'] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  cardRight: { alignItems: 'flex-end', flexShrink: 0 },
});
