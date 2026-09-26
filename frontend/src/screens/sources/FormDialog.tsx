/**
 * The wide layout's dialog frame for the account form (屏幕稿 09 · 账户表单 1440): a 620-wide
 * white card with a titled head strip, a × that goes back to the list, the fields, and an
 * action bar on the tinted foot.
 *
 * The mockup draws it as a modal laid over the dimmed account list, vertically centred —
 * not as a card at the top of an empty page. The route is still a page of its own (04 §1.2
 * owns the route table), so the list behind arrives as the `behind` prop and is rendered
 * as the backdrop: RN `Modal` portals the dialog and traps focus in it, while
 * `pointerEvents="none"` + `aria-hidden` keep the pointer and the screen reader out of the
 * layer behind.
 *
 * It is only the frame — what is inside it, and what the buttons do, belongs to
 * `SourceFormScreen`. Narrow layouts do not use it: there the same blocks run full width
 * under the app's own top bar.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SIDEBAR_WIDTH } from '@/navigation';
import { radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Card, Icon, Text } from '@/ui';

/** 屏幕稿 09: the dialog is 620 across and its × a 36 square. */
const DIALOG_WIDTH = 620;
const CLOSE_SIZE = 36;
const PAD = space['5'] + 2;

export interface FormDialogProps {
  title: string;
  /** Accessible name of the × button. */
  closeLabel: string;
  onClose(): void;
  actions: React.ReactNode;
  children: React.ReactNode;
  /** The page the mockup dims behind the dialog — the account list this route came from. */
  behind?: React.ReactNode;
  testID?: string;
}

export function FormDialog({
  title,
  closeLabel,
  onClose,
  actions,
  children,
  behind,
  testID,
}: FormDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const id = testID ?? 'source-form';

  const card = (
    <Card
      variant="raised"
      padded={false}
      style={{ width: '100%', maxWidth: DIALOG_WIDTH, overflow: 'hidden' }}
      testID={`${id}-dialog`}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['3'],
          paddingHorizontal: PAD,
          paddingTop: space['4'] + 2,
          paddingBottom: space['3'] + 2,
          borderBottomWidth: 1,
          borderBottomColor: colors['border.default'],
        }}
      >
        <Text
          variant="heading"
          weight={700}
          accessibilityRole="header"
          style={{ flex: 1 }}
          testID={`${id}-title`}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          hitSlop={(44 - CLOSE_SIZE) / 2}
          testID={`${id}-close`}
          style={({ pressed }) => ({
            width: CLOSE_SIZE,
            height: CLOSE_SIZE,
            borderRadius: radius.md - 3,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors['bg.hover'] : colors['bg.subtle'],
          })}
        >
          <Icon name="x" size={18} color={colors['fg.secondary']} />
        </Pressable>
      </View>

      <View style={{ padding: PAD }}>{children}</View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: space['2'] + 2,
          paddingHorizontal: PAD,
          paddingVertical: space['3'] + 2,
          backgroundColor: colors['bg.canvas'],
        }}
      >
        {actions}
      </View>
    </Card>
  );

  return (
    <View style={overlay.root} testID={`${id}-overlay`}>
      <View style={overlay.behind} pointerEvents="none" aria-hidden testID={`${id}-behind`}>
        {behind}
      </View>
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={[overlay.centre, { zIndex: z.overlay }]}>
          {/* touch-target-exempt: the backdrop fills the screen behind the dialog — the
              sidebar included, which is how 屏幕稿 09 dims it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common:button.close')}
            onPress={onClose}
            testID={`${id}-backdrop`}
            style={[overlay.backdrop, { backgroundColor: colors['fg.primary'], opacity: 0.3 }]}
          />
          {/* `Modal` portals to the whole viewport, but 屏幕稿 09 centres the card on the
              *content column*, not on the window: its centre sits at x ≈ 846 of 1440, not at
              720. Padding the scroll body by the sidebar moves the centre there and leaves
              `alignItems: 'center'` to do the rest. */}
          <ScrollView
            style={overlay.scroll}
            contentContainerStyle={[
              overlay.scrollBody,
              wide ? { paddingLeft: SIDEBAR_WIDTH + space['5'] } : null,
            ]}
            accessibilityViewIsModal
          >
            {card}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const overlay = StyleSheet.create({
  root: { flex: 1 },
  behind: { ...StyleSheet.absoluteFillObject },
  backdrop: { ...StyleSheet.absoluteFillObject },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { width: '100%', flexGrow: 0, maxHeight: '100%' },
  scrollBody: { alignItems: 'center', padding: space['5'] },
});
