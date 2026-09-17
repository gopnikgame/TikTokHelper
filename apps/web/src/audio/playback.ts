import type { PlaybackMode, SoundAsset } from '@tiktok-helper/contracts';
import { ManagedAudioPlayback, type ManagedPlaybackHandle } from './managed-playback.js';

export interface PlaybackSettings {
  maxConcurrentSounds: number;
  overlapPercent: number;
  playbackMode: PlaybackMode;
  volumePercent: number;
}

export interface AudioLike {
  currentTime: number;
  duration: number;
  src: string;
  volume: number;
  addEventListener(type: 'ended' | 'error' | 'loadedmetadata', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'ended' | 'error' | 'loadedmetadata', listener: () => void): void;
  load(): void;
  pause(): void;
  play(): Promise<void>;
}

interface Job { sound: SoundAsset; settings: PlaybackSettings }

const SILENT_AUDIO_DATA_URL = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

export class SoundPlaybackQueue {
  readonly #queue: Job[] = [];
  readonly #active = new Set<AudioLike>();
  readonly #managedActive = new Set<ManagedPlaybackHandle>();
  readonly #unlocked: AudioLike[] = [];
  #launchTimer: ReturnType<typeof setTimeout> | undefined;
  #starting = false;
  #epoch = 0;

  constructor(
    private readonly createAudio: (url: string) => AudioLike = (url) => new Audio(url),
    private readonly onError: () => void = () => undefined,
    private readonly managed: ManagedAudioPlayback | undefined = typeof AudioContext === 'undefined' ? undefined : new ManagedAudioPlayback(),
  ) {}

  get pending(): number { return this.#queue.length; }
  get active(): number { return this.#active.size + this.#managedActive.size; }

  async unlock(instances: number, warmupUrl?: string): Promise<void> {
    let managedReady = false;
    try { await this.managed?.enable(); managedReady = this.managed !== undefined; } catch { /* HTMLAudio remains the compatibility path. */ }
    const count = Math.min(8, Math.max(1, Math.trunc(instances)));
    const attempts: Promise<void>[] = [];
    for (let index = this.#unlocked.length; index < count; index += 1) {
      const audio = this.createAudio(warmupUrl ?? SILENT_AUDIO_DATA_URL);
      audio.volume = 0;
      audio.load();
      attempts.push(audio.play().then(() => {
        audio.pause(); audio.currentTime = 0; this.#unlocked.push(audio);
      }).catch(() => this.onError()));
    }
    await Promise.all(attempts);
    if (this.#unlocked.length === 0 && !managedReady) throw new Error('audio playback was not unlocked');
  }

  async preview(sound: SoundAsset, volumePercent: number): Promise<void> {
    if (this.managed) {
      try {
        const handle = await this.managed.play(sound, volumePercent, () => this.#managedActive.delete(handle));
        this.#managedActive.add(handle);
        return;
      } catch { /* Fall through to the media element. */ }
    }
    const audio = this.createAudio(sound.url);
    audio.volume = volumePercent / 100;
    audio.load();
    this.#active.add(audio);
    const release = () => { this.#active.delete(audio); };
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    const playback = audio.play();
    void playback.catch(() => { this.onError(); release(); });
    return playback;
  }

  enqueue(sound: SoundAsset, count: number, settings: PlaybackSettings): void {
    const safeCount = Math.min(5_000, Math.max(0, Math.trunc(count)));
    for (let index = 0; index < safeCount; index += 1) this.#queue.push({ sound, settings });
    this.#pump();
  }

  warm(sounds: readonly SoundAsset[]): Promise<{ prepared: number; failed: number }> {
    return this.managed?.warm(sounds) ?? Promise.resolve({ prepared: 0, failed: sounds.length });
  }
  reconcile(sounds: readonly SoundAsset[]): Promise<void> { return this.managed?.reconcile(sounds) ?? Promise.resolve(); }

  stopAll(): void {
    this.#epoch += 1;
    this.#queue.length = 0;
    if (this.#launchTimer) clearTimeout(this.#launchTimer);
    this.#launchTimer = undefined;
    for (const audio of this.#active) { audio.pause(); audio.currentTime = 0; }
    this.#active.clear();
    for (const handle of this.#managedActive) handle.stop();
    this.#managedActive.clear();
  }

  #pump(): void {
    if (this.#starting || this.#launchTimer || this.#queue.length === 0) return;
    const next = this.#queue[0];
    if (!next || this.active >= next.settings.maxConcurrentSounds) return;
    this.#queue.shift();
    if (this.managed) {
      this.#starting = true;
      const epoch = this.#epoch;
      void this.managed.play(next.sound, next.settings.volumePercent, () => {
        if (handle) this.#managedActive.delete(handle);
        this.#pump();
      }).then((started) => {
        if (epoch !== this.#epoch) { started.stop(); return; }
        handle = started;
        this.#managedActive.add(started);
        this.#scheduleNext(started.durationMs, next.settings);
      }).catch(() => { if (epoch === this.#epoch) this.#startMedia(next); }).finally(() => { this.#starting = false; this.#pump(); });
      let handle: ManagedPlaybackHandle | undefined;
      return;
    }
    this.#startMedia(next);
  }

  #startMedia(next: Job): void {
    const audio = this.#unlocked.shift() ?? this.createAudio(next.sound.url);
    audio.src = next.sound.url;
    audio.volume = next.settings.volumePercent / 100;
    this.#active.add(audio);
    let finished = false;
    const onEnded = () => finish(true);
    const onPlaybackError = () => { this.onError(); finish(false); };
    const finish = (reusable: boolean) => {
      if (finished) return;
      finished = true;
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onPlaybackError);
      this.#active.delete(audio);
      if (reusable) { audio.currentTime = 0; this.#unlocked.push(audio); }
      this.#pump();
    };
    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onPlaybackError, { once: true });
    audio.addEventListener('loadedmetadata', () => {
      const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1_000 : 1_000;
      this.#scheduleNext(durationMs, next.settings);
    }, { once: true });
    audio.load();
    void audio.play().catch(() => { this.onError(); finish(false); });
  }

  #scheduleNext(durationMs: number, settings: PlaybackSettings): void {
    const overlap = settings.playbackMode === 'sequential'
      ? 0
      : settings.playbackMode === 'strong_overlap'
        ? Math.max(60, settings.overlapPercent)
        : settings.overlapPercent;
    const delay = Math.max(0, durationMs * (1 - overlap / 100));
    this.#launchTimer = setTimeout(() => { this.#launchTimer = undefined; this.#pump(); }, delay);
  }
}

export class AudioOwnership {
  readonly #id = crypto.randomUUID();
  readonly #channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('tiktok-helper-audio');
  #owned = false;

  constructor(private readonly onLost: () => void) {
    this.#channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.#owned && event.data !== this.#id) {
        this.#owned = false;
        this.onLost();
      }
    });
  }

  claim(): void { this.#owned = true; this.#channel?.postMessage(this.#id); }
  close(): void { this.#channel?.close(); }
}
