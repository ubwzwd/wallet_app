/**
 * The six-cell invite-code input of 04 §4.3: digits only, auto-advance, backspace steps
 * back, a pasted string fans out across the cells, and a full six digits calls
 * `onComplete` exactly once per entry.
 *
 * `shakeToken` is a counter, not a boolean: the parent bumps it on every rejected code so
 * a second identical failure still shakes. Reduce-motion users get the same state change
 * without the movement (04 §6.6).
 */
import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  type TextInput as RNTextInput,
  TextInput,
  View,
} from 'react-native';
import { controls, radius, space, type } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { fontFamilyFor } from '@/theme/fonts';

export const CODE_LENGTH = 6;

/** One shake cycle, in device-independent pixels. */
const SHAKE_OFFSET = 8;
const SHAKE_STEP_MS = 45;

export interface CodeInputProps {
  /** Digits entered so far, `''`–`'123456'`. */
  value: string;
  onChange(next: string): void;
  /** Fired once when the sixth digit lands. */
  onComplete(code: string): void;
  /** Bump to play the rejection shake. */
  shakeToken?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Accessible name of the whole group (each cell reuses it with its position). */
  accessibilityLabel: string;
  testID?: string;
}

export function CodeInput({
  value,
  onChange,
  onComplete,
  shakeToken = 0,
  disabled = false,
  autoFocus = false,
  accessibilityLabel,
  testID = 'code-input',
}: CodeInputProps): React.JSX.Element {
  const colors = useColors();
  const cells = React.useRef<Array<RNTextInput | null>>([]);
  const translateX = React.useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduceMotion(on);
      })
      .catch(() => {
        /* an environment without the API simply keeps the animation */
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const firstShake = React.useRef(true);
  React.useEffect(() => {
    if (firstShake.current) {
      firstShake.current = false;
      return;
    }
    if (reduceMotion) return;
    const hop = (to: number) =>
      Animated.timing(translateX, {
        toValue: to,
        duration: SHAKE_STEP_MS,
        useNativeDriver: true,
      });
    Animated.sequence([
      hop(-SHAKE_OFFSET),
      hop(SHAKE_OFFSET),
      hop(-SHAKE_OFFSET / 2),
      hop(0),
    ]).start();
  }, [shakeToken, reduceMotion, translateX]);

  const focus = React.useCallback((index: number): void => {
    cells.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))]?.focus();
  }, []);

  const commit = React.useCallback(
    (next: string): void => {
      onChange(next);
      if (next.length === CODE_LENGTH) onComplete(next);
    },
    [onChange, onComplete],
  );

  const handleChangeText = React.useCallback(
    (index: number, text: string): void => {
      const digits = text.replace(/\D/g, '');

      // A paste (or an autofilled one-time code) fans out from the cell it landed in.
      if (digits.length > 1) {
        const next = (value.slice(0, index) + digits).slice(0, CODE_LENGTH);
        commit(next);
        focus(next.length);
        return;
      }

      const chars = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');
      chars[index] = digits;
      const next = chars.join('').slice(0, CODE_LENGTH);
      commit(next);
      if (digits.length === 1) focus(index + 1);
    },
    [commit, focus, value],
  );

  const handleKeyPress = React.useCallback(
    (index: number, key: string): void => {
      if (key !== 'Backspace') return;
      if (value[index] !== undefined && value[index] !== '') return;
      if (index === 0) return;
      // The cell is already empty: clear the one before it and move there.
      const chars = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');
      chars[index - 1] = '';
      onChange(chars.join('').slice(0, CODE_LENGTH));
      focus(index - 1);
    },
    [focus, onChange, value],
  );

  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.row, { transform: [{ translateX }] }]}
    >
      {Array.from({ length: CODE_LENGTH }, (_, index) => (
        <TextInput
          key={index}
          ref={(node) => {
            cells.current[index] = node;
          }}
          testID={`${testID}-${index}`}
          accessibilityLabel={`${accessibilityLabel} ${index + 1}`}
          value={value[index] ?? ''}
          editable={!disabled}
          autoFocus={autoFocus && index === 0}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          selectTextOnFocus
          onChangeText={(text) => handleChangeText(index, text)}
          onKeyPress={(e) => handleKeyPress(index, e.nativeEvent.key)}
          style={[
            styles.cell,
            {
              borderRadius: radius.md,
              height: controls.textField.height,
              backgroundColor: colors['bg.subtle'],
              borderColor: colors['border.default'],
              color: disabled ? colors['fg.muted'] : colors['fg.primary'],
              fontFamily: fontFamilyFor(type.title.weight, true),
              fontSize: type.title.size,
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space['2'], alignSelf: 'stretch' },
  cell: {
    flex: 1,
    minWidth: 40,
    borderWidth: 1.5,
    textAlign: 'center',
    padding: 0,
  },
});
