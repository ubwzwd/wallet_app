/**
 * registerSW.ts — Web-only service worker registration (PWA-04, Phase 5 plan 05-03).
 *
 * Imported for side-effect only: `import '@/pwa/registerSW'` (wired in 05-05).
 * On web, registers `/sw.js` on `window`'s `load` event and logs the result.
 * On native (Expo Go iOS/Android), the guard returns false and this module
 * is a complete no-op — safe to import unconditionally from App.tsx.
 *
 * Per the revised D-07 (2026-05-24), this module is intentionally minimal:
 * register + log. The silent-takeover path is handled entirely SW-side via
 * Workbox's lifecycle flags (configured in workbox-config.cjs, ROADMAP SC-3
 * preserved). NetworkFirst on `/index.html` surfaces the fresh shell on the
 * next nav/refresh — no client-side update hook, no UI surface.
 *
 * Analog: src/utils/queryClient.ts — module-level singleton init,
 * side-effect-on-import idiom.
 */
import { Platform } from 'react-native';

if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {
        console.log('[pwa] service worker registered');
      })
      .catch((err) => {
        // Never throw — app boot must never break because of PWA registration.
        console.warn('[pwa] service worker registration failed', err);
      });
  });
}
