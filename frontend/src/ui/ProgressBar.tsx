/**
 * ProgressBar (04 §6.4): 4 high, pill radius. Used for uploads and bulk edits — never for
 * import parsing, which is synchronous (04 §4.10).
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';

export interface ProgressBarProps {
  /** 0…1; values outside the range are clamped. */
  value: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT = 4;

export function ProgressBar({
  value,
  accessibilityLabel,
  style,
  testID,
}: ProgressBarProps): React.JSX.Element {
  const colors = useColors();
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      testID={testID}
      style={[
        {
          height: HEIGHT,
          borderRadius: radius.pill,
          overflow: 'hidden',
          backgroundColor: colors['bg.subtle'],
        },
        style,
      ]}
    >
      <View
        testID={testID ? `${testID}-fill` : undefined}
        style={{
          width: `${clamped * 100}%`,
          height: HEIGHT,
          borderRadius: radius.pill,
          backgroundColor: colors['accent.solid'],
        }}
      />
    </View>
  );
}
