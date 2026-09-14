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
 * the caller highlights and scrolls to it. The kind picker is filtered the same way and for
 * the same reason: the server re-derives every row's sign from that row's own amount, which
 * one bulk body cannot carry, so a kind that disagrees with any selected amount is offered
 * to nobody (§4.11.6).
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiClientError } from '@/api';
import type { ImportRow, ImportRowPatch, TxKind } from '@/api/types';
import { kindOfCategoryTree } from '@/domain/kinds';
import { cmpMoney } from '@/domain/money';
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
 *
 * The links a row earned under its old kind are *not* in the body: 05 §4.1 / decision
 * §14.55 keep the three per-row link fields out of the bulk patch altogether, and the
 * server clears them itself — `_apply_patch` (`app/api/import_support.py`) nulls both
 * `matched_transaction_id` and `counterpart_source_id` (and drops the candidate flags)
 * whenever `kind` actually changes.
 */
export function bulkKindPatch(kind: TxKind): ImportRowPatch {
  if (kind !== 'transfer') return { kind };
  return {
    kind,
    transfer_role: 'out',
    transfer_subtype: 'plain',
    category_l1: null,
    category_l2: null,
    // 03 §5.41 / decision §14.52 B16: a transfer leg carries no merchant.
    merchant: null,
  };
}

/**
 * The kinds the selection can actually be set to (04 §4.11.6: an option that can only end
 * in a 400 is not offered at all).
 *
 * A patch carrying `kind` makes the server re-derive **every** row's sign from that row's
 * own amount (03 §5.41, "符号与 kind 冲突" → 400 `validation_error`), and one bulk body
 * cannot carry a per-row amount — so a kind only survives when every selected row's amount
 * already has the sign that kind demands: positive for `income` and `refund`, negative for
 * `expense`, and negative for `transfer` too, whose bulk patch always sends the default
 * `transfer_role: 'out'`. The server's own check skips a row with no amount and treats the
 * sign as `amount > 0` (`_check_sign`), so a missing amount constrains nothing at all and a
 * zero amount only rules out `income` / `refund` — a row whose amount could not be parsed
 * (02 §2.8 rule 10 stores 0) must not cost the user the whole picker. Only a selection that
 * genuinely mixes signs leaves nothing that could be set.
 */
export function bulkKindOptions(rows: readonly ImportRow[]): TxKind[] {
  if (rows.length === 0) return [];
  let needsPositive = false;
  let needsNegative = false;
  for (const row of rows) {
    if (row.amount === null) continue;
    if (cmpMoney(row.amount, '0') > 0) needsPositive = true;
    else needsNegative = true;
    if (needsPositive && needsNegative) return [];
  }
  if (needsPositive) return ['income', 'refund'];
  if (needsNegative) return ['expense', 'transfer'];
  return ['expense', 'income', 'refund', 'transfer'];
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
  const kindOptions = bulkKindOptions(rows);

  if (selection.count === 0) return null;

  async function run(patch: ImportRowPatch): Promise<void> {
    setMessage(null);
    try {
      await env.ctrl.bulk(ids, patch);
    } catch (error) {
      const failure = offendingRow(rows, patch, error, env.index);
      // The category-specific wording is only true when a category really was the edit
      // *and* the local pre-check found the row whose kind disagrees with it. Everything
      // else — a currency, a kind, a skip — gets the neutral sentence: telling a user who
      // pressed "set kind" that a category does not match would be a lie.
      const mixedKind = patch.category_l1 !== undefined && failure.kind !== null;
      setMessage(
        failure.rowNo === null
          ? t('import:review.bulk.failed')
          : mixedKind
            ? t('import:review.bulk.mixed_kind_error', {
                row: failure.rowNo,
                kind: t(`transaction:kind.${failure.kind}`),
              })
            : t('import:review.bulk.failed_row', { row: failure.rowNo }),
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
          // Only the kinds the selection's amounts allow — the rest would be a certain 400.
          options={kindOptions.map((k) => ({ value: k, label: t(`transaction:kind.${k}`) }))}
          disabled={kindOptions.length === 0 || env.ctrl.bulkPending}
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
          disabled={env.ctrl.bulkPending}
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

      {/* A greyed picker with no reason is the weakest form of "block the impossible
          option" (§4.11.6), so say why it is out. */}
      {kindOptions.length === 0 && !env.ctrl.bulkPending ? (
        <Text variant="caption" tone="muted" testID={`${id}-kind-hint`}>
          {t('import:review.bulk.kind_mixed_signs')}
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
