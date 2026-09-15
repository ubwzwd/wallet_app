/**
 * Button (04 §6.4): heights 36 / 44 / 48, radius 14, four variants. Danger is outlined by
 * default so "delete" never outshouts "save"; pressing only swaps the fill — no scaling
 * (tokens `controls.button.notes`).
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { type ColorToken, controls, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Every touchable must clear 44×44 on BOTH axes; `sm` (36) makes that up with hit slop —
 *  an icon-only `sm` button is 36 wide as well as 36 tall, so the slop is symmetric. */
const MIN_TOUCH = 44;

interface VariantStyle {
  bg: ColorToken | 'transparent';
  bgPressed: ColorToken | 'transparent';
  fg: ColorToken;
  fgPressed?: ColorToken;
  border?: ColorToken;
}

const VARIANTS: Readonly<Record<ButtonVariant, VariantStyle>> = {
  primary: { bg: 'accent.solid', bgPressed: 'accent.solid', fg: 'accent.fg' },
  secondary: { bg: 'bg.raised', bgPressed: 'bg.hover', fg: 'fg.primary', border: 'border.default' },
  // The mockups' second-rank action (「编辑」/「复制一笔」 on screen 08): a tinted fill with
  // no outline, so a row of them does not read as a row of boxes.
  soft: { bg: 'bg.subtle', bgPressed: 'bg.hover', fg: 'fg.primary' },
  ghost: { bg: 'transparent', bgPressed: 'bg.hover', fg: 'fg.primary' },
  danger: {
    bg: 'transparent',
    bgPressed: 'status.danger.bg',
    fg: 'status.danger.fg',
    border: 'status.danger.fg',
  },
};

export interface ButtonProps {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** Icon-only buttons are square and require an `accessibilityLabel`. */
  iconOnly?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  onPress,
  loading = false,
  disabled = false,
  icon,
  iconOnly = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps): React.JSX.Element {
  const colors = useColors();
  const v = VARIANTS[variant];
  const height = controls.button.heights[size];
  const inert = disabled || loading;
  const slop = Math.max(0, (MIN_TOUCH - height) / 2);

  const paint = ({ pressed }: PressableStateCallbackType): ViewStyle => {
    const active = pressed && !inert;
    const bgToken = active ? v.bgPressed : v.bg;
    return {
      height,
      minWidth: iconOnly ? height : undefined,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space['2'],
      paddingHorizontal: iconOnly ? 0 : space['4'],
      borderRadius: radius.md,
      borderWidth: v.border ? 1.5 : 0,
      borderColor: v.border
        ? inert
          ? colors['border.default']
          : colors[v.border]
        : undefined,
      backgroundColor: inert
        ? colors['bg.subtle']
        : bgToken === 'transparent'
          ? 'transparent'
          : colors[bgToken],
      // The accent has no darker sibling token; pressing dims the fill instead of
      // introducing a literal colour (04 §6.2: components read semantic names only).
      opacity: active && variant === 'primary' ? 0.86 : 1,
      alignSelf: fullWidth ? 'stretch' : 'flex-start',
    };
  };

  const fg = inert ? colors['fg.muted'] : colors[v.fg];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      disabled={inert}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      onPress={inert ? undefined : onPress}
      testID={testID}
      style={(state) => [paint(state), style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} testID="button-spinner" />
      ) : icon ? (
        <Icon name={icon} color={fg} />
      ) : null}
      {!iconOnly && label !== undefined ? (
        // 14/600 on the 36 and 44 steps, 15/600 on the 48 one — the mockups' button label.
        <Text
          variant={size === 'lg' ? 'subheading' : 'body'}
          weight={600}
          style={{ color: fg }}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A row of buttons with the standard gap; used by dialogs and form footers. */
export function ButtonRow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}): React.JSX.Element {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
});
