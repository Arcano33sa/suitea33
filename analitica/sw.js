/* Suite A33 — analitica: apertura offline con caché aislada. */
try { importScripts('/assets/js/a33-release.js?v=4.20.98&r=54'); } catch (_) {}
const VERSION = self.A33_RELEASE ? String(self.A33_RELEASE.suiteVersion) : '4.20.98';
const REV = self.A33_RELEASE ? String(self.A33_RELEASE.rev) : '5';
const CACHE = `a33-v${VERSION}-analitica-r${REV}-m3`;
const PRECACHE = [
  './',
  './index.html',
  './style.css?v=4.20.98&r=9',
  './script.js?v=4.20.98&r=13',
  '../inventario/images/logo.png',
  '/assets/js/a33-theme.js?v=4.20.98&r=7',
  '/assets/css/a33-theme.css?v=4.20.98&r=7',
  '/assets/js/a33-currency.js?v=4.20.98&r=14',
  '/assets/js/a33-export-currency.js?v=4.20.98&r=2',
  '/assets/js/a33-input-ux.js?v=4.20.98&r=7',
  '/assets/js/a33-lot-code.js?v=4.20.98&r=6',
  '/assets/js/a33-notify.js?v=4.20.98&r=1',
  '/assets/js/a33-notify-bridge.js?v=4.20.98&r=2',
  '/assets/css/a33-notify.css?v=4.20.98&r=1',
  '/assets/js/a33-release.js?v=4.20.98&r=54',
  '/assets/js/a33-module-nav.js?v=4.20.98&r=3',
  '/assets/js/a33-storage.js?v=4.20.98&r=22',
  '/assets/js/a33-presentations.js?v=4.20.98&r=15',
  '/assets/css/a33-header.css?v=4.20.98&r=7',
  '/assets/css/a33-module-nav.css?v=4.20.98&r=3',
  '../pos/vendor/xlsx.full.min.js?v=4.20.98&r=13'
];
const INDEX_URL = new URL('./index.html', self.registration.scope).href;
const MODULE_URL = new URL('./', self.registration.scope).href;
const ASSET_URLS = new Set(PRECACHE.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(PRECACHE);
  // Solo primera instalación: las actualizaciones esperan aprobación en Configuración.
  if (!self.registration.active) await self.skipWaiting();
})()));
self.addEventListener('activate', event => {
  // No borra cachés existentes, ni del módulo ni de otros módulos.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const clean = new URL(url.href);
  clean.search = ''; clean.hash = '';
  if (event.request.mode === 'navigate') {
    if (clean.href !== INDEX_URL && clean.href !== MODULE_URL) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(INDEX_URL, response.clone()).catch(() => {});
        return response;
      } catch (_) {
        const hit = await cache.match(INDEX_URL);
        return hit || Response.error();
      }
    })());
    return;
  }
  // Incluye vendor POS e imagen compartida, sin interceptar navegación a otros módulos.
  if (!ASSET_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    return fetch(event.request);
  })());
});
