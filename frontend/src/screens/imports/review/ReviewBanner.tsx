/**
 * The standing "this batch cannot be submitted yet" banner (04 §4.11.8, 屏幕稿 03).
 *
 * 屏幕稿 03 puts it right under the page header, sand on the page's own ground, with the
 * jump link at the far end of the strip — so the blocker is read before the table, not
 * discovered at the bottom of it. The submit bar keeps its own short version beside the
 * disabled button; this is the one that explains and offers the way out.
 */
import React from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, Text } from '@/ui';

export interface ReviewBannerProps {
  /** Rows still missing a level-1 category (the derived count of §4.11.4). */
  count: number;
  /** Focus (and scroll to) the first of them. */
  onJump(): void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ReviewBanner({
  count,
  onJump,
  style,
  testID,
}: ReviewBannerProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'review-banner';
  if (count === 0) return null;

  return (
    <View
      testID={id}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: space['3'],
          paddingVertical: space['3'],
          paddingHorizontal: space['4'],
          borderRadius: radius.md,
          backgroundColor: colors['status.warning.bg'],
        },
        style,
      ]}
    >
      <Icon name="alert-triangle" size={18} color={colors['status.warning.fg']} />
      <Text variant="body" weight={600} tone="warning" style={{ flex: 1, minWidth: 0 }}>
        {t('import:review.block_uncategorized', { count })}
      </Text>
      <Pressable
        testID={`${id}-jump`}
        accessibilityRole="button"
        onPress={onJump}
        hitSlop={space['3']}
      >
        <Text
          variant="body"
          weight={600}
          tone="warning"
          style={{ textDecorationLine: 'underline' }}
        >
          {t('import:review.jump_to_first')}
        </Text>
      </Pressable>
    </View>
  );
}
