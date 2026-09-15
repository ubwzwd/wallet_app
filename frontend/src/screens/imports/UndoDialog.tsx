/**
 * 屏幕稿 11 · 撤销确认 — the undo confirmation, which is not a generic `ConfirmDialog`.
 *
 * The mockup asks for a *wide* dialog that lays the consequences out instead of wrapping
 * them into one paragraph: a round undo well beside the title and the mono batch line,
 * a row of stat tiles, one warm card per refund counter, and a foot strip whose danger
 * button names the count («撤销 11 笔»). `ConfirmDialog` only takes a string body and is
 * shared by every other destructive flow, so this screen brings its own dialog rather
 * than bending the library one out of shape.
 *
 * The imperative store behind it — `askUndo()` and the pending-dialog bookkeeping — lives
 * in `undoDialogStore.ts`; this file is the view.
 *
 * It answers to the same test ids as `ConfirmHost` (`confirm-dialog` / `confirm-accept` /
 * `confirm-cancel` / `confirm-meta`) because to everything outside it *is* the
 * confirmation dialog of this flow, and only ever one of the two is on screen — the other
 * host renders `null` while nothing is pending.
 *
 * Two things the mockup shows are not in the product's data and are deliberately absent:
 * the 「余额回到」 tile (the account balance after the rollback, which no endpoint predicts)
 * and the 「受影响的退款」 rows (`DELETE ?dry_run=true` answers with counters only, 03 §5.44).
 * The counters they summarise are all here.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Icon, Text } from '@/ui';

import {
  askUndo,
  getPendingUndo,
  settleUndo,
  subscribeUndo,
  type UndoDialogData,
  type UndoStat,
  type UndoWarning,
} from './undoDialogStore';

export { askUndo };
export type { UndoDialogData, UndoStat, UndoWarning };

/** The mockup's dialog is 660 wide on 1440; narrow gets a bottom sheet instead. */
const DIALOG_MAX_WIDTH = 660;

function StatTile({ stat, wide }: { stat: UndoStat; wide: boolean }): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID={`undo-dialog-stat-${stat.key}`}
      style={[
        wide ? styles.tileWide : styles.tileNarrow,
        { backgroundColor: colors['bg.canvas'] },
      ]}
    >
      <Text variant="caption" tone="muted">
        {stat.label}
      </Text>
      <Text
        variant={wide ? 'title' : 'subheading'}
        mono
        weight={500}
        tone={stat.tone ?? 'primary'}
        testID={`undo-dialog-stat-${stat.key}-value`}
      >
        {stat.value}
      </Text>
    </View>
  );
}

function WarningCard({ warning }: { warning: UndoWarning }): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID={`undo-dialog-warning-${warning.key}`}
      style={[styles.warning, { backgroundColor: colors['status.warning.bg'] }]}
    >
      <Icon name="alert-triangle" size={18} color={colors['status.warning.fg']} />
      <View style={styles.warningText}>
        <Text variant="subheading" weight={700}>
          {warning.title}
        </Text>
        <Text variant="body" tone="warning">
          {warning.body}
        </Text>
      </View>
    </View>
  );
}

export function UndoDialogHost(): React.JSX.Element | null {
  const current = React.useSyncExternalStore(subscribeUndo, getPendingUndo, getPendingUndo);
  const colors = useColors();
  const wide = useIsWide();
  const [armed, setArmed] = React.useState(false);

  const id = current?.id;
  React.useEffect(() => {
    setArmed(false);
  }, [id]);

  // Unlike `ConfirmHost`, which is mounted once for the whole app, this host lives on the
  // two screens that can undo. If one of them goes away with the dialog open (browser back,
  // a deep link, any router replace), nothing else would ever resolve the promise:
  // `undoImportBatch` would wait forever and the next screen would inherit a stale dialog
  // that still deletes the batch the user already left. Leaving cancels whatever is pending.
  React.useEffect(
    () => () => {
      if (getPendingUndo() !== null) settleUndo(false);
    },
    [],
  );

  if (!current) return null;
  const d = current.data;

  const onConfirm = (): void => {
    // The double tap of decision §14.52 B24: the first press only arms the button.
    if (!armed) {
      setArmed(true);
      return;
    }
    settleUndo(true);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => settleUndo(false)}>
      <View style={[wide ? styles.rootWide : styles.rootNarrow, { zIndex: z.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.closeLabel}
          onPress={() => settleUndo(false)}
          testID="confirm-backdrop"
          style={[styles.backdrop, { backgroundColor: colors['fg.primary'], opacity: 0.3 }]}
        />
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          testID="confirm-dialog"
          style={[
            wide ? styles.dialogWide : styles.dialogNarrow,
            { backgroundColor: colors['bg.raised'] },
          ]}
        >
          {wide ? null : (
            <View style={styles.handleRow}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[styles.handle, { backgroundColor: colors['border.strong'] }]}
              />
            </View>
          )}
          <View style={[styles.head, { borderBottomColor: colors['border.default'] }]}>
            <View
              style={[
                styles.well,
                {
                  width: wide ? 44 : 40,
                  height: wide ? 44 : 40,
                  backgroundColor: colors['status.danger.bg'],
                },
              ]}
            >
              <Icon name="undo-2" size={20} color={colors['status.danger.fg']} />
            </View>
            <View style={styles.headText}>
              <Text variant={wide ? 'heading' : 'subheading'} weight={700}>
                {d.title}
              </Text>
              {d.meta === undefined ? null : (
                <Text variant="caption" tone="muted" mono testID="confirm-meta">
                  {d.meta}
                </Text>
              )}
            </View>
            {wide ? (
              <Button
                variant="soft"
                size="sm"
                icon="x"
                iconOnly
                accessibilityLabel={d.closeLabel}
                onPress={() => settleUndo(false)}
                testID="confirm-close"
              />
            ) : null}
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            {d.stats.length === 0 ? null : (
              <View style={wide ? styles.statsWide : styles.statsNarrow} testID="undo-dialog-stats">
                {d.stats.map((stat) => (
                  <StatTile key={stat.key} stat={stat} wide={wide} />
                ))}
              </View>
            )}
            {d.warnings.map((warning) => (
              <WarningCard key={warning.key} warning={warning} />
            ))}
            {/* 屏幕稿 11's sheet spends its whole foot on the two buttons, so on a phone the
                sentence goes above them instead of beside them. */}
            {wide ? null : (
              <Text variant="caption" tone="muted" testID="confirm-note">
                {d.footNote}
              </Text>
            )}
          </ScrollView>

          <View
            style={[
              wide ? styles.foot : styles.footNarrow,
              // 屏幕稿 11 · 1440 greys the foot band off (bg.surface) against the dialog's own
              // white; the 375 sheet keeps the white and rules it off with the hairline only.
              {
                backgroundColor: wide ? colors['bg.surface'] : colors['bg.raised'],
                borderTopColor: colors['border.default'],
              },
            ]}
          >
            {wide ? (
              <Text
                variant="caption"
                tone="muted"
                style={styles.footNote}
                testID="confirm-note"
              >
                {d.footNote}
              </Text>
            ) : null}
            <View style={wide ? styles.footActions : styles.footCell}>
              <Button
                label={d.cancelLabel}
                variant="soft"
                fullWidth={!wide}
                onPress={() => settleUndo(false)}
                testID="confirm-cancel"
              />
              {wide ? (
                <Button
                  label={armed ? d.confirmAgainLabel : d.confirmLabel}
                  variant="danger"
                  onPress={onConfirm}
                  testID="confirm-accept"
                />
              ) : null}
            </View>
            {wide ? null : (
              <View style={styles.footCellWide}>
                <Button
                  label={armed ? d.confirmAgainLabel : d.confirmLabel}
                  variant="danger"
                  fullWidth
                  onPress={onConfirm}
                  testID="confirm-accept"
                />
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rootWide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space['5'] },
  rootNarrow: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  dialogWide: {
    width: '100%',
    maxWidth: DIALOG_MAX_WIDTH,
    maxHeight: '92%',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  dialogNarrow: {
    width: '100%',
    maxHeight: '90%',
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    overflow: 'hidden',
  },
  handleRow: { alignItems: 'center', paddingTop: space['3'], paddingBottom: space['1'] },
  handle: { width: 38, height: 4, borderRadius: radius.pill },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space['3'] + 2,
    paddingHorizontal: space['6'],
    paddingTop: space['5'],
    paddingBottom: space['4'],
    borderBottomWidth: 1,
  },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  well: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: space['6'], paddingTop: space['4'], gap: space['3'] - 2 },
  statsWide: { flexDirection: 'row', gap: space['3'] },
  statsNarrow: { gap: space['2'] },
  tileWide: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingHorizontal: space['4'],
    paddingVertical: space['3'] + 2,
    borderRadius: radius.md,
  },
  tileNarrow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['3'],
    paddingHorizontal: space['3'] + 2,
    paddingVertical: space['3'],
    borderRadius: radius.md,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space['3'],
    padding: space['4'],
    borderRadius: radius.md,
  },
  warningText: { flex: 1, minWidth: 0, gap: 2 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space['3'],
    marginTop: space['4'],
    paddingHorizontal: space['6'],
    paddingVertical: space['4'],
    // 屏幕稿 11 · 1440 rules the foot off from the body, the same hairline the sheet has.
    borderTopWidth: 1,
  },
  footNarrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'] - 2,
    marginTop: space['4'],
    paddingHorizontal: space['5'] - 2,
    paddingTop: space['4'],
    paddingBottom: space['5'],
    borderTopWidth: 1,
  },
  footNote: { flexShrink: 1, minWidth: 140 },
  footActions: { flexDirection: 'row', gap: space['2'] },
  // 屏幕稿 11's sheet gives the destructive button the wider half of the foot.
  footCell: { flex: 1, minWidth: 0 },
  footCellWide: { flex: 1.4, minWidth: 0 },
});

export default UndoDialogHost;
