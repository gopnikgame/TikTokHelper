import { describe, expect, it, vi } from 'vitest';
import { SpeechPlaybackQueue, type SpeechSynthesisLike, type UtteranceLike } from './playback.js';

function setup() {
  const spoken: UtteranceLike[] = [];
  const synthesis: SpeechSynthesisLike = {
    cancel: vi.fn(), getVoices: () => [{ lang: 'en-US' }, { lang: 'ru-RU' }],
    speak: (utterance) => { spoken.push(utterance); },
  };
  const create = (text: string): UtteranceLike => ({
    text, lang: '', volume: 1, voice: null, onend: null, onerror: null,
  });
  return { queue: new SpeechPlaybackQueue(synthesis, create), synthesis, spoken };
}

describe('browser speech queue', () => {
  it('selects a language voice and advances after completion', () => {
    const { queue, spoken } = setup();
    queue.enqueue({ id: '1', text: 'Первое', language: 'ru', priority: 'normal' }, 5);
    queue.enqueue({ id: '2', text: 'Second', language: 'en-US', priority: 'normal' }, 5);
    expect(spoken[0]).toMatchObject({ text: 'Первое', voice: { lang: 'ru-RU' } });
    spoken[0]!.onend?.();
    expect(spoken[1]).toMatchObject({ text: 'Second', voice: { lang: 'en-US' } });
  });

  it('bounds pending work and lets a moderator replace a normal pending message', () => {
    const { queue, spoken } = setup();
    expect(queue.enqueue({ id: 'active', text: 'Active', language: 'ru', priority: 'normal' }, 2)).toBe(true);
    expect(queue.enqueue({ id: 'normal-1', text: 'Normal 1', language: 'ru', priority: 'normal' }, 2)).toBe(true);
    expect(queue.enqueue({ id: 'normal-2', text: 'Normal 2', language: 'ru', priority: 'normal' }, 2)).toBe(true);
    expect(queue.enqueue({ id: 'dropped', text: 'Dropped', language: 'ru', priority: 'normal' }, 2)).toBe(false);
    expect(queue.enqueue({ id: 'moderator', text: 'Moderator', language: 'ru', priority: 'moderator' }, 2)).toBe(true);
    spoken[0]!.onend?.();
    expect(spoken[1]?.text).toBe('Moderator');
  });

  it('clears pending and active speech', () => {
    const { queue, synthesis } = setup();
    queue.enqueue({ id: '1', text: 'Text', language: 'ru', priority: 'normal' }, 5);
    queue.stop();
    expect(queue.pending).toBe(0);
    expect(synthesis.cancel).toHaveBeenCalledOnce();
  });
});
