// Cache public branding/offline assets only. Never store API responses or logged data.
const CACHE_NAME = 'lean-muscle-public-v3';
const OFFLINE = '/offline.html';
const PUBLIC_ASSETS = new Set([
  OFFLINE, '/manifest.webmanifest', '/favicon-v3.ico',
  '/icons/tracker-v3.svg', '/icons/tracker-32-v3.png',
  '/icons/tracker-192-v3.png', '/icons/tracker-512-v3.png',
  '/icons/tracker-maskable-512-v3.png', '/icons/apple-touch-icon-v3.png',
]);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([...PUBLIC_ASSETS])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lean-muscle-public-') && key !== CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (PUBLIC_ASSETS.has(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then(cached=>cached || fetch(event.request)));
  } else if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(event.request).catch(async()=> (await caches.match(OFFLINE)) || new Response('Reconnect to open Lean Muscle Tracker.',{status:503,headers:{'Content-Type':'text/plain'}})));
  }
});
