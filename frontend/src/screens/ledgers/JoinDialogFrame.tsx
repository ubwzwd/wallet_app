/**
 * The 「1440 · Dialog」 frame of 屏幕稿 13: 加入账本 on a wide screen is a modal laid over the
 * ledger list, not a page of its own.
 *
 * The route is still `/ledgers/join` (04 §1.2 owns the route table and `app/` is outside
 * this task), so the list behind the dim is rendered here, inert: it is the backdrop of the
 * mockup, not a second copy of the page the user can work in. `useLedgers()` is already in
 * the query cache by the time anyone reaches this route, so it costs no extra request.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';

import LedgersScreen from './LedgersScreen';

export interface JoinDialogFrameProps {
  /** The dialog body — everything above the foot band. */
  children: React.ReactNode;
  /** The buttons of the foot band, right-aligned the way the mockup draws them. */
  foot: React.ReactNode;
  maxWidth: number;
  /** Backdrop press / Esc: back to the list the dialog is sitting on. */
  onDismiss(): void;
}

export function JoinDialogFrame({
  children,
  foot,
  maxWidth,
  onDismiss,
}: JoinDialogFrameProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();

  return (
    <View style={styles.root} testID="join-ledger-screen">
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="join-dialog-behind"
      >
        <LedgersScreen />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:button.close')}
        onPress={onDismiss}
        testID="join-dialog-backdrop"
        style={[styles.backdrop, { backgroundColor: colors['fg.primary'], opacity: 0.3 }]}
      />

      <View style={styles.centre} pointerEvents="box-none">
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          testID="join-dialog"
          style={[styles.dialog, { maxWidth, backgroundColor: colors['bg.raised'] }]}
        >
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
          <View
            style={[
              styles.foot,
              // 屏幕稿 13 · Dialog greys the foot band off against the dialog's own white.
              { backgroundColor: colors['bg.surface'], borderTopColor: colors['border.default'] },
            ]}
          >
            {foot}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, zIndex: z.overlay },
  centre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space['5'],
    zIndex: z.overlay + 1,
  },
  dialog: { width: '100%', maxHeight: '92%', borderRadius: radius.lg, overflow: 'hidden' },
  scroll: { flexGrow: 0 },
  body: { padding: space['5'], gap: space['4'] },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space['2'],
    paddingHorizontal: space['5'],
    paddingVertical: space['4'],
    borderTopWidth: 1,
  },
});

export default JoinDialogFrame;
