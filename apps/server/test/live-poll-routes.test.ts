import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LivePollState } from '@tiktok-helper/contracts';

import { buildApp } from '../src/app.js';
import type { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import { TikTokSessionManager } from '../src/tiktok/session-manager.js';
import { ScriptedConnector } from './helpers/scripted-connector.js';

const primary = '/api/workspaces/primary/live-polls';
const secondary = '/api/workspaces/secondary/live-polls';
const origin = 'https://helper.example.test';
const admin = { origin, cookie: 'fixture-role=admin' };
const member = { origin, cookie: 'fixture-role=member' };
const startInput = {
  connectionId: randomUUID(), previousPollId: null, question: 'Какой режим?', options: ['Обычный', 'Тихий'],
};
const closeInput = { status: 'closed' };

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

function setup(withAuth = true) {
  const authService = new AuthService({} as AuthRepository, {
    exchange: async () => { throw new Error('not used'); },
    checkSession: async () => true,
    checkAccess: async () => ({ allowed: true, reason: 'active_subscription', validUntil: null }),
  }, {
    basePath: '/tiktokhelper/', bridgeAuthorizeUrl: 'https://cabinet.example.test/login', clientId: 'fixture',
    redirectUri: `${origin}/tiktokhelper/auth/callback`,
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
  const connector = new ScriptedConnector([], '7484000000000000001');
  const manager = new TikTokSessionManager(() => connector, () => undefined);
  const startLivePoll = vi.spyOn(manager, 'startLivePoll');
  const closeLivePoll = vi.spyOn(manager, 'closeLivePoll');
  const app = buildApp({ logger: false, authService: withAuth ? authService : undefined, tiktokManager: manager });
  apps.add(app);
  return { app, manager, connector, startLivePoll, closeLivePoll };
}

describe('live poll HTTP routes', () => {
  it('requires same-origin access to the requested workspace', async () => {
    const { app, startLivePoll, closeLivePoll } = setup();
    const foreignOrigin = { ...member, origin: 'https://elsewhere.example.test' };
    for (const { method, suffix, payload } of [
      { method: 'POST', suffix: '', payload: startInput },
      { method: 'PATCH', suffix: `/${randomUUID()}`, payload: closeInput },
    ] as const) {
      expect((await app.inject({ method, url: primary + suffix, headers: { origin }, payload })).statusCode).toBe(401);
      expect((await app.inject({ method, url: secondary + suffix, headers: member, payload })).statusCode).toBe(403);
      expect((await app.inject({ method, url: primary + suffix, headers: foreignOrigin, payload })).statusCode).toBe(403);
    }
    expect(startLivePoll).not.toHaveBeenCalled();
    expect(closeLivePoll).not.toHaveBeenCalled();
  });

  it('rejects poll management without configured authentication or a local workspace', async () => {
    const { app, startLivePoll, closeLivePoll } = setup(false);
    expect((await app.inject({ method: 'POST', url: primary, headers: member, payload: startInput })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'PATCH', url: `${primary}/${randomUUID()}`, headers: member, payload: closeInput,
    })).statusCode).toBe(401);
    expect(startLivePoll).not.toHaveBeenCalled();
    expect(closeLivePoll).not.toHaveBeenCalled();
  });

  it('lets the workspace member start and close a poll while keeping the votes', async () => {
    const { app, manager, connector } = setup();
    const start = (payload: object) => app.inject({ method: 'POST', url: primary, headers: member, payload });
    const close = (id: string) => app.inject({ method: 'PATCH', url: `${primary}/${id}`, headers: member, payload: closeInput });
    const inactive = await start(startInput);
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json()).toMatchObject({ error: { code: 'POLL_CONFLICT' } });
    const { connectionId } = await manager.start('primary', 'fixture_streamer');
    expect((await start(startInput)).statusCode).toBe(409);

    const input = { ...startInput, connectionId, question: '  Какой режим? ', options: [' Обычный ', 'Тихий'] };
    const started = await start(input);
    expect(started.statusCode).toBe(201);
    expect(started.headers['cache-control']).toBe('no-store');
    const state = started.json<LivePollState>();
    expect(state).toMatchObject({
      workspaceId: 'primary', connectionId, poll: {
        question: 'Какой режим?', status: 'open', options: [{ label: 'Обычный', votes: 0 }, { label: 'Тихий', votes: 0 }],
      },
    });
    const pollId = state.poll!.id;
    expect((await start(input)).statusCode).toBe(409);
    expect((await close(randomUUID())).statusCode).toBe(409);
    connector.emit('chat', {
      common: { msgId: 'fixture-vote' }, user: { id: '7484000000000000010', uniqueId: 'fixture_viewer' }, comment: '!2',
    });

    const closed = await close(pollId);
    expect(closed.statusCode).toBe(200);
    expect(closed.headers['cache-control']).toBe('no-store');
    expect(closed.json()).toMatchObject({ poll: {
      id: pollId, status: 'closed', options: [{ label: 'Обычный', votes: 0 }, { label: 'Тихий', votes: 1 }],
    } });
    expect((await close(pollId)).json()).toEqual(closed.json());
    expect((await start(input)).statusCode).toBe(409);
    const next = await start({ ...input, previousPollId: pollId });
    expect(next.statusCode).toBe(201);
    expect(next.json<LivePollState>().poll?.id).not.toBe(pollId);
    expect((await close(pollId)).statusCode).toBe(409);
  });

  it('rejects malformed JSON payloads before any type coercion or state mutation', async () => {
    const { app, startLivePoll, closeLivePoll } = setup();
    const headers = { ...admin, 'content-type': 'application/json' };
    for (const payload of [
      { ...startInput, question: 123 }, { ...startInput, question: '  ' },
      { ...startInput, options: ['Первый', 2] }, { ...startInput, options: ['Первый', ' Первый '] },
      { ...startInput, previousPollId: false }, { ...startInput, extra: true }, [startInput],
    ]) {
      const response = await app.inject({ method: 'POST', url: primary, headers, payload: JSON.stringify(payload) });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    for (const payload of [
      { status: ['closed'] }, { status: 'open' }, { status: 'closed', votes: 9 }, [closeInput],
    ]) {
      const response = await app.inject({
        method: 'PATCH', url: `${primary}/${randomUUID()}`, headers, payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    expect((await app.inject({ method: 'PATCH', url: `${primary}/invalid`, headers, payload: closeInput })).statusCode).toBe(400);
    expect(startLivePoll).not.toHaveBeenCalled();
    expect(closeLivePoll).not.toHaveBeenCalled();
  });
});
