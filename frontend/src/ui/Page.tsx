/**
 * Page shell: the canvas background, safe-area padding, the 14–16 container padding of the
 * C2 density, and the 1200 reading width on wide screens (04 §6.3, §1.4).
 */
import React from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';

export const PAGE_MAX_WIDTH = 1200;

export interface PageProps {
  children?: React.ReactNode;
  /** Drops the 1200 reading-width cap (tables, the import review grid). */
  wide?: boolean;
  scroll?: boolean;
  /** Extra bottom padding, e.g. to clear the bottom tab bar. */
  bottomInset?: number;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/** Reads the safe area without throwing when no provider is mounted (tests, plain web). */
function useInsets(): { top: number; bottom: number; left: number; right: number } {
  const insets = React.useContext(SafeAreaInsetsContext);
  return insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
}

export function Page({
  children,
  wide = false,
  scroll = true,
  bottomInset = 0,
  contentStyle,
  style,
  testID,
  onScroll,
}: PageProps): React.JSX.Element {
  const colors = useColors();
  const insets = useInsets();

  const inner: StyleProp<ViewStyle> = [
    {
      width: '100%',
      alignSelf: 'center',
      maxWidth: wide ? undefined : PAGE_MAX_WIDTH,
      paddingHorizontal: space['4'],
      paddingTop: space['4'],
      paddingBottom: space['4'] + bottomInset + insets.bottom,
      gap: space['3'],
    },
    contentStyle,
  ];

  const root: StyleProp<ViewStyle> = [
    { flex: 1, backgroundColor: colors['bg.canvas'], paddingTop: insets.top },
    style,
  ];

  if (!scroll) {
    return (
      <View style={root} testID={testID}>
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={root}
      contentContainerStyle={inner}
      onScroll={onScroll}
      testID={testID}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
