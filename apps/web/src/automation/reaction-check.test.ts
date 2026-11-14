import type { AutomationConfiguration, EventReaction, GiftSoundMapping, ObservedGift, SoundAsset } from '@tiktok-helper/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings-model.js';
import { donorCheckActions, giftCheckActions, giftCompletionCheckActions, validPlaybackSettings } from './reaction-check.js';

const sound: SoundAsset = {
  id: 'signal', displayName: 'Сигнал', url: '/signal.wav', contentSha256: '0'.repeat(64), byteSize: 12,
  mimeType: 'audio/wav', status: 'active', createdByUserId: null, isOwnedByCurrentUser: false,
  usageCount: 1, quarantineReason: null, canQuarantine: false, canDelete: false,
};
const mapping: GiftSoundMapping = {
  giftId: '5655', soundAssetId: sound.id, soundDisplayName: sound.displayName, soundUrl: sound.url, isEnabled: true,
};
const sounds = new Map([[sound.id, sound]]);
const automation: AutomationConfiguration = {
  policy: {
    workspaceId: 'primary', moderatorSpeechEnabled: true, moderatorCooldownSeconds: 30,
    defaultSpeechCooldownSeconds: 30, maxMessageCharacters: 200, maxQueueSize: 20,
    readUserName: false, fallbackLanguage: 'ru-RU', revision: 1,
  },
  supportLevels: [],
  eventReactions: [{
    id: 'donor', workspaceId: 'primary', name: 'Поприветствовать', eventType: 'donor_seen', supportLevelId: null,
    speechTemplate: '{user}, спасибо!', soundAssetId: sound.id, cooldownSeconds: 60, isEnabled: true, position: 0,
  }],
};
const rose: ObservedGift = {
  giftId: '5655', giftName: 'Rose', diamondCount: 100, imageUrl: null,
  firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z',
};
const giftRule: EventReaction = {
  id: 'gift', workspaceId: 'primary', eventType: 'gift_completed', name: 'Розы', giftId: rose.giftId, minimumGiftPoints: 300,
  supportLevelId: null, speechTemplate: '{user}, спасибо за {gift} ×{count}!', soundAssetId: sound.id,
  cooldownSeconds: 5, isEnabled: true, position: 0,
};
const giftSample = { gift: rose, count: 3, ruleId: giftRule.id, withinCooldown: false, soundVolume: 80, voiceVolume: 1 };

describe('reaction check', () => {
  it.each([1, 3, 100])('uses the saved asset for exactly %s plays', (count) => {
    expect(giftCheckActions(mapping, sounds, count, 80)).toEqual([{ type: 'sound', asset: sound, count }]);
  });

  it('explains missing, disabled, muted and unavailable gift sounds', () => {
    expect(giftCheckActions(undefined, sounds, 1, 80)[0]).toMatchObject({ type: 'skipped', reason: /сохраните привязку/ });
    expect(giftCheckActions({ ...mapping, isEnabled: false }, sounds, 1, 80)[0]).toMatchObject({ type: 'skipped', reason: /выключена/ });
    expect(giftCheckActions(mapping, sounds, 1, 0)[0]).toMatchObject({ type: 'skipped', reason: /громкость/ });
    const quarantined = new Map([[sound.id, { ...sound, status: 'quarantined' as const }]]);
    expect(giftCheckActions(mapping, quarantined, 1, 80)[0]).toMatchObject({ type: 'skipped', reason: /недоступен/ });
  });

  it('uses current donor rules with independent first and repeat scenarios', () => {
    const first = donorCheckActions(automation, false, sounds, 80, 1);
    expect(first).toMatchObject([
      { type: 'sound', asset: sound, count: 1 },
      { type: 'speech', job: { text: 'Тестовый зритель, спасибо!', language: 'ru-RU' } },
    ]);
    expect(donorCheckActions(automation, true, sounds, 80, 1)).toMatchObject([
      { type: 'skipped', reason: /первом появлении/ },
    ]);
    expect(donorCheckActions(automation, false, sounds, 80, 1)).toEqual(first);
  });

  it('explains missing rules and unavailable speech separately from sound', () => {
    const disabled = { ...automation, eventReactions: automation.eventReactions.map((item) => ({ ...item, isEnabled: false })) };
    expect(donorCheckActions(disabled, false, sounds, 80, 1)[0]).toMatchObject({ type: 'skipped', reason: /Назначьте/ });
    expect(donorCheckActions(automation, false, sounds, 80, undefined)).toMatchObject([
      { type: 'sound' }, { type: 'skipped', label: 'Озвучка', reason: /не поддерживает/ },
    ]);
  });

  it('uses the same completed-gift threshold and plays the configured reaction once', () => {
    const config = { ...automation, eventReactions: [giftRule] };
    expect(giftCompletionCheckActions(config, sounds, { ...giftSample, count: 2 })[0])
      .toMatchObject({ type: 'skipped', reason: /200 баллов из 300/ });
    expect(giftCompletionCheckActions(config, sounds, { ...giftSample, gift: { ...rose, diamondCount: null } })[0])
      .toMatchObject({ type: 'skipped', reason: /неизвестна/ });
    expect(giftCompletionCheckActions(config, sounds, giftSample)).toMatchObject([
      { type: 'sound', count: 1 }, { type: 'speech', job: { text: 'Тестовый зритель, спасибо за Rose ×3!' } },
    ]);
    expect(giftCheckActions(mapping, sounds, 3, 80)).toMatchObject([{ type: 'sound', count: 3 }]);
  });

  it('explains paused, disabled and overridden completion rules', () => {
    const config = { ...automation, eventReactions: [giftRule] };
    expect(giftCompletionCheckActions(config, sounds, { ...giftSample, withinCooldown: true })[0])
      .toMatchObject({ type: 'skipped', reason: /пауза 5/ });
    expect(giftCompletionCheckActions({ ...config, eventReactions: [{ ...giftRule, isEnabled: false }] }, sounds, giftSample)[0])
      .toMatchObject({ type: 'skipped', reason: /выключено/ });
    const overridden = { ...config, eventReactions: [
      { ...giftRule, position: 1 }, { ...giftRule, id: 'first', name: 'Первое' },
    ] };
    expect(giftCompletionCheckActions(overridden, sounds, giftSample)[0])
      .toMatchObject({ type: 'skipped', reason: /«Первое»/ });
  });

  it('rejects unfinished or out-of-range playback settings', () => {
    expect(validPlaybackSettings(DEFAULT_SETTINGS)).toBe(true);
    expect(validPlaybackSettings({ ...DEFAULT_SETTINGS, maxConcurrentSounds: NaN })).toBe(false);
    expect(validPlaybackSettings({ ...DEFAULT_SETTINGS, maxConcurrentSounds: 33 })).toBe(false);
    expect(validPlaybackSettings({ ...DEFAULT_SETTINGS, volumePercent: 0 })).toBe(true);
  });
});
