// Service worker: makes the app installable and fast to reopen.
// - Build assets (/assets/*, fingerprinted): cache-first (they never change).
// - Pages: network-first, falling back to the cached app shell when offline.
// - API (/api/*) and anything not GET: never cached (always live, never stale private data).
const VERSION = 'hu-lms-v1'
const SHELL = ['/', '/index.html', '/logo.png', '/icons/icon-192.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) cache.put(request, response.clone())
      return response
    }))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(VERSION).then((cache) => cache.put('/index.html', response.clone()))
      return response
    }).catch(async () => (await caches.match('/index.html')) || new Response('You are offline. Reconnect to use Hormuud University LMS.', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
  }
})
