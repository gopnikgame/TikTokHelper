import { describe, expect, it } from 'vitest';
import type { PlaybackSettings } from '../audio/playback.js';
import { readAudioProfile, resolveAudioProfile, saveAudioProfileMode, saveQuietProfileOptions } from './model.js';

const normal: PlaybackSettings = { playbackMode: 'controlled_overlap', overlapPercent: 25, maxConcurrentSounds: 4, volumePercent: 80 };

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); },
  };
}

describe('browser audio profiles', () => {
  it('keeps established playback settings in the ordinary profile and uses a quiet sequential preset', () => {
    const loaded = readAudioProfile('stream', memoryStorage(), memoryStorage());
    expect(resolveAudioProfile(normal, loaded)).toEqual({
      playback: normal, speechEnabled: true, speechVolumeLimit: 1,
    });
    expect(resolveAudioProfile(normal, { ...loaded, mode: 'quiet' })).toEqual({
      playback: { playbackMode: 'sequential', overlapPercent: 0, maxConcurrentSounds: 1, volumePercent: 25, requiresControlledVolume: true },
      speechEnabled: false, speechVolumeLimit: 0.25,
    });
  });

  it('keeps a quieter ordinary sound level and respects a zero volume ceiling', () => {
    const quiet = { mode: 'quiet' as const, quiet: { volumeLimitPercent: 30, speechEnabled: true } };
    expect(resolveAudioProfile({ ...normal, volumePercent: 10 }, quiet)).toMatchObject({
      playback: { volumePercent: 10 }, speechEnabled: true, speechVolumeLimit: 0.3,
    });
    expect(resolveAudioProfile(normal, { ...quiet, quiet: { ...quiet.quiet, volumeLimitPercent: 0 } })).toMatchObject({
      playback: { volumePercent: 0 }, speechEnabled: false, speechVolumeLimit: 0,
    });
  });

  it('retains selection in this tab and quiet settings in this browser, scoped by workspace', () => {
    const settings = memoryStorage();
    const firstTab = memoryStorage();
    const secondTab = memoryStorage();
    const quiet = { volumeLimitPercent: 12, speechEnabled: true };
    expect(saveQuietProfileOptions('first', quiet, settings)).toBe(true);
    expect(saveAudioProfileMode('first', 'quiet', firstTab)).toBe(true);
    expect(readAudioProfile('first', settings, firstTab)).toEqual({ mode: 'quiet', quiet });
    expect(readAudioProfile('first', settings, secondTab)).toEqual({ mode: 'normal', quiet });
    expect(readAudioProfile('second', settings, firstTab)).toEqual({ mode: 'normal', quiet: { volumeLimitPercent: 25, speechEnabled: false } });
  });

  it('uses defaults for invalid stored values and keeps blocked storage non-fatal', () => {
    const invalid = { getItem: () => '{"volumeLimitPercent":"100","speechEnabled":"true"}', setItem() { throw new Error(); } };
    const denied = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
    expect(readAudioProfile('stream', invalid, denied)).toEqual({
      mode: 'normal', quiet: { volumeLimitPercent: 25, speechEnabled: false },
    });
    expect(saveAudioProfileMode('stream', 'quiet', denied)).toBe(false);
    expect(saveQuietProfileOptions('stream', { volumeLimitPercent: 20, speechEnabled: true }, denied)).toBe(false);
  });
});
