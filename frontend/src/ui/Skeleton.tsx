/** Loading placeholders (04 §6.4): a list row, a card, or a table of rows. */
import React from 'react';
import { Animated, type StyleProp, View, type ViewStyle } from 'react-native';
import { density, motion, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';

export type SkeletonVariant = 'row' | 'card' | 'table' | 'block';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** Rows drawn by the `table` variant. */
  rows?: number;
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A single pulsing bar; the shared primitive behind every variant. */
function Bar({
  width,
  height,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const colors = useColors();
  const pulse = React.useRef(new Animated.Value(0.6)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: motion.base * 3,
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.6,
          duration: motion.base * 3,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: radius.sm,
          backgroundColor: colors['bg.subtle'],
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

export function Skeleton({
  variant = 'block',
  rows = 3,
  width,
  height,
  style,
  testID,
}: SkeletonProps): React.JSX.Element {
  if (variant === 'row') {
    return (
      <View
        testID={testID}
        accessibilityRole="progressbar"
        style={[
          {
            height: density.listRowHeight,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space['3'],
          },
          style,
        ]}
      >
        <Bar width={36} height={36} style={{ borderRadius: radius.pill }} />
        <View style={{ flex: 1, gap: space['2'] }}>
          <Bar width="60%" height={12} />
          <Bar width="35%" height={10} />
        </View>
        <Bar width={64} height={14} />
      </View>
    );
  }

  if (variant === 'card') {
    return (
      <View
        testID={testID}
        accessibilityRole="progressbar"
        style={[
          {
            borderRadius: radius.lg,
            padding: density.rowInnerPadding,
            gap: space['3'],
          },
          style,
        ]}
      >
        <Bar width="40%" height={12} />
        <Bar height={height ?? 40} />
        <Bar width="70%" height={10} />
      </View>
    );
  }

  if (variant === 'table') {
    return (
      <View testID={testID} accessibilityRole="progressbar" style={[{ gap: space['2'] }, style]}>
        {Array.from({ length: rows }, (_, i) => (
          <Bar key={i} height={44} />
        ))}
      </View>
    );
  }

  return (
    <View testID={testID} accessibilityRole="progressbar" style={style}>
      <Bar width={width} height={height ?? 14} />
    </View>
  );
}
