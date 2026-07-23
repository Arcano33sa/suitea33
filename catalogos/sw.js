/* Suite A33 — Service Worker (Catálogos)
   Cache acotada al módulo y assets compartidos.
*/
try { importScripts('/assets/js/a33-release.js?v=4.20.95&r=54'); } catch (e) {}

const SW_VERSION = (self.A33_RELEASE && self.A33_RELEASE.suiteVersion) ? String(self.A33_RELEASE.suiteVersion) : '4.20.95';
const SW_REV = (self.A33_RELEASE && self.A33_RELEASE.rev !== undefined && self.A33_RELEASE.rev !== null) ? String(self.A33_RELEASE.rev) : '1';
const MODULE = 'catalogos';
const MODULE_CACHE_REV = '36';
const CACHE_NAME = `a33-v${SW_VERSION}-${MODULE}-r${SW_REV}-m${MODULE_CACHE_REV}`;

function isLegacySuiteCache(name){
  const value = String(name || '').toLowerCase();
  if (!(value.startsWith('a33-') || value.startsWith('arcano33-'))) return false;
  return value.includes('centro_mando') || value.includes('centro-mando') || value.includes('calculadora_a33');
}


const PRECACHE_URLS = [
  './',
  './index.html?v=4.20.95&r=30',
  './style.css?v=4.20.95&r=21',
  './script.js?v=4.20.95&r=32',
  './manifest.webmanifest?v=4.20.95&r=11',
  './offline.html',
  '../icon-a33-192.png',
  '../icon-a33-512.png',
  '/assets/js/a33-release.js?v=4.20.95&r=54',
  '/assets/js/a33-storage.js?v=4.20.95&r=20',
  '/assets/js/a33-product-integrity.js?v=4.20.95&r=1',
  '/assets/js/a33-materials.js?v=4.20.95&r=2',
  '/assets/js/a33-input-ux.js?v=4.20.95&r=11',
  '/assets/js/a33-theme.js?v=4.20.95&r=11',
  '/assets/css/a33-header.css?v=4.20.95&r=11',
  '/assets/css/a33-theme.css?v=4.20.95&r=11'
];

function sameOrigin(url){
  try{ return url.origin === self.location.origin; }catch(_){ return false; }
}

function shouldCache(url){
  try{
    const scopePath = new URL(self.registration.scope).pathname;
    return url.pathname.startsWith(scopePath) || url.pathname.startsWith('/assets/') || url.pathname.endsWith('/icon-a33-192.png') || url.pathname.endsWith('/icon-a33-512.png');
  }catch(_){ return false; }
}

function isCriticalAsset(url){
  try{
    const p = String(url.pathname || '');
    return p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.webmanifest');
  }catch(_){ return false; }
}

self.addEventListener('message', (event) => {
  try{
    if (event && event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
    const keys = await caches.keys();
    const victims = keys.filter((k) => {
      const value = String(k || '');
      const sameModule = value.startsWith('a33-') && value.includes(`-${MODULE}`) && value !== CACHE_NAME;
      return sameModule || isLegacySuiteCache(value);
    });
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
      (await cache.match('./index.html?v=4.20.95&r=30')) ||
      (await cache.match('./index.html', { ignoreSearch:true })) ||
      (await cache.match('./offline.html')) ||
      new Response('Offline', { status:503, headers:{ 'Content-Type':'text/plain; charset=utf-8' } })
    );
  }
}

async function handleAsset(request){
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);
  if (!isCriticalAsset(url)){
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  try{
    const resp = await fetch(request);
    if (resp && resp.status === 200 && shouldCache(url)) cache.put(request, resp.clone()).catch(() => {});
    return resp;
  }catch(_){
    const cached = await cache.match(request);
    return cached || new Response('', { status:504 });
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!sameOrigin(url)) return;
  const isNav = event.request.mode === 'navigate' || event.request.destination === 'document';
  event.respondWith(isNav ? handleNavigate(event.request) : handleAsset(event.request));
});
