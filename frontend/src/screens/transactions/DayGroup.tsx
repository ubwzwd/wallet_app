/**
 * One calendar day of the narrow list (屏幕稿 02 · 交易列表 375, decision §14.52 A14).
 *
 * The header sits on the canvas above the card — 「09-10 周四」 on the left, that day's
 * expense and income subtotals on the right (base currency, transfers excluded) — and the
 * day's rows live in one white card under it.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import type { DayGroup as DayGroupData, ListRow } from '@/domain/transfers';
import { type Lang } from '@/i18n';
import { formatMoney, parseLocalDate } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { ListCard, Text } from '@/ui';

import { TransactionRow, rowKey } from './TransactionRow';

export interface DayGroupProps {
  group: DayGroupData;
  baseCurrency: string;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  onPressRow(row: ListRow): void;
  onOpenMenu(row: ListRow): void;
  onOpenBatch(batchId: Uuid): void;
  onOpenRefundOrigin(txId: Uuid): void;
  testID?: string;
}

export function DayGroup(props: DayGroupProps): React.JSX.Element {
  const { t } = useTranslation();
  const { group, lang, baseCurrency } = props;
  const id = props.testID ?? `tx-day-${group.date}`;
  const weekday = t(`transaction:list.weekday.${parseLocalDate(group.date).getDay()}`);

  return (
    <View testID={id} style={{ gap: space['2'] - 2, paddingBottom: space['3'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: space['2'],
          flexWrap: 'wrap',
          paddingHorizontal: space['2'] - 2,
        }}
      >
        <Text variant="caption" tone="secondary" mono weight={600} testID={`${id}-date`}>
          {`${group.date.slice(5)} ${weekday}`}
        </Text>
        <Text variant="micro" tone="muted" mono testID={`${id}-total`}>
          {t('transaction:list.day_total', {
            expense: formatMoney(group.expense, baseCurrency, lang),
            income: formatMoney(group.income, baseCurrency, lang),
          })}
        </Text>
      </View>

      <ListCard testID={`${id}-card`}>
        {group.rows.map((row) => (
          <TransactionRow
            key={rowKey(row)}
            row={row}
            baseCurrency={baseCurrency}
            lang={lang}
            index={props.index}
            sourceName={props.sourceName}
            onPress={props.onPressRow}
            onOpenMenu={props.onOpenMenu}
            onOpenBatch={props.onOpenBatch}
            onOpenRefundOrigin={props.onOpenRefundOrigin}
          />
        ))}
      </ListCard>
    </View>
  );
}
