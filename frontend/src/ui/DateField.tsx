/**
 * Date field (04 §6.4, mockup 02: `2026-09-01` in mono with a calendar glyph on the right).
 *
 * The field itself is the same mono text box on every platform, so what the user reads is
 * always the ISO day the server will get (decision §14.32) — never the browser's
 * locale-shaped `mm/dd/yyyy`, which is what a bare `<input type="date">` shows.
 *
 * The calendar button still opens the platform picker: on the web a zero-size
 * `<input type="date">` sits behind the field and `showPicker()` is called on it. Browsers
 * without `showPicker` (and native, which has no date wheel in this phase) fall back to
 * focusing the box so the day can be typed.
 */
import React from 'react';
import {
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IsoDate } from '@/api/types';
import { isValidIsoDate, todayLocal } from '@/domain/dates';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { TextField, iconButtonHitSlop } from './TextField';

/** The placeholder and input mask; also what the browser sends back. */
export const ISO_DATE_PATTERN = 'YYYY-MM-DD';

/** The DOM handle the web picker needs. Typed narrowly so nothing else can be reached. */
interface WebDateInput {
  value: string;
  showPicker?: () => void;
}

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
  /** Shows a small chip that jumps to today; the caller owns the word. */
  todayLabel?: string;
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
  // One key per complaint: "太早" must never borrow the "不能晚于明天" wording, which says
  // the opposite. (A list, so a caller can pass the whole chain to `t()`.)
  if (!isValidIsoDate(value)) return ['validation:date_invalid'];
  if (max !== undefined && value > max) return ['validation:date_not_future'];
  if (min !== undefined && value < min) return ['validation:date_too_early'];
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
  todayLabel,
  disabled = false,
  style,
  testID,
}: DateFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [touched, setTouched] = React.useState(false);
  const pickerRef = React.useRef<WebDateInput | null>(null);
  const inputRef = React.useRef<TextInput | null>(null);
  const id = testID ?? 'date';
  const fieldLabel = label ?? t('transaction:form.date');

  const localKey = dateFieldErrorKey(value, max, min);
  const shownError =
    error !== undefined && error !== null && error !== ''
      ? error
      : touched && localKey
        ? t(localKey)
        : null;

  function commit(next: string): void {
    setTouched(true);
    onChange(next);
  }

  function openPicker(): void {
    const picker = pickerRef.current;
    if (picker && typeof picker.showPicker === 'function') {
      // `showPicker` throws if the browser refuses the gesture; typing still works.
      try {
        picker.showPicker();
        return;
      } catch {
        /* fall through to the text box */
      }
    }
    inputRef.current?.focus();
  }

  // react-native-web renders host elements, so the picker is one hidden element away.
  // It is never focusable or readable: the mono box above is the field's real UI.
  const hiddenPicker =
    Platform.OS === 'web'
      ? React.createElement('input', {
          type: 'date',
          value,
          max,
          min,
          tabIndex: -1,
          'aria-hidden': true,
          ref: (node: WebDateInput | null) => {
            pickerRef.current = node;
          },
          onChange: (e: { target: { value: string } }) => commit(e.target.value),
          style: { position: 'absolute', bottom: 0, left: 0, width: 0, height: 0, opacity: 0 },
        })
      : null;

  return (
    <View style={[styles.wrap, style]}>
      <TextField
        ref={inputRef}
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
        onChangeText={commit}
        suffix={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={fieldLabel}
            disabled={disabled}
            onPress={openPicker}
            hitSlop={iconButtonHitSlop}
            testID={`${id}-picker`}
          >
            <Icon name="calendar" size={18} color={colors['fg.muted']} />
          </Pressable>
        }
        testID={id}
      />
      {hiddenPicker}
      {todayLabel !== undefined ? (
        <Chip
          label={todayLabel}
          disabled={disabled}
          onPress={() => commit(todayLocal())}
          testID={`${id}-today`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: space['2'] },
});
