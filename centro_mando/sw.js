/* Suite A33 — retiro controlado del Service Worker legacy centro_mando.
   No precachea, no toca localStorage ni IndexedDB y se desregistra al activarse. */
const LEGACY_CACHE_MARKERS = ['centro_mando', 'centro-mando'];
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => {
        const value = String(key || '').toLowerCase();
        return (value.startsWith('a33-') || value.startsWith('arcano33-')) && LEGACY_CACHE_MARKERS.some((marker) => value.includes(marker));
      }).map((key) => caches.delete(key).catch(() => false)));
    } catch (_) {}
    try { await self.clients.claim(); } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
      clients.forEach((client) => { try { client.postMessage({ type:'A33_LEGACY_ROUTE_RETIRED', to:'../centro-mando/index.html', version:'4.20.94' }); } catch (_) {} });
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
  })());
});
