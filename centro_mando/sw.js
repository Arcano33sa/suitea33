const CACHE = 'a33-centro-mando-v4_20_3_fix1';
const ASSETS = [
  './',
  './index.html?v=4.20.3',
  './style.css?v=4.20.3',
  './script.js?v=4.20.3',
  './manifest.webmanifest?v=4.20.3',
  '../inventario/images/logo.png',
  '/assets/js/a33-storage.js',
  '/assets/js/a33-auth.js',
  '/assets/css/a33-header.css'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request).then(resp=>{
      if (e.request.method === 'GET' && resp && resp.status === 200){
        const copy = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy));
      }
      return resp;
    }).catch(()=>caches.match('./index.html?v=4.20.3')))
  );
});
