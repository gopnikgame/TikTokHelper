import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { createSoundUploadStore } from '../src/sounds/upload.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('sound upload storage', () => {
  it('detects WAV content and stores it under a server-generated name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tiktok-sounds-')); roots.push(root);
    const data = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    const stored = await createSoundUploadStore(root).save(data, 'application/octet-stream');
    expect(stored.storageKey).toMatch(/^uploaded\/[0-9a-f-]+\.wav$/);
    expect(await readFile(join(root, stored.storageKey.slice('uploaded/'.length)))).toEqual(data);
  });

  it('rejects content that only claims to be audio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tiktok-sounds-')); roots.push(root);
    await expect(createSoundUploadStore(root).save(Buffer.from('<html>'), 'audio/wav')).rejects.toThrow('UNSUPPORTED_SOUND_CONTENT');
  });
});
