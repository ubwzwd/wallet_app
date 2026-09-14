/**
 * `/l/:ledgerId/imports` — the batch history (04 §4.10, decisions §14.22, §14.52 A17/B24).
 *
 * A batch has exactly two states (decision §5): `ready` (a validated draft waiting to be
 * reviewed) and `committed`. There is no `reverted` — undoing an import deletes the batch,
 * so it simply leaves this list.
 *
 * Both destructive actions go through `useDeleteImport`. For a committed batch the delete
 * is asked twice: once with `?dry_run=true`, whose two refund counters are worded
 * *separately* in the confirmation because they mean different things (decision §14.52 B24),
 * and then for real.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ImportBatchListItem, Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import { formatBytes, formatDateTime, formatMoney } from '@/i18n/format';
import { useLang, type Lang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useDeleteImport, useImports, useMemberNames } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Page,
  Skeleton,
  Text,
  confirm,
  toast,
} from '@/ui';

/** 04 §4.10: the history pages 20 batches at a time. */
export const IMPORTS_PAGE_SIZE = 20;

/** `flags_summary` is a map of the four flags; the row shows their total (04 §4.10). */
export function totalFlags(batch: ImportBatchListItem): number {
  return Object.values(batch.flags_summary).reduce((sum, n) => sum + (n || 0), 0);
}

function Field({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={{ gap: space['1'], minWidth: 104 }}>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      <Text variant="caption" testID={testID}>
        {value}
      </Text>
    </View>
  );
}

interface HistoryRowProps {
  ledgerId: Uuid;
  batch: ImportBatchListItem;
  uploader: string;
  lang: Lang;
}

function HistoryRow({ ledgerId, batch, uploader, lang }: HistoryRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const wide = useIsWide();
  const remove = useDeleteImport(ledgerId, batch.id);
  const id = `import-batch-${batch.id}`;
  const pasted = batch.source === 'paste';

  const onDiscard = React.useCallback((): void => {
    void (async () => {
      const ok = await confirm({
        title: t('import:history.discard_confirm_title'),
        body: t('import:history.discard_confirm_body', { count: batch.row_count }),
        confirmLabel: t('import:history.discard'),
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await remove.mutateAsync(undefined);
      } catch {
        return; // the global error toast already explained the failure (04 §3.9)
      }
      toast.success(t('import:history.discarded_toast'));
    })();
  }, [batch.row_count, remove, t]);

  const onUndo = React.useCallback((): void => {
    void (async () => {
      // Ask first: how much would this delete, and which refunds does it disturb?
      let dry;
      try {
        dry = await remove.mutateAsync({ dry_run: true });
      } catch {
        return;
      }
      const lines = [
        t('import:committed.undo_confirm_body', {
          count: dry.would_delete_transactions ?? 0,
        }),
      ];
      // The two counters are NOT the same thing, so they never share a sentence, and a
      // zero counter contributes no line at all (decision §14.52 B24).
      if (dry.orphaned_refunds > 0) {
        lines.push(t('import:committed.undo_orphaned_refunds', { count: dry.orphaned_refunds }));
      }
      if (dry.refunds_in_batch > 0) {
        lines.push(t('import:committed.undo_refunds_in_batch', { count: dry.refunds_in_batch }));
      }
      const ok = await confirm({
        title: t('import:committed.undo_confirm_title'),
        body: lines.join('\n\n'),
        confirmLabel: t('import:history.undo'),
        tone: 'danger',
        doubleTap: true,
      });
      if (!ok) return;
      let done;
      try {
        done = await remove.mutateAsync(undefined);
      } catch {
        return;
      }
      toast.success(
        t('import:committed.undo_success_toast', { count: done.deleted_transactions ?? 0 }),
      );
    })();
  }, [remove, t]);

  return (
    <Card variant="outlined" style={{ gap: space['3'] }} testID={id}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: space['2'],
        }}
      >
        <Text variant="heading" style={{ flexShrink: 1 }} testID={`${id}-filename`}>
          {pasted ? t('import:history.pasted_filename') : (batch.filename ?? '')}
        </Text>
        {pasted ? (
          <Badge label={t('import:history.pasted_badge')} tone="info" testID={`${id}-paste-badge`} />
        ) : (
          <Text variant="caption" tone="muted" mono testID={`${id}-size`}>
            {formatBytes(batch.size_bytes)}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        <Badge
          label={t(`import:history.status.${batch.status}`)}
          tone={batch.status === 'committed' ? 'success' : 'warning'}
          testID={`${id}-status`}
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: wide ? space['5'] : space['3'],
        }}
      >
        <Field
          label={t('import:history.column.source')}
          value={batch.source_name}
          testID={`${id}-source`}
        />
        <Field
          label={t('import:history.column.created_at')}
          value={formatDateTime(batch.created_at, lang)}
          testID={`${id}-created-at`}
        />
        <Field
          label={t('import:history.column.created_by')}
          value={uploader}
          testID={`${id}-uploader`}
        />
        <Field
          label={t('import:history.column.row_count')}
          value={String(batch.row_count)}
          testID={`${id}-rows`}
        />
        <Field
          label={t('import:history.column.net_amount')}
          value={formatMoney(batch.net_amount, batch.base_currency, lang)}
          testID={`${id}-net`}
        />
        <Field
          label={t('import:history.column.flags')}
          value={t('import:history.flags_value', { n: totalFlags(batch) })}
          testID={`${id}-flags`}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
        {batch.status === 'ready' ? (
          <>
            <Button
              testID={`${id}-continue`}
              label={t('import:history.continue_review')}
              size="sm"
              onPress={() => router.push(routes.l(ledgerId).importBatch(batch.id) as Href)}
            />
            <Button
              testID={`${id}-discard`}
              label={t('import:history.discard')}
              variant="danger"
              size="sm"
              loading={remove.isPending}
              onPress={onDiscard}
            />
          </>
        ) : (
          <>
            <Button
              testID={`${id}-view`}
              label={t('import:history.view_transactions')}
              size="sm"
              onPress={() =>
                router.push(
                  routes.l(ledgerId).transactions({ import_batch_id: batch.id }) as Href,
                )
              }
            />
            <Button
              testID={`${id}-undo`}
              label={t('import:history.undo')}
              icon="undo-2"
              variant="danger"
              size="sm"
              loading={remove.isPending}
              onPress={onUndo}
            />
          </>
        )}
      </View>
    </Card>
  );
}

export default function ImportsHistoryScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  useTopBar(t('import:history.title'));

  const [offset, setOffset] = React.useState(0);
  const query = useImports(ledgerId, { limit: IMPORTS_PAGE_SIZE, offset });
  const memberNames = useMemberNames(ledgerId);

  const goNew = React.useCallback(
    () => router.push(routes.l(ledgerId).importsNew() as Href),
    [ledgerId, router],
  );
  const goGuide = React.useCallback(
    () => router.push(routes.l(ledgerId).importsGuide() as Href),
    [ledgerId, router],
  );

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] }}>
      <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
        {t('import:history.title')}
      </Text>
      <Button
        testID="imports-new"
        label={t('import:history.new_import')}
        icon="upload"
        size="sm"
        onPress={goNew}
      />
      <Button
        testID="imports-guide"
        label={t('import:history.guide_link')}
        variant="secondary"
        size="sm"
        onPress={goGuide}
      />
    </View>
  );

  if (query.isPending) {
    return (
      <Page testID="imports-history-screen">
        {header}
        <Skeleton variant="card" testID="imports-skeleton" />
        <Skeleton variant="card" />
      </Page>
    );
  }

  if (query.isError) {
    return (
      <Page testID="imports-history-screen">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('import:history.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="imports-error"
        />
      </Page>
    );
  }

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  if (items.length === 0 && offset === 0) {
    return (
      <Page testID="imports-history-screen">
        {header}
        <EmptyState
          icon="upload"
          title={t('import:history.empty.title')}
          body={t('import:history.empty.body')}
          primaryAction={{ label: t('import:history.empty.action'), onPress: goGuide }}
          testID="imports-empty"
        />
      </Page>
    );
  }

  const pages = Math.max(1, Math.ceil(total / IMPORTS_PAGE_SIZE));
  const page = Math.floor(offset / IMPORTS_PAGE_SIZE) + 1;

  return (
    <Page testID="imports-history-screen">
      {header}
      {items.map((batch) => (
        <HistoryRow
          key={batch.id}
          ledgerId={ledgerId}
          batch={batch}
          uploader={memberNames[batch.created_by] ?? ''}
          lang={lang}
        />
      ))}
      {pages > 1 ? (
        <View
          testID="imports-pagination"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space['3'],
          }}
        >
          <Button
            testID="imports-pagination-prev"
            label={t('import:history.pagination.prev')}
            icon="chevron-left"
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onPress={() => setOffset(Math.max(0, offset - IMPORTS_PAGE_SIZE))}
          />
          <Text variant="caption" tone="secondary" mono testID="imports-pagination-page">
            {t('import:history.pagination.page', { page, pages })}
          </Text>
          <Button
            testID="imports-pagination-next"
            label={t('import:history.pagination.next')}
            icon="chevron-right"
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onPress={() => setOffset(offset + IMPORTS_PAGE_SIZE)}
          />
        </View>
      ) : null}
    </Page>
  );
}
