// Bump VERSION on every release: the old shell cache is dropped on activate.
const VERSION = 'presente-v3';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

// The auth gate answers with its login page (200) or 401; neither may ever be cached as the app.
const cacheable = (res) => res && res.ok && res.type !== 'opaqueredirect' && !res.headers.get('X-Presente-Gate');

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) =>
    Promise.allSettled(SHELL.map((url) =>
      fetch(url, { credentials: 'same-origin', cache: 'no-cache' })
        .then((res) => (cacheable(res) ? cache.put(url, res) : null))))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/__')) return; // auth + archive API: always live

  if (req.mode === 'navigate') {
    // Network first so a new release and the login gate are always seen; the cached shell when offline.
    event.respondWith(fetch(req).then((res) => {
      if (cacheable(res)) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('./index.html', copy));
      }
      return res;
    }).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }

  // Assets and fonts: answer from cache, refresh it in the background.
  event.respondWith(caches.open(VERSION).then((cache) => cache.match(req).then((cached) => {
    const fresh = fetch(req).then((res) => {
      if (cacheable(res) || (res && res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  })));
});
