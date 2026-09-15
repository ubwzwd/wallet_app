/**
 * Letter avatar (mockups 01 / 12 / 14).
 *
 * Two shapes, and the shape carries the meaning: a `square` avatar is a ledger (rounded
 * square, solid accent fill), a `circle` avatar is a person (tinted well, secondary text).
 * The glyph is the caller's — the first character of a name — never an uploaded image.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from './Text';

export type AvatarShape = 'square' | 'circle';
export type AvatarTone = 'accent' | 'muted';

/** The sizes the mockups use: 26 in a menu row, 32 in the sidebar, 36 in a list, 64 on a
 *  profile card. Any number is accepted; these are just the ones that appear. */
export type AvatarSize = 26 | 32 | 36 | 64;

export interface AvatarProps {
  /** Usually a name; only the first character is drawn. */
  name: string;
  shape?: AvatarShape;
  size?: AvatarSize | number;
  /** `square` defaults to `accent`, `circle` to `muted`. */
  tone?: AvatarTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** First grapheme-ish character, upper-cased for latin scripts. */
export function avatarGlyph(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '?';
  return [...trimmed][0].toUpperCase();
}

export function Avatar({
  name,
  shape = 'circle',
  size = 32,
  tone,
  style,
  testID,
}: AvatarProps): React.JSX.Element {
  const colors = useColors();
  const resolvedTone: AvatarTone = tone ?? (shape === 'square' ? 'accent' : 'muted');
  const accent = resolvedTone === 'accent';
  return (
    <View
      testID={testID}
      style={[
        {
          width: size,
          height: size,
          flexShrink: 0,
          // A square ledger badge keeps a ~0.3 radius ratio at every size (26 → 8, 32 → 10,
          // the two the mockups draw); a person is a full circle.
          borderRadius: shape === 'circle' ? radius.pill : Math.round(size * 0.3),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: accent ? colors['accent.solid'] : colors['bg.subtle'],
        },
        style,
      ]}
    >
      <Text
        variant="caption"
        weight={shape === 'square' ? 700 : 600}
        style={{
          fontSize: Math.round(size * 0.4),
          lineHeight: Math.round(size * 0.55),
          color: accent ? colors['accent.fg'] : colors['fg.secondary'],
        }}
      >
        {avatarGlyph(name)}
      </Text>
    </View>
  );
}
