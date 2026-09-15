/**
 * The review grid's cell-sized controls (屏幕稿 03).
 *
 * The screen-sized kit controls (`Select`, `TextField`) are 52 high with a label above
 * them — one per cell would make a row of the grid as tall as a form. 屏幕稿 03 draws every
 * editable cell as a 30px pill instead: a tinted chip carrying the value and a chevron,
 * which opens exactly the same overlay the kit's `Select` opens (a popover on a wide
 * layout, a bottom sheet on a narrow one).
 *
 * These are presentation only. The test ids follow `Select`'s contract to the letter —
 * `<id>-trigger` and `<id>-option-<value>` — because the grid's behaviour tests address
 * the cells through them, and nothing about what a cell *does* changes here.
 */
import React from 'react';
import { Pressable, ScrollView, type StyleProp, TextInput, View, type ViewStyle } from 'react-native';

import { type ColorToken, density, radius, space, type } from '@/theme/tokens';
import { fontFamilyFor } from '@/theme/fonts';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, type IconName, Popover, Sheet, Text } from '@/ui';

/** 屏幕稿 03: every in-cell control is a 30px pill. */
export const CELL_PILL_HEIGHT = 30;

/** A pill is shorter than the 44px minimum, so every pressable one carries this slop. */
export const CELL_HIT_SLOP = Math.ceil((44 - CELL_PILL_HEIGHT) / 2);

/** The popover opens at the anchor's width; a cell is narrower than any readable list. */
export const CELL_POPOVER_MIN_WIDTH = 240;
export const CELL_POPOVER_MAX_WIDTH = 360;

export type CellTone =
  | 'default'
  | 'muted'
  | 'missing'
  | 'expense'
  | 'income'
  | 'refund'
  | 'transfer';

interface CellPaint {
  bg: ColorToken;
  fg: ColorToken;
  /** Drawn as a 1.5px outline — 屏幕稿 03 rings the cells that still need a value. */
  ring?: ColorToken;
}

const CELL_PAINT: Readonly<Record<CellTone, CellPaint>> = {
  default: { bg: 'bg.subtle', fg: 'fg.primary' },
  muted: { bg: 'bg.subtle', fg: 'fg.muted' },
  missing: { bg: 'bg.surface', fg: 'flag.uncategorized', ring: 'flag.uncategorized' },
  expense: { bg: 'kind.expense.subtle', fg: 'kind.expense' },
  income: { bg: 'kind.income.subtle', fg: 'kind.income' },
  refund: { bg: 'kind.refund.subtle', fg: 'kind.refund' },
  transfer: { bg: 'kind.transfer.subtle', fg: 'kind.transfer' },
};

export interface CellPillProps {
  label: string;
  tone?: CellTone;
  icon?: IconName;
  /** Row numbers, dates and codes are mono with tabular figures (04 §6.3). */
  mono?: boolean;
  /** The `⌄` of an editable cell; a read-only pill leaves it off. */
  chevron?: boolean;
  focused?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The pill itself — no press handling, so it can also stand in as a read-only chip. */
export function CellPill({
  label,
  tone = 'default',
  icon,
  mono = false,
  chevron = false,
  focused = false,
  style,
  testID,
}: CellPillProps): React.JSX.Element {
  const colors = useColors();
  const paint = CELL_PAINT[tone];
  const outline = focused ? 'border.focus' : paint.ring;
  return (
    <View
      testID={testID}
      style={[
        {
          height: CELL_PILL_HEIGHT,
          maxWidth: '100%',
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['1'],
          paddingHorizontal: space['2'],
          borderRadius: radius.sm,
          backgroundColor: colors[paint.bg],
          borderWidth: 1.5,
          borderColor: outline ? colors[outline] : 'transparent',
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={colors[paint.fg]} /> : null}
      <Text
        variant="caption"
        weight={500}
        mono={mono}
        numberOfLines={1}
        style={{ color: colors[paint.fg], flexShrink: 1 }}
      >
        {label}
      </Text>
      {chevron ? <Icon name="chevron-down" size={14} color={colors[paint.fg]} /> : null}
    </View>
  );
}

export interface CellOption {
  value: string;
  label: string;
  /** Second line — the account's currency and balance, a currency's English name. */
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface CellSelectProps {
  value: string | null;
  options: readonly CellOption[];
  /** Shown on the trigger while nothing is picked. */
  placeholder: string;
  /** Accessible name of the trigger and title of the overlay. */
  label: string;
  onChange(next: string): void;
  disabled?: boolean;
  tone?: CellTone;
  /** The tone the trigger takes while empty (屏幕稿 03 rings an unset level-1 category). */
  emptyTone?: CellTone;
  icon?: IconName;
  mono?: boolean;
  /** 屏幕稿 03 leaves the chevron off the kind badge — the colour already says "pill". */
  chevron?: boolean;
  closeLabel: string;
  emptyLabel?: string;
  testID: string;
}

/**
 * A `Select` the size of a table cell. Same overlay split as the kit's: a popover anchored
 * under the trigger on a wide layout, a bottom sheet on a narrow one.
 */
export function CellSelect({
  value,
  options,
  placeholder,
  label,
  onChange,
  disabled = false,
  tone = 'default',
  emptyTone,
  icon,
  mono = false,
  chevron = true,
  closeLabel,
  emptyLabel,
  testID,
}: CellSelectProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<View>(null);

  const current = options.find((option) => option.value === value) ?? null;
  const close = (): void => setOpen(false);

  const list = (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, maxHeight: 320 }}>
      {options.length === 0 && emptyLabel !== undefined ? (
        <Text variant="body" tone="muted" style={{ padding: density.rowInnerPadding }}>
          {emptyLabel}
        </Text>
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="menuitem"
            accessibilityState={{ selected, disabled: option.disabled ?? false }}
            accessibilityLabel={option.label}
            disabled={option.disabled}
            testID={`${testID}-option-${option.value}`}
            onPress={() => {
              if (option.disabled === true) return;
              close();
              onChange(option.value);
            }}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space['3'],
              paddingHorizontal: space['3'],
              borderRadius: radius.md,
              backgroundColor: selected
                ? colors['bg.selected']
                : pressed
                  ? colors['bg.hover']
                  : 'transparent',
            })}
          >
            {option.icon ? (
              <Icon name={option.icon} size={18} color={colors['fg.secondary']} />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text variant="body" tone={option.disabled === true ? 'muted' : 'primary'}>
                {option.label}
              </Text>
              {option.hint !== undefined ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {option.hint}
                </Text>
              ) : null}
            </View>
            {selected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View ref={anchorRef} style={{ minWidth: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        hitSlop={CELL_HIT_SLOP}
        testID={`${testID}-trigger`}
        onPress={() => setOpen((prev) => !prev)}
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        <CellPill
          label={current?.label ?? placeholder}
          tone={current === null ? (emptyTone ?? 'muted') : tone}
          icon={icon}
          mono={mono}
          chevron={chevron}
        />
      </Pressable>

      <Popover
        open={open && wide}
        onClose={close}
        anchorRef={anchorRef}
        closeLabel={closeLabel}
        testID={testID}
        // `Popover` matches the anchor's width, and a grid cell is 80–124px wide — too
        // narrow for an account name and its currency hint. Give the list a floor.
        style={{ minWidth: CELL_POPOVER_MIN_WIDTH, maxWidth: CELL_POPOVER_MAX_WIDTH }}
      >
        {list}
      </Popover>

      {!wide ? (
        <Sheet
          open={open}
          onClose={close}
          title={label}
          closeLabel={closeLabel}
          testID={`${testID}-sheet`}
        >
          {list}
        </Sheet>
      ) : null}
    </View>
  );
}

export interface CellTextInputProps {
  value: string;
  onChangeText(next: string): void;
  onBlur?(): void;
  placeholder?: string;
  accessibilityLabel: string;
  maxLength?: number;
  disabled?: boolean;
  mono?: boolean;
  testID: string;
}

/** A pill-sized text box: the cell-level twin of `TextField` (屏幕稿 03's「对方（文字）」). */
export function CellTextInput({
  value,
  onChangeText,
  onBlur,
  placeholder,
  accessibilityLabel,
  maxLength,
  disabled = false,
  mono = false,
  testID,
}: CellTextInputProps): React.JSX.Element {
  const colors = useColors();
  const [focused, setFocused] = React.useState(false);
  return (
    <View
      style={{
        height: CELL_PILL_HEIGHT,
        justifyContent: 'center',
        paddingHorizontal: space['2'],
        borderRadius: radius.sm,
        backgroundColor: colors['bg.subtle'],
        borderWidth: 1.5,
        borderColor: focused ? colors['border.focus'] : 'transparent',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <TextInput
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        value={value}
        editable={!disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors['fg.muted']}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        style={{
          padding: 0,
          // A zero-width solid outline is the typed way to say `outline: none` on the web.
          outlineStyle: 'solid',
          outlineWidth: 0,
          color: disabled ? colors['fg.muted'] : colors['fg.primary'],
          fontFamily: fontFamilyFor(500, mono),
          fontSize: type.caption.size,
        }}
      />
    </View>
  );
}
