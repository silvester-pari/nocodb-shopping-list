const CACHE_NAME = 'shoplist-v1';
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/nocodb.js',
  'https://cdn.jsdelivr.net/npm/beercss@3.13.3/dist/cdn/beer.min.css',
  'https://cdn.jsdelivr.net/npm/beercss@3.13.3/dist/cdn/beer.min.js',
  'https://cdn.jsdelivr.net/npm/material-dynamic-colors@1.1.2/dist/cdn/material-dynamic-colors.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // Try network first, then cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Optional: Cache new requests dynamically
        // if (event.request.method === 'GET') {
        //   const responseClone = response.clone();
        //   caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        // }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
