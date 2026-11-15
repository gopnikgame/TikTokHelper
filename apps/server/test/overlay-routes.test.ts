import {
  GIFT_GOAL_OVERLAY_TOKEN_HEADER, isGiftGoalOverlayToken, STREAM_OVERLAY_KINDS,
  type GiftGoalOverlayLink, type GiftGoalOverlaySnapshot,
  type StreamOverlayKind, type StreamOverlaySnapshotByKind,
} from '@tiktok-helper/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';

const origin = 'https://helper.example.test';
const primary = '/api/workspaces/primary/gift-goal-overlay';
const secondary = '/api/workspaces/secondary/gift-goal-overlay';
const giftGoalOverlayDataPath = '/api/overlays/gift-goal';
const admin = { origin, cookie: 'fixture-role=admin' };
const otherAdmin = { origin, cookie: 'fixture-role=other-admin' };
const member = { origin, cookie: 'fixture-role=member' };
const enable = { enabled: true };
const disable = { enabled: false };

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
  const resolveCookie = vi.spyOn(authService, 'resolveCookie').mockImplementation(async (cookie) => {
    if (cookie !== admin.cookie && cookie !== otherAdmin.cookie && cookie !== member.cookie) return null;
    return {
      sessionId: 'fixture-session', identitySubject: 'fixture', principal: {
        userId: 'fixture-user', displayName: 'Тестовый пользователь', isAdmin: cookie !== member.cookie,
        workspaces: [{ id: cookie === otherAdmin.cookie ? 'secondary' : 'primary', displayName: 'Тестовый эфир' }],
      },
    };
  });
  const goals = new Map<string, GiftGoalOverlaySnapshot & { workspaceId: string; lastDonor: string }>([
    ['primary', { giftName: 'Роза', progress: 3, targetCount: 10, workspaceId: 'primary', lastDonor: 'fixture-viewer' }],
    ['secondary', { giftName: 'Кофе', progress: 1, targetCount: 5, workspaceId: 'secondary', lastDonor: 'other-viewer' }],
  ]);
  const snapshot = vi.fn((workspaceId: string) => goals.get(workspaceId) ?? null);
  const lastGift = { giftName: 'Роза', quantity: 2, remainingMs: 3_000, senderId: 'fixture-donor' };
  const likeGoal = { progress: 4, targetCount: 9, workspaceId: 'primary' };
  const livePoll = {
    question: 'Что показать?', status: 'open' as const, voterId: 'fixture-voter',
    options: [{ label: 'Розы', votes: 3, voterId: 'fixture-voter' }, { label: 'Кофе', votes: 1 }],
  };
  const otherSnapshots: Partial<StreamOverlaySnapshotByKind> = {
    'last-gift': lastGift, 'like-goal': likeGoal, 'live-poll': livePoll,
  };
  const snapshotFor = <Kind extends StreamOverlayKind>(kind: Kind) => (workspaceId: string) =>
    workspaceId === 'primary' ? otherSnapshots[kind] ?? null : null;
  const app = buildApp({
    logger: false, authService: withAuth ? authService : undefined,
    overlaySnapshots: {
      'gift-goal': snapshot, 'last-gift': snapshotFor('last-gift'),
      'like-goal': snapshotFor('like-goal'), 'live-poll': snapshotFor('live-poll'),
    },
  });
  apps.add(app);
  return { app, goals, resolveCookie, snapshot, otherSnapshots };
}

async function issueLink(app: ReturnType<typeof buildApp>, url = primary, headers = member): Promise<string> {
  const response = await app.inject({ method: 'PUT', url, headers, payload: enable });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const { token } = response.json<GiftGoalOverlayLink>();
  if (!isGiftGoalOverlayToken(token)) throw new Error('The fixture did not issue an overlay link');
  return token;
}

describe('stream overlay HTTP routes', () => {
  it('requires membership in the workspace and a same-origin mutation', async () => {
    const { app } = setup();
    for (const [headers, url, status] of [
      [{ origin }, primary, 401],
      [member, secondary, 403],
      [otherAdmin, primary, 403],
    ] as const) {
      expect((await app.inject({ url, headers })).statusCode).toBe(status);
      expect((await app.inject({ method: 'PUT', url, headers, payload: enable })).statusCode).toBe(status);
    }
    const foreignOrigin = { ...member, origin: 'https://elsewhere.example.test' };
    expect((await app.inject({ method: 'PUT', url: primary, headers: foreignOrigin, payload: enable })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: primary, headers: { cookie: member.cookie }, payload: enable })).statusCode).toBe(403);
    const initial = await app.inject({ url: primary, headers: member });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.json()).toEqual({ token: null });
  });

  it('rejects link management without configured authentication or a local workspace', async () => {
    const { app } = setup(false);
    expect((await app.inject({ url: primary, headers: member })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: primary, headers: member, payload: enable })).statusCode).toBe(401);
  });

  it('rejects coerced or extraneous inputs before issuing a link', async () => {
    const { app } = setup();
    const headers = { ...admin, 'content-type': 'application/json' };
    for (const payload of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: [true] }, { enabled: null },
      { enabled: true, extra: true }, [enable], null]) {
      const response = await app.inject({ method: 'PUT', url: primary, headers, payload: JSON.stringify(payload) });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    expect((await app.inject({ url: primary, headers: admin })).json()).toEqual({ token: null });
  });

  it('gives an overlay link read-only access to the three goal fields in its workspace', async () => {
    const { app, goals, resolveCookie, snapshot } = setup();
    const link = await issueLink(app);
    const otherLink = await issueLink(app, secondary, otherAdmin);
    expect(link === otherLink).toBe(false);
    resolveCookie.mockClear();

    const changedCharacter = link.charAt(23) === 'A' ? 'B' : 'A';
    const tamperedLink = link.slice(0, 23) + changedCharacter + link.slice(24);
    for (const headers of [admin, { [GIFT_GOAL_OVERLAY_TOKEN_HEADER]: 'invalid' },
      { [GIFT_GOAL_OVERLAY_TOKEN_HEADER]: tamperedLink }, { authorization: 'Bearer ' + link }]) {
      const response = await app.inject({ url: giftGoalOverlayDataPath, headers });
      expect(response.statusCode).toBe(401);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect((await app.inject({ url: giftGoalOverlayDataPath + '?token=ignored' })).statusCode).toBe(401);
    expect(snapshot).not.toHaveBeenCalled();

    const primaryOverlay = { [GIFT_GOAL_OVERLAY_TOKEN_HEADER]: link };
    const view = await app.inject({ url: giftGoalOverlayDataPath, headers: primaryOverlay });
    expect(view.statusCode).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.json()).toEqual({ giftName: 'Роза', progress: 3, targetCount: 10 });
    expect(snapshot).toHaveBeenLastCalledWith('primary');
    const otherView = await app.inject({ url: giftGoalOverlayDataPath, headers: { [GIFT_GOAL_OVERLAY_TOKEN_HEADER]: otherLink } });
    expect(otherView.statusCode).toBe(200);
    expect(otherView.json()).toEqual({ giftName: 'Кофе', progress: 1, targetCount: 5 });
    expect(snapshot).toHaveBeenLastCalledWith('secondary');
    expect(resolveCookie).not.toHaveBeenCalled();

    expect((await app.inject({ url: primary, headers: primaryOverlay })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'PUT', url: primary, headers: { ...primaryOverlay, origin }, payload: disable,
    })).statusCode).toBe(401);
    goals.delete('primary');
    const noGoal = await app.inject({ url: giftGoalOverlayDataPath, headers: primaryOverlay });
    expect(noGoal.statusCode).toBe(200);
    expect(noGoal.headers['content-type']).toMatch(/^application\/json/);
    expect(noGoal.json()).toBeNull();
  });

  it('returns the same link when enabled again and keeps a revoked link invalid after reissuing', async () => {
    const { app } = setup();
    const link = await issueLink(app);
    const status = await app.inject({ url: primary, headers: member });
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.json<GiftGoalOverlayLink>().token === link).toBe(true);
    expect(await issueLink(app) === link).toBe(true);
    const read = (token: string) => app.inject({ url: giftGoalOverlayDataPath, headers: { [GIFT_GOAL_OVERLAY_TOKEN_HEADER]: token } });

    const revoked = await app.inject({ method: 'PUT', url: primary, headers: member, payload: disable });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ token: null });
    expect((await read(link)).statusCode).toBe(401);
    const newLink = await issueLink(app);
    expect(newLink === link).toBe(false);
    expect((await read(link)).statusCode).toBe(401);
    expect((await read(newLink)).statusCode).toBe(200);
  });

  it('scopes links and revocation to one overlay kind and strips private fields from each new view', async () => {
    const { app, otherSnapshots } = setup();
    const managementUrl = (kind: StreamOverlayKind) => '/api/workspaces/primary/' + kind + '-overlay';
    const links = {
      'gift-goal': await issueLink(app),
      'last-gift': await issueLink(app, managementUrl('last-gift')),
      'like-goal': await issueLink(app, managementUrl('like-goal')),
      'live-poll': await issueLink(app, managementUrl('live-poll')),
    };
    const read = (kind: StreamOverlayKind, token: string) => app.inject({
      url: '/api/overlays/' + kind, headers: { [GIFT_GOAL_OVERLAY_TOKEN_HEADER]: token },
    });
    const expectedViews = [
      ['last-gift', { giftName: 'Роза', quantity: 2, remainingMs: 3_000 }],
      ['like-goal', { progress: 4, targetCount: 9 }],
      ['live-poll', { question: 'Что показать?', status: 'open', options: [{ label: 'Розы', votes: 3 }, { label: 'Кофе', votes: 1 }] }],
    ] as const;

    for (const [kind, expected] of expectedViews) {
      const link = links[kind];
      for (const otherKind of STREAM_OVERLAY_KINDS) {
        if (otherKind !== kind) expect((await read(kind, links[otherKind])).statusCode).toBe(401);
      }
      expect((await read('gift-goal', link)).statusCode).toBe(401);

      const view = await read(kind, link);
      expect(view.statusCode).toBe(200);
      expect(view.headers['cache-control']).toBe('no-store');
      expect(view.json()).toEqual(expected);

      delete otherSnapshots[kind];
      const empty = await read(kind, link);
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toBeNull();
    }

    const revoked = await app.inject({ method: 'PUT', url: managementUrl('last-gift'), headers: member, payload: disable });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ token: null });
    expect((await read('last-gift', links['last-gift'])).statusCode).toBe(401);
    for (const kind of ['gift-goal', 'like-goal', 'live-poll'] as const) {
      expect((await read(kind, links[kind])).statusCode).toBe(200);
    }
  });
});
