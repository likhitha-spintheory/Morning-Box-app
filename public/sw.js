const CACHE_NAME = 'morning-box-shell-v1';
const APP_SHELL = [
  './',
  './manifest.webmanifest',
  './icons/morning-box-192.png',
  './icons/morning-box-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(async cache => {
        const shell = await cache.match('./');
        const html = await shell.text();
        const assets = Array.from(html.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css))"/g), match => match[1]);
        await cache.addAll(assets);
        await self.skipWaiting();
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('morning-box-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./', copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('./');
          if (cached) return cached;
          throw new Error('Morning Box is offline and the app shell is not cached.');
        })
    );
    return;
  }

  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return;

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
