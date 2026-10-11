// K-SHOP PWA Service Worker for Delivery Portal & Offline Capabilities
const CACHE_NAME = 'kshop-delivery-pwa-v4';
const PRECACHE_ASSETS = [
  '/delivery',
  '/delivery/login',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Purge any older caches (like kshop-delivery-pwa-v2) on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  try {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    // Never intercept API routes, admin routes, or versioned asset bundles
    if (
      url.pathname.startsWith('/api') ||
      url.pathname.startsWith('/admin') ||
      url.pathname.startsWith('/assets')
    ) {
      return;
    }

    // Only handle delivery routes for offline fallback
    if (url.pathname.startsWith('/delivery')) {
      event.respondWith(
        fetch(event.request).catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match('/delivery');
          if (fallback) return fallback;
          return new Response('Offline - delivery portal unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
          });
        })
      );
      return;
    }

    // Network-first for everything else
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response('Network unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      })
    );
  } catch (err) {
    // If URL parsing fails, ignore request
  }
});
