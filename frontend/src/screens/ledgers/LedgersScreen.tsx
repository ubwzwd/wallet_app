/**
 * `/ledgers` (04 §4.3, decision §14.65 c). It is no longer a page of ledger cards — the
 * ledger switcher already lists every ledger and the two ways to get another — but the
 * address stays, because the no-ledger onboarding, the landing after deleting or leaving a
 * ledger, and several fallbacks all point at it:
 *
 *   - with a ledger     → a redirect to that ledger's home, chosen exactly the way `/`
 *                         chooses it (`useLandingTarget`: the remembered ledger, else the
 *                         first);
 *   - with none         → screen 15's onboarding (`NoLedgerGuide`), full-bleed;
 *   - list still loading → placeholder cards; list failed → the error with a retry.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { type Href, Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { useLandingTarget } from '@/navigation';
import { useAuth } from '@/store';
import { EmptyState, Page, Skeleton } from '@/ui';

import { NoLedgerGuide } from './NoLedgerGuide';

/** Placeholder cards shown while `GET /ledgers` is in flight (04 §4.3). */
const SKELETON_CARDS = 2;

export default function LedgersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const target = useLandingTarget();

  if (target.kind === 'ledger') return <Redirect href={target.href} />;

  if (target.kind === 'pending') {
    return (
      <Page testID="ledgers-screen">
        {Array.from({ length: SKELETON_CARDS }, (_, i) => (
          <Skeleton key={i} variant="card" testID={`ledger-skeleton-${i}`} />
        ))}
      </Page>
    );
  }

  if (target.kind === 'error') {
    return (
      <Page testID="ledgers-screen">
        <EmptyState
          icon="alert-triangle"
          title={t('ledger:list.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: target.retry }}
          testID="ledgers-error"
        />
      </Page>
    );
  }

  return (
    <Page testID="ledgers-screen" contentStyle={styles.guidePage}>
      <NoLedgerGuide
        email={user?.email ?? ''}
        onOpenProfile={() => router.push(routes.settings() as Href)}
        onCreate={() => router.push(routes.ledgersNew() as Href)}
        onJoin={() => router.push(routes.ledgersJoin() as Href)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  guidePage: { flexGrow: 1, gap: 0 },
});
