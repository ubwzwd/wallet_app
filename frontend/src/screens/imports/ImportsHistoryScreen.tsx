/**
 * `/l/:ledgerId/imports` — the batch history of 屏幕稿 11 (04 §4.10, decisions §14.22,
 * §14.52 A17/B24, §14.56).
 *
 * The header carries the page's numbers inline (「4 批 · 1 批待提交 · 已入账 52 笔」) and, on
 * its right, the way in plus the small 全部 / 待提交 / 已提交 segmented control. That choice
 * lives in the URL (`?status=`), so a filtered history is shareable and the back button is
 * right, and it is sent to the *server* as `status=`: the pager pages 20 batches at a time,
 * so a filter applied to the page in hand would silently hide matching batches on every
 * other page while the pager still counted the unfiltered list. The rows, the pager and
 * the batch count in the header therefore all describe one list — the filtered history.
 *
 * A batch has exactly two states (decision §5): `ready` (a validated draft waiting to be
 * reviewed) and `committed`. There is no `reverted` — undoing an import deletes the batch,
 * so it simply leaves this list.
 *
 * Both destructive actions go through `useDeleteImport`. Discarding a draft is asked once
 * and right here; undoing a committed batch is the two-step flow of `undoBatch.ts`, shared
 * verbatim with the batch screen's committed panel.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ImportBatchListItem, Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import { useLang, type Lang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useDeleteImport, useImports, useMemberNames } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  EmptyState,
  ListCard,
  Page,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Text,
  confirm,
  toast,
} from '@/ui';

import { HistoryCard } from './HistoryCard';
import {
  HISTORY_COLUMNS,
  HISTORY_MIN_WIDTH,
  HistoryTableRow,
  historyCellStyle,
  historyGridRow,
} from './HistoryRows';
import { ImportsEmpty } from './ImportsEmpty';
import { UndoDialogHost } from './UndoDialog';
import { undoImportBatch, undoMeta } from './undoBatch';

/** 04 §4.10: the history pages 20 batches at a time. */
export const IMPORTS_PAGE_SIZE = 20;

/** The three segments of 屏幕稿 11; `all` is the absence of a `?status=`. */
export const HISTORY_FILTERS = ['all', 'ready', 'committed'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

/** `flags_summary` is a map of the four flags; the row shows their total (04 §4.10). */
export function totalFlags(batch: ImportBatchListItem): number {
  return Object.values(batch.flags_summary).reduce((sum, n) => sum + (n || 0), 0);
}

/** `?status=` → a segment; anything else is 「全部」. */
export function resolveFilter(raw: string | string[] | undefined): HistoryFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HISTORY_FILTERS.includes(value as HistoryFilter) ? (value as HistoryFilter) : 'all';
}

/** 「4 批 · 1 批待提交 · 已入账 52 笔」 — the batch count is the server's `total` for the
 *  filter in force, the same list the pager walks, so the header never reads 「20 批」 next
 *  to 「第 1 / 3 页」. The other two are read off the batches the page is holding: no
 *  endpoint totals them, and guessing them from 20 of 45 would be worse than counting the
 *  page. `total` defaults to the page when the caller has no better number. */
export function historyStats(
  items: readonly ImportBatchListItem[],
  total = items.length,
): {
  batches: number;
  ready: number;
  rows: number;
} {
  let ready = 0;
  let rows = 0;
  for (const batch of items) {
    if (batch.status === 'ready') ready += 1;
    else rows += batch.row_count;
  }
  return { batches: total, ready, rows };
}

interface RowProps {
  ledgerId: Uuid;
  batch: ImportBatchListItem;
  uploader: string;
  lang: Lang;
  wide: boolean;
}

/** One batch, wired to the router and to the two destructive flows. */
function HistoryEntry({ ledgerId, batch, uploader, lang, wide }: RowProps): React.JSX.Element {
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

/** The tinted head strip of the wide table. */
function TableHead(): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={[historyGridRow, styles.head, { backgroundColor: colors['bg.canvas'] }]}>
      {HISTORY_COLUMNS.map((column) => (
        <View key={column.key} style={historyCellStyle(column)}>
          {column.key === 'actions' ? null : (
            <Text variant="micro" tone="secondary" mono weight={600} numberOfLines={1}>
              {t(`import:history.column.${column.key}`)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

export default function ImportsHistoryScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  useTopBar(t('import:history.title'));

  const params = useLocalSearchParams<{ status?: string }>();
  const filter = resolveFilter(params.status);

  // Page 1 of the new filter, not page 3 of the old one — derived rather than chased in an
  // effect, so no request is ever sent with an offset that belonged to the previous filter.
  const [offset, setOffset] = React.useState(0);
  const [offsetFilter, setOffsetFilter] = React.useState<HistoryFilter>(filter);
  if (offsetFilter !== filter) {
    setOffsetFilter(filter);
    setOffset(0);
  }
  const pageOffset = offsetFilter === filter ? offset : 0;
  const query = useImports(ledgerId, {
    limit: IMPORTS_PAGE_SIZE,
    offset: pageOffset,
    status: filter === 'all' ? undefined : [filter],
  });
  const memberNames = useMemberNames(ledgerId);

  const goNew = React.useCallback(
    () => router.push(routes.l(ledgerId).importsNew() as Href),
    [ledgerId, router],
  );
  const goGuide = React.useCallback(
    () => router.push(routes.l(ledgerId).importsGuide() as Href),
    [ledgerId, router],
  );
  const setFilter = React.useCallback(
    (next: HistoryFilter) => router.setParams({ status: next === 'all' ? undefined : next }),
    [router],
  );

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const stats = historyStats(items, total);

  // Page 1 again when the list shrank under the pager (the tail batches were undone or
  // discarded), which would otherwise strand the user on an empty page with no pager to
  // walk back with.
  React.useEffect(() => {
    if (!query.isPending && items.length === 0 && pageOffset > 0) setOffset(0);
  }, [items.length, pageOffset, query.isPending]);

  // An empty history has nothing to count and nothing to filter, so 屏幕稿 15's header is
  // just the title and the way in. A filter that matches nothing is *not* that: the
  // segmented control has to stay on screen, or there is no way back to 全部.
  const bare = filter === 'all' && items.length === 0;
  // 「0 批 · 0 批待提交」 under a filter that matches nothing says nothing, so the counts go
  // whenever the page is empty — but the segmented control only goes when the ledger is.
  const meta = items.length === 0 ? undefined : t('import:history.stats', stats);
  const header = (
    <PageHeader
      title={t('import:history.title')}
      meta={meta}
      testID="imports-header"
      actions={
        <>
          <Button
            testID="imports-new"
            label={t('import:history.new_import')}
            icon="upload"
            size="sm"
            onPress={goNew}
          />
          {bare ? null : (
            <SegmentedControl<HistoryFilter>
              testID="imports-filter"
              size="sm"
              value={filter}
              onChange={setFilter}
              accessibilityLabel={t('import:history.filter_label')}
              options={HISTORY_FILTERS.map((value) => ({
                value,
                label: t(`import:history.filter.${value}`),
              }))}
            />
          )}
        </>
      }
    />
  );

  if (query.isPending) {
    return (
      <Page testID="imports-history-screen">
        {header}
        <Skeleton variant="table" rows={4} testID="imports-skeleton" />
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

  if (bare && pageOffset === 0) {
    return (
      <Page testID="imports-history-screen">
        {header}
        <ImportsEmpty onImport={goNew} onGuide={goGuide} />
      </Page>
    );
  }

  const pages = Math.max(1, Math.ceil(total / IMPORTS_PAGE_SIZE));
  const page = Math.floor(pageOffset / IMPORTS_PAGE_SIZE) + 1;

  const rows = items.map((batch) => (
    <HistoryEntry
      key={batch.id}
      ledgerId={ledgerId}
      batch={batch}
      uploader={memberNames[batch.created_by] ?? ''}
      lang={lang}
      wide={wide}
    />
  ));

  const pager =
    pages > 1 ? (
      <View testID="imports-pagination" style={styles.pagination}>
        <Button
          testID="imports-pagination-prev"
          label={t('import:history.pagination.prev')}
          icon="chevron-left"
          variant="soft"
          size="sm"
          disabled={page <= 1}
          onPress={() => setOffset(Math.max(0, pageOffset - IMPORTS_PAGE_SIZE))}
        />
        <Text variant="caption" tone="secondary" mono testID="imports-pagination-page">
          {t('import:history.pagination.page', { page, pages })}
        </Text>
        <Button
          testID="imports-pagination-next"
          label={t('import:history.pagination.next')}
          icon="chevron-right"
          variant="soft"
          size="sm"
          disabled={page >= pages}
          onPress={() => setOffset(pageOffset + IMPORTS_PAGE_SIZE)}
        />
      </View>
    ) : null;

  // The ledger does have batches — this filter just matches none of them. Saying 「还没导入过
  // 账单」 here would contradict the counts in the header right above.
  const emptySlice =
    items.length === 0 ? (
      <View style={styles.emptySlice} testID="imports-filter-empty">
        <Text variant="body" tone="muted">
          {t('import:history.filter_empty')}
        </Text>
      </View>
    ) : null;

  return (
    <Page testID="imports-history-screen">
      {header}
      {wide ? (
        <ScrollView
          horizontal
          testID="imports-table-hscroll"
          style={styles.flat}
          contentContainerStyle={styles.hscroll}
        >
          <ListCard
            divided
            header={<TableHead />}
            footer={pager ?? undefined}
            testID="imports-table"
            style={styles.table}
          >
            {rows}
            {emptySlice}
          </ListCard>
        </ScrollView>
      ) : (
        <View style={styles.cards}>
          {rows}
          {emptySlice}
          {pager}
        </View>
      )}
      <Text variant="caption" tone="muted" testID="imports-footer-note">
        {t('import:history.footer_note')}
      </Text>
      {/* 屏幕稿 11 · 撤销确认 — its own dialog, not a `ConfirmDialog` (see `UndoDialog.tsx`). */}
      <UndoDialogHost />
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { paddingVertical: space['3'] },
  flat: { flexGrow: 0 },
  hscroll: { minWidth: '100%', flexGrow: 1 },
  table: { minWidth: HISTORY_MIN_WIDTH, flexGrow: 1 },
  cards: { alignSelf: 'stretch', gap: space['3'] - 2 },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space['3'],
    paddingVertical: space['3'],
  },
  emptySlice: { padding: space['6'], alignItems: 'center' },
});
