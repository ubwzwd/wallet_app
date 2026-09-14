/**
 * Bulk operations over the selected rows (04 §4.11.6, decision §14.52 A4).
 *
 * Everything here is **one** request to `PATCH .../rows` — never a fan-out of single-row
 * PATCHes — and the server runs it in one transaction, so it either changes every selected
 * row or none of them (03 §5.42). Nothing is applied optimistically for that reason.
 *
 * The category picker is filtered by the *intersection* of the selected rows' kinds before
 * it is opened: an expense category offered for a selection that contains an income row can
 * only end in a 400 that rolls the whole batch back, so the option never appears. If one
 * slips through anyway (a row edited in another tab, say), the failure names the row, and
 * the caller highlights and scrolls to it.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiClientError } from '@/api';
import type { ImportRow, ImportRowPatch, TxKind } from '@/api/types';
import { kindOfCategoryTree } from '@/domain/kinds';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import {
  Button,
  Card,
  CategoryPickerPanel,
  CurrencyPicker,
  Icon,
  Select,
  Sheet,
  Text,
  TextField,
} from '@/ui';

import type { ReviewEnv } from './ReviewRow';
import type { ReviewSelection } from './useReviewSelection';

export interface BulkFailure {
  /** The row the server (or the local pre-check) pointed at. */
  rowNo: number | null;
  kind: TxKind | null;
}

export interface BulkBarProps {
  env: ReviewEnv;
  selection: ReviewSelection;
  /** Told which row to highlight and scroll to when a bulk edit is refused. */
  onFailure(rowNo: number | null): void;
  /** Narrow layout pins the bar to the bottom of the screen (04 §4.11.9). */
  compact?: boolean;
  testID?: string;
}

/**
 * The kind whose category tree every selected row accepts, or `null` when the selection
 * mixes trees (expense/refund vs income) or contains a transfer.
 */
export function commonCategoryKind(rows: readonly ImportRow[]): TxKind | null {
  let tree: 'expense' | 'income' | null = null;
  let kind: TxKind | null = null;
  for (const row of rows) {
    if (row.kind === null) return null;
    const rowTree = kindOfCategoryTree(row.kind);
    if (rowTree === null) return null;
    if (tree === null) {
      tree = rowTree;
      kind = row.kind;
    } else if (tree !== rowTree) {
      return null;
    }
  }
  return kind;
}

/**
 * The whole patch a bulk "set kind" has to carry (04 §4.11.6).
 *
 * One patch is applied to every selected row, so it has to be valid for all of them on its
 * own: a transfer row must carry a direction and a subtype and must *not* carry a category
 * (03 §5.41), and the edit is all-or-nothing (03 §5.42) — a single row that the server
 * refuses rolls the whole selection back. `out` / `plain` are the same defaults a single-row
 * kind change writes; the direction of an individual leg is corrected in its link cell.
 */
export function bulkKindPatch(kind: TxKind): ImportRowPatch {
  if (kind !== 'transfer') return { kind };
  return {
    kind,
    transfer_role: 'out',
    transfer_subtype: 'plain',
    category_l1: null,
    category_l2: null,
  };
}

/** Which row a refused bulk edit is about — computed locally first, parsed from the
 *  server's `detail` as a fallback (03 §5.42 states the row number in prose). */
export function offendingRow(
  rows: readonly ImportRow[],
  patch: ImportRowPatch,
  error: unknown,
  index: ReviewEnv['index'],
): BulkFailure {
  if (patch.category_l1 !== undefined && patch.category_l1 !== null && index !== null) {
    const bad = rows.find(
      (row) =>
        row.kind === null ||
        !index.isValidPair(patch.category_l1 ?? null, patch.category_l2 ?? null, row.kind),
    );
    if (bad) return { rowNo: bad.row_no, kind: bad.kind };
  }
  if (error instanceof ApiClientError) {
    const hit = /\d+/.exec(error.detail);
    if (hit) return { rowNo: Number(hit[0]), kind: null };
  }
  return { rowNo: null, kind: null };
}

export function BulkBar({
  env,
  selection,
  onFailure,
  compact = false,
  testID,
}: BulkBarProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'review-bulk';
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [stage, setStage] = React.useState<'l1' | 'l2'>('l1');
  const [pickedL1, setPickedL1] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const rows = selection.selectedRows();
  const ids = rows.map((row) => row.id);
  const kind = commonCategoryKind(rows);

  if (selection.count === 0) return null;

  async function run(patch: ImportRowPatch): Promise<void> {
    setMessage(null);
    try {
      await env.ctrl.bulk(ids, patch);
    } catch (error) {
      const failure = offendingRow(rows, patch, error, env.index);
      setMessage(
        failure.rowNo === null
          ? t('import:review.bulk.failed')
          : t('import:review.bulk.mixed_kind_error', {
              row: failure.rowNo,
              kind: t(`transaction:kind.${failure.kind ?? 'income'}`),
            }),
      );
      onFailure(failure.rowNo);
    }
  }

  const closeCategory = (): void => {
    setCategoryOpen(false);
    setQuery('');
    setStage('l1');
    setPickedL1(null);
  };

  return (
    <Card
      variant="outlined"
      testID={id}
      style={{
        gap: space['2'],
        backgroundColor: colors['bg.raised'],
        ...(compact ? { borderRadius: 0 } : {}),
      }}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] }}
      >
        <Text variant="caption" testID={`${id}-count`}>
          {t('import:review.selected', { count: selection.count })}
        </Text>
        <Button
          testID={`${id}-category`}
          size="sm"
          variant="secondary"
          label={t('import:review.bulk.set_category')}
          disabled={kind === null || env.index === null || env.ctrl.bulkPending}
          onPress={() => setCategoryOpen(true)}
        />
        <Select
          testID={`${id}-kind`}
          value={null}
          placeholder={t('import:review.bulk.set_kind')}
          options={(['expense', 'income', 'refund', 'transfer'] as TxKind[]).map((k) => ({
            value: k,
            label: t(`transaction:kind.${k}`),
          }))}
          onChange={(next) => {
            if (next !== null) void run(bulkKindPatch(next as TxKind));
          }}
        />
        <CurrencyPicker
          testID={`${id}-currency`}
          variant="inline"
          codes={env.currencyCodes}
          names={env.currencyNames}
          value={null}
          label={t('import:review.bulk.set_currency')}
          onChange={(next) => void run({ currency: next })}
        />
        <Button
          testID={`${id}-skip`}
          size="sm"
          variant="secondary"
          label={t('import:review.bulk.skip')}
          disabled={env.ctrl.bulkPending}
          onPress={() => void run({ status: 'skipped' })}
        />
        <Button
          testID={`${id}-unskip`}
          size="sm"
          variant="secondary"
          label={t('import:review.bulk.unskip')}
          disabled={env.ctrl.bulkPending}
          onPress={() => void run({ status: 'pending' })}
        />
        <Button
          testID={`${id}-clear`}
          size="sm"
          variant="ghost"
          icon="x"
          iconOnly
          accessibilityLabel={t('common:button.cancel')}
          onPress={selection.clear}
        />
      </View>

      {message !== null ? (
        <Text variant="caption" tone="danger" testID={`${id}-error`}>
          {message}
        </Text>
      ) : null}

      <Sheet
        open={categoryOpen}
        onClose={closeCategory}
        title={t('import:review.bulk.set_category')}
        closeLabel={t('common:button.close')}
        testID={`${id}-category-sheet`}
      >
        <TextField
          testID={`${id}-category-search`}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel={t('transaction:form.category_search_placeholder')}
          placeholder={t('transaction:form.category_search_placeholder')}
          prefix={<Icon name="search" size={16} color={colors['fg.muted']} />}
        />
        {env.index !== null && kind !== null ? (
          <CategoryPickerPanel
            id={`${id}-category`}
            index={env.index}
            kind={kind}
            lang={env.lang}
            value={{ l1: pickedL1, l2: null }}
            query={query}
            wide={false}
            activeL1={pickedL1}
            stage={stage}
            onPickL1={(code) => {
              setPickedL1(code);
              setStage('l2');
            }}
            onPickL2={(code) => {
              const l1 = pickedL1;
              closeCategory();
              if (l1 !== null) void run({ category_l1: l1, category_l2: code });
            }}
            onBack={() => setStage('l1')}
          />
        ) : null}
      </Sheet>
    </Card>
  );
}
