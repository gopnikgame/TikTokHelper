import { afterEach, describe, expect, it } from 'vitest';
import type { RecentChannelRepository } from '../src/channels/repository.js';
import { buildApp } from '../src/app.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

const repository: RecentChannelRepository = {
  async record() {},
  async list(workspaceId) {
    return workspaceId === 'primary' ? [{
      tiktokUsername: 'haomei12', connectionCount: 3, lastConnectedAt: '2026-09-14T18:05:00.000Z',
    }] : [];
  },
};

describe('recent channel API', () => {
  it('returns the connection history for the requested workspace', async () => {
    const app = buildApp({ logger: false, recentChannelRepository: repository }); apps.add(app);
    const response = await app.inject({ method: 'GET', url: '/api/workspaces/primary/recent-channels' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({ tiktokUsername: 'haomei12', connectionCount: 3 })]);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/other/recent-channels' })).json()).toEqual([]);
  });
});
