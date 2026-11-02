/* Replaces the app's service worker on morningbox.ae while the app lives at dev.morningbox.ae:
   browsers that installed the app here fetch this file, which clears the app's caches and removes itself,
   so returning visitors see the coming-soon page instead of a cached copy of the app. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('morning-box-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url));
  })());
});
