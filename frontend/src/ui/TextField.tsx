/**
 * TextField (04 §6.4): 52 high, radius 14, tinted fill with no border at rest, a 1.5px
 * `border.focus` ring on focus, and an error state that tints the field (not the whole row).
 */
import React from 'react';
import {
  type BlurEvent,
  type FocusEvent,
  Pressable,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { controls, radius, space, type } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { fontFamilyFor } from '@/theme/fonts';
import { Icon } from './Icon';
import { Text } from './Text';

export interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor' | 'editable'> {
  label?: string;
  hint?: string;
  /** Any non-empty string switches the field into the error state and renders below it. */
  error?: string | null;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  /** Renders an eye toggle that flips `secureTextEntry`. */
  secureToggle?: boolean;
  /** Accessible names for that toggle; both fall back to `label`. */
  secureShowLabel?: string;
  secureHideLabel?: string;
  /** Money / dates: IBM Plex Mono with tabular figures. */
  mono?: boolean;
  disabled?: boolean;
  /** Shows a `used / maxLength` counter under the field. */
  showCounter?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export const TextField = React.forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    prefix,
    suffix,
    secureToggle = false,
    secureShowLabel,
    secureHideLabel,
    mono = false,
    disabled = false,
    showCounter = false,
    containerStyle,
    multiline = false,
    maxLength,
    value,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const colors = useColors();
  const [focused, setFocused] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);
  const hasError = typeof error === 'string' && error.length > 0;

  const handleFocus = (e: FocusEvent) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur = (e: BlurEvent) => {
    setFocused(false);
    onBlur?.(e);
  };

  const borderColor = hasError
    ? colors['status.danger.fg']
    : focused
      ? colors['border.focus']
      : 'transparent';

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label !== undefined ? (
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
      ) : null}
      <View
        testID={rest.testID === undefined ? undefined : `${rest.testID}-field`}
        style={[
          styles.field,
          {
            minHeight: multiline ? controls.textField.height * 2 : controls.textField.height,
            borderRadius: radius.md,
            borderColor,
            backgroundColor: hasError ? colors['status.danger.bg'] : colors['bg.subtle'],
            opacity: disabled ? 0.6 : 1,
            alignItems: multiline ? 'flex-start' : 'center',
            paddingVertical: multiline ? space['3'] : 0,
          },
        ]}
      >
        {prefix}
        <TextInput
          ref={ref}
          {...rest}
          value={value}
          maxLength={maxLength}
          multiline={multiline}
          editable={!disabled}
          secureTextEntry={secureToggle ? !revealed : rest.secureTextEntry}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholderTextColor={colors['fg.muted']}
          style={[
            styles.input,
            {
              color: disabled ? colors['fg.muted'] : colors['fg.primary'],
              fontFamily: fontFamilyFor(type.subheading.weight, mono),
              fontSize: type.subheading.size,
              lineHeight: multiline ? type.subheading.lineHeight : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            mono ? styles.tabular : null,
          ]}
        />
        {suffix}
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={(revealed ? secureHideLabel : secureShowLabel) ?? label}
            accessibilityState={{ selected: revealed }}
            onPress={() => setRevealed((v) => !v)}
            testID="secure-toggle"
            hitSlop={space['2']}
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} color={colors['fg.muted']} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.footer}>
        <View style={styles.footerText}>
          {hasError ? (
            <Text variant="caption" tone="danger">
              {error}
            </Text>
          ) : hint !== undefined ? (
            <Text variant="caption" tone="muted">
              {hint}
            </Text>
          ) : null}
        </View>
        {showCounter && maxLength !== undefined ? (
          <Text variant="caption" tone="muted" mono testID="text-field-counter">
            {`${value?.length ?? 0}/${maxLength}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space['1'], alignSelf: 'stretch' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    paddingHorizontal: space['3'],
    borderWidth: 1.5,
  },
  input: { flex: 1, padding: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
  footerText: { flex: 1 },
});
