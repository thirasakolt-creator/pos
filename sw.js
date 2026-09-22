const CACHE_NAME = 'repair-app-v1';
const ASSETS = [
  './index.html',
  './manifest.json',
  './tickets.html',
  './report.html',
  './report-manifest.json',
  './users.html',
  './projects.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // network-first สำหรับ API (Supabase) ปล่อยผ่านเสมอ ไม่ cache
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
