import { describe, expect, it } from 'vitest';
import type { AutomationConfiguration, ChatEvent } from '@tiktok-helper/contracts';
import { renderTemplate, SpeechPolicyEngine } from './policy.js';

const levelId = '123e4567-e89b-42d3-a456-426614174000';
const configuration = (): AutomationConfiguration => ({
  policy: {
    workspaceId: 'primary', moderatorSpeechEnabled: false, moderatorCooldownSeconds: 10,
    defaultSpeechCooldownSeconds: 30, maxMessageCharacters: 5, maxQueueSize: 2,
    readUserName: false, fallbackLanguage: 'ru-RU', revision: 1,
  },
  supportLevels: [{
    id: levelId, workspaceId: 'primary', name: 'Голос', thresholdPoints: 100,
    pointsScope: 'lifetime', privilegeDuration: 'permanent', privilegeDurationDays: null,
    grantsChatSpeech: true, chatSpeechCooldownSeconds: 30,
    announcementTemplate: '{user}, открыт уровень {level}', soundAssetId: null,
    isEnabled: true, position: 0,
  }],
  eventReactions: [],
});
const chat = (overrides: Partial<ChatEvent> = {}): ChatEvent => ({
  type: 'chat.message', generation: 1, sequence: 1, eventId: 'chat-1',
  senderDisplayName: 'Viewer', senderUsername: 'viewer', text: '123456789', language: 'uk',
  speakerContext: { isModerator: false, isGiftGiver: true, speechLevels: [{
    levelId, levelName: 'Голос', cooldownSeconds: 30, expiresAt: null,
  }] },
  ...overrides,
});

describe('speech policy engine', () => {
  it('is silent without a configured moderator rule or active configured level', () => {
    const engine = new SpeechPolicyEngine(); const config = configuration();
    config.supportLevels[0]!.isEnabled = false;
    expect(engine.evaluateChat(chat(), config)).toBeNull();
  });

  it('truncates text, uses the message language, enforces cooldown, and suppresses duplicates', () => {
    let now = 1_000; const engine = new SpeechPolicyEngine(() => now); const config = configuration();
    expect(engine.evaluateChat(chat(), config)).toMatchObject({ text: '12345', language: 'uk', priority: 'normal' });
    expect(engine.evaluateChat(chat(), config)).toBeNull();
    now += 10_000;
    expect(engine.evaluateChat(chat({ eventId: 'chat-2' }), config)).toBeNull();
    now += 20_000;
    expect(engine.evaluateChat(chat({ eventId: 'chat-3' }), config)).not.toBeNull();
  });

  it('allows configured moderators with priority and optional spoken name', () => {
    const engine = new SpeechPolicyEngine(); const config = configuration();
    config.policy.moderatorSpeechEnabled = true; config.policy.readUserName = true;
    expect(engine.evaluateChat(chat({
      speakerContext: { isModerator: true, isGiftGiver: false, speechLevels: [] },
    }), config)).toMatchObject({ text: 'Viewer: 12345', priority: 'moderator' });
  });

  it('renders only known placeholders as plain text and builds a grant reaction', () => {
    expect(renderTemplate('{user}: {total} {unknown}', { user: '<b>Viewer</b>', total: 100 }))
      .toBe('<b>Viewer</b>: 100 {unknown}');
    const engine = new SpeechPolicyEngine();
    expect(engine.evaluateGrant({
      eventId: 'grant-1', workspaceId: 'primary', senderDisplayName: 'Viewer', senderUsername: 'viewer',
      levelId, levelName: 'Голос', thresholdPoints: 100, pointsAdded: 10,
      streamTotal: 100, lifetimeTotal: 100, expiresAt: null,
    }, configuration())).toMatchObject({ speech: { text: 'Viewer, открыт уровень Голос' }, soundAssetIds: [] });
  });

  it('runs first-seen reactions once per participant and resets them for a new stream', () => {
    const engine = new SpeechPolicyEngine(); const config = configuration();
    config.eventReactions = [{
      id: 'reaction-1', workspaceId: 'primary', name: 'Модератор появился', eventType: 'moderator_seen',
      supportLevelId: null, speechTemplate: 'Привет, {user}', soundAssetId: 'sound-1',
      cooldownSeconds: 10, isEnabled: true, position: 0,
    }];
    expect(engine.evaluateParticipantSeen('moderator_seen', chat(), config))
      .toMatchObject({ speech: { text: 'Привет, Viewer', priority: 'moderator' }, soundAssetIds: ['sound-1'] });
    expect(engine.evaluateParticipantSeen('moderator_seen', chat({ eventId: 'chat-2' }), config))
      .toEqual({ speech: null, soundAssetIds: [] });
    engine.reset();
    expect(engine.evaluateParticipantSeen('moderator_seen', chat({ eventId: 'chat-3' }), config).speech).not.toBeNull();
  });
});
