const CACHE_NAME = 'swal-leads-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Assets to cache immediately
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js'
];

// API endpoints to cache (your Google Apps Script URL - UPDATE THIS)
const API_BASE_URL = 'https://script.google.com/macros/s/AKfycbyHKyPOx-80IHPmAPV3JehaNJDhjWlR3aE4wwGgyNd-FUzPsNUJnQU25_9k1DN6oSAN/exec'; // Replace with your deployed URL

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - network first, then cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  // Handle API requests to Google Apps Script
  if (url.href.includes(API_BASE_URL) || url.href.includes('googleapis.com')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached API response if offline
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline data structure
            return new Response(JSON.stringify({
              success: false,
              offline: true,
              message: 'You are offline. Please check your connection.'
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // Handle static assets - cache first, then network
  if (PRECACHE_URLS.some(cachedUrl => url.pathname === cachedUrl || url.pathname.endsWith('.css') || url.pathname.endsWith('.js'))) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(request).then((response) => {
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          });
        })
    );
    return;
  }

  // Default: network first, fallback to cache, then offline page
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If requesting HTML, show offline page
            if (request.headers.get('Accept').includes('text/html')) {
              return caches.match(OFFLINE_URL);
            }
            return new Response('Offline - Content not available', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);
  if (event.tag === 'sync-leads') {
    event.waitUntil(syncPendingActions());
  }
});

// Function to sync pending actions from IndexedDB
async function syncPendingActions() {
  // This will be implemented to sync offline actions when connection returns
  const db = await openDatabase();
  const pendingActions = await getPendingActions(db);
  
  for (const action of pendingActions) {
    try {
      const response = await fetch(action.url, {
        method: action.method,
        headers: action.headers,
        body: action.body
      });
      if (response.ok) {
        await removePendingAction(db, action.id);
        // Send notification to user
        self.registration.showNotification('Sync Complete', {
          body: `Action ${action.type} has been synced successfully.`,
          icon: '/icons/icon-192.png'
        });
      }
    } catch (error) {
      console.error('Sync failed for action:', action.id, error);
    }
  }
}

// Helper functions for IndexedDB
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SWALOfflineDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingActions')) {
        db.createObjectStore('pendingActions', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

function getPendingActions(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pendingActions'], 'readonly');
    const store = transaction.objectStore('pendingActions');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function removePendingAction(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pendingActions'], 'readwrite');
    const store = transaction.objectStore('pendingActions');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Push notification support
self.addEventListener('push', (event) => {
  const data = event.data.json();
  const options = {
    body: data.body || 'New update available',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Steelwool Africa LTD', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
