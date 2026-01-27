/* Legacy cleanup SW — A33 Centro de Mando (compat) — Bridge SW
   Objetivo: limpiar solo caches a33-* del Centro de Mando (sin tocar otros módulos)
   y retirarse.
*/

const SW_VERSION = '4.20.13';
const SW_REV = '1';
const MODULE = 'centro_mando';
const CACHE_NAME = `a33-v${SW_VERSION}-${MODULE}-r${SW_REV}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.webmanifest',
  './offline.html'
];

function sameOrigin(url){
  try{ return url.origin === self.location.origin; }catch(_){ return false; }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.filter(Boolean));
    try{ self.skipWaiting(); }catch(_){ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1) Borrar SOLO caches a33-* del Centro de Mando (no del resto del origen).
    try{
      const keys = await caches.keys();
      const victims = keys.filter(k => {
        const s = String(k || '');
        const low = s.toLowerCase();
        const isA33 = low.startsWith('a33-');
        const isCdm = low.includes('centro-mando') || low.includes('centro_mando');
        return isA33 && isCdm && s !== CACHE_NAME;
      });
      await Promise.all(victims.map(k => caches.delete(k).catch(() => false)));
    }catch(_){ }

    // 2) Avisar a clientes para redirigir (si siguen abiertos)
    try{
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({ type: 'A33_CDM_MOVED', to: '../centro-mando/index.html', v: SW_VERSION });
      }
    }catch(_){ }

    // 3) Tomar control un momento y retirarse
    try{ await self.clients.claim(); }catch(_){ }
    try{ await self.registration.unregister(); }catch(_){ }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!sameOrigin(url)) return;

  const isNav = event.request.mode === 'navigate' || event.request.destination === 'document';
  if (!isNav){
    // Assets: cache-first durante la ventana corta antes de desregistrarse
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try{
        const resp = await fetch(event.request);
        if (resp && resp.status === 200) cache.put(event.request, resp.clone()).catch(() => {});
        return resp;
      }catch(_){
        return cached || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Navegación: network-first con fallback sin loops
  event.respondWith((async () => {
    try{
      return await fetch(event.request);
    }catch(_){
      const cache = await caches.open(CACHE_NAME);
      return (
        (await cache.match('./index.html')) ||
        (await cache.match('./offline.html')) ||
        new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      );
    }
  })());
});
