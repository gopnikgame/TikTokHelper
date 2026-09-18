import { describe, expect, it, vi } from 'vitest';
import { EntitlementCache } from '../src/supporters/entitlement-cache.js';

const active = {
  levelId: '123e4567-e89b-42d3-a456-426614174000', levelName: 'Голос эфира',
  cooldownSeconds: 30, expiresAt: null,
};

describe('supporter entitlement cache', () => {
  it('loads once and serves chat lookups without querying the repository', async () => {
    const list = vi.fn(async () => [{ identityKey: 'viewer-key', entitlement: active }]);
    const cache = new EntitlementCache({ listActiveSpeechEntitlements: list });
    await cache.prepare('primary', '123e4567-e89b-42d3-a456-426614174001');
    expect(cache.speakerContext('primary', 'viewer-key', { isModerator: false, isGiftGiver: true }))
      .toEqual({ isModerator: false, isGiftGiver: true, speechLevels: [active] });
    expect(cache.speakerContext('primary', 'viewer-key', { isModerator: false, isGiftGiver: true }))
      .toEqual({ isModerator: false, isGiftGiver: true, speechLevels: [active] });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('drops expired rights locally and refreshes changed configuration', async () => {
    const expired = { ...active, expiresAt: '2026-09-17T00:00:00.000Z' };
    const list = vi.fn()
      .mockResolvedValueOnce([{ identityKey: 'viewer-key', entitlement: expired }])
      .mockResolvedValueOnce([{ identityKey: 'viewer-key', entitlement: { ...active, levelName: 'Новый уровень' } }]);
    const cache = new EntitlementCache({ listActiveSpeechEntitlements: list }, () => Date.parse('2026-09-17T01:00:00.000Z'));
    await cache.prepare('primary', '123e4567-e89b-42d3-a456-426614174001');
    expect(cache.speakerContext('primary', 'viewer-key', { isModerator: false, isGiftGiver: false }).speechLevels).toEqual([]);
    await cache.refresh('primary');
    expect(cache.speakerContext('primary', 'viewer-key', { isModerator: false, isGiftGiver: false }).speechLevels[0]?.levelName)
      .toBe('Новый уровень');
  });

  it('adds a newly granted speech level without reloading all supporters', async () => {
    const list = vi.fn(async () => []);
    const cache = new EntitlementCache({ listActiveSpeechEntitlements: list });
    await cache.prepare('primary', '123e4567-e89b-42d3-a456-426614174001');
    cache.addGranted('primary', 'viewer-key', [{
      level: {
        id: active.levelId, workspaceId: 'primary', name: active.levelName,
        thresholdPoints: 10_000, pointsScope: 'lifetime', privilegeDuration: 'permanent',
        privilegeDurationDays: null, grantsChatSpeech: true, chatSpeechCooldownSeconds: 30,
        announcementTemplate: null, soundAssetId: null, isEnabled: true, position: 0,
      },
      expiresAt: null,
    }]);
    expect(cache.speakerContext('primary', 'viewer-key', { isModerator: false, isGiftGiver: true }).speechLevels)
      .toEqual([active]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('removes cached speech rights when supporter statistics are reset', async () => {
    const cache = new EntitlementCache({ listActiveSpeechEntitlements: async () => [{ identityKey: 'viewer-key', entitlement: active }] });
    await cache.prepare('primary', '123e4567-e89b-42d3-a456-426614174001');
    cache.clear('primary');
    expect(cache.speakerContext('primary', 'viewer-key', { isModerator: false, isGiftGiver: true }).speechLevels).toEqual([]);
  });
});
