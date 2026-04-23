const CACHE_NAME = 'steelwool-v23';
const OFFLINE_URL = '/offline.html';

// Files to cache immediately on install
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install - cache shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Don't cache API calls to Apps Script - always go to network
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    event.respondWith(
      fetch(req).catch(() => {
        // Return error JSON if API call fails offline
        return new Response(
          JSON.stringify({ success: false, message: 'You are offline. Please reconnect to use this feature.' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // For same-origin requests
  if (url.origin === location.origin) {
    // HTML navigation requests - network first, fallback to cache, then offline page
    if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
      event.respondWith(
        fetch(req)
          .then(res => {
            // Cache successful responses
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
            return res;
          })
          .catch(() => 
            caches.match(req).then(cached => cached || caches.match(OFFLINE_URL))
          )
      );
      return;
    }

    // Other static assets - cache first, then network
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          // Cache new static assets
          if (res.ok && req.method === 'GET') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Cross-origin requests (other than API) - network only
  event.respondWith(fetch(req));
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
