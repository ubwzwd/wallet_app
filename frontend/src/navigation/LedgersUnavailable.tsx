/**
 * `GET /ledgers` failed: which ledger is current is neither confirmed nor denied, so offer a
 * retry rather than guessing (04 §1.5). Rendered by `CurrentLedgerProvider`.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, Page } from '@/ui';

export function LedgersUnavailable({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Page scroll={false} testID="ledgers-unavailable">
      <EmptyState
        icon="refresh-cw"
        title={t('ledger:list.error_retry')}
        primaryAction={{ label: t('common:button.retry'), onPress: onRetry }}
      />
    </Page>
  );
}
