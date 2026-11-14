import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegionalGift, RegionalGiftPage } from '@tiktok-helper/contracts';

import { buildApp } from '../src/app.js';
import type { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import type { RegionalGiftCatalogReader } from '../src/gifts/regional-catalog.js';
import type { SoundRepository } from '../src/sounds/repository.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map((app) => app.close())); apps.clear(); });

const origin = 'https://cabinet.example.test';
const admin = { cookie: 'fixture_role=admin', origin };
const member = { cookie: 'fixture_role=member', origin };
const endpoint = '/api/workspaces/primary/regional-gifts/BY';
const mappingEndpoint = '/api/workspaces/primary/gift-mappings';
const gift: RegionalGift = { giftId: '920', giftName: 'Fixture gift', diamondCount: 1, imageUrl: null };
const mapping = { giftId: gift.giftId, soundAssetId: '123e4567-e89b-42d3-a456-426614174000', isEnabled: true };
const page: RegionalGiftPage = {
  gifts: [gift], hasMore: false, status: 'ready', updatedAt: '2026-11-15T01:00:00.000Z', nextRefreshAt: null, canRefresh: true,
};

function setup() {
  const authService = new AuthService({} as AuthRepository, {
    exchange: async () => { throw new Error('not used'); },
    checkSession: async () => true,
    checkAccess: async () => ({ allowed: true, reason: 'active_subscription', validUntil: null }),
  }, {
    basePath: '/tiktokhelper/', bridgeAuthorizeUrl: `${origin}/login`, clientId: 'fixture',
    redirectUri: `${origin}/tiktokhelper/auth/callback`,
  });
  vi.spyOn(authService, 'resolveCookie').mockImplementation(async (cookie) => {
    const isAdmin = cookie === admin.cookie;
    if (!isAdmin && cookie !== member.cookie) return null;
    return {
      sessionId: 'fixture-session', identitySubject: 'fixture', principal: {
        userId: 'fixture-user', displayName: null, isAdmin,
        workspaces: [{ id: 'primary', displayName: 'Fixture workspace' }],
      },
    };
  });
  const catalog = {
    search: vi.fn(async () => page), refresh: vi.fn(async () => {}),
    find: vi.fn<RegionalGiftCatalogReader['find']>(async (region, id) => region === 'BY' && id === gift.giftId ? gift : undefined),
  };
  const saveMapping = vi.fn<SoundRepository['saveMapping']>(async () => ({
    ...mapping, soundDisplayName: 'Fixture sound', soundUrl: '/sounds/fixture.wav',
  }));
  const soundRepository = { saveMapping } as unknown as SoundRepository;
  const app = buildApp({ logger: false, authService, regionalGiftCatalog: catalog, soundRepository });
  apps.add(app);
  return { app, catalog, saveMapping };
}

describe('regional gift HTTP routes', () => {
  it('requires workspace ownership, administrator permission and the cabinet origin for refresh', async () => {
    const { app, catalog, saveMapping } = setup();
    expect((await app.inject({ url: endpoint })).statusCode).toBe(401);
    expect((await app.inject({ url: endpoint, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ url: endpoint.replace('primary', 'other'), headers: admin })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'POST', url: `${endpoint}/refresh`, headers: { cookie: admin.cookie }, payload: { force: true },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'POST', url: `${endpoint}/refresh`, headers: member, payload: { force: true },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'PUT', url: mappingEndpoint, headers: member, payload: { ...mapping, catalogRegion: 'BY' },
    })).statusCode).toBe(403);
    expect(catalog.search).not.toHaveBeenCalled();
    expect(catalog.refresh).not.toHaveBeenCalled();
    expect(catalog.find).not.toHaveBeenCalled();
    expect(saveMapping).not.toHaveBeenCalled();
  });

  it('validates controls and keeps search separate from refresh', async () => {
    const { app, catalog } = setup();
    expect((await app.inject({ url: endpoint.replace('/BY', '/GB'), headers: admin })).statusCode).toBe(400);
    expect((await app.inject({ url: `${endpoint}?page=0`, headers: admin })).statusCode).toBe(400);
    expect((await app.inject({ url: `${endpoint}?q=${'a'.repeat(161)}`, headers: admin })).statusCode).toBe(400);
    const search = await app.inject({ url: `${endpoint}?q=rose&page=2`, headers: admin });
    expect(search.statusCode).toBe(200);
    expect(search.headers['cache-control']).toBe('no-store');
    expect(search.json()).toEqual(page);
    expect(catalog.search).toHaveBeenCalledExactlyOnceWith('BY', 'rose', 2);
    expect(catalog.refresh).not.toHaveBeenCalled();
    expect((await app.inject({
      method: 'POST', url: `${endpoint}/refresh`, headers: admin, payload: { force: false },
    })).statusCode).toBe(204);
    expect(catalog.refresh).toHaveBeenCalledExactlyOnceWith('BY', false);
  });

  it('uses provider metadata only from the selected region and preserves ordinary mappings', async () => {
    const { app, catalog, saveMapping } = setup();
    expect((await app.inject({
      method: 'PUT', url: mappingEndpoint, headers: admin, payload: { ...mapping, catalogRegion: 'US' },
    })).statusCode).toBe(404);
    expect(saveMapping).not.toHaveBeenCalled();
    expect((await app.inject({
      method: 'PUT', url: mappingEndpoint, headers: admin, payload: { ...mapping, catalogRegion: 'BY', giftName: 'Fake name' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'PUT', url: mappingEndpoint, headers: admin, payload: { ...mapping, catalogRegion: 'BY' },
    })).statusCode).toBe(200);
    expect(catalog.find).toHaveBeenLastCalledWith('BY', gift.giftId);
    expect(saveMapping).toHaveBeenLastCalledWith('primary', mapping, gift);
    expect((await app.inject({
      method: 'PUT', url: mappingEndpoint, headers: member, payload: mapping,
    })).statusCode).toBe(200);
    expect(saveMapping).toHaveBeenLastCalledWith('primary', mapping, undefined);
  });
});
