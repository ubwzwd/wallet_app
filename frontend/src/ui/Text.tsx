/**
 * The only text primitive (04 §6.3): seven type steps from tokens, a semantic tone instead
 * of a colour, and a mono switch for money / dates / row numbers (tabular figures).
 */
import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { type ColorToken, type TypeVariant, type } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { fontFamilyFor } from '@/theme/fonts';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'inverse'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info'
  | 'accent'
  | 'expense'
  | 'income'
  | 'refund'
  | 'transfer';

export const TONE_TOKEN: Readonly<Record<TextTone, ColorToken>> = {
  primary: 'fg.primary',
  secondary: 'fg.secondary',
  muted: 'fg.muted',
  inverse: 'fg.inverse',
  danger: 'status.danger.fg',
  success: 'status.success.fg',
  warning: 'status.warning.fg',
  info: 'status.info.fg',
  accent: 'accent.solid',
  expense: 'kind.expense',
  income: 'kind.income',
  refund: 'kind.refund',
  transfer: 'kind.transfer',
};

/** Headline steps get the −0.02em tracking called for in 04 §6.3. */
const TIGHT_TRACKING: readonly TypeVariant[] = ['display', 'title'];

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  /** IBM Plex Mono + tabular figures: every number in the app goes through this. */
  mono?: boolean;
  weight?: number;
  children?: React.ReactNode;
}

export function textStyleFor(
  variant: TypeVariant,
  mono: boolean,
  weight: number | undefined,
): TextStyle {
  const step = type[variant];
  const resolved = weight ?? step.weight;
  const style: TextStyle = {
    fontSize: step.size,
    lineHeight: step.lineHeight,
    fontWeight: String(resolved) as TextStyle['fontWeight'],
    fontFamily: fontFamilyFor(resolved, mono),
  };
  if (TIGHT_TRACKING.includes(variant)) style.letterSpacing = -0.02 * step.size;
  if (mono) style.fontVariant = ['tabular-nums'];
  return style;
}

export function Text({
  variant = 'body',
  tone = 'primary',
  mono = false,
  weight,
  style,
  children,
  ...rest
}: TextProps): React.JSX.Element {
  const colors = useColors();
  return (
    <RNText
      {...rest}
      style={[textStyleFor(variant, mono, weight), { color: colors[TONE_TOKEN[tone]] }, style]}
    >
      {children}
    </RNText>
  );
}
