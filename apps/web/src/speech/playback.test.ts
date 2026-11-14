import { describe, expect, it, vi } from 'vitest';
import { browserSpeechSynthesisSupported, SpeechPlaybackQueue, type SpeechSynthesisLike, type UtteranceLike } from './playback.js';

function setup() {
  const spoken: UtteranceLike[] = [];
  const synthesis: SpeechSynthesisLike = {
    cancel: vi.fn(), getVoices: () => [{ name: 'English', lang: 'en-US' }, { name: 'Russian', lang: 'ru-RU' }],
    speak: (utterance) => { spoken.push(utterance); },
  };
  const create = (text: string): UtteranceLike => ({
    text, lang: '', volume: 1, rate: 1, voice: null, onend: null, onerror: null,
  });
  return { queue: new SpeechPlaybackQueue(synthesis, create), synthesis, spoken };
}

describe('browser speech queue', () => {
  it('detects support by capability instead of browser name', () => {
    expect(browserSpeechSynthesisSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} } as unknown as Window)).toBe(true);
    expect(browserSpeechSynthesisSupported({ speechSynthesis: {} } as unknown as Window)).toBe(false);
  });

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

  it('applies device-specific voice, speed, and volume preferences', () => {
    const { queue, spoken } = setup();
    queue.setPreferences({ voiceName: 'English', rate: 1.4, volume: .6 });
    queue.enqueue({ id: '1', text: 'Тест', language: 'ru-RU', priority: 'normal' }, 5);
    expect(spoken[0]).toMatchObject({ voice: { name: 'English' }, rate: 1.4, volume: .6 });
  });

  it('snapshots device settings for preview and does not cancel the synth while idle', () => {
    const { queue, synthesis, spoken } = setup();
    queue.setPreferences({ voiceName: 'Russian', rate: 1.4, volume: .6 });
    const preview = queue.createPreviewQueue();
    queue.setPreferences({ voiceName: 'English', rate: 2, volume: 0 });
    const onResult = vi.fn();

    preview.stop();
    expect(synthesis.cancel).not.toHaveBeenCalled();
    expect(preview.preferences).toEqual({ voiceName: 'Russian', rate: 1.4, volume: .6 });
    preview.enqueue({ id: 'preview', text: 'Проверка', language: 'ru', priority: 'normal' }, 5, onResult);
    expect(preview.active).toBe(true);
    expect(spoken[0]).toMatchObject({ voice: { name: 'Russian' }, rate: 1.4, volume: .6 });
    spoken[0]!.onend?.();
    expect(preview.active).toBe(false);
    preview.stop();
    expect(synthesis.cancel).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('allows a check when silent speech preparation never finishes', () => {
    const { queue, synthesis, spoken } = setup();
    queue.unlock();
    expect(queue.active).toBe(false);
    const preview = queue.createPreviewQueue();
    expect(synthesis.cancel).toHaveBeenCalledOnce();

    preview.enqueue({ id: 'preview', text: 'Проверка', language: 'ru', priority: 'normal' }, 5);
    spoken[0]!.onend?.();
    expect(preview.active).toBe(true);
    expect(spoken[1]?.text).toBe('Проверка');
  });

  it('ignores late or repeated utterance events and reports the current result once', () => {
    const { queue, synthesis, spoken } = setup();
    const preview = queue.createPreviewQueue();
    const obsolete = vi.fn();
    const failure = vi.fn();
    const success = vi.fn();
    preview.enqueue({ id: 'old', text: 'Old', language: 'en', priority: 'normal' }, 5, obsolete);
    preview.stop();
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    preview.enqueue({ id: 'new', text: 'New', language: 'en', priority: 'normal' }, 5, failure);
    preview.enqueue({ id: 'next', text: 'Next', language: 'en', priority: 'normal' }, 5, success);
    spoken[0]!.onend?.();
    spoken[0]!.onerror?.();
    expect(obsolete).not.toHaveBeenCalled();
    expect(spoken).toHaveLength(2);

    spoken[1]!.onerror?.();
    spoken[1]!.onend?.();
    expect(failure).toHaveBeenCalledExactlyOnceWith('failed');
    expect(spoken).toHaveLength(3);
    spoken[2]!.onend?.();
    expect(success).toHaveBeenCalledExactlyOnceWith('ended');
  });
});
