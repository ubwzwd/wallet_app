import { Platform } from 'react-native';
import {
  PREF_NAMES,
  getJsonPref,
  getPref,
  getSessionPrefSync,
  prefKey,
  setJsonPref,
  setPref,
  setSessionPref,
} from '../prefs';

test('keys are prefixed per platform', () => {
  expect(prefKey('lang')).toBe(Platform.OS === 'web' ? 'wallet:lang' : '@wallet_app:lang');
});

test('set / get / remove round-trip through AsyncStorage', async () => {
  await setPref('lang', 'en');
  expect(await getPref('lang')).toBe('en');
  await setPref('lang', null);
  expect(await getPref('lang')).toBeNull();
  await setJsonPref('categories', { version: '2026-09-10' });
  expect(await getJsonPref<{ version: string }>('categories')).toEqual({ version: '2026-09-10' });
});

/** A `Storage` that only lives in this test: one per "tab". */
function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

describe('per-tab prefs (decision §14.66 b)', () => {
  const scope = globalThis as { sessionStorage?: Storage };

  describe('on the web', () => {
    let restorePlatform: () => void;
    let tab: Storage;

    beforeEach(() => {
      const replaced = jest.replaceProperty(Platform, 'OS', 'web');
      restorePlatform = () => replaced.restore();
      tab = fakeStorage();
      scope.sessionStorage = tab;
    });

    afterEach(() => {
      restorePlatform();
      delete scope.sessionStorage;
    });

    test('live in sessionStorage under the wallet: prefix, read back synchronously', async () => {
      expect(getSessionPrefSync(PREF_NAMES.currentLedgerId)).toBeNull();

      await setSessionPref(PREF_NAMES.currentLedgerId, 'ledger-b');

      expect(tab.getItem('wallet:current_ledger_id')).toBe('ledger-b');
      expect(getSessionPrefSync(PREF_NAMES.currentLedgerId)).toBe('ledger-b');
    });

    test('null removes the value', async () => {
      await setSessionPref(PREF_NAMES.currentLedgerId, 'ledger-b');
      await setSessionPref(PREF_NAMES.currentLedgerId, null);
      expect(tab.getItem('wallet:current_ledger_id')).toBeNull();
      expect(getSessionPrefSync(PREF_NAMES.currentLedgerId)).toBeNull();
    });

    test('another tab has its own value', async () => {
      await setSessionPref(PREF_NAMES.currentLedgerId, 'ledger-a');
      scope.sessionStorage = fakeStorage();
      expect(getSessionPrefSync(PREF_NAMES.currentLedgerId)).toBeNull();
    });

    test('a storage that throws is swallowed, never thrown at the caller', async () => {
      const broken = fakeStorage();
      broken.getItem = () => {
        throw new Error('blocked');
      };
      broken.setItem = () => {
        throw new Error('quota');
      };
      scope.sessionStorage = broken;
      await expect(setSessionPref(PREF_NAMES.currentLedgerId, 'x')).resolves.toBeUndefined();
      expect(getSessionPrefSync(PREF_NAMES.currentLedgerId)).toBeNull();
    });
  });

  describe('on native', () => {
    test('degrade to an ordinary preference, with no synchronous read', async () => {
      if (Platform.OS === 'web') return;
      await setSessionPref(PREF_NAMES.currentLedgerId, 'ledger-b');
      expect(await getPref(PREF_NAMES.currentLedgerId)).toBe('ledger-b');
      expect(getSessionPrefSync(PREF_NAMES.currentLedgerId)).toBeNull();
      await setSessionPref(PREF_NAMES.currentLedgerId, null);
      expect(await getPref(PREF_NAMES.currentLedgerId)).toBeNull();
    });
  });
});
