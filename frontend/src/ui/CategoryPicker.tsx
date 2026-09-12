/**
 * Two-level category picker (04 §4.6.1, §6.4; decisions §1.3, §14.21). What makes it more
 * than a `Select`: a level-1 option is **two lines** (name + `categoryDesc()`, the only
 * place the 生活购物 / 消费购物 boundary is explained); the filter matches that criterion
 * text as well as the names; and a level-1 alone is already a complete choice — the
 * level-2 column always starts with "不细分". Wide layouts show both columns, narrow ones
 * drill down (`useIsWide`, never `Platform.OS`).
 *
 * This file is the shell: trigger, search box, overlay (inline panel or sheet) and the
 * shared state. The columns themselves live in `CategoryPickerPanel`.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TxKind } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { categoryName } from '@/i18n/category';
import type { Lang } from '@/i18n';
import { controls, radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { type CategoryValue, CategoryPickerPanel } from './CategoryPickerPanel';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { TextField } from './TextField';

export { RECENT_CATEGORY_LIMIT, orderByRecent } from './CategoryPickerPanel';
export type { CategoryValue } from './CategoryPickerPanel';

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

  // The parent owns the value: switching kind (expense → income) or resetting the form has
  // to move the panel with it, or the level-2 column would keep listing another tree's
  // children. Stage goes back to the first column whenever the tree itself changes.
  React.useEffect(() => {
    setActiveL1(value.l1);
  }, [value.l1, kind]);
  React.useEffect(() => {
    setStage('l1');
    setQuery('');
  }, [kind]);

  // Transfers have no category at all (decision §1.3) — the control stays visible but dead.
  const isDisabled = disabled || kind === 'transfer';
  const hasError = typeof error === 'string' && error.length > 0;
  const title = label ?? t('transaction:form.category_l1');

  function close(): void {
    setOpen(false);
    setQuery('');
    setStage('l1');
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

  /** "一级 · 二级", or the label while nothing is picked. */
  const triggerText = (): string => {
    if (value.l1 === null) return title;
    const name = (code: string): string => {
      const c = index.byCode[code];
      return c ? categoryName(c, lang) : code;
    };
    return value.l2 === null ? name(value.l1) : `${name(value.l1)} · ${name(value.l2)}`;
  };

  const searchBox = (
    <TextField
      value={query}
      onChangeText={setQuery}
      placeholder={t('transaction:form.category_search_placeholder')}
      accessibilityLabel={t('transaction:form.category_search_placeholder')}
      prefix={<Icon name="search" size={16} color={colors['fg.muted']} />}
      testID={`${id}-search`}
    />
  );

  const panel = (
    <CategoryPickerPanel
      index={index}
      kind={kind}
      lang={lang}
      value={value}
      recent={recent}
      query={query}
      wide={wide}
      activeL1={activeL1}
      stage={stage}
      onPickL1={pickL1}
      onPickL2={pickL2}
      onBack={() => setStage('l1')}
      id={id}
    />
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
          <>
            {/* Clicking outside the panel closes it (04 §6.4); there is no modal above the
                page on the web, so the panel carries its own invisible backdrop. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common:button.close')}
              onPress={close}
              testID={`${id}-backdrop`}
              style={[styles.backdrop, { zIndex: z.dropdown - 1 }]}
            />
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
          </>
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
    height: controls.textField.height,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space['3'],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
  },
  backdrop: { position: 'absolute', top: -2000, bottom: -2000, left: -2000, right: -2000 },
  panel: {
    position: 'absolute',
    top: controls.textField.height + 4,
    left: 0,
    right: 0,
    zIndex: z.dropdown,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space['2'],
    gap: space['2'],
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
