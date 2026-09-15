/**
 * The transaction list's filter bar (04 §4.5, 屏幕稿 02).
 *
 * Two frames for one set of controls (`FilterFields.tsx` owns the fields themselves):
 *  - **wide** — the 「筛选」 white card: a title row with 「重置全部」, a three-column grid of
 *    labelled fields, a rule, the 种类 pills, another rule, and the 「已选条件」 chip strip.
 *  - **narrow** — the search box plus a square filter button carrying the active-condition
 *    count, the chip strip under it, and every field behind `FilterSheet`.
 *
 * The split is by viewport width (`useIsWide`), never by platform. Every control writes to
 * the URL; nothing here keeps a copy of the filter state.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { FinanceSource, TransactionListParams, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { filterChips, type FilterChip as DomainFilterChip } from '@/domain/filters';
import { categoryName } from '@/i18n/category';
import { type Lang } from '@/i18n';
import { formatAmountPlain, formatDate } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, Divider, FilterChips, Icon, Text, TextField } from '@/ui';

import {
  AmountRangeField,
  CategoryField,
  CurrencyChips,
  DateRangeField,
  KeywordField,
  KindChips,
  type FilterFieldProps,
} from './FilterFields';
import { FilterSheet, SourceField } from './FilterSheet';

/** Everything the chip / suggestion labels need to turn a raw query value into words. */
export interface FilterLabelCtx {
  t: TFunction;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  baseCurrency: string;
}

/** One active condition, rendered the way a person would say it (04 §4.5). */
export function filterChipLabel(chip: DomainFilterChip, ctx: FilterLabelCtx): string {
  const { t, lang } = ctx;
  switch (chip.key) {
    case 'q':
      return t('transaction:list.chip.q', { value: chip.value });
    case 'kind':
      return t('transaction:list.chip.kind', { value: t(`transaction:kind.${chip.value}`) });
    case 'source_id':
      return t('transaction:list.chip.source', { value: ctx.sourceName(chip.value) });
    case 'category_l1':
    case 'category_l2': {
      const category = ctx.index?.byCode[chip.value];
      return t('transaction:list.chip.category', {
        value: category ? categoryName(category, lang) : chip.value,
      });
    }
    case 'from':
      return t('transaction:list.chip.from', { value: formatDate(chip.value, lang) });
    case 'to':
      return t('transaction:list.chip.to', { value: formatDate(chip.value, lang) });
    case 'currency':
      return t('transaction:list.chip.currency', { value: chip.value });
    case 'min_amount':
      return t('transaction:list.chip.min_amount', {
        value: formatAmountPlain(chip.value, ctx.baseCurrency),
      });
    case 'max_amount':
      return t('transaction:list.chip.max_amount', {
        value: formatAmountPlain(chip.value, ctx.baseCurrency),
      });
    case 'import_batch_id':
      // Decision §14.46 (04-D-7): the batch is identified by its short number, not a UUID.
      return t('transaction:list.chip.from_batch', { batch: chip.value.slice(0, 6) });
    default:
      return chip.value;
  }
}

export interface FilterBarProps {
  filters: TransactionListParams;
  activeCount: number;
  qDraft: string;
  onQChange(value: string): void;
  onPatch(next: Partial<TransactionListParams>): void;
  onRemove(key: keyof TransactionListParams, value?: string): void;
  onClear(): void;
  sources: readonly FinanceSource[];
  index: CategoryIndex | null;
  baseCurrency: string;
  lang: Lang;
  /** Entries the current filters match — the sheet's 「应用 · N 笔」 number. */
  total: number;
  testID?: string;
}

/**
 * The currency pills offer what this ledger's accounts actually hold (屏幕稿 02), plus the
 * base currency and whatever a shared URL already asks for, so an inherited filter is
 * always visible as a pill that can be switched off again.
 */
function currencyCodesOf(props: FilterBarProps): string[] {
  const codes = new Set<string>([props.baseCurrency]);
  for (const source of props.sources) codes.add(source.default_currency);
  if (props.filters.currency) codes.add(props.filters.currency);
  return [...codes].sort();
}

/**
 * Whether the narrow drawer is open, kept outside the component on purpose: every control
 * in it writes the URL, expo-router remounts the screen for the replaced URL (04 §1.3), and
 * component state would not survive that — the drawer would slam shut on the first pill the
 * user touched. 屏幕稿 02 has them set several conditions and then press 「应用」, so the flag
 * outlives the remount; it is cleared when the drawer is closed and when the screen is left
 * for good, so coming back to /transactions never reopens it by itself.
 */
let drawerOpen = false;
/**
 * The wide panel's twin (§14.59b): once conditions are on, 屏幕稿 02's three-column card
 * collapses to the 「已选条件」 strip and a 「筛选」 button, so the table starts at the top of
 * the page instead of below a screenful of empty boxes. Module-level for the same reason as
 * `drawerOpen`: every control writes the URL and the screen remounts.
 */
let panelOpen = false;
/** Pending reset of `drawerOpen`, armed on unmount and cancelled by a remount in the same tick. */
let closeTimer: ReturnType<typeof setTimeout> | null = null;

export function FilterBar(props: FilterBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const [sheetOpen, setSheetOpen] = React.useState(drawerOpen);
  const [expanded, setExpanded] = React.useState(panelOpen);
  const setDrawer = React.useCallback((open: boolean): void => {
    drawerOpen = open;
    setSheetOpen(open);
  }, []);
  const setPanel = React.useCallback((open: boolean): void => {
    panelOpen = open;
    setExpanded(open);
  }, []);
  // A filter change remounts the screen, and the drawer must survive that; leaving the
  // screen must close it. Unmount arms a reset, a remount in the same tick cancels it.
  React.useEffect(() => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    return () => {
      closeTimer = setTimeout(() => {
        drawerOpen = false;
        panelOpen = false;
      }, 0);
    };
  }, []);
  const id = props.testID ?? 'tx-filter-bar';

  const sourceName = React.useCallback(
    (sid: Uuid): string => props.sources.find((s) => s.id === sid)?.name ?? sid.slice(0, 6),
    [props.sources],
  );

  const labelCtx: FilterLabelCtx = {
    t,
    lang: props.lang,
    index: props.index,
    sourceName,
    baseCurrency: props.baseCurrency,
  };

  const chips = filterChips(props.filters).map((chip) => ({
    key: chip.key as string,
    value: chip.value,
    label: filterChipLabel(chip, labelCtx),
  }));

  const fields: FilterFieldProps = {
    filters: props.filters,
    onPatch: props.onPatch,
    index: props.index,
    sources: props.sources,
    currencyCodes: currencyCodesOf(props),
    baseCurrency: props.baseCurrency,
    lang: props.lang,
    id,
  };

  const chipStrip = (
    <View
      testID={`${id}-applied`}
      style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] }}
    >
      <Text variant="caption" tone="secondary" weight={600}>
        {t('transaction:list.filter.applied_label')}
      </Text>
      {chips.length === 0 ? (
        <Text variant="body" tone="muted">
          {t('transaction:list.filter.no_filters')}
        </Text>
      ) : (
        <FilterChips
          chips={chips}
          clearFrom={1}
          onRemove={(key, value) => props.onRemove(key as keyof TransactionListParams, value)}
          onClear={props.onClear}
          testID={`${id}-chips`}
        />
      )}
    </View>
  );

  if (wide) {
    // Collapsed: one line of what is on, and the way back to the panel (§14.59b).
    if (chips.length > 0 && !expanded) {
      return (
        <Card
          testID={id}
          style={{
            paddingVertical: space['3'] + 2,
            paddingHorizontal: space['5'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: space['4'],
            flexWrap: 'wrap',
          }}
        >
          <View style={{ flex: 1, minWidth: 240 }}>{chipStrip}</View>
          <Button
            variant="secondary"
            size="sm"
            icon="filter"
            label={t('transaction:list.filter.open')}
            onPress={() => setPanel(true)}
            testID={`${id}-expand`}
          />
        </Card>
      );
    }

    return (
      <Card testID={id} style={{ padding: space['5'], gap: space['4'] }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space['4'] }}
        >
          <Text variant="subheading" weight={700}>
            {t('transaction:list.filter.title')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['1'] }}>
            <Button
              variant="ghost"
              size="sm"
              label={t('transaction:list.filter.reset_all')}
              onPress={props.onClear}
              testID={`${id}-reset`}
            />
            {chips.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                label={t('transaction:list.filter.collapse')}
                onPress={() => setPanel(false)}
                testID={`${id}-collapse`}
              />
            ) : null}
          </View>
        </View>

        <View
          testID={`${id}-controls`}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['5'] }}
        >
          {[
            <KeywordField key="q" value={props.qDraft} onChange={props.onQChange} id={`${id}-q`} />,
            <SourceField key="source" {...fields} />,
            <CurrencyChips key="currency" {...fields} />,
            <AmountRangeField key="amount" {...fields} />,
            <DateRangeField key="date" {...fields} presetsInLabel />,
            <CategoryField key="l1" {...fields} level={1} />,
            <CategoryField key="l2" {...fields} level={2} />,
            // Two blanks so the last row's single field keeps a column's width instead of
            // stretching across the card (屏幕稿 02: 二级分类 sits under 金额区间).
            null,
            null,
          ].map((cell, i) => (
            <View key={i} style={{ flexBasis: '30%', flexGrow: 1, minWidth: 220 }}>
              {cell}
            </View>
          ))}
        </View>

        <Divider />
        <KindChips {...fields} />
        <Divider />
        {chipStrip}
      </Card>
    );
  }

  return (
    <View testID={id} style={{ gap: space['3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={props.qDraft}
            onChangeText={props.onQChange}
            placeholder={t('transaction:list.filter.search_placeholder')}
            accessibilityLabel={t('transaction:list.filter.search_placeholder')}
            prefix={<Icon name="search" size={18} color={colors['fg.muted']} />}
            testID={`${id}-q`}
          />
        </View>
        <View>
          <Button
            variant={props.activeCount > 0 ? 'primary' : 'secondary'}
            size="lg"
            icon="filter"
            iconOnly
            accessibilityLabel={t('transaction:list.filter.open')}
            onPress={() => setDrawer(true)}
            testID={`${id}-open`}
          />
          {props.activeCount > 0 ? (
            <View
              testID={`${id}-open-count`}
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 20,
                height: 20,
                paddingHorizontal: space['1'],
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors['kind.expense'],
              }}
            >
              <Text variant="micro" mono weight={600} style={{ color: colors['accent.fg'] }}>
                {String(props.activeCount)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <FilterChips
        chips={chips}
        clearFrom={1}
        onRemove={(key, value) => props.onRemove(key as keyof TransactionListParams, value)}
        onClear={props.onClear}
        testID={`${id}-chips`}
      />

      <FilterSheet
        {...fields}
        open={sheetOpen}
        onClose={() => setDrawer(false)}
        onClear={props.onClear}
        qDraft={props.qDraft}
        onQChange={props.onQChange}
        total={props.total}
      />
    </View>
  );
}
