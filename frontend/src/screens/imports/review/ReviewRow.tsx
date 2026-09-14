/**
 * What every review cell shares (04 §4.11.2, §4.11.5): the environment a cell needs, the
 * handle the keyboard drives it with, and the local-draft/debounce machinery.
 *
 * The cells themselves live next door, split by the kind of control they are:
 *  - `ReviewCells.text.tsx` — the row number, date, amount, merchant and note;
 *  - `ReviewCells.picker.tsx` — currency, kind and the two category levels;
 *  - `LinkCell.tsx` — the "link / counterparty" column, which is a screen of its own.
 *
 * Text-ish cells hold a local draft and reach the server 500ms after the last keystroke or
 * on blur, whichever comes first; pickers commit the moment they close. Every commit goes
 * through `ctrl.patch`, which sends only what changed.
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
  Uuid,
} from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import type { Lang } from '@/i18n';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Icon, Text } from '@/ui';

import type { ReviewRowsController } from './useReviewRows';

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

export const DASH = '—';

/** A skipped row is greyed out *and* struck through (04 §4.11.4). */
const STRIKE = { textDecorationLine: 'line-through' } as const;

export function strikeIfSkipped(row: ImportRow): typeof STRIKE | undefined {
  return row.status === 'skipped' ? STRIKE : undefined;
}

/** A read-only cell body: the em dash of a column that does not apply to this row. */
export function Dash({ testID }: { testID: string }): React.JSX.Element {
  return (
    <Text variant="caption" tone="muted" testID={testID}>
      {DASH}
    </Text>
  );
}

/** A field a cell edits, and therefore a field whose refusal that cell has to own. */
export type CellField = keyof ImportRowPatch & string;

export interface CellFrameProps {
  row: ImportRow;
  env: ReviewEnv;
  field: CellField;
  testID: string;
  children: React.ReactNode;
}

/**
 * Wraps a cell's body with the marker its own refused write earns (04 §4.11.5): a red
 * exclamation and a retry, right where the value was typed. The row-number dot stays as the
 * at-a-glance state of the whole row; this is the "which cell" half of the same fact.
 *
 * Nothing is wrapped while the cell is fine — the frame disappears completely, so the
 * ordinary case keeps the exact layout (and the right-aligned amount column) it had.
 */
export function CellFrame({
  row,
  env,
  field,
  testID,
  children,
}: CellFrameProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const failed = field in env.ctrl.failedFieldsOf(row.id);
  if (!failed) return <>{children}</>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['1'] }}>
      <View style={{ flexShrink: 1 }}>{children}</View>
      <View
        testID={`${testID}-error`}
        accessibilityRole="text"
        accessibilityLabel={t('import:review.save_state.failed')}
      >
        <Icon name="alert-triangle" size={14} color={colors['status.danger.fg']} />
      </View>
      <Button
        testID={`${testID}-retry`}
        size="sm"
        variant="ghost"
        icon="refresh-cw"
        iconOnly
        label={t('common:button.retry')}
        onPress={() => env.ctrl.retry(row.id)}
      />
    </View>
  );
}

/** Local draft + debounce, shared by every text-ish cell. */
export function useDraft(
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
export function useEditorHandle(
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
