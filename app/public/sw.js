// Work Tracker service worker. It caches the app's static files (CSS, JS, icons) as a fallback only. The server's
// copy is always asked for first, so a change to the look shows at once. Pages and data always come from the server.
const CACHE = 'work-tracker-static-v2';
const STATIC = [
  '/static/app.css',
  '/static/app.js',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/static/')) {
    return; // pages, forms, the API and exports always go to the server
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
