/**
 * registerSW.ts — Web-only service worker registration (04 §7).
 *
 * Imported for side-effect only: `import '@/pwa/registerSW'` at the top of
 * `app/_layout.tsx`. On native the platform guard returns false and the module is a
 * complete no-op, so it is safe to import unconditionally.
 *
 * Two deliberate limits:
 *  - **Production only.** `dist/sw.js` is produced by `workbox generateSW` during
 *    `build:web`; it does not exist under `expo start --web`, and a worker registered in
 *    development would serve stale bundles back over the dev server. `NODE_ENV` is
 *    inlined at bundle time, so this whole block disappears from the dev bundle.
 *  - **Registration only.** The "a new version took over, refresh" toast lives in
 *    `src/navigation/useSwUpdateToast.ts` (04 §7.2, last row), which listens for
 *    `controllerchange` inside the React tree where the language pack and the toast host
 *    are available. Do not duplicate that listener here.
 */
import { Platform } from 'react-native';

if (
  process.env.NODE_ENV === 'production' &&
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator
) {
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
