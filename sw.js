const CACHE_NAME = 'parking-reminder-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// Install - cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

// Listen for notification scheduling messages
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SCHEDULE_REMINDER') {
    const delay = e.data.delay;
    const nextFee = e.data.nextFee || 5;
    if (delay > 0) {
      setTimeout(() => {
        self.registration.showNotification('🅿️ 停车缴费提醒', {
          body: `停车费即将增加到 ¥${nextFee}，请尽快缴费离场！`,
          icon: './icon-192.png',
          badge: './icon-192.png',
          vibrate: [200, 100, 200, 100, 200],
          tag: 'parking-reminder-' + Date.now(),
          requireInteraction: true,
          data: { url: './' }
        });
      }, delay);
    }
  }
});

// Click notification to open app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('./');
      }
    })
  );
});
