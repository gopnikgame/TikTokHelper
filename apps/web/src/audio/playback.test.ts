import { describe, expect, it, vi } from 'vitest';
import { SoundPlaybackQueue, type AudioLike } from './playback.js';

class FakeAudio implements AudioLike {
  currentTime = 0; duration = 2; volume = 1;
  listeners = new Map<string, () => void>();
  addEventListener(type: 'ended' | 'error' | 'loadedmetadata', listener: () => void): void { this.listeners.set(type, listener); }
  load(): void { this.listeners.get('loadedmetadata')?.(); }
  pause = vi.fn();
  play = vi.fn(async () => undefined);
  end(): void { this.listeners.get('ended')?.(); }
}

describe('SoundPlaybackQueue', () => {
  it('queues one playback for every counted gift and applies volume', () => {
    vi.useFakeTimers();
    const sounds: FakeAudio[] = [];
    const queue = new SoundPlaybackQueue(() => { const sound = new FakeAudio(); sounds.push(sound); return sound; });
    queue.enqueue('/rose.wav', 3, { playbackMode: 'controlled_overlap', overlapPercent: 25, maxConcurrentSounds: 4, volumePercent: 80 });
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
    const queue = new SoundPlaybackQueue(() => { const sound = new FakeAudio(); sounds.push(sound); return sound; });
    queue.enqueue('/rose.wav', 3, { playbackMode: 'sequential', overlapPercent: 90, maxConcurrentSounds: 1, volumePercent: 100 });
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
    queue.enqueue('/rose.wav', 1, { playbackMode: 'sequential', overlapPercent: 0, maxConcurrentSounds: 1, volumePercent: 100 });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    expect(queue.active).toBe(0);
  });
});
