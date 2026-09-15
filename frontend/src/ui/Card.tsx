/** Card (04 §6.4): radius 18, three depths. Dark mode layers by lightness, not shadow. */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { type ColorScheme, type Palette, density, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export type CardVariant = 'flat' | 'outlined' | 'raised';

/**
 * `tokens.shadow.raised`: the mockups draw a 10px blur, 2px down, at 7% of the foreground
 * ink — a green-tinted hairline lift, not a drop shadow. `shadow.note` says dark mode drops
 * it entirely and lets the surface/raised lightness step carry depth instead.
 *
 * Exported so every white block in the kit (list cards, the page header's back button, the
 * bar chart) lifts by exactly the same amount.
 */
export function raisedShadow(colors: Palette, scheme: ColorScheme): ViewStyle {
  if (scheme !== 'light') return {};
  return {
    shadowColor: colors['fg.primary'],
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  };
}

export interface CardProps {
  variant?: CardVariant;
  padded?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  variant = 'flat',
  padded = true,
  children,
  style,
  testID,
}: CardProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const raised = variant === 'raised';
  const base: ViewStyle = {
    borderRadius: radius.lg,
    padding: padded ? density.rowInnerPadding : 0,
    backgroundColor: raised ? colors['bg.raised'] : colors['bg.surface'],
    borderWidth: variant === 'outlined' ? 1 : 0,
    borderColor: variant === 'outlined' ? colors['border.default'] : undefined,
  };
  return (
    <View testID={testID} style={[base, raised ? raisedShadow(colors, scheme) : null, style]}>
      {children}
    </View>
  );
}

/** Standard vertical rhythm between cards (`density.cardGap`). */
export const CARD_GAP = density.cardGap;
export const CARD_PADDING = space['4'];
