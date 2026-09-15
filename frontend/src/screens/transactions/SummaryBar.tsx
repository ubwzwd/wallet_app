/**
 * The narrow list's bottom summary card (屏幕稿 02 · 交易列表 375, decision §14.52 A14):
 * three cells — 支出 / 收入 / 净额 · 不含转账 — split by hairlines, each a small grey label
 * over a mono number in that kind's colour.
 *
 * Every number here comes from the response's `summary`, which covers the **whole filtered
 * result** — never the page currently on screen. Net excludes transfers; a
 * `rate_missing_count` above zero says so rather than quietly under-reporting. The wide
 * layout has no bar: its numbers sit in the page header and the table's foot strip.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TransactionSummary } from '@/api/types';
import { type Lang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { density, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Card, Text, type TextTone } from '@/ui';

export interface SummaryBarProps {
  summary: TransactionSummary;
  lang: Lang;
  testID?: string;
}

export function SummaryBar({ summary, lang, testID }: SummaryBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'tx-summary';
  const currency = summary.base_currency;

  const cells: Array<{ key: 'expense' | 'income' | 'net'; value: string; tone: TextTone; flex: number }> = [
    {
      key: 'expense',
      value: formatMoney(summary.expense, currency, lang),
      tone: 'expense',
      flex: 1,
    },
    { key: 'income', value: formatMoney(summary.income, currency, lang), tone: 'income', flex: 1 },
    {
      key: 'net',
      value: formatMoney(summary.net, currency, lang, { signDisplay: 'always' }),
      tone: 'primary',
      flex: 1.15,
    },
  ];

  return (
    <View style={{ gap: space['2'] - 2 }}>
      <Card
        testID={id}
        style={{ flexDirection: 'row', gap: space['2'], padding: density.rowInnerPadding }}
      >
        {cells.map((cell, i) => (
          <React.Fragment key={cell.key}>
            {i > 0 ? (
              <View style={{ width: 1, backgroundColor: colors['border.default'] }} />
            ) : null}
            <View style={{ flex: cell.flex, minWidth: 0, gap: 2 }}>
              <Text variant="micro" tone="muted" weight={400}>
                {t(`transaction:list.summary_label.${cell.key}`)}
                {cell.key === 'net' ? ` · ${t('transaction:list.summary_net_hint')}` : ''}
              </Text>
              <Text variant="subheading" tone={cell.tone} mono testID={`${id}-${cell.key}`}>
                {cell.value}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </Card>
      {summary.rate_missing_count > 0 ? (
        <Text
          variant="micro"
          tone="muted"
          style={{ paddingHorizontal: space['1'] }}
          testID={`${id}-rate-missing`}
        >
          {t('transaction:list.summary_rate_missing', { count: summary.rate_missing_count })}
        </Text>
      ) : null}
    </View>
  );
}
