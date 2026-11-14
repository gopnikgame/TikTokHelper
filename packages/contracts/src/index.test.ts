import { describe, expect, it } from 'vitest';

import { Ajv } from 'ajv';
import {
  hasOnlyKnownTemplateVariables, healthResponseSchema, isGiftCompletedEvent, isLiveActivityState, saveEventReactionSchema,
  saveSupportLevelSchema, supportLevelGrantedEventSchema, chatSpeakerContextSchema,
  updateWorkspaceSpeechPolicySchema, validateClientEvent,
} from './index.js';

describe('health response contract', () => {
  it('requires the ok status', () => {
    expect(healthResponseSchema.required).toEqual(['status']);
    expect(healthResponseSchema.properties.status.const).toBe('ok');
  });
});

describe('live activity contract', () => {
  const baseline = {
    workspaceId: 'primary', generation: 1, connectionId: '123e4567-e89b-42d3-a456-426614174000', revision: 2,
    viewers: 0, totalLikes: 120, likeGoal: { targetCount: 15, baselineLikes: 100, revision: 1 },
    recentActions: [{ kind: 'follow', displayName: 'Зритель' }, { kind: 'share', displayName: null }],
  };

  it('distinguishes zero viewers and a known total from invalid or unavailable counters', () => {
    expect(isLiveActivityState(baseline)).toBe(true);
    expect(isLiveActivityState({ ...baseline, viewers: false })).toBe(false);
    expect(isLiveActivityState({ ...baseline, totalLikes: 0 })).toBe(false);
    expect(isLiveActivityState({ ...baseline, totalLikes: null })).toBe(false);
    expect(isLiveActivityState({ ...baseline, likeGoal: { ...baseline.likeGoal, baselineLikes: 121 } })).toBe(false);
    expect(isLiveActivityState({ ...baseline, recentActions: Array(11).fill(baseline.recentActions[0]) })).toBe(false);
    expect(isLiveActivityState({ ...baseline, recentActions: [{ ...baseline.recentActions[0], identityKey: 'fixture-private' }] })).toBe(false);
  });
});

describe('Socket.IO command contracts', () => {
  it('accepts a valid connect command', () => {
    expect(validateClientEvent('live:connect', {
      commandId: '123e4567-e89b-42d3-a456-426614174000',
      workspaceId: 'primary',
      tiktokUsername: '@operator.name',
    }).ok).toBe(true);
  });

  it('rejects malformed and additional fields', () => {
    expect(validateClientEvent('live:connect', {
      commandId: 'not-a-uuid', workspaceId: '../other', tiktokUsername: 'x', room: 'admin',
    }).ok).toBe(false);
  });
});

describe('configurable speech contracts', () => {
  const ajv = new Ajv({ strict: false });

  it('accepts a silent disabled level and a moderator policy that is off by default', () => {
    const validateLevel = ajv.compile(saveSupportLevelSchema);
    expect(validateLevel({
      name: 'Голос эфира', thresholdPoints: 10_000, pointsScope: 'lifetime',
      privilegeDuration: 'permanent', privilegeDurationDays: null, grantsChatSpeech: true,
      chatSpeechCooldownSeconds: 30, announcementTemplate: null, soundAssetId: null,
      isEnabled: false, position: 0,
    })).toBe(true);

    const validatePolicy = ajv.compile(updateWorkspaceSpeechPolicySchema);
    expect(validatePolicy({
      moderatorSpeechEnabled: false, moderatorCooldownSeconds: 30,
      defaultSpeechCooldownSeconds: 30, maxMessageCharacters: 200,
      maxQueueSize: 20, readUserName: false, fallbackLanguage: 'ru-RU',
    })).toBe(true);
  });

  it('accepts documented template variables and rejects unknown or unbalanced variables', () => {
    expect(hasOnlyKnownTemplateVariables('Поздравляем, {user}! Уровень {level}, всего {total}.')).toBe(true);
    expect(hasOnlyKnownTemplateVariables('{user} сказал: {message}')).toBe(true);
    expect(hasOnlyKnownTemplateVariables('Привет, {displayName}!')).toBe(false);
    expect(hasOnlyKnownTemplateVariables('Привет, {user')).toBe(false);

    const validateReaction = ajv.compile(saveEventReactionSchema);
    expect(validateReaction({
      name: 'Модератор появился', eventType: 'moderator_seen', supportLevelId: null,
      speechTemplate: '{user} подключился к эфиру', soundAssetId: null,
      cooldownSeconds: 300, isEnabled: false, position: 0,
    })).toBe(true);
    expect(validateReaction({
      name: 'Плохой шаблон', eventType: 'donor_seen', supportLevelId: null,
      speechTemplate: '{unknown}', soundAssetId: null,
      cooldownSeconds: 0, isEnabled: true, position: 0,
    })).toBe(false);
  });

  it('rejects unsafe thresholds, oversized templates, and extra fields', () => {
    const validateLevel = ajv.compile(saveSupportLevelSchema);
    const base = {
      name: 'Уровень', thresholdPoints: 10_000, pointsScope: 'lifetime',
      privilegeDuration: 'days', privilegeDurationDays: 30, grantsChatSpeech: true,
      chatSpeechCooldownSeconds: 30, announcementTemplate: null, soundAssetId: null,
      isEnabled: true, position: 0,
    };
    expect(validateLevel({ ...base, thresholdPoints: 0 })).toBe(false);
    expect(validateLevel({ ...base, announcementTemplate: 'x'.repeat(501) })).toBe(false);
    expect(validateLevel({ ...base, isAdmin: true })).toBe(false);
    expect(validateLevel({ ...base, privilegeDuration: 'days', privilegeDurationDays: null })).toBe(false);
    expect(validateLevel({ ...base, privilegeDuration: 'permanent', privilegeDurationDays: 30 })).toBe(false);
  });

  it('requires an explicit gift filter and safe minimum for completion reactions', () => {
    const validate = ajv.compile(saveEventReactionSchema);
    const base = {
      name: 'Благодарность', eventType: 'gift_completed', supportLevelId: null, giftId: null, minimumGiftPoints: 0,
      speechTemplate: '{user}: {gift} ×{count}, {points}', soundAssetId: null, cooldownSeconds: 5, isEnabled: false, position: 0,
    };
    expect(validate(base)).toBe(true);
    expect(validate({ ...base, giftId: '5655', minimumGiftPoints: 300 })).toBe(true);
    expect(validate({ ...base, giftId: undefined })).toBe(false);
    expect(validate({ ...base, minimumGiftPoints: undefined })).toBe(false);
    expect(validate({ ...base, minimumGiftPoints: -1 })).toBe(false);
    expect(validate({ ...base, minimumGiftPoints: 2_147_483_648 })).toBe(false);
    expect(validate({ ...base, eventType: 'donor_seen' })).toBe(false);
    expect(validate({ ...base, supportLevelId: '123e4567-e89b-42d3-a456-426614174000' })).toBe(false);
    expect(validate({ ...base, speechTemplate: '{message}' })).toBe(false);
  });
});

describe('browser-owned speech event contracts', () => {
  const ajv = new Ajv({ strict: false, formats: {
    uuid: /^[0-9a-f-]{36}$/i,
    'date-time': true,
  } });

  it('exposes only declarative speaker entitlements', () => {
    const validate = ajv.compile(chatSpeakerContextSchema);
    expect(validate({
      isModerator: true, isGiftGiver: false,
      speechLevels: [{
        levelId: '123e4567-e89b-42d3-a456-426614174000', levelName: 'Голос эфира',
        cooldownSeconds: 30, expiresAt: null,
      }],
    })).toBe(true);
    expect(validate({
      isModerator: false, isGiftGiver: true, speechLevels: [], identityKey: 'must-not-leak',
    })).toBe(false);
  });

  it('bounds finalized gift facts and rejects connector-internal fields', () => {
    const event = {
      eventId: 'gift-complete:one', workspaceId: 'primary', generation: 1,
      connectionId: '123e4567-e89b-42d3-a456-426614174000',
      giftId: '5655', giftName: 'Rose', repeatCount: 3, diamondCount: 100,
      senderDisplayName: 'Зритель', senderUsername: 'viewer',
    };
    expect(isGiftCompletedEvent(event)).toBe(true);
    expect(isGiftCompletedEvent({ ...event, groupId: 'private-series' })).toBe(false);
    expect(isGiftCompletedEvent({ ...event, repeatCount: 0 })).toBe(false);
    expect(isGiftCompletedEvent({ ...event, connectionId: 'other' })).toBe(false);
  });

  it('bounds level-granted facts and rejects executable speech instructions', () => {
    const validate = ajv.compile(supportLevelGrantedEventSchema);
    const event = {
      eventId: 'grant:one', workspaceId: 'primary', senderDisplayName: 'Зритель',
      senderUsername: 'viewer', levelId: '123e4567-e89b-42d3-a456-426614174000',
      levelName: 'Голос эфира', thresholdPoints: 10_000, pointsAdded: 100,
      streamTotal: 2_000, lifetimeTotal: 10_050, expiresAt: null,
    };
    expect(validate(event)).toBe(true);
    expect(validate({ ...event, speakNow: '<script>alert(1)</script>' })).toBe(false);
  });
});
