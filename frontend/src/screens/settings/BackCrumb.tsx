/**
 * The wide back row for a settings page whose head is not a `PageHeader` (屏幕稿 12's
 * ledger head is its own card): the app's one round `BackButton` and the grey trail
 * 「首页 · 账本设置」, laid out exactly like `PageHeader`'s crumb row (屏幕稿 08, §14.64 e).
 *
 * Wide only, and only on a sub-page — narrow screens get their ‹ from the shell's top bar,
 * and a top-level page has none (`useBack().show`).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/navigation';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { BackButton, Text } from '@/ui';

export interface BackCrumbProps {
  /** This page's own title — the trail's second half. */
  title: string;
  /** The row's testID; the button is `${testID}-back`, as in `PageHeader`. */
  testID: string;
}

export function BackCrumb({ title, testID }: BackCrumbProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const wide = useIsWide();
  const back = useBack();
  if (!wide || !back.show) return null;

  return (
    <View style={styles.row} testID={testID}>
      <BackButton
        label={t('common:button.back')}
        onPress={back.goBack}
        testID={`${testID}-back`}
      />
      <Text variant="caption" tone="muted" numberOfLines={1} style={styles.crumb}>
        {`${back.parentLabel} · ${title}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  crumb: { flex: 1 },
});
