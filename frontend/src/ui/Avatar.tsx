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
 *  bar, 44 on a ledger card, 56 / 64 on a profile card. Any number is accepted; these are
 *  just the ones drawn. */
export type AvatarSize = 26 | 32 | 36 | 40 | 44 | 48 | 56 | 64;

const TONE_BG: Readonly<Record<AvatarTone, ColorToken>> = {
  accent: 'accent.solid',
  muted: 'bg.subtle',
  surface: 'bg.raised',
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
 * The glyph ladder the mockups actually draw, read off the `.dc.html` sources: 26 → 12
 * (switcher row), 32 → 13 (sidebar card, sidebar user, `屏幕 14:131`), 40 → 13 (narrow top
 * bar, `屏幕 01:63`), 44 → 17 (`屏幕 13:120`), 48 → 19, 56 → 21 (`屏幕 14:44`), 64 → 24
 * (`屏幕 14:161`).
 *
 * It is not one ratio: the small end flattens at 13 so the initial keeps reading as a
 * letter, and the large end sits well under 0.4. A size the mockups never draw is placed
 * between its neighbours on this ladder instead of being scaled.
 */
const GLYPH_LADDER: readonly (readonly [size: number, glyph: number])[] = [
  [26, 12],
  [32, 13],
  [40, 13],
  [44, 17],
  [48, 19],
  [56, 21],
  [64, 24],
];

export function avatarGlyphSize(size: number): number {
  const first = GLYPH_LADDER[0];
  const last = GLYPH_LADDER[GLYPH_LADDER.length - 1];
  if (size <= first[0]) return Math.max(12, Math.round((size * first[1]) / first[0]));
  if (size >= last[0]) return Math.round((size * last[1]) / last[0]);
  for (let i = 1; i < GLYPH_LADDER.length; i += 1) {
    const [hi, hiGlyph] = GLYPH_LADDER[i];
    if (size > hi) continue;
    const [lo, loGlyph] = GLYPH_LADDER[i - 1];
    if (size === hi) return hiGlyph;
    // Between two drawn steps: walk the line between them rather than invent a ratio.
    return Math.round(loGlyph + ((hiGlyph - loGlyph) * (size - lo)) / (hi - lo));
  }
  return last[1];
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
