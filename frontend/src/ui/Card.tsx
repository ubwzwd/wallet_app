/** Card (04 §6.4): radius 18, three depths. Dark mode layers by lightness, not shadow. */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { density, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export type CardVariant = 'flat' | 'outlined' | 'raised';

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
  // `shadow.note`: no shadow in dark mode, the surface/raised lightness step carries depth.
  const lift: ViewStyle =
    raised && scheme === 'light'
      ? {
          shadowColor: colors['fg.primary'],
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 1,
        }
      : {};
  return (
    <View testID={testID} style={[base, lift, style]}>
      {children}
    </View>
  );
}

/** Standard vertical rhythm between cards (`density.cardGap`). */
export const CARD_GAP = density.cardGap;
export const CARD_PADDING = space['4'];
