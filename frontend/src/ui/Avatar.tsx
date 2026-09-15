/**
 * Letter avatar (mockups 01 / 12 / 13 / 14).
 *
 * Two shapes, and the shape carries the meaning: a `square` avatar is a ledger (rounded
 * square, solid accent fill), a `circle` avatar is a person (tinted well, secondary text).
 * The glyph is the caller's — the first character of a name — never an uploaded image.
 *
 * This is the only letter avatar in the app: the chrome (sidebar card, ledger switcher,
 * narrow top bar) draws its discs with this component too, which is what the `surface`
 * tone is for — the top bar's disc sits on `bg.canvas` and needs the page's own white.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { type ColorToken, radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from './Text';

export type AvatarShape = 'square' | 'circle';
/** `accent` is the filled forest-green tile, `muted` the tinted well, `surface` the card white. */
export type AvatarTone = 'accent' | 'muted' | 'surface';

/** The sizes the mockups use: 26 in a menu row, 32 in the sidebar, 40 in the narrow top
 *  bar, 64 on a profile card. Any number is accepted; these are just the ones drawn. */
export type AvatarSize = 26 | 32 | 36 | 40 | 64;

const TONE_BG: Readonly<Record<AvatarTone, ColorToken>> = {
  accent: 'accent.solid',
  muted: 'bg.subtle',
  surface: 'bg.surface',
};

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

/**
 * The mockups' glyph ladder: 26 → 12, 32 → 13, 44 → 17, 48 → 19, 56 → 21, 64 → 24 — a
 * 0.4 ratio everywhere except at the small end, where the initial never drops below the
 * 12px caption step or it stops reading as a letter.
 */
export function avatarGlyphSize(size: number): number {
  return Math.max(12, Math.round(size * 0.4));
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
  const fontSize = avatarGlyphSize(size);
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
          backgroundColor: colors[TONE_BG[resolvedTone]],
        },
        style,
      ]}
    >
      <Text
        variant="caption"
        weight={shape === 'square' ? 700 : 600}
        style={{
          fontSize,
          lineHeight: Math.round(fontSize * 1.38),
          color: accent ? colors['accent.fg'] : colors['fg.secondary'],
        }}
      >
        {avatarGlyph(name)}
      </Text>
    </View>
  );
}
