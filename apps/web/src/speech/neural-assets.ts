export const TTS_MODEL_CACHE_NAME = 'tiktok-helper-tts-models-v1';
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 180_000;

export interface NeuralPackageFile { name: string; byteSize: number; sha256: string }
export interface NeuralVoicePackage {
  id: 'ru-RU-irina-medium-int8' | 'ru-RU-denis-medium-int8' | 'ru-RU-dmitri-medium-int8'
    | 'ru-RU-ruslan-medium-int8' | 'en-US-lessac-medium-int8' | 'en-US-amy-medium-int8'
    | 'en-US-hfc-female-medium-int8' | 'en-US-hfc-male-medium-int8';
  language: 'ru-RU' | 'en-US';
  displayName: string;
  files: readonly NeuralPackageFile[];
}

const SHARED_FILES: readonly NeuralPackageFile[] = [
  { name: 'sherpa-onnx-tts.worker.js', byteSize: 2_780, sha256: '2aa4cfebfb468de2b112613b5a583e8a0f27c2c7b1d295ab11993592b5bf0aa2' },
  { name: 'sherpa-onnx-tts.js', byteSize: 34_361, sha256: '1e2b99d64246a142e9f1d4d0738879f61d7859176ec8b054cdbb666cefe9ee94' },
  { name: 'sherpa-onnx-wasm-main-tts.wasm', byteSize: 13_730_283, sha256: '77b1fccbb571b1a87c23e7695f3e16af334d849b2881fc27b953ca57a47a5738' },
];

const ADDITIONAL_SHARED_FILES: readonly NeuralPackageFile[] = [
  { name: 'sherpa-onnx-tts.worker.js', byteSize: 2_780, sha256: '2aa4cfebfb468de2b112613b5a583e8a0f27c2c7b1d295ab11993592b5bf0aa2' },
  { name: 'sherpa-onnx-tts.js', byteSize: 34_361, sha256: '1e2b99d64246a142e9f1d4d0738879f61d7859176ec8b054cdbb666cefe9ee94' },
  { name: 'sherpa-onnx-wasm-main-tts.wasm', byteSize: 13_730_745, sha256: '1771f70f54be78f2ec45de4a2d60a8b08b2187f5c61553ac48e1fd2378a0d77d' },
];

export const NEURAL_VOICE_PACKAGES: readonly NeuralVoicePackage[] = [
  { id: 'ru-RU-irina-medium-int8', language: 'ru-RU', displayName: 'Ирина', files: [...SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_902, sha256: 'b45c4949ba25e60f9c4d8dde3947d5d98c4cc84fb276ce197e1f103f668b5040' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_087, sha256: 'aff8be7cdb19e2041ba77d7a6ebcd31624520780e29cfed458d7888d922568bb' }] },
  { id: 'ru-RU-denis-medium-int8', language: 'ru-RU', displayName: 'Денис', files: [...ADDITIONAL_SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_863, sha256: 'ed2aa62d06c34cd9ae2b4f0b541ed46260a7264f47db4e874bc2e153b01cc515' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_068, sha256: 'd346e7ad3c729558eb07bf1d4e3ad38aacfc5308e251495176f6d87e0075c021' }] },
  { id: 'ru-RU-dmitri-medium-int8', language: 'ru-RU', displayName: 'Дмитрий', files: [...ADDITIONAL_SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_863, sha256: '7232d7f9b53233361d35de098dbc01d1dc334dde63dc0de552487247f2da6810' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_062, sha256: '8aea0900c474c4810a3ced3614ddf61b23cd23c36029a915e25d15a93f55a66c' }] },
  { id: 'ru-RU-ruslan-medium-int8', language: 'ru-RU', displayName: 'Руслан', files: [...ADDITIONAL_SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_863, sha256: 'fca307bc4691498ec30f4684236fd69db8e39c77d6fe1a0c5120e7473e7e89e4' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_085, sha256: '43efb41cd80b2a6c95e076d8bdd92083fc36dd9ba7cd7cdda23341c3de71720b' }] },
  { id: 'en-US-lessac-medium-int8', language: 'en-US', displayName: 'Lessac', files: [...SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_902, sha256: '52c08b09f454bfed4ef645f87e8f17ec027eaa4baac88cde6c583f989f4f78d6' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_112, sha256: '35ba7f66fa7f4490f9d69c8d96e9ee9d9558a7fcf65f72d543f4a3bacb8d32ce' }] },
  { id: 'en-US-amy-medium-int8', language: 'en-US', displayName: 'Amy', files: [...ADDITIONAL_SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_863, sha256: '5ec51a58308393fe67e0c783a917e2eb0b02780f05d04f43c26fd6e3b33c1a09' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_677_107, sha256: 'e4ec1615e86e15c1d0a753f0ab152e65763638f5312d05d90a4ba09538c514c7' }] },
  { id: 'en-US-hfc-female-medium-int8', language: 'en-US', displayName: 'HFC Female', files: [...ADDITIONAL_SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_863, sha256: '0bba77954a7631be1d57d3db7ae5e7b91d55b8a0c4d91f13fd2a86ef35078c18' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_114, sha256: '5b08c483a3f4aa5ca5bf79c84f83f47de41e51e9376a0e5539bce4b140d06c5b' }] },
  { id: 'en-US-hfc-male-medium-int8', language: 'en-US', displayName: 'HFC Male', files: [...ADDITIONAL_SHARED_FILES,
    { name: 'sherpa-onnx-wasm-main-tts.js', byteSize: 109_863, sha256: '72fd7bc8658d9d67204ee70384dd6b112a6d401ba7ccdf255bed7846b65ee668' },
    { name: 'sherpa-onnx-wasm-main-tts.data', byteSize: 36_575_117, sha256: '47f62834b4f8cea9cc03014adb24c36885e76ea3f566125c14bec2982aa31404' }] },
] as const;

export type NeuralAssetState = 'unsupported' | 'missing' | 'ready';
export type NeuralAssetStage = 'download' | 'verify' | 'store';
export class NeuralAssetError extends Error {
  readonly reason: string;
  constructor(readonly stage: NeuralAssetStage, readonly fileName: string, cause: unknown) {
    const causeName = cause instanceof DOMException || cause instanceof Error ? cause.name : 'UnknownError';
    const causeMessage = cause instanceof Error ? cause.message : '';
    super(`TTS ${stage} failed for ${fileName} (${causeName})`, { cause });
    this.name = 'NeuralAssetError';
    this.reason = [
      'TTS package is not published', 'Invalid TTS package response',
      'TTS package integrity mismatch',
    ].includes(causeMessage) ? causeMessage : causeName;
  }
}
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
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== file.byteSize || await sha256Hex(bytes) !== file.sha256) throw new Error('TTS package integrity mismatch');
  return bytes;
}

function storedResponse(bytes: ArrayBuffer, file: NeuralPackageFile): Response {
  const contentType = file.name.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
  return new Response(bytes.slice(0), { status: 200, headers: { 'content-type': contentType, 'x-content-sha256': file.sha256 } });
}

export class NeuralAssetCache {
  supported(): boolean { return typeof window !== 'undefined' && 'caches' in window && Boolean(globalThis.crypto?.subtle); }
  async state(asset: NeuralVoicePackage): Promise<NeuralAssetState> {
    if (!this.supported()) return 'unsupported';
    const cache = await caches.open(TTS_MODEL_CACHE_NAME);
    for (const file of asset.files) {
      const { canonical } = fileUrls(asset, file);
      const cached = await cache.match(new Request(canonical, { credentials: 'same-origin' }));
      if (!cached) return 'missing';
      try { await verifiedBytes(cached, file); } catch { return 'missing'; }
    }
    return 'ready';
  }
  async download(asset: NeuralVoicePackage, onProgress?: (stage: NeuralAssetStage, fileName: string, index: number, total: number) => void): Promise<void> {
    if (!this.supported()) throw new Error('TTS model cache is unsupported');
    if (packageByteSize(asset) > MAX_PACKAGE_BYTES) throw new Error('TTS package exceeds cache budget');
    const destination = await caches.open(TTS_MODEL_CACHE_NAME);
    const written: Request[] = [];
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      for (const [index, file] of asset.files.entries()) {
        const { canonical, versioned } = fileUrls(asset, file);
        const request = new Request(versioned, { credentials: 'same-origin' });
        let response: Response;
        onProgress?.('download', file.name, index + 1, asset.files.length);
        try { response = await fetch(request, { signal: controller.signal }); }
        catch (error) { throw new NeuralAssetError('download', file.name, error); }
        let bytes: ArrayBuffer;
        onProgress?.('verify', file.name, index + 1, asset.files.length);
        try { bytes = await verifiedBytes(response, file); }
        catch (error) { throw new NeuralAssetError('verify', file.name, error); }
        const canonicalRequest = new Request(canonical, { credentials: 'same-origin' });
        onProgress?.('store', file.name, index + 1, asset.files.length);
        try { await destination.put(canonicalRequest, storedResponse(bytes, file)); }
        catch (error) { throw new NeuralAssetError('store', file.name, error); }
        written.push(canonicalRequest);
      }
    } catch (error) {
      await Promise.all(written.map(async (request) => destination.delete(request)));
      throw error;
    } finally { window.clearTimeout(timeout); }
  }
  async remove(asset: NeuralVoicePackage): Promise<void> {
    if (!this.supported()) return;
    const cache = await caches.open(TTS_MODEL_CACHE_NAME);
    await Promise.all(asset.files.flatMap((file) => { const { canonical, versioned } = fileUrls(asset, file); return [cache.delete(new Request(canonical)), cache.delete(new Request(versioned))]; }));
  }
}

export function formatPackageSize(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(1)} МБ`; }
