/**
 * The review step's page header (屏幕稿 03, 04 §4.11.1).
 *
 * 「逐行确认」, the batch's own numbers inline on the same baseline — 「10 行 · 3 行待归类 ·
 * 1 行已跳过」 — and the two ways out at the far right: 「换个文件」 back to step one, and
 * 「放弃本次导入」 in the danger outline. The grey line underneath says what the mockup's
 * sidebar card 「本次导入」 says (the file, the account it books onto and every flag the
 * server raised at all); the sidebar itself belongs to the shell, not to this page.
 *
 * Discarding is the flow the history list runs for a draft batch, to the letter: one
 * confirm naming the file, then `DELETE`. Afterwards the batch is gone and this URL 404s
 * (decision §14.22), so the caller leaves for the history.
 *
 * Wide, the round back button and 「导入 · 逐行确认」 sit above it all (§14.64 e). Narrow
 * keeps the app's top bar, which already carries the title and the ‹, so only the row count
 * survives here (decision §14.56); 屏幕稿 03 · 375 draws no buttons on this line either.
 */
import React from 'react';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ImportBatch, ImportFlag, Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import { type Lang } from '@/i18n';
import { useBack } from '@/navigation';
import { useDeleteImport } from '@/queries';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, PageHeader, Text, confirm, toast } from '@/ui';

import { undoMeta } from '../undoBatch';

export interface ReviewHeaderProps {
  ledgerId: Uuid;
  batch: ImportBatch;
  lang: Lang;
  /** Rows still missing a level-1 category (the derived count of §4.11.4). */
  uncategorized: number;
  skipped: number;
  testID?: string;
}

export function ReviewHeader({
  ledgerId,
  batch,
  lang,
  uncategorized,
  skipped,
  testID,
}: ReviewHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const wide = useIsWide();
  const id = testID ?? 'import-batch-header';
  const discard = useDeleteImport(ledgerId, batch.id);
  const title = t('import:review.page_title');
  const back = useBack();

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
        await discard.mutateAsync(undefined);
      } catch {
        return; // the global error toast already explained the failure (04 §3.9)
      }
      toast.success(t('import:history.discarded_toast'));
      router.replace(routes.imports() as Href);
    })();
  }, [batch, discard, lang, router, t]);

  // The batch's own count, not the page at hand (03 §5.40). The two derived counts are
  // dropped when they are zero rather than shown as 「0 行待归类」.
  const stats = [
    t('import:review.stat_rows', { count: batch.row_count }),
    ...(wide && uncategorized > 0
      ? [t('import:review.stat_uncategorized', { count: uncategorized })]
      : []),
    ...(wide && skipped > 0 ? [t('import:review.stat_skipped', { count: skipped })] : []),
  ].join(' · ');

  return (
    <PageHeader
      testID={id}
      title={title}
      back={
        back.show
          ? {
              crumb: `${back.parentLabel} · ${title}`,
              onPress: back.goBack,
              label: t('common:button.back'),
            }
          : undefined
      }
      meta={
        <Text variant="body" tone="secondary" mono weight={500} testID="import-batch-summary">
          {stats}
        </Text>
      }
      subtitle={wide ? reviewSubtitle(batch, t) : undefined}
      actions={
        wide ? (
          <>
            <Button
              testID="import-batch-change-file"
              variant="secondary"
              label={t('import:review.change_file')}
              onPress={() => router.push(routes.importsNew() as Href)}
            />
            <Button
              testID="import-batch-discard"
              variant="danger"
              label={t('import:review.discard')}
              loading={discard.isPending}
              onPress={onDiscard}
            />
          </>
        ) : undefined
      }
    />
  );
}

/**
 * The grey line under the title: the file, the account every row books onto, and each flag
 * the server raised at all (04 §4.11.1). Exported because the committed panel's header
 * says the same thing about the same batch.
 */
export function reviewSubtitle(
  batch: ImportBatch,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const filename =
    batch.source === 'paste' ? t('import:history.pasted_filename') : (batch.filename ?? '');
  const flags = (Object.keys(batch.flags_summary) as ImportFlag[])
    .filter((flag) => (batch.flags_summary[flag] ?? 0) > 0)
    .map((flag) =>
      t('import:review.summary_flag', {
        label: t(`import:review.flag.${flag}`),
        count: batch.flags_summary[flag],
      }),
    );
  return [
    t('import:review.batch_line', { filename, source: batch.source_name }),
    ...flags,
  ].join(' · ');
}
