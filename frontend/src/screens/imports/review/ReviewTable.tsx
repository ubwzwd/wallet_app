/**
 * The wide-screen review grid (04 §4.11.1–§4.11.7, 屏幕稿 03).
 *
 * Twelve columns, in the order §4.11.2 lists them, inside one card: `☑ · # · 日期 · 金额 ·
 * 币种 · 种类 · 商户 · 备注 · 一级分类 · 二级分类 · 账户 · 对手 · 状态与标记`. The account
 * column is not editable — one file is one target account (decision §5, §14.52 A5) — it
 * names the batch's account, and only a transfer row picks a *counterparty* in it. What a
 * row links to (a refund's original expense, a transfer's opposite leg) is the tinted band
 * under the row, next to the server's read-only `hint` (§4.11.2), never folded into `note`.
 *
 * This component owns the two pieces of state the keyboard drives — the focused cell and
 * the cell being edited — plus the category picker that `C` opens and the blocking banner's
 * "jump to the first one". Row data, the selection and the commit bar belong to the screen,
 * so the phone layout can reuse them untouched.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow } from '@/api/types';
import { space } from '@/theme/tokens';
import { DataTable, type DataTableCellPos, KeyboardHint, Text } from '@/ui';

import { LinkPanel, hasLinkPanel } from './LinkPanel';
import { type CategoryOpen, TEXT_COLUMNS, useReviewColumns } from './ReviewColumns';
import type { EditorHandle, ReviewEnv } from './ReviewRow';
import { useReviewKeys } from './useReviewKeys';
import { isUncategorized, type ReviewSelection } from './useReviewSelection';

/**
 * A one-shot "look at this row" signal (04 §4.11.8).
 *
 * `seq` is what makes it one-shot: the same `rowNo` twice is a *new* request, so pressing
 * "jump to the first one" again scrolls again instead of doing nothing.
 */
export interface ReviewHighlight {
  rowNo: number;
  seq: number;
}

export interface ReviewViewProps {
  env: ReviewEnv;
  selection: ReviewSelection;
  /** The row an error (or "jump to the first one") pointed at. */
  highlight: ReviewHighlight | null;
  /** `⌘/Ctrl + Enter` asks the screen's commit bar to submit. */
  onCommitRequest(): void;
  /**
   * Bumped by the page's blocking banner: "put the first uncategorized row in front of
   * me". The banner is drawn by the screen (屏幕稿 03 puts it under the page header,
   * above the slices), but only the view knows how to get there — the grid widens the
   * slice and moves the keyboard focus, the card flow switches to its own slice.
   */
  bannerJumpSignal?: number;
  /** The bar 屏幕稿 03 draws inside the grid's own card (the screen's merged footer). */
  footer?: React.ReactNode;
  testID?: string;
}

export function ReviewTable({
  env,
  selection,
  highlight,
  onCommitRequest,
  bannerJumpSignal = 0,
  footer,
  testID,
}: ReviewViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const id = testID ?? 'review-table';
  const rows = selection.visible;

  const [focus, setFocus] = React.useState<DataTableCellPos | null>(null);
  const [editing, setEditing] = React.useState<DataTableCellPos | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [categoryOpen, setCategoryOpen] = React.useState<CategoryOpen>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  // Set by the banner's link: the slice has been widened, and the first row still missing a
  // category is to be focused as soon as it is in `rows` (04 §4.11.8).
  const [pendingJump, setPendingJump] = React.useState(false);
  const editor = React.useRef<EditorHandle | null>(null);

  const registerEditor = React.useCallback((handle: EditorHandle | null): void => {
    editor.current = handle;
  }, []);

  const onEditDone = React.useCallback((): void => setEditing(null), []);

  const columns = useReviewColumns({
    env,
    rows,
    editing,
    onEditDone,
    revision,
    registerEditor,
    categoryOpen,
    setCategoryOpen,
  });

  const focusedRow = focus === null ? undefined : rows[focus.row];

  const jumpUncategorized = React.useCallback(
    (delta: -1 | 1): void => {
      const from = focus?.row ?? -1;
      const order =
        delta === 1
          ? rows.map((row, i) => ({ row, i })).filter((e) => e.i > from)
          : rows
              .map((row, i) => ({ row, i }))
              .filter((e) => e.i < from)
              .reverse();
      const hit = order.find((e) => isUncategorized(e.row));
      if (hit) setFocus({ row: hit.i, col: focus?.col ?? 0 });
    },
    [focus, rows],
  );

  // The banner's link (the banner itself is the page's, above the slices): widen to the
  // whole batch first — the row it points at is very often not in the slice on screen —
  // then focus the first uncategorized row of the new slice, which is what brings it into
  // the window (`DataTable` keeps the focused row in view).
  const sliceRef = React.useRef(selection.setSlice);
  sliceRef.current = selection.setSlice;
  const firstBannerJump = React.useRef(bannerJumpSignal);
  React.useEffect(() => {
    if (bannerJumpSignal === firstBannerJump.current) return;
    firstBannerJump.current = bannerJumpSignal;
    sliceRef.current('all');
    setPendingJump(true);
  }, [bannerJumpSignal]);

  React.useEffect(() => {
    if (!pendingJump) return;
    const index = rows.findIndex(isUncategorized);
    if (index < 0) return;
    setPendingJump(false);
    setFocus((prev) => ({ row: index, col: prev?.col ?? 0 }));
  }, [pendingJump, rows]);

  useReviewKeys({
    rowCount: rows.length,
    colCount: columns.length,
    focus,
    setFocus,
    clearFocus: () => setFocus(null),
    editing: editing !== null,
    beginEdit: () => {
      if (focus === null) return;
      const column = columns[focus.col];
      if (TEXT_COLUMNS.has(column.key)) setEditing(focus);
      else if (column.key === 'category_l1' && focusedRow) {
        setCategoryOpen({ id: focusedRow.id, level: 'l1' });
      }
    },
    commitEdit: () => {
      editor.current?.commit();
      setEditing(null);
    },
    cancelEdit: () => {
      editor.current?.cancel();
      setEditing(null);
      setRevision((n) => n + 1);
    },
    toggleSelect: () => {
      if (focus !== null && focusedRow) selection.toggle(focusedRow, focus.row);
    },
    extendSelect: (delta) => {
      if (focus === null) return;
      const next = Math.min(Math.max(focus.row + delta, 0), Math.max(rows.length - 1, 0));
      setFocus({ row: next, col: focus.col });
      selection.extendTo(next);
    },
    toggleSkip: () => {
      if (!focusedRow) return;
      env.ctrl.patch(focusedRow, {
        status: focusedRow.status === 'skipped' ? 'pending' : 'skipped',
      });
    },
    openCategory: () => {
      if (focusedRow) setCategoryOpen({ id: focusedRow.id, level: 'l1' });
    },
    jumpUncategorized,
    commitBatch: onCommitRequest,
    help: () => setHelpOpen(true),
  });

  // The caller widens the slice to "all" before it highlights, so the row is normally
  // here; a row that is genuinely gone (an id that no longer exists) simply does not scroll.
  const highlightRowNo = highlight?.rowNo ?? null;
  const highlightIndex =
    highlightRowNo === null ? null : rows.findIndex((row) => row.row_no === highlightRowNo);

  return (
    <View style={{ gap: space['3'] }} testID={`${id}-wrap`}>
      <DataTable<ImportRow>
        testID={id}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        selected={selection.selected}
        onToggleRow={(row, index, opts) =>
          // Shift-click reaches from the last row touched to this one (04 §4.11.2).
          opts.extend ? selection.extendTo(index) : selection.toggle(row, index)
        }
        onToggleAll={(next) => selection.toggleAll(next)}
        selectAllLabel={t('import:review.select_all')}
        rowSelectLabel={(row) => t('import:review.select_row', { row: row.row_no })}
        rowTone={(row) => {
          if (row.row_no === highlightRowNo) return 'highlight';
          return row.status === 'skipped' ? 'muted' : 'default';
        }}
        rowBelow={(row) => {
          const hint =
            row.hint === null ? null : (
              <Text variant="micro" tone="muted" testID={`review-${row.row_no}-hint`}>
                {row.hint}
              </Text>
            );
          if (!hasLinkPanel(row)) return hint;
          return (
            <>
              {hint}
              <LinkPanel row={row} env={env} testID={`review-${row.row_no}-link`} />
            </>
          );
        }}
        focus={focus}
        onFocusCell={(pos) => {
          setFocus(pos);
          setEditing(TEXT_COLUMNS.has(columns[pos.col].key) ? pos : null);
        }}
        scrollToRow={highlightIndex !== null && highlightIndex >= 0 ? highlightIndex : null}
        scrollSignal={highlight?.seq ?? 0}
        emptyLabel={t('import:review.no_rows_in_slice')}
        footer={footer}
      />

      <KeyboardHint
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={t('import:review.keyboard_help_title')}
        testID={`${id}-keyboard-hint`}
        shortcuts={[
          { keys: ['↑', '↓'], label: t('import:review.keyboard.rows') },
          { keys: ['←', '→', 'Tab'], label: t('import:review.keyboard.cells') },
          { keys: ['Enter'], label: t('import:review.keyboard.edit') },
          { keys: ['Esc'], label: t('import:review.keyboard.cancel') },
          { keys: ['Space'], label: t('import:review.keyboard.select') },
          { keys: ['Shift', '↑', '↓'], label: t('import:review.keyboard.extend') },
          { keys: ['S'], label: t('import:review.keyboard.skip') },
          { keys: ['C'], label: t('import:review.keyboard.category') },
          { keys: ['[', ']'], label: t('import:review.keyboard.jump') },
          { keys: ['⌘', 'Enter'], label: t('import:review.keyboard.commit') },
          { keys: ['?'], label: t('import:review.keyboard.help') },
        ]}
      />
    </View>
  );
}
