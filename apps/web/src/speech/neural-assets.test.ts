import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuralAssetCache, TTS_MODEL_CACHE_NAME, type NeuralVoicePackage } from './neural-assets.js';

const bytes = new TextEncoder().encode('verified model package').buffer;
const asset: NeuralVoicePackage = {
  id: 'en-US-lessac-medium-int8', language: 'en-US', displayName: 'Test', url: '/tts-assets/voices/test.tar.bz2',
  byteSize: bytes.byteLength, sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
};

class MemoryCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request) { return this.entries.get(request.url)?.clone(); }
  async put(request: Request, response: Response) { this.entries.set(request.url, response.clone()); }
  async delete(request: Request) { return this.entries.delete(request.url); }
}

afterEach(() => vi.unstubAllGlobals());

function environment() {
  const cache = new MemoryCache();
  vi.stubGlobal('window', { location: { origin: 'https://example.test' }, caches: {}, setTimeout, clearTimeout });
  vi.stubGlobal('caches', { open: vi.fn(async (name: string) => { expect(name).toBe(TTS_MODEL_CACHE_NAME); return cache; }) });
  return cache;
}

describe('NeuralAssetCache', () => {
  it('downloads, verifies and persists a same-origin package', async () => {
    const cache = environment();
    const fetchMock = vi.fn(async () => new Response(bytes.slice(0), { status: 200, headers: { 'content-length': String(bytes.byteLength) } }));
    vi.stubGlobal('fetch', fetchMock);
    const assets = new NeuralAssetCache();
    await assets.download(asset);
    await expect(assets.state(asset)).resolves.toBe('ready');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cache.entries.size).toBe(1);
  });

  it('does not cache corrupt or partial data', async () => {
    const cache = environment();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode('wrong'), { status: 200 })));
    await expect(new NeuralAssetCache().download(asset)).rejects.toThrow('integrity');
    expect(cache.entries.size).toBe(0);
  });

  it('evicts a corrupt cached response during inspection', async () => {
    const cache = environment();
    const url = `https://example.test${asset.url}?sha256=${asset.sha256}`;
    cache.entries.set(url, new Response(new TextEncoder().encode('wrong'), { status: 200 }));
    await expect(new NeuralAssetCache().state(asset)).resolves.toBe('missing');
    expect(cache.entries.size).toBe(0);
  });
});
