/**
 * `/l/:ledgerId/imports` — the batch history of 屏幕稿 11 (04 §4.10, decisions §14.22,
 * §14.52 A17/B24, §14.56).
 *
 * The header carries the history's numbers inline (「4 批 · 1 批待提交」) and, on
 * its right, the way in plus the small 全部 / 待提交 / 已提交 segmented control. Both numbers
 * are server totals — the batch count for the filter in force and a one-row
 * `status=ready` probe — so the sentence never mixes 「all 45」 with 「the 20 in hand」.
 * 屏幕稿 11's third number, 「已入账 52 笔」, has no endpoint of its own — 03 §5 totals
 * batches, never their rows — so it is added up from the committed batches themselves, and
 * only while every one of them is in hand (`committedRowTotal`): a sum off one page of a
 * longer history would be a smaller number stated as a total. The filter
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

import type { ImportBatchListItem, Paged } from '@/api/types';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useImports, useMemberNames } from '@/queries';
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
} from '@/ui';

import { HistoryEntry, totalFlags } from './HistoryEntry';
import {
  HISTORY_COLUMNS,
  HISTORY_MIN_WIDTH,
  historyCellStyle,
  historyGridRow,
} from './HistoryRows';
import { ImportsEmpty } from './ImportsEmpty';
import { UndoDialogHost } from './UndoDialog';

export { totalFlags };

/** 04 §4.10: the history pages 20 batches at a time. */
export const IMPORTS_PAGE_SIZE = 20;

/**
 * How many committed batches the 「已入账 N 笔」 probe will add up. 200 is the server's page
 * cap (`pagination`, 03 §5.38), so a ledger with more committed batches than this simply
 * does not get the number — see `committedRowTotal`.
 */
const COMMITTED_PROBE_LIMIT = 200;

/**
 * The rows 屏幕稿 11 calls 「已入账」: every row of every committed batch that was not
 * skipped. `undefined` — draw nothing — until the probe has answered, and also when it came
 * back short, because then the sum is a page's worth and not the history's.
 */
export function committedRowTotal(page: Paged<ImportBatchListItem> | undefined): number | undefined {
  if (page === undefined || page.total > page.items.length) return undefined;
  return page.items.reduce(
    (n, b) => n + Math.max(0, b.row_count - b.row_status_summary.skipped),
    0,
  );
}

/** The three segments of 屏幕稿 11; `all` is the absence of a `?status=`. */
export const HISTORY_FILTERS = ['all', 'ready', 'committed'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

/** `?status=` → a segment; anything else is 「全部」. */
export function resolveFilter(raw: string | string[] | undefined): HistoryFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HISTORY_FILTERS.includes(value as HistoryFilter) ? (value as HistoryFilter) : 'all';
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
  // 屏幕稿 11's 「1 批待提交」 is about the whole ledger, not the page in hand, so it is a
  // server total of its own: one row is fetched purely for the `total` that comes with it.
  // Only the 全部 header draws that half, so the probe is only armed there — `useImports`
  // gates on the ledger id, so withholding it is how the request is withheld.
  const readyQuery = useImports(filter === 'all' ? ledgerId : undefined, {
    limit: 1,
    status: ['ready'],
  });
  // 「已入账 N 笔」 counts rows, which only the batches themselves carry, so this probe asks
  // for the committed batches rather than for a total. Same gate as the one above: the
  // sentence is ledger-wide, so it is only true next to a ledger-wide batch count.
  const committedQuery = useImports(filter === 'all' ? ledgerId : undefined, {
    limit: COMMITTED_PROBE_LIMIT,
    status: ['committed'],
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

  const items: readonly ImportBatchListItem[] = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const readyTotal = readyQuery.data?.total;
  const postedTotal = committedRowTotal(committedQuery.data);

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
  // 「N 批待提交」 is a ledger-wide total, so it is only true next to a ledger-wide batch
  // count: under a filter the sentence would otherwise count a pending batch inside a list
  // it is not in (「1 批 · 1 批待提交」 on 已提交). 屏幕稿 11 draws the 全部 frame, which keeps
  // both halves.
  // The probe answers a moment after the list does, and 「0 批待提交」 is a claim, not a
  // placeholder — so until it has answered the sentence is simply the batch count.
  // Each half is drawn only once its own server answer is in, so the sentence grows from
  // 「4 批」 to 「4 批 · 1 批待提交 · 已入账 52 笔」 instead of claiming a zero it has not read.
  const meta =
    items.length === 0
      ? undefined
      : [
          t('import:history.stat_batches', { batches: total }),
          filter === 'all' && readyTotal !== undefined
            ? t('import:history.stat_ready', { ready: readyTotal })
            : null,
          filter === 'all' && postedTotal !== undefined
            ? t('import:history.stat_posted', { posted: postedTotal })
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');
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
