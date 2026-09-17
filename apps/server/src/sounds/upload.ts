import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectSoundData, type SoundContentMetadata } from './metadata.js';

export const MAX_SOUND_BYTES = 10 * 1024 * 1024;

export interface StoredSound extends SoundContentMetadata {
  storageKey: string;
  remove(): Promise<void>;
}

export interface SoundUploadStore {
  save(data: Buffer, declaredMimeType: string): Promise<StoredSound>;
  remove(storageKey: string): Promise<void>;
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
      const metadata = inspectSoundData(data);
      await mkdir(root, { recursive: true });
      const filename = `${randomUUID()}.${metadata.extension}`;
      const path = join(root, filename);
      await writeFile(path, data, { flag: 'wx', mode: 0o640 });
      return {
        storageKey: `uploaded/${filename}`,
        mimeType: metadata.mimeType,
        contentSha256: metadata.contentSha256,
        byteSize: metadata.byteSize,
        remove: async () => { await rm(path, { force: true }); },
      };
    },
  };
}
