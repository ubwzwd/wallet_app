/**
 * Undoing a committed import batch (04 §4.10, decisions §14.22, §14.52 B24).
 *
 * One flow, two callers — the history list and the committed panel of the batch screen —
 * because the wording and the number of round trips are part of the decision, not of the
 * screen: a `?dry_run=true` DELETE first, whose two refund counters are worded *separately*
 * in the confirmation because they say different things, then a double-tap danger confirm,
 * then the real DELETE and its toast. A zero counter contributes no line at all.
 *
 * Every failure is silent here on purpose: `useDeleteImport` is not a `silent` mutation, so
 * the global error toast has already named it (04 §3.9).
 */
import type { TFunction } from 'i18next';

import type { ImportDeleteResult } from '@/api/types';
import type { ImportDeleteVars } from '@/queries';
import { confirm, toast } from '@/ui';

export interface UndoImportBatchOptions {
  /** `useDeleteImport(ledgerId, batchId).mutateAsync`, already bound to the batch. */
  remove(vars?: ImportDeleteVars): Promise<ImportDeleteResult>;
  t: TFunction;
  /** Ran once the batch is really gone; the caller decides where to go afterwards. */
  onDone?(): void;
}

/** Resolves `true` only when the batch was actually deleted. */
export async function undoImportBatch({
  remove,
  t,
  onDone,
}: UndoImportBatchOptions): Promise<boolean> {
  // Ask first: how much would this delete, and which refunds does it disturb?
  let dry: ImportDeleteResult;
  try {
    dry = await remove({ dry_run: true });
  } catch {
    return false;
  }

  const lines = [
    t('import:committed.undo_confirm_body', { count: dry.would_delete_transactions ?? 0 }),
  ];
  // The two counters are NOT the same thing, so they never share a sentence, and a zero
  // counter contributes no line at all (decision §14.52 B24).
  if (dry.orphaned_refunds > 0) {
    lines.push(t('import:committed.undo_orphaned_refunds', { count: dry.orphaned_refunds }));
  }
  if (dry.refunds_in_batch > 0) {
    lines.push(t('import:committed.undo_refunds_in_batch', { count: dry.refunds_in_batch }));
  }

  const ok = await confirm({
    title: t('import:committed.undo_confirm_title'),
    body: lines.join('\n\n'),
    confirmLabel: t('import:history.undo'),
    tone: 'danger',
    doubleTap: true,
  });
  if (!ok) return false;

  let done: ImportDeleteResult;
  try {
    done = await remove();
  } catch {
    return false;
  }
  toast.success(
    t('import:committed.undo_success_toast', { count: done.deleted_transactions ?? 0 }),
  );
  onDone?.();
  return true;
}
