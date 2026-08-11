const CACHE_NAME = 'photobooth-cache-v1';

// Install the service worker
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate and claim clients
self.addEventListener('activate', (event) => {
    clients.claim();
});

// Basic fetch event to satisfy PWA requirements
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            // Fallback to cache if offline
            return caches.match(event.request);
        })
    );
});
