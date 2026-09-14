/**
 * "这笔支出被退了多少" (04 §4.7, decision §14.46 04-D-6, §14.53f).
 *
 * Every refund pointing at this expense — date, amount, note and the account the money came
 * back to (`source_id`, which only `refunds[]` carries) — plus the one line that answers the
 * question people actually open this page with: 已退 X / 可退 Y. Each row opens that refund.
 *
 * `refundable` may be negative: over-refunding is allowed (decision §1.1), so the number is
 * shown as it is rather than clamped.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Money, RefundRef, Uuid } from '@/api/types';
import { useLang } from '@/i18n';
import { formatDate, formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Card, Text } from '@/ui';

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
  const lang = useLang();
  const colors = useColors();
  const id = testID ?? 'detail-refunds';

  return (
    <Card testID={id} style={styles.card}>
      <Text variant="subheading" accessibilityRole="header">
        {t('transaction:detail.refunds_title')}
      </Text>
      <Text variant="body" tone="secondary" testID={`${id}-summary`}>
        {t('transaction:detail.refunds_summary', {
          refunded: formatMoney(refundedTotal, currency, lang, { signDisplay: 'never' }),
          refundable: formatMoney(refundable, currency, lang),
        })}
      </Text>

      {refunds.length === 0 ? (
        <Text variant="caption" tone="muted" testID={`${id}-empty`}>
          {t('transaction:detail.refunds_empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {refunds.map((r) => {
            const account = sourceNames[r.source_id];
            return (
              <Pressable
                key={r.id}
                accessibilityRole="link"
                accessibilityLabel={t('transaction:detail.refunds_title')}
                testID={`${id}-row-${r.id}`}
                onPress={() => onOpen(r.id)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderColor: colors['border.default'],
                    backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
                  },
                ]}
              >
                <Text variant="body" mono>
                  {formatDate(r.occurred_at, lang)}
                </Text>
                <View style={styles.rowMain}>
                  {account ? (
                    <Text variant="body" numberOfLines={1} testID={`${id}-account-${r.id}`}>
                      {account}
                    </Text>
                  ) : null}
                  {r.note ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {r.note}
                    </Text>
                  ) : null}
                </View>
                <Text variant="body" tone="refund" mono testID={`${id}-amount-${r.id}`}>
                  {formatMoney(r.amount, r.currency, lang)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space['2'], alignSelf: 'stretch' },
  list: { alignSelf: 'stretch' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    minHeight: 44,
    paddingVertical: space['2'],
    paddingHorizontal: space['1'],
    borderRadius: radius.sm,
    borderBottomWidth: 1,
  },
  rowMain: { flex: 1, gap: 2 },
});
