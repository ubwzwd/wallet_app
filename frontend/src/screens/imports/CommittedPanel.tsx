/**
 * Step 3 of the import flow (04 §4.10): the batch is committed.
 *
 * A white card in the language of 屏幕稿 11 — the green 「已提交」 badge and the file name on a
 * tinted strip, a row of mono stats, the sentence that reads them back, and the three ways
 * on: 查看这批交易 / 再导一份 / 撤销这批导入.
 *
 * Which stats depends on what the screen knows. Straight after a commit it has the commit
 * response and shows all five of its counters. A page opened later — a link, a refresh —
 * has only the batch, and `ImportBatch` carries no commit counters (03 §5.38), so it shows
 * the three the batch *does* answer for (rows booked, rows skipped, net) rather than
 * inventing the pairing and refund numbers, and the sentence below says the shorter thing.
 *
 * Those three are *row* counts, and say so: 「入账行」, not 「建立交易」. A commit creates one
 * transaction per bookable row plus a second leg for every brand-new two-leg transfer
 * (03 §5.37), so `row_count - skipped` is not the number of transactions and must not
 * borrow the label the commit response's true counter uses.
 *
 * Undoing is `undoBatch.ts` — the flow the history list runs, to the letter. Afterwards the
 * batch is gone from the history altogether (decision §14.22), so the caller decides where
 * to go next.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportBatch, ImportCommitResult } from '@/api/types';
import { useLang } from '@/i18n';
import { formatDateTime } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Badge, Button, ListCard, Text } from '@/ui';

import { signedPlain } from './amountFormat';

export interface CommittedPanelProps {
  batch: ImportBatch;
  result: ImportCommitResult | null;
  onViewTransactions(): void;
  onImportAnother(): void;
  onUndo(): void;
  undoing?: boolean;
  testID?: string;
}

/** One 「建立交易 121 笔」 stat pill. */
function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  const colors = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: colors['bg.canvas'] }]}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="subheading" mono weight={500}>
        {value}
      </Text>
    </View>
  );
}

export function CommittedPanel({
  batch,
  result,
  onViewTransactions,
  onImportAnother,
  onUndo,
  undoing = false,
  testID = 'import-committed',
}: CommittedPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const wide = useIsWide();
  const count = (n: number): string => t('import:committed.stat_value', { count: n });
  const rows = (n: number): string => t('import:committed.stat_rows_value', { count: n });

  const filename =
    batch.source === 'paste' ? t('import:history.pasted_filename') : (batch.filename ?? '');
  const when = batch.committed_at ?? batch.created_at;

  // Rows the review marked 「跳过」 are exactly the rows a commit does not create.
  const skipped = batch.row_status_summary.skipped ?? 0;
  const stats: Array<[string, string]> = result
    ? [
        [t('import:committed.stat_created'), count(result.created_transactions)],
        [t('import:committed.stat_pairs'), count(result.created_transfer_pairs)],
        [t('import:committed.stat_paired'), count(result.paired_existing_transfers)],
        [t('import:committed.stat_refunds'), count(result.linked_refunds)],
        [t('import:committed.stat_skipped'), count(result.skipped_rows)],
      ]
    : [
        [t('import:committed.stat_rows_booked'), rows(Math.max(0, batch.row_count - skipped))],
        [t('import:committed.stat_skipped'), rows(skipped)],
        [
          t('import:history.stat_net'),
          signedPlain(batch.net_amount, batch.base_currency),
        ],
      ];

  return (
    <ListCard
      testID={testID}
      header={
        <View style={[styles.strip, { backgroundColor: colors['bg.canvas'] }]}>
          <Badge label={t('import:committed.title')} tone="success" size="lg" />
          <View style={styles.stripText}>
            <Text variant="subheading" mono weight={500} numberOfLines={1}>
              {filename}
            </Text>
            <Text variant="caption" tone="muted" mono numberOfLines={1}>
              {`${batch.source_name} · ${formatDateTime(when, lang)}`}
            </Text>
          </View>
        </View>
      }
    >
      <View style={styles.body}>
        {stats.length > 0 ? (
          <View style={styles.stats} testID={`${testID}-stats`}>
            {stats.map(([label, value]) => (
              <Stat key={label} label={label} value={value} />
            ))}
          </View>
        ) : null}
        <Text variant="caption" tone="muted" testID={`${testID}-summary`}>
          {result
            ? t('import:committed.summary', {
                created: result.created_transactions,
                pairs: result.created_transfer_pairs,
                paired: result.paired_existing_transfers,
                refunds: result.linked_refunds,
                skipped: result.skipped_rows,
              })
            : t('import:committed.summary_fallback', { rows: batch.row_count })}
        </Text>
        <View style={styles.actions}>
          <Button
            testID={`${testID}-view`}
            label={t('import:committed.view_transactions')}
            onPress={onViewTransactions}
            fullWidth={!wide}
          />
          <Button
            testID={`${testID}-again`}
            variant="soft"
            label={t('import:committed.import_another')}
            onPress={onImportAnother}
            fullWidth={!wide}
          />
          <Button
            testID={`${testID}-undo`}
            variant="danger"
            icon="undo-2"
            label={t('import:committed.undo')}
            loading={undoing}
            onPress={onUndo}
            fullWidth={!wide}
          />
        </View>
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['5'],
    paddingVertical: space['4'],
  },
  stripText: { flex: 1, minWidth: 0 },
  body: { padding: space['5'], gap: space['4'] },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  stat: {
    minWidth: 120,
    gap: 2,
    paddingHorizontal: space['3'] + 2,
    paddingVertical: space['2'] + 2,
    borderRadius: radius.md,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
});

export default CommittedPanel;
