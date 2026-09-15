/**
 * The imperative half of 屏幕稿 11 · 撤销确认 (see `UndoDialog.tsx` for the dialog itself).
 *
 * It is imperative for the same reason `confirm()` is: two callers — the history list and
 * the batch screen's committed panel — run the exact same flow (`undoBatch.ts`), and
 * neither wants to own dialog state. `askUndo(...)` resolves `true` only when the user
 * confirms; the screen that can undo renders `<UndoDialogHost />` once.
 */

/** One 「会删掉的交易 / 11 笔」 tile. */
export interface UndoStat {
  key: string;
  label: string;
  value: string;
  tone?: 'primary' | 'income' | 'expense';
}

/** One amber card — a refund counter the user has to see before pressing (§14.52 B24). */
export interface UndoWarning {
  key: string;
  title: string;
  body: string;
}

export interface UndoDialogData {
  title: string;
  /** The mono line under the title: which file, uploaded when, into which account. */
  meta?: string;
  stats: readonly UndoStat[];
  warnings: readonly UndoWarning[];
  /** The sentence on the left of the foot strip. */
  footNote: string;
  confirmLabel: string;
  /** Label once the first press has armed the button (the double tap of §14.52 B24). */
  confirmAgainLabel: string;
  cancelLabel: string;
  closeLabel: string;
}

export interface PendingUndo {
  id: number;
  data: UndoDialogData;
  resolve(result: boolean): void;
}

type Listener = () => void;

let pending: PendingUndo | null = null;
const listeners = new Set<Listener>();
let seq = 0;

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeUndo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingUndo(): PendingUndo | null {
  return pending;
}

export function settleUndo(result: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(result);
}

/** Resolves `true` only if the user confirms twice; a second call supersedes the first. */
export function askUndo(data: UndoDialogData): Promise<boolean> {
  if (pending !== null) settleUndo(false);
  seq += 1;
  return new Promise<boolean>((resolve) => {
    pending = { id: seq, data, resolve };
    emit();
  });
}
