import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIKE_GOAL_MAX_TARGET, type LikeGoalConfiguration } from '@tiktok-helper/contracts';

import { buildApp } from '../src/app.js';
import type { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import type { LikeGoalRepository } from '../src/like-goals/repository.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

const primary = '/api/workspaces/primary/like-goal';
const secondary = '/api/workspaces/secondary/like-goal';
const admin = { cookie: 'fixture-role=admin' };
const member = { cookie: 'fixture-role=member' };
const goal = { targetCount: 100 };
const disabled = { targetCount: null, revision: 0 };

function setup() {
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
  const settings = new Map<string, LikeGoalConfiguration>();
  const get = (workspaceId: string) => settings.get(workspaceId) ?? disabled;
  const repository = {
    get: vi.fn<LikeGoalRepository['get']>(async (workspaceId) => get(workspaceId)),
    save: vi.fn<LikeGoalRepository['save']>(async (workspaceId, input) => {
      const existing = settings.get(workspaceId);
      if (existing?.targetCount === input.targetCount) return existing;
      const config = { ...input, revision: get(workspaceId).revision + 1 };
      settings.set(workspaceId, config);
      return config;
    }),
  };
  const onChanged = vi.fn();
  const app = buildApp({ logger: false, authService, likeGoalRepository: repository, onLikeGoalChanged: onChanged });
  apps.add(app);
  return { app, repository, onChanged };
}

describe('like goal HTTP routes', () => {
  it('requires an administrator with access to the requested workspace', async () => {
    const { app, repository, onChanged } = setup();
    expect((await app.inject({ url: primary })).statusCode).toBe(401);
    expect((await app.inject({ url: primary, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: primary, headers: member, payload: goal })).statusCode).toBe(403);
    expect((await app.inject({ url: secondary, headers: admin })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: secondary, headers: admin, payload: goal })).statusCode).toBe(403);
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('serves the initial goal and synchronizes saved and disabled configurations', async () => {
    const { app, onChanged } = setup();
    const initial = await app.inject({ url: primary, headers: admin });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.json()).toEqual(disabled);

    const maximum = { targetCount: LIKE_GOAL_MAX_TARGET };
    const save = (payload: object) => app.inject({ method: 'PUT', url: primary, headers: admin, payload });
    const first = await save(maximum);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toEqual({ ...maximum, revision: 1 });
    expect((await save(maximum)).json()).toEqual(first.json());
    expect(onChanged).toHaveBeenLastCalledWith('primary', first.json());

    const stopped = await save({ targetCount: null });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toEqual({ targetCount: null, revision: 2 });
    expect(onChanged).toHaveBeenLastCalledWith('primary', stopped.json());
    expect((await app.inject({ url: primary, headers: admin })).json()).toEqual(stopped.json());
  });

  it('rejects ambiguous or extraneous JSON and out-of-range targets', async () => {
    const { app, repository } = setup();
    const invalid = [
      {}, { targetCount: '100' }, { targetCount: true }, { targetCount: 0 },
      { targetCount: -1 }, { targetCount: 1.5 }, { targetCount: LIKE_GOAL_MAX_TARGET + 1 },
      { targetCount: [] }, { targetCount: [1] }, { targetCount: [null] },
      { targetCount: null, revision: 1 }, [goal],
    ];
    for (const payload of invalid) {
      const response = await app.inject({
        method: 'PUT', url: primary, headers: { ...admin, 'content-type': 'application/json' }, payload: JSON.stringify(payload),
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    expect(repository.save).not.toHaveBeenCalled();
  });
});
