import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { soundLibraryAssets } from '../db/schema.js';

export interface SoundContentMetadata {
  contentSha256: string;
  byteSize: number;
  mimeType: string;
}

export function detectAudio(data: Buffer): { extension: string; mimeType: string } | null {
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

export function inspectSoundData(data: Buffer): SoundContentMetadata & { extension: string } {
  const detected = detectAudio(data);
  if (!detected) throw new TypeError('UNSUPPORTED_SOUND_CONTENT');
  return {
    ...detected,
    contentSha256: createHash('sha256').update(data).digest('hex'),
    byteSize: data.byteLength,
  };
}

export async function inspectSoundFile(path: string): Promise<SoundContentMetadata> {
  const { contentSha256, byteSize, mimeType } = inspectSoundData(await readFile(path));
  return { contentSha256, byteSize, mimeType };
}

function storagePath(storageKey: string, soundRoot?: string, soundUploadRoot?: string): string {
  if (storageKey.startsWith('uploaded/')) {
    const filename = storageKey.slice('uploaded/'.length);
    if (!soundUploadRoot || basename(filename) !== filename || !/^[0-9a-f-]+\.(wav|mp3|ogg|m4a)$/i.test(filename)) {
      throw new Error(`Invalid or unavailable uploaded sound path: ${storageKey}`);
    }
    return join(soundUploadRoot, filename);
  }
  if (!soundRoot || basename(storageKey) !== storageKey || !/\.wav$/i.test(storageKey)) {
    throw new Error(`Invalid or unavailable built-in sound path: ${storageKey}`);
  }
  return join(soundRoot, storageKey);
}

export async function synchronizeSoundMetadata(
  db: Database,
  roots: { soundRoot?: string; soundUploadRoot?: string },
): Promise<{ inspected: number; updated: number }> {
  const assets = await db.select({
    id: soundLibraryAssets.id,
    storageKey: soundLibraryAssets.storageKey,
    contentSha256: soundLibraryAssets.contentSha256,
    byteSize: soundLibraryAssets.byteSize,
    mimeType: soundLibraryAssets.mimeType,
  }).from(soundLibraryAssets);
  let updated = 0;
  for (const asset of assets) {
    const metadata = await inspectSoundFile(storagePath(asset.storageKey, roots.soundRoot, roots.soundUploadRoot));
    if (asset.contentSha256 === metadata.contentSha256 && asset.byteSize === metadata.byteSize && asset.mimeType === metadata.mimeType) continue;
    await db.update(soundLibraryAssets).set(metadata).where(eq(soundLibraryAssets.id, asset.id));
    updated += 1;
  }
  return { inspected: assets.length, updated };
}
