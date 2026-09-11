import { Platform } from 'react-native';
import { getJsonPref, getPref, prefKey, setJsonPref, setPref } from '../prefs';

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
