import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GiftGoalConfiguration, SaveGiftGoal } from '@tiktok-helper/contracts';

import { buildApp } from '../src/app.js';
import type { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import type { GiftGoalRepository } from '../src/gift-goals/repository.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

const primary = '/api/workspaces/primary/gift-goal';
const secondary = '/api/workspaces/secondary/gift-goal';
const admin = { cookie: 'fixture-role=admin' };
const member = { cookie: 'fixture-role=member' };
const goal: SaveGiftGoal = { giftId: '5655', targetCount: 100, soundAssetId: null, isEnabled: true };

function setup(withAuth = true) {
  const authService = new AuthService({} as AuthRepository, { exchange: async () => { throw new Error('not used'); } }, {
    bridgeAuthorizeUrl: 'https://cabinet.example.test/login', clientId: 'fixture',
    redirectUri: 'https://helper.example.test/auth/callback',
  });
  vi.spyOn(authService, 'resolveCookie').mockImplementation(async (cookie) => {
    const isAdmin = cookie === admin.cookie;
    if (!isAdmin && cookie !== member.cookie) return null;
    return {
      sessionId: 'fixture-session', identitySubject: 'fixture', principal: {
        userId: 'fixture-user', displayName: 'Тестовый пользователь', isAdmin,
        workspaces: [{ id: 'primary', displayName: 'Тестовый эфир' }],
      },
    };
  });
  let saved: GiftGoalConfiguration | null = null;
  const repository = {
    get: vi.fn<GiftGoalRepository['get']>(async () => saved),
    save: vi.fn<GiftGoalRepository['save']>(async (_workspaceId, input) => {
      if (input.giftId === 'unknown') return null;
      saved = { ...input, revision: 1 };
      return saved;
    }),
  };
  const onChanged = vi.fn();
  const app = buildApp({
    logger: false, authService: withAuth ? authService : undefined,
    giftGoalRepository: repository, onGiftGoalChanged: onChanged,
  });
  apps.add(app);
  return { app, repository, onChanged };
}

describe('gift goal HTTP routes', () => {
  it('rejects guests and members of another workspace', async () => {
    const { app, repository, onChanged } = setup();
    for (const [url, headers, status] of [[primary, {}, 401], [secondary, member, 403], [secondary, admin, 403]] as const) {
      expect((await app.inject({ url, headers })).statusCode).toBe(status);
      expect((await app.inject({ method: 'PUT', url, headers, payload: goal })).statusCode).toBe(status);
    }
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('requires configured authentication or an explicit local workspace', async () => {
    const { app, repository } = setup(false);
    expect((await app.inject({ url: primary, headers: member })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: primary, headers: member, payload: goal })).statusCode).toBe(401);
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('lets the workspace member read and save the goal and notifies after a successful save', async () => {
    const { app, repository, onChanged } = setup();
    const empty = await app.inject({ url: primary, headers: member });
    expect(empty.statusCode).toBe(200);
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(empty.json()).toBeNull();

    const rejected = await app.inject({ method: 'PUT', url: primary, headers: member, payload: { ...goal, giftId: 'unknown' } });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({ error: { code: 'GIFT_GOAL_ASSET_UNAVAILABLE' } });
    expect(onChanged).not.toHaveBeenCalled();

    const response = await app.inject({ method: 'PUT', url: primary, headers: member, payload: goal });
    const saved = { ...goal, revision: 1 };
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(saved);
    expect(repository.save).toHaveBeenLastCalledWith('primary', goal);
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('primary', saved);
    expect((await app.inject({ url: primary, headers: member })).json()).toEqual(saved);
  });

  it('rejects ambiguous JSON inputs and out-of-range targets', async () => {
    const { app, repository } = setup();
    const invalid = [
      { ...goal, giftId: 5655 }, { ...goal, targetCount: '100' }, { ...goal, targetCount: true },
      { ...goal, targetCount: null }, { ...goal, targetCount: 0 }, { ...goal, targetCount: 1.5 },
      { ...goal, targetCount: 1_000_001 }, { ...goal, isEnabled: 'false' }, { ...goal, isEnabled: 1 },
      { ...goal, soundAssetId: false }, { ...goal, soundAssetId: 'invalid-uuid' }, { ...goal, revision: 5 },
    ];
    for (const payload of invalid) {
      expect((await app.inject({ method: 'PUT', url: primary, headers: admin, payload })).statusCode).toBe(400);
    }
    expect(repository.save).not.toHaveBeenCalled();
  });
});
