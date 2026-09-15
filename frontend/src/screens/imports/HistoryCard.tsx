/**
 * 屏幕稿 11 · 导入历史, narrow — one card per batch: the file name (mono) with its status
 * badge, one grey meta line (time · 目标账户 · 上传人), three stat pills, and — for a draft —
 * the blocking reason right above the two buttons.
 *
 * Every shared piece (`useParts`, the file well, the badges, the three layout rules) comes
 * from `HistoryRows.tsx`, so both shapes name the same things with the same test ids and
 * the behaviour tests of 04 §8.5 do not care which one is on screen.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Icon, Text } from '@/ui';

import {
  FileTag,
  FileWell,
  type HistoryRowProps,
  StatusBadge,
  historyShared,
  useParts,
} from './HistoryRows';

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
        <View style={historyShared.grow}>
          <View style={historyShared.fileLine}>
            <Text
              variant="subheading"
              mono
              weight={500}
              numberOfLines={1}
              style={historyShared.shrink}
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
              style={historyShared.shrink}
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
          <Text variant="caption" tone="warning" style={historyShared.grow}>
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
              style={historyShared.grow}
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
              style={historyShared.grow}
            />
            <Button
              testID={`${p.id}-view`}
              label={t('import:history.view_transactions')}
              variant="soft"
              onPress={props.onView}
              style={historyShared.grow}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  growMore: { flex: 1.6, minWidth: 0 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space['2'] - 2, minWidth: 0 },
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
