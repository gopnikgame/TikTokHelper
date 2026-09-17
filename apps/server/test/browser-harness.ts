/**
 * Local browser harness. It is intentionally outside src/, absent from the
 * production build, and has no environment flag or HTTP endpoint that can
 * enable it in the deployed application.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AutomationConfiguration, GiftEvent } from '@tiktok-helper/contracts';
import { buildApp } from '../src/app.js';
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
let connectorNumber = 0;
const connectors: ScriptedConnector[] = [];

function rawChat(id: string, text: string, options: { moderator?: boolean; giftGiver?: boolean; emote?: boolean } = {}) {
  return {
    common: { msgId: id },
    user: { id: id.replace(/\D/g, '') || '42', secUid: `fixture-${id}`, displayId: `${id}_viewer`, nickname: `Зритель ${id}` },
    userIdentity: { isModeratorOfAnchor: options.moderator ?? false, isGiftGiverOfAnchor: options.giftGiver ?? false },
    content: text, contentLanguage: 'ru',
    ...(options.emote ? { emotes: [{ index: 0, emote: { emoteId: 'thanks', image: { urlList: [`http://${host}:${port}/fixture-emote.svg`] } } }] } : {}),
  };
}

function rawGift(id: string, repeatCount: number, repeatEnd: boolean) {
  return {
    common: { msgId: id }, user: { secUid: 'fixture-donor', displayId: 'fixture_donor', nickname: 'Даритель' },
    giftId: '5655', repeatCount, repeatEnd,
    giftDetails: { giftType: 1 }, gift: { name: 'Rose', diamondCount: 100, image: { urlList: [`http://${host}:${port}/fixture-gift.svg`] } },
  };
}

function connectorSteps(index: number): ConnectorStep[] {
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
const manager = new TikTokSessionManager(
  () => {
    const connector = new ScriptedConnector(connectorSteps(++connectorNumber));
    connectors.push(connector);
    return connector;
  },
  (currentWorkspaceId, event) => realtimeRef.current?.publish(currentWorkspaceId, event),
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
);

const app = buildApp({
  logger: false,
  tiktokManager: manager,
  localWorkspaceId: workspaceId,
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
  }],
};

const settings = {
  workspaceId, tiktokUsername: 'fixture_streamer', playbackMode: 'controlled_overlap' as const,
  overlapPercent: 25, maxConcurrentSounds: 4, volumePercent: 80, revision: 1,
};

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
  authorizeWorkspace: (requestedWorkspaceId) => requestedWorkspaceId === workspaceId,
});
app.addHook('preClose', async () => realtimeRef.current?.close());

await app.listen({ host, port });
process.stdout.write(`BROWSER_HARNESS_READY http://${host}:${port} revision=${sourceRevision}\n`);

async function shutdown() {
  await app.close();
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
