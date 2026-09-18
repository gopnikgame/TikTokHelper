import { describe, expect, it } from 'vitest';
import { DEFAULT_NEURAL_TTS_PREFERENCES, parseNeuralTtsPreferences, selectNeuralVoice } from './neural-preferences.js';

describe('neural TTS preferences', () => {
  it('uses safe defaults for malformed data', () => {
    expect(parseNeuralTtsPreferences(null)).toEqual(DEFAULT_NEURAL_TTS_PREFERENCES);
  });

  it('clamps persisted controls and limits the test text', () => {
    const parsed = parseNeuralTtsPreferences({ languageMode: 'ru-RU', speed: 9, volume: -2, testText: `  ${'я'.repeat(300)}  ` });
    expect(parsed.languageMode).toBe('ru-RU');
    expect(parsed.speed).toBe(1.3);
    expect(parsed.volume).toBe(0);
    expect(parsed.testText).toHaveLength(240);
  });

  it('selects a voice from the explicit language or the text script', () => {
    expect(selectNeuralVoice(DEFAULT_NEURAL_TTS_PREFERENCES, 'Привет').language).toBe('ru-RU');
    expect(selectNeuralVoice(DEFAULT_NEURAL_TTS_PREFERENCES, 'Hello').language).toBe('en-US');
    expect(selectNeuralVoice({ ...DEFAULT_NEURAL_TTS_PREFERENCES, languageMode: 'en-US' }, 'Привет').language).toBe('en-US');
  });

  it('keeps valid per-language selections and rejects a voice from another language', () => {
    const selected = parseNeuralTtsPreferences({
      ruVoiceId: 'ru-RU-ruslan-medium-int8', enVoiceId: 'en-US-amy-medium-int8',
    });
    expect(selected.ruVoiceId).toBe('ru-RU-ruslan-medium-int8');
    expect(selected.enVoiceId).toBe('en-US-amy-medium-int8');
    expect(parseNeuralTtsPreferences({ ruVoiceId: 'en-US-amy-medium-int8' }).ruVoiceId)
      .toBe(DEFAULT_NEURAL_TTS_PREFERENCES.ruVoiceId);
  });
});
