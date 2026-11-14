/**
 * Local browser harness. It is intentionally outside src/, absent from the
 * production build, and has no environment flag or HTTP endpoint that can
 * enable it in the deployed application.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AutomationConfiguration, GiftEvent, GiftGoalConfiguration, LikeGoalConfiguration } from '@tiktok-helper/contracts';
import { buildApp } from '../src/app.js';
import type { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import type { GiftGoalRepository } from '../src/gift-goals/repository.js';
import { GiftGoalRuntime } from '../src/gift-goals/runtime.js';
import type { LikeGoalRepository } from '../src/like-goals/repository.js';
import { attachRealtimeServer, type RealtimeServer } from '../src/realtime/server.js';
import { TikTokSessionManager } from '../src/tiktok/session-manager.js';
import type { ConnectorStep } from './helpers/scripted-connector.js';
import { ScriptedConnector } from './helpers/scripted-connector.js';

const workspaceId = 'browser-test';
const port = Number(process.env.BROWSER_HARNESS_PORT ?? 4177);
const host = '127.0.0.1';
const sourceRevision = 'browser-harness';
const soundId = '17efb17e-6289-4a33-9c7f-b88eb770d36b';
const levelId = '2d616882-aa64-48c3-988f-c67d0730df48';
const now = '2026-09-17T12:00:00.000Z';
const giftRuleScenario = process.env.BROWSER_HARNESS_GIFT_RULES === '1';
const giftGoalScenario = process.env.BROWSER_HARNESS_GIFT_GOAL === '1';
const activityScenario = process.env.BROWSER_HARNESS_LIVE_ACTIVITY === '1';
let connectorNumber = 0;
const connectors: ScriptedConnector[] = [];
let accessExpired = false;
const fixturePrincipal = {
  userId: '123e4567-e89b-42d3-a456-426614174000', displayName: 'Тестовый пользователь', isAdmin: giftRuleScenario || giftGoalScenario || activityScenario,
  workspaces: [{ id: workspaceId, displayName: 'Тестовый эфир' }],
};
const fixtureAccess = async () => accessExpired
  ? { allowed: false as const, reason: 'subscription_expired' as const, validUntil: null }
  : { allowed: true as const, reason: 'active_subscription' as const, validUntil: 1_800_000_000_000 };
const fixtureAuth = giftGoalScenario || activityScenario ? Object.assign(new AuthService({} as AuthRepository, {
  exchange: async () => { throw new Error('No identity exchange in the browser fixture'); },
}, {
  bridgeAuthorizeUrl: 'https://cabinet.example.test/', clientId: 'fixture', redirectUri: `http://${host}:${port}/auth/callback`,
}), {
  resolveCookie: async () => ({ principal: fixturePrincipal, sessionId: 'fixture', identitySubject: 'fixture' }),
  checkEntitlement: fixtureAccess,
}) : undefined;

function rawChat(id: string, text: string, options: { moderator?: boolean; giftGiver?: boolean; emote?: boolean } = {}) {
  return {
    common: { msgId: id },
    user: { id: id.replace(/\D/g, '') || '42', secUid: `fixture-${id}`, displayId: `${id}_viewer`, nickname: `Зритель ${id}` },
    userIdentity: { isModeratorOfAnchor: options.moderator ?? false, isGiftGiverOfAnchor: options.giftGiver ?? false },
    content: text, contentLanguage: 'ru',
    ...(options.emote ? { emotes: [{ index: 0, emote: { emoteId: 'thanks', image: { urlList: [`http://${host}:${port}/fixture-emote.svg`] } } }] } : {}),
  };
}

function rawGift(id: string, repeatCount: number, repeatEnd: boolean, groupId = '7484000000000000011') {
  return {
    common: { msgId: id }, user: { secUid: 'fixture-donor', displayId: 'fixture_donor', nickname: 'Даритель' },
    giftId: '5655', repeatCount, repeatEnd, groupId,
    giftDetails: { giftType: 1 }, gift: { name: 'Rose', diamondCount: 100, image: { urlList: [`http://${host}:${port}/fixture-gift.svg`] } },
  };
}

function connectorSteps(index: number): ConnectorStep[] {
  if (activityScenario) {
    const follow = { common: { msgId: '7484000000000000023' }, user: { nickname: 'Тестовый подписчик' } };
    const share = { common: { msgId: '7484000000000000024' }, user: { nickname: 'Тестовый зритель' } };
    if (index === 1) return [
      { afterMs: 10, eventName: 'like', historical: true, payload: { total: '40' } },
      { afterMs: 20, eventName: 'roomUser', payload: { total: '81', totalUser: '1012' } },
      { afterMs: 30, eventName: 'like', payload: { total: '120', count: 15 } },
      { afterMs: 50, eventName: 'follow', payload: follow },
      { afterMs: 60, eventName: 'share', payload: share },
      { afterMs: 70, eventName: 'share', payload: share },
      { afterMs: 90, eventName: 'chat', payload: rawChat('activity-chat', 'Реплика в тестовом эфире') },
      { afterMs: 750, eventName: 'like', payload: { total: '157', count: 2 } },
      { afterMs: 770, eventName: 'like', payload: { total: '149', count: 12 } },
      { afterMs: 780, eventName: 'like', payload: { total: '157', count: 12 } },
      { afterMs: 1600, eventName: 'disconnected', payload: { code: 1006 } },
    ];
    if (index === 2) return [
      { afterMs: 10, eventName: 'follow', historical: true, payload: follow },
      { afterMs: 20, eventName: 'like', historical: true, payload: { total: '166' } },
      { afterMs: 40, eventName: 'roomUser', payload: { total: '73' } },
      { afterMs: 50, eventName: 'like', payload: { total: '176', count: 1 } },
      { afterMs: 60, eventName: 'chat', payload: rawChat('activities-reconnect', 'Эфир восстановлен') },
    ];
    return [
      { afterMs: 40, eventName: 'roomUser', payload: { total: '7' } },
      { afterMs: 60, eventName: 'like', payload: { total: '50' } },
      { afterMs: 80, eventName: 'chat', payload: rawChat('activities-new-room', 'Это другой эфир') },
    ];
  }
  if (process.env.BROWSER_HARNESS_GIFT_REPLAY === '1') {
    if (index === 1) return [
      { afterMs: 10, eventName: 'gift', historical: true, payload: rawGift('historical-gift', 3, false) },
      { afterMs: 20, eventName: 'chat', historical: true, payload: rawChat('historical-mod-1', 'Историческая реплика', { moderator: true }) },
      { afterMs: 60, eventName: 'gift', payload: rawGift('series-a', 4, false) },
      { afterMs: 80, eventName: 'gift', payload: rawGift('series-b', 1, false, '7484000000000000012') },
      { afterMs: 120, eventName: 'gift', payload: rawGift('series-a-late', 2, false) },
      { afterMs: 170, eventName: 'gift', payload: rawGift('series-a', 5, true) },
      { afterMs: 200, eventName: 'gift', payload: rawGift('series-a-repeated', 5, true) },
      { afterMs: 250, eventName: 'disconnected', payload: { code: 1006, reason: 'scripted reconnect' } },
    ];
    return [
      { afterMs: 15, eventName: 'gift', historical: true, payload: rawGift('history-a-reconnect', 5, true) },
      { afterMs: 35, eventName: 'chat', historical: true, payload: rawChat('historical-mod-2', 'История после переподключения', { moderator: true }) },
      { afterMs: 90, eventName: 'gift', payload: rawGift('series-b', 2, true, '7484000000000000012') },
      { afterMs: 1800, eventName: 'gift', payload: rawGift('series-c', 1, true, '7484000000000000013') },
      { afterMs: 1850, eventName: 'chat', payload: rawChat('fresh-mod', 'Новая реплика модератора', { moderator: true }) },
    ];
  }
  if (index === 1) return [
    { afterMs: 40, eventName: 'chat', payload: rawChat('chat-1', '[thanks] Привет из тестового эфира', { moderator: true, emote: true }) },
    { afterMs: 80, eventName: 'gift', payload: rawGift('gift-1', 1, false) },
    { afterMs: 120, eventName: 'gift', payload: rawGift('gift-2', 3, false) },
    { afterMs: 160, eventName: 'gift', payload: rawGift('gift-3', 3, true) },
    { afterMs: 180, eventName: 'gift', payload: rawGift('gift-3', 3, true) },
    { afterMs: 220, eventName: 'chat', payload: rawChat('chat-2', 'Сообщение активного дарителя', { giftGiver: true }) },
    { afterMs: 300, eventName: 'disconnected', payload: { code: 1006, reason: 'scripted reconnect' } },
  ];
  return [
    { afterMs: 40, eventName: 'chat', payload: rawChat('chat-after-reconnect', 'Связь восстановлена') },
  ];
}

const realtimeRef: { current?: RealtimeServer } = {};
const goalConfigurations = new Map<string, GiftGoalConfiguration>();
const goalRepository: GiftGoalRepository = {
  async get(id) { return goalConfigurations.get(id) ?? null; },
  async save(id, input) {
    const saved = { ...input, revision: (goalConfigurations.get(id)?.revision ?? 0) + 1 };
    goalConfigurations.set(id, saved);
    return saved;
  },
};
const giftGoals = new GiftGoalRuntime(goalRepository, (id) => manager.status(id), (update) => realtimeRef.current?.publishGiftGoal(update));
const likeConfigurations = new Map<string, LikeGoalConfiguration>();
const likeGoalRepository: LikeGoalRepository = {
  async get(id) { return likeConfigurations.get(id) ?? { targetCount: null, revision: 0 }; },
  async save(id, { targetCount }) {
    const previous = await likeGoalRepository.get(id);
    if (previous.targetCount === targetCount) return previous;
    const configuration = { targetCount, revision: previous.revision + 1 };
    likeConfigurations.set(id, configuration);
    return configuration;
  },
};
const manager: TikTokSessionManager = new TikTokSessionManager(
  () => {
    const index = ++connectorNumber;
    const connector = new ScriptedConnector(connectorSteps(index), activityScenario && index >= 3
      ? '7484000000000000002' : '7484000000000000001');
    connectors.push(connector);
    return connector;
  },
  (currentWorkspaceId, event) => {
    realtimeRef.current?.publish(currentWorkspaceId, event);
    if (event.type === 'connection.state') giftGoals.trackConnection(currentWorkspaceId, event);
  },
  undefined,
  () => undefined,
  () => undefined,
  (_currentWorkspaceId, _streamId, gift: GiftEvent) => {
    realtimeRef.current?.publishSupportLevelGranted(workspaceId, {
      eventId: `${gift.eventId}:level`, workspaceId,
      senderDisplayName: gift.senderDisplayName, senderUsername: gift.senderUsername,
      levelId, levelName: 'Голос эфира', thresholdPoints: 100,
      pointsAdded: (gift.diamondCount ?? 0) * gift.repeatCount,
      streamTotal: 300, lifetimeTotal: 10_300, expiresAt: null,
    });
  },
  async () => undefined,
  (_currentWorkspaceId, _identityKey, roles) => ({
    ...roles,
    speechLevels: roles.isGiftGiver ? [{ levelId, levelName: 'Голос эфира', cooldownSeconds: 5, expiresAt: null }] : [],
  }),
  undefined,
  (event) => realtimeRef.current?.publishGiftCompleted(event),
  (id, connectionId, gift, identityKey) => giftGoals.observe(id, connectionId, gift, identityKey),
  (id) => realtimeRef.current?.scheduleLiveActivity(id),
);

const app = buildApp({
  logger: false,
  tiktokManager: manager,
  authService: fixtureAuth,
  ...(giftGoalScenario ? {
    giftGoalRepository: goalRepository,
    onGiftGoalChanged: (id, configuration) => giftGoals.configure(id, configuration),
  } : {}),
  ...(activityScenario ? {
    likeGoalRepository,
    onLikeGoalChanged: (id, configuration) => manager.setLikeGoal(id, configuration),
  } : {}),
  staticRoot: resolve(import.meta.dirname, '../../web/dist'),
});

const automation: AutomationConfiguration = {
  policy: {
    workspaceId, moderatorSpeechEnabled: true, moderatorCooldownSeconds: 5,
    defaultSpeechCooldownSeconds: 5, maxMessageCharacters: 200, maxQueueSize: 4,
    readUserName: true, fallbackLanguage: 'ru', revision: 1,
  },
  supportLevels: [{
    id: levelId, workspaceId, name: 'Голос эфира', thresholdPoints: 100,
    pointsScope: 'lifetime', privilegeDuration: 'permanent', privilegeDurationDays: null,
    grantsChatSpeech: true, chatSpeechCooldownSeconds: 5,
    announcementTemplate: '{user}, теперь ваши сообщения читаются вслух', soundAssetId: null,
    isEnabled: true, position: 0,
  }],
  eventReactions: [{
    id: randomUUID(), workspaceId, name: 'Модератор появился', eventType: 'moderator_seen',
    supportLevelId: null, speechTemplate: 'Модератор {user} подключился', soundAssetId: null,
    cooldownSeconds: 5, isEnabled: true, position: 0,
  }, ...(giftRuleScenario ? [{
    id: 'dd849089-4eaa-44d9-92f4-2802eebf3181', workspaceId, name: 'Спасибо за розы', eventType: 'gift_completed' as const,
    giftId: '5655', minimumGiftPoints: 300, supportLevelId: null, speechTemplate: '{user}, спасибо за {gift} ×{count}!',
    soundAssetId: null, cooldownSeconds: 10, isEnabled: true, position: 1,
  }] : [])],
};

const settings = {
  workspaceId, tiktokUsername: 'fixture_streamer', playbackMode: 'controlled_overlap' as const,
  overlapPercent: 25, maxConcurrentSounds: 4, volumePercent: 80, revision: 1,
};

if (!fixtureAuth) {
  app.get('/api/auth/session', async () => ({ authenticated: true, mode: 'vline', user: fixturePrincipal }));
  app.get('/api/auth/access', fixtureAccess);
}
app.post('/fixture/expire-access', async () => { accessExpired = true; return { status: 'expired' }; });

app.get('/api/workspaces/:workspaceId/settings', async () => settings);
app.put('/api/workspaces/:workspaceId/settings', async (request) => ({ ...settings, ...(request.body as object), revision: 2 }));
app.get('/api/workspaces/:workspaceId/sounds', async () => [{
  id: soundId, displayName: 'Тестовый сигнал', url: '/fixture.wav', contentSha256: '08662970568d4e2cf49988067bee006f7e8ded8c4cd93f4aa6ef4211b891d8af',
  byteSize: 52, mimeType: 'audio/wav', status: 'active', createdByUserId: null,
  isOwnedByCurrentUser: false, usageCount: 1, quarantineReason: null, canQuarantine: false, canDelete: false,
}]);
app.get('/api/workspaces/:workspaceId/gift-mappings', async () => [{
  giftId: '5655', soundAssetId: soundId, soundDisplayName: 'Тестовый сигнал', soundUrl: '/fixture.wav', isEnabled: true,
}]);
app.get('/api/workspaces/:workspaceId/gifts', async () => [{
  giftId: '5655', giftName: 'Rose', imageUrl: `http://${host}:${port}/fixture-gift.svg`, diamondCount: 100,
  firstSeenAt: now, lastSeenAt: now,
}]);
app.get('/api/workspaces/:workspaceId/recent-channels', async () => [{ tiktokUsername: 'fixture_streamer', connectionCount: 1, lastConnectedAt: now }]);
app.get('/api/workspaces/:workspaceId/automation', async () => automation);
app.get('/fixture-emote.svg', async (_request, reply) => reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#ff2d68"/></svg>'));
app.get('/fixture-gift.svg', async (_request, reply) => reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path d="M32 56S6 42 6 22C6 8 24 4 32 17 40 4 58 8 58 22c0 20-26 34-26 34" fill="#ff2d68"/></svg>'));
app.get('/fixture.wav', async (_request, reply) => reply.type('audio/wav').send(Buffer.from('524946462c00000057415645666d74201000000001000100401f0000401f00000100080064617461080000008080808080808080', 'hex')));

realtimeRef.current = attachRealtimeServer(app, manager, {
  ...(fixturePrincipal.isAdmin ? { authenticate: () => fixturePrincipal } : {}),
  ...(giftGoalScenario ? { giftGoals: {
    prepare: (id) => giftGoals.prepare(id, true),
    snapshot: (id) => giftGoals.snapshot(id),
  } } : {}),
  authorizeWorkspace: (requestedWorkspaceId) => requestedWorkspaceId === workspaceId,
  authorizeLiveConnect: async () => accessExpired
    ? { ok: false, error: { code: 'ACCESS_DENIED', message: 'subscription_expired' } }
    : { ok: true },
});
app.addHook('preClose', async () => realtimeRef.current?.close());
app.addHook('onClose', async () => giftGoals.close());

await app.listen({ host, port });
process.stdout.write(`BROWSER_HARNESS_READY http://${host}:${port} revision=${sourceRevision}\n`);

async function shutdown() {
  await app.close();
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
