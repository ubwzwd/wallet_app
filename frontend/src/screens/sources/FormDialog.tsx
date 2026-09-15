/**
 * The wide layout's dialog frame for the account form (屏幕稿 09 · 账户表单 1440): a 620-wide
 * white card with a titled head strip, a × that goes back to the list, the fields, and an
 * action bar on the tinted foot.
 *
 * It is only the frame — what is inside it, and what the buttons do, belongs to
 * `SourceFormScreen`. Narrow layouts do not use it: there the same blocks run full width
 * under the app's own top bar.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Card, Icon, Text } from '@/ui';

/** 屏幕稿 09: the dialog is 620 across and its × a 36 square. */
export const DIALOG_WIDTH = 620;
const CLOSE_SIZE = 36;
const PAD = space['5'] + 2;

export interface FormDialogProps {
  title: string;
  /** Accessible name of the × button. */
  closeLabel: string;
  onClose(): void;
  actions: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}

export function FormDialog({
  title,
  closeLabel,
  onClose,
  actions,
  children,
  testID,
}: FormDialogProps): React.JSX.Element {
  const colors = useColors();
  const id = testID ?? 'source-form';

  return (
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
}
