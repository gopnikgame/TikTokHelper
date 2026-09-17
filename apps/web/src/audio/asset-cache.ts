import type { SoundAsset } from '@tiktok-helper/contracts';

export const AUDIO_CACHE_NAME = 'tiktok-helper-audio-v1';
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const DEFAULT_CACHE_BUDGET = 64 * 1024 * 1024;
const USAGE_KEY = 'tiktok-helper.audio-cache-v1.usage';

type CacheableSound = Pick<SoundAsset, 'id' | 'url' | 'contentSha256' | 'byteSize' | 'mimeType' | 'status'>;

export function soundIdentity(sound: CacheableSound): string {
  return `${sound.id}:${sound.contentSha256}`;
}

export function canonicalSoundUrl(sound: CacheableSound, origin = window.location.origin): string {
  if (sound.status !== 'active' || !/^[0-9a-f]{64}$/.test(sound.contentSha256)) throw new Error('Sound is not cacheable');
  const url = new URL(sound.url, origin);
  const allowedLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowedLocalhost))) {
    throw new Error('Managed audio must be same-origin HTTPS');
  }
  url.searchParams.set('sha256', sound.contentSha256);
  return url.href;
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateResponse(response: Response, sound: CacheableSound): void {
  if (response.status !== 200 || response.redirected || response.type === 'opaque' || response.headers.has('content-range')) {
    throw new Error('Invalid audio response');
  }
  if (sound.byteSize < 1 || sound.byteSize > MAX_ASSET_BYTES) throw new Error('Invalid audio size');
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) !== sound.byteSize) throw new Error('Audio length mismatch');
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (type && type !== sound.mimeType.toLowerCase()) throw new Error('Audio MIME mismatch');
}

export class AudioAssetCache {
  readonly #inflight = new Map<string, Promise<ArrayBuffer>>();
  readonly #usage = new Map<string, { size: number; lastUsed: number }>();

  constructor(private readonly budgetBytes = DEFAULT_CACHE_BUDGET) {
    try {
      const saved = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, { size: number; lastUsed: number }>;
      for (const [url, value] of Object.entries(saved)) if (value.size > 0 && value.lastUsed > 0) this.#usage.set(url, value);
    } catch { /* Storage metadata is optional. */ }
  }

  async load(sound: CacheableSound): Promise<ArrayBuffer> {
    const identity = soundIdentity(sound);
    const existing = this.#inflight.get(identity);
    if (existing) return existing;
    const loading = this.#load(sound).finally(() => this.#inflight.delete(identity));
    this.#inflight.set(identity, loading);
    return loading;
  }

  async prune(eligible: readonly CacheableSound[]): Promise<void> {
    if (!('caches' in window)) return;
    const allowed = new Set(eligible.filter((sound) => sound.status === 'active').map((sound) => canonicalSoundUrl(sound)));
    try {
      const cache = await caches.open(AUDIO_CACHE_NAME);
      const requests = await cache.keys();
      await Promise.all(requests.filter((request) => !allowed.has(request.url)).map(async (request) => {
        this.#usage.delete(request.url); await cache.delete(request);
      }));
      this.#persistUsage();
    } catch { /* Cache Storage is optional. */ }
  }

  async #load(sound: CacheableSound): Promise<ArrayBuffer> {
    const request = new Request(canonicalSoundUrl(sound), { method: 'GET', credentials: 'same-origin' });
    let cache: Cache | undefined;
    if ('caches' in window) {
      try {
        cache = await caches.open(AUDIO_CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) {
          validateResponse(cached, sound);
          const bytes = await cached.arrayBuffer();
          if (bytes.byteLength === sound.byteSize) { this.#touch(request.url, sound.byteSize); return bytes; }
          await cache.delete(request);
        }
      } catch { cache = undefined; }
    }

    const response = await fetch(request);
    validateResponse(response, sound);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== sound.byteSize || await sha256(bytes) !== sound.contentSha256) throw new Error('Audio integrity mismatch');
    if (cache) {
      try {
        await this.#reserve(cache, request.url, sound.byteSize);
        await cache.put(request, new Response(bytes.slice(0), {
          status: 200,
          headers: { 'content-type': sound.mimeType, 'content-length': String(sound.byteSize) },
        }));
        this.#touch(request.url, sound.byteSize);
      } catch { /* Network bytes remain usable when storage is unavailable. */ }
    }
    return bytes;
  }

  async #reserve(cache: Cache, incomingUrl: string, incomingSize: number): Promise<void> {
    if (incomingSize > this.budgetBytes) throw new Error('Audio exceeds cache budget');
    const requests = await cache.keys();
    const urls = new Set(requests.map((request) => request.url));
    let used = [...this.#usage].reduce((total, [url, entry]) => total + (urls.has(url) && url !== incomingUrl ? entry.size : 0), 0);
    const candidates = [...this.#usage.entries()]
      .filter(([url]) => urls.has(url) && url !== incomingUrl)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [url, entry] of candidates) {
      if (used + incomingSize <= this.budgetBytes) break;
      await cache.delete(new Request(url));
      this.#usage.delete(url); used -= entry.size;
    }
    if (used + incomingSize > this.budgetBytes) throw new Error('Audio cache budget unavailable');
  }

  #touch(url: string, size: number): void { this.#usage.set(url, { size, lastUsed: Date.now() }); this.#persistUsage(); }
  #persistUsage(): void {
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(Object.fromEntries(this.#usage))); } catch { /* Optional metadata. */ }
  }
}
