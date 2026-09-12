/**
 * Font loading and family resolution (04 §6.3).
 *
 * Figtree carries UI + prose in four weights; IBM Plex Mono carries money / dates / row
 * numbers. tokens.json asks for mono weight 450, which Google Fonts does not ship — 400 and
 * 500 stand in for it.
 *
 * `expo-font` and the two font packages are pulled in lazily, inside `useAppFonts`: they
 * reach for native asset modules that nothing else in the app (or in a unit test) needs,
 * while `fontFamilyFor` — which every `Text` calls — must stay a pure string lookup.
 */
import { Platform } from 'react-native';
import { font } from './tokens';

export type SansWeight = 400 | 500 | 600 | 700;
export type MonoWeight = 400 | 500;

export const FONT_SANS = 'Figtree_400Regular';
export const FONT_MONO = 'IBMPlexMono_400Regular';

export const SANS_BY_WEIGHT: Readonly<Record<SansWeight, string>> = {
  400: 'Figtree_400Regular',
  500: 'Figtree_500Medium',
  600: 'Figtree_600SemiBold',
  700: 'Figtree_700Bold',
};

export const MONO_BY_WEIGHT: Readonly<Record<MonoWeight, string>> = {
  400: 'IBMPlexMono_400Regular',
  500: 'IBMPlexMono_500Medium',
};

/** Family names the app loads, in the order `useAppFonts` registers them. */
export const APP_FONT_FAMILIES: readonly string[] = [
  ...Object.values(SANS_BY_WEIGHT),
  ...Object.values(MONO_BY_WEIGHT),
];

function nearest<T extends number>(weight: number, available: readonly T[]): T {
  let best = available[0] as T;
  let bestDistance = Math.abs(weight - best);
  for (const candidate of available) {
    const distance = Math.abs(weight - candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

const SANS_WEIGHTS: readonly SansWeight[] = [400, 500, 600, 700];
const MONO_WEIGHTS: readonly MonoWeight[] = [400, 500];

/**
 * Family name for a weight. On web the loaded family is followed by the fallback stack from
 * tokens.json so Chinese glyphs (which Figtree does not carry) land on a system font.
 */
export function fontFamilyFor(weight: number, mono = false): string {
  const family = mono
    ? MONO_BY_WEIGHT[nearest(weight, MONO_WEIGHTS)]
    : SANS_BY_WEIGHT[nearest(weight, SANS_WEIGHTS)];
  if (Platform.OS !== 'web') return family;
  const fallback = mono ? font.mono.fallback : font.sans.fallback;
  return `${family}, ${fallback}`;
}

type FontSource = number | string;
type UseFontsHook = (map: Record<string, FontSource>) => [boolean, Error | null];

/** The `{family: asset}` map handed to `expo-font`, built on first use. */
export function appFontMap(): Record<string, FontSource> {
  const sans = require('@expo-google-fonts/figtree') as Record<string, FontSource>;
  const mono = require('@expo-google-fonts/ibm-plex-mono') as Record<string, FontSource>;
  const map: Record<string, FontSource> = {};
  for (const family of Object.values(SANS_BY_WEIGHT)) map[family] = sans[family];
  for (const family of Object.values(MONO_BY_WEIGHT)) map[family] = mono[family];
  return map;
}

/** `true` once every face is ready; the app shell renders the tree only then. */
export function useAppFonts(): boolean {
  const { useFonts } = require('expo-font') as { useFonts: UseFontsHook };
  const [loaded] = useFonts(appFontMap());
  return loaded;
}
