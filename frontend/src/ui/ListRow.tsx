/**
 * One row inside a `ListCard` — the shape every mockup list uses (01 accounts, 01 recent,
 * 08 the account block, 09, 13):
 *
 *   [round icon well] [title / subtitle] … [mono amount / small sub] [trailing]
 *
 * 60 tall on a wide screen, 56 narrow (the C2 density's `listRowHeight`). Hover tints the
 * row with `bg.hover`; the divider between rows is drawn by `ListCard`.
 *
 * Name clash to watch: `@/domain/transfers` also exports a `ListRow` — a *type*, imported
 * by the transaction screens. A file that needs both must alias one of them, e.g.
 * `import { ListRow as ListRowView } from '@/ui'`; do not rename the domain type.
 */
import React from 'react';
import {
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { density, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Text, type TextTone } from './Text';

/** Wide rows are 60 tall with 18 of side padding; narrow ones 56 with 14 (mockup 01). */
const WIDE_HEIGHT = 60;

export interface ListRowProps {
  /** Usually a `KindIcon` / `SourceTypeIcon` / `Avatar`. */
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Right-hand number, already formatted by the caller. */
  amount?: string;
  amountTone?: TextTone;
  /** Second line under the amount: the converted value, or a date. */
  amountSub?: string;
  /** Anything after the amount — a chevron, a badge, a button row. */
  trailing?: React.ReactNode;
  onPress?(): void;
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListRow({
  icon,
  title,
  subtitle,
  amount,
  amountTone = 'primary',
  amountSub,
  trailing,
  onPress,
  selected = false,
  disabled = false,
  accessibilityLabel,
  style,
  testID,
}: ListRowProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();

  const shape: ViewStyle = {
    minHeight: wide ? WIDE_HEIGHT : density.listRowHeight,
    paddingHorizontal: wide ? space['4'] + 2 : space['3'] + 2,
    paddingVertical: space['2'] + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: wide ? space['3'] + 2 : space['3'],
    opacity: disabled ? 0.6 : 1,
  };

  const body = (
    <>
      {icon}
      <View style={styles.text}>
        <Text
          variant="subheading"
          weight={500}
          numberOfLines={1}
          style={wide ? undefined : styles.titleNarrow}
          testID={testID ? `${testID}-title` : undefined}
        >
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text
            variant="caption"
            tone="muted"
            numberOfLines={1}
            testID={testID ? `${testID}-subtitle` : undefined}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {amount !== undefined || amountSub !== undefined ? (
        <View style={styles.amountBlock}>
          {amount !== undefined ? (
            <Text
              variant="subheading"
              mono
              weight={500}
              tone={amountTone}
              numberOfLines={1}
              style={wide ? styles.amountWide : undefined}
              testID={testID ? `${testID}-amount` : undefined}
            >
              {amount}
            </Text>
          ) : null}
          {amountSub !== undefined ? (
            <Text
              variant="caption"
              tone="muted"
              mono
              numberOfLines={1}
              testID={testID ? `${testID}-amount-sub` : undefined}
            >
              {amountSub}
            </Text>
          ) : null}
        </View>
      ) : null}
      {trailing}
    </>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        style={[
          shape,
          selected ? { backgroundColor: colors['bg.selected'] } : null,
          style,
        ]}
      >
        {body}
      </View>
    );
  }

  const paint = ({ pressed }: PressableStateCallbackType): ViewStyle => ({
    backgroundColor: selected
      ? colors['bg.selected']
      : pressed && !disabled
        ? colors['bg.hover']
        : 'transparent',
  });

  return (
    // touch-target-exempt: `shape` gives every row minHeight 56 (narrow) / 60 (wide).
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => [shape, paint(state), style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { flex: 1, minWidth: 0 },
  // 15/21 narrow, the mockups' list title step below the 16 `subheading`.
  titleNarrow: { fontSize: 15, lineHeight: 21 },
  amountBlock: { alignItems: 'flex-end', flexShrink: 0 },
  amountWide: { fontSize: 17, lineHeight: 23 },
});
