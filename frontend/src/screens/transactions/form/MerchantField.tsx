/**
 * Merchant box with the "recent merchants" drop-down (04 §4.6, decision §14.52 A19).
 *
 * The list is purely local (`recent_merchants:<ledgerId>`, written after every save) and
 * prefers the merchants last used with the category currently selected, so booking a
 * second lunch offers the lunch places first.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text, TextField } from '@/ui';

import { MERCHANT_MAX_LENGTH } from './schemas';
import { suggestMerchants, type RecentMerchant } from './useTransactionForm';

export interface MerchantFieldProps {
  value: string;
  onChange(next: string): void;
  recent: readonly RecentMerchant[];
  /** Suggestions used with this level-1 category come first. */
  categoryL1: string | null;
  disabled?: boolean;
  error?: string | null;
  testID?: string;
}

/** Milliseconds the list stays open after a blur, so a tap on a row still lands. */
const BLUR_GRACE_MS = 120;

export function MerchantField({
  value,
  onChange,
  recent,
  categoryL1,
  disabled = false,
  error,
  testID,
}: MerchantFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'merchant';
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const suggestions = React.useMemo(
    () => suggestMerchants(recent, categoryL1, value),
    [categoryL1, recent, value],
  );

  function scheduleClose(): void {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), BLUR_GRACE_MS);
  }

  function pick(name: string): void {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    onChange(name);
    setOpen(false);
  }

  return (
    <View style={styles.wrap}>
      <TextField
        testID={id}
        label={t('transaction:form.merchant')}
        accessibilityLabel={t('transaction:form.merchant')}
        value={value}
        onChangeText={onChange}
        onFocus={() => setOpen(true)}
        onBlur={scheduleClose}
        error={error}
        disabled={disabled}
        maxLength={MERCHANT_MAX_LENGTH}
      />
      {open && !disabled && suggestions.length > 0 ? (
        <View
          testID={`${id}-suggestions`}
          accessibilityRole="menu"
          accessibilityLabel={t('transaction:form.recent_merchants')}
          style={[
            styles.panel,
            {
              backgroundColor: colors['bg.raised'],
              borderColor: colors['border.default'],
              zIndex: z.dropdown,
            },
          ]}
        >
          <Text variant="caption" tone="muted" style={styles.heading}>
            {t('transaction:form.recent_merchants')}
          </Text>
          {suggestions.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="menuitem"
              accessibilityLabel={name}
              onPress={() => pick(name)}
              testID={`${id}-suggestion-${name}`}
              style={styles.row}
            >
              <Text variant="body" numberOfLines={1}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  panel: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space['1'],
  },
  heading: { paddingHorizontal: space['3'], paddingVertical: space['1'] },
  row: { paddingHorizontal: space['3'], paddingVertical: space['2'] },
});
