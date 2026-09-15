import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_SOUND_BYTES = 10 * 1024 * 1024;

export interface StoredSound {
  storageKey: string;
  mimeType: string;
  remove(): Promise<void>;
}

export interface SoundUploadStore {
  save(data: Buffer, declaredMimeType: string): Promise<StoredSound>;
  remove(storageKey: string): Promise<void>;
}

function detectAudio(data: Buffer): { extension: string; mimeType: string } | null {
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { extension: 'wav', mimeType: 'audio/wav' };
  }
  if (data.length >= 4 && data.subarray(0, 4).toString('ascii') === 'OggS') {
    return { extension: 'ogg', mimeType: 'audio/ogg' };
  }
  if (data.length >= 3 && data.subarray(0, 3).toString('ascii') === 'ID3') {
    return { extension: 'mp3', mimeType: 'audio/mpeg' };
  }
  if (data.length >= 2 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) {
    return { extension: 'mp3', mimeType: 'audio/mpeg' };
  }
  if (data.length >= 12 && data.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { extension: 'm4a', mimeType: 'audio/mp4' };
  }
  return null;
}

const allowedDeclaredTypes = new Set([
  'application/octet-stream', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/x-wav',
]);

export function createSoundUploadStore(root: string): SoundUploadStore {
  return {
    async remove(storageKey) {
      if (!/^uploaded\/[0-9a-f-]+\.(wav|mp3|ogg|m4a)$/.test(storageKey)) return;
      await rm(join(root, storageKey.slice('uploaded/'.length)), { force: true });
    },
    async save(data, declaredMimeType) {
      const normalizedType = declaredMimeType.split(';', 1)[0]!.trim().toLowerCase();
      if (!allowedDeclaredTypes.has(normalizedType)) throw new TypeError('UNSUPPORTED_SOUND_TYPE');
      if (data.length === 0 || data.length > MAX_SOUND_BYTES) throw new RangeError('INVALID_SOUND_SIZE');
      const detected = detectAudio(data);
      if (!detected) throw new TypeError('UNSUPPORTED_SOUND_CONTENT');
      await mkdir(root, { recursive: true });
      const filename = `${randomUUID()}.${detected.extension}`;
      const path = join(root, filename);
      await writeFile(path, data, { flag: 'wx', mode: 0o640 });
      return {
        storageKey: `uploaded/${filename}`,
        mimeType: detected.mimeType,
        remove: async () => { await rm(path, { force: true }); },
      };
    },
  };
}
