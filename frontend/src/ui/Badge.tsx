/**
 * Badge (04 §6.4, §6.2 rule 4): a read-only square pill, height 26, radius 8. It marks what
 * the system decided about a row; colour is never the only carrier (rule 7), so a badge
 * always shows text and may add an icon.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { type ColorToken, controls, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'warning'
  | 'danger'
  | 'success'
  | 'kind-expense'
  | 'kind-income'
  | 'kind-refund'
  | 'kind-transfer'
  | 'flag-duplicate'
  | 'flag-needs_review'
  | 'flag-uncategorized';

interface BadgePaint {
  fg: ColorToken;
  bg: ColorToken;
}

export const BADGE_TONES: Readonly<Record<BadgeTone, BadgePaint>> = {
  neutral: { fg: 'fg.secondary', bg: 'bg.subtle' },
  info: { fg: 'status.info.fg', bg: 'status.info.bg' },
  warning: { fg: 'status.warning.fg', bg: 'status.warning.bg' },
  danger: { fg: 'status.danger.fg', bg: 'status.danger.bg' },
  success: { fg: 'status.success.fg', bg: 'status.success.bg' },
  'kind-expense': { fg: 'kind.expense', bg: 'kind.expense.subtle' },
  'kind-income': { fg: 'kind.income', bg: 'kind.income.subtle' },
  'kind-refund': { fg: 'kind.refund', bg: 'kind.refund.subtle' },
  'kind-transfer': { fg: 'kind.transfer', bg: 'kind.transfer.subtle' },
  'flag-duplicate': { fg: 'flag.duplicate', bg: 'bg.subtle' },
  'flag-needs_review': { fg: 'flag.needs_review', bg: 'bg.subtle' },
  'flag-uncategorized': { fg: 'flag.uncategorized', bg: 'bg.subtle' },
};

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Badge({
  label,
  tone = 'neutral',
  icon,
  style,
  testID,
}: BadgeProps): React.JSX.Element {
  const colors = useColors();
  const paint = BADGE_TONES[tone];
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      style={[
        {
          height: controls.badge.height,
          borderRadius: radius.sm,
          paddingHorizontal: space['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['1'],
          alignSelf: 'flex-start',
          backgroundColor: colors[paint.bg],
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={colors[paint.fg]} /> : null}
      <Text variant="micro" style={{ color: colors[paint.fg] }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
