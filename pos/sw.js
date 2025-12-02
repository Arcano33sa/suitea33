
const CACHE = 'a33-pos-v3_18';
const ASSETS = [
  './',
  './index.html?v=3.18',
  './styles.css?v=3.18',
  './app.js?v=3.18',
  './manifest.webmanifest?v=3.18',
  './logo.png',
  './brand_symbol.jpg',
  './brand_wordmark.jpg'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.filter(Boolean))));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e)=>{
  e.respondWith(
    caches.match(e.request).then(res=> res || fetch(e.request).then(resp=>{
      if (e.request.method === 'GET' && (resp.status === 200)) {
        const copy = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy));
      }
      return resp;
    }).catch(()=>caches.match('./index.html?v=3.18')))
  );
});
