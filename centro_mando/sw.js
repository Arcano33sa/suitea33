// Legacy cleanup SW — no usar para desarrollo
// A33 Centro de Mando (compat) — Bridge SW
// Objetivo: eliminar caché zombie de centro_mando/ y retirarse.
const BRIDGE_VERSION = '4.20.7';
const KILL_MATCH = [
  'a33-centro-mando',
  'a33-centro_mando',
  'centro-mando',
  'centro_mando'
];

self.addEventListener('install', (e) => {
  // No cacheamos nada aquí: solo queremos tomar control rápido y limpiar.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 1) Borrar caches relacionadas
    try {
      const keys = await caches.keys();
      const toDelete = keys.filter(k => {
        const s = String(k || '').toLowerCase();
        return KILL_MATCH.some(m => s.includes(m));
      });
      await Promise.all(toDelete.map(k => caches.delete(k).catch(() => false)));
    } catch (_) {}

    // 2) Avisar a clientes para redirigir (si siguen abiertos)
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({ type: 'A33_CDM_MOVED', to: '../centro-mando/index.html', v: BRIDGE_VERSION });
      }
    } catch (_) {}

    // 3) Retirarse
    try { await self.clients.claim(); } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
  })());
});

// Network-only (por si queda vivo un instante)
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
