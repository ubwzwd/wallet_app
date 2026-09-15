/**
 * `/l/:ledgerId/imports/:batchId` — steps 2 and 3 of the import flow (04 §4.10, §4.11).
 *
 * One batch, two states (decision §5): `ready` paints the review table (the widest screen in
 * the product — the content area drops the 1200px reading cap, 04 §1.4), `committed` paints
 * the result panel with its three actions.
 *
 * Undoing a committed batch is `undoBatch.ts` — the flow the history list runs, to the
 * letter. Afterwards the batch is gone from the history altogether (decision §14.22), so
 * this screen leaves for the history list rather than staying on a URL that now 404s.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ImportBatch, ImportCommitResult, ImportRow, Uuid } from '@/api/types';
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
import { Card, EmptyState, Page, PageHeader, SegmentedControl, Skeleton, Text } from '@/ui';

import { BulkBar } from './review/BulkBar';
import { CommitBar } from './review/CommitBar';
import { ReviewCards } from './review/ReviewCards';
import { ReviewBanner } from './review/ReviewBanner';
import { ReviewHeader, reviewSubtitle } from './review/ReviewHeader';
import { ReviewTable, type ReviewHighlight } from './review/ReviewTable';
import type { ReviewEnv } from './review/ReviewRow';
import { useReviewRows } from './review/useReviewRows';
import { REVIEW_SLICES, type ReviewSlice, useReviewSelection } from './review/useReviewSelection';
import { CommittedPanel } from './CommittedPanel';
import { UndoDialogHost } from './UndoDialog';
import { undoImportBatch } from './undoBatch';

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

/**
 * The committed panel is its own module (屏幕稿 11's language); this screen only wires it to
 * the batch, to `undoBatch.ts` — the very flow the history list runs — and to where the
 * user lands afterwards: this URL 404s once the batch is gone (decision §14.22), so it
 * goes back to the history.
 */
function CommittedView({
  ledgerId,
  batch,
  result,
}: {
  ledgerId: Uuid;
  batch: ImportBatch;
  result: ImportCommitResult | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const lang = useLang();
  const remove = useDeleteImport(ledgerId, batch.id);

  const onUndo = React.useCallback((): void => {
    void undoImportBatch({
      remove: remove.mutateAsync,
      batch,
      t,
      lang,
      onDone: () => router.replace(routes.l(ledgerId).imports() as Href),
    });
  }, [batch, lang, ledgerId, remove, router, t]);

  return (
    <>
      <CommittedPanel
        batch={batch}
        result={result}
        undoing={remove.isPending}
        onUndo={onUndo}
        onViewTransactions={() =>
          router.push(routes.l(ledgerId).transactions({ import_batch_id: batch.id }) as Href)
        }
        onImportAnother={() => router.push(routes.l(ledgerId).importsNew() as Href)}
      />
      {/* 屏幕稿 11 · 撤销确认 lives with the screen that can undo (see `UndoDialog.tsx`). */}
      <UndoDialogHost />
    </>
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
  const [highlight, setHighlight] = React.useState<ReviewHighlight | null>(null);
  const [submitSignal, setSubmitSignal] = React.useState(0);
  // The blocking banner's 「定位第一行」: only the layout on screen knows how to get there
  // (the grid widens the slice and moves the focus, the card flow switches slice), so the
  // banner — which 屏幕稿 03 draws above them both — asks by signal.
  const [bannerJump, setBannerJump] = React.useState(0);

  /**
   * "Put this row in front of the user" (04 §4.11.8), from the commit bar, a bulk failure
   * or a "jump to the first one" link.
   *
   * The row the server (or a blocker) points at is very often *not* in the slice on screen
   * — a refused pairing is neither uncategorized nor flagged — so the jump widens the view
   * to "all" first, and the highlight carries a sequence number: pressing the same link
   * twice has to scroll twice, which a bare row number could not express.
   */
  const jumpTo = React.useCallback(
    (rowNo: number | null): void => {
      // A failure nobody could pin on a row must *clear* the previous highlight rather than
      // leave an innocent earlier row painted as the culprit — no widening, no new seq.
      if (rowNo === null) {
        setHighlight(null);
        return;
      }
      selection.setSlice('all');
      setHighlight((prev) => ({ rowNo, seq: (prev?.seq ?? 0) + 1 }));
    },
    [selection],
  );

  // The phone's top bar carries the page title 屏幕稿 03 · 375 draws (the wide layout has
  // no top bar at all — decision §14.56 — and reads it off the page header instead).
  useTopBar(
    batch === undefined
      ? t('import:history.title')
      : batch.status === 'committed'
        ? batch.source_name
        : t('import:review.page_title'),
  );

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

  const header = (
    <ReviewHeader
      ledgerId={ledgerId}
      batch={batch}
      lang={lang}
      uncategorized={selection.counts.uncategorized}
      skipped={selection.counts.skipped}
    />
  );

  if (batch.status === 'committed' || committed !== null) {
    return (
      <Page testID="import-batch-screen">
        <PageHeader
          testID="import-batch-header"
          title={batch.source_name}
          subtitle={reviewSubtitle(batch, t)}
        />
        <CommittedView ledgerId={ledgerId} batch={batch} result={committed} />
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

  /**
   * 屏幕稿 03's one bottom bar, not two: 「已选 5 / 10 行」 and the bulk actions at the left
   * end, the blocker and 「提交入账」 at the right, all inside the same white card as the
   * grid (the mockup rounds the grid's top corners and the bar's bottom ones). The phone
   * stacks the same pieces in the same order.
   */
  const footer = (
    <CommitBar
      env={env}
      rows={ctrl.rows}
      onJumpTo={jumpTo}
      onCommitted={(result) => {
        setCommitted(result);
        selection.clear();
      }}
      submitSignal={submitSignal}
      unloadedRows={unloadedRows}
      bare
      leading={
        <BulkBar env={env} selection={selection} onFailure={jumpTo} compact={!wide} bare />
      }
    />
  );

  const view = wide ? (
    <ReviewTable
      env={env}
      selection={selection}
      highlight={highlight}
      onCommitRequest={() => setSubmitSignal((n) => n + 1)}
      bannerJumpSignal={bannerJump}
      footer={footer}
    />
  ) : (
    <ReviewCards
      env={env}
      selection={selection}
      highlight={highlight}
      onCommitRequest={() => setSubmitSignal((n) => n + 1)}
      bannerJumpSignal={bannerJump}
    />
  );

  const slices = (
    <SegmentedControl<ReviewSlice>
      testID="review-slices"
      size="sm"
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
  );

  return (
    <Page testID="import-batch-screen">
      {header}

      {/* 屏幕稿 03: the standing blocker sits directly under the header, with the small
          slice segments beside it — on a phone, on the line below (屏幕稿 03 · 375). */}
      <View
        style={
          wide
            ? { flexDirection: 'row', alignItems: 'center', gap: space['3'] }
            : { gap: space['3'], alignItems: 'flex-start' }
        }
      >
        <ReviewBanner
          count={selection.counts.uncategorized}
          onJump={() => setBannerJump((n) => n + 1)}
          style={wide ? { flex: 1, minWidth: 0 } : { alignSelf: 'stretch' }}
        />
        {slices}
      </View>

      {/* Why the phone opened where it did (04 §4.11.9). */}
      {!wide && selection.slice === 'uncategorized' ? (
        <Text variant="micro" tone="muted" testID="review-mobile-filter-hint">
          {t('import:review.mobile_default_filter_hint')}
        </Text>
      ) : null}

      {view}

      {/* The grid carries the bar inside its own card; the card flow cannot, so the phone
          gets it as the card under the list. */}
      {wide ? null : (
        <Card variant="raised" testID="review-footer" style={{ gap: space['2'] }}>
          {footer}
        </Card>
      )}
    </Page>
  );
}
