// SWELECT Project Control – app helper (service worker).
// Makes the installed app open fast and show a friendly page when there is no internet.
// Project data (/api/...) is NEVER cached here: it always comes live from the server.
const VERSION = 'swelect-v2';
const SHELL = ['/', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/swelect-logo.png', '/swelect-mark.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // live data and sign-in: always straight to the network
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // pages: newest version from the network; if offline, the last saved app screen or the offline page
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html'))),
    );
    return;
  }

  // app code, icons, images and fonts: these never change once published, so keep them on the device
  const cacheable =
    (url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || /\.(png|jpg|svg|woff2?)$/.test(url.pathname))) ||
    url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
