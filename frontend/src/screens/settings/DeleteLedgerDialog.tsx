/**
 * 屏幕稿 12 · 删除账本 — the delete-ledger confirmation, which is not a generic
 * `ConfirmDialog`.
 *
 * The mockup lays the consequences out instead of folding them into one mono line: a
 * danger well beside the title, an ✕ in the corner, a row of three count tiles
 * (交易 / 账户 / 导入批次), the name box wearing a danger ring, the 「还差「本」字」 progress
 * hint under it, and a grey foot band carrying 取消 / 永久删除 on the right. `ConfirmDialog`
 * takes a string body and is shared by every other destructive flow, so this screen brings
 * its own dialog rather than bending the library one out of shape — the same call
 * `UndoDialog.tsx` made for 屏幕稿 11.
 *
 * It answers to the same test ids as `ConfirmHost` (`confirm-dialog` / `confirm-accept` /
 * `confirm-cancel` / `confirm-require-text`) because to everything outside it *is* the
 * confirmation dialog of this flow.
 *
 * The 账户 tile shows the account total alone: `GET /ledgers/{id}` counts sources without
 * splitting archived ones out, so the mockup's 「4 个 + 2 归档」 has no second number to
 * print (03 §5, `LedgerDetail.counts`).
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Icon, Text, TextField } from '@/ui';

/** 屏幕稿 12 · 1440 draws a 600 dialog; narrow gets a bottom sheet instead. */
const DIALOG_MAX_WIDTH = 600;

export interface DeleteLedgerCounts {
  transactions: number;
  sources: number;
  imports: number;
}

export interface DeleteLedgerDialogProps {
  open: boolean;
  /** The name the user has to type back, character for character. */
  name: string;
  counts: DeleteLedgerCounts;
  busy?: boolean;
  onCancel(): void;
  onConfirm(): void;
}

type TileKey = 'transactions' | 'sources' | 'imports';
const TILES: readonly TileKey[] = ['transactions', 'sources', 'imports'];

function Tile({ tileKey, count, wide }: { tileKey: TileKey; count: number; wide: boolean }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View
      testID={`delete-ledger-tile-${tileKey}`}
      style={[wide ? styles.tileWide : styles.tileNarrow, { backgroundColor: colors['bg.canvas'] }]}
    >
      <Text variant="caption" tone="muted">
        {t(`ledger:settings.danger.delete_tile.${tileKey}`)}
      </Text>
      <Text
        variant={wide ? 'heading' : 'subheading'}
        mono
        weight={500}
        testID={`delete-ledger-tile-${tileKey}-value`}
      >
        {t(`ledger:settings.danger.delete_tile_value.${tileKey}`, { count })}
      </Text>
    </View>
  );
}

/**
 * The line under the box: what is still missing while the name is being typed, and a plain
 * 「名字对不上」 once what is typed can no longer become the name.
 */
function typedHint(typed: string, name: string): { key: 'remaining' | 'mismatch'; text: string } | null {
  const value = typed.trim();
  if (value === '') return null;
  if (value === name) return null;
  if (name.startsWith(value)) return { key: 'remaining', text: name.slice(value.length) };
  return { key: 'mismatch', text: '' };
}

export function DeleteLedgerDialog({
  open,
  name,
  counts,
  busy = false,
  onCancel,
  onConfirm,
}: DeleteLedgerDialogProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const [typed, setTyped] = React.useState('');

  // Every fresh open starts from an empty box: a name left over from a cancelled attempt
  // would arm the button before the user has agreed to anything.
  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  if (!open) return null;

  const matches = typed.trim() === name && name !== '';
  const hint = typedHint(typed, name);

  const head = (
    <View style={[styles.head, { borderBottomColor: colors['border.default'] }]}>
      <View style={[styles.well, { backgroundColor: colors['status.danger.bg'] }]}>
        <Icon name="trash-2" size={20} color={colors['status.danger.fg']} />
      </View>
      <View style={styles.headText}>
        <Text variant={wide ? 'heading' : 'subheading'} weight={700}>
          {t('ledger:settings.danger.delete_confirm_title', { name })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('ledger:settings.danger.delete_confirm_body')}
        </Text>
      </View>
      {wide ? (
        <Button
          variant="soft"
          size="sm"
          icon="x"
          iconOnly
          accessibilityLabel={t('common:button.close')}
          onPress={onCancel}
          testID="confirm-close"
        />
      ) : null}
    </View>
  );

  const body = (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <View style={wide ? styles.tilesWide : styles.tilesNarrow} testID="delete-ledger-tiles">
        {TILES.map((key) => (
          <Tile key={key} tileKey={key} count={counts[key]} wide={wide} />
        ))}
      </View>

      {/* 屏幕稿 12 rings the box in the danger ink and prints what is still missing under
          it, for as long as what is typed is not the ledger's name yet. `TextField`'s
          error state is exactly that treatment. */}
      <TextField
        value={typed}
        onChangeText={setTyped}
        label={t('ledger:settings.danger.delete_confirm_label', { name })}
        accessibilityLabel={t('ledger:settings.danger.delete_confirm_label', { name })}
        placeholder={name}
        autoCapitalize="none"
        autoCorrect={false}
        error={
          hint === null
            ? null
            : hint.key === 'remaining'
              ? t('ledger:settings.danger.delete_remaining', { text: hint.text })
              : t('ledger:settings.danger.delete_mismatch')
        }
        testID="confirm-require-text"
      />
      {/* An explicit 「输入完整名字才能删」 while the box is still empty; once anything is
          typed the error line above says the same thing more precisely. */}
      {typed.trim() === '' ? (
        <Text variant="caption" tone="muted" testID="delete-ledger-hint">
          {t('ledger:settings.danger.delete_hint', { name })}
        </Text>
      ) : null}
    </ScrollView>
  );

  const foot = (
    <View
      style={[
        wide ? styles.foot : styles.footNarrow,
        // 屏幕稿 12 · 1440 greys the foot band off (bg.surface) against the dialog's own white;
        // the 375 frame keeps the white and separates the band with the hairline alone.
        {
          backgroundColor: wide ? colors['bg.surface'] : colors['bg.raised'],
          borderTopColor: colors['border.default'],
        },
      ]}
    >
      <View style={wide ? styles.footActions : styles.footCell}>
        <Button
          label={t('common:button.cancel')}
          variant="soft"
          fullWidth={!wide}
          onPress={onCancel}
          testID="confirm-cancel"
        />
      </View>
      <View style={wide ? styles.footActions : styles.footCellWide}>
        <Button
          label={t('ledger:settings.danger.delete_action')}
          variant="danger"
          fullWidth={!wide}
          disabled={!matches}
          loading={busy}
          onPress={onConfirm}
          testID="confirm-accept"
        />
      </View>
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[wide ? styles.rootWide : styles.rootNarrow, { zIndex: z.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:button.close')}
          onPress={onCancel}
          testID="confirm-backdrop"
          style={[styles.backdrop, { backgroundColor: colors['fg.primary'], opacity: 0.4 }]}
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
          {head}
          {body}
          {foot}
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
    paddingHorizontal: space['5'],
    paddingTop: space['5'],
    paddingBottom: space['4'],
    borderBottomWidth: 1,
  },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  well: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: space['5'], paddingTop: space['4'], gap: space['3'] },
  tilesWide: { flexDirection: 'row', gap: space['3'] },
  tilesNarrow: { gap: space['2'] },
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
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: space['2'],
    marginTop: space['4'],
    paddingHorizontal: space['5'],
    paddingVertical: space['4'],
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
  footActions: { flexShrink: 0 },
  // 屏幕稿 12 · 375 gives the destructive button the wider half of the foot (1 : 1.4).
  footCell: { flex: 1, minWidth: 0 },
  footCellWide: { flex: 1.4, minWidth: 0 },
});

export default DeleteLedgerDialog;
