export const TTS_MODEL_CACHE_NAME = 'tiktok-helper-tts-models-v1';
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface NeuralVoicePackage {
  id: 'ru-RU-irina-medium-int8' | 'en-US-lessac-medium-int8';
  language: 'ru-RU' | 'en-US';
  displayName: string;
  byteSize: number;
  sha256: string;
  url: string;
}

export const NEURAL_VOICE_PACKAGES: readonly NeuralVoicePackage[] = [
  {
    id: 'ru-RU-irina-medium-int8', language: 'ru-RU', displayName: 'Ирина',
    byteSize: 21_149_417, sha256: 'b0000a509f7551a80742eed5c43b8eb03f469cb9f0a42f6feee96ce0da0ebab8',
    url: '/tts-assets/voices/ru-RU-irina-medium-int8.tar.bz2',
  },
  {
    id: 'en-US-lessac-medium-int8', language: 'en-US', displayName: 'Lessac',
    byteSize: 20_969_179, sha256: 'f1c6d0295cf16087b05f80fdca5b44daca5cd78e2c425d419a42ba34929805f9',
    url: '/tts-assets/voices/en-US-lessac-medium-int8.tar.bz2',
  },
] as const;

export type NeuralAssetState = 'unsupported' | 'missing' | 'ready';

function packageUrl(asset: NeuralVoicePackage, origin = window.location.origin): string {
  if (!/^[0-9a-f]{64}$/.test(asset.sha256) || asset.byteSize < 1 || asset.byteSize > MAX_PACKAGE_BYTES) {
    throw new Error('Invalid TTS package metadata');
  }
  const url = new URL(asset.url, origin);
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:';
  if (url.origin !== origin || (url.protocol !== 'https:' && !localDevelopment)) throw new Error('TTS package must be same-origin HTTPS');
  url.searchParams.set('sha256', asset.sha256);
  return url.href;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifiedBytes(response: Response, asset: NeuralVoicePackage): Promise<ArrayBuffer> {
  if (response.status !== 200 || response.redirected || response.type === 'opaque' || response.headers.has('content-range')) {
    throw new Error(response.status === 404 ? 'TTS package is not published' : 'Invalid TTS package response');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) !== asset.byteSize) throw new Error('TTS package length mismatch');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.byteSize || await sha256Hex(bytes) !== asset.sha256) throw new Error('TTS package integrity mismatch');
  return bytes;
}

export class NeuralAssetCache {
  supported(): boolean {
    return typeof window !== 'undefined' && 'caches' in window && Boolean(globalThis.crypto?.subtle);
  }

  async state(asset: NeuralVoicePackage): Promise<NeuralAssetState> {
    if (!this.supported()) return 'unsupported';
    const cache = await caches.open(TTS_MODEL_CACHE_NAME);
    const request = new Request(packageUrl(asset), { credentials: 'same-origin' });
    const cached = await cache.match(request);
    if (!cached) return 'missing';
    try {
      await verifiedBytes(cached, asset);
      return 'ready';
    } catch {
      await cache.delete(request);
      return 'missing';
    }
  }

  async download(asset: NeuralVoicePackage): Promise<void> {
    if (!this.supported()) throw new Error('TTS model cache is unsupported');
    const request = new Request(packageUrl(asset), { credentials: 'same-origin' });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(request, { signal: controller.signal });
      const bytes = await verifiedBytes(response, asset);
      const cache = await caches.open(TTS_MODEL_CACHE_NAME);
      await cache.put(request, new Response(bytes.slice(0), {
        status: 200,
        headers: {
          'content-length': String(asset.byteSize),
          'content-type': 'application/x-bzip2',
          'x-content-sha256': asset.sha256,
        },
      }));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async remove(asset: NeuralVoicePackage): Promise<void> {
    if (!this.supported()) return;
    const cache = await caches.open(TTS_MODEL_CACHE_NAME);
    await cache.delete(new Request(packageUrl(asset), { credentials: 'same-origin' }));
  }
}

export function formatPackageSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
