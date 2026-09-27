/**
 * Per-device UI preferences (04 §2, "界面偏好" layer).
 *
 * Web keys are `wallet:<name>` in localStorage; native keys are `@wallet_app:<name>` in
 * AsyncStorage (04 §2.2, §4.13, §5.1). This module is the only place that knows the prefix,
 * so callers just pass the bare name (`last_ledger_id`, `lang`, `theme`, `categories`,
 * `last_source:<ledgerId>`, ...). Nothing stored here is ever sent to the server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const PREF_NAMES = {
  lastLedgerId: 'last_ledger_id',
  /** The tab's own current ledger (decision §14.66 b) — a session pref, see below. */
  currentLedgerId: 'current_ledger_id',
  lang: 'lang',
  theme: 'theme',
  categories: 'categories',
  /** Written by 注册 and spent by the home page's one-shot card (04 §4.2). */
  onboardingHint: 'onboarding_hint',
  lastSource: (ledgerId: string) => `last_source:${ledgerId}`,
  recentMerchants: (ledgerId: string) => `recent_merchants:${ledgerId}`,
  recentCategories: (ledgerId: string) => `recent_categories:${ledgerId}`,
} as const;

/** Storage key for a preference name on the current platform. */
export function prefKey(name: string): string {
  return Platform.OS === 'web' ? `wallet:${name}` : `@wallet_app:${name}`;
}

function webStorage(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Synchronous read — web only (localStorage); always `null` on native. Use it for the
 *  values that must be known before first paint (theme, language). */
export function getPrefSync(name: string): string | null {
  const s = webStorage();
  if (!s) return null;
  try {
    return s.getItem(prefKey(name));
  } catch {
    return null;
  }
}

export async function getPref(name: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(prefKey(name));
  } catch {
    return null;
  }
}

/** `null` removes the preference. Failures (private mode, quota) are swallowed: a
 *  preference that fails to persist must never break the app. */
export async function setPref(name: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(prefKey(name));
    else await AsyncStorage.setItem(prefKey(name), value);
  } catch {
    /* ignore */
  }
}

export async function getJsonPref<T>(name: string): Promise<T | null> {
  const raw = await getPref(name);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getJsonPrefSync<T>(name: string): T | null {
  const raw = getPrefSync(name);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJsonPref(name: string, value: unknown | null): Promise<void> {
  await setPref(name, value === null ? null : JSON.stringify(value));
}

// ------------------------------------------------------------ per-tab (session) prefs

function webSessionStorage(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Synchronous read of a per-tab preference (decision §14.66 b): web `sessionStorage` under
 * the same `wallet:<name>` key, so a reload keeps it and a second tab has its own. Native
 * has no tabs, so there this read is always `null` and nothing is stored — the caller falls
 * back to the persistent preference it keeps beside it (`last_ledger_id`).
 */
export function getSessionPrefSync(name: string): string | null {
  if (Platform.OS !== 'web') return getPrefSync(name);
  const s = webSessionStorage();
  if (!s) return null;
  try {
    return s.getItem(prefKey(name));
  } catch {
    return null;
  }
}

/**
 * Write (or with `null`, remove) a per-tab preference; failures are swallowed like `setPref`.
 * A no-op on native: there is no tab, and the caller writes the persistent preference itself.
 */
export async function setSessionPref(name: string, value: string | null): Promise<void> {
  if (Platform.OS !== 'web') return;
  const s = webSessionStorage();
  if (!s) return;
  try {
    if (value === null) s.removeItem(prefKey(name));
    else s.setItem(prefKey(name), value);
  } catch {
    /* ignore */
  }
}
