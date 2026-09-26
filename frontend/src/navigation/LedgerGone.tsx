/**
 * 04 §1.5 rule 3: the ledger is missing, or the user was removed from it. The server
 * answers 404 for both (it must not leak whether a ledger exists), so the UI says both —
 * and, deliberately, **does not navigate on its own**: someone who was just removed from
 * a shared ledger has to see what happened instead of being bounced to a home screen.
 */
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Ledger } from '@/api/types';
import { routes } from '@/domain/routes';
import { EmptyState, Page } from '@/ui';
import { PREF_NAMES, getPref } from '@/utils/prefs';

export interface LedgerGoneProps {
  /** The ledger id in the URL, so the "switch to" offer never points back at it. */
  ledgerId: string;
  /** The ledgers that *are* reachable, used to resolve the remembered one. */
  ledgers: readonly Ledger[];
}

/** The remembered ledger, but only while it is still a ledger we can actually open. */
function useRememberedLedger(
  ledgers: readonly Ledger[],
  excludeId: string,
): Ledger | null {
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void getPref(PREF_NAMES.lastLedgerId).then((value) => {
      if (!cancelled) setId(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (id === null || id === excludeId) return null;
  return ledgers.find((l) => l.id === id) ?? null;
}

export function LedgerGone({ ledgerId, ledgers }: LedgerGoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const remembered = useRememberedLedger(ledgers, ledgerId);

  // 「回到首页」 (§14.65 e): `/` re-runs the landing redirect against the re-read list — a
  // ledger the user can open, or the onboarding page when none is left.
  const backHome = {
    label: t('common:ledger_unavailable.back_home'),
    onPress: () => router.replace('/'),
  };
  const switchToLast = remembered
    ? {
        label: t('common:ledger_unavailable.switch_last', { name: remembered.name }),
        onPress: () => router.replace(routes.l(remembered.id).home()),
      }
    : undefined;

  return (
    <Page scroll={false} testID="ledger-gone">
      <EmptyState
        icon="alert-triangle"
        title={t('common:ledger_unavailable.title')}
        body={t('common:ledger_unavailable.body')}
        primaryAction={switchToLast ?? backHome}
        secondaryAction={switchToLast ? backHome : undefined}
        testID="ledger-gone-actions"
      />
    </Page>
  );
}
