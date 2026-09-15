/**
 * StatTile (04 §6.4): the big numbers — assets / liabilities / net worth.
 * The value is always mono with tabular figures (04 §6.2 rule 6); the caller formats it.
 *
 * It used to clamp the value to one line and lean on `adjustsFontSizeToFit`, which does
 * nothing on the web: 「−¥1,234,567.89」 simply lost its tail. Instead the tile measures
 * itself and steps the number down from `display` (40) to `title` (28) when the wider step
 * would not fit, and lets it wrap as a last resort.
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
 * so a mono string's width is a multiplication rather than a measurement.
 */
export const MONO_ADVANCE = 0.6;

export function monoTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * MONO_ADVANCE;
}

/** The step a value of this length gets in a box this wide. */
export function stepForWidth(value: string, available: number): 'display' | 'title' {
  if (available <= 0) return 'display';
  return monoTextWidth(value, type.display.size) <= available ? 'display' : 'title';
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
