import { describe, expect, it, vi } from 'vitest';
import { playbackOverlapPercent, SoundPlaybackQueue, type AudioLike, type PlaybackSettings } from './playback.js';
import type { ManagedAudioPlayback, ManagedPlaybackHandle } from './managed-playback.js';

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
  play = vi.fn<() => Promise<void>>(async () => undefined);
  end(): void { this.listeners.get('ended')?.(); }
}

const sequential: PlaybackSettings = {
  playbackMode: 'sequential', overlapPercent: 85, maxConcurrentSounds: 1, volumePercent: 80,
};

describe('SoundPlaybackQueue', () => {
  it('stops a separately running check when the parent stops all audio', () => {
    const audio = new FakeAudio();
    const player = new SoundPlaybackQueue(() => audio);
    const interrupted = vi.fn();
    const onResult = vi.fn();
    const preview = player.createPreviewQueue(interrupted);
    preview.enqueue(asset('/preview.wav'), 3, sequential, onResult);
    player.stopAll();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(preview.busy).toBe(false);
    expect(interrupted).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('gives a newly queued sound priority over a running check', () => {
    const liveAudio = new FakeAudio();
    const previewAudio = new FakeAudio();
    const interrupted = vi.fn();
    const player = new SoundPlaybackQueue((url) => url === '/live.wav' ? liveAudio : previewAudio);
    const preview = player.createPreviewQueue(interrupted);
    preview.enqueue(asset('/preview.wav'), 3, sequential);

    player.enqueue(asset('/live.wav'), 1, sequential);

    expect(interrupted).toHaveBeenCalledOnce();
    expect(previewAudio.pause).toHaveBeenCalledOnce();
    expect(preview.busy).toBe(false);
    expect(liveAudio.play).toHaveBeenCalledOnce();
    player.stopAll();
  });

  it('uses the effective overlap for each playback mode', () => {
    expect(playbackOverlapPercent(sequential)).toBe(0);
    expect(playbackOverlapPercent({ playbackMode: 'controlled_overlap', overlapPercent: 25 })).toBe(25);
    expect(playbackOverlapPercent({ playbackMode: 'strong_overlap', overlapPercent: 25 })).toBe(60);
    expect(playbackOverlapPercent({ playbackMode: 'strong_overlap', overlapPercent: 85 })).toBe(85);
  });

  it('plays 100 preview jobs through the ordinary queue and reports each actual completion', () => {
    vi.useFakeTimers();
    try {
      const audio = new FakeAudio();
      const preview = new SoundPlaybackQueue(() => audio).createPreviewQueue();
      const onResult = vi.fn();
      preview.enqueue(asset('/test-series.wav'), 100, sequential, onResult);
      expect(preview.pending).toBe(99);
      expect(onResult).not.toHaveBeenCalled();
      for (let count = 1; count <= 100; count += 1) {
        expect(audio.play).toHaveBeenCalledTimes(count);
        audio.end();
        expect(onResult).toHaveBeenNthCalledWith(count, 'ended');
        vi.advanceTimersByTime(2_000);
      }
      expect(preview.busy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops only preview audio and removes listeners before late metadata and errors', async () => {
    vi.useFakeTimers();
    try {
      const liveAudio = new FakeAudio();
      const previewAudio = new FakeAudio();
      previewAudio.load = () => undefined;
      const pendingPlayback = Promise.withResolvers<void>();
      previewAudio.play.mockReturnValueOnce(pendingPlayback.promise);
      const player = new SoundPlaybackQueue((url) => url === '/live.wav' ? liveAudio : previewAudio);
      player.enqueue(asset('/live.wav'), 1, sequential);
      const preview = player.createPreviewQueue();
      const onResult = vi.fn();
      preview.enqueue(asset('/preview.wav'), 2, sequential, onResult);
      const lateMetadata = previewAudio.listeners.get('loadedmetadata');
      const lateEnded = previewAudio.listeners.get('ended');

      preview.stopAll();
      expect(previewAudio.listeners.size).toBe(0);
      expect(previewAudio.pause).toHaveBeenCalledOnce();
      expect(preview.busy).toBe(false);
      expect(liveAudio.pause).not.toHaveBeenCalled();

      lateMetadata?.();
      lateEnded?.();
      pendingPlayback.reject(new Error('media aborted'));
      await Promise.resolve();
      expect(onResult).not.toHaveBeenCalled();
      expect(previewAudio.play).toHaveBeenCalledOnce();
      expect(player.active).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels preparation and starts HTML Audio within the activation gesture', async () => {
    const resume = Promise.withResolvers<void>();
    const pendingMedia = Promise.withResolvers<void>();
    const media = new FakeAudio();
    media.play.mockReturnValueOnce(pendingMedia.promise);
    const managed = { enable: () => resume.promise } as unknown as ManagedAudioPlayback;
    const preview = new SoundPlaybackQueue(() => media, undefined, managed).createPreviewQueue();
    const preparation = preview.unlock(1);
    expect(media.play).toHaveBeenCalledOnce();
    expect(preview.busy).toBe(true);
    preview.stopAll();
    expect(media.pause).toHaveBeenCalledOnce();
    resume.resolve();
    pendingMedia.resolve();
    await expect(preparation).rejects.toHaveProperty('name', 'AbortError');
    expect(preview.busy).toBe(false);
  });

  it('suppresses a cancelled decode while letting the next managed job start', async () => {
    const older = Promise.withResolvers<ManagedPlaybackHandle>();
    const newer = Promise.withResolvers<ManagedPlaybackHandle>();
    const play = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const preview = new SoundPlaybackQueue(undefined, undefined, { play } as unknown as ManagedAudioPlayback)
      .createPreviewQueue();
    const oldResult = vi.fn();
    const newResult = vi.fn();
    preview.enqueue(asset('/older.wav'), 1, sequential, oldResult);
    const [, , oldEnded, canStartOld] = play.mock.calls[0]!;
    expect(canStartOld()).toBe(true);
    preview.stopAll();
    expect(canStartOld()).toBe(false);
    preview.enqueue(asset('/newer.wav'), 1, sequential, newResult);
    expect(play).toHaveBeenCalledTimes(2);

    oldEnded();
    older.reject(new DOMException('Cancelled', 'AbortError'));
    await Promise.resolve();
    expect(preview.busy).toBe(true);
    expect(oldResult).not.toHaveBeenCalled();

    const stop = vi.fn();
    newer.resolve({ durationMs: 10, stop });
    await Promise.resolve();
    const [, , newEnded] = play.mock.calls[1]!;
    newEnded();
    newEnded();
    expect(newResult).toHaveBeenCalledExactlyOnceWith('ended');
    preview.stopAll();
    expect(stop).not.toHaveBeenCalled();
  });

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
    const onResult = vi.fn();
    const sound = new FakeAudio();
    sound.play.mockRejectedValueOnce(new Error('autoplay blocked'));
    const queue = new SoundPlaybackQueue(() => sound, onError);
    queue.enqueue(asset('/rose.wav'), 1, sequential, onResult);
    sound.listeners.get('error')?.();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledExactlyOnceWith('failed');
    expect(queue.active).toBe(0);
  });

  it('does not report audio as unlocked when every warm-up playback fails', async () => {
    const sound = new FakeAudio();
    sound.play.mockRejectedValue(new Error('unsupported warm-up audio'));
    const queue = new SoundPlaybackQueue(() => sound);
    await expect(queue.unlock(1, '/real-sound.mp3')).rejects.toThrow('not unlocked');
  });

  it('allows cached Web Audio when the media-element warm-up is offline', async () => {
    const media = new FakeAudio();
    media.play.mockRejectedValue(new Error('offline'));
    const managed = { enable: vi.fn(async () => undefined) } as unknown as ManagedAudioPlayback;
    const queue = new SoundPlaybackQueue(() => media, undefined, managed);
    await expect(queue.unlock(1, '/real-sound.mp3')).resolves.toBeUndefined();
    expect(managed.enable).toHaveBeenCalledOnce();
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
    const onResult = vi.fn();
    queue.enqueue(asset('/fallback.ogg'), 1, sequential, onResult);
    await vi.waitFor(() => expect(media.play).toHaveBeenCalledOnce());
    expect(media.src).toBe('/fallback.ogg');
    expect(onResult).not.toHaveBeenCalled();
    media.end();
    expect(onResult).toHaveBeenCalledExactlyOnceWith('ended');
  });
});
