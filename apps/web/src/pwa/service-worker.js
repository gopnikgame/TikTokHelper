/* global self, caches, URL, fetch, Response, __SOURCE_REVISION__ */

const SOURCE_REVISION = __SOURCE_REVISION__;
const APP_SHELL_CACHE = 'tiktok-helper-app-shell-v1';
const TTS_MODEL_CACHE = 'tiktok-helper-tts-models-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('tiktok-helper-app-shell-') && name !== APP_SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (url.pathname.startsWith('/tts-assets/voices/')) {
    event.respondWith(caches.open(TTS_MODEL_CACHE).then(async (cache) => (await cache.match(request)) ?? fetch(request)));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      return (await cache.match(OFFLINE_URL)) ?? Response.error();
    }));
    return;
  }

  const isStaticAsset = url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || url.pathname === '/manifest.webmanifest'
    || ['script', 'style', 'font'].includes(request.destination);
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

// Keep the deployed revision in the generated worker so every release is byte-distinct.
void SOURCE_REVISION;
