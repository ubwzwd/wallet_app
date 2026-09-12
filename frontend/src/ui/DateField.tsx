/**
 * Date field (04 §6.4): on the web the browser's own `<input type="date">` — the one place
 * in the app allowed to touch the DOM, and only from inside `src/ui/` behind a
 * `Platform.OS === 'web'` guard. Native falls back to a validated `YYYY-MM-DD` text box
 * (no date wheel in this phase).
 *
 * Either way the value is a calendar day with no timezone (decision §14.32): the string
 * goes to the server exactly as typed.
 */
import React from 'react';
import { Platform, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IsoDate } from '@/api/types';
import { isValidIsoDate } from '@/domain/dates';
import { controls, radius, space, type } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { fontFamilyFor } from '@/theme/fonts';
import { Icon } from './Icon';
import { Text } from './Text';
import { TextField } from './TextField';

/** The placeholder and native input mask; also what the browser sends back. */
export const ISO_DATE_PATTERN = 'YYYY-MM-DD';

export interface DateFieldProps {
  value: IsoDate;
  onChange(next: IsoDate): void;
  /** Latest allowed day, inclusive (04 §4.6.5 uses today + 1). */
  max?: IsoDate;
  /** Earliest allowed day, inclusive. */
  min?: IsoDate;
  label?: string;
  hint?: string;
  /** Field-level error from the caller; the local format/range check adds to it. */
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** `null` when `value` is an acceptable day, otherwise the i18n key chain to show. */
export function dateFieldErrorKey(
  value: string,
  max?: IsoDate,
  min?: IsoDate,
): string[] | null {
  if (value === '') return null;
  // `validation:date_invalid` does not exist in the language pack yet; the chain falls
  // through to `required`, which is what an unparseable day amounts to.
  if (!isValidIsoDate(value)) return ['validation:date_invalid', 'validation:required'];
  if (max !== undefined && value > max) return ['validation:date_not_future'];
  if (min !== undefined && value < min) return ['validation:date_not_future'];
  return null;
}

export function DateField({
  value,
  onChange,
  max,
  min,
  label,
  hint,
  error,
  disabled = false,
  style,
  testID,
}: DateFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [touched, setTouched] = React.useState(false);
  const id = testID ?? 'date';
  const fieldLabel = label ?? t('transaction:form.date');

  const localKey = dateFieldErrorKey(value, max, min);
  const shownError =
    error !== undefined && error !== null && error !== ''
      ? error
      : touched && localKey
        ? t(localKey)
        : null;

  if (Platform.OS === 'web') {
    // react-native-web renders host elements, so the native date picker is one element away.
    const input = React.createElement('input', {
      type: 'date',
      value,
      max,
      min,
      disabled,
      'aria-label': fieldLabel,
      'data-testid': id,
      onChange: (e: { target: { value: string } }) => {
        setTouched(true);
        onChange(e.target.value);
      },
      style: {
        flex: 1,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: colors[disabled ? 'fg.muted' : 'fg.primary'],
        fontFamily: fontFamilyFor(type.subheading.weight, true),
        fontSize: type.subheading.size,
      },
    });
    return (
      <View style={[{ gap: space['1'], alignSelf: 'stretch' }, style]}>
        <Text variant="caption" tone="secondary">
          {fieldLabel}
        </Text>
        <View
          testID={`${id}-field`}
          style={{
            height: controls.textField.height,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: shownError ? colors['status.danger.fg'] : 'transparent',
            backgroundColor: shownError ? colors['status.danger.bg'] : colors['bg.subtle'],
            paddingHorizontal: space['3'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: space['2'],
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {input}
          <Icon name="calendar" size={18} color={colors['fg.muted']} />
        </View>
        {shownError !== null ? (
          <Text variant="caption" tone="danger">
            {shownError}
          </Text>
        ) : hint !== undefined ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <TextField
      label={fieldLabel}
      hint={hint}
      error={shownError}
      mono
      disabled={disabled}
      value={value}
      placeholder={ISO_DATE_PATTERN}
      accessibilityLabel={fieldLabel}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="numbers-and-punctuation"
      maxLength={10}
      onChangeText={(next) => {
        setTouched(true);
        onChange(next);
      }}
      suffix={<Icon name="calendar" size={18} color={colors['fg.muted']} />}
      containerStyle={style}
      testID={id}
    />
  );
}
