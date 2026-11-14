import { describe, expect, it } from 'vitest';
import type { AutomationConfiguration, ChatEvent, EventReaction, GiftCompletedEvent } from '@tiktok-helper/contracts';
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
const rose = (overrides: Partial<GiftCompletedEvent> = {}): GiftCompletedEvent => ({
  eventId: 'gift-complete:a', workspaceId: 'primary', generation: 1,
  connectionId: '123e4567-e89b-42d3-a456-426614174000',
  giftId: '5655', giftName: 'Rose', senderDisplayName: 'Viewer', senderUsername: 'viewer', repeatCount: 3, diamondCount: 100,
  ...overrides,
});
const giftRule = (overrides: Partial<EventReaction> = {}): EventReaction => ({
  id: 'rule-1', workspaceId: 'primary', eventType: 'gift_completed', name: 'Розы', giftId: '5655', minimumGiftPoints: 300,
  supportLevelId: null, speechTemplate: '{user}, {gift} ×{count} на {points}', soundAssetId: 'bell', cooldownSeconds: 10,
  isEnabled: true, position: 0, ...overrides,
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

  it('evaluates total value and selected gift with one thank-you and one optional sound', () => {
    const config = configuration();
    config.eventReactions = [giftRule()];
    const engine = new SpeechPolicyEngine();
    const available = () => true;
    expect(engine.evaluateGiftCompletion(rose({ eventId: 'below', repeatCount: 2 }), config, available)).toBeNull();
    expect(engine.evaluateGiftCompletion(rose({ eventId: 'other', giftId: '999' }), config, available)).toBeNull();
    expect(engine.evaluateGiftCompletion(rose({ eventId: 'unknown', diamondCount: undefined }), config, available)).toBeNull();
    expect(engine.evaluateGiftCompletion(rose({ workspaceId: 'another' }), config, available)).toBeNull();
    expect(engine.evaluateGiftCompletion(rose(), config, available)).toMatchObject({
      speech: { text: 'Viewer, Rose ×3 на 300', language: 'ru-RU' }, soundAssetIds: ['bell'],
    });
    expect(engine.evaluateGiftCompletion(rose(), config, available)).toBeNull();
  });

  it('uses the first eligible rule and advances its pause only after it wins', () => {
    const config = configuration();
    config.eventReactions = [
      giftRule({ id: 'fallback', giftId: null, minimumGiftPoints: 0, cooldownSeconds: 0, speechTemplate: 'Резерв', position: 3 }),
      giftRule({ id: 'off', speechTemplate: 'Выключено', isEnabled: false }),
      giftRule({ id: 'quarantined', speechTemplate: null, soundAssetId: 'quarantined' }),
      giftRule({ position: 2 }),
    ];
    let now = 0;
    const engine = new SpeechPolicyEngine(() => now);
    const evaluate = (eventId: string, overrides: Partial<GiftCompletedEvent> = {}) =>
      engine.evaluateGiftCompletion(rose({ eventId, ...overrides }), config, (id) => id === 'bell');
    expect(evaluate('a')?.speech?.text).toContain('Rose ×3');
    now = 9_999;
    expect(evaluate('b')?.speech?.text).toBe('Резерв');
    now = 10_000;
    expect(evaluate('c')?.speech?.text).toContain('Rose ×3');
    expect(evaluate('d', { diamondCount: undefined })?.speech?.text).toBe('Резерв');
  });
});
