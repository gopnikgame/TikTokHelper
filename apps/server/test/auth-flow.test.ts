import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthRepository, AppSession, AppUser, WorkspaceMembership } from '../src/auth/repository.js';
import { AuthService, type IdentityBridge } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';
import type { SettingsRepository } from '../src/settings/repository.js';

const userId = '123e4567-e89b-42d3-a456-426614174000';
const user: AppUser = {
  id: userId, identityProvider: 'vline', identitySubject: 'solo-user-1', displayName: 'Иван',
  status: 'active', globalRole: 'admin', createdAt: new Date(), updatedAt: new Date(), lastLoginAt: new Date(),
};

function memoryRepository(globalRole: AppUser['globalRole'] = 'admin') {
  const sessions = new Map<string, AppSession>();
  let revoked = false;
  const repository: AuthRepository = {
    async upsertIdentity() { return user; },
    async createWorkspaceForUser(): Promise<WorkspaceMembership> {
      return { workspaceId: 'primary', userId, role: 'owner', createdAt: new Date() };
    },
    async assignMembership(_userId, workspaceId, role) {
      return { workspaceId, userId, role, createdAt: new Date() };
    },
    async hasWorkspaceAccess(_userId, workspaceId) { return workspaceId === 'primary'; },
    async listWorkspaces() { return [{ id: 'primary', displayName: 'Основной эфир' }]; },
    async issueSession(input) {
      const session: AppSession = {
        id: randomUUID(), ...input, createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null,
      };
      sessions.set(input.tokenHash, session); return session;
    },
    async findActiveSession(tokenHash, now) {
      const session = sessions.get(tokenHash);
      return !session || revoked || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now
        ? null : { session, user: { ...user, globalRole } };
    },
    async touchSession() {},
    async revokeSession() { revoked = true; return true; },
    async deleteExpiredSessions() { return 0; },
  };
  return repository;
}

const settingsRepository: SettingsRepository = {
  async get(workspaceId) {
    return {
      workspaceId, tiktokUsername: '@tester', playbackMode: 'controlled_overlap',
      overlapPercent: 25, maxConcurrentSounds: 4, volumePercent: 80, revision: 1,
    };
  },
  async save(workspaceId, input) { return { workspaceId, ...input, revision: 1 }; },
};

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map((app) => app.close())); apps.clear(); });

describe('VLine-backed application sessions', () => {
  it('serves neural TTS packages only to an authenticated administrator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tiktok-helper-tts-'));
    const voiceId = 'ru-RU-irina-medium-int8';
    const fileName = 'sherpa-onnx-tts.worker.js';
    await mkdir(join(root, voiceId));
    await writeFile(join(root, voiceId, fileName), 'worker-payload');
    const bridge: IdentityBridge = {
      async exchange() { return { subject: 'solo-user-1', displayName: 'Иван', authenticatedAt: new Date().toISOString() }; },
    };
    const makeService = (role: AppUser['globalRole']) => new AuthService(memoryRepository(role), bridge, {
      bridgeAuthorizeUrl: 'https://vline.online/integrations/tiktok-helper/authorize',
      clientId: 'tiktok-helper', redirectUri: 'https://tiktok.vpnline.online/auth/callback',
    });
    const login = async (app: ReturnType<typeof buildApp>): Promise<string> => {
      const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
      const state = new URL(start.json<{ authorizationUrl: string }>().authorizationUrl).searchParams.get('state')!;
      const callback = await app.inject({ method: 'GET', url: `/auth/callback?code=${'c'.repeat(43)}&state=${state}` });
      const setCookie = callback.headers['set-cookie']!;
      return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!;
    };
    try {
      const admin = buildApp({ logger: false, authService: makeService('admin'), ttsAssetRoot: root }); apps.add(admin);
      const member = buildApp({ logger: false, authService: makeService('user'), ttsAssetRoot: root }); apps.add(member);
      const url = `/tts-assets/voices/${voiceId}/${fileName}`;
      expect((await admin.inject({ method: 'GET', url })).statusCode).toBe(401);
      const memberResponse = await member.inject({ method: 'GET', url, headers: { cookie: await login(member) } });
      expect(memberResponse.statusCode).toBe(403);
      const response = await admin.inject({ method: 'GET', url, headers: { cookie: await login(admin) } });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('worker-payload');
      expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect((await admin.inject({
        method: 'GET', url: `/tts-assets/voices/${voiceId}/../secret`, headers: { cookie: await login(admin) },
      })).statusCode).toBe(404);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('uses a valid VLine session before falling back to trusted local access', async () => {
    const bridge: IdentityBridge = {
      async exchange() { return { subject: 'solo-user-1', displayName: null, authenticatedAt: new Date().toISOString() }; },
    };
    const service = new AuthService(memoryRepository(), bridge, {
      bridgeAuthorizeUrl: 'https://vline.online/integrations/tiktok-helper/authorize',
      clientId: 'tiktok-helper', redirectUri: 'https://tiktok.vpnline.online/auth/callback',
    });
    const app = buildApp({
      logger: false, authService: service, localWorkspaceId: 'primary', settingsRepository,
    });
    apps.add(app);

    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'GET', url: '/api/auth/session', headers: { 'x-tiktok-local-access': 'true' },
    })).statusCode).toBe(401);

    const headers = { 'x-tiktok-local-access': '1' };
    const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      mode: 'local', user: { workspaces: [{ id: 'primary', displayName: 'Основной эфир' }] },
    });
    expect((await app.inject({
      method: 'GET', url: '/api/workspaces/primary/settings', headers,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'GET', url: '/api/workspaces/other/settings', headers,
    })).statusCode).toBe(403);

    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = new URL(login.json<{ authorizationUrl: string }>().authorizationUrl).searchParams.get('state')!;
    const callback = await app.inject({ method: 'GET', url: `/auth/callback?code=${'c'.repeat(43)}&state=${state}` });
    const setCookie = callback.headers['set-cookie']!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!;
    const authenticatedHeaders = { ...headers, cookie };
    const authenticatedSession = await app.inject({ method: 'GET', url: '/api/auth/session', headers: authenticatedHeaders });
    expect(authenticatedSession.statusCode).toBe(200);
    expect(authenticatedSession.json()).toMatchObject({
      mode: 'vline', user: { userId, isAdmin: true, workspaces: [{ id: 'primary' }] },
    });
    expect((await app.inject({
      method: 'GET', url: '/api/workspaces/primary/settings', headers: authenticatedHeaders,
    })).statusCode).toBe(200);
  });

  it('completes PKCE login and isolates protected workspaces', async () => {
    let expectedChallenge = '';
    const bridge: IdentityBridge = {
      async exchange(code, verifier) {
        expect(code).toBe('c'.repeat(43));
        expect(createHash('sha256').update(verifier).digest('base64url')).toBe(expectedChallenge);
        return { subject: 'solo-user-1', displayName: 'Иван', authenticatedAt: new Date().toISOString() };
      },
    };
    const service = new AuthService(memoryRepository(), bridge, {
      bridgeAuthorizeUrl: 'https://vline.online/integrations/tiktok-helper/authorize',
      clientId: 'tiktok-helper', redirectUri: 'https://tiktok.vpnline.online/auth/callback',
    });
    const app = buildApp({ logger: false, authService: service, settingsRepository }); apps.add(app);

    expect((await app.inject({ method: 'GET', url: '/api/workspaces/primary/settings' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const authorizationUrl = new URL(login.json<{ authorizationUrl: string }>().authorizationUrl);
    expectedChallenge = authorizationUrl.searchParams.get('code_challenge')!;
    const state = authorizationUrl.searchParams.get('state')!;
    const callback = await app.inject({ method: 'GET', url: `/auth/callback?code=${'c'.repeat(43)}&state=${state}` });
    expect(callback.statusCode).toBe(302);
    const setCookie = callback.headers['set-cookie']!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!;
    expect(cookie).not.toContain('solo-user-1');

    const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ mode: 'vline', user: { userId, workspaces: [{ id: 'primary', displayName: 'Основной эфир' }] } });
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/primary/settings', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/other/settings', headers: { cookie } })).statusCode).toBe(403);

    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(401);
  });

  it('rejects replayed callback state without identity leakage', async () => {
    const bridge: IdentityBridge = { async exchange() { return { subject: 'solo-user-1', displayName: null, authenticatedAt: new Date().toISOString() }; } };
    const service = new AuthService(memoryRepository(), bridge, {
      bridgeAuthorizeUrl: 'https://vline.online/integrations/tiktok-helper/authorize', clientId: 'tiktok-helper',
      redirectUri: 'https://tiktok.vpnline.online/auth/callback',
    });
    const app = buildApp({ logger: false, authService: service }); apps.add(app);
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = new URL(login.json<{ authorizationUrl: string }>().authorizationUrl).searchParams.get('state')!;
    const url = `/auth/callback?code=${'c'.repeat(43)}&state=${state}`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(302);
    const replay = await app.inject({ method: 'GET', url });
    expect(replay.statusCode).toBe(400);
    expect(replay.body).not.toContain('solo-user-1');
  });

  it('consumes a state-bound subscription denial and exposes only a safe reason code', async () => {
    const bridge: IdentityBridge = { async exchange() { throw new Error('must not exchange a denied login'); } };
    const service = new AuthService(memoryRepository(), bridge, {
      bridgeAuthorizeUrl: 'https://vline.online/integrations/tiktok-helper/authorize', clientId: 'tiktok-helper',
      redirectUri: 'https://tiktok.vpnline.online/auth/callback',
    });
    const app = buildApp({ logger: false, authService: service }); apps.add(app);
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = new URL(login.json<{ authorizationUrl: string }>().authorizationUrl).searchParams.get('state')!;
    const url = `/auth/callback?error=access_denied&error_code=subscription_expired&state=${state}`;
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=subscription_expired');
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
  });

  it('rejects an expired application session', async () => {
    let now = Date.now();
    const bridge: IdentityBridge = { async exchange() { return { subject: 'solo-user-1', displayName: null, authenticatedAt: new Date(now).toISOString() }; } };
    const service = new AuthService(memoryRepository(), bridge, {
      bridgeAuthorizeUrl: 'https://vline.online/integrations/tiktok-helper/authorize', clientId: 'tiktok-helper',
      redirectUri: 'https://tiktok.vpnline.online/auth/callback', sessionIdleMs: 1_000, sessionAbsoluteMs: 10_000,
    }, () => now);
    const app = buildApp({ logger: false, authService: service }); apps.add(app);
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = new URL(login.json<{ authorizationUrl: string }>().authorizationUrl).searchParams.get('state')!;
    const callback = await app.inject({ method: 'GET', url: `/auth/callback?code=${'c'.repeat(43)}&state=${state}` });
    const setCookie = callback.headers['set-cookie']!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!;
    now += 1_001;
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(401);
  });
});
