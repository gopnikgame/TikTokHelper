import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSession, AppUser, AuthRepository, WorkspaceMembership } from '../src/auth/repository.js';
import { AuthService, type IdentityBridge } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';
import type { SoundRepository } from '../src/sounds/repository.js';

const workspaceId = 'primary';
const soundId = '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3';
const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

function memoryAuth(globalRole: 'user' | 'admin') {
  const user: AppUser = {
    id: randomUUID(), identityProvider: 'vline', identitySubject: `test-${globalRole}`,
    displayName: globalRole, status: 'active', globalRole,
    createdAt: new Date(), updatedAt: new Date(), lastLoginAt: new Date(),
  };
  const sessions = new Map<string, AppSession>();
  const repository: AuthRepository = {
    async upsertIdentity() { return user; },
    async createWorkspaceForUser(): Promise<WorkspaceMembership> { return { workspaceId, userId: user.id, role: 'owner', createdAt: new Date() }; },
    async assignMembership(_userId, id, role) { return { workspaceId: id, userId: user.id, role, createdAt: new Date() }; },
    async hasWorkspaceAccess() { return true; },
    async listWorkspaces() { return [{ id: workspaceId, displayName: 'Основной эфир' }]; },
    async issueSession(input) { const session = { id: randomUUID(), ...input, createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null }; sessions.set(input.tokenHash, session); return session; },
    async findActiveSession(tokenHash) { const session = sessions.get(tokenHash); return session ? { session, user } : null; },
    async touchSession() {}, async revokeSession() { return true; }, async deleteExpiredSessions() { return 0; },
  };
  const bridge: IdentityBridge = { async exchange() { return { subject: user.identitySubject, displayName: user.displayName, authenticatedAt: new Date().toISOString() }; } };
  return { user, service: new AuthService(repository, bridge, { bridgeAuthorizeUrl: 'https://vline.online/authorize', clientId: 'test', redirectUri: 'https://tiktok.vpnline.online/auth/callback' }) };
}

async function login(app: ReturnType<typeof buildApp>): Promise<string> {
  const loginResponse = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const authorizationUrl = new URL(loginResponse.json<{ authorizationUrl: string }>().authorizationUrl);
  const state = authorizationUrl.searchParams.get('state')!;
  expect(authorizationUrl.searchParams.get('code_challenge')).toHaveLength(43);
  const callback = await app.inject({ method: 'GET', url: `/auth/callback?code=${'c'.repeat(43)}&state=${state}` });
  const setCookie = callback.headers['set-cookie']!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!;
}

function sounds(overrides: Partial<SoundRepository> = {}): SoundRepository {
  return {
    async seed() {}, async listSounds() { return []; }, async listMappings() { return []; },
    async saveMapping() { return null; }, async createSound() { throw new Error('not used'); },
    async quarantineSound() { return null; }, async deleteSound() { return { ok: false, reason: 'not_found' }; },
    ...overrides,
  };
}

describe('sound ownership and moderation authorization', () => {
  it('allows an owner to delete their unused upload and removes its stored file', async () => {
    const { service } = memoryAuth('user'); let removed = ''; let actorId = '';
    const app = buildApp({ logger: false, authService: service, soundRepository: sounds({
      async deleteSound(_id, actor) { actorId = actor.userId; return { ok: true, storageKey: 'uploaded/test.wav', removedMappings: 0 }; },
    }), soundUploadStore: { async save() { throw new Error('not used'); }, async remove(key) { removed = key; } } }); apps.add(app);
    const cookie = await login(app);
    const response = await app.inject({ method: 'DELETE', url: `/api/workspaces/${workspaceId}/sounds/${soundId}`, headers: { cookie } });
    expect(response.statusCode).toBe(204); expect(actorId).not.toBe(''); expect(removed).toBe('uploaded/test.wav');
  });

  it('blocks deletion while another workspace uses the upload', async () => {
    const { service } = memoryAuth('user');
    const app = buildApp({ logger: false, authService: service, soundRepository: sounds({
      async deleteSound() { return { ok: false, reason: 'in_use', usageCount: 2 }; },
    }) }); apps.add(app);
    const response = await app.inject({ method: 'DELETE', url: `/api/workspaces/${workspaceId}/sounds/${soundId}`, headers: { cookie: await login(app) } });
    expect(response.statusCode).toBe(409); expect(response.json()).toMatchObject({ error: { code: 'IN_USE' } });
  });

  it('requires an administrator for quarantine and preserves the supplied reason', async () => {
    const regular = memoryAuth('user');
    const denied = buildApp({ logger: false, authService: regular.service, soundRepository: sounds() }); apps.add(denied);
    expect((await denied.inject({ method: 'PATCH', url: `/api/workspaces/${workspaceId}/sounds/${soundId}/quarantine`, headers: { cookie: await login(denied) }, payload: { reason: 'Нарушение авторских прав' } })).statusCode).toBe(403);

    const admin = memoryAuth('admin'); let reason = '';
    const allowed = buildApp({ logger: false, authService: admin.service, soundRepository: sounds({
      async quarantineSound(_id, actor, suppliedReason) { reason = suppliedReason; return { id: soundId, displayName: 'Test', url: '/sounds/test.wav', contentSha256: '0'.repeat(64), byteSize: 12, mimeType: 'audio/wav', status: 'quarantined', createdByUserId: null, isOwnedByCurrentUser: false, usageCount: 2, quarantineReason: suppliedReason, canQuarantine: false, canDelete: actor.isAdmin }; },
    }) }); apps.add(allowed);
    const response = await allowed.inject({ method: 'PATCH', url: `/api/workspaces/${workspaceId}/sounds/${soundId}/quarantine`, headers: { cookie: await login(allowed) }, payload: { reason: 'Нарушение авторских прав' } });
    expect(response.statusCode).toBe(200); expect(reason).toBe('Нарушение авторских прав'); expect(response.json()).toMatchObject({ status: 'quarantined', canDelete: true });
  });

  it('requires quarantine before final administrator deletion', async () => {
    const { service } = memoryAuth('admin');
    const app = buildApp({ logger: false, authService: service, soundRepository: sounds({
      async deleteSound() { return { ok: false, reason: 'not_quarantined' }; },
    }) }); apps.add(app);
    const response = await app.inject({ method: 'DELETE', url: `/api/workspaces/${workspaceId}/sounds/${soundId}`, headers: { cookie: await login(app) } });
    expect(response.statusCode).toBe(409); expect(response.json()).toMatchObject({ error: { code: 'NOT_QUARANTINED' } });
  });
});
