/**
 * The catch-all route (04 §1.2, last row): one sentence and a way back to a page that
 * certainly exists. `/` re-runs the landing redirect, so the button lands on whichever
 * ledger the user was last in.
 */
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, Page } from '@/ui';

export function NotFoundScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Page scroll={false} testID="not-found">
      <EmptyState
        icon="search"
        title={t('common:not_found.title')}
        body={t('common:not_found.body')}
        primaryAction={{
          label: t('common:not_found.action'),
          onPress: () => router.replace('/'),
        }}
        testID="not-found-actions"
      />
    </Page>
  );
}

export default NotFoundScreen;
