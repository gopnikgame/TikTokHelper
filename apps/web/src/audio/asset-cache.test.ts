import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SoundAsset } from '@tiktok-helper/contracts';
import { AUDIO_CACHE_NAME, AudioAssetCache, canonicalSoundUrl, soundIdentity } from './asset-cache.js';

const bytes = new TextEncoder().encode('RIFFmockWAVE').buffer;
const hash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const asset = (overrides: Partial<SoundAsset> = {}): SoundAsset => ({
  id: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', displayName: 'Test', url: '/sounds/test.wav',
  contentSha256: hash, byteSize: bytes.byteLength, mimeType: 'audio/wav', status: 'active',
  createdByUserId: null, isOwnedByCurrentUser: false, usageCount: 1, quarantineReason: null,
  canQuarantine: false, canDelete: false, ...overrides,
});

class MemoryCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request) { return this.entries.get(request.url)?.clone(); }
  async put(request: Request, response: Response) { this.entries.set(request.url, response.clone()); }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async delete(request: Request) { return this.entries.delete(request.url); }
}

afterEach(() => vi.unstubAllGlobals());

function environment() {
  const cache = new MemoryCache();
  vi.stubGlobal('window', { location: { origin: 'https://example.test' }, caches: {} });
  vi.stubGlobal('caches', { open: vi.fn(async (name: string) => { expect(name).toBe(AUDIO_CACHE_NAME); return cache; }) });
  return cache;
}

describe('AudioAssetCache', () => {
  it('uses an exact id and hash identity and rejects unsafe URLs', () => {
    expect(soundIdentity(asset())).toBe(`56f92c37-5eca-43b3-8073-6d1a3c8b9cd3:${hash}`);
    expect(canonicalSoundUrl(asset(), 'https://example.test')).toBe(`https://example.test/sounds/test.wav?sha256=${hash}`);
    expect(() => canonicalSoundUrl(asset({ url: 'https://other.test/test.wav' }), 'https://example.test')).toThrow('same-origin');
    expect(() => canonicalSoundUrl(asset({ status: 'quarantined' }), 'https://example.test')).toThrow('not cacheable');
  });

  it('downloads once, verifies bytes, and reuses the persistent response', async () => {
    environment();
    const fetchMock = vi.fn(async () => new Response(bytes.slice(0), { status: 200, headers: { 'content-type': 'audio/wav', 'content-length': String(bytes.byteLength) } }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new AudioAssetCache();
    await expect(cache.load(asset())).resolves.toEqual(bytes);
    await expect(cache.load(asset())).resolves.toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent loads and treats a changed hash as a new version', async () => {
    environment();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => { await gate; return new Response(bytes.slice(0), { status: 200, headers: { 'content-type': 'audio/wav' } }); });
    vi.stubGlobal('fetch', fetchMock);
    const cache = new AudioAssetCache();
    const first = cache.load(asset()); const second = cache.load(asset());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); release(); await Promise.all([first, second]);
    await expect(cache.load(asset({ contentSha256: 'f'.repeat(64) }))).rejects.toThrow('integrity');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects partial and oversized responses without caching them', async () => {
    const cacheStorage = environment();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.slice(0), { status: 206, headers: { 'content-type': 'audio/wav' } })));
    await expect(new AudioAssetCache().load(asset())).rejects.toThrow('Invalid audio response');
    expect(cacheStorage.entries.size).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.slice(0), { status: 200, headers: { 'content-type': 'audio/wav' } })));
    await expect(new AudioAssetCache().load(asset({ byteSize: 11 * 1024 * 1024 }))).rejects.toThrow('Invalid audio size');
  });

  it('prunes only ineligible entries from the owned cache', async () => {
    const cacheStorage = environment();
    const kept = canonicalSoundUrl(asset(), 'https://example.test');
    cacheStorage.entries.set(kept, new Response(bytes.slice(0)));
    cacheStorage.entries.set('https://example.test/sounds/old.wav?sha256=' + '1'.repeat(64), new Response(bytes.slice(0)));
    await new AudioAssetCache().prune([asset()]);
    expect([...cacheStorage.entries.keys()]).toEqual([kept]);
  });

  it('evicts the least recently used owned response before exceeding its budget', async () => {
    const cacheStorage = environment();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.slice(0), { status: 200, headers: { 'content-type': 'audio/wav' } })));
    const cache = new AudioAssetCache(bytes.byteLength + 1);
    const first = asset();
    const second = asset({ id: 'b4d9b49f-6856-482d-b769-2fdc7854a435', url: '/sounds/second.wav' });
    await cache.load(first); await cache.load(second);
    expect([...cacheStorage.entries.keys()]).toEqual([canonicalSoundUrl(second, 'https://example.test')]);
  });
});
