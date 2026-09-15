/**
 * The inline category block of mockup 04 — the phase-5 form opened a popover, the mockup
 * puts the whole cascade on the page.
 *
 * Wide: one white card, 「分类」 + the chosen path in its header, then two columns — level 1
 * with a colour dot, the name and its criterion (§14.21), level 2 starting with 「不细分」.
 * Narrow: the same list stacked, the selected level-1 row expanding into a row of level-2
 * chips underneath.
 *
 * There is deliberately **no search box** (decision §14.57): each kind has barely more than
 * a dozen level-1 categories, so the list is read at a glance. The selection rules are the
 * kit's (`orderByRecent`, level 1 alone is already a complete choice — decision §1.3).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Category, TxKind } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { categoryDesc, categoryName } from '@/i18n/category';
import type { Lang } from '@/i18n';
import { chartSeries, density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Chip, Icon, Text, orderByRecent } from '@/ui';

import { CardHeader, ColumnCaption, FormCard } from './parts';

export interface CategoryCardProps {
  index: CategoryIndex;
  kind: TxKind;
  lang: Lang;
  value: { l1: string | null; l2: string | null };
  onChange(next: { l1: string | null; l2: string | null }): void;
  recent?: readonly string[];
  error?: string | null;
  disabled?: boolean;
  testID: string;
}

export function CategoryCard({
  index,
  kind,
  lang,
  value,
  onChange,
  recent,
  error,
  disabled = false,
  testID,
}: CategoryCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const [activeL1, setActiveL1] = React.useState<string | null>(value.l1);

  // The parent owns the value: switching kind (expense → income) or resetting the form has
  // to move the panel with it, or the level-2 column would list another tree's children.
  React.useEffect(() => setActiveL1(value.l1), [value.l1, kind]);

  const all = React.useMemo(() => index.kindAllows(kind), [index, kind]);
  const list = React.useMemo(() => orderByRecent(all, recent), [all, recent]);
  const series = chartSeries(colors);

  /** Stable per code: the dot follows the tree order, not the recently-used order. */
  function dotColor(code: string): string {
    const at = all.findIndex((c) => c.code === code);
    return series[(at < 0 ? 0 : at) % series.length];
  }

  const name = (code: string): string => {
    const category = index.byCode[code];
    return category ? categoryName(category, lang) : code;
  };

  const path =
    value.l1 === null
      ? t('transaction:form.category_none')
      : value.l2 === null
        ? name(value.l1)
        : `${name(value.l1)} / ${name(value.l2)}`;

  function pickL1(code: string): void {
    setActiveL1(code);
    onChange({ l1: code, l2: null }); // level 1 alone is already valid (decision §1.3)
  }

  function pickL2(code: string | null): void {
    if (activeL1 === null) return;
    onChange({ l1: activeL1, l2: code });
  }

  const l1Row = (category: Category): React.JSX.Element => {
    const desc = categoryDesc(category, lang);
    const chosen = category.code === value.l1;
    const active = category.code === activeL1;
    return (
      // touch-target-exempt: `styles.l1Row` sets minHeight 58.
      <Pressable
        key={category.code}
        accessibilityRole="menuitem"
        accessibilityState={{ selected: chosen, disabled }}
        accessibilityLabel={categoryName(category, lang)}
        accessibilityHint={desc ?? undefined}
        disabled={disabled}
        onPress={() => pickL1(category.code)}
        testID={`${testID}-l1-${category.code}`}
        style={({ pressed }) => [
          styles.l1Row,
          {
            paddingHorizontal: wide ? space['5'] : space['4'],
            backgroundColor: active
              ? colors['bg.selected']
              : pressed
                ? colors['bg.hover']
                : 'transparent',
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: dotColor(category.code) }]} />
        <View style={styles.grow}>
          <Text variant="body" weight={600} style={styles.rowTitle} numberOfLines={1}>
            {categoryName(category, lang)}
          </Text>
          {desc !== null ? (
            <Text
              variant="caption"
              tone="muted"
              numberOfLines={1}
              testID={`${testID}-desc-${category.code}`}
            >
              {desc}
            </Text>
          ) : null}
        </View>
        {chosen ? (
          <Icon name="check" size={18} color={colors['accent.solid']} />
        ) : (
          <Icon name="chevron-right" size={18} color={colors['border.strong']} />
        )}
      </Pressable>
    );
  };

  const l2Entries: { key: string; code: string | null; label: string }[] =
    activeL1 === null
      ? []
      : [
          { key: 'none', code: null, label: t('transaction:form.category_l2_none') },
          ...index.l2Of(activeL1).map((c) => ({
            key: c.code,
            code: c.code as string | null,
            label: categoryName(c, lang),
          })),
        ];

  const l2Row = (entry: { key: string; code: string | null; label: string }) => {
    const selected = value.l2 === entry.code && value.l1 === activeL1;
    return (
      // touch-target-exempt: `styles.l2Row` sets height 48.
      <Pressable
        key={entry.key}
        accessibilityRole="menuitem"
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={entry.label}
        disabled={disabled}
        onPress={() => pickL2(entry.code)}
        testID={`${testID}-l2-${entry.key}`}
        style={({ pressed }) => [
          styles.l2Row,
          {
            backgroundColor: selected
              ? colors['bg.selected']
              : pressed
                ? colors['bg.hover']
                : 'transparent',
          },
        ]}
      >
        <Text
          variant="body"
          weight={selected ? 600 : 400}
          style={styles.grow}
          numberOfLines={1}
        >
          {entry.label}
        </Text>
        {selected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
      </Pressable>
    );
  };

  const header = (
    <>
      <Text variant="body" mono weight={450} tone={value.l1 === null ? 'muted' : 'primary'}>
        {path}
      </Text>
    </>
  );

  const errorLine =
    typeof error === 'string' && error.length > 0 ? (
      <Text variant="caption" tone="danger" style={styles.error} testID={`${testID}-error`}>
        {error}
      </Text>
    ) : null;

  if (wide) {
    return (
      <FormCard padded={false} style={styles.clip} testID={testID}>
        <CardHeader
          title={t('transaction:form.category_title')}
          right={<View testID={`${testID}-path`}>{header}</View>}
        />
        <View style={styles.columns}>
          <View style={[styles.l1Column, { borderRightColor: colors['border.default'] }]}>
            <ColumnCaption label={t('transaction:form.category_l1_section')} />
            <ScrollView keyboardShouldPersistTaps="handled" testID={`${testID}-l1-list`}>
              {list.map(l1Row)}
            </ScrollView>
          </View>
          <View style={[styles.l2Column, { backgroundColor: colors['bg.canvas'] }]}>
            <ColumnCaption
              label={
                activeL1 === null
                  ? t('transaction:form.category_l2_section_empty')
                  : t('transaction:form.category_l2_section', { name: name(activeL1) })
              }
            />
            <ScrollView keyboardShouldPersistTaps="handled" testID={`${testID}-l2-list`}>
              {l2Entries.map(l2Row)}
            </ScrollView>
          </View>
        </View>
        {errorLine}
      </FormCard>
    );
  }

  return (
    <View style={styles.narrowWrap} testID={testID}>
      <View style={styles.narrowHeader}>
        <Text variant="body" weight={700} style={styles.grow}>
          {t('transaction:form.category_title')}
        </Text>
        <View testID={`${testID}-path`}>{header}</View>
      </View>
      <FormCard padded={false} style={[styles.clip, styles.narrowCard]}>
        {list.map((category) => (
          <View key={category.code}>
            {l1Row(category)}
            {category.code === activeL1 ? (
              <View style={styles.chipBlock} testID={`${testID}-l2-list`}>
                <Text variant="micro" mono weight={600} tone="muted" style={styles.chipCaption}>
                  {t('transaction:form.category_l2_section_empty')}
                </Text>
                <View style={styles.chips}>
                  {l2Entries.map((entry) => (
                    <Chip
                      key={entry.key}
                      testID={`${testID}-l2-${entry.key}`}
                      label={entry.label}
                      selected={value.l2 === entry.code}
                      disabled={disabled}
                      onPress={() => pickL2(entry.code)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ))}
        {errorLine}
      </FormCard>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  grow: { flex: 1, minWidth: 0 },
  columns: { flexDirection: 'row', minHeight: 326, maxHeight: 420 },
  l1Column: { flexGrow: 1.35, flexShrink: 1, flexBasis: 0, minWidth: 0, borderRightWidth: 1 },
  l2Column: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  l1Row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingVertical: space['2'] + 1,
  },
  rowTitle: { fontSize: 15, lineHeight: 21 },
  dot: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  l2Row: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    paddingHorizontal: space['4'] + 2,
  },
  narrowWrap: { alignSelf: 'stretch', gap: space['2'] },
  narrowHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space['3'],
    paddingHorizontal: space['1'],
  },
  narrowCard: { paddingVertical: space['1'] + 2 },
  chipBlock: { paddingLeft: space['8'] + 4, paddingRight: space['4'], paddingBottom: space['3'] },
  chipCaption: { letterSpacing: 0.66, paddingBottom: space['2'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] - 2 },
  error: { padding: density.rowInnerPadding },
});
