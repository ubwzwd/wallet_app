/**
 * The small mono section label 屏幕稿 12 375 sets *above* each card — 「成员 … 2 / 10」,
 * 「基准币种」, 「危险操作」 — instead of the wide frame's in-card heading.
 *
 * Wide keeps its headings inside the cards (屏幕稿 12 1440), so this only ever renders on
 * the narrow layout; each card decides which of the two it draws.
 */
import React from 'react';
import { View } from 'react-native';

import { space } from '@/theme/tokens';
import { Text } from '@/ui';

export interface SectionLabelProps {
  title: string;
  /** 屏幕稿 12 375 prints 「危险操作」 in the danger ink and the rest in muted grey. */
  danger?: boolean;
  /** The right-hand counter, e.g. 「2 / 10」 on the members section. */
  trailing?: React.ReactNode;
  testID?: string;
}

export function SectionLabel({
  title,
  danger = false,
  trailing,
  testID,
}: SectionLabelProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: space['3'],
        paddingHorizontal: space['1'] + 2,
        paddingBottom: space['2'],
      }}
    >
      <Text
        variant="micro"
        mono
        weight={600}
        tone={danger ? 'danger' : 'muted'}
        accessibilityRole="header"
        style={{ letterSpacing: 0.7 }}
      >
        {title}
      </Text>
      {trailing}
    </View>
  );
}

export default SectionLabel;
