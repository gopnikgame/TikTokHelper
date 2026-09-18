export const TTS_MODEL_CACHE_NAME = 'tiktok-helper-tts-models-v1';
const TTS_STAGING_CACHE_PREFIX = 'tiktok-helper-tts-staging-v1-';
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 180_000;

export interface NeuralPackageFile { name: string; byteSize: number; sha256: string }
export interface NeuralVoicePackage {
  id: 'ru-RU-irina-medium-int8' | 'en-US-lessac-medium-int8';
  language: 'ru-RU' | 'en-US';
  displayName: string;
  files: readonly NeuralPackageFile[];
}

const SHARED_FILES: readonly NeuralPackageFile[] = [
  { name: 'sherpa-onnx-tts.worker.js', byteSize: 2_780, sha256: '2aa4cfebfb468de2b112613b5a583e8a0f27c2c7b1d295ab11993592b5bf0aa2' },
  { name: 'sherpa-onnx-tts.js', byteSize: 34_361, sha256: '1e2b99d64246a142e9f1d4d0738879f61d7859176ec8b054cdbb666cefe9ee94' },
  { name: 'sherpa-onnx-wasm-main-tts.wasm', byteSize: 13_730_283, sha256: '77b1fccbb571b1a87c23e7695f3e16af334d849b2881fc27b953ca57a47a5738' },
];

export const NEURAL_VOICE_PACKAGES: readonly NeuralVoicePackage[] = [
  { id: 'ru-RU-irina-medium-int8', language: 'ru-RU', displayName: 'Ирина', files: [...SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_902, sha256: 'b45c4949ba25e60f9c4d8dde3947d5d98c4cc84fb276ce197e1f103f668b5040' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_087, sha256: 'aff8be7cdb19e2041ba77d7a6ebcd31624520780e29cfed458d7888d922568bb' }] },
  { id: 'en-US-lessac-medium-int8', language: 'en-US', displayName: 'Lessac', files: [...SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_902, sha256: '52c08b09f454bfed4ef645f87e8f17ec027eaa4baac88cde6c583f989f4f78d6' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_112, sha256: '35ba7f66fa7f4490f9d69c8d96e9ee9d9558a7fcf65f72d543f4a3bacb8d32ce' }] },
] as const;

export type NeuralAssetState = 'unsupported' | 'missing' | 'ready';
export function packageByteSize(asset: NeuralVoicePackage): number { return asset.files.reduce((sum, file) => sum + file.byteSize, 0); }

export function neuralPackageBaseUrl(asset: NeuralVoicePackage, origin = window.location.origin): string {
  const url = new URL(`/tts-assets/voices/${asset.id}/`, origin);
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:';
  if (url.origin !== origin || (url.protocol !== 'https:' && !localDevelopment)) throw new Error('TTS package must be same-origin HTTPS');
  return url.href;
}

function fileUrls(asset: NeuralVoicePackage, file: NeuralPackageFile): { canonical: string; versioned: string } {
  if (!/^[a-z0-9.-]+$/.test(file.name) || !/^[0-9a-f]{64}$/.test(file.sha256) || file.byteSize < 1 || file.byteSize > MAX_FILE_BYTES) throw new Error('Invalid TTS package metadata');
  const canonical = new URL(file.name, neuralPackageBaseUrl(asset)).href;
  const versioned = new URL(canonical); versioned.searchParams.set('sha256', file.sha256);
  return { canonical, versioned: versioned.href };
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifiedBytes(response: Response, file: NeuralPackageFile): Promise<ArrayBuffer> {
  if (response.status !== 200 || response.redirected || response.type === 'opaque' || response.headers.has('content-range')) throw new Error(response.status === 404 ? 'TTS package is not published' : 'Invalid TTS package response');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) !== file.byteSize) throw new Error('TTS package length mismatch');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== file.byteSize || await sha256Hex(bytes) !== file.sha256) throw new Error('TTS package integrity mismatch');
  return bytes;
}

function storedResponse(bytes: ArrayBuffer, file: NeuralPackageFile): Response {
  const contentType = file.name.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
  return new Response(bytes.slice(0), { status: 200, headers: { 'content-length': String(file.byteSize), 'content-type': contentType, 'x-content-sha256': file.sha256 } });
}

export class NeuralAssetCache {
  supported(): boolean { return typeof window !== 'undefined' && 'caches' in window && Boolean(globalThis.crypto?.subtle); }
  async state(asset: NeuralVoicePackage): Promise<NeuralAssetState> {
    if (!this.supported()) return 'unsupported';
    const cache = await caches.open(TTS_MODEL_CACHE_NAME);
    for (const file of asset.files) {
      const { versioned } = fileUrls(asset, file);
      const cached = await cache.match(new Request(versioned, { credentials: 'same-origin' }));
      if (!cached) return 'missing';
      try { await verifiedBytes(cached, file); } catch { return 'missing'; }
    }
    return 'ready';
  }
  async download(asset: NeuralVoicePackage): Promise<void> {
    if (!this.supported()) throw new Error('TTS model cache is unsupported');
    if (packageByteSize(asset) > MAX_PACKAGE_BYTES) throw new Error('TTS package exceeds cache budget');
    const stagingName = `${TTS_STAGING_CACHE_PREFIX}${asset.id}`;
    await caches.delete(stagingName);
    const staging = await caches.open(stagingName);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      for (const file of asset.files) {
        const { versioned } = fileUrls(asset, file);
        const request = new Request(versioned, { credentials: 'same-origin' });
        const response = await fetch(request, { signal: controller.signal });
        const bytes = await verifiedBytes(response, file);
        await staging.put(request, storedResponse(bytes, file));
      }
      const destination = await caches.open(TTS_MODEL_CACHE_NAME);
      for (const file of asset.files) {
        const { canonical, versioned } = fileUrls(asset, file);
        const verified = await staging.match(new Request(versioned, { credentials: 'same-origin' }));
        if (!verified) throw new Error('TTS staging cache is incomplete');
        await destination.put(new Request(versioned, { credentials: 'same-origin' }), verified.clone());
        await destination.put(new Request(canonical, { credentials: 'same-origin' }), verified.clone());
      }
    } finally { window.clearTimeout(timeout); await caches.delete(stagingName); }
  }
  async remove(asset: NeuralVoicePackage): Promise<void> {
    if (!this.supported()) return;
    const cache = await caches.open(TTS_MODEL_CACHE_NAME);
    await Promise.all(asset.files.flatMap((file) => { const { canonical, versioned } = fileUrls(asset, file); return [cache.delete(new Request(canonical)), cache.delete(new Request(versioned))]; }));
  }
}

export function formatPackageSize(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(1)} МБ`; }
