// AFRIPULSE AI service worker — offline-first shell.
// Strategy:
//  - static assets: cache-first (versioned by ?v= URLs)
//  - page navigations: network-first, fall back to cached copy when offline
//  - /api/*: network only, never cached
// Bump CACHE each time precached asset URLs change so old caches clear.

var CACHE = 'afripulse-v2';
var PRECACHE = [
  '/',
  '/report',
  '/track',
  '/about',
  '/assets/app.css?v=3',
  '/assets/app.js?v=3',
  '/assets/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Cache each asset independently; a single failure must not kill install.
      return Promise.all(PRECACHE.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (ev) {
  if (ev.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return; // form POSTs go straight to the network/page queue
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts, tiles etc: network only
  if (url.pathname.startsWith('/api/')) return; // live data, never cached
  if (url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('/');
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    ev.respondWith(
      caches.match(req).then(function (hit) { return hit || fetch(req); })
    );
  }
});
