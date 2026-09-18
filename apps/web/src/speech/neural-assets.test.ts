import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuralAssetCache, TTS_MODEL_CACHE_NAME, type NeuralVoicePackage } from './neural-assets.js';

const bytes = new TextEncoder().encode('verified model package').buffer;
const asset: NeuralVoicePackage = {
  id: 'en-US-lessac-medium-int8', language: 'en-US', displayName: 'Test', files: [{
    name: 'test.data', byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
  }],
};

class MemoryCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request) { return this.entries.get(request.url)?.clone(); }
  async put(request: Request, response: Response) { this.entries.set(request.url, response.clone()); }
  async delete(request: Request) { return this.entries.delete(request.url); }
}

afterEach(() => vi.unstubAllGlobals());

function environment() {
  const stores = new Map<string, MemoryCache>();
  vi.stubGlobal('window', { location: { origin: 'https://example.test' }, caches: {}, setTimeout, clearTimeout });
  vi.stubGlobal('caches', {
    open: vi.fn(async (name: string) => { const cache = stores.get(name) ?? new MemoryCache(); stores.set(name, cache); return cache; }),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  });
  return { stores, destination: () => stores.get(TTS_MODEL_CACHE_NAME) };
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
    expect(cache.destination()?.entries.size).toBe(1);
    expect([...cache.stores.keys()]).toEqual([TTS_MODEL_CACHE_NAME]);
  });

  it('does not cache corrupt or partial data', async () => {
    const cache = environment();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode('wrong'), { status: 200 })));
    await expect(new NeuralAssetCache().download(asset)).rejects.toMatchObject({
      name: 'NeuralAssetError', stage: 'verify', fileName: 'test.data',
    });
    expect(cache.destination()?.entries.size ?? 0).toBe(0);
  });

  it('reports a corrupt cached response as missing', async () => {
    const cache = environment();
    const file = asset.files[0]!;
    const destination = new MemoryCache(); cache.stores.set(TTS_MODEL_CACHE_NAME, destination);
    const url = `https://example.test/tts-assets/voices/${asset.id}/${file.name}`;
    destination.entries.set(url, new Response(new TextEncoder().encode('wrong'), { status: 200 }));
    await expect(new NeuralAssetCache().state(asset)).resolves.toBe('missing');
    expect(destination.entries.size).toBe(1);
  });

  it('reports Safari-compatible cache write failures and removes partial data', async () => {
    const cache = environment();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.slice(0), { status: 200 })));
    const destination = new MemoryCache();
    destination.put = async () => { throw new DOMException('Quota reached', 'QuotaExceededError'); };
    cache.stores.set(TTS_MODEL_CACHE_NAME, destination);
    await expect(new NeuralAssetCache().download(asset)).rejects.toMatchObject({
      name: 'NeuralAssetError', stage: 'store', fileName: 'test.data',
      cause: { name: 'QuotaExceededError' },
    });
    expect(destination.entries.size).toBe(0);
  });
});
