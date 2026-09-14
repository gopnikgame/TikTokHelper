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
  volume: number;
  addEventListener(type: 'ended' | 'error' | 'loadedmetadata', listener: () => void, options?: { once?: boolean }): void;
  load(): void;
  pause(): void;
  play(): Promise<void>;
}

interface Job { url: string; settings: PlaybackSettings }

export class SoundPlaybackQueue {
  readonly #queue: Job[] = [];
  readonly #active = new Set<AudioLike>();
  #launchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly createAudio: (url: string) => AudioLike = (url) => new Audio(url),
    private readonly onError: () => void = () => undefined,
  ) {}

  get pending(): number { return this.#queue.length; }
  get active(): number { return this.#active.size; }

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
    const audio = this.createAudio(next.url);
    audio.volume = next.settings.volumePercent / 100;
    this.#active.add(audio);
    let finished = false;
    const finish = () => { if (finished) return; finished = true; this.#active.delete(audio); this.#pump(); };
    audio.addEventListener('ended', finish, { once: true });
    audio.addEventListener('error', () => { this.onError(); finish(); }, { once: true });
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
    void audio.play().catch(() => { this.onError(); finish(); });
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
