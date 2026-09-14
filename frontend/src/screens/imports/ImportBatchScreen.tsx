/**
 * `/l/:ledgerId/imports/:batchId` — steps 2 and 3 of the import flow (04 §4.10, §4.11).
 *
 * One batch, two states (decision §5): `ready` paints the review table (the widest screen in
 * the product — the content area drops the 1200px reading cap, 04 §1.4), `committed` paints
 * the result panel with its three actions.
 *
 * Undoing a committed batch asks twice: a `?dry_run=true` DELETE first, whose two refund
 * counters are worded *separately* in the confirmation because they say different things
 * (decision §14.52 B24), then the real DELETE. Afterwards the batch is gone from the history
 * altogether (decision §14.22), so the screen leaves for the history list rather than
 * staying on a URL that now 404s.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ImportBatch, ImportCommitResult, ImportFlag, ImportRow, Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import {
  useCategories,
  useCurrencies,
  useDeleteImport,
  useImportBatch,
  useImportRows,
  useSources,
} from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  Card,
  EmptyState,
  Page,
  SegmentedControl,
  Skeleton,
  Text,
  confirm,
  toast,
} from '@/ui';

import { BulkBar } from './review/BulkBar';
import { CommitBar } from './review/CommitBar';
import { ReviewCards } from './review/ReviewCards';
import { ReviewTable } from './review/ReviewTable';
import type { ReviewEnv } from './review/ReviewRow';
import { useReviewRows } from './review/useReviewRows';
import { REVIEW_SLICES, type ReviewSlice, useReviewSelection } from './review/useReviewSelection';

/** Room under the phone's scroll content for the pinned bulk bar (04 §4.11.9). */
const BULK_BAR_CLEARANCE = 96;

/**
 * Paging the draft rows (03 §5.40, §5.37).
 *
 * `GET .../rows` answers 100 rows by default and 500 at most, while one batch holds up to
 * 2000 (`IMPORT_MAX_ROWS`) — so the unparameterised first page is not the batch. The first
 * query stays parameterless on purpose: that is the exact cache key a successful upload
 * seeds with every row it parsed (04 §8.5, case 2), and giving it params would cost the
 * review screen a request it must not need. The rest of the batch is fetched by a fixed
 * number of follow-up pages (hook counts cannot vary between renders), each switched off by
 * passing no batch id until the first page says there is more to read.
 */
const ROWS_PAGE_LIMIT = 500;
const REST_OFFSETS = [100, 600, 1100, 1600] as const;

interface CommittedPanelProps {
  ledgerId: Uuid;
  batch: ImportBatch;
  result: ImportCommitResult | null;
}

/**
 * Step 3 (04 §4.10). The detailed sentence needs the commit response's five counters; a
 * page opened later (a link, a refresh) only has the batch, so it says the shorter thing
 * rather than inventing numbers.
 */
function CommittedPanel({ ledgerId, batch, result }: CommittedPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const remove = useDeleteImport(ledgerId, batch.id);

  const onUndo = React.useCallback((): void => {
    void (async () => {
      let dry;
      try {
        dry = await remove.mutateAsync({ dry_run: true });
      } catch {
        return; // the global error toast already explained it (04 §3.9)
      }
      const lines = [
        t('import:committed.undo_confirm_body', {
          count: dry.would_delete_transactions ?? 0,
        }),
      ];
      // Two different facts, never one sentence; a zero counter contributes no line at all.
      if (dry.orphaned_refunds > 0) {
        lines.push(
          t('import:committed.undo_orphaned_refunds', {
            count: dry.orphaned_refunds,
          }),
        );
      }
      if (dry.refunds_in_batch > 0) {
        lines.push(
          t('import:committed.undo_refunds_in_batch', {
            count: dry.refunds_in_batch,
          }),
        );
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
        t('import:committed.undo_success_toast', {
          count: done.deleted_transactions ?? 0,
        }),
      );
      router.replace(routes.l(ledgerId).imports() as Href);
    })();
  }, [ledgerId, remove, router, t]);

  return (
    <Card variant="outlined" style={{ gap: space['3'] }} testID="import-committed">
      <Text variant="body" testID="import-committed-summary">
        {result
          ? t('import:committed.summary', {
              created: result.created_transactions,
              pairs: result.created_transfer_pairs,
              paired: result.paired_existing_transfers,
              refunds: result.linked_refunds,
              skipped: result.skipped_rows,
            })
          : t('import:committed.summary_fallback', { rows: batch.row_count })}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
        <Button
          testID="import-committed-view"
          label={t('import:committed.view_transactions')}
          onPress={() =>
            router.push(routes.l(ledgerId).transactions({ import_batch_id: batch.id }) as Href)
          }
        />
        <Button
          testID="import-committed-again"
          variant="secondary"
          label={t('import:committed.import_another')}
          onPress={() => router.push(routes.l(ledgerId).importsNew() as Href)}
        />
        <Button
          testID="import-committed-undo"
          variant="danger"
          icon="undo-2"
          label={t('import:committed.undo')}
          loading={remove.isPending}
          onPress={onUndo}
        />
      </View>
    </Card>
  );
}

export default function ImportBatchScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();
  const { ledgerId } = useLedgerContext();
  const params = useLocalSearchParams<{ batchId?: string }>();
  const bid =
    typeof params.batchId === 'string' && params.batchId !== '' ? params.batchId : undefined;

  const batchQuery = useImportBatch(ledgerId, bid);
  const rowsQuery = useImportRows(ledgerId, bid);
  const categories = useCategories();
  const currencies = useCurrencies();
  const sources = useSources(ledgerId);

  // The first page decides whether there is anything else to fetch: an upload seeds the
  // whole batch under this key, in which case `total` equals what is already here.
  const firstPage = rowsQuery.data;
  const total = firstPage?.total ?? 0;
  const firstCount = firstPage?.items.length ?? 0;
  const restId = (offset: number): Uuid | undefined =>
    firstCount > 0 && total > firstCount && total > offset ? bid : undefined;
  const page2 = useImportRows(ledgerId, restId(REST_OFFSETS[0]), {
    limit: ROWS_PAGE_LIMIT,
    offset: REST_OFFSETS[0],
  });
  const page3 = useImportRows(ledgerId, restId(REST_OFFSETS[1]), {
    limit: ROWS_PAGE_LIMIT,
    offset: REST_OFFSETS[1],
  });
  const page4 = useImportRows(ledgerId, restId(REST_OFFSETS[2]), {
    limit: ROWS_PAGE_LIMIT,
    offset: REST_OFFSETS[2],
  });
  const page5 = useImportRows(ledgerId, restId(REST_OFFSETS[3]), {
    limit: ROWS_PAGE_LIMIT,
    offset: REST_OFFSETS[3],
  });

  // Pages overlap only if the batch changed size under us, so `id` settles the duplicates.
  const serverRows = React.useMemo(() => {
    const byId = new Map<Uuid, ImportRow>();
    for (const page of [firstPage, page2.data, page3.data, page4.data, page5.data]) {
      for (const item of page?.items ?? []) byId.set(item.id, item);
    }
    return [...byId.values()];
  }, [firstPage, page2.data, page3.data, page4.data, page5.data]);

  const batch = batchQuery.data;
  const ctrl = useReviewRows(ledgerId, bid ?? '', serverRows);
  // 04 §4.11.9: the phone opens on the "uncategorized" slice unconditionally.
  const selection = useReviewSelection(ctrl.rows, { preferUncategorized: !wide });
  /** Rows the batch has but this screen has not read yet — a commit blocker (§4.11.8). */
  const unloadedRows = Math.max(0, total - serverRows.length);

  const [committed, setCommitted] = React.useState<ImportCommitResult | null>(null);
  const [highlight, setHighlight] = React.useState<number | null>(null);
  const [submitSignal, setSubmitSignal] = React.useState(0);

  useTopBar(batch ? batch.source_name : t('import:history.title'));

  if (batchQuery.isPending || rowsQuery.isPending) {
    return (
      <Page wide testID="import-batch-screen">
        <Skeleton variant="table" rows={6} testID="import-batch-skeleton" />
      </Page>
    );
  }

  if (batchQuery.isError || !batch) {
    return (
      <Page wide testID="import-batch-screen">
        <EmptyState
          icon="alert-triangle"
          title={t('import:review.error_retry')}
          primaryAction={{
            label: t('common:button.retry'),
            onPress: () => void batchQuery.refetch(),
          }}
          testID="import-batch-error"
        />
      </Page>
    );
  }

  const filename =
    batch.source === 'paste' ? t('import:history.pasted_filename') : (batch.filename ?? '');

  // 04 §4.11.1: the header names the file, the target account, the row count, how many
  // rows still need a category, and each flag the server raised at all.
  const flagCounts = (Object.keys(batch.flags_summary) as ImportFlag[])
    .filter((flag) => (batch.flags_summary[flag] ?? 0) > 0)
    .map((flag) =>
      t('import:review.summary_flag', {
        label: t(`import:review.flag.${flag}`),
        count: batch.flags_summary[flag],
      }),
    );

  const header = (
    <View style={{ gap: space['1'] }}>
      <Text variant="title" accessibilityRole="header" testID="import-batch-title">
        {t('import:review.title', { filename, source: batch.source_name })}
      </Text>
      <Text variant="caption" tone="secondary" testID="import-batch-summary">
        {[
          t('import:review.summary', {
            // The batch's own count, not the page at hand (03 §5.40).
            rows: batch.row_count,
            uncategorized: selection.counts.uncategorized,
          }),
          ...flagCounts,
        ].join(' · ')}
      </Text>
    </View>
  );

  if (batch.status === 'committed' || committed !== null) {
    return (
      <Page wide testID="import-batch-screen">
        {header}
        <CommittedPanel ledgerId={ledgerId} batch={batch} result={committed} />
      </Page>
    );
  }

  const env: ReviewEnv = {
    ledgerId,
    batch,
    ctrl,
    index: categories.index,
    lang,
    currencyCodes: currencies.codes,
    currencyNames: currencies.names,
    sources: sources.data?.items ?? [],
  };

  const view = wide ? (
    <ReviewTable
      env={env}
      selection={selection}
      highlightRowNo={highlight}
      onCommitRequest={() => setSubmitSignal((n) => n + 1)}
    />
  ) : (
    <ReviewCards
      env={env}
      selection={selection}
      highlightRowNo={highlight}
      onCommitRequest={() => setSubmitSignal((n) => n + 1)}
    />
  );

  const bulkBar = (
    <BulkBar env={env} selection={selection} onFailure={setHighlight} compact={!wide} />
  );

  return (
    <View style={{ flex: 1 }}>
      <Page wide testID="import-batch-screen" bottomInset={wide ? 0 : BULK_BAR_CLEARANCE}>
        {header}
        <SegmentedControl<ReviewSlice>
          testID="review-slices"
          value={selection.slice}
          onChange={selection.setSlice}
          accessibilityLabel={t('import:review.column.flags')}
          options={REVIEW_SLICES.map((slice) => ({
            value: slice,
            label: t(`import:review.filter.${slice}`, {
              count: selection.counts[slice],
            }),
          }))}
        />
        {/* Why the phone opened where it did (04 §4.11.9). */}
        {!wide && selection.slice === 'uncategorized' ? (
          <Text variant="micro" tone="muted" testID="review-mobile-filter-hint">
            {t('import:review.mobile_default_filter_hint')}
          </Text>
        ) : null}
        {wide ? bulkBar : null}
        {view}
        <CommitBar
          env={env}
          rows={ctrl.rows}
          onJumpTo={setHighlight}
          onCommitted={(result) => {
            setCommitted(result);
            selection.clear();
          }}
          submitSignal={submitSignal}
          unloadedRows={unloadedRows}
        />
      </Page>
      {/* The phone keeps bulk actions on a bar pinned to the bottom (04 §4.11.9). */}
      {!wide && selection.count > 0 ? (
        <View
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
          testID="review-bulk-dock"
        >
          {bulkBar}
        </View>
      ) : null}
    </View>
  );
}
