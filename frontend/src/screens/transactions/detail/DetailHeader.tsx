/**
 * Detail header (04 §4.7): kind badge + amount + merchant + date + account + category.
 *
 * Two things it deliberately does not render: the transaction id (decision §14.52 A6) and
 * the converted amount — the latter belongs to `RateLine`, which also carries the rate and
 * the rate date (decision §14.52 A24), so painting it here too would only duplicate it. A
 * transfer amount never gets a semantic colour; `MoneyText` already knows that.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { IsoDate, Money, TxKind } from '@/api/types';
import { useLang } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { Card, KindBadge, MoneyText, Text } from '@/ui';

export interface DetailHeaderProps {
  kind: TxKind;
  amount: Money;
  currency: string;
  occurredAt: IsoDate;
  /** Transfers never have one (decision §14.52 B16). */
  merchant?: string | null;
  sourceName?: string | null;
  categoryText?: string | null;
  /** A second line next to the badge: the transfer subtype, "对方不在应用里", … */
  badgeExtra?: string | null;
  note?: string | null;
  /** `never` for the two-leg header, where each leg carries its own sign. */
  signDisplay?: 'auto' | 'never' | 'always';
  testID?: string;
}

function MetaRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.metaRow}>
      <Text variant="caption" tone="muted" style={styles.metaLabel}>
        {label}
      </Text>
      <Text variant="body" testID={testID} style={styles.metaValue}>
        {value}
      </Text>
    </View>
  );
}

export function DetailHeader({
  kind,
  amount,
  currency,
  occurredAt,
  merchant,
  sourceName,
  categoryText,
  badgeExtra,
  note,
  signDisplay,
  testID,
}: DetailHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const id = testID ?? 'detail-header';

  return (
    <Card testID={id} style={styles.card}>
      <View style={styles.badgeRow}>
        <KindBadge kind={kind} testID={`${id}-kind`} />
        {badgeExtra ? (
          <Text variant="caption" tone="secondary" testID={`${id}-extra`}>
            {badgeExtra}
          </Text>
        ) : null}
      </View>

      <MoneyText
        amount={amount}
        currency={currency}
        kind={kind}
        size="title"
        signDisplay={signDisplay}
        testID={`${id}-amount`}
      />

      {merchant ? (
        <Text variant="subheading" testID={`${id}-merchant`}>
          {merchant}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <MetaRow
          label={t('transaction:form.date')}
          value={formatDate(occurredAt, lang)}
          testID={`${id}-date`}
        />
        {sourceName ? (
          <MetaRow
            label={t('transaction:form.source')}
            value={sourceName}
            testID={`${id}-source`}
          />
        ) : null}
        {categoryText ? (
          <MetaRow
            label={t('transaction:list.filter.category_label')}
            value={categoryText}
            testID={`${id}-category`}
          />
        ) : null}
        {note ? (
          <MetaRow label={t('transaction:form.note')} value={note} testID={`${id}-note`} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space['2'], alignSelf: 'stretch' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] },
  meta: { gap: space['1'], alignSelf: 'stretch' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space['2'] },
  metaLabel: { minWidth: 56 },
  metaValue: { flex: 1 },
});
