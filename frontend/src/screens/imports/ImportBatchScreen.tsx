/**
 * `/imports/:batchId` — steps 2 and 3 of the import flow (04 §4.10, §4.11).
 *
 * One batch, two states (decision §5): `ready` paints the review table (the widest screen in
 * the product — the content area drops the 1200px reading cap, 04 §1.4), `committed` paints
 * the result panel with its three actions.
 *
 * Undoing a committed batch is `undoBatch.ts` — the flow the history list runs, to the
 * letter. Afterwards the batch is gone from the history altogether (decision §14.22), so
 * this screen leaves for the history list rather than staying on a URL that now 404s.
 *
 * The slice on screen and the row pointed at are the batch's browsing state
 * (`review/useBatchView.ts`, decision §14.66 e) — never query parameters.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type {
  ImportBatch,
  ImportCommitResult,
  ImportRow,
  Uuid,
} from '@/api/types';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { useCurrencyNames } from '@/i18n/currencyNames';
import { useBack, useTopBar } from '@/navigation';
import {
  useCategories,
  useCurrencies,
  useDeleteImport,
  useImportBatch,
  useImportRows,
  useLedgerSources,
} from '@/queries';
import { useOpenTransactions } from '@/screens/transactions/useTxFilters';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Card,
  EmptyState,
  Page,
  PageHeader,
  type PageHeaderBack,
  SegmentedControl,
  Skeleton,
  Text,
} from '@/ui';

import { BulkBar } from './review/BulkBar';
import { CommitBar } from './review/CommitBar';
import { ReviewCards } from './review/ReviewCards';
import { ReviewBanner } from './review/ReviewBanner';
import { ReviewHeader, reviewSubtitle } from './review/ReviewHeader';
import { ReviewTable } from './review/ReviewTable';
import type { ReviewEnv } from './review/ReviewRow';
import { useReviewRows } from './review/useReviewRows';
import { useBatchView } from './review/useBatchView';
import { REVIEW_SLICES, type ReviewSlice } from './review/useReviewSelection';
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
  const openTransactions = useOpenTransactions();
  const remove = useDeleteImport(ledgerId, batch.id);

  const onUndo = React.useCallback((): void => {
    void undoImportBatch({
      remove: remove.mutateAsync,
      batch,
      t,
      lang,
      onDone: () => router.replace(routes.imports() as Href),
    });
  }, [batch, lang, remove, router, t]);

  return (
    <>
      <CommittedPanel
        batch={batch}
        result={result}
        undoing={remove.isPending}
        onUndo={onUndo}
        // The list opens on this batch's entries: its filter is view state (§14.66 e).
        onViewTransactions={() => openTransactions({ import_batch_id: batch.id })}
        onImportAnother={() => router.push(routes.importsNew() as Href)}
      />
      {/* 屏幕稿 11 · 撤销确认 lives with the screen that can undo (see `UndoDialog.tsx`). */}
      <UndoDialogHost />
    </>
  );
}

export default function ImportBatchScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ batchId?: string }>();
  const bid =
    typeof params.batchId === 'string' && params.batchId !== '' ? params.batchId : undefined;
  // One batch per mount: its slice, selection and highlight never carry over to another.
  return <BatchScreen key={bid ?? ''} bid={bid} />;
}

function BatchScreen({ bid }: { bid: Uuid | undefined }): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();
  const { ledgerId } = useLedgerContext();

  // The wide back of the committed panel and of the loading / error states (§14.64 e); the
  // review header asks for its own.
  const back = useBack();
  const backTo = (title: string): PageHeaderBack | undefined =>
    back.show
      ? {
          crumb: `${back.parentLabel} · ${title}`,
          onPress: back.goBack,
          label: t('common:button.back'),
        }
      : undefined;
  const batchQuery = useImportBatch(ledgerId, bid);
  const rowsQuery = useImportRows(ledgerId, bid);
  const categories = useCategories();
  const currencies = useCurrencies();
  // 屏幕稿 03's 币种 picker reads 「CNY 人民币」, not the server's ISO English name.
  const currencyNames = useCurrencyNames(currencies.names);
  // Archived and no-longer-shared accounts included: the review names the accounts the
  // matched entries sit on, and the counterpart picker filters to the usable ones itself.
  const sources = useLedgerSources(ledgerId, { include_archived: true });

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
  // 04 §4.11.9: the phone opens on the "uncategorized" slice unconditionally — unless the
  // user already picked one for this batch (its view state, §4.11.6).
  const { selection, highlight, jumpTo } = useBatchView(bid ?? '', ctrl.rows, {
    preferUncategorized: !wide,
  });
  /** Rows the batch has but this screen has not read yet — a commit blocker (§4.11.8). */
  const unloadedRows = Math.max(0, total - serverRows.length);

  const [committed, setCommitted] = React.useState<ImportCommitResult | null>(null);
  const [submitSignal, setSubmitSignal] = React.useState(0);
  // The blocking banner's 「定位第一行」: only the layout on screen knows how to get there
  // (the grid widens the slice and moves the focus, the card flow switches slice), so the
  // banner — which 屏幕稿 03 draws above them both — asks by signal.
  const [bannerJump, setBannerJump] = React.useState(0);


  // The phone's top bar carries the page title 屏幕稿 03 · 375 draws (the wide layout has
  // no top bar at all — decision §14.56 — and reads it off the page header instead).
  useTopBar(
    batch === undefined
      ? t('import:history.title')
      : batch.status === 'committed'
        ? batch.source_name
        : t('import:review.page_title'),
  );

  // Still loading, or unreadable (a link to a batch undone since): the way back is there
  // before the batch is. Narrow, the shell's ‹ bar already is; this draws nothing there.
  const pendingTitle = t('import:review.page_title');
  const pendingHeader = (
    <PageHeader testID="import-batch-header" title={pendingTitle} back={backTo(pendingTitle)} />
  );

  if (batchQuery.isPending || rowsQuery.isPending) {
    return (
      <Page testID="import-batch-screen">
        {pendingHeader}
        <Skeleton variant="table" rows={6} testID="import-batch-skeleton" />
      </Page>
    );
  }

  if (batchQuery.isError || !batch) {
    return (
      <Page testID="import-batch-screen">
        {pendingHeader}
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
          back={backTo(batch.source_name)}
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
    currencyNames,
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
