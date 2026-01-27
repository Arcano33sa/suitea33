/* Suite A33 — Service Worker (Inventario)
   Objetivo: cachés acotadas por módulo (sin “guerra” entre SW).
*/

const SW_VERSION = '4.20.42';
const SW_REV = '8';
const MODULE = 'inventario';
const CACHE_NAME = `a33-v${SW_VERSION}-${MODULE}-r${SW_REV}`;

const PRECACHE_URLS = [
  './',
  './index.html?v=4.20.42',
  './style.css?v=4.20.42',
  './script.js?v=4.20.42',
  './manifest.webmanifest?v=4.20.42',
  './offline.html',
  './images/logo.png',
  '/assets/js/a33-input-ux.js?v=4.20.42',
  '/assets/js/a33-storage.js?v=4.20.42',
  '/assets/js/a33-presentations.js?v=4.20.42',
  '/assets/js/a33-auth.js?v=4.20.42',
  '/assets/css/a33-header.css?v=4.20.42'
];

function sameOrigin(url){
  try{ return url.origin === self.location.origin; }catch(_){ return false; }
}

function isCriticalAsset(url){
  try{
    const p = String(url.pathname || '');
    return p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.webmanifest');
  }catch(_){ return false; }
}

function shouldCache(url){
  // Acotado: scope del módulo + /assets/ compartido
  try{
    const scopePath = new URL(self.registration.scope).pathname;
    return url.pathname.startsWith(scopePath) || url.pathname.startsWith('/assets/');
  }catch(_){ return false; }
}


self.addEventListener('message', (event) => {
  try{
    if (event && event.data && event.data.type === 'SKIP_WAITING'){
      self.skipWaiting();
    }
  }catch(_){ }
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.filter(Boolean));
    try{ self.skipWaiting(); }catch(_){ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Borrar SOLO caches a33- del MISMO módulo (evita “guerra de caches”).
    const keys = await caches.keys();
    const victims = keys.filter(k =>
      String(k || '').startsWith('a33-') &&
      String(k || '').includes(`-${MODULE}`) &&
      k !== CACHE_NAME
    );
    await Promise.all(victims.map(k => caches.delete(k).catch(() => false)));
    try{ await self.clients.claim(); }catch(_){ }
  })());
});

async function handleNavigate(request){
  try{
    const resp = await fetch(request);
    if (resp && resp.status === 200){
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  }catch(_){
    const cache = await caches.open(CACHE_NAME);
    return (
      (await cache.match(request)) ||
      (await cache.match('./index.html?v=4.20.42')) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./offline.html')) ||
      (await cache.match('./')) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    );
  }
}

async function handleAsset(request){
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);

  // Para assets criticos, preferimos red para evitar 'fantasmas' (fallback a cache si offline).
  const critical = isCriticalAsset(url);
  if (!critical){
    const cached = await cache.match(request);
    if (cached) return cached;
  }

  try{
    const resp = await fetch(request);
    if (resp && resp.status === 200 && shouldCache(url)){
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  }catch(_){
    const cached = await cache.match(request);
    return cached || new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!sameOrigin(url)) return;

  const isNav = event.request.mode === 'navigate' || event.request.destination === 'document';
  if (isNav){
    event.respondWith(handleNavigate(event.request));
    return;
  }
  event.respondWith(handleAsset(event.request));
});
