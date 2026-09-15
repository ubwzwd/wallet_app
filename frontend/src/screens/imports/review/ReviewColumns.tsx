/**
 * The review grid's twelve columns (04 §4.11.2, 屏幕稿 03), in the order the spec lists
 * them: `☑ · # · 日期 · 金额 · 币种 · 种类 · 商户 · 备注 · 一级分类 · 二级分类 ·
 * 账户 · 对手 · 状态与标记`.
 *
 * It lives next to `ReviewTable` rather than inside it only because the file would
 * otherwise be over the 400-line limit; nothing else uses it. The table keeps the state
 * these cells are driven by (the focused cell, the cell being edited, which category picker
 * is open) and hands it in.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow } from '@/api/types';
import { space } from '@/theme/tokens';
import type { DataTableColumn } from '@/ui';

import { FlagBadges, SkipToggle } from './FlagBadges';
import { LinkCell } from './LinkCell';
import { CategoryCell, CurrencyCell, KindCell } from './ReviewCells.picker';
import { AmountCell, DateCell, RowNoCell, TextCell } from './ReviewCells.text';
import type { EditorHandle, ReviewEnv } from './ReviewRow';

/** Columns whose editor is a text box — clicking one starts typing straight away. */
export const TEXT_COLUMNS = new Set(['date', 'amount', 'merchant', 'note']);

/** 03 §5.41: `merchant` ≤ 200, `note` ≤ 500. */
const MERCHANT_MAX = 200;
const NOTE_MAX = 500;

/** Column widths, in the proportions 屏幕稿 03 draws them at 1440. */
const W = {
  row_no: 32,
  date: 60,
  amount: 112,
  currency: 70,
  kind: 80,
  merchant: 104,
  note: 84,
  category: 104,
  linked: 124,
  flags: 150,
} as const;

export type CategoryOpen = { id: string; level: 'l1' | 'l2' } | null;

export interface ReviewColumnsInput {
  env: ReviewEnv;
  /** The rows the grid is showing, so a cell can tell whether *it* is the one being edited. */
  rows: readonly ImportRow[];
  editing: { row: number; col: number } | null;
  onEditDone(): void;
  /** Bumped by `Esc`: every editor puts its original value back. */
  revision: number;
  registerEditor(handle: EditorHandle | null): void;
  categoryOpen: CategoryOpen;
  setCategoryOpen(next: CategoryOpen): void;
}

export function useReviewColumns({
  env,
  rows,
  editing,
  onEditDone,
  revision,
  registerEditor,
  categoryOpen,
  setCategoryOpen,
}: ReviewColumnsInput): DataTableColumn<ImportRow>[] {
  const { t } = useTranslation();

  return React.useMemo(() => {
    const isEditing = (row: ImportRow, colIndex: number): boolean =>
      editing !== null && rows[editing.row]?.id === row.id && editing.col === colIndex;
    const cellId = (row: ImportRow, key: string): string => `review-${row.row_no}-${key}`;
    const rev = (row: ImportRow): number => revision + env.ctrl.revisionOf(row.id);

    return [
      {
        key: 'row_no',
        title: t('import:review.column.row_no'),
        width: W.row_no,
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
        width: W.date,
        render: (row, ctx) => (
          <DateCell
            row={row}
            env={env}
            editing={isEditing(row, ctx.colIndex)}
            revision={rev(row)}
            registerEditor={registerEditor}
            onEditDone={onEditDone}
            testID={cellId(row, 'date')}
          />
        ),
      },
      {
        key: 'amount',
        title: t('import:review.column.amount'),
        width: W.amount,
        align: 'right',
        render: (row, ctx) => (
          <AmountCell
            row={row}
            env={env}
            editing={isEditing(row, ctx.colIndex)}
            revision={rev(row)}
            registerEditor={registerEditor}
            testID={cellId(row, 'amount')}
          />
        ),
      },
      {
        key: 'currency',
        title: t('import:review.column.currency'),
        width: W.currency,
        render: (row) => <CurrencyCell row={row} env={env} testID={cellId(row, 'currency')} />,
      },
      {
        key: 'kind',
        title: t('import:review.column.kind'),
        width: W.kind,
        render: (row) => <KindCell row={row} env={env} testID={cellId(row, 'kind')} />,
      },
      {
        key: 'merchant',
        title: t('import:review.column.merchant'),
        width: W.merchant,
        render: (row, ctx) => (
          <TextCell
            row={row}
            env={env}
            field="merchant"
            maxLength={MERCHANT_MAX}
            editing={isEditing(row, ctx.colIndex)}
            revision={rev(row)}
            registerEditor={registerEditor}
            testID={cellId(row, 'merchant')}
          />
        ),
      },
      {
        key: 'note',
        title: t('import:review.column.note'),
        width: W.note,
        render: (row, ctx) => (
          <TextCell
            row={row}
            env={env}
            field="note"
            maxLength={NOTE_MAX}
            editing={isEditing(row, ctx.colIndex)}
            revision={rev(row)}
            registerEditor={registerEditor}
            testID={cellId(row, 'note')}
          />
        ),
      },
      {
        key: 'category_l1',
        title: t('import:review.column.category_l1'),
        width: W.category,
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
        width: W.category,
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
        width: W.linked,
        render: (row) => <LinkCell row={row} env={env} testID={cellId(row, 'link')} />,
      },
      {
        key: 'flags',
        title: t('import:review.column.flags'),
        width: W.flags,
        render: (row) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: space['1'],
            }}
          >
            <SkipToggle
              row={row}
              onToggle={(target) =>
                env.ctrl.patch(target, {
                  status: target.status === 'skipped' ? 'pending' : 'skipped',
                })
              }
              testID={`review-${row.row_no}-skip`}
            />
            <FlagBadges row={row} testIDPrefix={`review-${row.row_no}-flag`} />
          </View>
        ),
      },
    ];
  }, [categoryOpen, editing, env, onEditDone, registerEditor, revision, rows, setCategoryOpen, t]);
}
