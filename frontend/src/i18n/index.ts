/**
 * i18next bootstrap, language decision and runtime language switching (04 §5.1–§5.2).
 *
 * This module does NOT call `PATCH /me` — persisting a language choice to the server
 * is the settings page's and `AuthContext`'s job (04 §4.13, §2.1); this module only
 * ever reads/writes the local `lang` preference (`src/utils/prefs.ts`).
 */
import { Platform } from 'react-native';
import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import * as Localization from 'expo-localization';
import { PREF_NAMES, getPref, setPref } from '@/utils/prefs';
import { namespaces, resources } from './resources';

export const SUPPORTED_LANGS = ['zh', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

function isLang(value: unknown): value is Lang {
  return value === 'zh' || value === 'en';
}

/** The device's language code (e.g. `'zh'`, `'en'`), or `null` if it can't be read
 *  (web without a browser locale, a broken native module, ...). Never throws. */
export function deviceLanguage(): string | null {
  try {
    return Localization.getLocales()[0]?.languageCode ?? null;
  } catch {
    return null;
  }
}

/**
 * Pure language decision (04 §5.1): `user.language` (server) → the locally stored
 * `lang` pref → the device language (`zh-*` → `zh`, everything else → `en`) → `'zh'`.
 */
export function resolveLanguage(
  userLang: Lang | null | undefined,
  storedLang: string | null,
  deviceLang: string | null,
): Lang {
  if (isLang(userLang)) return userLang;
  if (isLang(storedLang)) return storedLang;
  if (deviceLang) return deviceLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  return 'zh';
}

function applyWebDocumentLang(lang: string): void {
  if (Platform.OS !== 'web') return;
  try {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  } catch {
    /* ignore */
  }
}

let initPromise: Promise<void> | null = null;

/** Idempotent: safe to call more than once (e.g. from multiple entry points during
 *  tests) — later calls resolve immediately once the first init has completed. */
export function initI18n(): Promise<void> {
  if (i18next.isInitialized) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const storedLang = await getPref(PREF_NAMES.lang);
    const lng = resolveLanguage(null, storedLang, deviceLanguage());
    await i18next.use(initReactI18next).init({
      lng,
      fallbackLng: 'zh',
      ns: namespaces,
      defaultNS: 'common',
      resources,
      interpolation: { escapeValue: false },
    });
    applyWebDocumentLang(i18next.language);
  })();
  return initPromise;
}

export interface ApplyLanguageOptions {
  /** Whether to write the choice to the local `lang` pref (default `true`). */
  persist?: boolean;
}

/**
 * `null` means "follow the system": clears the stored `lang` pref and switches to
 * whatever the device language resolves to. A non-null `lang` switches i18next and
 * persists it (04 §5.1, §4.13 — `language: null` on the server means the same thing,
 * but writing that is the caller's job, not this function's).
 */
export async function applyLanguage(lang: Lang | null, opts?: ApplyLanguageOptions): Promise<void> {
  const persist = opts?.persist ?? true;
  if (lang === null) {
    if (persist) await setPref(PREF_NAMES.lang, null);
    const device = deviceLanguage();
    const next: Lang = device && device.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    await i18next.changeLanguage(next);
  } else {
    await i18next.changeLanguage(lang);
    if (persist) await setPref(PREF_NAMES.lang, lang);
  }
  applyWebDocumentLang(i18next.language);
}

function normalizeLang(tag: string): Lang {
  return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** The current language, re-rendering the caller whenever it changes. */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return normalizeLang(i18n.language);
}

export { namespaces, resources } from './resources';
export default i18next;
