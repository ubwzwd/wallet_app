/**
 * Workbox `generateSW` config (PWA-04, Phase 5 plan 05-03).
 *
 * Consumed by `npx workbox generateSW workbox-config.cjs` (chained in
 * `package.json` build:web AFTER `expo export -p web`, so Workbox sees the
 * final hashed chunks in `dist/`).
 *
 * Locked shape (CONTEXT D-04 + PATTERNS § workbox-config.cjs):
 *  - skipWaiting + clientsClaim + cleanupOutdatedCaches all `true`
 *    (ROADMAP SC-3 silent-update path: a new SW activates and claims clients
 *    immediately on install; NetworkFirst on /index.html then surfaces the
 *    fresh shell on the next navigation/refresh — no UpdateToast UI).
 *  - globIgnores excludes sw.js + workbox-*.js so the SW never precaches
 *    itself (RESEARCH § Anti-Pattern "Caching sw.js itself" — unrecoverable).
 *  - navigateFallback → /offline.html so cold offline loads still render.
 *  - dontCacheBustURLsMatching trusts Expo's 32-hex content-hashed filenames.
 *  - runtimeCaching: 4 entries in the locked order — NetworkFirst on the app
 *    shell, NetworkFirst on /api/*, CacheFirst on fonts (30d), CacheFirst on
 *    images (30d).
 *
 * Style mirror: jest.config.js (the project's existing CommonJS-config style).
 * Extension is `.cjs` (not `.js`) because the package.json has no
 * `"type": "module"` declaration and workbox-cli expects CJS by default.
 */
module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*.{js,css,html,png,svg,jpg,jpeg,webp,woff,woff2,ico,json}'],
  globIgnores: ['**/sw.js', '**/workbox-*.js'],
  swDest: 'dist/sw.js',
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  navigateFallback: '/offline.html',
  navigateFallbackDenylist: [/^\/api/],
  dontCacheBustURLsMatching: /\.[0-9a-f]{20,}\./,
  runtimeCaching: [
    {
      // App shell — always try network first so a freshly deployed
      // /index.html reaches the user on the next navigation/refresh.
      urlPattern: ({ url }) => url.pathname === '/' || url.pathname === '/index.html',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'app-shell',
        networkTimeoutSeconds: 3,
      },
    },
    {
      // API responses — NetworkFirst with a 5s timeout so the user gets fresh
      // data when online and a recent cached payload when offline.
      urlPattern: /\/api\//,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        networkTimeoutSeconds: 5,
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      // Fonts — immutable; CacheFirst with a 30-day expiry.
      urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'fonts',
        expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      // Images — content-hashed; CacheFirst with a 30-day expiry.
      urlPattern: /\.(?:png|jpe?g|svg|webp|ico)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ],
};
