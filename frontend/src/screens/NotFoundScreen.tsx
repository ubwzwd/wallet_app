/**
 * The catch-all route (04 §1.2, last row): one sentence and a way back to a page that
 * certainly exists. `/` re-runs the landing redirect, so the button lands on whichever
 * ledger the user was last in.
 *
 * It borrows screen 17's "registration is closed" composition — brand bar, centred 420
 * column, one card with a neutral tile — because it is the same kind of page: a dead end
 * outside the app shell, where the only thing to do is leave.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AuthLayout } from '@/screens/auth/AuthLayout';
import { radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Icon, Text } from '@/ui';

const TILE_SIZE = 48;

export function NotFoundScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();

  return (
    <AuthLayout title={t('common:not_found.title')} testID="not-found">
      <View style={[styles.tile, { backgroundColor: colors['bg.subtle'] }]}>
        <Icon name="search" size={22} color={colors['fg.secondary']} />
      </View>
      <Text variant="subheading" weight={400} tone="secondary">
        {t('common:not_found.body')}
      </Text>
      <Button
        testID="not-found-actions"
        label={t('common:not_found.action')}
        variant="soft"
        size="lg"
        onPress={() => router.replace('/')}
        fullWidth
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default NotFoundScreen;
