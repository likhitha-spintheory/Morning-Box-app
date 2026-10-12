/* Morning Box service worker.
   - App shell: network first for page loads, cached copy when offline.
   - Static files (hashed scripts/styles, images, icons): cache first.
   - Google Fonts: served from cache, refreshed in the background, so text keeps its typeface offline.
   - The runtime cache is trimmed so old hashed files from previous releases don't pile up.
   API calls are never cached. */
const VERSION = 'v2';
const SHELL_CACHE = `morning-box-shell-${VERSION}`;
const RUNTIME_CACHE = `morning-box-runtime-${VERSION}`;
const FONT_CACHE = `morning-box-fonts-${VERSION}`;
const RUNTIME_MAX = 60;
const FONT_MAX = 30;
const APP_SHELL = [
  './',
  './manifest.webmanifest',
  './icons/morning-box-192.png',
  './icons/morning-box-512.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map(k => cache.delete(k)));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL).then(() => cache))
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
  const keep = [SHELL_CACHE, RUNTIME_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('morning-box-') && !keep.includes(key))
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  /* Google Fonts: stale-while-revalidate. */
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.open(FONT_CACHE).then(async cache => {
      const cached = await cache.match(request);
      const network = fetch(request).then(response => {
        if (response.ok || response.type === 'opaque') {
          cache.put(request, response.clone()).then(() => trim(FONT_CACHE, FONT_MAX));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    }));
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put('./', copy));
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
        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy)).then(() => trim(RUNTIME_CACHE, RUNTIME_MAX));
      }
      return response;
    }))
  );
});
