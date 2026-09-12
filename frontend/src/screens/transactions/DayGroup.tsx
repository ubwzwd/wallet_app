/**
 * One calendar day of the list (04 §4.5, decision §14.52 A14): a sticky-looking header
 * with the day's expense and income subtotals — in the ledger's base currency, transfers
 * excluded — over that day's rows.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import type { DayGroup as DayGroupData, ListRow } from '@/domain/transfers';
import { type Lang } from '@/i18n';
import { formatMoney, formatRelativeDay } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from '@/ui';

import { TransactionRow, rowKey } from './TransactionRow';

export interface DayGroupProps {
  group: DayGroupData;
  baseCurrency: string;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  onPressRow(row: ListRow): void;
  onEditRow(row: ListRow): void;
  onDeleteRow(row: ListRow): void;
  onOpenMenu(row: ListRow): void;
  onOpenBatch(batchId: Uuid): void;
  onOpenRefundOrigin(txId: Uuid): void;
  testID?: string;
}

export function DayGroup(props: DayGroupProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const { group, lang, baseCurrency } = props;
  const id = props.testID ?? `tx-day-${group.date}`;

  return (
    <View testID={id} style={{ gap: space['1'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space['2'],
          flexWrap: 'wrap',
          paddingHorizontal: space['2'],
          paddingTop: space['3'],
          paddingBottom: space['1'],
          backgroundColor: colors['bg.canvas'],
        }}
      >
        <Text variant="caption" tone="secondary" mono testID={`${id}-date`}>
          {formatRelativeDay(group.date, lang)}
        </Text>
        <Text variant="caption" tone="muted" mono testID={`${id}-total`}>
          {t('transaction:list.day_total', {
            expense: formatMoney(group.expense, baseCurrency, lang),
            income: formatMoney(group.income, baseCurrency, lang),
          })}
        </Text>
      </View>

      {group.rows.map((row) => (
        <TransactionRow
          key={rowKey(row)}
          row={row}
          baseCurrency={baseCurrency}
          lang={lang}
          index={props.index}
          sourceName={props.sourceName}
          onPress={props.onPressRow}
          onEdit={props.onEditRow}
          onDelete={props.onDeleteRow}
          onOpenMenu={props.onOpenMenu}
          onOpenBatch={props.onOpenBatch}
          onOpenRefundOrigin={props.onOpenRefundOrigin}
        />
      ))}
    </View>
  );
}
