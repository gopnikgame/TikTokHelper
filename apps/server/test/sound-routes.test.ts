import { afterEach, describe, expect, it } from 'vitest';
import type { SoundRepository } from '../src/sounds/repository.js';
import { buildApp } from '../src/app.js';
import type { SoundUploadStore } from '../src/sounds/upload.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

const repository: SoundRepository = {
  async seed() {},
  async listSounds() { return [{ id: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', displayName: 'Аплодисменты', url: '/sounds/test.wav' }]; },
  async listMappings() { return []; },
  async saveMapping(workspaceId, input) {
    if (input.soundAssetId !== '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3') return null;
    return { giftId: input.giftId, soundAssetId: input.soundAssetId, soundDisplayName: 'Аплодисменты', soundUrl: '/sounds/test.wav', isEnabled: input.isEnabled };
  },
  async createSound(workspaceId, sound) {
    return { id: 'd359e3be-e1f2-49b8-b57d-dfb6e8cbc877', displayName: `${workspaceId}:${sound.displayName}`, url: '/media/sounds/upload.wav' };
  },
};

const uploadStore: SoundUploadStore = {
  async save() { return { storageKey: 'uploaded/upload.wav', mimeType: 'audio/wav', async remove() {} }; },
};

describe('sound library API', () => {
  it('lists workspace sounds and persists a validated mapping', async () => {
    const app = buildApp({ logger: false, soundRepository: repository }); apps.add(app);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/primary/sounds' })).json()).toHaveLength(1);
    const saved = await app.inject({ method: 'PUT', url: '/api/workspaces/primary/gift-mappings', payload: {
      giftId: '5655', soundAssetId: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', isEnabled: true,
    } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ giftId: '5655', soundDisplayName: 'Аплодисменты' });
  });

  it('rejects invalid gift ids and unknown sound ids while allowing shared sounds', async () => {
    const app = buildApp({ logger: false, soundRepository: repository }); apps.add(app);
    expect((await app.inject({ method: 'PUT', url: '/api/workspaces/primary/gift-mappings', payload: {
      giftId: '../secret', soundAssetId: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', isEnabled: true,
    } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/workspaces/other/gift-mappings', payload: {
      giftId: '5655', soundAssetId: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', isEnabled: true,
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/workspaces/primary/gift-mappings', payload: {
      giftId: '5655', soundAssetId: 'd359e3be-e1f2-49b8-b57d-dfb6e8cbc877', isEnabled: true,
    } })).statusCode).toBe(404);
  });

  it('uploads a bounded audio body and returns the new sound', async () => {
    const app = buildApp({ logger: false, soundRepository: repository, soundUploadStore: uploadStore }); apps.add(app);
    const response = await app.inject({
      method: 'POST', url: '/api/workspaces/primary/sounds?displayName=My%20sound.wav',
      headers: { 'content-type': 'audio/wav' }, payload: Buffer.from('RIFFmockWAVE'),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ displayName: 'primary:My sound', url: '/media/sounds/upload.wav' });
  });

  it('rejects unsupported upload types before persisting metadata', async () => {
    const app = buildApp({ logger: false, soundRepository: repository, soundUploadStore: uploadStore }); apps.add(app);
    const response = await app.inject({
      method: 'POST', url: '/api/workspaces/primary/sounds?displayName=script',
      headers: { 'content-type': 'text/html' }, payload: '<script>alert(1)</script>',
    });
    expect(response.statusCode).toBe(415);
  });
});
