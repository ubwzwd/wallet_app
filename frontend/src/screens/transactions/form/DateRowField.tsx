/**
 * The date control of 屏幕稿 04 / 05 · 375 (§14.59b).
 *
 * On a phone the mockups do not draw a labelled text box for the date: they draw a **row**
 * in the same white card as the account — calendar well, 「日期」 over the ISO day, the
 * 「今天」 chip and a chevron — so the two things every entry needs sit in one two-line card
 * instead of two stacked fields.
 *
 * The row is deliberately *not* one big `RowField`: the 「今天」 chip is a button, and a
 * button inside a button is invalid HTML — react-dom logs a hydration error and swallows
 * one of the two clicks. So the row is a press target with the chip beside it, and the
 * chevron is its own small target.
 *
 * Pressing the row opens a sheet holding the ordinary `DateField`, which keeps everything
 * that field can do (type an ISO day, open the platform picker, the range check) rather
 * than trading it for a prettier trigger. A wide screen has the room the mockups' 1440
 * frames use, so it renders that same `DateField` inline and this file changes nothing.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { IsoDate } from '@/api/types';
import { todayLocal } from '@/domain/dates';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Chip, DateField, ISO_DATE_PATTERN, Icon, Sheet, Text } from '@/ui';

/** Mockup 04 · 375: the same 56-tall row the account above it uses. */
const ROW_HEIGHT = 56;
const WELL = 34;

export interface DateRowFieldProps {
  value: IsoDate;
  onChange(next: IsoDate): void;
  /** Latest allowed day, inclusive. */
  max?: IsoDate;
  label: string;
  todayLabel: string;
  error?: string | null;
  disabled?: boolean;
  testID: string;
}

export function DateRowField({
  value,
  onChange,
  max,
  label,
  todayLabel,
  error,
  disabled = false,
  testID,
}: DateRowFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();
  const colors = useColors();
  const [open, setOpen] = React.useState(false);

  if (wide) {
    return (
      <DateField
        testID={testID}
        label={label}
        todayLabel={todayLabel}
        value={value}
        onChange={onChange}
        max={max}
        error={error}
        disabled={disabled}
      />
    );
  }

  const hasError = typeof error === 'string' && error.length > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {/* touch-target-exempt: `styles.press` sets minHeight 56 and the row stretches. */}
        <Pressable
          testID={`${testID}-row`}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.press,
            {
              opacity: disabled ? 0.6 : 1,
              backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
            },
          ]}
        >
          <View style={[styles.well, { backgroundColor: colors['bg.canvas'] }]}>
            <Icon name="calendar" size={18} color={colors['fg.secondary']} />
          </View>
          <View style={styles.grow}>
            <Text variant="caption" weight={600} tone="secondary" numberOfLines={1}>
              {label}
            </Text>
            <Text
              variant="subheading"
              weight={450}
              mono
              tone={value === '' ? 'muted' : 'primary'}
              numberOfLines={1}
              testID={`${testID}-row-value`}
            >
              {value === '' ? ISO_DATE_PATTERN : value}
            </Text>
          </View>
        </Pressable>
        <Chip
          label={todayLabel}
          disabled={disabled}
          onPress={() => onChange(todayLocal())}
          testID={`${testID}-today`}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:button.pick_date')}
          disabled={disabled}
          onPress={() => setOpen(true)}
          hitSlop={12}
          style={styles.chevron}
          testID={`${testID}-open`}
        >
          <Icon name="chevron-down" size={18} color={colors['fg.muted']} />
        </Pressable>
      </View>
      {hasError ? (
        <Text variant="caption" tone="danger" style={styles.error} testID={`${testID}-row-error`}>
          {error}
        </Text>
      ) : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        closeLabel={t('common:button.close')}
        testID={`${testID}-sheet`}
      >
        <DateField
          testID={testID}
          value={value}
          onChange={onChange}
          max={max}
          error={error}
          disabled={disabled}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: space['1'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'] + 2,
    paddingRight: space['3'] + 2,
  },
  press: {
    flex: 1,
    minWidth: 0,
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingLeft: space['3'] + 2,
    paddingRight: space['2'],
    paddingVertical: space['2'] + 2,
    borderRadius: radius.md + 2,
  },
  well: {
    width: WELL,
    height: WELL,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  grow: { flex: 1, minWidth: 0 },
  chevron: { padding: space['1'] },
  error: { paddingHorizontal: space['3'] + 2 },
});
