import type { SpeechJob } from './policy.js';

export interface SpeechVoiceLike { name: string; lang: string }
export interface UtteranceLike {
  text: string; lang: string; volume: number; rate: number; voice: SpeechVoiceLike | null;
  onend: (() => void) | null; onerror: (() => void) | null;
}
export interface SpeechSynthesisLike {
  cancel(): void;
  getVoices(): SpeechVoiceLike[];
  speak(utterance: UtteranceLike): void;
}

export function browserSpeechSynthesisSupported(browserWindow: Window = window): boolean {
  return 'speechSynthesis' in browserWindow && 'SpeechSynthesisUtterance' in browserWindow;
}

export interface SpeechPlaybackPreferences { voiceName: string; rate: number; volume: number }
type SpeechResult = 'ended' | 'failed';
interface QueuedSpeech { job: SpeechJob; onResult?: (result: SpeechResult) => void }

export class SpeechPlaybackQueue {
  readonly #queue: QueuedSpeech[] = [];
  #active: QueuedSpeech | undefined;
  #warmup: UtteranceLike | undefined;
  #isPreview = false;
  #preview: { queue: SpeechPlaybackQueue; onInterrupted: () => void } | undefined;
  #preferences: SpeechPlaybackPreferences = { voiceName: '', rate: 1, volume: 1 };
  #volumeLimit = 1;

  constructor(
    private readonly synthesis: SpeechSynthesisLike = window.speechSynthesis as unknown as SpeechSynthesisLike,
    private readonly createUtterance: (text: string) => UtteranceLike = (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  ) {}

  get pending(): number { return this.#queue.length; }
  get active(): boolean { return this.#active !== undefined; }
  get voices(): SpeechVoiceLike[] { return this.synthesis.getVoices(); }
  get preferences(): Readonly<SpeechPlaybackPreferences> { return this.#preferences; }

  createPreviewQueue(onInterrupted: () => void = () => undefined): SpeechPlaybackQueue {
    this.#interruptPreview();
    if (this.#warmup && !this.active) {
      this.#warmup = undefined;
      this.synthesis.cancel();
    }
    const preview = new SpeechPlaybackQueue(this.synthesis, this.createUtterance);
    preview.#isPreview = true;
    preview.setPreferences(this.#preferences);
    preview.setVolumeLimit(this.#volumeLimit);
    this.#preview = { queue: preview, onInterrupted };
    return preview;
  }

  stopPreview(queue: SpeechPlaybackQueue): void {
    if (this.#preview?.queue === queue) this.#preview = undefined;
    queue.stop();
  }

  #interruptPreview(): void {
    const preview = this.#preview;
    if (!preview) return;
    this.stopPreview(preview.queue);
    preview.onInterrupted();
  }

  setPreferences(preferences: SpeechPlaybackPreferences): void {
    this.#preferences = {
      voiceName: preferences.voiceName,
      rate: Math.min(2, Math.max(.5, preferences.rate)),
      volume: Math.min(1, Math.max(0, preferences.volume)),
    };
  }

  setVolumeLimit(limit: number): void {
    this.#volumeLimit = Number.isFinite(limit) ? Math.min(1, Math.max(0, limit)) : 0;
  }

  unlock(): void {
    this.#interruptPreview();
    const utterance = this.createUtterance('\u00a0');
    utterance.volume = 0;
    const finish = () => { if (this.#warmup === utterance) this.#warmup = undefined; };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.#warmup = utterance;
    try { this.synthesis.speak(utterance); }
    catch (error) {
      finish();
      throw error;
    }
  }

  enqueue(job: SpeechJob, maximumQueueSize: number, onResult?: QueuedSpeech['onResult']): boolean {
    const limit = Math.min(100, Math.max(1, Math.trunc(maximumQueueSize)));
    let dropped: QueuedSpeech | undefined;
    if (this.#queue.length >= limit) {
      if (job.priority !== 'moderator') return false;
      const normalIndex = this.#queue.findIndex((item) => item.job.priority === 'normal');
      if (normalIndex < 0) return false;
      [dropped] = this.#queue.splice(normalIndex, 1);
    }
    const item = { job, onResult };
    if (job.priority === 'moderator') {
      const firstNormal = this.#queue.findIndex((queued) => queued.job.priority === 'normal');
      this.#queue.splice(firstNormal < 0 ? this.#queue.length : firstNormal, 0, item);
    } else this.#queue.push(item);
    dropped?.onResult?.('failed');
    this.#pump();
    return true;
  }

  stop(): void {
    this.#interruptPreview();
    // The browser cancels the whole synth, so an idle preview must leave it alone.
    const cancel = !this.#isPreview || this.active || this.#warmup !== undefined;
    this.#queue.length = 0;
    this.#active = undefined;
    this.#warmup = undefined;
    if (cancel) this.synthesis.cancel();
  }

  #pump(): void {
    if (this.#active) return;
    const item = this.#queue.shift();
    if (!item) return;
    this.#interruptPreview();
    const { job, onResult } = item;
    this.#active = item;
    const warmup = this.#warmup;
    const finish = (result: SpeechResult) => {
      if (this.#active !== item) return;
      this.#active = undefined;
      if (result === 'ended' && this.#warmup === warmup) this.#warmup = undefined;
      onResult?.(result);
      this.#pump();
    };
    try {
      const utterance = this.createUtterance(job.text);
      const requested = job.language.toLocaleLowerCase();
      const voices = this.voices;
      utterance.lang = job.language;
      utterance.rate = this.#preferences.rate;
      utterance.volume = Math.min(this.#preferences.volume, this.#volumeLimit);
      utterance.voice = voices.find((voice) => voice.name === this.#preferences.voiceName)
        ?? voices.find((voice) => voice.lang.toLocaleLowerCase() === requested)
        ?? voices.find((voice) => voice.lang.toLocaleLowerCase().split('-')[0] === requested.split('-')[0])
        ?? null;
      utterance.onend = () => finish('ended');
      utterance.onerror = () => finish('failed');
      this.synthesis.speak(utterance);
    } catch {
      finish('failed');
    }
  }
}
