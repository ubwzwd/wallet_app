/**
 * Language-decision tests (04 §5.1, §8.1): the four-level `resolveLanguage` order,
 * and `applyLanguage(null)` following the device language and clearing the pref.
 */
import { Platform } from 'react-native';
import i18next from 'i18next';
import { getPref, setPref, PREF_NAMES } from '@/utils/prefs';
import { initI18n, resolveLanguage, applyLanguage } from '../index';

// The device language the mocked `expo-localization` reports; Chinese unless a test
// changes it (the `mock` prefix is what lets the factory below close over it).
let mockDeviceLang = 'zh';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: mockDeviceLang }],
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

  test('web: "follow the system" tracks the browser through `languagechange`', async () => {
    const handlers: Array<() => void> = [];
    const w = window as unknown as {
      addEventListener?: (type: string, h: () => void) => void;
      removeEventListener?: (type: string, h: () => void) => void;
    };
    const platform = Platform as unknown as { OS: string };
    const previous = { os: platform.OS, add: w.addEventListener, remove: w.removeEventListener };
    const add = jest.fn((type: string, h: () => void) => {
      if (type === 'languagechange') handlers.push(h);
    });
    const remove = jest.fn();
    w.addEventListener = add;
    w.removeEventListener = remove;
    platform.OS = 'web';

    try {
      mockDeviceLang = 'zh';
      await applyLanguage(null);
      expect(add).toHaveBeenCalledWith('languagechange', expect.any(Function));
      expect(i18next.language).toBe('zh');

      // The browser's language list changed under us.
      mockDeviceLang = 'fr';
      handlers[0]();
      await new Promise((r) => setTimeout(r, 0));
      expect(i18next.language).toBe('en'); // anything non-zh resolves to en
      // Following the system must not have written a stored choice.
      expect(await getPref(PREF_NAMES.lang)).toBeNull();

      // An explicit choice stops the app from following the device.
      await applyLanguage('zh');
      expect(remove).toHaveBeenCalledWith('languagechange', expect.any(Function));
    } finally {
      platform.OS = previous.os;
      w.addEventListener = previous.add;
      w.removeEventListener = previous.remove;
      mockDeviceLang = 'zh';
    }
  });
});

describe('initI18n retries after a failure', () => {
  test('a rejected init drops the memo instead of caching the failure', async () => {
    await jest.isolateModulesAsync(async () => {
      const prefs = require('@/utils/prefs') as typeof import('@/utils/prefs');
      const spy = jest
        .spyOn(prefs, 'getPref')
        .mockRejectedValueOnce(new Error('storage unavailable'));
      const mod = require('../index') as typeof import('../index');

      await expect(mod.initI18n()).rejects.toThrow('storage unavailable');
      // The memo is gone, so the second attempt actually runs (and succeeds).
      await expect(mod.initI18n()).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(mod.default.isInitialized).toBe(true);
    });
  });
});

describe('useLang', () => {
  test('falls back to zh when i18next has not settled on a language yet', () => {
    jest.isolateModules(() => {
      jest.doMock('react-i18next', () => ({
        initReactI18next: { type: '3rdParty', init: () => undefined },
        useTranslation: () => ({ i18n: {} }),
      }));
      const mod = require('../index') as typeof import('../index');
      // `useLang` only reads `useTranslation()`, so it can be called outside a component.
      expect(mod.useLang()).toBe('zh');
    });
  });
});
