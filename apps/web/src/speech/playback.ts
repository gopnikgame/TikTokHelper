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

export class SpeechPlaybackQueue {
  readonly #queue: SpeechJob[] = [];
  #active = false;
  #preferences: SpeechPlaybackPreferences = { voiceName: '', rate: 1, volume: 1 };

  constructor(
    private readonly synthesis: SpeechSynthesisLike = window.speechSynthesis as unknown as SpeechSynthesisLike,
    private readonly createUtterance: (text: string) => UtteranceLike = (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  ) {}

  get pending(): number { return this.#queue.length; }
  get voices(): SpeechVoiceLike[] { return this.synthesis.getVoices(); }

  setPreferences(preferences: SpeechPlaybackPreferences): void {
    this.#preferences = {
      voiceName: preferences.voiceName,
      rate: Math.min(2, Math.max(.5, preferences.rate)),
      volume: Math.min(1, Math.max(0, preferences.volume)),
    };
  }

  unlock(): void {
    const utterance = this.createUtterance('\u00a0');
    utterance.volume = 0;
    this.synthesis.speak(utterance);
  }

  enqueue(job: SpeechJob, maximumQueueSize: number): boolean {
    const limit = Math.min(100, Math.max(1, Math.trunc(maximumQueueSize)));
    if (this.#queue.length >= limit) {
      if (job.priority !== 'moderator') return false;
      const normalIndex = this.#queue.findIndex((item) => item.priority === 'normal');
      if (normalIndex < 0) return false;
      this.#queue.splice(normalIndex, 1);
    }
    if (job.priority === 'moderator') {
      const firstNormal = this.#queue.findIndex((item) => item.priority === 'normal');
      this.#queue.splice(firstNormal < 0 ? this.#queue.length : firstNormal, 0, job);
    } else this.#queue.push(job);
    this.#pump();
    return true;
  }

  stop(): void {
    this.#queue.length = 0;
    this.#active = false;
    this.synthesis.cancel();
  }

  #pump(): void {
    if (this.#active) return;
    const job = this.#queue.shift();
    if (!job) return;
    this.#active = true;
    const utterance = this.createUtterance(job.text);
    const requested = job.language.toLocaleLowerCase();
    utterance.lang = job.language;
    utterance.rate = this.#preferences.rate;
    utterance.volume = this.#preferences.volume;
    utterance.voice = this.synthesis.getVoices().find((voice) => voice.name === this.#preferences.voiceName)
      ?? this.synthesis.getVoices().find((voice) => voice.lang.toLocaleLowerCase() === requested)
      ?? this.synthesis.getVoices().find((voice) => voice.lang.toLocaleLowerCase().split('-')[0] === requested.split('-')[0])
      ?? null;
    const finish = () => { this.#active = false; this.#pump(); };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.synthesis.speak(utterance);
  }
}
