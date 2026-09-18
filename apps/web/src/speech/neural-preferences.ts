import { NEURAL_VOICE_PACKAGES, type NeuralVoicePackage } from './neural-assets.js';

export type NeuralLanguageMode = 'auto' | 'ru-RU' | 'en-US';

export interface NeuralTtsPreferences {
  languageMode: NeuralLanguageMode;
  ruVoiceId: NeuralVoicePackage['id'];
  enVoiceId: NeuralVoicePackage['id'];
  speed: number;
  volume: number;
  testText: string;
}

export const DEFAULT_NEURAL_TTS_PREFERENCES: NeuralTtsPreferences = {
  languageMode: 'auto',
  ruVoiceId: 'ru-RU-irina-medium-int8',
  enVoiceId: 'en-US-lessac-medium-int8',
  speed: 1,
  volume: 1,
  testText: 'Ваше сообщение теперь будет прочитано вслух.',
};

const STORAGE_KEY = 'tiktok-helper.neural-tts-preferences.v1';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function parseNeuralTtsPreferences(value: unknown): NeuralTtsPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_NEURAL_TTS_PREFERENCES };
  const candidate = value as Partial<NeuralTtsPreferences>;
  const languageMode = candidate.languageMode === 'ru-RU' || candidate.languageMode === 'en-US' ? candidate.languageMode : 'auto';
  const ruVoiceId = NEURAL_VOICE_PACKAGES.some((voice) => voice.language === 'ru-RU' && voice.id === candidate.ruVoiceId)
    ? candidate.ruVoiceId! : DEFAULT_NEURAL_TTS_PREFERENCES.ruVoiceId;
  const enVoiceId = NEURAL_VOICE_PACKAGES.some((voice) => voice.language === 'en-US' && voice.id === candidate.enVoiceId)
    ? candidate.enVoiceId! : DEFAULT_NEURAL_TTS_PREFERENCES.enVoiceId;
  const text = typeof candidate.testText === 'string' ? candidate.testText.trim().slice(0, 240) : '';
  return {
    languageMode,
    ruVoiceId,
    enVoiceId,
    speed: Number.isFinite(candidate.speed) ? clamp(candidate.speed!, 0.7, 1.3) : 1,
    volume: Number.isFinite(candidate.volume) ? clamp(candidate.volume!, 0, 1) : 1,
    testText: text || DEFAULT_NEURAL_TTS_PREFERENCES.testText,
  };
}

export function loadNeuralTtsPreferences(): NeuralTtsPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_NEURAL_TTS_PREFERENCES };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? parseNeuralTtsPreferences(JSON.parse(stored)) : { ...DEFAULT_NEURAL_TTS_PREFERENCES };
  } catch {
    return { ...DEFAULT_NEURAL_TTS_PREFERENCES };
  }
}

export function saveNeuralTtsPreferences(preferences: NeuralTtsPreferences): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parseNeuralTtsPreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}

export function selectNeuralVoice(preferences: NeuralTtsPreferences, text: string): NeuralVoicePackage {
  const language = preferences.languageMode === 'auto'
    ? (/\p{Script=Cyrillic}/u.test(text) ? 'ru-RU' : 'en-US')
    : preferences.languageMode;
  const voiceId = language === 'ru-RU' ? preferences.ruVoiceId : preferences.enVoiceId;
  return NEURAL_VOICE_PACKAGES.find((voice) => voice.id === voiceId && voice.language === language)
    ?? NEURAL_VOICE_PACKAGES.find((voice) => voice.language === language)
    ?? NEURAL_VOICE_PACKAGES[0]!;
}
