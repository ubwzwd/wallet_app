/**
 * Keyboard shortcut help overlay (04 §6.4; decision §14.52 A19) — `?` on the entry form and
 * on the import review table. Key caps are mono so `⌘`, `Ctrl` and `Enter` line up.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Sheet } from './Sheet';
import { Text } from './Text';

export interface Shortcut {
  /** The keys of one chord, e.g. `['⌘', 'S']`; already localised by the caller. */
  keys: string[];
  label: string;
}

export interface KeyboardHintProps {
  open: boolean;
  onClose(): void;
  shortcuts: readonly Shortcut[];
  title?: string;
  testID?: string;
}

export function KeyboardHint({
  open,
  onClose,
  shortcuts,
  title,
  testID,
}: KeyboardHintProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'keyboard-hint';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title ?? t('transaction:form.keyboard_hint_title')}
      closeLabel={t('common:button.close')}
      testID={id}
    >
      <View style={styles.list}>
        {shortcuts.map((shortcut) => (
          <View key={shortcut.label} style={styles.row} testID={`${id}-row`}>
            <Text variant="body" style={styles.label}>
              {shortcut.label}
            </Text>
            <View style={styles.keys}>
              {shortcut.keys.map((key) => (
                <View
                  key={key}
                  style={[
                    styles.cap,
                    {
                      backgroundColor: colors['bg.subtle'],
                      borderColor: colors['border.default'],
                    },
                  ]}
                >
                  <Text variant="caption" tone="secondary" mono>
                    {key}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space['2'], paddingBottom: space['2'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'], minHeight: 36 },
  label: { flex: 1 },
  keys: { flexDirection: 'row', alignItems: 'center', gap: space['1'] },
  cap: {
    minWidth: 28,
    paddingHorizontal: space['2'],
    paddingVertical: space['1'],
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
});
