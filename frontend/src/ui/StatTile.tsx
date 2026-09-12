/**
 * StatTile (04 §6.4): the home page's big numbers — assets / liabilities / net worth.
 * The value is always mono with tabular figures (04 §6.2 rule 6); the caller formats it.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { space } from '@/theme/tokens';
import { Card, type CardVariant } from './Card';
import { Text, type TextTone } from './Text';

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
  return (
    <Card variant={variant} style={[{ gap: space['1'] }, style]} testID={testID}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="display" tone={tone} mono numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub !== undefined ? (
        <Text variant="caption" tone="muted">
          {sub}
        </Text>
      ) : null}
    </Card>
  );
}
