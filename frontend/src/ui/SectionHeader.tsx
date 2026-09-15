/**
 * The row that titles a block on a page (mockup 01: 「账户 … 管理账户」, 「近 12 个月支出 …
 * 月均 6,220 · 峰值 8,100（4 月）」).
 *
 * Left: the section's name, 20/700 wide and 15/700 narrow. Right: either a read-only meta
 * string (mono, so the numbers line up with the card below) or one accent link.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Text } from './Text';

export interface SectionHeaderLink {
  label: string;
  onPress(): void;
}

export interface SectionHeaderProps {
  title: string;
  /** Read-only trailing text; a string is rendered mono so digits align. */
  meta?: React.ReactNode;
  /** Trailing action ("管理账户", "全部交易"). Drawn after `meta` when both are given. */
  link?: SectionHeaderLink;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SectionHeader({
  title,
  meta,
  link,
  style,
  testID,
}: SectionHeaderProps): React.JSX.Element {
  const wide = useIsWide();
  const id = testID ?? 'section-header';
  return (
    <View testID={id} style={[styles.row, style]}>
      <Text
        variant={wide ? 'heading' : 'subheading'}
        weight={700}
        numberOfLines={1}
        style={styles.title}
        testID={`${id}-title`}
      >
        {title}
      </Text>
      {meta !== undefined ? (
        typeof meta === 'string' ? (
          <Text
            variant="caption"
            tone="secondary"
            mono
            weight={500}
            // 13/19, the step mockup 01 draws for 「月均 6,220 · 峰值 8,100（4 月）」 —
            // one above `caption`, which is why it is spelled out here.
            style={styles.meta}
            testID={`${id}-meta`}
          >
            {meta}
          </Text>
        ) : (
          meta
        )
      ) : null}
      {link ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={link.label}
          onPress={link.onPress}
          // A text link is only as tall as its line; the slop takes it to 44 without
          // pushing the header's baseline around.
          hitSlop={{ top: 12, bottom: 12, left: space['2'], right: space['2'] }}
          testID={`${id}-link`}
        >
          <Text variant="body" tone="accent" weight={600}>
            {link.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space['3'],
    paddingHorizontal: space['1'],
    alignSelf: 'stretch',
  },
  title: { flexShrink: 1, marginRight: 'auto' },
  meta: { fontSize: 13, lineHeight: 19 },
});
