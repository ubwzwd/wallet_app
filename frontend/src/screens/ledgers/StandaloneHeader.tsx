/**
 * The header `/ledgers/new` and `/ledgers/join` draw for themselves where nothing above
 * them carries a title and a way back — for a user with no ledger at all, at both widths:
 * the shell steps aside there (屏幕稿 15, §14.59), so the page is on its own, and its back
 * leads to the onboarding page. Everyone else gets the shell's top bar (narrow) or a
 * `PageHeader` crumb (wide); `LedgerPageHead` picks.
 *
 * Screen 13 draws the narrow form — the round back button on the left, the page title
 * centred, a matching gap on the right — and on a wide screen the same two elements sit on
 * one left-aligned line. The button is the app's one `BackButton`.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { BACK_BUTTON_SIZE, BackButton, Text } from '@/ui';

export interface StandaloneHeaderProps {
  title: string;
  /** Where the back button goes. */
  onBack(): void;
  testID?: string;
}

export function StandaloneHeader({
  title,
  onBack,
  testID = 'standalone-header',
}: StandaloneHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();

  return (
    <View style={styles.row} testID={testID}>
      <BackButton label={t('common:button.back')} onPress={onBack} testID={`${testID}-back`} />
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
  titleWide: { flex: 1 },
  titleNarrow: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 24 },
  spacer: { width: BACK_BUTTON_SIZE },
});
