import { afterEach, describe, expect, it } from 'vitest';
import type { GiftCatalogRepository } from '../src/gifts/repository.js';
import { buildApp } from '../src/app.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

const repository: GiftCatalogRepository = {
  async observe() {},
  async exists(_workspaceId, giftId) { return giftId === '5655'; },
  async list(workspaceId) {
    return workspaceId === 'primary' ? [{
      giftId: '5655', giftName: 'Rose', imageUrl: 'https://cdn.example/rose.png', diamondCount: 1,
      firstSeenAt: '2026-09-14T18:00:00.000Z', lastSeenAt: '2026-09-14T18:05:00.000Z',
    }] : [];
  },
};

describe('observed gift catalogue API', () => {
  it('returns only gifts observed in the requested workspace', async () => {
    const app = buildApp({ logger: false, giftCatalogRepository: repository }); apps.add(app);
    const response = await app.inject({ method: 'GET', url: '/api/workspaces/primary/gifts' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({ giftId: '5655', giftName: 'Rose' })]);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/other/gifts' })).json()).toEqual([]);
  });
});
