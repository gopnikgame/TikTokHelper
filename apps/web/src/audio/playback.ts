import type { PlaybackMode, SoundAsset } from '@tiktok-helper/contracts';
import { ManagedAudioPlayback, type ManagedPlaybackHandle } from './managed-playback.js';

export interface PlaybackSettings {
  maxConcurrentSounds: number;
  overlapPercent: number;
  playbackMode: PlaybackMode;
  requiresControlledVolume?: boolean;
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

type PlaybackResult = 'ended' | 'failed';
type PlaybackErrorReason = 'controlled_volume_unavailable';
interface Job {
  sound: SoundAsset;
  settings: PlaybackSettings;
  onResult?: (result: PlaybackResult) => void;
}

const SILENT_AUDIO_DATA_URL = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

export function playbackOverlapPercent(settings: Pick<PlaybackSettings, 'playbackMode' | 'overlapPercent'>): number {
  if (settings.playbackMode === 'sequential') return 0;
  if (settings.playbackMode === 'strong_overlap') return Math.max(60, settings.overlapPercent);
  return settings.overlapPercent;
}

export class SoundPlaybackQueue {
  readonly #queue: Job[] = [];
  readonly #active = new Map<AudioLike, () => void>();
  readonly #managedActive = new Set<ManagedPlaybackHandle>();
  readonly #unlocked: AudioLike[] = [];
  readonly #warming = new Map<AudioLike, Promise<void>>();
  #launchTimer: ReturnType<typeof setTimeout> | undefined;
  #starting = false;
  #preparingPreviews = 0;
  #epoch = 0;
  #preview: { queue: SoundPlaybackQueue; onInterrupted: () => void } | undefined;

  constructor(
    private readonly createAudio: (url: string) => AudioLike = (url) => new Audio(url),
    private readonly onError: (reason?: PlaybackErrorReason) => void = () => undefined,
    private readonly managed: ManagedAudioPlayback | undefined = typeof AudioContext === 'undefined' ? undefined : new ManagedAudioPlayback(),
  ) {}

  get pending(): number { return this.#queue.length; }
  get active(): number { return this.#active.size + this.#managedActive.size; }
  get busy(): boolean {
    return this.#starting || this.active > 0 || this.pending > 0 || this.#warming.size > 0 || this.#preparingPreviews > 0;
  }

  createPreviewQueue(onInterrupted: () => void = () => undefined): SoundPlaybackQueue {
    this.#interruptPreview();
    const queue = new SoundPlaybackQueue(this.createAudio, undefined, this.managed);
    this.#preview = { queue, onInterrupted };
    return queue;
  }

  stopPreview(queue: SoundPlaybackQueue): void {
    if (this.#preview?.queue === queue) this.#preview = undefined;
    queue.stopAll();
  }

  #interruptPreview(): void {
    const preview = this.#preview;
    if (!preview) return;
    this.stopPreview(preview.queue);
    preview.onInterrupted();
  }

  async unlock(instances: number, warmupUrl?: string): Promise<void> {
    const epoch = this.#epoch;
    const managedReady = this.managed?.enable().then(() => true, () => false) ?? Promise.resolve(false);
    const count = Math.min(8, Math.max(1, Math.trunc(instances)));
    for (let index = this.#unlocked.length + this.#warming.size; index < count; index += 1) {
      const audio = this.createAudio(warmupUrl ?? SILENT_AUDIO_DATA_URL);
      audio.volume = 0;
      audio.load();
      const attempt = audio.play().then(() => {
        if (epoch !== this.#epoch) return;
        audio.pause(); audio.currentTime = 0; this.#unlocked.push(audio);
      }, () => {
        if (epoch === this.#epoch) this.onError();
      }).finally(() => {
        if (epoch === this.#epoch) this.#warming.delete(audio);
      });
      this.#warming.set(audio, attempt);
    }
    const [ready] = await Promise.all([managedReady, ...this.#warming.values()]);
    if (epoch !== this.#epoch) throw new DOMException('Audio preparation cancelled', 'AbortError');
    if (this.#unlocked.length === 0 && !ready) throw new Error('audio playback was not unlocked');
  }

  async preview(sound: SoundAsset, volumePercent: number, requiresControlledVolume = false): Promise<void> {
    if (requiresControlledVolume && volumePercent <= 0) throw new Error('Audio is muted');
    this.#interruptPreview();
    const epoch = this.#epoch;
    if (this.managed) {
      this.#preparingPreviews += 1;
      try {
        if (requiresControlledVolume) await this.managed.enable();
        const handle = await this.managed.play(sound, volumePercent, () => {
          this.#managedActive.delete(handle);
          this.#pump();
        }, () => epoch === this.#epoch);
        if (epoch !== this.#epoch) {
          handle.stop();
          throw new DOMException('Audio playback cancelled', 'AbortError');
        }
        this.#managedActive.add(handle);
        return;
      } catch {
        if (epoch !== this.#epoch) throw new DOMException('Audio playback cancelled', 'AbortError');
      } finally {
        if (epoch === this.#epoch) {
          this.#preparingPreviews -= 1;
          this.#pump();
        }
      }
    }
    if (requiresControlledVolume) {
      this.onError('controlled_volume_unavailable');
      throw new Error('Controlled audio volume is unavailable');
    }
    const audio = this.createAudio(sound.url);
    audio.volume = volumePercent / 100;
    const release = () => {
      this.#active.delete(audio);
      audio.removeEventListener('ended', release);
      audio.removeEventListener('error', release);
    };
    this.#active.set(audio, () => { release(); audio.pause(); audio.currentTime = 0; });
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    audio.load();
    try { await audio.play(); }
    catch (error) {
      if (epoch !== this.#epoch) throw new DOMException('Audio playback cancelled', 'AbortError');
      this.onError();
      release();
      throw error;
    }
    if (epoch !== this.#epoch) throw new DOMException('Audio playback cancelled', 'AbortError');
  }

  enqueue(sound: SoundAsset, count: number, settings: PlaybackSettings, onResult?: Job['onResult']): void {
    if (settings.requiresControlledVolume && settings.volumePercent <= 0) return;
    const safeCount = Math.min(5_000, Math.max(0, Math.trunc(count)));
    if (safeCount > 0) this.#interruptPreview();
    for (let index = 0; index < safeCount; index += 1) this.#queue.push({ sound, settings, onResult });
    this.#pump();
  }

  warm(sounds: readonly SoundAsset[]): Promise<{ prepared: number; failed: number }> {
    return this.managed?.warm(sounds) ?? Promise.resolve({ prepared: 0, failed: sounds.length });
  }
  reconcile(sounds: readonly SoundAsset[]): Promise<void> { return this.managed?.reconcile(sounds) ?? Promise.resolve(); }

  stopAll(): void {
    this.#interruptPreview();
    this.#epoch += 1;
    this.#queue.length = 0;
    if (this.#launchTimer) clearTimeout(this.#launchTimer);
    this.#launchTimer = undefined;
    this.#starting = false;
    this.#preparingPreviews = 0;
    for (const cancel of this.#active.values()) cancel();
    for (const audio of this.#warming.keys()) { audio.pause(); audio.currentTime = 0; }
    this.#warming.clear();
    for (const handle of this.#managedActive) handle.stop();
    this.#managedActive.clear();
  }

  #pump(): void {
    if (this.#starting || this.#launchTimer || this.#queue.length === 0) return;
    const next = this.#queue[0];
    if (!next || this.active >= next.settings.maxConcurrentSounds
      || (next.settings.requiresControlledVolume && this.#preparingPreviews > 0)) return;
    this.#queue.shift();
    this.#starting = true;
    const epoch = this.#epoch;
    if (this.managed) {
      let handle: ManagedPlaybackHandle | undefined;
      let ended = false;
      void this.managed.play(next.sound, next.settings.volumePercent, () => {
        if (epoch !== this.#epoch || ended) return;
        ended = true;
        if (handle) this.#managedActive.delete(handle);
        next.onResult?.('ended');
        this.#pump();
      }, () => epoch === this.#epoch).then((started) => {
        if (epoch !== this.#epoch) { started.stop(); return; }
        this.#starting = false;
        if (!ended) {
          handle = started;
          this.#managedActive.add(started);
          this.#scheduleNext(started.durationMs, next.settings);
        }
        this.#pump();
      }, () => {
        if (epoch !== this.#epoch) return;
        if (next.settings.requiresControlledVolume) this.#failControlled(next);
        else this.#startMedia(next);
      });
      return;
    }
    if (next.settings.requiresControlledVolume) {
      queueMicrotask(() => {
        if (epoch === this.#epoch) this.#failControlled(next);
      });
      return;
    }
    this.#startMedia(next);
  }

  #failControlled(next: Job): void {
    this.#starting = false;
    this.onError('controlled_volume_unavailable');
    next.onResult?.('failed');
    this.#pump();
  }

  #startMedia(next: Job): void {
    const audio = this.#unlocked.shift() ?? this.createAudio(next.sound.url);
    audio.src = next.sound.url;
    audio.volume = next.settings.volumePercent / 100;
    let finished = false;
    let awaitingMetadata = true;
    const onEnded = () => finish('ended');
    const onPlaybackError = () => finish('failed');
    const onMetadata = () => {
      if (finished || !awaitingMetadata) return;
      awaitingMetadata = false;
      this.#starting = false;
      const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1_000 : 1_000;
      this.#scheduleNext(durationMs, next.settings);
    };
    const finish = (result?: PlaybackResult) => {
      if (finished) return;
      finished = true;
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onPlaybackError);
      audio.removeEventListener('loadedmetadata', onMetadata);
      this.#active.delete(audio);
      if (awaitingMetadata) this.#starting = false;
      if (!result) return;
      if (result === 'ended') { audio.currentTime = 0; this.#unlocked.push(audio); }
      if (result === 'failed') this.onError();
      next.onResult?.(result);
      this.#pump();
    };
    this.#active.set(audio, () => { finish(); audio.pause(); audio.currentTime = 0; });
    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onPlaybackError, { once: true });
    audio.addEventListener('loadedmetadata', onMetadata, { once: true });
    audio.load();
    void audio.play().catch(onPlaybackError);
  }

  #scheduleNext(durationMs: number, settings: PlaybackSettings): void {
    const overlap = playbackOverlapPercent(settings);
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
