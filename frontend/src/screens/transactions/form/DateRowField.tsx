/**
 * The date control of 屏幕稿 04 / 05 · 375 (§14.59b).
 *
 * On a phone the mockups do not draw a labelled text box for the date: they draw a **row**
 * in the same white card as the account — calendar well, 「日期」 over the ISO day, the
 * 「今天」 chip and a chevron — so the two things every entry needs sit in one two-line card
 * instead of two stacked fields.
 *
 * Pressing the row opens a sheet holding the ordinary `DateField`, which keeps everything
 * that field can do (type an ISO day, open the platform picker, the range check) rather
 * than trading it for a prettier trigger. A wide screen has the room the mockup's 1440
 * frame uses, so it renders that same `DateField` inline and this file changes nothing.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { IsoDate } from '@/api/types';
import { todayLocal } from '@/domain/dates';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Chip, DateField, ISO_DATE_PATTERN, Sheet, Text } from '@/ui';

import { RowField } from './parts';

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
    <View style={{ gap: space['1'] }}>
      <RowField
        testID={`${testID}-row`}
        icon="calendar"
        label={label}
        value={value === '' ? ISO_DATE_PATTERN : value}
        valueMono
        valueTone={value === '' ? 'muted' : 'primary'}
        filled={false}
        disabled={disabled}
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        trailing={
          <Chip
            label={todayLabel}
            disabled={disabled}
            onPress={() => onChange(todayLocal())}
            testID={`${testID}-today`}
          />
        }
      />
      {hasError ? (
        <Text variant="caption" tone="danger" testID={`${testID}-row-error`}>
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
