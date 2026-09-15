// Minimal service worker -- just enough to make the app installable (a PWA manifest alone
// isn't installable in most browsers without a registered service worker) and to let
// already-visited pages open when briefly offline. Deliberately NOT a full offline-first
// cache strategy -- POS data has to be live/correct, so API calls always go to the network,
// never the cache.
const CACHE = 'restaurantos-shell-v1';
const SHELL = ['/', '/login', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.url.includes('/api/') || request.url.includes('socket.io')) {
    return; // never cache API/socket traffic
  }
  event.respondWith(
    fetch(request).catch(async () => {
      // A cache miss here used to resolve to `undefined`, which respondWith() cannot use
      // and throws "Failed to convert value to 'Response'" for -- breaking the whole
      // request instead of just falling through. Re-throwing lets the browser handle the
      // failure normally (its own offline page) instead of the app looking broken.
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error('Network request failed and nothing cached for: ' + request.url);
    })
  );
});
