const CACHE_NAME = "a33-pedidos-cache-v4_20_7";
const ASSETS = [
  "./",
  "./index.html?v=4.20.7",
  "./style.css?v=4.20.7",
  "./script.js?v=4.20.7",
  "./manifest.webmanifest?v=4.20.7",
  "./images/logo.png",
  "/assets/js/a33-input-ux.js?v=4.20.7",
  "/assets/js/a33-storage.js?v=4.20.7",
  "/assets/js/a33-auth.js?v=4.20.7",
  "/assets/css/a33-header.css?v=4.20.7"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).catch(() =>
          caches.match("./index.html?v=4.20.7")
        )
      );
    })
  );
});
