/**
 * The submit bar and its blockers (04 §4.11.8).
 *
 * The button counts the rows that will actually become transactions (everything not
 * skipped) and says so; transfers that will merge into one transaction are called out
 * underneath. It is disabled while anything blocks the commit:
 *  - a row still has no level-1 category (the derived "uncategorized" of §4.11.4) — with a
 *    standing notice and a "jump to the first one" link;
 *  - a row that is going to be committed has no date or no amount;
 *  - an inline edit is still failing to save.
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
import { useCommitImport } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Card, ProgressBar, Text } from '@/ui';

import type { ReviewEnv } from './ReviewRow';
import { isCommittable, isUncategorized } from './useReviewSelection';

export interface CommitBlockers {
  uncategorized: ImportRow[];
  incomplete: ImportRow[];
  failures: boolean;
}

export function commitBlockers(rows: readonly ImportRow[], hasFailures: boolean): CommitBlockers {
  return {
    uncategorized: rows.filter(isUncategorized),
    incomplete: rows.filter(
      (row) => isCommittable(row) && (row.date === null || row.amount === null),
    ),
    failures: hasFailures,
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
  testID?: string;
}

export function CommitBar({
  env,
  rows,
  onJumpTo,
  onCommitted,
  submitSignal = 0,
  testID,
}: CommitBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'review-commit';
  const commit = useCommitImport(env.ledgerId, env.batch.id);

  const blockers = commitBlockers(rows, env.ctrl.hasFailures);
  const submitCount = rows.filter(isCommittable).length;
  const pairCount = rows.filter(
    (row) => row.kind === 'transfer' && row.matched_transaction_id !== null,
  ).length;
  const blocked =
    blockers.uncategorized.length > 0 || blockers.incomplete.length > 0 || blockers.failures;

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
        if (error.code === 'rows_uncategorized' && blockers.uncategorized.length > 0) {
          onJumpTo(blockers.uncategorized[0].row_no);
          return;
        }
        const hit = /\d+/.exec(error.detail);
        if (hit) onJumpTo(Number(hit[0]));
      } finally {
        inFlight.current = false;
      }
    })();
  }, [blocked, blockers.uncategorized, commit, onCommitted, onJumpTo]);

  const submitRef = React.useRef(onSubmit);
  submitRef.current = onSubmit;
  const firstSignal = React.useRef(submitSignal);
  React.useEffect(() => {
    if (submitSignal === firstSignal.current) return;
    firstSignal.current = submitSignal;
    submitRef.current();
  }, [submitSignal]);

  return (
    <Card variant="outlined" testID={id} style={{ gap: space['2'] }}>
      {blockers.uncategorized.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: space['2'],
          }}
        >
          <Text variant="caption" tone="warning" style={{ flexShrink: 1 }} testID={`${id}-block`}>
            {t('import:review.block_uncategorized', { count: blockers.uncategorized.length })}
          </Text>
          <Button
            testID={`${id}-jump`}
            size="sm"
            variant="ghost"
            label={t('import:review.jump_to_first')}
            onPress={() => onJumpTo(blockers.uncategorized[0].row_no)}
          />
        </View>
      ) : null}

      {blockers.incomplete.length > 0 ? (
        <Text variant="caption" tone="warning" testID={`${id}-block-incomplete`}>
          {t('import:review.block_incomplete', { count: blockers.incomplete.length })}
        </Text>
      ) : null}

      {blockers.failures ? (
        <Text variant="caption" tone="danger" testID={`${id}-block-failed`}>
          {t('import:review.block_failed_saves')}
        </Text>
      ) : null}

      <View
        style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] }}
      >
        <View style={{ flex: 1, gap: space['1'] }}>
          {pairCount > 0 ? (
            <Text variant="micro" tone="muted" testID={`${id}-pairs`}>
              {t('import:review.submit_pairs_hint', { count: pairCount })}
            </Text>
          ) : null}
        </View>
        <Button
          testID={`${id}-submit`}
          label={t('import:review.submit_button', { count: submitCount })}
          disabled={blocked}
          loading={commit.isPending}
          onPress={onSubmit}
        />
      </View>

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
    </Card>
  );
}
