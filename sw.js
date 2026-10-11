// ==============================================================================
// SAMARPIT IRANIWADI - Service Worker (PWA Offline Caching & Install Support)
// ==============================================================================

const CACHE_NAME = 'samarpit-sabha-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/config.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: Cache critical static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(err => {
      console.warn('Cache addAll error:', err);
    })
  );
  self.skipWaiting();
});

// Activate: Clean up older cache versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Fetch: Network-first for dynamic freshness, cached fallback for offline usage
self.addEventListener('fetch', event => {
  // Let Supabase API & Google OAuth go straight to network
  const url = event.request.url;
  if (url.includes('supabase.co') || url.includes('accounts.google.com') || url.includes('googleapis.com')) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return null;
        });
      })
  );
});
