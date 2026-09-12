/**
 * Theme provider (04 §6.2, §4.13 "外观").
 *
 * Three preference values — `system` / `light` / `dark` — persisted per device only
 * (`prefs` key `theme`, never sent to the server, decision §14.52 A23). `system` follows
 * `Appearance`, which react-native-web maps onto `prefers-color-scheme`.
 */
import React from 'react';
import { Appearance } from 'react-native';
import { PREF_NAMES, getPrefSync, getPref, setPref } from '@/utils/prefs';
import { type ColorScheme, type Palette, palettes } from './tokens';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];

/** Narrow an arbitrary stored string to a valid preference (anything else → `system`). */
export function parseThemePref(raw: string | null | undefined): ThemePref {
  return raw !== null && raw !== undefined && (THEME_PREFS as readonly string[]).includes(raw)
    ? (raw as ThemePref)
    : 'system';
}

export interface ThemeValue {
  /** The scheme actually in effect right now. */
  scheme: ColorScheme;
  colors: Palette;
  pref: ThemePref;
  setPref(next: ThemePref): Promise<void>;
}

const ThemeContext = React.createContext<ThemeValue | null>(null);

function subscribeToAppearance(onChange: () => void): () => void {
  const sub = Appearance.addChangeListener(() => onChange());
  return () => sub.remove();
}

function systemSchemeSnapshot(): ColorScheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/** The OS colour scheme, kept live through `Appearance.addChangeListener`. */
export function useSystemScheme(): ColorScheme {
  return React.useSyncExternalStore(
    subscribeToAppearance,
    systemSchemeSnapshot,
    systemSchemeSnapshot,
  );
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Overrides the stored preference (tests, and the root layout's SSR-ish first paint). */
  initialPref?: ThemePref;
}

export function ThemeProvider({ children, initialPref }: ThemeProviderProps): React.JSX.Element {
  // Web reads synchronously so the first paint already has the right palette; native has
  // no synchronous storage, so it starts at `system` and settles one tick later.
  const [pref, setPrefState] = React.useState<ThemePref>(
    () => initialPref ?? parseThemePref(getPrefSync(PREF_NAMES.theme)),
  );
  const [hydrated, setHydrated] = React.useState(initialPref !== undefined);

  React.useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    void getPref(PREF_NAMES.theme).then((raw) => {
      if (cancelled) return;
      setPrefState(parseThemePref(raw));
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const systemScheme = useSystemScheme();
  const scheme: ColorScheme = pref === 'system' ? systemScheme : pref;

  const value = React.useMemo<ThemeValue>(
    () => ({
      scheme,
      colors: palettes[scheme],
      pref,
      async setPref(next: ThemePref) {
        setPrefState(next);
        setHydrated(true);
        await setPref(PREF_NAMES.theme, next);
      },
    }),
    [scheme, pref],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Light palette outside a provider so isolated component tests still render. */
const FALLBACK: ThemeValue = {
  scheme: 'light',
  colors: palettes.light,
  pref: 'system',
  async setPref() {
    /* no provider: nothing to persist */
  },
};

export function useTheme(): ThemeValue {
  return React.useContext(ThemeContext) ?? FALLBACK;
}

/** Shortcut for the common `useTheme().colors`. */
export function useColors(): Palette {
  return useTheme().colors;
}
