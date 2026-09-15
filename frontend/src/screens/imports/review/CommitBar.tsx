/**
 * The submit bar and its blockers (04 §4.11.8).
 *
 * The button counts the rows that will actually become transactions (everything not
 * skipped) and says so; transfers that will merge into one transaction are called out
 * underneath. It is disabled while anything blocks the commit:
 *  - a row still has no level-1 category (the derived "uncategorized" of §4.11.4) — with a
 *    standing notice and a "jump to the first one" link;
 *  - a row that is going to be committed is missing something the server insists on
 *    (03 §5.43, 4a): a date, an amount, a zero amount, a currency or a kind;
 *  - every row is skipped, which the server answers 409 `rows_all_skipped` (03 §5.43, 3);
 *  - an inline edit is still failing to save — named by row, with its own jump link;
 *  - the batch is not fully loaded yet, so none of the counts above can be trusted.
 * Transfer rows never block: an unpaired one is committed as a single leg (decision §1.2).
 *
 * `POST .../commit` takes no request body at all (decision §14.18) and repeated submits are
 * the server's problem, not ours — a second one comes back 409 `batch_already_committed`
 * and the global error toast says so.
 */
import React from 'react';
import { Modal, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiClientError } from '@/api';
import type { ImportCommitResult, ImportRow } from '@/api/types';
import { cmpMoney } from '@/domain/money';
import { useCommitImport } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, ProgressBar, Text } from '@/ui';

import type { ReviewEnv } from './ReviewRow';
import { isCommittable, isUncategorized } from './useReviewSelection';

/**
 * The per-row commit refusals of 03 §5.43. The server states their row numbers in the
 * response body's `rows` (see below), so this set is only the fallback for a body that
 * arrived without one — the prose of `detail` is all there is then. Everything not listed
 * here either counts rows or talks about the batch as a whole.
 *
 * `not_found` is deliberately absent from the *fallback* only, because commit raises two
 * different 404s: `commit_checks.load_context`'s "Import batch not found", whose detail
 * names no row and whose digits belong to an id, and `commit_checks.load_counterpart`'s
 * "Counterpart account not found", which does name a row — but always carries it in the
 * body's `rows`, which is read before this set is ever consulted.
 */
const ROW_NUMBERED_CODES: ReadonlySet<string> = new Set([
  'pair_invalid',
  'refund_target_invalid',
  'category_invalid',
  'category_kind_mismatch',
  'repayment_target_not_credit',
  'same_source',
  'validation_error',
]);

/**
 * The row numbers a commit refusal carries. 03 §5.43 / 05 §4.3: the body is the standard
 * `{detail, code}` plus a `rows` array — `detail` itself holds no row number at all, so
 * this is the only thing that can point at the offending row.
 */
function rejectedRows(error: ApiClientError): number[] {
  const rows = (error.payload as { rows?: number[] } | undefined)?.rows;
  return Array.isArray(rows) ? rows.filter((n) => typeof n === 'number') : [];
}

export interface CommitBlockers {
  uncategorized: ImportRow[];
  incomplete: ImportRow[];
  /** The rows whose last inline edit is still refused (04 §4.11.5). */
  failed: ImportRow[];
  /** Every row is skipped, so the commit would create nothing (03 §5.43, 3). */
  allSkipped: boolean;
}

/** A row the server would refuse on 4a grounds: a missing or meaningless value. */
function isIncomplete(row: ImportRow): boolean {
  return (
    isCommittable(row) &&
    (row.date === null ||
      row.amount === null ||
      row.currency === null ||
      row.kind === null ||
      cmpMoney(row.amount, '0') === 0)
  );
}

export function commitBlockers(
  rows: readonly ImportRow[],
  failedRowIds: readonly string[],
): CommitBlockers {
  const failing = new Set(failedRowIds);
  return {
    uncategorized: rows.filter(isUncategorized),
    incomplete: rows.filter(isIncomplete),
    failed: rows.filter((row) => failing.has(row.id)),
    allSkipped: rows.length > 0 && rows.every((row) => !isCommittable(row)),
  };
}

export interface CommitBarProps {
  env: ReviewEnv;
  rows: readonly ImportRow[];
  /** Highlight and scroll to a row the user (or the server) has to look at. */
  onJumpTo(rowNo: number): void;
  onCommitted(result: ImportCommitResult): void;
  /** Incremented by `⌘/Ctrl + Enter` (04 §4.11.7); a blocked commit still does nothing. */
  submitSignal?: number;
  /**
   * How many of the batch's rows are not in `rows` yet. Nothing may be submitted while
   * this is above zero: every blocker below is counted over the rows at hand, and a
   * half-loaded batch would let a commit through that the server then refuses.
   */
  unloadedRows?: number;
  /**
   * The bulk strip of 屏幕稿 03's merged bottom bar: 「已选 5 / 10 行」 and the bulk actions
   * sit at the *left end of this very bar*, not on a second card above it. Wide puts it
   * beside the submit button; the phone stacks it above.
   */
  leading?: React.ReactNode;
  /** Render the contents only — the caller supplies the card (the merged bottom bar). */
  bare?: boolean;
  testID?: string;
}

export function CommitBar({
  env,
  rows,
  onJumpTo,
  onCommitted,
  submitSignal = 0,
  unloadedRows = 0,
  leading,
  bare = false,
  testID,
}: CommitBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const id = testID ?? 'review-commit';
  const commit = useCommitImport(env.ledgerId, env.batch.id);

  const blockers = commitBlockers(rows, env.ctrl.failedRowIds);
  const submitCount = rows.filter(isCommittable).length;
  const pairCount = rows.filter(
    (row) => row.kind === 'transfer' && row.matched_transaction_id !== null,
  ).length;
  const blocked =
    unloadedRows > 0 ||
    blockers.uncategorized.length > 0 ||
    blockers.incomplete.length > 0 ||
    blockers.failed.length > 0 ||
    blockers.allSkipped;

  // A ref, not `commit.isPending`: two clicks in the same tick both see the old render's
  // pending flag, and 04 §4.11.8 wants one commit per press, not one 409 per press.
  const inFlight = React.useRef(false);

  const onSubmit = React.useCallback((): void => {
    if (blocked || inFlight.current || commit.isPending) return;
    inFlight.current = true;
    void (async () => {
      try {
        const result = await commit.mutateAsync();
        onCommitted(result);
      } catch (error) {
        // The global toast already named the failure (04 §3.9); our job is to put the row
        // it complained about in front of the user (04 §4.11.8).
        if (!(error instanceof ApiClientError)) return;
        // The two batch-wide refusals count rows, they do not name one (03 §5.43, 3 & 4a):
        // "N row(s) still miss a date…" — reading N as a row number would scroll the user
        // to an unrelated row. Both are blockers we compute ourselves anyway, so jump to
        // the first row *we* know about — and to the body's `rows` below when we know of
        // none (a row edited in another tab).
        if (error.code === 'rows_uncategorized' && blockers.uncategorized.length > 0) {
          onJumpTo(blockers.uncategorized[0].row_no);
          return;
        }
        if (error.code === 'batch_not_ready' && blockers.incomplete.length > 0) {
          onJumpTo(blockers.incomplete[0].row_no);
          return;
        }
        // Everything else that names a row names it in the body (03 §5.43).
        const rejected = rejectedRows(error);
        if (rejected.length > 0) {
          onJumpTo(rejected[0]);
          return;
        }
        // Fallback only: a refusal that arrived without `rows` may still say the number
        // in its prose.
        if (!ROW_NUMBERED_CODES.has(error.code)) return;
        const hit = /\d+/.exec(error.detail);
        if (hit) onJumpTo(Number(hit[0]));
      } finally {
        inFlight.current = false;
      }
    })();
  }, [blocked, blockers.incomplete, blockers.uncategorized, commit, onCommitted, onJumpTo]);

  const submitRef = React.useRef(onSubmit);
  submitRef.current = onSubmit;
  const firstSignal = React.useRef(submitSignal);
  React.useEffect(() => {
    if (submitSignal === firstSignal.current) return;
    firstSignal.current = submitSignal;
    submitRef.current();
  }, [submitSignal]);


  const blockLines = (
    <>
      {blockers.incomplete.length > 0 ? (
        <Text variant="caption" tone="warning" testID={`${id}-block-incomplete`}>
          {t('import:review.block_incomplete', { count: blockers.incomplete.length })}
        </Text>
      ) : null}

      {blockers.allSkipped ? (
        <Text variant="caption" tone="warning" testID={`${id}-block-all-skipped`}>
          {t('import:review.block_all_skipped')}
        </Text>
      ) : null}

      {unloadedRows > 0 ? (
        <Text variant="caption" tone="warning" testID={`${id}-block-loading`}>
          {t('import:review.block_rows_loading', { rows: unloadedRows })}
        </Text>
      ) : null}

      {/* Which row failed to save, not just "something did" — the retry button lives on
          that row, and on a phone it is several screens away (04 §4.11.5). */}
      {blockers.failed.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: space['2'],
          }}
        >
          <Text
            variant="caption"
            tone="danger"
            style={{ flexShrink: 1 }}
            testID={`${id}-block-failed`}
          >
            {t('import:review.block_failed_saves', {
              rows: blockers.failed.length,
              row: blockers.failed[0].row_no,
            })}
          </Text>
          <Button
            testID={`${id}-jump-failed`}
            size="sm"
            variant="ghost"
            label={t('import:review.jump_to_first')}
            onPress={() => onJumpTo(blockers.failed[0].row_no)}
          />
        </View>
      ) : null}
    </>
  );

  const pairsHint =
    pairCount > 0 ? (
      <Text variant="micro" tone="muted" testID={`${id}-pairs`}>
        {t('import:review.submit_pairs_hint', { count: pairCount })}
      </Text>
    ) : null;

  /* 屏幕稿 03's bottom bar: what is still in the way, in grey, right beside the button it
     is disabling — the sand banner under the page header is where it is explained at
     length. 屏幕稿「03 导入 review 375」 has no room for that line beside a full-width
     button, so the phone puts the very same sentence on its own caption line directly
     above it. It is never nowhere: it is the only thing that explains a dead button, to a
     reader and to a screen reader alike. */
  const blockUncategorized =
    blockers.uncategorized.length > 0 ? (
      <Text variant={wide ? 'body' : 'caption'} tone="warning" testID={`${id}-block`}>
        {t('import:review.block_uncategorized_short', {
          count: blockers.uncategorized.length,
        })}
      </Text>
    ) : null;

  const submit = (
    <Button
      testID={`${id}-submit`}
      size="lg"
      style={wide ? undefined : { width: '100%' }}
      label={t('import:review.submit')}
      /* WCAG 2.5.3 (Label in Name): the accessible name has to start with the visible
         one, or 「点击 提交入账」 matches nothing. The count follows it, so a screen
         reader still hears how many rows are about to go in. */
      accessibilityLabel={`${t('import:review.submit')} · ${t('import:review.submit_button', {
        count: submitCount,
      })}`}
      disabled={blocked}
      loading={commit.isPending}
      onPress={onSubmit}
    />
  );

  /* The merged bottom bar of 屏幕稿 03: the bulk strip at the left end, the blocker and the
     submit button at the right. The phone stacks the same three, in the same order. */
  const bar = (
    <>
      {blockLines}
      {wide ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: space['3'],
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: space['1'] }}>
            {leading}
            {pairsHint}
          </View>
          {blockUncategorized}
          {submit}
        </View>
      ) : (
        <>
          {leading}
          {pairsHint}
          {blockUncategorized}
          {submit}
        </>
      )}
    </>
  );

  const overlay = (
    <Modal visible={commit.isPending} transparent animationType="fade">
      <View
        testID={`${id}-overlay`}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space['6'],
          backgroundColor: colors['bg.canvas'],
          opacity: 0.96,
        }}
      >
        <View
          style={{
            gap: space['3'],
            alignSelf: 'stretch',
            maxWidth: 360,
            padding: space['4'],
            borderRadius: radius.lg,
            backgroundColor: colors['bg.raised'],
          }}
        >
          <Text variant="body">{t('import:review.committing')}</Text>
          <ProgressBar value={0.6} accessibilityLabel={t('import:review.committing')} />
        </View>
      </View>
    </Modal>
  );

  // `bare` hands the bar's contents straight to the merged footer card the screen draws;
  // on its own it still wears a card, the way every other blocker strip does.
  if (bare) {
    return (
      <>
        {bar}
        {overlay}
      </>
    );
  }

  return (
    <Card variant="raised" testID={id} style={{ gap: space['2'] }}>
      {bar}
      {overlay}
    </Card>
  );
}
