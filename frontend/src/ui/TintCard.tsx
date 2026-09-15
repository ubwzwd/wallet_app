/**
 * A tinted block with no border and no shadow (mockup 01's 「↓ 9 月支出 / 6,842.50」 pair,
 * mockup 08's beige 「已关联的退款」 note).
 *
 * It is the one place a whole surface takes a semantic tint, so the tone is the message:
 * an expense card is `kind.expense.subtle`, a warning note `status.warning.bg`. Everything
 * inside — label, number, prose — is painted in the matching foreground.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { type ColorToken, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type TintTone =
  | 'expense'
  | 'income'
  | 'refund'
  | 'transfer'
  | 'warning'
  | 'danger'
  | 'success'
  | 'info'
  | 'accent'
  | 'neutral';

interface TintPaint {
  bg: ColorToken;
  fg: ColorToken;
}

export const TINT_TONES: Readonly<Record<TintTone, TintPaint>> = {
  expense: { bg: 'kind.expense.subtle', fg: 'kind.expense' },
  income: { bg: 'kind.income.subtle', fg: 'kind.income' },
  refund: { bg: 'kind.refund.subtle', fg: 'kind.refund' },
  transfer: { bg: 'kind.transfer.subtle', fg: 'kind.transfer' },
  warning: { bg: 'status.warning.bg', fg: 'status.warning.fg' },
  danger: { bg: 'status.danger.bg', fg: 'status.danger.fg' },
  success: { bg: 'status.success.bg', fg: 'status.success.fg' },
  info: { bg: 'status.info.bg', fg: 'status.info.fg' },
  accent: { bg: 'accent.subtle', fg: 'accent.solid' },
  neutral: { bg: 'bg.subtle', fg: 'fg.secondary' },
};

export interface TintCardProps {
  tone?: TintTone;
  /** Small caps-ish line above the number ("9 月支出"). */
  label?: string;
  icon?: IconName;
  /** The big mono number, already formatted. */
  value?: string;
  /** Anything else: prose, a progress bar, a key/value line. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TintCard({
  tone = 'neutral',
  label,
  icon,
  value,
  children,
  style,
  testID,
}: TintCardProps): React.JSX.Element {
  const colors = useColors();
  const paint = TINT_TONES[tone];
  const fg = colors[paint.fg];
  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: colors[paint.bg] }, style]}
    >
      {label !== undefined ? (
        <View style={styles.labelRow}>
          {icon ? <Icon name={icon} size={14} color={fg} /> : null}
          <Text
            variant="caption"
            weight={600}
            style={{ color: fg }}
            numberOfLines={1}
            testID={testID ? `${testID}-label` : undefined}
          >
            {label}
          </Text>
        </View>
      ) : null}
      {value !== undefined ? (
        <Text
          variant="heading"
          mono
          weight={500}
          style={[styles.value, { color: fg }]}
          testID={testID ? `${testID}-value` : undefined}
        >
          {value}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md + 2,
    paddingVertical: space['3'],
    paddingHorizontal: space['4'] + 2,
    gap: space['1'],
    minWidth: 0,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space['1'] + 2 },
  // 22/28 — one step above `heading`, the size the mockups give a tint card's number.
  value: { fontSize: 22, lineHeight: 28 },
});
