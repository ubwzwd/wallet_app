/**
 * Select / MultiSelect (04 §6.4): the trigger matches `TextField`; the overlay is an
 * absolutely positioned panel on wide layouts and a bottom `Sheet` on narrow ones. One
 * implementation for both platforms — the split is by viewport width, never by `Platform`.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { controls, density, radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { TextField } from './TextField';

export interface SelectOption {
  value: string;
  label: string;
  /** Second line, e.g. the category criterion or an account's currency and balance. */
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
}

interface CommonProps {
  options: readonly SelectOption[];
  label?: string;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when the search filter matches nothing. */
  emptyLabel?: string;
  /** Accessible name of the sheet's × button; falls back to `label`. */
  closeLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export interface SelectProps extends CommonProps {
  multiple?: false;
  value: string | null;
  onChange(next: string | null): void;
}

export interface MultiSelectProps extends CommonProps {
  multiple: true;
  values: readonly string[];
  onChange(next: string[]): void;
  /** Renders the "n selected" summary on the trigger. */
  selectedLabel?(count: number): string;
}

function matches(option: SelectOption, query: string): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase();
  return (
    option.label.toLowerCase().includes(q) || (option.hint?.toLowerCase().includes(q) ?? false)
  );
}

export function Select(props: SelectProps | MultiSelectProps): React.JSX.Element {
  const {
    options,
    label,
    placeholder,
    hint,
    error,
    disabled = false,
    searchable = false,
    searchPlaceholder,
    emptyLabel,
    closeLabel,
    style,
    testID,
  } = props;
  const colors = useColors();
  const wide = useIsWide();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const hasError = typeof error === 'string' && error.length > 0;

  const multiple = props.multiple === true;
  const selected: readonly string[] =
    props.multiple === true ? props.values : props.value === null ? [] : [props.value];
  // Without a caller-supplied summary the trigger lists the labels, so the bare count is
  // the only way to show "how many" — with one, the summary already says it.
  const showCount =
    props.multiple === true && props.selectedLabel === undefined && props.values.length > 0;

  const visible = React.useMemo(
    () => options.filter((o) => matches(o, query)),
    [options, query],
  );

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  function pick(option: SelectOption): void {
    if (option.disabled) return;
    if (props.multiple === true) {
      const next = props.values.includes(option.value)
        ? props.values.filter((v) => v !== option.value)
        : [...props.values, option.value];
      props.onChange([...next]);
      return;
    }
    props.onChange(option.value === props.value ? null : option.value);
    close();
  }

  const triggerText = (): { text: string; muted: boolean } => {
    if (props.multiple === true) {
      if (props.values.length === 0) return { text: placeholder ?? '', muted: true };
      const summary =
        props.selectedLabel?.(props.values.length) ??
        options
          .filter((o) => props.values.includes(o.value))
          .map((o) => o.label)
          .join(' · ');
      return { text: summary, muted: false };
    }
    const current = options.find((o) => o.value === props.value);
    return current
      ? { text: current.label, muted: false }
      : { text: placeholder ?? '', muted: true };
  };
  const trigger = triggerText();

  const list = (
    <View style={styles.list}>
      {searchable ? (
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          accessibilityLabel={searchPlaceholder ?? label}
          prefix={<Icon name="search" size={16} color={colors['fg.muted']} />}
          testID={testID ? `${testID}-search` : 'select-search'}
        />
      ) : null}
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        {visible.length === 0 && emptyLabel !== undefined ? (
          <Text variant="body" tone="muted" style={{ padding: density.rowInnerPadding }}>
            {emptyLabel}
          </Text>
        ) : null}
        {visible.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: isSelected, disabled: option.disabled ?? false }}
              accessibilityLabel={option.label}
              disabled={option.disabled}
              onPress={() => pick(option)}
              testID={testID ? `${testID}-option-${option.value}` : `select-option-${option.value}`}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: isSelected
                    ? colors['bg.selected']
                    : pressed
                      ? colors['bg.hover']
                      : 'transparent',
                },
              ]}
            >
              {option.icon ? (
                <Icon name={option.icon} size={18} color={colors['fg.secondary']} />
              ) : null}
              <View style={styles.optionText}>
                <Text
                  variant="body"
                  tone={option.disabled ? 'muted' : 'primary'}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                {option.hint !== undefined ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {option.hint}
                  </Text>
                ) : null}
              </View>
              {isSelected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.wrap, style]}>
      {label !== undefined ? (
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
      ) : null}
      <View style={styles.anchor}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open, disabled }}
          accessibilityLabel={label ?? placeholder}
          disabled={disabled}
          onPress={() => (open ? close() : setOpen(true))}
          testID={testID ? `${testID}-trigger` : 'select-trigger'}
          style={{
            height: controls.textField.height,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: hasError
              ? colors['status.danger.fg']
              : open
                ? colors['border.focus']
                : 'transparent',
            backgroundColor: hasError ? colors['status.danger.bg'] : colors['bg.subtle'],
            paddingHorizontal: space['3'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: space['2'],
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <Text
            variant="subheading"
            tone={trigger.muted ? 'muted' : 'primary'}
            style={styles.triggerText}
            numberOfLines={1}
          >
            {trigger.text}
          </Text>
          {showCount ? (
            <Text variant="caption" tone="muted" mono>
              {String(selected.length)}
            </Text>
          ) : null}
          <Icon name="chevron-down" size={18} color={colors['fg.muted']} />
        </Pressable>

        {open && wide ? (
          <View
            testID={testID ? `${testID}-panel` : 'select-panel'}
            style={[
              styles.panel,
              {
                zIndex: z.dropdown,
                backgroundColor: colors['bg.raised'],
                borderColor: colors['border.default'],
                shadowColor: colors['fg.primary'],
              },
            ]}
          >
            {list}
          </View>
        ) : null}
      </View>

      {hasError ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}

      {!wide ? (
        <Sheet
          open={open}
          onClose={close}
          title={label}
          closeLabel={closeLabel ?? label}
          testID={testID ? `${testID}-sheet` : 'select-sheet'}
        >
          {list}
        </Sheet>
      ) : null}
    </View>
  );
}

export function MultiSelect(props: Omit<MultiSelectProps, 'multiple'>): React.JSX.Element {
  return <Select {...props} multiple />;
}

const styles = StyleSheet.create({
  wrap: { gap: space['1'], alignSelf: 'stretch' },
  anchor: { position: 'relative' },
  triggerText: { flex: 1 },
  panel: {
    position: 'absolute',
    top: controls.textField.height + 4,
    left: 0,
    right: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space['2'],
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  list: { gap: space['2'], maxHeight: 320 },
  scroll: { flexGrow: 0 },
  option: {
    minHeight: density.listRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['3'],
    borderRadius: radius.md,
  },
  optionText: { flex: 1 },
});
