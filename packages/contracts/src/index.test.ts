import { describe, expect, it } from 'vitest';

import { Ajv } from 'ajv';
import {
  hasOnlyKnownTemplateVariables, healthResponseSchema, saveEventReactionSchema,
  saveSupportLevelSchema, updateWorkspaceSpeechPolicySchema, validateClientEvent,
} from './index.js';

describe('health response contract', () => {
  it('requires the ok status', () => {
    expect(healthResponseSchema.required).toEqual(['status']);
    expect(healthResponseSchema.properties.status.const).toBe('ok');
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
});
