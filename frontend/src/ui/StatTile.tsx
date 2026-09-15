/**
 * StatTile (04 §6.4): the big numbers — assets / liabilities / net worth.
 * The value is always mono with tabular figures (04 §6.2 rule 6); the caller formats it.
 *
 * It used to clamp the value to one line and lean on `adjustsFontSizeToFit`, which does
 * nothing on the web: 「−¥1,234,567.89」 simply lost its tail. Instead the tile measures
 * itself and steps the number down through `display` (40) → `title` (28) → `heading` (20)
 * until it fits, and lets it wrap only when even the smallest step is too wide.
 */
import React from 'react';
import {
  type LayoutChangeEvent,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { space, type } from '@/theme/tokens';
import { Card, type CardVariant } from './Card';
import { Text, type TextTone } from './Text';

/**
 * IBM Plex Mono's advance width is 0.6em, and tabular figures make every glyph that wide,
 * so a mono string's width is a multiplication rather than a measurement. CJK glyphs come
 * from the fallback stack and are full-width, so they count double ('欠 ¥23,772.50').
 */
export const MONO_ADVANCE = 0.6;
const WIDE_GLYPH = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function monoTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += WIDE_GLYPH.test(ch) ? 2 : 1;
  return units * fontSize * MONO_ADVANCE;
}

/** The steps a big number may fall through, widest first. */
export type StatStep = 'display' | 'title' | 'heading';
const STEPS: readonly StatStep[] = ['display', 'title', 'heading'];

/**
 * The widest step whose rendering still fits the box. Nothing below `heading` — a number
 * that will not fit even there wraps, which is still better than losing its tail.
 */
export function stepForWidth(value: string, available: number): StatStep {
  if (available <= 0) return 'display';
  for (const step of STEPS) {
    if (monoTextWidth(value, type[step].size) <= available) return step;
  }
  return 'heading';
}

export interface StatTileProps {
  label: string;
  /** Already formatted through `src/i18n/format.ts` — this component never formats. */
  value: string;
  sub?: string;
  tone?: TextTone;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'primary',
  variant = 'flat',
  style,
  testID,
}: StatTileProps): React.JSX.Element {
  // The slot the number lives in, measured once it has been laid out. Until then the
  // number renders at the `display` step, which is what a roomy tile ends up with anyway.
  const [inner, setInner] = React.useState(0);
  const onLayout = (e: LayoutChangeEvent): void => setInner(e.nativeEvent.layout.width);

  return (
    <Card variant={variant} style={[{ gap: space['1'] }, style]} testID={testID}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <View onLayout={onLayout} style={styles.slot}>
        <Text variant={stepForWidth(value, inner)} tone={tone} mono>
          {value}
        </Text>
      </View>
      {sub !== undefined ? (
        <Text variant="caption" tone="muted">
          {sub}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  slot: { alignSelf: 'stretch' },
});
