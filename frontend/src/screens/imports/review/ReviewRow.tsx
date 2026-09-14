/**
 * One review row's cells (04 §4.11.2, §4.11.5).
 *
 * Each cell is its own small controlled editor over one field of an `ImportRow`. Text-ish
 * cells (merchant, note, amount, date) hold a local draft and reach the server 500ms after
 * the last keystroke or on blur, whichever comes first; pickers (currency, kind, category)
 * commit the moment they close. Every commit goes through `ctrl.patch`, which sends only
 * what changed.
 *
 * Two cells are dead by decision, not by data: a transfer row has no merchant
 * (decision §14.52 B16 — the `merchant` column is the CSV's own column, and the "A → B"
 * title is assembled by the display layer) and no category (decision §10/§1.3). Both render
 * an em dash and refuse input.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type {
  FinanceSource,
  ImportBatch,
  ImportRow,
  ImportRowPatch,
  TxKind,
  Uuid,
} from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { KINDS, applySign } from '@/domain/kinds';
import { normalizeAmountInput } from '@/domain/money';
import { categoryName } from '@/i18n/category';
import { formatMoney } from '@/i18n/format';
import type { Lang } from '@/i18n';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import {
  Button,
  CategoryPickerPanel,
  type CategoryValue,
  CurrencyPicker,
  DateField,
  Icon,
  Select,
  Sheet,
  Text,
  TextField,
  trimMoney,
} from '@/ui';

import type { ReviewRowsController, RowSaveState } from './useReviewRows';

/** 04 §4.11.5: a text box reaches the server this long after the last keystroke. */
export const CELL_DEBOUNCE_MS = 500;

/** Everything a cell needs that is not the row itself. */
export interface ReviewEnv {
  ledgerId: Uuid;
  batch: ImportBatch;
  ctrl: ReviewRowsController;
  index: CategoryIndex | null;
  lang: Lang;
  currencyCodes: readonly string[];
  currencyNames: Readonly<Record<string, string>>;
  sources: readonly FinanceSource[];
}

/** What the keyboard needs from whichever cell is being edited (04 §4.11.7). */
export interface EditorHandle {
  commit(): void;
  cancel(): void;
}

export interface CellProps {
  row: ImportRow;
  env: ReviewEnv;
  /** `true` while this cell is the one being edited. */
  editing?: boolean;
  /** Bumped when `Esc` asks every editor to restore its original value. */
  revision?: number;
  onEditDone?(): void;
  registerEditor?(handle: EditorHandle | null): void;
  testID: string;
}

const DASH = '—';

/** A skipped row is greyed out *and* struck through (04 §4.11.4). */
const STRIKE = { textDecorationLine: 'line-through' } as const;

function strikeIfSkipped(row: ImportRow): typeof STRIKE | undefined {
  return row.status === 'skipped' ? STRIKE : undefined;
}

/**
 * The patch a kind change implies (04 §4.11.2, §8.4 case 3): the sign follows the new kind,
 * a transfer loses its category, and leaving `transfer`/`refund` drops the fields that only
 * mean something there. `changedFields` trims whatever was already in that state.
 */
export function kindChangePatch(row: ImportRow, kind: TxKind): ImportRowPatch {
  const patch: ImportRowPatch = { kind };
  if (row.amount !== null) {
    patch.amount = applySign(row.amount, kind, row.transfer_role ?? 'out');
  }
  if (kind === 'transfer') {
    patch.category_l1 = null;
    patch.category_l2 = null;
  } else {
    patch.counterpart_source_id = null;
    patch.counterparty = null;
    patch.transfer_role = null;
    patch.transfer_subtype = null;
  }
  if (kind !== 'transfer' && kind !== 'refund') patch.matched_transaction_id = null;
  return patch;
}

/** A read-only cell body: the em dash of a column that does not apply to this row. */
function Dash({ testID }: { testID: string }): React.JSX.Element {
  return (
    <Text variant="caption" tone="muted" testID={testID}>
      {DASH}
    </Text>
  );
}

/** Local draft + debounce, shared by every text-ish cell. */
function useDraft(
  initial: string,
  revision: number | undefined,
  commit: (value: string) => void,
): {
  draft: string;
  setDraft(next: string): void;
  flush(): void;
  cancel(): void;
} {
  const [draft, setDraftState] = React.useState(initial);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef(initial);
  const commitRef = React.useRef(commit);
  commitRef.current = commit;

  // The server's value wins whenever it changes under us, and `Esc` (a new revision) puts
  // the original back — that is the whole of "cancel this cell" (04 §4.11.7).
  React.useEffect(() => {
    latest.current = initial;
    setDraftState(initial);
  }, [initial, revision]);

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  React.useEffect(() => clear, []);

  const setDraft = (next: string): void => {
    setDraftState(next);
    latest.current = next;
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      commitRef.current(latest.current);
    }, CELL_DEBOUNCE_MS);
  };

  const flush = (): void => {
    clear();
    commitRef.current(latest.current);
  };

  const cancel = (): void => {
    clear();
    latest.current = initial;
    setDraftState(initial);
  };

  return { draft, setDraft, flush, cancel };
}

/** Publishes `commit` / `cancel` to the table while this cell is the one being edited. */
function useEditorHandle(
  editing: boolean | undefined,
  register: CellProps['registerEditor'],
  flush: () => void,
  cancel: () => void,
): void {
  const flushRef = React.useRef(flush);
  flushRef.current = flush;
  const cancelRef = React.useRef(cancel);
  cancelRef.current = cancel;
  React.useEffect(() => {
    if (!editing || !register) return;
    register({ commit: () => flushRef.current(), cancel: () => cancelRef.current() });
    return () => register(null);
  }, [editing, register]);
}

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

/** Row number plus the save-state dot; a failed save turns the dot into a retry button. */
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

  if (!editing) {
    return (
      <Text
        variant="caption"
        mono
        tone={row.date === null ? 'danger' : 'primary'}
        testID={testID}
      >
        {row.date ?? t('import:review.missing_value')}
      </Text>
    );
  }
  return (
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

  if (!editing) {
    return (
      <Text
        variant="caption"
        mono
        tone={row.amount === null ? 'danger' : 'primary'}
        testID={testID}
      >
        {row.amount === null
          ? t('import:review.missing_value')
          : formatMoney(row.amount, row.currency ?? env.batch.base_currency, env.lang, {
              signDisplay: 'always',
            })}
      </Text>
    );
  }
  return (
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
}

// --------------------------------------------------------------------- currency

export function CurrencyCell({ row, env, testID }: CellProps): React.JSX.Element {
  return (
    <CurrencyPicker
      testID={testID}
      variant="inline"
      codes={env.currencyCodes}
      names={env.currencyNames}
      value={row.currency}
      onChange={(next) => env.ctrl.patch(row, { currency: next })}
    />
  );
}

// --------------------------------------------------------------------- kind

export function KindCell({ row, env, testID }: CellProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Select
      testID={testID}
      value={row.kind}
      options={KINDS.map((kind) => ({ value: kind, label: t(`transaction:kind.${kind}`) }))}
      label={t('import:review.column.kind')}
      onChange={(next) => {
        if (next === null || next === row.kind) return;
        env.ctrl.patch(row, kindChangePatch(row, next as TxKind));
      }}
    />
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
  if (!editing) {
    return (
      <Text
        variant="caption"
        numberOfLines={1}
        tone={row[field] ? 'primary' : 'muted'}
        style={strikeIfSkipped(row)}
        testID={testID}
      >
        {row[field] ?? DASH}
      </Text>
    );
  }
  return (
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
}

// --------------------------------------------------------------------- category

export interface CategoryCellProps extends CellProps {
  level: 'l1' | 'l2';
  /** Controlled so `C` (04 §4.11.7) can open the level-1 picker of the focused row. */
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function CategoryCell({
  row,
  env,
  level,
  open,
  onOpenChange,
  testID,
}: CategoryCellProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [query, setQuery] = React.useState('');
  const [stage, setStage] = React.useState<'l1' | 'l2'>(level);

  const index = env.index;
  // Transfers have no category (decision §1.3); a level-2 cell needs its parent first.
  const dead =
    row.kind === 'transfer' || index === null || (level === 'l2' && row.category_l1 === null);

  const value: CategoryValue = { l1: row.category_l1, l2: row.category_l2 };
  const code = level === 'l1' ? row.category_l1 : row.category_l2;
  const label =
    code !== null && index !== null && index.byCode[code]
      ? categoryName(index.byCode[code], env.lang)
      : null;

  React.useEffect(() => {
    if (open) setStage(level === 'l2' && row.category_l1 !== null ? 'l2' : 'l1');
  }, [open, level, row.category_l1]);

  const close = (): void => {
    setQuery('');
    onOpenChange(false);
  };

  if (dead) return <Dash testID={testID} />;

  return (
    <>
      <Button
        testID={`${testID}-trigger`}
        size="sm"
        variant="ghost"
        label={
          label ??
          t(level === 'l1' ? 'import:review.pick_category' : 'import:review.pick_category_l2')
        }
        onPress={() => onOpenChange(true)}
        style={{
          borderWidth: 1,
          borderRadius: radius.sm,
          borderColor:
            label === null && level === 'l1' ? colors['flag.uncategorized'] : 'transparent',
        }}
      />
      <Sheet
        open={open}
        onClose={close}
        title={t('import:review.column.category_l1')}
        closeLabel={t('common:button.close')}
        testID={`${testID}-sheet`}
      >
        <TextField
          testID={`${testID}-search`}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel={t('transaction:form.category_search_placeholder')}
          placeholder={t('transaction:form.category_search_placeholder')}
          prefix={<Icon name="search" size={16} color={colors['fg.muted']} />}
        />
        {index !== null ? (
          <CategoryPickerPanel
            id={testID}
            index={index}
            kind={row.kind ?? 'expense'}
            lang={env.lang}
            value={value}
            query={query}
            wide={false}
            activeL1={stage === 'l2' ? row.category_l1 : null}
            stage={stage}
            onPickL1={(next) => {
              env.ctrl.patch(row, { category_l1: next, category_l2: null });
              setStage('l2');
              setQuery('');
            }}
            onPickL2={(next) => {
              env.ctrl.patch(row, { category_l2: next });
              close();
            }}
            onBack={() => setStage('l1')}
          />
        ) : null}
      </Sheet>
    </>
  );
}
