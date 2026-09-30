const CACHE_NAME = 'repair-app-v35';
const ASSETS = [
  './index.html',
  './manifest.json',
  './tickets.html',
  './report.html',
  './report-manifest.json',
  './users.html',
  './projects.html',
  './routine.html',
  './routine-pool.html',
  './routine-report.html',
  './meter.html',
  './meter-manifest.json',
  './meter-styles.css',
  './meter-app.js',
  './push-setup.js'
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

// ============ Web Push ============
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: 'แจ้งเตือน', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'แจ้งเตือน';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './index.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl.split('?')[0]) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
