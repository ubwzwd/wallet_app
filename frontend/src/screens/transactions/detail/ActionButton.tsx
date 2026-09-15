/**
 * The detail page's action button (屏幕稿 07 / 08).
 *
 * Five tones, which is why this is not `Button`: the mockups rank the operations by fill —
 * neutral 编辑 / 复制一笔, beige 登记退款, info 拆开, solid 关联为转账对腿, outlined danger
 * 删除 — and the kit's four variants stop one short.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { type ColorToken, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, type IconName, Text } from '@/ui';

export type ActionTone = 'neutral' | 'primary' | 'refund' | 'info' | 'danger';

interface ActionPaint {
  bg: ColorToken;
  bgPressed: ColorToken;
  fg: ColorToken;
  border?: ColorToken;
}

const ACTION_PAINT: Readonly<Record<ActionTone, ActionPaint>> = {
  neutral: { bg: 'bg.subtle', bgPressed: 'bg.hover', fg: 'fg.primary' },
  primary: { bg: 'accent.solid', bgPressed: 'accent.solid', fg: 'accent.fg' },
  refund: { bg: 'status.warning.bg', bgPressed: 'kind.refund.subtle', fg: 'status.warning.fg' },
  info: { bg: 'status.info.bg', bgPressed: 'kind.transfer.subtle', fg: 'status.info.fg' },
  danger: {
    bg: 'bg.surface',
    bgPressed: 'status.danger.bg',
    fg: 'status.danger.fg',
    border: 'status.danger.fg',
  },
};

/** 屏幕稿 08: 44 tall, radius 12–14, 16 of side padding, a 14/600 label after the glyph. */
const ACTION_HEIGHT = 44;

export interface ActionButtonProps {
  label: string;
  icon?: IconName;
  tone?: ActionTone;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

export function ActionButton({
  label,
  icon,
  tone = 'neutral',
  onPress,
  disabled = false,
  loading = false,
  testID,
}: ActionButtonProps): React.JSX.Element {
  const colors = useColors();
  const paint = ACTION_PAINT[tone];
  const inert = disabled || loading;
  const fg = inert ? colors['fg.muted'] : colors[paint.fg];

  return (
    // touch-target-exempt: `ACTION_HEIGHT` is 44 and the label keeps it wider than 44.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={inert ? undefined : onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: inert
            ? colors['bg.subtle']
            : colors[pressed ? paint.bgPressed : paint.bg],
          borderWidth: paint.border ? 1.5 : 0,
          borderColor: paint.border ? colors[paint.border] : undefined,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={18} color={fg} />
      ) : null}
      <Text variant="body" weight={600} numberOfLines={1} style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    height: ACTION_HEIGHT,
    minWidth: ACTION_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space['2'],
    paddingHorizontal: space['4'],
    borderRadius: radius.md,
  },
});
