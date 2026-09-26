/**
 * The narrow layout's account list (屏幕稿 09 · 账户列表 375).
 *
 * One block per type — a small mono caption with the group's converted subtotal on the
 * right (决策 §14.50), over a white card of 56-tall rows: type well, name over
 * 「储蓄卡 · CNY」, the balance in the account's own currency, the converted value under it
 * for a foreign account, and the 「···」 menu at the end (04 §4.8).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, Money, SourceType } from '@/api/types';
import type { Lang } from '@/i18n';
import { formatConverted, formatDate, formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { ListCard, ListRow, SourceTypeIcon, Text, sourceTypeLabelKey } from '@/ui';

import { SourceRowMenu } from './SourceRowMenu';
import { balanceText, balanceTone, isForeign } from './sourceFormat';

export interface SourceListRowProps {
  source: FinanceSource;
  baseCurrency: string;
  lang: Lang;
  onOpen(source: FinanceSource): void;
  onDelete(source: FinanceSource): void;
  deleteBlocked?: boolean;
}

/** The right-hand second line: the converted value, or — for an archived row — when it was
 *  archived (屏幕稿 09: 「归档于 2026-03」). */
function amountSubOf(
  source: FinanceSource,
  baseCurrency: string,
  lang: Lang,
  t: TFunction,
): string | undefined {
  if (source.archived) {
    return source.archived_at === null
      ? undefined
      : t('source:list.archived_at', { date: formatDate(source.archived_at.slice(0, 10)) });
  }
  if (!isForeign(source, baseCurrency)) return undefined;
  if (source.balance_base === null) return t('source:list.no_rate_cell');
  const converted = formatConverted(
    source.balance ?? '0',
    source.default_currency,
    source.balance_base,
    baseCurrency,
    lang,
  );
  return converted === '' ? undefined : converted;
}

export function SourceListRow({
  source,
  baseCurrency,
  lang,
  onOpen,
  onDelete,
  deleteBlocked = false,
}: SourceListRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const muted = source.archived;

  return (
    <View style={{ opacity: muted ? 0.7 : 1 }}>
      {/* The 「···」 menu sits beside the row rather than inside it: a button nested in a
          button is invalid on the web and swallows the inner click. */}
      <View style={styles.row}>
        <ListRow
          icon={<SourceTypeIcon type={source.type} size={34} />}
          title={source.name}
          subtitle={`${t(sourceTypeLabelKey(source.type))} · ${source.default_currency}`}
          amount={balanceText(source, lang, baseCurrency)}
          amountTone={balanceTone(source, muted)}
          amountSub={amountSubOf(source, baseCurrency, lang, t)}
          onPress={() => onOpen(source)}
          style={styles.rowBody}
          testID={`source-row-${source.id}`}
        />
        <View style={styles.menu}>
          <SourceRowMenu source={source} onOpen={onOpen} onDelete={onDelete} />
        </View>
      </View>
      {deleteBlocked ? (
        <Text
          variant="caption"
          tone="danger"
          testID={`source-delete-blocked-${source.id}`}
          style={styles.blocked}
        >
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
  lang: Lang;
  onOpen(source: FinanceSource): void;
  onDelete(source: FinanceSource): void;
  deleteBlockedId: string | null;
}

export function SourceGroup({
  type,
  sources,
  subtotal,
  baseCurrency,
  lang,
  onOpen,
  onDelete,
  deleteBlockedId,
}: SourceGroupProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <View style={styles.group} testID={`source-group-${type}`}>
      <View style={styles.header}>
        <Text
          variant="micro"
          tone="muted"
          mono
          weight={600}
          accessibilityRole="header"
          style={styles.headerLabel}
        >
          {t(sourceTypeLabelKey(type))}
        </Text>
        {/* 屏幕稿 09 writes the group subtotal with its symbol (「¥12,480.35」): it is a
            standalone figure, not a column (§14.59 f). */}
        <Text variant="micro" tone="muted" mono testID={`source-subtotal-${type}`}>
          {formatMoney(subtotal, baseCurrency, lang)}
        </Text>
      </View>
      <ListCard testID={`source-group-card-${type}`}>
        {sources.map((source) => (
          <SourceListRow
            key={source.id}
            source={source}
            baseCurrency={baseCurrency}
            lang={lang}
            onOpen={onOpen}
            onDelete={onDelete}
            deleteBlocked={deleteBlockedId === source.id}
          />
        ))}
      </ListCard>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { alignSelf: 'stretch', gap: space['2'] },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space['3'],
    paddingHorizontal: space['2'] - 2,
  },
  headerLabel: { letterSpacing: 0.66 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBody: { flex: 1, minWidth: 0, paddingRight: 0 },
  menu: { paddingRight: 0 },
  blocked: { paddingHorizontal: space['4'], paddingBottom: space['2'] },
});
