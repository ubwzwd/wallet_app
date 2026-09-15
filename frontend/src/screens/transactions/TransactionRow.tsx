/**
 * One row of the narrow transaction list (屏幕稿 02 · 交易列表 375).
 *
 * Three lines against a round kind well, with the amount — and its converted second line —
 * right-aligned: 商户 / 分类 · 账户 / 备注. A row is a `ListRow` from `mergeTransferRows`, so
 * the two legs of a transfer arrive here already merged: `pair` renders one line ("招行储蓄
 * 卡 → 建行信用卡"), `half` renders the one leg that made it onto this page and says the
 * other half is elsewhere, and `single` covers everything else, transfers without a pair
 * included (decision §14.52 B15 / B16).
 *
 * The mockup draws no per-row action button; 编辑 / 删除 live on the detail page and behind
 * a long press (decision §14.56). The wide layout uses `TransactionsTable` instead.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Transaction, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { absMoney } from '@/domain/money';
import type { ListRow } from '@/domain/transfers';
import { categoryName } from '@/i18n/category';
import { type Lang } from '@/i18n';
import { density, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Badge, Button, KindIcon, MoneyText, Sheet, Text } from '@/ui';

export interface TransactionRowProps {
  row: ListRow;
  baseCurrency: string;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  onPress(row: ListRow): void;
  /** Opens the action menu (long press). */
  onOpenMenu(row: ListRow): void;
  testID?: string;
}

/**
 * 编辑 / 删除 for one row. The mockup draws no per-row button, so the way in is a long
 * press on the row (04 §4.5's narrow-layout row actions); the wide table sends the user to
 * the detail page instead, where the same two actions live.
 */
export function RowMenu({
  row,
  onClose,
  onEdit,
  onDelete,
}: {
  row: ListRow | null;
  onClose(): void;
  onEdit(row: ListRow): void;
  onDelete(row: ListRow): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const run = (action: (row: ListRow) => void): void => {
    onClose();
    if (row) action(row);
  };
  return (
    <Sheet
      open={row !== null}
      onClose={onClose}
      title={t('transaction:list.row.menu_title')}
      closeLabel={t('common:button.close')}
      testID="tx-row-menu"
    >
      <View style={{ gap: space['2'] }}>
        <Button
          variant="secondary"
          icon="pencil"
          label={t('common:button.edit')}
          fullWidth
          onPress={() => run(onEdit)}
          testID="tx-row-menu-edit"
        />
        <Button
          variant="danger"
          icon="trash-2"
          label={t('common:button.delete')}
          fullWidth
          onPress={() => run(onDelete)}
          testID="tx-row-menu-delete"
        />
      </View>
    </Sheet>
  );
}

/** The row's leading transaction — the "out" leg for a merged pair. */
export function leadTransaction(row: ListRow): Transaction {
  return row.kind === 'pair' ? row.out : row.tx;
}

/** The id a row's own test hooks are built from. */
export function rowKey(row: ListRow): string {
  return row.kind === 'pair' ? row.pairId : row.tx.id;
}

/** `餐饮 / 零食饮料`, or the single level, or `null` when the row has no category. */
export function categoryPath(
  tx: Transaction,
  index: CategoryIndex | null,
  lang: Lang,
  t: TFunction,
): string | null {
  const l1 = tx.category_l1 ? index?.byCode[tx.category_l1] : undefined;
  const l2 = tx.category_l2 ? index?.byCode[tx.category_l2] : undefined;
  const l1Name = l1 ? categoryName(l1, lang) : tx.category_l1;
  const l2Name = l2 ? categoryName(l2, lang) : tx.category_l2;
  if (!l1Name) return null;
  return l2Name ? t('transaction:list.row.category_path', { l1: l1Name, l2: l2Name }) : l1Name;
}

/**
 * The marks 04 §4.5 requires on a row: 还款 on a repayment leg, 退款 on a refund, 导入 on a
 * row that came from a batch. Shared by the narrow row and the wide table.
 *
 * Every badge is plain text, never a button: the whole row is already a press target, and a
 * `<button>` inside a `<button>` is invalid HTML — the browser logs a hydration error and
 * swallows one of the two clicks. 屏幕稿 02 draws no control in the 商户 column either;
 * 「看原单」 / 「看批次」 live on the detail page, where the fact list links them.
 */
export function RowBadges({
  tx,
  id,
}: {
  tx: Transaction;
  id: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
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
      <Badge
        key="refund"
        label={t('transaction:list.badge.refund')}
        tone="warning"
        testID={`${id}-badge-refund`}
      />,
    );
  }
  if (tx.import_batch_id) {
    badges.push(
      <Badge
        key="imported"
        label={t('transaction:list.badge.imported')}
        tone="neutral"
        testID={`${id}-badge-imported`}
      />,
    );
  }

  if (badges.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['1'], flexShrink: 0 }}>
      {badges}
    </View>
  );
}

export function TransactionRow({
  row,
  baseCurrency,
  lang,
  index,
  sourceName,
  onPress,
  onOpenMenu,
  testID,
}: TransactionRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [hovered, setHovered] = React.useState(false);

  const tx = leadTransaction(row);
  const id = testID ?? `tx-row-${rowKey(row)}`;

  // ------------------------------------------------------- title and meta line
  let title: string;
  let meta: string;
  if (row.kind === 'pair') {
    title = t('transaction:list.row.transfer_pair', {
      from: sourceName(row.out.source_id),
      to: sourceName(row.in.source_id),
    });
    meta = t('transaction:list.row.empty');
  } else {
    const account = sourceName(tx.source_id);
    if (tx.kind === 'transfer') {
      const other = tx.counterparty
        ? t('transaction:list.row.counterparty', { name: tx.counterparty })
        : null;
      if (other === null) title = account;
      else if (tx.transfer_role === 'in') {
        title = t('transaction:list.row.transfer_pair', { from: other, to: account });
      } else {
        title = t('transaction:list.row.transfer_pair', { from: account, to: other });
      }
      meta = account;
    } else {
      const path = categoryPath(tx, index, lang, t);
      title = tx.merchant ?? path ?? t('transaction:list.row.uncategorized');
      const category = path ?? t('transaction:list.row.uncategorized');
      meta = tx.merchant
        ? t('transaction:list.row.meta', { category, source: account })
        : account;
    }
  }

  const note = row.kind === 'half' ? t('transaction:list.another_half_hint') : tx.note;

  // ------------------------------------------------------------------ amount
  const crossLegCurrencies = row.kind === 'pair' && row.out.currency !== row.in.currency;
  const amount =
    row.kind === 'pair' ? (
      crossLegCurrencies ? (
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText
            amount={row.out.amount}
            currency={row.out.currency}
            kind="transfer"
            lang={lang}
            testID={`${id}-amount-out`}
          />
          <MoneyText
            amount={row.in.amount}
            currency={row.in.currency}
            kind="transfer"
            lang={lang}
            size="caption"
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
          style={{ alignItems: 'flex-end' }}
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
        style={{ alignItems: 'flex-end' }}
        testID={`${id}-amount`}
      />
    );

  return (
    // touch-target-exempt: minHeight density.listRowHeight (56) is set in the style below
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={t('transaction:list.row.open_menu')}
      onPress={() => onPress(row)}
      onLongPress={() => onOpenMenu(row)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      testID={id}
      style={({ pressed }) => ({
        minHeight: density.listRowHeight,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space['3'],
        paddingVertical: space['3'] - 2,
        paddingHorizontal: density.rowInnerPadding,
        backgroundColor: pressed || hovered ? colors['bg.hover'] : 'transparent',
      })}
    >
      <KindIcon kind={tx.kind} size={34} style={{ marginTop: 1 }} testID={`${id}-kind`} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          <Text
            variant="subheading"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
            testID={`${id}-title`}
          >
            {title}
          </Text>
          <RowBadges tx={tx} id={id} />
        </View>
        <Text variant="caption" tone="secondary" numberOfLines={1} testID={`${id}-meta`}>
          {meta}
        </Text>
        {note ? (
          <Text variant="caption" tone="muted" numberOfLines={1} testID={`${id}-note`}>
            {note}
          </Text>
        ) : null}
      </View>

      <View style={{ flexShrink: 0 }}>{amount}</View>
    </Pressable>
  );
}
