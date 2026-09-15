/**
 * The wide layout's account table (屏幕稿 09 · 账户列表 1440).
 *
 * Six columns — 账户 / 类型 / 币种 / 余额 · 原币 / 折算 <base> / ··· — in one white card with
 * a tinted head strip and a foot strip carrying 「合计 · 在用」, the 「混合币种」 caveat and the
 * net worth of the accounts above it. The mockup drops the per-type group cards the text
 * spec drew: the type badge in every row and the foot total carry §14.50's reading instead
 * (decision §14.45 — the mockups are the visual source of truth).
 *
 * The same grid is reused by the archived block, which swaps the 折算 column for 「归档于 …」.
 */
import React from 'react';
import { Pressable, ScrollView, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource } from '@/api/types';
import type { Lang } from '@/i18n';
import { formatAmountPlain, formatDate } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Badge, type BadgeTone, ListCard, SourceTypeIcon, Text, sourceTypeLabelKey } from '@/ui';

import { SourceRowMenu } from './SourceRowMenu';
import { balanceText, balanceTone, isForeign } from './sourceFormat';

/** 屏幕稿 09: 12px above and below a 34 icon well — a 60 row. */
const ROW_HEIGHT = 60;
const GRID_GAP = space['3'] + 2;
const GRID_PADDING = space['5'];
/** Narrower than this and six columns stop being readable; the card scrolls instead. */
const MIN_TABLE_WIDTH = 820;

/** The mockup's grid: one elastic name column, three fixed, two elastic numbers, 44 for ···. */
const COLUMNS = [
  { key: 'name', flex: 1.3, minWidth: 150 },
  { key: 'type', width: 120 },
  { key: 'currency', width: 88 },
  { key: 'balance', flex: 1, minWidth: 120, align: 'right' as const },
  { key: 'converted', flex: 1, minWidth: 110, align: 'right' as const },
  { key: 'menu', width: 44, align: 'right' as const },
] as const;

type Column = (typeof COLUMNS)[number];

/** Everything but the trailing 「···」 column, which is drawn outside the row's press target. */
const BODY_COLUMNS = COLUMNS.slice(0, -1);
const MENU_COLUMN = COLUMNS[COLUMNS.length - 1];

/** Account types wear the same four tints as their icon wells (屏幕稿 09). */
export const SOURCE_TYPE_BADGE: Readonly<Record<FinanceSource['type'], BadgeTone>> = {
  checking: 'accent',
  credit: 'danger',
  cash: 'warning',
  other: 'info',
};

function cellStyle(column: Column): StyleProp<ViewStyle> {
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

export interface SourceTableRowProps {
  source: FinanceSource;
  baseCurrency: string;
  lang: Lang;
  onOpen(source: FinanceSource): void;
  onDelete(source: FinanceSource): void;
  /** `true` after the server refused a delete with `source_has_transactions`. */
  deleteBlocked?: boolean;
}

/** The 折算 cell of an active row: the converted value, or 「—」 in the base currency. */
function ConvertedCell({
  source,
  baseCurrency,
  lang,
}: {
  source: FinanceSource;
  baseCurrency: string;
  lang: Lang;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!isForeign(source, baseCurrency)) {
    return (
      <Text variant="body" tone="muted" mono testID={`source-converted-${source.id}`}>
        {t('source:list.same_currency')}
      </Text>
    );
  }
  if (source.balance_base === null) {
    return (
      <Text variant="caption" tone="warning" testID={`source-converted-${source.id}`}>
        {t('source:list.no_rate_cell')}
      </Text>
    );
  }
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text
        variant="body"
        tone="muted"
        mono
        testID={`source-balance-base-${source.id}`}
      >
        {formatAmountPlain(source.balance_base, baseCurrency)}
      </Text>
      {source.balance_rate_date !== null ? (
        <Text variant="micro" tone="muted" testID={`source-rate-date-${source.id}`}>
          {t('source:list.rate_date', { date: formatDate(source.balance_rate_date, lang) })}
        </Text>
      ) : null}
    </View>
  );
}

/** One table row. Archived rows are the same grid, greyed, with the archive date on the
 *  right (屏幕稿 09: 「归档于 2025-11」). */
export function SourceTableRow({
  source,
  baseCurrency,
  lang,
  onOpen,
  onDelete,
  deleteBlocked = false,
}: SourceTableRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [hovered, setHovered] = React.useState(false);
  const muted = source.archived;

  const cells: Record<string, React.ReactNode> = {
    name: (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'], minWidth: 0 }}>
        <SourceTypeIcon type={source.type} size={34} />
        <Text
          variant="subheading"
          weight={500}
          tone={muted ? 'muted' : 'primary'}
          numberOfLines={1}
          style={{ flexShrink: 1 }}
          testID={`source-name-${source.id}`}
        >
          {source.name}
        </Text>
      </View>
    ),
    type: (
      <Badge
        label={t(sourceTypeLabelKey(source.type))}
        tone={muted ? 'neutral' : SOURCE_TYPE_BADGE[source.type]}
        testID={`source-type-badge-${source.id}`}
      />
    ),
    currency: (
      <Text variant="body" tone={muted ? 'muted' : 'secondary'} mono>
        {source.default_currency}
      </Text>
    ),
    balance: (
      <Text
        variant="subheading"
        mono
        weight={500}
        tone={balanceTone(source, muted)}
        numberOfLines={1}
        style={{ fontSize: 17, lineHeight: 23 }}
        testID={`source-balance-${source.id}`}
      >
        {balanceText(source, lang)}
      </Text>
    ),
    converted: muted ? (
      <Text variant="caption" tone="muted" mono testID={`source-archived-at-${source.id}`}>
        {source.archived_at === null
          ? ''
          : t('source:list.archived_at', {
              date: formatDate(source.archived_at.slice(0, 10), lang),
            })}
      </Text>
    ) : (
      <ConvertedCell source={source} baseCurrency={baseCurrency} lang={lang} />
    ),
  };

  return (
    <View style={{ opacity: muted ? 0.7 : 1 }}>
      {/* The 「···」 menu is a sibling of the row's press target, never a child of it: a
          button inside a button is invalid on the web and swallows the inner click. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GRID_GAP, paddingRight: GRID_PADDING }}>
        {/* touch-target-exempt: the row is ROW_HEIGHT (60) tall. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={source.name}
          onPress={() => onOpen(source)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          testID={`source-row-${source.id}`}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: GRID_GAP,
            paddingLeft: GRID_PADDING,
            minHeight: ROW_HEIGHT,
            paddingVertical: space['2'],
            backgroundColor: pressed || hovered ? colors['bg.hover'] : 'transparent',
          })}
        >
          {BODY_COLUMNS.map((column) => (
            <View key={column.key} style={cellStyle(column)}>
              {cells[column.key]}
            </View>
          ))}
        </Pressable>
        <View style={cellStyle(MENU_COLUMN)}>
          <SourceRowMenu source={source} onOpen={onOpen} onDelete={onDelete} />
        </View>
      </View>
      {deleteBlocked ? (
        <Text
          variant="caption"
          tone="danger"
          testID={`source-delete-blocked-${source.id}`}
          style={{ paddingHorizontal: GRID_PADDING, paddingBottom: space['2'] }}
        >
          {t('source:list.delete_disabled_hint')}
        </Text>
      ) : null}
    </View>
  );
}

export interface SourcesTableProps {
  sources: readonly FinanceSource[];
  baseCurrency: string;
  lang: Lang;
  /** Net worth of the rows above the foot strip, already converted. */
  total: string;
  /** Says 「混合币种」 under the total when the rows are not all in one currency. */
  mixed: boolean;
  onOpen(source: FinanceSource): void;
  onDelete(source: FinanceSource): void;
  deleteBlockedId: string | null;
  testID?: string;
}

export function SourcesTable(props: SourcesTableProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = props.testID ?? 'sources-table';

  const head = (
    <View style={[gridRow, { paddingVertical: space['3'], backgroundColor: colors['bg.canvas'] }]}>
      {COLUMNS.map((column) => (
        <View key={column.key} style={cellStyle(column)} testID={`${id}-head-${column.key}`}>
          <Text variant="micro" tone="secondary" mono weight={600} numberOfLines={1}>
            {column.key === 'menu'
              ? ''
              : column.key === 'converted'
                ? t('source:list.table.converted', { currency: props.baseCurrency })
                : t(`source:list.table.${column.key}`)}
          </Text>
        </View>
      ))}
    </View>
  );

  const foot = (
    <View
      style={[
        gridRow,
        { paddingVertical: space['4'], backgroundColor: colors['bg.canvas'] },
      ]}
    >
      <View style={cellStyle(COLUMNS[0])}>
        <Text variant="body" weight={600} testID={`${id}-total-label`}>
          {t('source:list.total_active')}
        </Text>
      </View>
      <View style={cellStyle(COLUMNS[1])} />
      <View style={cellStyle(COLUMNS[2])} />
      <View style={cellStyle(COLUMNS[3])}>
        {props.mixed ? (
          <Text variant="body" tone="muted" mono testID={`${id}-mixed`}>
            {t('source:list.mixed_currencies')}
          </Text>
        ) : null}
      </View>
      <View style={cellStyle(COLUMNS[4])}>
        <Text
          variant="subheading"
          mono
          weight={600}
          style={{ fontSize: 17, lineHeight: 23 }}
          testID="sources-net-worth"
        >
          {props.total}
        </Text>
      </View>
      <View style={cellStyle(COLUMNS[5])} />
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
        divided
        style={{ minWidth: MIN_TABLE_WIDTH, flexGrow: 1 }}
      >
        {props.sources.map((source) => (
          <SourceTableRow
            key={source.id}
            source={source}
            baseCurrency={props.baseCurrency}
            lang={props.lang}
            onOpen={props.onOpen}
            onDelete={props.onDelete}
            deleteBlocked={props.deleteBlockedId === source.id}
          />
        ))}
      </ListCard>
    </ScrollView>
  );
}
