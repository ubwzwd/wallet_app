/**
 * The placeholder behind every `/l/:ledgerId/imports*` route (04 §4.10).
 *
 * Import is the one feature of the target design that this phase does not ship, but the
 * bottom tab bar and the sidebar both link to it (`common:nav.imports`) — without a route
 * those links 404 on a real URL. So the three import paths of §1.2 (`/imports`,
 * `/imports/guide`, `/imports/new`) all resolve to this page, which says when the feature
 * arrives and offers one way back to the ledger's home page.
 *
 * `router.replace`, not `push`: the placeholder is not a step anybody wants in their back
 * stack.
 */
import React from 'react';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { useTopBar } from '@/navigation';
import { useLedgerContext } from '@/store';
import { EmptyState, Page } from '@/ui';

export default function ComingSoonScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  useTopBar(t('import:coming_soon.title'));

  const goHome = React.useCallback(
    () => router.replace(routes.l(ledgerId).home() as Href),
    [ledgerId, router],
  );

  return (
    <Page testID="imports-coming-soon">
      <EmptyState
        icon="upload"
        title={t('import:coming_soon.title')}
        body={t('import:coming_soon.body')}
        primaryAction={{ label: t('import:coming_soon.back_home'), onPress: goHome }}
        testID="imports-coming-soon-empty"
      />
    </Page>
  );
}
