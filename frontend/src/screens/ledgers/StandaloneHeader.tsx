/**
 * The header `/ledgers/new` and `/ledgers/join` draw for themselves.
 *
 * Both pages live outside the app shell (04 §1.2), so nothing above them carries a title
 * or a way back. Screen 13 draws the narrow form of it — a round back button on the left,
 * the page title centred, a matching gap on the right — and on a wide screen the same two
 * elements sit on one left-aligned line, the way every other page's `PageHeader` crumb does.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, Text, raisedShadow } from '@/ui';

const BACK_SIZE = 40;
const BACK_SLOP = (44 - BACK_SIZE) / 2;

export interface StandaloneHeaderProps {
  title: string;
  /** Where the back button goes; usually the ledger list. */
  onBack(): void;
  testID?: string;
}

export function StandaloneHeader({
  title,
  onBack,
  testID = 'standalone-header',
}: StandaloneHeaderProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation();
  const wide = useIsWide();

  return (
    <View style={styles.row} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:button.back')}
        onPress={onBack}
        hitSlop={BACK_SLOP}
        testID={`${testID}-back`}
        style={({ pressed }) => [
          styles.back,
          raisedShadow(colors, scheme),
          { backgroundColor: pressed ? colors['bg.hover'] : colors['bg.surface'] },
        ]}
      >
        <Icon name="chevron-left" color={colors['fg.secondary']} />
      </Pressable>
      <Text
        variant="heading"
        weight={700}
        accessibilityRole="header"
        numberOfLines={1}
        testID={`${testID}-title`}
        style={wide ? styles.titleWide : styles.titleNarrow}
      >
        {title}
      </Text>
      {/* Balances the button so the narrow title lands dead centre. */}
      {wide ? null : <View style={styles.spacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'], alignSelf: 'stretch' },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWide: { flex: 1 },
  titleNarrow: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 24 },
  spacer: { width: BACK_SIZE },
});
