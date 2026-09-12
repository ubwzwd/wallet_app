/**
 * Ledger settings → delete the ledger (04 §4.12, decision §14.52 A22).
 *
 * The confirmation spells out the three counts `GET /ledgers/{id}` returns and only
 * unlocks once the ledger's name has been typed out by hand. No CSV export first
 * (decision §14.52 A1).
 */
import React from 'react';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { LedgerDetail } from '@/api/types';
import { routes } from '@/domain/routes';
import { useDeleteLedger } from '@/queries';
import { space } from '@/theme/tokens';
import { Button, Card, Text, confirm, toast } from '@/ui';

export interface DangerZoneProps {
  detail: LedgerDetail;
}

export function DangerZone({ detail }: DangerZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const remove = useDeleteLedger(detail.id);

  const onDelete = (): void => {
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.danger.delete_title'),
        body: t('ledger:settings.danger.delete_confirm_body', {
          name: detail.name,
          transactions: detail.counts.transactions,
          sources: detail.counts.sources,
          imports: detail.counts.import_batches,
        }),
        tone: 'danger',
        requireText: detail.name,
        requireTextLabel: t('ledger:settings.danger.delete_confirm_label'),
        confirmLabel: t('ledger:settings.danger.delete_action'),
      });
      if (!ok) return;
      remove.mutate(undefined, {
        onSuccess: () => {
          toast.success(t('ledger:settings.danger.deleted_toast', { name: detail.name }));
          router.replace(routes.ledgers() as Href);
        },
      });
    })();
  };

  return (
    <Card variant="outlined" style={{ gap: space['2'] }} testID="danger-zone">
      <Text variant="heading" accessibilityRole="header" tone="danger">
        {t('ledger:settings.danger.title')}
      </Text>
      <Button
        testID="delete-ledger"
        label={t('ledger:settings.danger.delete_action')}
        variant="danger"
        size="sm"
        onPress={onDelete}
        loading={remove.isPending}
      />
    </Card>
  );
}

export default DangerZone;
