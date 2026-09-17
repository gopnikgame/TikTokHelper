import type { SpeechJob } from './policy.js';

export interface SpeechVoiceLike { lang: string }
export interface UtteranceLike {
  text: string; lang: string; volume: number; voice: SpeechVoiceLike | null;
  onend: (() => void) | null; onerror: (() => void) | null;
}
export interface SpeechSynthesisLike {
  cancel(): void;
  getVoices(): SpeechVoiceLike[];
  speak(utterance: UtteranceLike): void;
}

export class SpeechPlaybackQueue {
  readonly #queue: SpeechJob[] = [];
  #active = false;

  constructor(
    private readonly synthesis: SpeechSynthesisLike = window.speechSynthesis as unknown as SpeechSynthesisLike,
    private readonly createUtterance: (text: string) => UtteranceLike = (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  ) {}

  get pending(): number { return this.#queue.length; }

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
    utterance.voice = this.synthesis.getVoices().find((voice) => voice.lang.toLocaleLowerCase() === requested)
      ?? this.synthesis.getVoices().find((voice) => voice.lang.toLocaleLowerCase().split('-')[0] === requested.split('-')[0])
      ?? null;
    const finish = () => { this.#active = false; this.#pump(); };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.synthesis.speak(utterance);
  }
}
