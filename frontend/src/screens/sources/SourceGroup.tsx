/**
 * One account-type group of the account list, and the row inside it (04 §4.8).
 *
 * A group header carries the type's name and its converted subtotal (decision §14.50);
 * a row carries the icon, name, currency and balance — plus, for a foreign-currency
 * account, the converted amount and the rate date underneath it.
 *
 * Archived rows reuse the same component with `archived`: they are greyed out, show when
 * they were archived, and say out loud that their balance is out of net worth.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, Money, SourceType } from '@/api/types';
import { absMoney, parseMoney } from '@/domain/money';
import { formatConverted, formatDate, formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useLedgerContext } from '@/store';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Card, Icon, SOURCE_TYPE_ICON, Text } from '@/ui';

import { useArchiveSource } from './useArchiveSource';

export interface SourceRowProps {
  source: FinanceSource;
  /** The ledger's base currency — what `balance_base` is denominated in. */
  baseCurrency: string;
  onOpen(source: FinanceSource): void;
  onDelete(source: FinanceSource): void;
  /** `true` after the server refused a delete with `source_has_transactions`. */
  deleteBlocked: boolean;
  wide: boolean;
}

/** The balance line: `欠 ¥3,204.00` for a credit card in the red, the signed amount
 *  otherwise, with the converted value and its rate date below when it isn't the ledger's
 *  base currency (04 §4.8). */
function BalanceLines({
  source,
  baseCurrency,
  muted,
}: {
  source: FinanceSource;
  baseCurrency: string;
  muted: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const currency = source.default_currency;
  const owes = source.type === 'credit' && parseMoney(source.balance) < 0n;
  const converted =
    source.balance_base === null
      ? null
      : formatConverted(source.balance, currency, source.balance_base, baseCurrency, lang);

  return (
    <View style={{ alignItems: 'flex-end', gap: space['1'] }}>
      <Text
        variant="subheading"
        mono
        tone={muted ? 'muted' : owes ? 'expense' : 'primary'}
        testID={`source-balance-${source.id}`}
      >
        {owes
          ? t('source:list.balance_debt', {
              amount: formatMoney(absMoney(source.balance), currency, lang),
            })
          : formatMoney(source.balance, currency, lang)}
      </Text>
      {converted !== null && converted !== '' ? (
        <Text variant="caption" tone="muted" mono testID={`source-balance-base-${source.id}`}>
          {converted}
        </Text>
      ) : null}
      {converted !== null && converted !== '' && source.balance_rate_date !== null ? (
        <Text variant="caption" tone="muted" testID={`source-rate-date-${source.id}`}>
          {t('source:list.rate_date', { date: formatDate(source.balance_rate_date, lang) })}
        </Text>
      ) : null}
    </View>
  );
}

export function SourceRow({
  source,
  baseCurrency,
  onOpen,
  onDelete,
  deleteBlocked,
  wide,
}: SourceRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const { ledgerId } = useLedgerContext();
  const archive = useArchiveSource(ledgerId, source.id);
  const muted = source.archived;

  return (
    <View style={{ gap: space['1'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={source.name}
        onPress={() => onOpen(source)}
        testID={`source-row-${source.id}`}
        style={({ pressed }) => ({
          borderRadius: radius.md,
          opacity: muted ? 0.7 : 1,
          backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
          padding: density.rowInnerPadding,
          flexDirection: wide ? 'row' : 'column',
          alignItems: wide ? 'center' : 'stretch',
          gap: space['2'],
        })}
      >
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'], flex: wide ? 1 : 0 }}
        >
          <Icon name={SOURCE_TYPE_ICON[source.type]} />
          <View style={{ flex: 1, gap: space['1'] }}>
            <Text variant="body" tone={muted ? 'muted' : 'primary'} numberOfLines={1}>
              {source.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: space['2'], flexWrap: 'wrap' }}>
              <Text variant="caption" tone="secondary" mono>
                {source.default_currency}
              </Text>
              {muted && source.archived_at !== null ? (
                <Text variant="caption" tone="muted" testID={`source-archived-at-${source.id}`}>
                  {t('source:list.archived_at', {
                    date: formatDate(source.archived_at.slice(0, 10), lang),
                  })}
                </Text>
              ) : null}
            </View>
            {muted ? (
              <Text variant="caption" tone="muted" testID={`source-archived-hint-${source.id}`}>
                {t('source:list.archived_hint')}
              </Text>
            ) : null}
          </View>
        </View>
        <BalanceLines source={source} baseCurrency={baseCurrency} muted={muted} />
      </Pressable>
      <View style={{ flexDirection: 'row', gap: space['2'], justifyContent: 'flex-end' }}>
        <Button
          testID={`source-archive-${source.id}`}
          label={
            source.archived ? t('source:list.unarchive_action') : t('source:list.archive_action')
          }
          variant="ghost"
          size="sm"
          disabled={archive.pending}
          onPress={() => void archive.setArchived(source, !source.archived)}
        />
        <Button
          testID={`source-delete-${source.id}`}
          label={t('source:list.delete_action')}
          variant="ghost"
          size="sm"
          onPress={() => onDelete(source)}
        />
      </View>
      {deleteBlocked ? (
        <Text variant="caption" tone="danger" testID={`source-delete-blocked-${source.id}`}>
          {t('source:list.delete_disabled_hint')}
        </Text>
      ) : null}
    </View>
  );
}

export interface SourceGroupProps {
  type: SourceType;
  sources: readonly FinanceSource[];
  /** Already converted to the base currency by `sumSources` (decision §14.50). */
  subtotal: Money;
  baseCurrency: string;
  onOpen(source: FinanceSource): void;
  onDelete(source: FinanceSource): void;
  deleteBlockedId: string | null;
  wide: boolean;
}

export function SourceGroup({
  type,
  sources,
  subtotal,
  baseCurrency,
  onOpen,
  onDelete,
  deleteBlockedId,
  wide,
}: SourceGroupProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();

  return (
    <Card variant="outlined" style={{ gap: space['2'] }} testID={`source-group-${type}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
        <Text variant="heading" style={{ flex: 1 }} accessibilityRole="header">
          {t(`source:type.${type}`)}
        </Text>
        <Text variant="caption" tone="secondary" mono testID={`source-subtotal-${type}`}>
          {t('source:list.group_subtotal', {
            amount: formatMoney(subtotal, baseCurrency, lang),
          })}
        </Text>
      </View>
      {sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          baseCurrency={baseCurrency}
          onOpen={onOpen}
          onDelete={onDelete}
          deleteBlocked={deleteBlockedId === source.id}
          wide={wide}
        />
      ))}
    </Card>
  );
}
