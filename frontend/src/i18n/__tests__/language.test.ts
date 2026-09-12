/**
 * Language-decision tests (04 §5.1, §8.1): the four-level `resolveLanguage` order,
 * and `applyLanguage(null)` following the device language and clearing the pref.
 */
import i18next from 'i18next';
import { getPref, setPref, PREF_NAMES } from '@/utils/prefs';
import { initI18n, resolveLanguage, applyLanguage } from '../index';

// Device language is mocked per-test; default here is Chinese.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'zh' }],
}));

describe('resolveLanguage (pure, no i18next involved)', () => {
  test('1. user.language wins over everything else', () => {
    expect(resolveLanguage('en', 'zh', 'zh-CN')).toBe('en');
  });

  test('2. the stored pref wins over the device language', () => {
    expect(resolveLanguage(null, 'en', 'zh-CN')).toBe('en');
    expect(resolveLanguage(undefined, 'zh', 'en-US')).toBe('zh');
  });

  test('3. the device language wins over the zh default (zh-* -> zh, else -> en)', () => {
    expect(resolveLanguage(null, null, 'zh-CN')).toBe('zh');
    expect(resolveLanguage(null, null, 'zh')).toBe('zh');
    expect(resolveLanguage(null, null, 'fr-FR')).toBe('en');
    expect(resolveLanguage(null, null, 'ja')).toBe('en');
  });

  test('4. falls back to zh when nothing else is known', () => {
    expect(resolveLanguage(null, null, null)).toBe('zh');
  });

  test('ignores an invalid stored value instead of crashing', () => {
    expect(resolveLanguage(null, 'fr', 'en-US')).toBe('en');
  });
});

describe('initI18n + applyLanguage', () => {
  beforeAll(async () => {
    await initI18n();
  });

  test('initI18n is idempotent', async () => {
    await expect(initI18n()).resolves.toBeUndefined();
    await expect(initI18n()).resolves.toBeUndefined();
  });

  test('applyLanguage(null) clears the stored pref and follows the device language', async () => {
    await setPref(PREF_NAMES.lang, 'en');
    expect(await getPref(PREF_NAMES.lang)).toBe('en');

    await applyLanguage(null);

    expect(await getPref(PREF_NAMES.lang)).toBeNull();
    // The mocked device language is 'zh'.
    expect(i18next.language).toBe('zh');
  });

  test('applyLanguage(lang) switches i18next and persists the pref', async () => {
    await applyLanguage('en');
    expect(i18next.language).toBe('en');
    expect(await getPref(PREF_NAMES.lang)).toBe('en');

    await applyLanguage('zh');
    expect(i18next.language).toBe('zh');
    expect(await getPref(PREF_NAMES.lang)).toBe('zh');
  });

  test('applyLanguage(lang, {persist: false}) switches without writing the pref', async () => {
    await setPref(PREF_NAMES.lang, 'zh');
    await applyLanguage('en', { persist: false });
    expect(i18next.language).toBe('en');
    expect(await getPref(PREF_NAMES.lang)).toBe('zh');
  });
});
