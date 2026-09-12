/**
 * `/l/:ledgerId` — a temporary placeholder so the ledger tree has a landing page while the
 * home screen is being built. The home-page task replaces this file with the usual one-line
 * re-export of `@/screens/home`.
 */
import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { Button, Page, Text } from '@/ui';

export default function LedgerHomePlaceholder(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  const l = routes.l(ledgerId);

  return (
    <Page testID="ledger-home-placeholder">
      <Text variant="title" accessibilityRole="header">
        {t('common:placeholder.home_building')}
      </Text>
      <View style={{ gap: space['3'], maxWidth: 420, width: '100%' }}>
        <Button
          label={t('common:nav.transactions')}
          icon="list"
          fullWidth
          onPress={() => router.navigate(l.transactions() as Href)}
          testID="placeholder-transactions"
        />
        <Button
          label={t('common:nav.sources')}
          icon="wallet"
          variant="secondary"
          fullWidth
          onPress={() => router.navigate(l.sources() as Href)}
          testID="placeholder-sources"
        />
      </View>
    </Page>
  );
}
