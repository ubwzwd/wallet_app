/**
 * 屏幕稿 11 · 导入历史 — one batch, two shapes.
 *
 * Wide is a true table inside one white card: 文件 / 时间 · 状态 · 上传人 · 交易数量统计 ·
 * 净额 · 目标账户 / 备注 · 动作. A `ready` row is tinted warm the whole way across, because
 * it is the row that still has work on it.
 *
 * Narrow is a card per batch: the file name (mono) with its status badge, one grey meta
 * line, three stat pills, and — for a draft — the blocking reason right above the buttons.
 *
 * Both shapes name the same things with the same test ids (04 §8.5 case 8: uploader, net
 * amount, flag count, the pasted placeholder and the two status badges), so the behaviour
 * tests do not care which one is on screen. Everything here is presentation: the two
 * destructive actions are the caller's callbacks (the discard confirm and `undoBatch.ts`).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportBatchListItem } from '@/api/types';
import { type Lang } from '@/i18n';
import { formatBytes, formatDateTime, formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Badge, Button, Icon, Text } from '@/ui';

/** The mockup's seven columns; the two elastic ones carry text that can run long. */
export const HISTORY_COLUMNS = [
  { key: 'filename', flex: 1.1, minWidth: 150 },
  { key: 'status', width: 92 },
  { key: 'created_by', width: 104 },
  { key: 'row_count', width: 92, align: 'right' as const },
  { key: 'net_amount', width: 124, align: 'right' as const },
  { key: 'source', flex: 1, minWidth: 130 },
  { key: 'actions', width: 244, align: 'right' as const },
] as const;

/** Narrower than this and the seven columns stop being readable; the card scrolls instead. */
export const HISTORY_MIN_WIDTH = 1000;

export const historyGridRow = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: space['3'] + 2,
  paddingHorizontal: space['5'],
};

type HistoryColumn = (typeof HISTORY_COLUMNS)[number];

export function historyCellStyle(column: HistoryColumn): {
  width?: number;
  flexGrow?: number;
  flexShrink: number;
  flexBasis?: 0;
  minWidth: number;
  alignItems: 'flex-end' | 'stretch';
} {
  const width = 'width' in column ? column.width : undefined;
  const flex = 'flex' in column ? column.flex : undefined;
  return {
    width,
    flexGrow: flex,
    flexShrink: flex === undefined ? 0 : 1,
    flexBasis: flex === undefined ? undefined : 0,
    minWidth: 'minWidth' in column ? column.minWidth : 0,
    alignItems: 'align' in column ? 'flex-end' : 'stretch',
  };
}

export interface HistoryRowProps {
  batch: ImportBatchListItem;
  uploader: string;
  lang: Lang;
  /** Total of `flags_summary` — computed by the screen, which owns the helper. */
  totalFlags: number;
  busy: boolean;
  onContinue(): void;
  onDiscard(): void;
  onUndo(): void;
  onView(): void;
}

interface Parts {
  id: string;
  filename: string;
  size: string;
  pasted: boolean;
  ready: boolean;
  time: string;
  net: string;
  negative: boolean;
  count: string;
  note: string;
  flags: string;
}

/** Everything both shapes need out of one batch — computed once, in one place. */
function useParts(batch: ImportBatchListItem, lang: Lang, totalFlags: number): Parts {
  const { t } = useTranslation();
  const pasted = batch.source === 'paste';
  return {
    id: `import-batch-${batch.id}`,
    filename: pasted ? t('import:history.pasted_filename') : (batch.filename ?? ''),
    size: formatBytes(batch.size_bytes),
    pasted,
    ready: batch.status === 'ready',
    // The mockup drops the year: a history row is read against "this month", not 2026.
    time: formatDateTime(batch.created_at, lang).slice(5),
    net: formatMoney(batch.net_amount, batch.base_currency, lang, { signDisplay: 'always' }),
    negative: Number(batch.net_amount) < 0,
    count: t('import:history.count_value', { count: batch.row_count }),
    note:
      batch.uncategorized_count > 0
        ? t('import:history.uncategorized_note', { count: batch.uncategorized_count })
        : t('import:history.note_none'),
    flags: t('import:history.flags_value', { n: totalFlags }),
  };
}

/** The tinted well the mockup puts the file glyph in — warm for a draft, green once in. */
function FileWell({ ready }: { ready: boolean }): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      style={[
        styles.well,
        { backgroundColor: colors[ready ? 'status.warning.bg' : 'status.success.bg'] },
      ]}
    >
      <Icon
        name="list"
        size={18}
        color={colors[ready ? 'status.warning.fg' : 'status.success.fg']}
      />
    </View>
  );
}

/** The round initial + display name of 屏幕稿 11's 上传人 column. */
function Uploader({ name, testID }: { name: string; testID: string }): React.JSX.Element {
  const colors = useColors();
  return (
    <View style={styles.uploader}>
      <View style={[styles.initial, { backgroundColor: colors['bg.subtle'] }]}>
        <Text variant="micro" weight={600} tone="secondary">
          {name.slice(0, 1)}
        </Text>
      </View>
      <Text variant="body" numberOfLines={1} style={styles.grow} testID={testID}>
        {name}
      </Text>
    </View>
  );
}

/** 「粘贴」 badge or the file size — the mockup's second half of the file cell. */
function FileTag({ parts }: { parts: Parts }): React.JSX.Element {
  const { t } = useTranslation();
  return parts.pasted ? (
    <Badge label={t('import:history.pasted_badge')} tone="info" testID={`${parts.id}-paste-badge`} />
  ) : (
    <Text variant="micro" tone="muted" mono testID={`${parts.id}-size`}>
      {parts.size}
    </Text>
  );
}

function StatusBadge({ parts, status }: { parts: Parts; status: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Badge
      label={t(`import:history.status.${status}`)}
      tone={parts.ready ? 'warning' : 'success'}
      testID={`${parts.id}-status`}
    />
  );
}

/** The wide table's row. */
export function HistoryTableRow(props: HistoryRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const p = useParts(props.batch, props.lang, props.totalFlags);

  const cells: Record<string, React.ReactNode> = {
    filename: (
      <View style={styles.fileCell}>
        <FileWell ready={p.ready} />
        <View style={styles.grow}>
          <Text
            variant="body"
            mono
            weight={500}
            numberOfLines={1}
            testID={`${p.id}-filename`}
          >
            {p.filename}
          </Text>
          <View style={styles.fileLine}>
            <Text variant="caption" tone="muted" mono testID={`${p.id}-created-at`}>
              {p.time}
            </Text>
            <FileTag parts={p} />
          </View>
        </View>
      </View>
    ),
    status: <StatusBadge parts={p} status={props.batch.status} />,
    created_by: <Uploader name={props.uploader} testID={`${p.id}-uploader`} />,
    row_count: (
      <Text variant="subheading" mono weight={500} testID={`${p.id}-rows`}>
        {p.count}
      </Text>
    ),
    net_amount: (
      <Text
        variant="subheading"
        mono
        weight={500}
        tone={p.negative ? 'expense' : 'income'}
        testID={`${p.id}-net`}
      >
        {p.net}
      </Text>
    ),
    source: (
      <View style={styles.grow}>
        <Text variant="body" numberOfLines={1} testID={`${p.id}-source`}>
          {props.batch.source_name}
        </Text>
        <View style={styles.noteLine}>
          <Text
            variant="caption"
            tone={props.batch.uncategorized_count > 0 ? 'warning' : 'muted'}
            numberOfLines={1}
            style={styles.shrink}
          >
            {p.note}
          </Text>
          <Text variant="caption" tone="muted" mono testID={`${p.id}-flags`}>
            {p.flags}
          </Text>
        </View>
      </View>
    ),
    actions: (
      <View style={styles.rowActions}>
        {p.ready ? (
          <>
            <Button
              testID={`${p.id}-continue`}
              label={t('import:history.continue_review')}
              size="sm"
              onPress={props.onContinue}
            />
            <Button
              testID={`${p.id}-discard`}
              label={t('import:history.discard')}
              variant="ghost"
              size="sm"
              loading={props.busy}
              onPress={props.onDiscard}
            />
          </>
        ) : (
          <>
            <Button
              testID={`${p.id}-undo`}
              label={t('import:history.undo_batch')}
              icon="undo-2"
              variant="danger"
              size="sm"
              loading={props.busy}
              onPress={props.onUndo}
            />
            <Button
              testID={`${p.id}-view`}
              label={t('import:history.view_transactions_short')}
              variant="soft"
              size="sm"
              onPress={props.onView}
            />
          </>
        )}
      </View>
    ),
  };

  // Not a pressable row: every action on a batch is one of the buttons in the last cell,
  // and a button inside a button is neither valid DOM nor reachable by a screen reader.
  return (
    <View
      testID={p.id}
      style={[
        historyGridRow,
        styles.tableRow,
        {
          backgroundColor: p.ready ? colors['status.warning.bg'] : 'transparent',
        },
      ]}
    >
      {HISTORY_COLUMNS.map((column) => (
        <View key={column.key} style={historyCellStyle(column)}>
          {cells[column.key]}
        </View>
      ))}
    </View>
  );
}

interface PillProps {
  label: string;
  value: string;
  tone: 'primary' | 'expense' | 'income';
  testID: string;
}

function Pill({ label, value, tone, testID }: PillProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View style={[styles.pill, { backgroundColor: colors['bg.canvas'] }]}>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      <Text variant="caption" mono weight={500} tone={tone} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

/** The narrow card. */
export function HistoryCard(props: HistoryRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const p = useParts(props.batch, props.lang, props.totalFlags);

  return (
    <View testID={p.id} style={[styles.card, { backgroundColor: colors['bg.surface'] }]}>
      <View style={styles.cardHead}>
        <FileWell ready={p.ready} />
        <View style={styles.grow}>
          <View style={styles.fileLine}>
            <Text
              variant="subheading"
              mono
              weight={500}
              numberOfLines={1}
              style={styles.shrink}
              testID={`${p.id}-filename`}
            >
              {p.filename}
            </Text>
            <FileTag parts={p} />
          </View>
          <View style={styles.metaLine}>
            <Text variant="caption" tone="muted" mono testID={`${p.id}-created-at`}>
              {p.time}
            </Text>
            <Text variant="caption" tone="muted">
              ·
            </Text>
            <Text
              variant="caption"
              tone="muted"
              numberOfLines={1}
              style={styles.shrink}
              testID={`${p.id}-source`}
            >
              {props.batch.source_name}
            </Text>
            <Text variant="caption" tone="muted">
              ·
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} testID={`${p.id}-uploader`}>
              {props.uploader}
            </Text>
          </View>
        </View>
        <StatusBadge parts={p} status={props.batch.status} />
      </View>

      <View style={styles.pills}>
        <Pill
          label={t('import:history.stat_count')}
          value={p.count}
          tone="primary"
          testID={`${p.id}-rows`}
        />
        <Pill
          label={t('import:history.stat_net')}
          value={p.net}
          tone={p.negative ? 'expense' : 'income'}
          testID={`${p.id}-net`}
        />
        <Pill
          label={t('import:history.column.flags')}
          value={p.flags}
          tone="primary"
          testID={`${p.id}-flags`}
        />
      </View>

      <View style={[styles.rule, { borderTopColor: colors['border.default'] }]} />

      {p.ready && props.batch.uncategorized_count > 0 ? (
        <View style={styles.blocker}>
          <Icon name="alert-triangle" size={16} color={colors['status.warning.fg']} />
          <Text variant="caption" tone="warning" style={styles.grow}>
            {t('import:history.ready_hint', { count: props.batch.uncategorized_count })}
          </Text>
        </View>
      ) : null}

      <View style={styles.cardActions}>
        {p.ready ? (
          <>
            <Button
              testID={`${p.id}-discard`}
              label={t('import:history.discard_batch')}
              variant="ghost"
              loading={props.busy}
              onPress={props.onDiscard}
              style={styles.grow}
            />
            <Button
              testID={`${p.id}-continue`}
              label={t('import:history.continue_review')}
              onPress={props.onContinue}
              style={styles.growMore}
            />
          </>
        ) : (
          <>
            <Button
              testID={`${p.id}-undo`}
              label={t('import:history.undo_batch')}
              icon="undo-2"
              variant="danger"
              loading={props.busy}
              onPress={props.onUndo}
              style={styles.grow}
            />
            <Button
              testID={`${p.id}-view`}
              label={t('import:history.view_transactions')}
              variant="soft"
              onPress={props.onView}
              style={styles.grow}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tableRow: { minHeight: 60, paddingVertical: space['2'] + 2 },
  fileCell: { flexDirection: 'row', alignItems: 'center', gap: space['3'], minWidth: 0 },
  fileLine: { flexDirection: 'row', alignItems: 'center', gap: space['2'], minWidth: 0 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space['2'] - 2, minWidth: 0 },
  grow: { flex: 1, minWidth: 0 },
  growMore: { flex: 1.6, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  well: {
    width: 34,
    height: 34,
    borderRadius: radius.md - 3,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  uploader: { flexDirection: 'row', alignItems: 'center', gap: space['2'], minWidth: 0 },
  initial: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  noteLine: { flexDirection: 'row', alignItems: 'baseline', gap: space['2'], minWidth: 0 },
  rowActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space['2'] },
  card: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space['4'], gap: space['3'] },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space['3'] },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'] - 3,
    minHeight: 28,
    paddingHorizontal: space['3'] - 2,
    borderRadius: radius.sm,
  },
  rule: { borderTopWidth: 1 },
  blocker: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
  cardActions: { flexDirection: 'row', gap: space['2'] + 2 },
});
