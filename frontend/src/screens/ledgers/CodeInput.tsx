/**
 * The six-cell invite-code input of 04 §4.3 and screen 13: digits only, auto-advance,
 * backspace steps back, a pasted string fans out across the cells, and a full six digits
 * calls `onComplete` exactly once per entry.
 *
 * Screen 13 draws big standalone squares — 46×58 on a phone, 56×68 in the wide card — and
 * gives the group three colours: filled cells sit on `bg.selected`, a complete code turns
 * `status.success.bg`, a rejected one `status.danger.bg`. Empty cells are the page's own
 * canvas, so the row reads as "six holes" rather than six inputs.
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
  type TextStyle,
  View,
} from 'react-native';
import { type ColorToken, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { fontFamilyFor } from '@/theme/fonts';

export const CODE_LENGTH = 6;

/** One shake cycle, in device-independent pixels. */
const SHAKE_OFFSET = 8;
const SHAKE_STEP_MS = 45;

/** Screen 13: 46×58 / 26px glyph on 375, 56×68 / 30px in the 520 card. */
const METRICS = {
  narrow: { width: 46, height: 58, radius: 12, font: 26, gap: 6 },
  wide: { width: 56, height: 68, radius: radius.md, font: 30, gap: space['2'] },
} as const;

/** How the whole row is tinted: neutral while typing, green when accepted, red when not. */
export type CodeInputState = 'default' | 'success' | 'error';

const FILLED_BG: Readonly<Record<CodeInputState, ColorToken>> = {
  default: 'bg.selected',
  success: 'status.success.bg',
  error: 'status.danger.bg',
};

const FILLED_FG: Readonly<Record<CodeInputState, ColorToken>> = {
  default: 'fg.primary',
  success: 'status.success.fg',
  error: 'status.danger.fg',
};

/**
 * The single digit one keystroke leaves in a cell. Depending on the platform, typing over
 * a filled cell reports `'7'` (the selection was replaced) or `'37'` / `'73'` (it was not),
 * so the digit that is not the one already there wins — and the newest one otherwise.
 */
export function keystroke(previous: string, digits: string): string {
  if (digits === '') return '';
  if (previous !== '' && digits.length > 1) {
    const rest = digits.startsWith(previous)
      ? digits.slice(previous.length)
      : digits.replace(previous, '');
    if (rest !== '') return rest.slice(-1);
  }
  return digits.slice(-1);
}

export interface CodeInputProps {
  /** Digits entered so far, `''`–`'123456'`. */
  value: string;
  onChange(next: string): void;
  /** Fired once when the sixth digit lands. */
  onComplete(code: string): void;
  /** Bump to play the rejection shake. */
  shakeToken?: number;
  /** Tints the row: the server's verdict on the code that was just submitted. */
  state?: CodeInputState;
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
  state = 'default',
  disabled = false,
  autoFocus = false,
  accessibilityLabel,
  testID = 'code-input',
}: CodeInputProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const metrics = wide ? METRICS.wide : METRICS.narrow;
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
      const previous = value[index] ?? '';

      // A paste (or an autofilled one-time code) is a jump of two or more characters at
      // once — and it is only spread across the cells when the whole thing is a complete
      // code. A shorter jump is ambiguous (autocorrect, a fast typist, a selected cell
      // being typed over), so it is treated as ordinary typing below.
      if (text.length - previous.length >= 2 && digits.length === CODE_LENGTH) {
        commit(digits);
        focus(CODE_LENGTH - 1);
        return;
      }

      // Typing into a cell that already holds a digit replaces that one cell: the digits
      // after it belong to the user, not to this keystroke.
      const typed = keystroke(previous, digits);
      const chars = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');
      chars[index] = typed;
      const next = chars.join('').slice(0, CODE_LENGTH);
      commit(next);
      if (typed !== '') focus(index + 1);
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

  /**
   * A cell is "lit" when it holds a digit — or, once the server has spoken, always: the
   * failed code is cleared from the fields (04 §4.3) but the row stays red until the next
   * keystroke, so the page still points at where the problem is.
   */
  const paint = (filled: boolean): TextStyle => {
    const lit = filled || state !== 'default';
    return {
      backgroundColor: lit ? colors[FILLED_BG[state]] : colors['bg.canvas'],
      borderColor: state === 'error' ? colors['status.danger.fg'] : 'transparent',
      borderWidth: state === 'error' ? 1.5 : 0,
    };
  };

  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.row, { gap: metrics.gap, transform: [{ translateX }] }]}
    >
      {Array.from({ length: CODE_LENGTH }, (_, index) => {
        const char = value[index] ?? '';
        return (
          <View key={index} style={[styles.cellWrap, { width: metrics.width }]}>
            <TextInput
              ref={(node) => {
                cells.current[index] = node;
              }}
              testID={`${testID}-${index}`}
              accessibilityLabel={`${accessibilityLabel} ${index + 1}`}
              value={char}
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
                paint(char !== ''),
                {
                  height: metrics.height,
                  borderRadius: metrics.radius,
                  color: disabled ? colors['fg.muted'] : colors[FILLED_FG[state]],
                  fontFamily: fontFamilyFor(500, true),
                  fontSize: metrics.font,
                },
              ]}
            />
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center' },
  cellWrap: { flexShrink: 1 },
  cell: {
    width: '100%',
    textAlign: 'center',
    padding: 0,
    // A zero-width solid outline is the typed way to say `outline: none` on the web.
    outlineStyle: 'solid',
    outlineWidth: 0,
    fontVariant: ['tabular-nums'],
  },
});
