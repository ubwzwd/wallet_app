/**
 * Bottom sheet (04 §6.4): a Modal with a dimmed backdrop and an 18-radius top edge. One
 * implementation for web and native — narrow layouts use it for filters, row details, the
 * ledger switcher and the dropdown overlays of `Select`.
 */
import React from 'react';
import { Modal, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: string;
  /** Accessible name of the × button; falls back to `title`. Passing it also makes the sheet
   *  draw its header row, so a header-less sheet leaves it out and the backdrop falls back to
   *  「关闭」 instead. */
  closeLabel?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  style,
  testID,
}: SheetProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={styles.root}>
        {/* The backdrop is a button of its own, so it needs a name of its own: a sheet that
            draws no header row (the filter sheet, 屏幕稿 02 · 交易筛选 375) passes neither
            `title` nor `closeLabel`, and reusing the × button's name left it unnamed. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel ?? title ?? t('common:button.close')}
          onPress={onClose}
          testID={testID ? `${testID}-backdrop` : 'sheet-backdrop'}
          style={[styles.backdrop, { backgroundColor: colors['fg.primary'], opacity: 0.35 }]}
        />
        <View
          style={[
            styles.panel,
            { backgroundColor: colors['bg.raised'], borderColor: colors['border.default'] },
            style,
          ]}
        >
          <View style={styles.handleRow}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[styles.handle, { backgroundColor: colors['border.strong'] }]}
            />
          </View>
          {title !== undefined || closeLabel !== undefined ? (
            <View style={styles.header}>
              <Text variant="heading" style={styles.headerTitle} numberOfLines={1}>
                {title ?? ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={closeLabel ?? title}
                onPress={onClose}
                hitSlop={space['2']}
                testID={testID ? `${testID}-close` : 'sheet-close'}
              >
                <Icon name="x" color={colors['fg.secondary']} />
              </Pressable>
            </View>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  panel: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    paddingBottom: space['6'],
    paddingHorizontal: space['4'],
    maxHeight: '86%',
  },
  handleRow: { alignItems: 'center', paddingVertical: space['2'] },
  handle: { width: 40, height: 4, borderRadius: radius.pill },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingBottom: space['3'],
  },
  headerTitle: { flex: 1 },
});
