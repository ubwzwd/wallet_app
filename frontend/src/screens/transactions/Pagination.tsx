/**
 * The wide-layout pager (04 §4.5): `total`, the page number, and prev / next — which write
 * `offset` into the URL, because the URL is the filter state (04 §1.3). Narrow layouts
 * never render this; they scroll instead.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { space } from '@/theme/tokens';
import { Button, Text } from '@/ui';

export interface PaginationProps {
  total: number;
  offset: number;
  limit: number;
  onChange(offset: number): void;
  testID?: string;
}

export function Pagination({
  total,
  offset,
  limit,
  onChange,
  testID,
}: PaginationProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const id = testID ?? 'tx-pagination';

  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;

  const page = Math.floor(offset / limit) + 1;

  return (
    <View
      testID={id}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space['3'],
        paddingVertical: space['3'],
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        icon="chevron-left"
        label={t('transaction:list.pagination.prev')}
        disabled={page <= 1}
        onPress={() => onChange(Math.max(0, offset - limit))}
        testID={`${id}-prev`}
      />
      <Text variant="caption" tone="secondary" mono testID={`${id}-page`}>
        {t('transaction:list.pagination.page', { page, pages })}
      </Text>
      <Button
        variant="secondary"
        size="sm"
        icon="chevron-right"
        label={t('transaction:list.pagination.next')}
        disabled={page >= pages}
        onPress={() => onChange(offset + limit)}
        testID={`${id}-next`}
      />
    </View>
  );
}
