/**
 * The wide-screen review grid (04 §4.11.1–§4.11.7).
 *
 * Twelve columns, in the order §4.11.2 lists them, and **no account column**: one file is
 * one target account (decision §5, §14.52 A5) — only a transfer row picks a *counterparty*
 * account, which lives in the link cell. The server's read-only `hint` is a small line under
 * its row (§4.11.2), never folded into `note`.
 *
 * This component owns the two pieces of state the keyboard drives — the focused cell and
 * the cell being edited — plus the category picker that `C` opens. Row data, the selection
 * and the commit bar belong to the screen, so the phone layout can reuse them untouched.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow } from '@/api/types';
import { space } from '@/theme/tokens';
import { DataTable, type DataTableCellPos, type DataTableColumn, KeyboardHint, Text } from '@/ui';

import { FlagBadges, SkipToggle } from './FlagBadges';
import { LinkCell } from './LinkCell';
import {
  AmountCell,
  CategoryCell,
  CurrencyCell,
  DateCell,
  type EditorHandle,
  KindCell,
  type ReviewEnv,
  RowNoCell,
  TextCell,
} from './ReviewRow';
import { useReviewKeys } from './useReviewKeys';
import { isUncategorized, type ReviewSelection } from './useReviewSelection';

/** Columns whose editor is a text box — clicking one starts typing straight away. */
const TEXT_COLUMNS = new Set(['date', 'amount', 'merchant', 'note']);

/** 03 §5.41: `merchant` ≤ 200, `note` ≤ 500. */
const MERCHANT_MAX = 200;
const NOTE_MAX = 500;

export interface ReviewViewProps {
  env: ReviewEnv;
  selection: ReviewSelection;
  /** The row an error (or "jump to the first one") pointed at. */
  highlightRowNo: number | null;
  /** `⌘/Ctrl + Enter` asks the screen's commit bar to submit. */
  onCommitRequest(): void;
  testID?: string;
}

export function ReviewTable({
  env,
  selection,
  highlightRowNo,
  onCommitRequest,
  testID,
}: ReviewViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const id = testID ?? 'review-table';
  const rows = selection.visible;

  const [focus, setFocus] = React.useState<DataTableCellPos | null>(null);
  const [editing, setEditing] = React.useState<DataTableCellPos | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [categoryOpen, setCategoryOpen] = React.useState<{ id: string; level: 'l1' | 'l2' } | null>(
    null,
  );
  const [helpOpen, setHelpOpen] = React.useState(false);
  const editor = React.useRef<EditorHandle | null>(null);

  const registerEditor = React.useCallback((handle: EditorHandle | null): void => {
    editor.current = handle;
  }, []);

  const columns: DataTableColumn<ImportRow>[] = React.useMemo(() => {
    const isEditing = (row: ImportRow, colIndex: number): boolean =>
      editing !== null && rows[editing.row]?.id === row.id && editing.col === colIndex;
    const cellId = (row: ImportRow, key: string): string => `review-${row.row_no}-${key}`;

    return [
      {
        key: 'row_no',
        title: t('import:review.column.row_no'),
        width: 76,
        render: (row) => (
          <RowNoCell
            row={row}
            state={env.ctrl.saveStateOf(row.id)}
            onRetry={() => env.ctrl.retry(row.id)}
            testID={cellId(row, 'row-no')}
          />
        ),
      },
      {
        key: 'date',
        title: t('import:review.column.date'),
        width: 128,
        render: (row, ctx) => (
          <DateCell
            row={row}
            env={env}
            editing={isEditing(row, ctx.colIndex)}
            revision={revision + env.ctrl.revisionOf(row.id)}
            registerEditor={registerEditor}
            onEditDone={() => setEditing(null)}
            testID={cellId(row, 'date')}
          />
        ),
      },
      {
        key: 'amount',
        title: t('import:review.column.amount'),
        width: 128,
        align: 'right',
        render: (row, ctx) => (
          <AmountCell
            row={row}
            env={env}
            editing={isEditing(row, ctx.colIndex)}
            revision={revision + env.ctrl.revisionOf(row.id)}
            registerEditor={registerEditor}
            testID={cellId(row, 'amount')}
          />
        ),
      },
      {
        key: 'currency',
        title: t('import:review.column.currency'),
        width: 96,
        render: (row) => <CurrencyCell row={row} env={env} testID={cellId(row, 'currency')} />,
      },
      {
        key: 'kind',
        title: t('import:review.column.kind'),
        width: 128,
        render: (row) => <KindCell row={row} env={env} testID={cellId(row, 'kind')} />,
      },
      {
        key: 'merchant',
        title: t('import:review.column.merchant'),
        width: 160,
        render: (row, ctx) => (
          <TextCell
            row={row}
            env={env}
            field="merchant"
            maxLength={MERCHANT_MAX}
            editing={isEditing(row, ctx.colIndex)}
            revision={revision + env.ctrl.revisionOf(row.id)}
            registerEditor={registerEditor}
            testID={cellId(row, 'merchant')}
          />
        ),
      },
      {
        key: 'note',
        title: t('import:review.column.note'),
        width: 160,
        render: (row, ctx) => (
          <TextCell
            row={row}
            env={env}
            field="note"
            maxLength={NOTE_MAX}
            editing={isEditing(row, ctx.colIndex)}
            revision={revision + env.ctrl.revisionOf(row.id)}
            registerEditor={registerEditor}
            testID={cellId(row, 'note')}
          />
        ),
      },
      {
        key: 'category_l1',
        title: t('import:review.column.category_l1'),
        width: 150,
        render: (row) => (
          <CategoryCell
            row={row}
            env={env}
            level="l1"
            open={categoryOpen?.id === row.id && categoryOpen.level === 'l1'}
            onOpenChange={(open) => setCategoryOpen(open ? { id: row.id, level: 'l1' } : null)}
            testID={cellId(row, 'l1')}
          />
        ),
      },
      {
        key: 'category_l2',
        title: t('import:review.column.category_l2'),
        width: 150,
        render: (row) => (
          <CategoryCell
            row={row}
            env={env}
            level="l2"
            open={categoryOpen?.id === row.id && categoryOpen.level === 'l2'}
            onOpenChange={(open) => setCategoryOpen(open ? { id: row.id, level: 'l2' } : null)}
            testID={cellId(row, 'l2')}
          />
        ),
      },
      {
        key: 'linked',
        title: t('import:review.column.linked'),
        width: 280,
        render: (row) => <LinkCell row={row} env={env} testID={cellId(row, 'link')} />,
      },
      {
        key: 'flags',
        title: t('import:review.column.flags'),
        width: 220,
        render: (row) => (
          <View style={{ gap: space['1'] }}>
            <FlagBadges row={row} testIDPrefix={`review-${row.row_no}-flag`} />
            <SkipToggle
              row={row}
              onToggle={(target) =>
                env.ctrl.patch(target, {
                  status: target.status === 'skipped' ? 'pending' : 'skipped',
                })
              }
              testID={`review-${row.row_no}-skip`}
            />
          </View>
        ),
      },
    ];
  }, [categoryOpen, editing, env, registerEditor, revision, rows, t]);

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

  useReviewKeys({
    rowCount: rows.length,
    colCount: columns.length,
    focus,
    setFocus,
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

  const highlightIndex =
    highlightRowNo === null ? null : rows.findIndex((row) => row.row_no === highlightRowNo);

  return (
    <View style={{ gap: space['2'] }} testID={`${id}-wrap`}>
      <DataTable<ImportRow>
        testID={id}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        selected={selection.selected}
        onToggleRow={(row, index) => selection.toggle(row, index)}
        onToggleAll={(next) => selection.toggleAll(next)}
        selectAllLabel={t('import:review.select_all')}
        rowSelectLabel={(row) => t('import:review.select_row', { row: row.row_no })}
        rowTone={(row) => {
          if (row.row_no === highlightRowNo) return 'highlight';
          return row.status === 'skipped' ? 'muted' : 'default';
        }}
        rowBelow={(row) =>
          row.hint === null ? null : (
            <Text variant="micro" tone="muted" testID={`review-${row.row_no}-hint`}>
              {row.hint}
            </Text>
          )
        }
        focus={focus}
        onFocusCell={(pos) => {
          setFocus(pos);
          setEditing(TEXT_COLUMNS.has(columns[pos.col].key) ? pos : null);
        }}
        scrollToRow={highlightIndex !== null && highlightIndex >= 0 ? highlightIndex : null}
        emptyLabel={t('import:review.no_rows_in_slice')}
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
