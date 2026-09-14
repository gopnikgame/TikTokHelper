import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { SettingsRepository } from '../src/settings/repository.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map((app) => app.close())); apps.clear(); });
const stored = new Map<string, Parameters<SettingsRepository['save']>[1]>();
const repository: SettingsRepository = {
  async get(workspaceId) { const value = stored.get(workspaceId); return value ? { workspaceId, ...value, revision: 1 } : null; },
  async save(workspaceId, input) { stored.set(workspaceId, input); return { workspaceId, ...input, revision: 1 }; },
};

describe('workspace settings API', () => {
  it('round-trips validated settings through the repository', async () => {
    stored.clear(); const app = buildApp({ logger: false, settingsRepository: repository }); apps.add(app);
    const payload = { tiktokUsername: '@operator.name', playbackMode: 'controlled_overlap', overlapPercent: 25, maxConcurrentSounds: 4, volumePercent: 80 } as const;
    expect((await app.inject({ method: 'PUT', url: '/api/workspaces/primary/settings', payload })).statusCode).toBe(200);
    const loaded = await app.inject({ method: 'GET', url: '/api/workspaces/primary/settings' });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual({ workspaceId: 'primary', ...payload, revision: 1 });
  });

  it('rejects invalid percentages and additional fields', async () => {
    const app = buildApp({ logger: false, settingsRepository: repository }); apps.add(app);
    const response = await app.inject({ method: 'PUT', url: '/api/workspaces/primary/settings', payload: {
      tiktokUsername: '@operator', playbackMode: 'controlled_overlap', overlapPercent: 101,
      maxConcurrentSounds: 4, volumePercent: 80, isAdmin: true,
    } });
    expect(response.statusCode).toBe(400);
  });

  it('does not leak settings across workspace ids', async () => {
    stored.clear(); const app = buildApp({ logger: false, settingsRepository: repository }); apps.add(app);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/other/settings' })).statusCode).toBe(404);
  });
});
