/**
 * 「这一笔」 — the read-back column of mockups 04 / 05 and, on a narrow screen, the save bar
 * pinned to the bottom of mockups 04 / 05 / 06.
 *
 * It restates what is about to be saved (04 §4.6: two people share one ledger, so the
 * kind / account / category / author line is cheaper to read now than to fix later), and
 * it owns the save buttons, the local stats preview (decision §14.52 A9) and the keyboard
 * hint. It reads nothing itself: every value arrives as a prop.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Text, raisedShadow } from '@/ui';

import { FormCard } from './parts';

export interface SummaryRow {
  label: string;
  /** A string is rendered as the mockup's 13/500 value; a node carries a badge. */
  value: React.ReactNode;
  mono?: boolean;
}

export interface SummaryCardProps {
  title: string;
  /** The headline: one big amount, or the two legs of a transfer. */
  headline?: React.ReactNode;
  rows: readonly SummaryRow[];
  /** The amber note of mockup 05 单腿, under the rows. */
  note?: React.ReactNode;
  /** 「本月餐饮 ¥1,240 → ¥1,278」. */
  preview?: React.ReactNode;
  submitLabel: string;
  onSubmit(): void;
  submitting: boolean;
  submitDisabled: boolean;
  saveAgainLabel?: string;
  /** The bottom bar has room for 「再记一笔」, not the full 「保存并再记一笔」. */
  saveAgainShortLabel?: string;
  onSaveAgain?(): void;
  /** ⌘↵ 保存 · ⌘⇧↵ 保存并继续 — wide only, where a keyboard is assumed. */
  shortcutHint: string;
  testID?: string;
}

export function SummaryCard({
  title,
  headline,
  rows,
  note,
  preview,
  submitLabel,
  onSubmit,
  submitting,
  submitDisabled,
  saveAgainLabel,
  saveAgainShortLabel,
  onSaveAgain,
  shortcutHint,
  testID,
}: SummaryCardProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const wide = useIsWide();
  const id = testID ?? 'tx-summary';

  if (!wide) {
    return (
      <View
        testID={id}
        style={[
          styles.bar,
          raisedShadow(colors, scheme),
          { backgroundColor: colors['bg.raised'], borderTopColor: colors['border.default'] },
        ]}
      >
        {preview !== undefined && preview !== null ? (
          <View style={styles.barPreview}>{preview}</View>
        ) : null}
        <View style={styles.barRow}>
          {onSaveAgain && saveAgainLabel !== undefined ? (
            <Button
              testID="tx-submit-again"
              variant="soft"
              size="lg"
              label={saveAgainShortLabel ?? saveAgainLabel}
              onPress={onSaveAgain}
              disabled={submitting || submitDisabled}
              style={styles.barAgain}
            />
          ) : null}
          <Button
            testID="tx-submit"
            size="lg"
            label={submitLabel}
            onPress={onSubmit}
            loading={submitting}
            disabled={submitting || submitDisabled}
            style={styles.barSave}
          />
        </View>
      </View>
    );
  }

  return (
    <FormCard testID={id} style={styles.card}>
      <Text variant="body" weight={700}>
        {title}
      </Text>
      {headline}
      <View style={styles.rows}>
        {rows.map((row, i) => (
          <View
            key={row.label}
            testID={`${id}-row-${i}`}
            style={[
              styles.row,
              i < rows.length - 1
                ? { borderBottomWidth: 1, borderBottomColor: colors['border.default'] }
                : null,
            ]}
          >
            <Text variant="caption" tone="secondary" style={styles.rowLabel}>
              {row.label}
            </Text>
            {typeof row.value === 'string' ? (
              <Text
                variant="caption"
                weight={row.mono ? 450 : 500}
                mono={row.mono}
                numberOfLines={1}
                style={styles.rowValue}
              >
                {row.value}
              </Text>
            ) : (
              row.value
            )}
          </View>
        ))}
      </View>
      {note}
      <Button
        testID="tx-submit"
        size="lg"
        fullWidth
        label={submitLabel}
        onPress={onSubmit}
        loading={submitting}
        disabled={submitting || submitDisabled}
      />
      {onSaveAgain && saveAgainLabel !== undefined ? (
        <Button
          testID="tx-submit-again"
          variant="soft"
          fullWidth
          label={saveAgainLabel}
          onPress={onSaveAgain}
          disabled={submitting || submitDisabled}
        />
      ) : null}
      {preview}
      <Text variant="caption" tone="muted">
        {shortcutHint}
      </Text>
    </FormCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: space['3'] + 2 },
  rows: { alignSelf: 'stretch' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['3'],
    paddingVertical: space['2'] + 1,
  },
  rowLabel: { flexShrink: 0 },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  bar: {
    alignSelf: 'stretch',
    borderTopWidth: 1,
    paddingHorizontal: space['4'],
    paddingTop: space['3'],
    paddingBottom: space['4'],
    gap: space['2'],
  },
  barPreview: { paddingHorizontal: space['1'] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space['2'] + 2 },
  barAgain: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  barSave: { flexGrow: 1.6, flexShrink: 1, flexBasis: 0 },
});
