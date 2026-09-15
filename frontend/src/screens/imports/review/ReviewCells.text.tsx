/**
 * The review cells whose editor is a text box, plus the row-number cell (04 §4.11.2,
 * §4.11.5). Shared plumbing — `useDraft`, `useEditorHandle`, the em dash — lives in
 * `ReviewRow.tsx`.
 *
 * 屏幕稿 03's typography for the row: the row number and the date are mono and grey, the
 * amount is mono and carries its kind's colour (a transfer stays ink, `kindSemantics`), the
 * merchant is the only 14/500 line and the note is the grey one beside it. The date is
 * shown as `MM-DD` — a batch is one statement, and the column has to fit twelve others.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow, ImportRowPatch } from '@/api/types';
import { applySign } from '@/domain/kinds';
import { normalizeAmountInput } from '@/domain/money';
import { formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, DateField, KIND_AMOUNT_TONE, Text, TextField, trimMoney } from '@/ui';

import {
  type CellProps,
  CellFrame,
  DASH,
  Dash,
  strikeIfSkipped,
  useDraft,
  useEditorHandle,
} from './ReviewRow';
import type { RowSaveState } from './useReviewRows';

// --------------------------------------------------------------------- row number

export interface RowNoCellProps {
  row: ImportRow;
  state: RowSaveState;
  onRetry(): void;
  /** The card flow writes it as `#4`; the grid's own column is headed `#` already. */
  hash?: boolean;
  testID: string;
}

type SaveDotToken = 'accent.solid' | 'status.danger.fg';

const SAVE_DOT_TOKEN: Readonly<Record<'saving' | 'failed', SaveDotToken>> = {
  saving: 'accent.solid',
  failed: 'status.danger.fg',
};

/** `2026-09-10` → `09-10` (屏幕稿 03); anything else is shown as it came. */
export function shortDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(5) : iso;
}

/**
 * Row number plus the save-state dot; a failed save turns the dot into a retry button.
 * The phone's card flow renders the very same cell (04 §4.11.9 — the narrow layout is a
 * different shape, not a smaller feature set).
 *
 * A saved row shows the number alone (屏幕稿 03): the dot is there to say "this row is not
 * settled yet", so it appears while a write is in flight and stays, red, when one failed.
 */
export function RowNoCell({
  row,
  state,
  onRetry,
  hash = false,
  testID,
}: RowNoCellProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['1'] }}>
      <Text variant="caption" tone="muted" mono style={strikeIfSkipped(row)} testID={testID}>
        {hash ? `#${row.row_no}` : row.row_no}
      </Text>
      {state !== 'saved' ? (
        <View
          testID={`${testID}-save-${state}`}
          accessibilityRole="text"
          accessibilityLabel={t(`import:review.save_state.${state}`)}
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.pill,
            backgroundColor: colors[SAVE_DOT_TOKEN[state]],
          }}
        />
      ) : null}
      {state === 'failed' ? (
        <Button
          testID={`${testID}-retry`}
          size="sm"
          variant="ghost"
          icon="refresh-cw"
          iconOnly
          label={t('common:button.retry')}
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------------- date

export function DateCell({
  row,
  env,
  editing,
  revision,
  registerEditor,
  onEditDone,
  testID,
}: CellProps): React.JSX.Element {
  const { t } = useTranslation();
  const { draft, setDraft, flush, cancel } = useDraft(row.date ?? '', revision, (value) => {
    if (value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    env.ctrl.patch(row, { date: value === '' ? null : value });
  });
  useEditorHandle(editing, registerEditor, flush, cancel);

  const body = !editing ? (
    <Text
      variant="caption"
      mono
      tone={row.date === null ? 'danger' : 'secondary'}
      style={strikeIfSkipped(row)}
      testID={testID}
    >
      {row.date === null ? t('import:review.missing_value') : shortDate(row.date)}
    </Text>
  ) : (
    <DateField
      testID={`${testID}-input`}
      label={t('import:review.column.date')}
      value={draft}
      onChange={(next) => {
        setDraft(next);
        if (/^\d{4}-\d{2}-\d{2}$/.test(next)) {
          env.ctrl.patch(row, { date: next });
          onEditDone?.();
        }
      }}
    />
  );
  return (
    <CellFrame row={row} env={env} field="date" testID={testID}>
      {body}
    </CellFrame>
  );
}

// --------------------------------------------------------------------- amount

export function AmountCell({
  row,
  env,
  editing,
  revision,
  registerEditor,
  testID,
}: CellProps): React.JSX.Element {
  const { t } = useTranslation();
  const initial = row.amount === null ? '' : trimMoney(row.amount);
  const { draft, setDraft, flush, cancel } = useDraft(initial, revision, (value) => {
    if (value.trim() === '') {
      env.ctrl.patch(row, { amount: null });
      return;
    }
    const normalized = normalizeAmountInput(value);
    if (normalized === null) return;
    const kind = row.kind ?? 'expense';
    env.ctrl.patch(row, { amount: applySign(normalized, kind, row.transfer_role ?? 'out') });
  });
  useEditorHandle(editing, registerEditor, flush, cancel);

  const body = !editing ? (
    <Text
      variant="subheading"
      mono
      numberOfLines={1}
      // 04 §6.2 rule 2: the amount carries its kind's colour, transfers excepted.
      tone={
        row.amount === null
          ? 'danger'
          : row.kind === null
            ? 'primary'
            : KIND_AMOUNT_TONE[row.kind]
      }
      style={strikeIfSkipped(row)}
      testID={testID}
    >
      {row.amount === null
        ? t('import:review.missing_value')
        : formatMoney(row.amount, row.currency ?? env.batch.base_currency, env.lang, {
            signDisplay: 'always',
          })}
    </Text>
  ) : (
    <TextField
      testID={`${testID}-input`}
      accessibilityLabel={t('import:review.column.amount')}
      value={draft}
      mono
      autoFocus
      keyboardType="numbers-and-punctuation"
      onChangeText={setDraft}
      onBlur={flush}
    />
  );
  return (
    <CellFrame row={row} env={env} field="amount" testID={testID}>
      {body}
    </CellFrame>
  );
}

// --------------------------------------------------------------------- merchant / note

export interface TextCellProps extends CellProps {
  field: 'merchant' | 'note';
  maxLength: number;
}

export function TextCell({
  row,
  env,
  field,
  maxLength,
  editing,
  revision,
  registerEditor,
  testID,
}: TextCellProps): React.JSX.Element {
  const { t } = useTranslation();
  // A transfer has no merchant at all (decision §14.52 B16).
  const dead = field === 'merchant' && row.kind === 'transfer';
  const { draft, setDraft, flush, cancel } = useDraft(row[field] ?? '', revision, (value) => {
    env.ctrl.patch(row, { [field]: value.trim() === '' ? null : value } as ImportRowPatch);
  });
  useEditorHandle(editing && !dead, registerEditor, flush, cancel);

  if (dead) return <Dash testID={testID} />;
  const body = !editing ? (
    <Text
      variant="body"
      weight={field === 'merchant' ? 500 : 400}
      numberOfLines={1}
      tone={field === 'merchant' ? (row[field] ? 'primary' : 'muted') : 'muted'}
      style={strikeIfSkipped(row)}
      testID={testID}
    >
      {row[field] ?? DASH}
    </Text>
  ) : (
    <TextField
      testID={`${testID}-input`}
      accessibilityLabel={t(`import:review.column.${field}`)}
      value={draft}
      autoFocus
      maxLength={maxLength}
      onChangeText={setDraft}
      onBlur={flush}
    />
  );
  return (
    <CellFrame row={row} env={env} field={field} testID={testID}>
      {body}
    </CellFrame>
  );
}
