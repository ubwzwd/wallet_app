/**
 * Undoing a committed import batch (04 §4.10, decisions §14.22, §14.52 B24).
 *
 * One flow, two callers — the history list and the committed panel of the batch screen —
 * because the wording and the number of round trips are part of the decision, not of the
 * screen: a `?dry_run=true` DELETE first, whose two refund counters are worded *separately*
 * in the confirmation because they say different things, then a double-tap danger confirm,
 * then the real DELETE and its toast. A zero counter contributes no card at all.
 *
 * What the confirmation *looks* like is 屏幕稿 11 · 撤销确认, which is not a generic
 * `ConfirmDialog`: stat tiles, amber cards, a foot strip whose button names the count.
 * That dialog is `UndoDialog.tsx`; this module only decides what goes in it.
 *
 * Every failure is silent here on purpose: `useDeleteImport` is not a `silent` mutation, so
 * the global error toast has already named it (04 §3.9).
 */
import type { TFunction } from 'i18next';

import type { ImportBatch, ImportBatchListItem, ImportDeleteResult } from '@/api/types';
import { negMoney } from '@/domain/money';
import type { Lang } from '@/i18n';
import { formatDateTime } from '@/i18n/format';
import type { ImportDeleteVars } from '@/queries';
import { toast } from '@/ui';

import { signedPlain } from './amountFormat';
import { askUndo, type UndoStat, type UndoWarning } from './UndoDialog';

export interface UndoImportBatchOptions {
  /** `useDeleteImport(ledgerId, batchId).mutateAsync`, already bound to the batch. */
  remove(vars?: ImportDeleteVars): Promise<ImportDeleteResult>;
  /** The batch itself: the dialog's mono line and its 「净额回滚」 tile come from it. */
  batch: ImportBatch | ImportBatchListItem;
  t: TFunction;
  lang: Lang;
  /** Ran once the batch is really gone; the caller decides where to go afterwards. */
  onDone?(): void;
}

/** 屏幕稿 11's 「dbs-09.csv · 09-09 08:02 · 目标账户 DBS Multiplier」. */
export function undoMeta(
  batch: ImportBatch | ImportBatchListItem,
  t: TFunction,
  lang: Lang,
): string {
  const filename =
    batch.source === 'paste' ? t('import:history.pasted_filename') : (batch.filename ?? '');
  return [filename, formatDateTime(batch.created_at), batch.source_name]
    .filter((part) => part.length > 0)
    .join(' · ');
}

/**
 * The tiles of 屏幕稿 11: how many transactions go, and which way the ledger's net moves
 * when they do. The mockup's third tile — the target account's balance *after* the
 * rollback — has no counterpart in the API and is left out rather than guessed.
 */
function undoStats(
  batch: ImportBatch | ImportBatchListItem,
  deleteCount: number,
  t: TFunction,
): UndoStat[] {
  const rollback = negMoney(batch.net_amount);
  return [
    {
      key: 'deleted',
      label: t('import:committed.undo_stat_deleted'),
      value: t('import:committed.stat_value', { count: deleteCount }),
    },
    {
      key: 'rollback',
      label: t('import:committed.undo_stat_rollback'),
      // 屏幕稿 11 · 撤销确认 writes 「净额回滚 +1,204.60」 bare (§14.59a).
      value: signedPlain(rollback, batch.base_currency),
      tone: Number.parseFloat(rollback) < 0 ? 'expense' : 'income',
    },
  ];
}

/**
 * The amber cards. The two counters are NOT the same thing, so they never share a card,
 * and a zero counter contributes nothing at all (decision §14.52 B24).
 */
function undoWarnings(dry: ImportDeleteResult, t: TFunction): UndoWarning[] {
  const warnings: UndoWarning[] = [];
  if (dry.orphaned_refunds > 0) {
    warnings.push({
      key: 'orphaned',
      title: t('import:committed.undo_orphaned_refunds_title', { count: dry.orphaned_refunds }),
      body: t('import:committed.undo_orphaned_refunds', { count: dry.orphaned_refunds }),
    });
  }
  if (dry.refunds_in_batch > 0) {
    warnings.push({
      key: 'in_batch',
      title: t('import:committed.undo_refunds_in_batch_title', { count: dry.refunds_in_batch }),
      body: t('import:committed.undo_refunds_in_batch', { count: dry.refunds_in_batch }),
    });
  }
  return warnings;
}

/** Resolves `true` only when the batch was actually deleted. */
export async function undoImportBatch({
  remove,
  batch,
  t,
  lang,
  onDone,
}: UndoImportBatchOptions): Promise<boolean> {
  // Ask first: how much would this delete, and which refunds does it disturb?
  let dry: ImportDeleteResult;
  try {
    dry = await remove({ dry_run: true });
  } catch {
    return false;
  }

  const count = dry.would_delete_transactions ?? 0;
  const ok = await askUndo({
    title: t('import:committed.undo_confirm_title'),
    meta: undoMeta(batch, t, lang),
    stats: undoStats(batch, count, t),
    warnings: undoWarnings(dry, t),
    footNote: t('import:committed.undo_confirm_body', { count }),
    confirmLabel: t('import:committed.undo_confirm_action', { count }),
    confirmAgainLabel: t('common:button.confirm_again'),
    cancelLabel: t('import:committed.undo_cancel'),
    closeLabel: t('common:button.close'),
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
