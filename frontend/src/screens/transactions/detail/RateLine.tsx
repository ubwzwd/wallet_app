/**
 * The exchange-rate line of the detail page (04 §4.7, decision §14.52 A24).
 *
 * "≈ ¥1,032.40 · 按 2026-08-14 汇率 1 USD = 7.1694 CNY", from `amount_base` / `rate_used` /
 * `rate_date`. When `rate_date` is not the transaction's own day the backend fell back to
 * the nearest quote (decision §8), and that gets said out loud. All three fields null means
 * there is no rate at all — which must read as "暂无汇率", never as a silent zero.
 *
 * It is read-only on purpose (decision §14.52 A10): the rate is a reference, and the way to
 * change a converted amount is to change the other leg's amount, not the rate.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { IsoDate, Money } from '@/api/types';
import { useLang } from '@/i18n';
import { formatConverted, formatDate } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { Text } from '@/ui';

/**
 * `'7.16940000'` → `'7.1694'`. The backend stores eight decimals; trailing zeros carry no
 * information and make the line harder to read.
 */
export function trimRate(raw: Money): string {
  if (!raw.includes('.')) return raw;
  const trimmed = raw.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? raw : trimmed;
}

export interface RateLineProps {
  amount: Money;
  currency: string;
  baseCurrency: string;
  amountBase: Money | null;
  rateUsed: Money | null;
  rateDate: IsoDate | null;
  occurredAt: IsoDate;
  /**
   * `lead` is the 16/22 mono line 屏幕稿 08 puts straight under the headline amount; `sm`
   * is the caption a transfer leg carries inside its own tile.
   */
  size?: 'lead' | 'sm';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function RateLine({
  amount,
  currency,
  baseCurrency,
  amountBase,
  rateUsed,
  rateDate,
  occurredAt,
  size = 'sm',
  style,
  testID,
}: RateLineProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const lang = useLang();
  const id = testID ?? 'detail-rate';
  const lead = size === 'lead';

  // Same currency as the ledger: there is nothing to convert and nothing to explain.
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) return null;

  if (amountBase === null || rateUsed === null || rateDate === null) {
    return (
      <View style={[styles.wrap, style]}>
        <Text
          variant="caption"
          tone="muted"
          style={lead ? styles.lead : undefined}
          testID={`${id}-missing`}
        >
          {t('transaction:list.rate_missing')}
        </Text>
      </View>
    );
  }

  const converted = formatConverted(amount, currency, amountBase, baseCurrency, lang);
  const rate = t('transaction:detail.rate_used', {
    date: formatDate(rateDate, lang),
    from: currency,
    rate: trimRate(rateUsed),
    to: baseCurrency,
  });
  // `formatConverted` returns '' for a zero amount, and a bare " · " would look broken.
  const line = converted === '' ? rate : `${converted} · ${rate}`;

  return (
    <View style={[styles.wrap, style]} testID={id}>
      <Text
        variant="caption"
        tone="secondary"
        mono
        weight={500}
        style={lead ? styles.lead : undefined}
        testID={`${id}-text`}
      >
        {line}
      </Text>
      {rateDate !== occurredAt ? (
        <Text variant="caption" tone="muted" testID={`${id}-fallback`}>
          {t('transaction:detail.rate_fallback_hint', { date: formatDate(rateDate, lang) })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['1'], alignSelf: 'stretch' },
  // 屏幕稿 08 sets the converted line one step under the headline: 16/22 mono.
  lead: { fontSize: 16, lineHeight: 22 },
});
