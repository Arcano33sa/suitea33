/* Suite A33 — Centro de Mando — Etapa 5/5 — Service Worker acotado al módulo. */
try{ importScripts('/assets/js/a33-release.js?v=4.20.98&r=54'); }catch(_){ }

const SW_VERSION = self.A33_RELEASE && self.A33_RELEASE.suiteVersion
  ? String(self.A33_RELEASE.suiteVersion)
  : '4.20.98';
const SW_REV = self.A33_RELEASE && self.A33_RELEASE.rev != null
  ? String(self.A33_RELEASE.rev)
  : '1';
const MODULE = 'centro-mando';
const MODULE_CACHE_REV = '7';
const CACHE_NAME = `a33-v${SW_VERSION}-${MODULE}-r${SW_REV}-m${MODULE_CACHE_REV}`;

const PRECACHE_URLS = [
  './',
  './index.html?v=4.20.98&r=23',
  './style.css?v=4.20.98&r=19',
  './app.js?v=4.20.98&r=23',
  './manifest.webmanifest?v=4.20.98&r=6',
  './offline.html',
  '../icon-a33-192.png',
  '../icon-a33-512.png',
  '/assets/js/a33-release.js?v=4.20.98&r=54',
  '/assets/js/a33-storage.js?v=4.20.98&r=21',
  '/assets/js/a33-currency.js?v=4.20.98&r=14',
  '/assets/js/a33-theme.js?v=4.20.98&r=7',
  '/assets/js/a33-module-nav.js?v=4.20.98&r=3',
  '/assets/css/a33-header.css?v=4.20.98&r=7',
  '/assets/css/a33-module-nav.css?v=4.20.98&r=3',
  '/assets/css/a33-theme.css?v=4.20.98&r=7'
];

function sameOrigin(url){
  try{ return url.origin === self.location.origin; }catch(_){ return false; }
}

function shouldCache(url){
  try{
    const scopePath = new URL(self.registration.scope).pathname;
    return url.pathname.startsWith(scopePath) || url.pathname.startsWith('/assets/') || /\/icon-a33-(192|512)\.png$/.test(url.pathname);
  }catch(_){ return false; }
}

function isCriticalAsset(url){
  const path = String(url && url.pathname || '');
  return path.endsWith('/index.html') || path.endsWith('/app.js') || path.endsWith('/style.css') || path.endsWith('/manifest.webmanifest');
}

self.addEventListener('message',(event)=>{
  try{ if (event && event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); }catch(_){ }
});

self.addEventListener('install',(event)=>{
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    try{ await self.skipWaiting(); }catch(_){ }
  })());
});

self.addEventListener('activate',(event)=>{
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    const victims = keys.filter((key)=>{
      const value = String(key || '').toLowerCase();
      const sameModule = value.startsWith('a33-') && value.includes(`-${MODULE}`) && value !== CACHE_NAME.toLowerCase();
      const retiredLegacy = (value.startsWith('a33-') || value.startsWith('arcano33-')) && value.includes('centro_mando');
      return sameModule || retiredLegacy;
    });
    await Promise.all(victims.map((key)=>caches.delete(key).catch(()=>false)));
    try{ await self.clients.claim(); }catch(_){ }
  })());
});

async function networkFirst(request){
  const cache = await caches.open(CACHE_NAME);
  try{
    const response = await fetch(request);
    if (response && response.ok && shouldCache(new URL(request.url))){
      cache.put(request,response.clone()).catch(()=>{});
    }
    return response;
  }catch(_){
    return (await cache.match(request)) ||
      (await cache.match('./index.html?v=4.20.98&r=23')) ||
      (await cache.match('./index.html',{ignoreSearch:true})) ||
      (await cache.match('./offline.html')) ||
      new Response('Offline',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}

async function assetStrategy(request){
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);
  if (!isCriticalAsset(url)){
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  try{
    const response = await fetch(request);
    if (response && response.ok && shouldCache(url)) cache.put(request,response.clone()).catch(()=>{});
    return response;
  }catch(_){
    return (await cache.match(request)) || new Response('',{status:504});
  }
}

self.addEventListener('fetch',(event)=>{
  if (!event.request || event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!sameOrigin(url)) return;
  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';
  event.respondWith(isNavigation ? networkFirst(event.request) : assetStrategy(event.request));
});
