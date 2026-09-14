/**
 * Workbox `generateSW` config (04 §7.1, §7.2).
 *
 * Consumed by `npx workbox generateSW workbox-config.cjs` (chained in package.json's
 * `build:web` AFTER `expo export -p web`, so Workbox sees the final hashed chunks in
 * `dist/`).
 *
 * Shape:
 *  - skipWaiting + clientsClaim + cleanupOutdatedCaches all `true`. A new worker takes
 *    over immediately; the takeover raises the "refresh to use the new version" toast
 *    client-side (`src/navigation/useSwUpdateToast.ts`, 04 §7.2 last row).
 *  - globIgnores excludes sw.js + workbox-*.js so the SW never precaches itself.
 *  - `navigateFallback: '/index.html'` (04 §7.2 row 1). v3.0 has real routes (§1.2) and
 *    deep links are a core feature, so every navigation must be answered by the app
 *    shell. `offline.html` stays in the precache as a last resort but is NOT the
 *    navigation fallback any more — with it in that slot, refreshing
 *    `/l/xxx/transactions` rendered the offline page even while online.
 *  - `navigateFallbackDenylist: [/^\/api/]` so API calls are never answered with HTML.
 *  - dontCacheBustURLsMatching trusts Expo's content-hashed filenames.
 *  - maximumFileSizeToCacheInBytes is raised past Workbox's 2 MiB default so the ~4 MB
 *    Expo entry bundle is precached — without it the precached shell has no script and
 *    an offline navigation is a blank page.
 *  - runtimeCaching, in match order (the Workbox router takes the FIRST matching route):
 *      1. app shell — NetworkFirst, so a freshly deployed shell reaches the user.
 *      2. the three immutable, ledger-independent GETs (`/api/v1/categories`,
 *         `/api/v1/import-format`, `/api/v1/rates/currencies`) — CacheFirst, 30 days.
 *      3. every other `/api/` GET — NetworkOnly (04 §7.2 row 2): ledger data is shared
 *         between people, and a stale SW-cached copy of someone else's edit is worse
 *         than an error. Cache keys are URLs, so they also do not change with the user.
 *      4. fonts — CacheFirst, 30 days.
 *      5. images — CacheFirst, 30 days.
 *
 * The `urlPattern`s for `/api/` are functions rather than regexes on purpose: Workbox
 * serialises them verbatim, so the generated `sw.js` carries the literal `'/api/'` that
 * `scripts/verify-pwa.mjs --check=sw` asserts on. They must stay self-contained — the
 * function source is stringified into the worker, so it cannot close over anything here.
 *
 * Extension is `.cjs` (not `.js`) because package.json has no `"type": "module"` and
 * workbox-cli expects CJS.
 */

const THIRTY_DAYS = 60 * 60 * 24 * 30;

module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*.{js,css,html,png,svg,jpg,jpeg,webp,woff,woff2,ico,json}'],
  globIgnores: ['**/sw.js', '**/workbox-*.js'],
  swDest: 'dist/sw.js',
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/api/],
  dontCacheBustURLsMatching: /\.[0-9a-f]{20,}\./,
  // Workbox's default cap is 2 MiB, and Expo's single entry bundle is ~4 MB — with the
  // default the app shell precaches without its only <script>, so an offline navigation
  // (which `navigateFallback` now answers with /index.html) renders a blank page and
  // `offline.html` can never be reached. 6 MiB keeps the whole shell installable.
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  runtimeCaching: [
    {
      // App shell — always try network first so a freshly deployed /index.html reaches
      // the user on the next navigation/refresh.
      urlPattern: ({ url }) => url.pathname === '/' || url.pathname === '/index.html',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'app-shell',
        networkTimeoutSeconds: 3,
      },
    },
    {
      // The category table, the import format and the currency list: public, versioned,
      // and identical for every user — the only API responses safe to serve from disk.
      urlPattern: ({ url }) =>
        url.pathname === '/api/v1/categories' ||
        url.pathname === '/api/v1/import-format' ||
        url.pathname === '/api/v1/rates/currencies',
      handler: 'CacheFirst',
      options: {
        cacheName: 'api-cache',
        expiration: { maxAgeSeconds: THIRTY_DAYS },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      // Everything else under /api/ — never served from disk (04 §7.2 row 2).
      urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
      handler: 'NetworkOnly',
    },
    {
      // Fonts — immutable; CacheFirst with a 30-day expiry.
      urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'fonts',
        expiration: { maxAgeSeconds: THIRTY_DAYS },
      },
    },
    {
      // Images — content-hashed; CacheFirst with a 30-day expiry.
      urlPattern: /\.(?:png|jpe?g|svg|webp|ico)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxAgeSeconds: THIRTY_DAYS },
      },
    },
  ],
};
