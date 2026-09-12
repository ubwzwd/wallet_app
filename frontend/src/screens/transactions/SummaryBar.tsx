/**
 * The list's bottom summary (04 §4.5, decision §14.52 A14).
 *
 * Every number here comes from the response's `summary`, which covers the **whole filtered
 * result** — never the page currently on screen. Net excludes transfers; a
 * `rate_missing_count` above zero says so rather than quietly under-reporting.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TransactionSummary } from '@/api/types';
import { type Lang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from '@/ui';

export interface SummaryBarProps {
  summary: TransactionSummary;
  lang: Lang;
  /** Wide layout: a bar pinned under the list instead of a card inside it. */
  pinned?: boolean;
  testID?: string;
}

export function SummaryBar({
  summary,
  lang,
  pinned = false,
  testID,
}: SummaryBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'tx-summary';
  const currency = summary.base_currency;

  const cells: Array<{ key: 'expense' | 'income' | 'net'; value: string }> = [
    { key: 'expense', value: formatMoney(summary.expense, currency, lang) },
    { key: 'income', value: formatMoney(summary.income, currency, lang) },
    { key: 'net', value: formatMoney(summary.net, currency, lang, { signDisplay: 'always' }) },
  ];

  return (
    <View
      testID={id}
      style={{
        gap: space['2'],
        padding: space['3'],
        backgroundColor: colors['bg.surface'],
        borderRadius: pinned ? 0 : radius.lg,
        borderTopWidth: pinned ? 1 : 0,
        borderWidth: pinned ? 0 : 1,
        borderColor: colors['border.default'],
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: space['3'],
          flexWrap: 'wrap',
        }}
      >
        {cells.map((cell) => (
          <View key={cell.key} style={{ gap: space['1'] }}>
            <Text variant="micro" tone="muted">
              {t(`transaction:list.summary_label.${cell.key}`)}
              {cell.key === 'net' ? ` · ${t('transaction:list.summary_net_hint')}` : ''}
            </Text>
            <Text variant="subheading" mono testID={`${id}-${cell.key}`}>
              {cell.value}
            </Text>
          </View>
        ))}
      </View>
      {summary.rate_missing_count > 0 ? (
        <Text variant="micro" tone="warning" testID={`${id}-rate-missing`}>
          {t('transaction:list.summary_rate_missing', { count: summary.rate_missing_count })}
        </Text>
      ) : null}
    </View>
  );
}
