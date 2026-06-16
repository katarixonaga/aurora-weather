// Aurora Weather service worker — offline shell + network-first so deploys show immediately.
const CACHE = 'aurora-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // Open-Meteo API calls always go to the network
  // Network-first: fresh when online, cached shell when offline.
  e.respondWith(
    fetch(e.request).then(resp => {
      const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return resp;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
