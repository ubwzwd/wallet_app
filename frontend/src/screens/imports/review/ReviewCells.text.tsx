/**
 * The review cells whose editor is a text box, plus the row-number cell (04 §4.11.2,
 * §4.11.5). Shared plumbing — `useDraft`, `useEditorHandle`, the em dash — lives in
 * `ReviewRow.tsx`.
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
import { Button, DateField, Text, TextField, trimMoney } from '@/ui';

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
  testID: string;
}

type SaveDotToken = 'fg.muted' | 'accent.solid' | 'status.danger.fg';

const SAVE_DOT_TOKEN: Readonly<Record<RowSaveState, SaveDotToken>> = {
  saved: 'fg.muted',
  saving: 'accent.solid',
  failed: 'status.danger.fg',
};

/**
 * Row number plus the save-state dot; a failed save turns the dot into a retry button.
 * The phone's card flow renders the very same cell (04 §4.11.9 — the narrow layout is a
 * different shape, not a smaller feature set).
 */
export function RowNoCell({ row, state, onRetry, testID }: RowNoCellProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['1'] }}>
      <Text variant="caption" tone="secondary" mono style={strikeIfSkipped(row)} testID={testID}>
        {row.row_no}
      </Text>
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
    <Text variant="caption" mono tone={row.date === null ? 'danger' : 'primary'} testID={testID}>
      {row.date ?? t('import:review.missing_value')}
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
    <Text variant="caption" mono tone={row.amount === null ? 'danger' : 'primary'} testID={testID}>
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
      variant="caption"
      numberOfLines={1}
      tone={row[field] ? 'primary' : 'muted'}
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
