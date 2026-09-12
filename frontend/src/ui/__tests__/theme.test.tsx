/**
 * ThemeProvider (04 §4.13 "外观"), the breakpoint (decision §0.6) and font resolution
 * (04 §6.3).
 */
import React from 'react';
import { Appearance, Pressable, Text as RNText, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider, parseThemePref, useTheme } from '@/theme/ThemeProvider';
import { breakpoint, darkColors, lightColors } from '@/theme/tokens';
import { isWide } from '@/theme/useBreakpoint';
import {
  APP_FONT_FAMILIES,
  MONO_BY_WEIGHT,
  SANS_BY_WEIGHT,
  fontFamilyFor,
} from '@/theme/fonts';
import * as prefs from '@/utils/prefs';
import { PREF_NAMES, prefKey } from '@/utils/prefs';

function Probe(): React.JSX.Element {
  const { scheme, colors, pref, setPref } = useTheme();
  return (
    <View>
      <RNText testID="scheme">{scheme}</RNText>
      <RNText testID="pref">{pref}</RNText>
      <RNText testID="canvas">{colors['bg.canvas']}</RNText>
      <Pressable
        testID="to-dark"
        onPress={() => {
          void setPref('dark');
        }}
      >
        <RNText>to dark</RNText>
      </Pressable>
      <Pressable
        testID="to-system"
        onPress={() => {
          void setPref('system');
        }}
      >
        <RNText>to system</RNText>
      </Pressable>
    </View>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('ThemeProvider', () => {
  test('an explicit preference picks the matching palette', () => {
    const light = render(
      <ThemeProvider initialPref="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('canvas')).toHaveTextContent(lightColors['bg.canvas']);
    expect(screen.getByTestId('scheme')).toHaveTextContent('light');
    light.unmount();

    render(
      <ThemeProvider initialPref="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('canvas')).toHaveTextContent(darkColors['bg.canvas']);
    expect(screen.getByTestId('scheme')).toHaveTextContent('dark');
  });

  test('the stored preference is read back on mount', async () => {
    await AsyncStorage.setItem(prefKey(PREF_NAMES.theme), 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('pref')).toHaveTextContent('dark'));
    expect(screen.getByTestId('canvas')).toHaveTextContent(darkColors['bg.canvas']);
  });

  test('setPref switches the palette and persists it per device', async () => {
    render(
      <ThemeProvider initialPref="light">
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId('to-dark'));
    await waitFor(() =>
      expect(screen.getByTestId('canvas')).toHaveTextContent(darkColors['bg.canvas']),
    );
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(prefKey(PREF_NAMES.theme))).toBe('dark'),
    );
  });

  test('"system" follows the OS and keeps following it when it changes', async () => {
    let notify: ((p: { colorScheme: 'light' | 'dark' | null }) => void) | undefined;
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    jest
      .spyOn(Appearance, 'addChangeListener')
      .mockImplementation((listener: (p: { colorScheme: 'light' | 'dark' | null }) => void) => {
        notify = listener;
        return { remove: () => undefined };
      });

    render(
      <ThemeProvider initialPref="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('scheme')).toHaveTextContent('dark');
    expect(screen.getByTestId('canvas')).toHaveTextContent(darkColors['bg.canvas']);

    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
    act(() => notify?.({ colorScheme: 'light' }));
    expect(screen.getByTestId('scheme')).toHaveTextContent('light');
    expect(screen.getByTestId('canvas')).toHaveTextContent(lightColors['bg.canvas']);
  });

  test('a choice made while the stored value is still loading is not overwritten', async () => {
    // Native storage is asynchronous: hold the read open, flip the switch, then let the
    // (now stale) stored value arrive.
    let release: ((raw: string | null) => void) | undefined;
    jest.spyOn(prefs, 'getPref').mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          release = resolve;
        }),
    );

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId('to-dark'));
    await waitFor(() => expect(screen.getByTestId('pref')).toHaveTextContent('dark'));

    await act(async () => {
      release?.('light');
    });

    expect(screen.getByTestId('pref')).toHaveTextContent('dark');
    expect(screen.getByTestId('canvas')).toHaveTextContent(darkColors['bg.canvas']);
  });

  test('an unknown stored value falls back to "system"', () => {
    expect(parseThemePref('sepia')).toBe('system');
    expect(parseThemePref(null)).toBe('system');
    expect(parseThemePref('dark')).toBe('dark');
  });
});

describe('breakpoint', () => {
  test('the boundary is 1024 inclusive', () => {
    expect(breakpoint.md).toBe(1024);
    expect(isWide(1023)).toBe(false);
    expect(isWide(1024)).toBe(true);
    expect(isWide(1440)).toBe(true);
  });
});

describe('fonts', () => {
  test('weights map onto the loaded faces, and unknown weights snap to the nearest', () => {
    expect(fontFamilyFor(400)).toBe(SANS_BY_WEIGHT[400]);
    expect(fontFamilyFor(600)).toBe(SANS_BY_WEIGHT[600]);
    // tokens.json asks for mono 450; only 400 and 500 exist, 450 snaps to the first match.
    expect(fontFamilyFor(450, true)).toBe(MONO_BY_WEIGHT[400]);
    expect(fontFamilyFor(700, true)).toBe(MONO_BY_WEIGHT[500]);
  });

  test('every family a weight can resolve to is one the app loads', () => {
    for (const weight of [100, 400, 450, 500, 600, 700, 900]) {
      expect(APP_FONT_FAMILIES).toContain(fontFamilyFor(weight));
      expect(APP_FONT_FAMILIES).toContain(fontFamilyFor(weight, true));
    }
  });
});
