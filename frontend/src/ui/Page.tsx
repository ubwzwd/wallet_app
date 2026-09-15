/**
 * Page shell: the canvas background, safe-area padding and the container padding of the C2
 * density (04 §6.3, §1.4).
 *
 * Phase 7 dropped the 1200 reading-width cap: every mockup's content area runs the full
 * width of the frame next to the sidebar (decision §14.45 — the mockups are the visual
 * source of truth). A page that really wants a reading column asks for `readingWidth`.
 * Wide screens get 24 above and 28 at the sides, the padding the mockups draw.
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
import { useIsWide } from '@/theme/useBreakpoint';

/** The reading column `readingWidth` opts into (prose pages: the import guide, about). */
export const PAGE_MAX_WIDTH = 1200;

export interface PageProps {
  children?: React.ReactNode;
  /**
   * Kept for callers written before phase 7, when it dropped the reading-width cap. The
   * cap is gone by default now, so this is a no-op: it is neither destructured nor read.
   *
   * The only callers left are the four `<Page wide>` in `ImportBatchScreen.tsx`; delete
   * them — and then this prop — when that page is rebuilt.
   * @deprecated pages fill their column; pass `readingWidth` to cap one.
   */
  wide?: boolean;
  /** Caps the content at `PAGE_MAX_WIDTH` and centres it. */
  readingWidth?: boolean;
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
  readingWidth = false,
  scroll = true,
  bottomInset = 0,
  contentStyle,
  style,
  testID,
  onScroll,
}: PageProps): React.JSX.Element {
  const colors = useColors();
  const insets = useInsets();
  const isWide = useIsWide();

  const inner: StyleProp<ViewStyle> = [
    {
      width: '100%',
      alignSelf: 'center',
      maxWidth: readingWidth ? PAGE_MAX_WIDTH : undefined,
      paddingHorizontal: isWide ? space['7'] : space['4'],
      paddingTop: isWide ? space['6'] : space['4'],
      paddingBottom: (isWide ? space['7'] : space['4']) + bottomInset + insets.bottom,
      gap: isWide ? space['6'] : space['3'],
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
