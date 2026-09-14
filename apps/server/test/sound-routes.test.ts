import { afterEach, describe, expect, it } from 'vitest';
import type { SoundRepository } from '../src/sounds/repository.js';
import { buildApp } from '../src/app.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

const repository: SoundRepository = {
  async seed() {},
  async listSounds(workspaceId) { return workspaceId === 'primary' ? [{ id: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', displayName: 'Аплодисменты', url: '/sounds/test.wav' }] : []; },
  async listMappings() { return []; },
  async saveMapping(workspaceId, input) {
    if (workspaceId !== 'primary' || input.soundAssetId !== '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3') return null;
    return { giftId: input.giftId, soundAssetId: input.soundAssetId, soundDisplayName: 'Аплодисменты', soundUrl: '/sounds/test.wav', isEnabled: input.isEnabled };
  },
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

  it('rejects invalid gift ids and cross-workspace sound ids', async () => {
    const app = buildApp({ logger: false, soundRepository: repository }); apps.add(app);
    expect((await app.inject({ method: 'PUT', url: '/api/workspaces/primary/gift-mappings', payload: {
      giftId: '../secret', soundAssetId: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', isEnabled: true,
    } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/workspaces/other/gift-mappings', payload: {
      giftId: '5655', soundAssetId: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', isEnabled: true,
    } })).statusCode).toBe(404);
  });
});
