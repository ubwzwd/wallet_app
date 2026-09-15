/**
 * The round tinted icon well the settings mockups put in front of a row title
 * (屏幕稿 12 危险操作 / 基准币种, 屏幕稿 14 关于).
 *
 * One tone drives both the fill and the glyph, so the well never borrows a background
 * from one semantic and an ink from another.
 */
import React from 'react';
import { View } from 'react-native';
import { radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, type IconName, TINT_TONES, type TintTone } from '@/ui';

export interface IconWellProps {
  name: IconName;
  tone?: TintTone;
  /** 32 in a list row, 38 next to a card title (屏幕稿 12). */
  size?: number;
  testID?: string;
}

export function IconWell({
  name,
  tone = 'neutral',
  size = 32,
  testID,
}: IconWellProps): React.JSX.Element {
  const colors = useColors();
  const paint = TINT_TONES[tone];
  return (
    <View
      testID={testID}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors[paint.bg],
      }}
    >
      <Icon name={name} size={Math.round(size * 0.55)} color={colors[paint.fg]} />
    </View>
  );
}

export default IconWell;
