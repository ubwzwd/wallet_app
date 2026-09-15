/**
 * The fact list a detail page ends its main column with (屏幕稿 07 / 08): 日期 / 分类 /
 * 账户 / 原币金额 / 折算 / 备注 / 记录人 / 来源, each a 48-tall row inside one white card.
 *
 * `KeyValueRows` owns the card, the hairlines and the label column; this module owns what
 * the mockups add on top of it — the value column is right-aligned on a narrow screen, the
 * numbers are mono, and 来源 can be a link into the import batch the row came from.
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { KeyValueRows, type KeyValueRow, Text } from '@/ui';

export interface Fact {
  /** Stable id; also the row's `testID` suffix. */
  id: string;
  label: string;
  value: string;
  mono?: boolean;
  /** A long 备注 wraps instead of being clipped. */
  wrap?: boolean;
  /** 来源: opens the import batch this row was created by. */
  onPress?(): void;
}

export interface KeyFactsProps {
  facts: readonly Fact[];
  testID?: string;
}

/** The mockups' label column: 150 wide, and 100 once the value moves to the right edge. */
const LABEL_WIDTH_WIDE = 150;
const LABEL_WIDTH_NARROW = 88;

export function KeyFacts({ facts, testID }: KeyFactsProps): React.JSX.Element {
  const wide = useIsWide();
  const id = testID ?? 'detail-facts';

  const rows: KeyValueRow[] = facts.map((fact) => {
    const text = (
      <Text
        variant="body"
        mono={fact.mono ?? false}
        numberOfLines={fact.wrap === true ? undefined : 1}
        style={wide ? undefined : styles.right}
        testID={`${id}-value-${fact.id}`}
      >
        {fact.value}
      </Text>
    );
    return {
      id: fact.id,
      label: fact.label,
      value: fact.onPress ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={fact.value}
          onPress={fact.onPress}
          hitSlop={space['3']}
          testID={`${id}-link-${fact.id}`}
        >
          <Text
            variant="body"
            tone="accent"
            weight={600}
            numberOfLines={1}
            style={wide ? undefined : styles.right}
          >
            {fact.value}
          </Text>
        </Pressable>
      ) : (
        text
      ),
    };
  });

  return (
    <KeyValueRows
      rows={rows}
      labelWidth={wide ? LABEL_WIDTH_WIDE : LABEL_WIDTH_NARROW}
      testID={id}
    />
  );
}

const styles = StyleSheet.create({
  right: { textAlign: 'right' },
});
