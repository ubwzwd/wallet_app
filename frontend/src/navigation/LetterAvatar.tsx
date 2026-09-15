/**
 * The initial-in-a-tile avatar the mockups use wherever a ledger or a person is named
 * without a picture: a square tile for a ledger (screens 01, 12, 13), a round disc for a
 * person (the sidebar's foot and the narrow top bar).
 *
 * It lives in the chrome rather than in `src/ui` because it is only ever the chrome's:
 * pages name people through their own components.
 */
import React from 'react';
import { View } from 'react-native';

import { type ColorToken, radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from '@/ui';

export interface LetterAvatarProps {
  /** The initial is the first character of this. */
  name: string;
  size: number;
  /** Square for a ledger, round for a person (screen 01 at 1440). */
  shape: 'square' | 'round';
  /** `accent` is the filled forest-green tile; `subtle` and `surface` the quiet ones. */
  tone: 'accent' | 'subtle' | 'surface';
}

const TONE_BG: Readonly<Record<LetterAvatarProps['tone'], ColorToken>> = {
  accent: 'accent.solid',
  subtle: 'bg.subtle',
  surface: 'bg.surface',
};

export function LetterAvatar({ name, size, shape, tone }: LetterAvatarProps): React.JSX.Element {
  const colors = useColors();
  const initial = [...name.trim()][0]?.toUpperCase() ?? '';
  const fontSize = size <= 28 ? 12 : 13;
  return (
    <View
      style={{
        width: size,
        height: size,
        // Screen 01: a 32px tile has a 10px corner, a 26px one an 8px corner.
        borderRadius: shape === 'round' ? radius.pill : Math.round(size / 3.2),
        backgroundColor: colors[TONE_BG[tone]],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        weight={tone === 'accent' ? 700 : 600}
        style={{
          fontSize,
          lineHeight: fontSize + 5,
          color: tone === 'accent' ? colors['accent.fg'] : colors['fg.secondary'],
        }}
      >
        {initial}
      </Text>
    </View>
  );
}
