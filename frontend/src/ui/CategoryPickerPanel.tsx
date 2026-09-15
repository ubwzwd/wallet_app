/**
 * The body of `CategoryPicker` (04 §4.6.1, §6.4; decisions §1.3, §14.21): the level-1 and
 * level-2 columns, the search filtering that runs over both, and the narrow-layout header
 * that walks back up a level. `CategoryPicker` itself keeps only the trigger, the overlay
 * shell and the state those two share.
 *
 * A level-1 row is two lines — name plus `categoryDesc()`, the only place the
 * 生活购物 / 消费购物 boundary is explained. The criterion is truncated to one line; the
 * full text appears on hover (react-native-web maps `onHoverIn` onto mouseenter) or on a
 * long press, which is the only mechanism that works on both platforms — a DOM `title`
 * attribute would simply be dropped by react-native-web.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Category, TxKind } from '@/api/types';
import { type CategoryIndex, searchCategories } from '@/domain/categories';
import { categoryDesc, categoryName } from '@/i18n/category';
import type { Lang } from '@/i18n';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

/** How many recently used level-1 categories are pinned to the top (04 §4.6.1). */
export const RECENT_CATEGORY_LIMIT = 6;

export interface CategoryValue {
  l1: string | null;
  l2: string | null;
}

/** Recently used level-1 codes first, everything else in tree order. */
export function orderByRecent(
  list: readonly Category[],
  recent: readonly string[] | undefined,
): Category[] {
  if (!recent || recent.length === 0) return [...list];
  const pinned: Category[] = [];
  for (const code of recent.slice(0, RECENT_CATEGORY_LIMIT)) {
    const hit = list.find((c) => c.code === code);
    if (hit && !pinned.includes(hit)) pinned.push(hit);
  }
  return [...pinned, ...list.filter((c) => !pinned.includes(c))];
}

export interface CategoryPickerPanelProps {
  index: CategoryIndex;
  kind: TxKind;
  lang: Lang;
  value: CategoryValue;
  recent?: readonly string[];
  /** The search box's current text; empty means "no filter". */
  query: string;
  /** Wide shows both columns side by side; narrow drills down one column at a time. */
  wide: boolean;
  activeL1: string | null;
  stage: 'l1' | 'l2';
  onPickL1(code: string): void;
  onPickL2(code: string | null): void;
  onBack(): void;
  /** testID prefix, shared with the trigger and overlay. */
  id: string;
}

export function CategoryPickerPanel({
  index,
  kind,
  lang,
  value,
  recent,
  query,
  wide,
  activeL1,
  stage,
  onPickL1,
  onPickL2,
  onBack,
  id,
}: CategoryPickerPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [expandedDesc, setExpandedDesc] = React.useState<string | null>(null);

  const l1List = React.useMemo(
    () => orderByRecent(index.kindAllows(kind), recent),
    [index, kind, recent],
  );

  const search = React.useMemo(() => {
    if (query.trim() === '') return null;
    const hits = searchCategories(index, kind, query.trim(), lang);
    const l2 = new Map<string, Set<string>>();
    for (const hit of hits) {
      if (hit.l2 === undefined) continue;
      l2.set(hit.l1, (l2.get(hit.l1) ?? new Set<string>()).add(hit.l2));
    }
    return { l1: new Set(hits.map((h) => h.l1)), l2 };
  }, [index, kind, lang, query]);

  const visibleL1 = search ? l1List.filter((c) => search.l1.has(c.code)) : l1List;
  const l2All = activeL1 === null ? [] : index.l2Of(activeL1);
  const l2Matched = activeL1 === null ? undefined : search?.l2.get(activeL1);
  const visibleL2 = l2Matched ? l2All.filter((c) => l2Matched.has(c.code)) : l2All;

  function rowBackground(selected: boolean, pressed: boolean): string {
    if (selected) return colors['bg.selected'];
    return pressed ? colors['bg.hover'] : 'transparent';
  }

  const l1Row = (category: Category): React.JSX.Element => {
    const desc = categoryDesc(category, lang);
    const selected = category.code === value.l1;
    const showFull = expandedDesc === category.code;
    return (
      <Pressable
        key={category.code}
        accessibilityRole="menuitem"
        accessibilityState={{ selected }}
        accessibilityLabel={categoryName(category, lang)}
        accessibilityHint={desc ?? undefined}
        onPress={() => onPickL1(category.code)}
        onHoverIn={() => setExpandedDesc(category.code)}
        onHoverOut={() => setExpandedDesc((cur) => (cur === category.code ? null : cur))}
        onLongPress={() => setExpandedDesc(showFull ? null : category.code)}
        testID={`${id}-l1-${category.code}`}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: rowBackground(category.code === activeL1, pressed) },
        ]}
      >
        <View style={styles.grow}>
          <Text variant="body" numberOfLines={1}>
            {categoryName(category, lang)}
          </Text>
          {desc !== null ? (
            <Text
              variant="caption"
              tone="muted"
              numberOfLines={showFull ? undefined : 1}
              testID={`${id}-desc-${category.code}`}
            >
              {desc}
            </Text>
          ) : null}
        </View>
        {selected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
        {wide ? <Icon name="chevron-right" size={18} color={colors['fg.muted']} /> : null}
      </Pressable>
    );
  };

  /** The level-2 rows, including the fixed "不细分" first entry. */
  const l2Row = (key: string, text: string, selected: boolean, code: string | null) => (
    <Pressable
      key={key}
      accessibilityRole="menuitem"
      accessibilityState={{ selected }}
      accessibilityLabel={text}
      onPress={() => onPickL2(code)}
      testID={`${id}-l2-${key}`}
      style={({ pressed }) => [
        styles.rowSingle,
        { backgroundColor: rowBackground(selected, pressed) },
      ]}
    >
      <Text variant="body" numberOfLines={1} style={styles.grow}>
        {text}
      </Text>
      {selected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
    </Pressable>
  );

  const l1Column = (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.column} testID={`${id}-l1-list`}>
      {visibleL1.length === 0 ? (
        <Text variant="body" tone="muted" style={styles.emptyText}>
          {t('common:status.none')}
        </Text>
      ) : null}
      {visibleL1.map(l1Row)}
    </ScrollView>
  );

  const l2Column = (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.column} testID={`${id}-l2-list`}>
      {activeL1 === null
        ? null
        : [
            l2Row('none', t('transaction:form.category_l2_none'), value.l2 === null, null),
            ...visibleL2.map((c) =>
              l2Row(c.code, categoryName(c, lang), c.code === value.l2, c.code),
            ),
          ]}
    </ScrollView>
  );

  if (wide) {
    return (
      <View style={styles.columns}>
        {l1Column}
        <View style={[styles.split, { backgroundColor: colors['border.default'] }]} />
        {l2Column}
      </View>
    );
  }

  if (stage === 'l1') return l1Column;

  return (
    <View style={styles.narrowL2}>
      <View style={styles.narrowHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:button.back')}
          onPress={onBack}
          hitSlop={space['3']}
          testID={`${id}-back`}
        >
          <Icon name="chevron-left" color={colors['fg.secondary']} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onPickL2(null)}
          testID={`${id}-l1-only`}
          hitSlop={space['3']}
          style={styles.grow}
        >
          <Text variant="body" tone="accent">
            {t('transaction:form.category_l1_only_hint')}
          </Text>
        </Pressable>
      </View>
      {l2Column}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  columns: { flexDirection: 'row', gap: space['2'] },
  split: { width: 1, alignSelf: 'stretch' },
  // Longhands on purpose: `flex: 1` next to an explicit `flexGrow: 0` resolved to a
  // zero-width column (both here and on native), so the rows rendered but nobody saw them.
  // `flexBasis: 'auto'` keeps the single-column narrow layout content-sized.
  column: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0, maxHeight: 360 },
  row: {
    minHeight: density.listRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    paddingHorizontal: space['3'],
    paddingVertical: space['2'],
    borderRadius: radius.md,
  },
  rowSingle: {
    height: density.listRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    paddingHorizontal: space['3'],
    borderRadius: radius.md,
  },
  emptyText: { padding: density.rowInnerPadding },
  narrowL2: { gap: space['2'] },
  narrowHeader: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
});
