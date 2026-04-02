const CACHE_NAME = 'pos-pro-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap'
];

// Install — cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate — clear old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache first, fallback to network
self.addEventListener('fetch', e => {
  // Don't intercept Google Sheets API calls (need live network)
  if (e.request.url.includes('script.google.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache new successful GET requests
        if (e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback for navigation
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Background sync for queued uploads
self.addEventListener('sync', e => {
  if (e.tag === 'sync-sales') {
    e.waitUntil(syncQueuedSales());
  }
});

async function syncQueuedSales() {
  // Notify all clients to attempt sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'DO_SYNC' }));
}
