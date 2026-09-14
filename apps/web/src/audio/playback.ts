import type { PlaybackMode } from '@tiktok-helper/contracts';

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

interface Job { url: string; settings: PlaybackSettings }

const SILENT_AUDIO_DATA_URL = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export class SoundPlaybackQueue {
  readonly #queue: Job[] = [];
  readonly #active = new Set<AudioLike>();
  readonly #unlocked: AudioLike[] = [];
  #launchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly createAudio: (url: string) => AudioLike = (url) => new Audio(url),
    private readonly onError: () => void = () => undefined,
  ) {}

  get pending(): number { return this.#queue.length; }
  get active(): number { return this.#active.size; }

  async unlock(instances: number): Promise<void> {
    const count = Math.min(8, Math.max(1, Math.trunc(instances)));
    const attempts: Promise<void>[] = [];
    for (let index = this.#unlocked.length; index < count; index += 1) {
      const audio = this.createAudio(SILENT_AUDIO_DATA_URL);
      audio.volume = 0;
      audio.load();
      attempts.push(audio.play().then(() => {
        audio.pause(); audio.currentTime = 0; this.#unlocked.push(audio);
      }).catch(() => this.onError()));
    }
    await Promise.all(attempts);
  }

  enqueue(url: string, count: number, settings: PlaybackSettings): void {
    const safeCount = Math.min(5_000, Math.max(0, Math.trunc(count)));
    for (let index = 0; index < safeCount; index += 1) this.#queue.push({ url, settings });
    this.#pump();
  }

  stopAll(): void {
    this.#queue.length = 0;
    if (this.#launchTimer) clearTimeout(this.#launchTimer);
    this.#launchTimer = undefined;
    for (const audio of this.#active) { audio.pause(); audio.currentTime = 0; }
    this.#active.clear();
  }

  #pump(): void {
    if (this.#launchTimer || this.#queue.length === 0) return;
    const next = this.#queue[0];
    if (!next || this.#active.size >= next.settings.maxConcurrentSounds) return;
    this.#queue.shift();
    const audio = this.#unlocked.shift() ?? this.createAudio(next.url);
    audio.src = next.url;
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
      const overlap = next.settings.playbackMode === 'sequential'
        ? 0
        : next.settings.playbackMode === 'strong_overlap'
          ? Math.max(60, next.settings.overlapPercent)
          : next.settings.overlapPercent;
      const delay = Math.max(0, durationMs * (1 - overlap / 100));
      this.#launchTimer = setTimeout(() => { this.#launchTimer = undefined; this.#pump(); }, delay);
    }, { once: true });
    audio.load();
    void audio.play().catch(() => { this.onError(); finish(false); });
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
