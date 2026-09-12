/** A hairline in `border.default` — the only rule the design uses (04 §6.1). */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/ThemeProvider';

export interface DividerProps {
  vertical?: boolean;
  /** Inset from the leading edge, e.g. to align with a row's text column. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Divider({
  vertical = false,
  inset = 0,
  style,
  testID,
}: DividerProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        vertical
          ? { width: 1, alignSelf: 'stretch', marginVertical: inset }
          : { height: 1, alignSelf: 'stretch', marginLeft: inset },
        { backgroundColor: colors['border.default'] },
        style,
      ]}
    />
  );
}
