/**
 * One row of the transaction list (04 §4.5 行内容).
 *
 * A row is a `ListRow` from `mergeTransferRows`, so the two legs of a transfer arrive here
 * already merged: `pair` renders one line ("招行储蓄卡 → 建行信用卡"), `half` renders the
 * one leg that made it onto this page and says the other half is elsewhere, and `single`
 * covers everything else, transfers without a pair included (decision §14.52 B15 / B16).
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Transaction, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { absMoney } from '@/domain/money';
import type { ListRow } from '@/domain/transfers';
import { categoryName } from '@/i18n/category';
import { type Lang } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Badge, Button, KindIcon, MoneyText, Text } from '@/ui';

export interface TransactionRowProps {
  row: ListRow;
  baseCurrency: string;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  onPress(row: ListRow): void;
  onEdit(row: ListRow): void;
  onDelete(row: ListRow): void;
  /** Opens the narrow-layout action menu (long press). */
  onOpenMenu(row: ListRow): void;
  onOpenBatch(batchId: Uuid): void;
  onOpenRefundOrigin(txId: Uuid): void;
  testID?: string;
}

/** The row's leading transaction — the "out" leg for a merged pair. */
export function leadTransaction(row: ListRow): Transaction {
  return row.kind === 'pair' ? row.out : row.tx;
}

/** The id a row's own test hooks are built from. */
export function rowKey(row: ListRow): string {
  return row.kind === 'pair' ? row.pairId : row.tx.id;
}

export function TransactionRow({
  row,
  baseCurrency,
  lang,
  index,
  sourceName,
  onPress,
  onEdit,
  onDelete,
  onOpenMenu,
  onOpenBatch,
  onOpenRefundOrigin,
  testID,
}: TransactionRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const [hovered, setHovered] = React.useState(false);

  const tx = leadTransaction(row);
  const id = testID ?? `tx-row-${rowKey(row)}`;

  // ------------------------------------------------------------------- title
  let title: string;
  if (row.kind === 'pair') {
    title = t('transaction:list.row.transfer_pair', {
      from: sourceName(row.out.source_id),
      to: sourceName(row.in.source_id),
    });
  } else if (tx.kind === 'transfer') {
    const here = sourceName(tx.source_id);
    const other = tx.counterparty
      ? t('transaction:list.row.counterparty', { name: tx.counterparty })
      : null;
    if (other === null) title = here;
    else if (tx.transfer_role === 'in') {
      title = t('transaction:list.row.transfer_pair', { from: other, to: here });
    } else {
      title = t('transaction:list.row.transfer_pair', { from: here, to: other });
    }
  } else {
    const l1 = tx.category_l1 ? index?.byCode[tx.category_l1] : undefined;
    const l2 = tx.category_l2 ? index?.byCode[tx.category_l2] : undefined;
    const parts = [
      l1 ? categoryName(l1, lang) : tx.category_l1,
      l2 ? categoryName(l2, lang) : tx.category_l2,
    ].filter((p): p is string => Boolean(p));
    title = parts.length > 0 ? parts.join(' · ') : t('transaction:list.row.uncategorized');
  }

  // ------------------------------------------------------------------ amount
  const crossLegCurrencies = row.kind === 'pair' && row.out.currency !== row.in.currency;
  const amount =
    row.kind === 'pair' ? (
      crossLegCurrencies ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['1'] }}>
          <MoneyText
            amount={row.out.amount}
            currency={row.out.currency}
            kind="transfer"
            lang={lang}
            testID={`${id}-amount-out`}
          />
          <Text variant="caption" tone="muted">
            {t('transaction:list.row.arrow')}
          </Text>
          <MoneyText
            amount={row.in.amount}
            currency={row.in.currency}
            kind="transfer"
            lang={lang}
            signDisplay="always"
            testID={`${id}-amount-in`}
          />
        </View>
      ) : (
        <MoneyText
          amount={absMoney(row.out.amount)}
          currency={row.out.currency}
          kind="transfer"
          lang={lang}
          testID={`${id}-amount`}
        />
      )
    ) : (
      <MoneyText
        amount={tx.amount}
        currency={tx.currency}
        kind={tx.kind}
        lang={lang}
        base={{ amount_base: tx.amount_base, base_currency: baseCurrency }}
        testID={`${id}-amount`}
      />
    );

  // ------------------------------------------------------------------ badges
  const badges: React.ReactNode[] = [];
  if (tx.transfer_subtype === 'repayment') {
    badges.push(
      <Badge
        key="repayment"
        label={t('transaction:list.badge.repayment')}
        tone="info"
        testID={`${id}-badge-repayment`}
      />,
    );
  }
  if (tx.kind === 'refund') {
    badges.push(
      tx.refund_of ? (
        // An inline badge inside a 44-tall row; `hitSlop` gives it the full target
        // without inflating the row's own height.
        // touch-target-exempt: hitSlop inside a 44-tall row
        <Pressable
          key="refund"
          accessibilityRole="button"
          accessibilityLabel={t('transaction:list.row.refund_origin_action')}
          onPress={() => onOpenRefundOrigin(tx.refund_of as Uuid)}
          hitSlop={space['2']}
          testID={`${id}-badge-refund`}
        >
          <Badge label={t('transaction:list.badge.refund')} tone="warning" />
        </Pressable>
      ) : (
        <Badge
          key="refund"
          label={t('transaction:list.badge.refund')}
          tone="warning"
          testID={`${id}-badge-refund`}
        />
      ),
    );
  }
  if (tx.import_batch_id) {
    const batchId = tx.import_batch_id;
    badges.push(
      // An inline badge inside a 44-tall row; `hitSlop` gives it the full target
      // without inflating the row's own height.
      // touch-target-exempt: hitSlop inside a 44-tall row
      <Pressable
        key="imported"
        accessibilityRole="button"
        accessibilityLabel={t('transaction:list.row.imported_action')}
        onPress={() => onOpenBatch(batchId)}
        hitSlop={space['2']}
        testID={`${id}-badge-imported`}
      >
        <Badge label={t('transaction:list.badge.imported')} tone="neutral" />
      </Pressable>,
    );
  }

  const meta =
    row.kind === 'pair'
      ? formatDate(tx.occurred_at, lang)
      : `${formatDate(tx.occurred_at, lang)} · ${sourceName(tx.source_id)}`;

  return (
    // touch-target-exempt: minHeight 44 is set in the style callback below
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => onPress(row)}
      onLongPress={wide ? undefined : () => onOpenMenu(row)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      testID={id}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: radius.md,
        paddingVertical: space['3'],
        paddingHorizontal: space['2'],
        backgroundColor: pressed || hovered ? colors['bg.hover'] : 'transparent',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space['3'] }}>
        <KindIcon kind={tx.kind} size={32} testID={`${id}-kind`} />

        <View style={{ flex: 1, gap: space['1'] }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' }}
          >
            <Text variant="subheading" numberOfLines={1} testID={`${id}-title`}>
              {title}
            </Text>
            {tx.merchant ? (
              <Text variant="body" tone="secondary" numberOfLines={1} testID={`${id}-merchant`}>
                {tx.merchant}
              </Text>
            ) : null}
            {badges}
          </View>
          {tx.note ? (
            <Text variant="caption" tone="muted" numberOfLines={2} testID={`${id}-note`}>
              {tx.note}
            </Text>
          ) : null}
          {row.kind === 'half' ? (
            <Text variant="micro" tone="muted" testID={`${id}-half-hint`}>
              {t('transaction:list.another_half_hint')}
            </Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end', gap: space['1'] }}>
          {amount}
          <Text variant="caption" tone="muted" mono testID={`${id}-meta`}>
            {meta}
          </Text>
        </View>

        {wide ? (
          // 04 §4.5: the wide layout puts edit / delete on the row itself. They stay in
          // the tree (and in the accessibility tree) at all times and only gain emphasis
          // on hover — buttons that appear out of nowhere are unreachable by keyboard.
          <View
            style={{
              flexDirection: 'row',
              gap: space['1'],
              opacity: hovered ? 1 : 0.55,
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              icon="pencil"
              iconOnly
              accessibilityLabel={t('common:button.edit')}
              onPress={() => onEdit(row)}
              testID={`${id}-edit`}
            />
            <Button
              variant="ghost"
              size="sm"
              icon="trash-2"
              iconOnly
              accessibilityLabel={t('common:button.delete')}
              onPress={() => onDelete(row)}
              testID={`${id}-delete`}
            />
          </View>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon="more-horizontal"
            iconOnly
            accessibilityLabel={t('transaction:list.row.open_menu')}
            onPress={() => onOpenMenu(row)}
            testID={`${id}-menu`}
          />
        )}
      </View>
    </Pressable>
  );
}
