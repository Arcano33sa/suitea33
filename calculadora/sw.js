/* Suite A33 — Service Worker (Calculadora de Producción) */
try { importScripts('/assets/js/a33-release.js?v=4.20.88&r=51'); } catch (e) {}

const SW_VERSION = (self.A33_RELEASE && self.A33_RELEASE.suiteVersion) ? String(self.A33_RELEASE.suiteVersion) : '4.20.88';
const SW_REV = (self.A33_RELEASE && self.A33_RELEASE.rev !== undefined && self.A33_RELEASE.rev !== null) ? String(self.A33_RELEASE.rev) : '1';
const MODULE = 'calculadora';
const MODULE_CACHE_REV = '2';
const CACHE_NAME = `a33-v${SW_VERSION}-${MODULE}-r${SW_REV}-m${MODULE_CACHE_REV}`;

const PRECACHE_URLS = [
  './',
  './index.html?v=4.20.88&r=12',
  './manifest.webmanifest?v=4.20.88&r=10',
  './logo-icon-192.png',
  './logo-icon-512.png',
  '/assets/js/a33-release.js?v=4.20.88&r=51',
  '/assets/js/a33-storage.js?v=4.20.88&r=20',
  '/assets/js/a33-production.js?v=4.20.88&r=4',
  '/assets/js/a33-currency.js?v=4.20.88&r=14',
  '/assets/js/a33-presentations.js?v=4.20.88&r=15',
  '/assets/js/a33-input-ux.js?v=4.20.88&r=7',
  '/assets/js/a33-theme.js?v=4.20.88&r=7',
  '/assets/css/a33-header.css?v=4.20.88&r=7',
  '/assets/css/a33-theme.css?v=4.20.88&r=7'
];

function sameOrigin(url){ try { return url.origin === self.location.origin; } catch (_) { return false; } }
function shouldCache(url){
  try {
    const scopePath = new URL(self.registration.scope).pathname;
    return url.pathname.startsWith(scopePath) || url.pathname.startsWith('/assets/');
  } catch (_) { return false; }
}

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const victims = keys.filter((name) => {
      const value = String(name || '').toLowerCase();
      const sameModule = value.startsWith('a33-') && value.includes(`-${MODULE}`) && value !== CACHE_NAME.toLowerCase();
      const legacy = (value.startsWith('a33-') || value.startsWith('arcano33-')) && value.includes('calculadora_a33');
      return sameModule || legacy;
    });
    await Promise.all(victims.map((name) => caches.delete(name).catch(() => false)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!sameOrigin(url)) return;
  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response && response.status === 200 && shouldCache(url)) cache.put(event.request, response.clone()).catch(() => {});
      return response;
    } catch (_) {
      return (await cache.match(event.request))
        || (isNavigation ? (await cache.match('./index.html?v=4.20.88&r=12')) || (await cache.match('./')) : null)
        || new Response('Offline', { status:503, headers:{'Content-Type':'text/plain; charset=utf-8'} });
    }
  })());
});
