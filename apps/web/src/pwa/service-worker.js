/* global self, caches, URL, fetch, Response, __SOURCE_REVISION__ */

const SOURCE_REVISION = __SOURCE_REVISION__;
const SCOPE = new URL(self.registration.scope);
const APP_SHELL_CACHE_PREFIX = SCOPE.pathname === '/' ? 'tiktok-helper-app-shell-' : 'tiktok-helper-mounted-app-shell-';
const APP_SHELL_CACHE = `${APP_SHELL_CACHE_PREFIX}v1`;
const TTS_MODEL_CACHE = 'tiktok-helper-tts-models-v1';
const OFFLINE_URL = new URL('offline.html', SCOPE).href;
const PRECACHE_URLS = [
  'offline.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
].map((path) => new URL(path, SCOPE).href);

function inScope(url) {
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(APP_SHELL_CACHE_PREFIX) && name !== APP_SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING' && event.source?.url && inScope(new URL(event.source.url))) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!inScope(url)) return;
  const path = url.pathname.slice(SCOPE.pathname.length);
  if (path.startsWith('api/') || path.startsWith('auth/') || path.startsWith('socket.io/')) return;

  if (path.startsWith('tts-assets/voices/') && request.mode !== 'navigate' && !request.headers.has('range')) {
    event.respondWith(caches.open(TTS_MODEL_CACHE).then((cache) => cache.match(request))
      .catch(() => undefined).then((cached) => cached ?? fetch(request)));
    return;
  }

  if (request.mode === 'navigate') {
    if (path !== '' && path !== 'index.html') return;
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      return (await cache.match(OFFLINE_URL)) ?? Response.error();
    }));
    return;
  }

  const isStaticAsset = /^(assets|icons)\/[\w.-]+$/.test(path) || path === 'manifest.webmanifest' || path === 'favicon.ico';
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(APP_SHELL_CACHE).catch(() => undefined);
    const cached = await cache?.match(request).catch(() => undefined);
    if (cached) return cached;
    const response = await fetch(request);
    const cacheControl = response.headers.get('cache-control') ?? '';
    if (response.ok && response.type === 'basic' && !response.redirected && !/\b(no-store|private)\b/i.test(cacheControl)) {
      await cache?.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  })());
});

// Keep the deployed revision in the generated worker so every release is byte-distinct.
void SOURCE_REVISION;
