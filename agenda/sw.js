/* Suite A33 — Agenda · Compras/Calendario · cache aislada */
try { importScripts('/assets/js/a33-release.js?v=4.20.95&r=54'); } catch (_) {}
const VERSION = self.A33_RELEASE && self.A33_RELEASE.suiteVersion ? String(self.A33_RELEASE.suiteVersion) : '4.20.95';
const REV = self.A33_RELEASE && self.A33_RELEASE.rev != null ? String(self.A33_RELEASE.rev) : '1';
const CACHE = `a33-v${VERSION}-agenda-r${REV}-m3`;
const PRECACHE = [
  './',
  './index.html?v=4.20.95&r=3',
  './style.css?v=4.20.95&r=11',
  './script.js?v=4.20.95&r=16',
  './purchases.js?v=4.20.95&r=3',
  './manifest.webmanifest?v=4.20.95&r=1',
  './offline.html',
  '../icon-a33-192.png',
  '../icon-a33-512.png',
  '/assets/js/a33-release.js?v=4.20.95&r=54',
  '/assets/js/a33-storage.js?v=4.20.95&r=20',
  '/assets/js/a33-materials.js?v=4.20.95&r=2',
  '/assets/js/a33-theme.js?v=4.20.95&r=7',
  '/assets/css/a33-header.css?v=4.20.95&r=7',
  '/assets/css/a33-theme.css?v=4.20.95&r=7'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async()=>{
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.includes('-agenda-') && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const inScope = url.pathname.startsWith(new URL(self.registration.scope).pathname) || url.pathname.startsWith('/assets/') || /icon-a33-(192|512)\.png$/.test(url.pathname);
  if (!inScope) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const clone = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, clone)).catch(()=>{}); return response;
    }).catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html?v=4.20.95&r=3')).then(hit => hit || caches.match('./offline.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    if (response && response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone())).catch(()=>{});
    return response;
  })));
});
