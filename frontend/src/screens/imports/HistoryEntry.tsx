/**
 * One batch of 屏幕稿 11's history, wired to the router and to the two destructive flows.
 *
 * The shapes themselves live in `HistoryCard.tsx` (375) and `HistoryRows.tsx` (1440); this
 * is the piece that knows what pressing things does, so both frames behave identically and
 * 04 §8.5's cases do not care which one is on screen.
 */
import React from 'react';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ImportBatchListItem, Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import type { Lang } from '@/i18n';
import { useDeleteImport } from '@/queries';
import { confirm, toast } from '@/ui';

import { HistoryCard } from './HistoryCard';
import { HistoryTableRow } from './HistoryRows';
import { undoImportBatch, undoMeta } from './undoBatch';

/** `flags_summary` is a map of the four flags; the row shows their total (04 §4.10). */
export function totalFlags(batch: ImportBatchListItem): number {
  return Object.values(batch.flags_summary).reduce((sum, n) => sum + (n || 0), 0);
}

export interface HistoryEntryProps {
  ledgerId: Uuid;
  batch: ImportBatchListItem;
  uploader: string;
  lang: Lang;
  wide: boolean;
}

export function HistoryEntry({
  ledgerId,
  batch,
  uploader,
  lang,
  wide,
}: HistoryEntryProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const remove = useDeleteImport(ledgerId, batch.id);

  const onDiscard = React.useCallback((): void => {
    void (async () => {
      const ok = await confirm({
        title: t('import:history.discard_confirm_title'),
        body: t('import:history.discard_confirm_body', { count: batch.row_count }),
        confirmLabel: t('import:history.discard'),
        tone: 'danger',
        icon: 'trash-2',
        meta: undoMeta(batch, t, lang),
      });
      if (!ok) return;
      try {
        await remove.mutateAsync(undefined);
      } catch {
        return; // the global error toast already explained the failure (04 §3.9)
      }
      toast.success(t('import:history.discarded_toast'));
    })();
  }, [batch, lang, remove, t]);

  // The whole dry-run → confirm → delete → toast flow lives in one place (`undoBatch.ts`),
  // shared with the committed panel of the batch screen. The list has nowhere to go
  // afterwards: the batch simply leaves it (decision §14.22).
  const onUndo = React.useCallback((): void => {
    void undoImportBatch({ remove: remove.mutateAsync, batch, t, lang });
  }, [batch, lang, remove, t]);

  const shared = {
    batch,
    uploader,
    lang,
    totalFlags: totalFlags(batch),
    busy: remove.isPending,
    onDiscard,
    onUndo,
    onContinue: () => router.push(routes.l(ledgerId).importBatch(batch.id) as Href),
    onView: () =>
      router.push(routes.l(ledgerId).transactions({ import_batch_id: batch.id }) as Href),
  };

  return wide ? <HistoryTableRow {...shared} /> : <HistoryCard {...shared} />;
}

export default HistoryEntry;
