/* Exportaciones: caché independiente; conserva los datos y las cachés de otros módulos. */
const CACHE = 'a33-exportaciones-e3-r5';
const PRECACHE = [
  "./",
  "./index.html",
  "./finanzas.html",
  "./analitica.html",
  "./pedidos.html",
  "./lotes.html",
  "./catalogos.html",
  "../finanzas/images/logo.png",
  "../assets/js/a33-theme.js?v=4.20.98&r=13",
  "../assets/css/a33-theme.css?v=4.20.98&r=13",
  "../assets/css/a33-header.css?v=4.20.98&r=13",
  "../assets/css/a33-module-nav.css?v=4.20.98&r=3",
  "../assets/css/a33-notify.css?v=4.20.98&r=1",
  "style.css?v=4.20.98&r=4",
  "../pos/vendor/xlsx.full.min.js?v=4.20.98&r=13",
  "../assets/js/a33-release.js?v=4.20.98&r=57",
  "../assets/js/a33-module-nav.js?v=4.20.98&r=5",
  "../assets/js/a33-storage.js?v=4.20.98&r=22",
  "../assets/js/a33-currency.js?v=4.20.98&r=14",
  "../assets/js/a33-presentations.js?v=4.20.98&r=15",
  "../assets/js/a33-lot-code.js?v=4.20.98&r=6",
  "../assets/js/a33-notify.js?v=4.20.98&r=1",
  "../assets/js/a33-notify-bridge.js?v=4.20.98&r=2",
  "../pos/app.js?v=4.20.98&r=58",
  "script.js?v=4.20.98&r=3",
  "../finanzas/style.css?v=4.20.98&r=1",
  "../assets/js/a33-currency.js?v=4.20.98&r=1",
  "../assets/js/a33-export-currency.js?v=4.20.98&r=1",
  "../finanzas/script.js?v=4.20.98&r=8",
  "finanzas.js?v=4.20.98&r=2",
  "../assets/js/a33-export-currency.js?v=4.20.98&r=2",
  "lectura.js?v=4.20.98&r=1",
  "../analitica/script.js?v=4.20.98&r=19",
  "modulos.js?v=4.20.98&r=2",
  "../pedidos/script.js?v=4.20.98&r=19",
  "../assets/js/a33-production.js?v=4.20.98&r=5",
  "../lotes/script.js?v=4.20.98&r=23",
  "../assets/js/a33-catalog-costs.js?v=4.20.98&r=1",
  "../catalogos/script.js?v=4.20.98&r=41"
];
self.addEventListener('install', event => {
  // Solo sirve recursos con revisión explícita. Activar no recarga la pantalla ni interrumpe un reporte.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const known = PRECACHE.some(path => new URL(path, self.registration.scope).href === url.href);
  const pages = ["./", "./index.html", "./finanzas.html", "./analitica.html", "./pedidos.html", "./lotes.html", "./catalogos.html"];
  const target = pages.find(path => new URL(path, self.registration.scope).pathname === url.pathname);
  const page = target === './' ? './index.html' : target;
  const isPage = Boolean(target);
  if (event.request.mode === 'navigate' && isPage) {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(page))));
  } else if (known) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
  }
});
