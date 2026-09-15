/**
 * The wide layout's transaction table (屏幕稿 02 · 交易列表 1440).
 *
 * Seven columns — 日期 / 种类 / 商户 / 分类 / 账户 / 备注 / 金额 — in one white card with a
 * tinted head strip and a foot strip that says how much of the filtered result is on
 * screen and what the net of the whole result is. No day grouping here: the date column
 * already carries the day, and the mockup's wide frame is a true table. Day grouping stays
 * on the narrow layout (`DayGroup.tsx`).
 *
 * Rows arrive already merged (`mergeTransferRows`), so a two-leg transfer is one line:
 * 商户 reads 「招行储蓄卡 → 建行信用卡」 and 账户 names both ends. A row has no inline edit or
 * delete — those live on the detail page the row opens (decision §14.56).
 */
import React from 'react';
import { Pressable, ScrollView, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TransactionSummary, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { absMoney } from '@/domain/money';
import type { ListRow } from '@/domain/transfers';
import { type Lang } from '@/i18n';
import { formatDateShort, formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { KindBadge, ListCard, MoneyText, Text } from '@/ui';

import { RowBadges, categoryPath, leadTransaction, rowKey } from './TransactionRow';

/** 屏幕稿 02: 13px of padding above and below a 26-high badge — a 52 row. */
const ROW_HEIGHT = 52;
/** The mockup's grid: two fixed narrow columns, three fixed-ish ones, three elastic. */
const COLUMNS = [
  { key: 'date', width: 104 },
  { key: 'kind', width: 92 },
  { key: 'merchant', flex: 1.25, minWidth: 130 },
  { key: 'category', flex: 1, minWidth: 100 },
  { key: 'source', width: 150 },
  { key: 'note', flex: 1.1, minWidth: 100 },
  { key: 'amount', width: 168, align: 'right' as const },
] as const;

const GRID_GAP = space['3'] + 2;
const GRID_PADDING = space['5'];
/** Narrower than this and the seven columns stop being readable; the card scrolls instead. */
const MIN_TABLE_WIDTH = 940;

function cellStyle(column: (typeof COLUMNS)[number]): StyleProp<ViewStyle> {
  const width = 'width' in column ? column.width : undefined;
  const flex = 'flex' in column ? column.flex : undefined;
  const minWidth = 'minWidth' in column ? column.minWidth : undefined;
  return {
    width,
    flexGrow: flex,
    flexShrink: flex === undefined ? 0 : 1,
    flexBasis: flex === undefined ? undefined : 0,
    minWidth: minWidth ?? 0,
    alignItems: 'align' in column ? 'flex-end' : 'stretch',
  };
}

const gridRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: GRID_GAP,
  paddingHorizontal: GRID_PADDING,
};

export interface TransactionsTableProps {
  rows: readonly ListRow[];
  baseCurrency: string;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  onPressRow(row: ListRow): void;
  /** Entries the server matched, and how many of them this page shows. */
  total: number;
  shown: number;
  summary?: TransactionSummary;
  /** The pager, drawn under the counts in the foot strip. */
  pager?: React.ReactNode;
  /** Rendered under three ghost rows when there is nothing to show (屏幕稿 15). */
  empty?: React.ReactNode;
  testID?: string;
}

export function TransactionsTable(props: TransactionsTableProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = props.testID ?? 'tx-table';
  const bare = props.rows.length === 0;

  const head = (
    <View style={[gridRow, { paddingVertical: space['3'], backgroundColor: colors['bg.canvas'] }]}>
      {COLUMNS.map((column) => (
        <View key={column.key} style={cellStyle(column)} testID={`${id}-head-${column.key}`}>
          <Text variant="micro" tone={bare ? 'muted' : 'secondary'} mono weight={600} numberOfLines={1}>
            {t(`transaction:list.table.${column.key}`)}
          </Text>
        </View>
      ))}
    </View>
  );

  const foot = (
    <View style={{ backgroundColor: colors['bg.canvas'] }}>
      <View
        style={[
          gridRow,
          { paddingVertical: space['4'], justifyContent: 'space-between', flexWrap: 'wrap' },
        ]}
      >
        <Text variant="caption" tone="muted" mono testID={`${id}-shown`}>
          {t('transaction:list.table.shown', { count: props.shown, total: props.total })}
        </Text>
        {/* Same rule as the page header: 屏幕稿 15 shows no money on an empty result. */}
        {props.summary && props.total > 0 ? (
          <Text variant="body" tone="secondary" mono testID={`${id}-net`}>
            {`${t('transaction:list.table.net')} `}
            <Text
              variant="body"
              mono
              tone={Number(props.summary.net) < 0 ? 'expense' : 'income'}
            >
              {formatMoney(props.summary.net, props.summary.base_currency, props.lang, {
                signDisplay: 'always',
              })}
            </Text>
          </Text>
        ) : null}
      </View>
      {props.pager}
    </View>
  );

  return (
    <ScrollView
      horizontal
      testID={`${id}-hscroll`}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ minWidth: '100%', flexGrow: 1 }}
    >
      <ListCard
        testID={id}
        header={head}
        footer={foot}
        style={{ minWidth: MIN_TABLE_WIDTH, flexGrow: 1 }}
      >
        {bare ? (
          <View testID={`${id}-ghost`} style={{ paddingVertical: space['3'] }}>
            {[0.85, 0.6, 0.4].map((opacity, i) => (
              <View key={i} style={[gridRow, { paddingVertical: space['3'], opacity }]}>
                {COLUMNS.map((column) => (
                  <View key={column.key} style={cellStyle(column)}>
                    <View
                      style={{
                        height: 11,
                        alignSelf: 'stretch',
                        borderRadius: radius.pill,
                        backgroundColor: colors['bg.subtle'],
                      }}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}
        {bare && props.empty !== undefined ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors['border.default'] }}>
            {props.empty}
          </View>
        ) : null}
        {bare
          ? null
          : props.rows.map((row) => (
              <TableRow key={rowKey(row)} {...props} row={row} id={id} />
            ))}
      </ListCard>
    </ScrollView>
  );
}

function TableRow({
  row,
  baseCurrency,
  lang,
  index,
  sourceName,
  onPressRow,
  id,
}: TransactionsTableProps & { row: ListRow; id: string }): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [hovered, setHovered] = React.useState(false);
  const tx = leadTransaction(row);
  const rowId = `tx-row-${rowKey(row)}`;
  const dash = t('transaction:list.row.empty');

  // ------------------------------------------------------------------ columns
  let merchant: string;
  let account: string;
  if (row.kind === 'pair') {
    const from = sourceName(row.out.source_id);
    const to = sourceName(row.in.source_id);
    merchant = t('transaction:list.row.transfer_pair', { from, to });
    account = merchant;
  } else if (tx.kind === 'transfer') {
    const here = sourceName(tx.source_id);
    merchant = tx.counterparty
      ? t('transaction:list.row.counterparty', { name: tx.counterparty })
      : here;
    account = here;
  } else {
    merchant = tx.merchant ?? dash;
    account = sourceName(tx.source_id);
  }

  const category = categoryPath(tx, index, lang, t) ?? dash;

  const note =
    row.kind === 'half' ? t('transaction:list.another_half_hint') : (tx.note ?? dash);

  const crossLeg = row.kind === 'pair' && row.out.currency !== row.in.currency;
  const amount =
    row.kind === 'pair' ? (
      crossLeg ? (
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText
            amount={row.out.amount}
            currency={row.out.currency}
            kind="transfer"
            lang={lang}
            testID={`${rowId}-amount-out`}
          />
          <MoneyText
            amount={row.in.amount}
            currency={row.in.currency}
            kind="transfer"
            lang={lang}
            signDisplay="always"
            size="caption"
            testID={`${rowId}-amount-in`}
          />
        </View>
      ) : (
        <MoneyText
          amount={absMoney(row.out.amount)}
          currency={row.out.currency}
          kind="transfer"
          lang={lang}
          style={{ alignItems: 'flex-end' }}
          testID={`${rowId}-amount`}
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
        testID={`${rowId}-amount`}
      />
    );

  const cells: Record<string, React.ReactNode> = {
    date: (
      <Text variant="body" tone="secondary" mono numberOfLines={1} testID={`${rowId}-date`}>
        {formatDateShort(tx.occurred_at)}
      </Text>
    ),
    kind: <KindBadge kind={tx.kind} testID={`${rowId}-kind`} />,
    merchant: (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
        <Text
          variant="subheading"
          numberOfLines={1}
          style={{ flexShrink: 1 }}
          testID={`${rowId}-title`}
        >
          {merchant}
        </Text>
        <RowBadges tx={tx} id={rowId} />
      </View>
    ),
    category: (
      <Text variant="body" tone="secondary" numberOfLines={1} testID={`${rowId}-category`}>
        {category}
      </Text>
    ),
    source: (
      <Text variant="caption" tone="secondary" numberOfLines={1} testID={`${rowId}-source`}>
        {account}
      </Text>
    ),
    note: (
      <Text variant="caption" tone="muted" numberOfLines={1} testID={`${rowId}-note`}>
        {note}
      </Text>
    ),
    amount,
  };

  return (
    // touch-target-exempt: the row is ROW_HEIGHT (52) tall plus its own vertical padding
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={merchant}
      onPress={() => onPressRow(row)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      testID={rowId}
      style={({ pressed }) => [
        gridRow,
        {
          minHeight: ROW_HEIGHT,
          paddingVertical: space['2'],
          backgroundColor: pressed || hovered ? colors['bg.hover'] : 'transparent',
        },
      ]}
    >
      {COLUMNS.map((column) => (
        <View key={column.key} style={cellStyle(column)}>
          {cells[column.key]}
        </View>
      ))}
    </Pressable>
  );
}
