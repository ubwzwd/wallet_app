/**
 * Two-level category picker (04 §4.6.1, §6.4; decisions §1.3, §14.21). What makes it more
 * than a `Select`: a level-1 option is **two lines** (name + `categoryDesc()`, the only
 * place the 生活购物 / 消费购物 boundary is explained); the filter matches that criterion
 * text as well as the names; and a level-1 alone is already a complete choice — the
 * level-2 column always starts with "不细分". Wide layouts show both columns, narrow ones
 * drill down (`useIsWide`, never `Platform.OS`).
 */
import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Category, TxKind } from '@/api/types';
import { type CategoryIndex, searchCategories } from '@/domain/categories';
import { categoryDesc, categoryName } from '@/i18n/category';
import type { Lang } from '@/i18n';
import { controls, density, radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Text, type TextProps } from './Text';
import { TextField } from './TextField';

/** How many recently used level-1 categories are pinned to the top (04 §4.6.1). */
export const RECENT_CATEGORY_LIMIT = 6;

/**
 * Web-only `title` tooltip for a truncated label; native reads the full text through
 * `accessibilityHint` and a long press instead. Only `src/ui/` may branch on `Platform`.
 */
export function hoverTitle(text: string | null | undefined): Partial<TextProps> {
  if (Platform.OS !== 'web' || !text) return {};
  return { title: text } as unknown as Partial<TextProps>;
}

export interface CategoryValue {
  l1: string | null;
  l2: string | null;
}

export interface CategoryPickerProps {
  index: CategoryIndex;
  kind: TxKind;
  value: CategoryValue;
  onChange(next: CategoryValue): void;
  lang: Lang;
  /** Recently used level-1 codes, most recent first. */
  recent?: readonly string[];
  disabled?: boolean;
  label?: string;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
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

export function CategoryPicker({
  index,
  kind,
  value,
  onChange,
  lang,
  recent,
  disabled = false,
  label,
  error,
  style,
  testID,
}: CategoryPickerProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const id = testID ?? 'category';

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeL1, setActiveL1] = React.useState<string | null>(value.l1);
  const [stage, setStage] = React.useState<'l1' | 'l2'>('l1');
  const [expandedDesc, setExpandedDesc] = React.useState<string | null>(null);

  // Transfers have no category at all (decision §1.3) — the control stays visible but dead.
  const isDisabled = disabled || kind === 'transfer';
  const hasError = typeof error === 'string' && error.length > 0;
  const title = label ?? t('transaction:form.category_l1');

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

  function close(): void {
    setOpen(false);
    setQuery('');
    setStage('l1');
    setExpandedDesc(null);
  }

  function pickL1(code: string): void {
    setActiveL1(code);
    onChange({ l1: code, l2: null }); // level 1 alone is already valid (decision §1.3)
    if (!wide) setStage('l2');
  }

  function pickL2(code: string | null): void {
    if (activeL1 === null) return;
    onChange({ l1: activeL1, l2: code });
    close();
  }

  function rowBackground(selected: boolean, pressed: boolean): string {
    if (selected) return colors['bg.selected'];
    return pressed ? colors['bg.hover'] : 'transparent';
  }

  /** "一级 · 二级", or the label while nothing is picked. */
  const triggerText = (): string => {
    if (value.l1 === null) return title;
    const name = (code: string): string => {
      const c = index.byCode[code];
      return c ? categoryName(c, lang) : code;
    };
    return value.l2 === null ? name(value.l1) : `${name(value.l1)} · ${name(value.l2)}`;
  };

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
        onPress={() => pickL1(category.code)}
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
              {...hoverTitle(desc)}
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
      onPress={() => pickL2(code)}
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

  const searchBox = (
    <TextField
      value={query}
      onChangeText={setQuery}
      placeholder={t('transaction:list.filter.category_label')}
      accessibilityLabel={t('transaction:list.filter.category_label')}
      prefix={<Icon name="search" size={16} color={colors['fg.muted']} />}
      testID={`${id}-search`}
    />
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

  const panel = wide ? (
    <View style={styles.columns}>
      {l1Column}
      <View style={[styles.split, { backgroundColor: colors['border.default'] }]} />
      {l2Column}
    </View>
  ) : stage === 'l1' ? (
    l1Column
  ) : (
    <View style={styles.narrowL2}>
      <View style={styles.narrowHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:button.back')}
          onPress={() => setStage('l1')}
          hitSlop={space['2']}
          testID={`${id}-back`}
        >
          <Icon name="chevron-left" color={colors['fg.secondary']} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => pickL2(null)}
          testID={`${id}-l1-only`}
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

  return (
    <View style={[styles.wrap, style]}>
      <Text variant="caption" tone="secondary">
        {title}
      </Text>
      <View style={styles.anchor}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open, disabled: isDisabled }}
          accessibilityLabel={title}
          disabled={isDisabled}
          onPress={() => (open ? close() : setOpen(true))}
          testID={`${id}-trigger`}
          style={[
            styles.trigger,
            {
              borderColor: hasError
                ? colors['status.danger.fg']
                : open
                  ? colors['border.focus']
                  : 'transparent',
              backgroundColor: hasError ? colors['status.danger.bg'] : colors['bg.subtle'],
              opacity: isDisabled ? 0.6 : 1,
            },
          ]}
        >
          <Text
            variant="subheading"
            tone={value.l1 === null ? 'muted' : 'primary'}
            numberOfLines={1}
            style={styles.grow}
          >
            {triggerText()}
          </Text>
          <Icon name="chevron-down" size={18} color={colors['fg.muted']} />
        </Pressable>

        {open && wide ? (
          <View
            testID={`${id}-panel`}
            style={[
              styles.panel,
              {
                backgroundColor: colors['bg.raised'],
                borderColor: colors['border.default'],
                shadowColor: colors['fg.primary'],
              },
            ]}
          >
            {searchBox}
            {panel}
          </View>
        ) : null}
      </View>

      {hasError ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}

      {!wide ? (
        <Sheet
          open={open}
          onClose={close}
          title={title}
          closeLabel={t('common:button.close')}
          testID={`${id}-sheet`}
        >
          {searchBox}
          {panel}
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['1'], alignSelf: 'stretch' },
  anchor: { position: 'relative' },
  grow: { flex: 1 },
  trigger: {
    height: controls.textField.height, borderRadius: radius.md, borderWidth: 1.5,
    paddingHorizontal: space['3'], flexDirection: 'row', alignItems: 'center', gap: space['2'],
  },
  panel: {
    position: 'absolute', top: controls.textField.height + 4, left: 0, right: 0,
    zIndex: z.dropdown, borderRadius: radius.lg, borderWidth: 1, padding: space['2'],
    gap: space['2'], shadowOpacity: 0.1, shadowRadius: 12, elevation: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  columns: { flexDirection: 'row', gap: space['2'] },
  split: { width: 1, alignSelf: 'stretch' },
  column: { flexGrow: 0, flexBasis: 0, flex: 1, maxHeight: 360 },
  row: {
    minHeight: density.listRowHeight, flexDirection: 'row', alignItems: 'center',
    gap: space['2'], paddingHorizontal: space['3'], paddingVertical: space['2'],
    borderRadius: radius.md,
  },
  rowSingle: {
    height: density.listRowHeight, flexDirection: 'row', alignItems: 'center',
    gap: space['2'], paddingHorizontal: space['3'], borderRadius: radius.md,
  },
  emptyText: { padding: density.rowInnerPadding },
  narrowL2: { gap: space['2'] },
  narrowHeader: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
});
