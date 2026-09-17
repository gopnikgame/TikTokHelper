import { describe, expect, it, vi } from 'vitest';
import { SoundPlaybackQueue, type AudioLike } from './playback.js';
import type { ManagedAudioPlayback } from './managed-playback.js';

const asset = (url: string) => ({
  id: '56f92c37-5eca-43b3-8073-6d1a3c8b9cd3', displayName: 'Test', url,
  contentSha256: '0'.repeat(64), byteSize: 12, mimeType: 'audio/wav' as const,
  status: 'active' as const, createdByUserId: null, isOwnedByCurrentUser: false,
  usageCount: 0, quarantineReason: null, canQuarantine: false, canDelete: false,
});

class FakeAudio implements AudioLike {
  currentTime = 0; duration = 2; src: string; volume = 1;
  constructor(src = '') { this.src = src; }
  listeners = new Map<string, () => void>();
  addEventListener(type: 'ended' | 'error' | 'loadedmetadata', listener: () => void): void { this.listeners.set(type, listener); }
  removeEventListener(type: 'ended' | 'error' | 'loadedmetadata', listener: () => void): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  load(): void { this.listeners.get('loadedmetadata')?.(); }
  pause = vi.fn();
  play = vi.fn(async () => undefined);
  end(): void { this.listeners.get('ended')?.(); }
}

describe('SoundPlaybackQueue', () => {
  it('reuses audio elements unlocked by a user action for later gift playback', async () => {
    const sounds: FakeAudio[] = [];
    const queue = new SoundPlaybackQueue((url) => { const sound = new FakeAudio(url); sounds.push(sound); return sound; });
    await queue.unlock(1);
    expect(sounds).toHaveLength(1);
    expect(sounds[0]?.src).toMatch(/^data:audio\/wav/);
    expect(sounds[0]?.pause).toHaveBeenCalledOnce();
    queue.enqueue(asset('/rose.wav'), 1, { playbackMode: 'sequential', overlapPercent: 0, maxConcurrentSounds: 1, volumePercent: 80 });
    expect(sounds).toHaveLength(1);
    expect(sounds[0]?.play).toHaveBeenCalledTimes(2);
    expect(sounds[0]?.src).toBe('/rose.wav');
    expect(sounds[0]?.volume).toBe(.8);
  });

  it('queues one playback for every counted gift and applies volume', () => {
    vi.useFakeTimers();
    const sounds: FakeAudio[] = [];
    const queue = new SoundPlaybackQueue((url) => { const sound = new FakeAudio(url); sounds.push(sound); return sound; });
    queue.enqueue(asset('/rose.wav'), 3, { playbackMode: 'controlled_overlap', overlapPercent: 25, maxConcurrentSounds: 4, volumePercent: 80 });
    expect(sounds).toHaveLength(1);
    expect(sounds[0]?.volume).toBe(.8);
    vi.advanceTimersByTime(1_500);
    expect(sounds).toHaveLength(2);
    vi.advanceTimersByTime(1_500);
    expect(sounds).toHaveLength(3);
    vi.useRealTimers();
  });

  it('clears pending and active sounds immediately', () => {
    const sounds: FakeAudio[] = [];
    const queue = new SoundPlaybackQueue((url) => { const sound = new FakeAudio(url); sounds.push(sound); return sound; });
    queue.enqueue(asset('/rose.wav'), 3, { playbackMode: 'sequential', overlapPercent: 90, maxConcurrentSounds: 1, volumePercent: 100 });
    queue.stopAll();
    expect(queue.pending).toBe(0);
    expect(queue.active).toBe(0);
    expect(sounds[0]?.pause).toHaveBeenCalled();
  });

  it('reports a browser playback rejection and releases the active slot', async () => {
    const onError = vi.fn();
    const sound = new FakeAudio();
    sound.play.mockRejectedValueOnce(new Error('autoplay blocked'));
    const queue = new SoundPlaybackQueue(() => sound, onError);
    queue.enqueue(asset('/rose.wav'), 1, { playbackMode: 'sequential', overlapPercent: 0, maxConcurrentSounds: 1, volumePercent: 100 });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    expect(queue.active).toBe(0);
  });

  it('does not report audio as unlocked when every warm-up playback fails', async () => {
    const sound = new FakeAudio();
    sound.play.mockRejectedValue(new Error('unsupported warm-up audio'));
    const queue = new SoundPlaybackQueue(() => sound);
    await expect(queue.unlock(1, '/real-sound.mp3')).rejects.toThrow('not unlocked');
  });

  it('starts preview playback immediately on a real source', async () => {
    const sound = new FakeAudio();
    const queue = new SoundPlaybackQueue((url) => { sound.src = url; return sound; });
    const playback = queue.preview(asset('/real-sound.mp3'), 65);
    expect(sound.play).toHaveBeenCalledOnce();
    expect(sound.src).toBe('/real-sound.mp3');
    expect(sound.volume).toBe(.65);
    await playback;
  });

  it('falls back to the media element when managed decoding fails', async () => {
    const media = new FakeAudio();
    const managed = { play: vi.fn(async () => { throw new Error('decode failed'); }) } as unknown as ManagedAudioPlayback;
    const queue = new SoundPlaybackQueue(() => media, undefined, managed);
    queue.enqueue(asset('/fallback.ogg'), 1, { playbackMode: 'sequential', overlapPercent: 0, maxConcurrentSounds: 1, volumePercent: 100 });
    await vi.waitFor(() => expect(media.play).toHaveBeenCalledOnce());
    expect(media.src).toBe('/fallback.ogg');
  });
});
