/**
 * 「已关联的退款」 (04 §4.7, decisions §14.46 04-D-6, §14.53f, 屏幕稿 08).
 *
 * The beige side card on an expense: every refund pointing at it — date, amount, note and
 * the account the money came back to (`source_id`, which only `refunds[]` carries) — and
 * the one line people open this page for, 已退 X / 可退 Y. Each row opens that refund.
 *
 * `refundable` may be negative: over-refunding is allowed (decision §1.1), so the number is
 * shown as it is rather than clamped.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Money, RefundRef, Uuid } from '@/api/types';
import { formatDate } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, Text } from '@/ui';

import { useAmountText } from '../amount';
import { TintSideCard } from './parts';

export interface RefundsSectionProps {
  refunds: readonly RefundRef[];
  refundedTotal: Money;
  refundable: Money;
  /** The expense's own currency — the summary line is stated in it. */
  currency: string;
  sourceNames: Readonly<Record<Uuid, string>>;
  onOpen(id: Uuid): void;
  testID?: string;
}

export function RefundsSection({
  refunds,
  refundedTotal,
  refundable,
  currency,
  sourceNames,
  onOpen,
  testID,
}: RefundsSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  // 屏幕稿 08 writes 「已退 0.00 / 66.20」 bare — the card counts in one currency (§14.59a).
  const money = useAmountText();
  const id = testID ?? 'detail-refunds';

  return (
    <TintSideCard title={t('transaction:detail.refunds_title')} testID={id}>
      {refunds.length === 0 ? (
        <Text variant="caption" tone="warning" testID={`${id}-empty`}>
          {t('transaction:detail.refunds_empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {refunds.map((r) => {
            const account = sourceNames[r.source_id];
            return (
              // touch-target-exempt: `styles.row` is 52 tall and stretches the card's width.
              <Pressable
                key={r.id}
                accessibilityRole="link"
                accessibilityLabel={t('transaction:detail.refunds_title')}
                testID={`${id}-row-${r.id}`}
                onPress={() => onOpen(r.id)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
                ]}
              >
                <View style={[styles.well, { backgroundColor: colors['kind.refund.subtle'] }]}>
                  <Icon name="undo-2" size={16} color={colors['kind.refund']} />
                </View>
                <View style={styles.rowMain}>
                  {account !== undefined ? (
                    <Text
                      variant="body"
                      weight={500}
                      numberOfLines={1}
                      testID={`${id}-account-${r.id}`}
                    >
                      {account}
                    </Text>
                  ) : null}
                  <Text variant="caption" tone="secondary" mono numberOfLines={1}>
                    {r.note === null
                      ? formatDate(r.occurred_at)
                      : `${formatDate(r.occurred_at)} · ${r.note}`}
                  </Text>
                </View>
                <Text
                  variant="body"
                  tone="warning"
                  mono
                  weight={500}
                  testID={`${id}-amount-${r.id}`}
                >
                  {money(r.amount, r.currency)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text
        variant="caption"
        tone="warning"
        mono
        weight={500}
        style={styles.summary}
        testID={`${id}-summary`}
      >
        {t('transaction:detail.refunds_summary', {
          refunded: money(refundedTotal, currency, 'never'),
          refundable: money(refundable, currency),
        })}
      </Text>
    </TintSideCard>
  );
}

const styles = StyleSheet.create({
  list: { alignSelf: 'stretch' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'] + 3,
    minHeight: 52,
    paddingVertical: space['2'],
    paddingHorizontal: space['1'],
    borderRadius: radius.sm,
  },
  well: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowMain: { flex: 1, minWidth: 0, gap: 1 },
  summary: { alignSelf: 'stretch', textAlign: 'right' },
});
