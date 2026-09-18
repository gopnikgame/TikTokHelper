import { useEffect, useRef, useState } from 'react';
import {
  formatPackageSize, NEURAL_VOICE_PACKAGES, NeuralAssetCache, NeuralAssetError, packageByteSize,
  type NeuralAssetState, type NeuralVoicePackage,
} from './neural-assets.js';
import { NeuralTtsWorkerClient, type NeuralBenchmarkResult } from './neural-worker.js';
import {
  DEFAULT_NEURAL_TTS_PREFERENCES, loadNeuralTtsPreferences, saveNeuralTtsPreferences, selectNeuralVoice,
  type NeuralLanguageMode,
} from './neural-preferences.js';

type PackageStates = Record<NeuralVoicePackage['id'], NeuralAssetState | 'checking' | 'downloading' | 'error'>;
const INITIAL_STATES: PackageStates = { 'ru-RU-irina-medium-int8': 'checking', 'en-US-lessac-medium-int8': 'checking' };
const STATE_LABELS: Record<PackageStates[NeuralVoicePackage['id']], string> = {
  checking: 'Проверяем…', downloading: 'Загружаем и проверяем…', ready: 'Готово в этом браузере',
  missing: 'Не загружено', unsupported: 'Браузер не поддерживает кэш', error: 'Ошибка проверки',
};

async function ensureAudioRunning(context: AudioContext): Promise<void> {
  if (context.state === 'suspended') await context.resume();
  if (context.state !== 'running') throw new Error('Web Audio is unavailable');
}

function primeAudioContext(context: AudioContext): void {
  const buffer = context.createBuffer(1, 1, context.sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer; source.connect(context.destination); source.start();
}

export function NeuralTtsExperiment({ liveActive }: { liveActive: boolean }) {
  const [assetCache] = useState(() => new NeuralAssetCache());
  const [states, setStates] = useState<PackageStates>(INITIAL_STATES);
  const [message, setMessage] = useState('Модели загружаются только по вашей команде и не содержат данных пользователей.');
  const [benchmarks, setBenchmarks] = useState<Partial<Record<NeuralVoicePackage['id'], NeuralBenchmarkResult>>>({});
  const [benchmarking, setBenchmarking] = useState<NeuralVoicePackage['id'] | null>(null);
  const [preferences, setPreferences] = useState(loadNeuralTtsPreferences);
  const audioContext = useRef<AudioContext | null>(null);
  const activeSource = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(NEURAL_VOICE_PACKAGES.map(async (asset) => [asset.id, await assetCache.state(asset)] as const))
      .then((entries) => { if (!cancelled) setStates(Object.fromEntries(entries) as PackageStates); });
    return () => { cancelled = true; };
  }, [assetCache]);

  useEffect(() => () => {
    try { activeSource.current?.stop(); } catch { /* playback already ended */ }
    void audioContext.current?.close();
  }, []);

  useEffect(() => { saveNeuralTtsPreferences(preferences); }, [preferences]);

  async function download(asset: NeuralVoicePackage) {
    setStates((current) => ({ ...current, [asset.id]: 'downloading' }));
    setMessage(`Загружаем ${asset.displayName}. Не закрывайте эту вкладку.`);
    try {
      await assetCache.download(asset, (stage, fileName, index, total) => {
        const action = stage === 'download' ? 'Скачиваем' : stage === 'verify' ? 'Проверяем' : 'Сохраняем';
        setMessage(`${action}: ${fileName} (${index}/${total}).`);
      });
      setStates((current) => ({ ...current, [asset.id]: 'ready' }));
      setMessage(`Пакет ${asset.displayName} проверен по SHA-256 и сохранён в этом браузере.`);
    } catch (error) {
      setStates((current) => ({ ...current, [asset.id]: 'error' }));
      setMessage(error instanceof Error && error.message.includes('TTS package is not published')
        ? 'Пакеты ещё не опубликованы на сервере. Рабочая озвучка не изменена.'
        : error instanceof NeuralAssetError
          ? `Сбой на этапе «${error.stage}», файл ${error.fileName}. Причина: ${error.reason}. Неполный пакет удалён.`
          : 'Не удалось скачать и проверить пакет. Неполный пакет удалён.');
    }
  }

  async function remove(asset: NeuralVoicePackage) {
    await assetCache.remove(asset);
    setStates((current) => ({ ...current, [asset.id]: 'missing' }));
    setMessage(`Пакет ${asset.displayName} удалён только из этого браузера.`);
  }

  async function preview() {
    const text = preferences.testText.trim();
    if (!text) { setMessage('Введите тестовую фразу.'); return; }
    const asset = selectNeuralVoice(preferences.languageMode, text);
    if (states[asset.id] !== 'ready') { setMessage(`Сначала скачайте пакет ${asset.displayName}.`); return; }
    setBenchmarking(asset.id); setMessage(`Готовим тестовую фразу ${asset.displayName}…`);
    try {
      audioContext.current ??= new AudioContext();
      const context = audioContext.current;
      primeAudioContext(context);
      await ensureAudioRunning(context);
      const { samples, sampleRate, ...result } = await new NeuralTtsWorkerClient().synthesize(asset, text, preferences.speed);
      if (result.signalPeak < 0.00001) throw new Error('Generated PCM is silent');
      await ensureAudioRunning(context);
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      try { activeSource.current?.stop(); } catch { /* playback already ended */ }
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = preferences.volume;
      source.buffer = buffer; source.connect(gain); gain.connect(context.destination);
      source.addEventListener('ended', () => { if (activeSource.current === source) activeSource.current = null; }, { once: true });
      activeSource.current = source; source.start();
      setBenchmarks((current) => ({ ...current, [asset.id]: result }));
      setMessage(`${asset.displayName}: воспроизводим ${result.audioSeconds.toFixed(1)} с при ${preferences.speed.toFixed(1)}× и ${Math.round(preferences.volume * 100)}%; генерация ${(result.generationMs / 1000).toFixed(2)} с, RTF ${result.rtf.toFixed(2)}.`);
    } catch { setMessage('Не удалось сгенерировать или воспроизвести тестовую фразу. Рабочая озвучка не изменена.'); }
    finally { setBenchmarking(null); }
  }

  return <details className="neural-tts-panel">
    <summary><span><b>Нейросетевая озвучка</b><small>Эксперимент для администра · RU / EN</small></span><span aria-hidden="true">Развернуть</span></summary>
    <div className="neural-tts-content">
      <p className="neural-tts-warning" role="status">{liveActive ? 'Загрузка заблокирована: сначала остановите эфир.' : message}</p>
      <section className="neural-tts-controls" aria-labelledby="neural-tts-controls-heading">
        <h2 id="neural-tts-controls-heading">Настройки теста</h2>
        <label>Язык и голос<select value={preferences.languageMode} onChange={(event) => setPreferences((current) => ({ ...current, languageMode: event.target.value as NeuralLanguageMode }))}><option value="auto">Автоматически по тексту</option><option value="ru-RU">Русский · Ирина</option><option value="en-US">English · Lessac</option></select></label>
        <div className="two-fields"><label>Скорость <output>{preferences.speed.toFixed(1)}×</output><input type="range" min="0.7" max="1.3" step="0.1" value={preferences.speed} onChange={(event) => setPreferences((current) => ({ ...current, speed: event.target.valueAsNumber }))} /></label><label>Громкость <output>{Math.round(preferences.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={preferences.volume} onChange={(event) => setPreferences((current) => ({ ...current, volume: event.target.valueAsNumber }))} /></label></div>
        <label>Тестовая фраза<textarea rows={3} maxLength={240} value={preferences.testText} onChange={(event) => setPreferences((current) => ({ ...current, testText: event.target.value }))} /><small>{preferences.testText.length}/240 символов</small></label>
        <div className="actions"><button type="button" disabled={liveActive || benchmarking !== null || !preferences.testText.trim()} onClick={() => void preview()}>{benchmarking ? 'Генерируем…' : 'Прослушать с настройками'}</button><button type="button" className="quiet" disabled={benchmarking !== null} onClick={() => setPreferences({ ...DEFAULT_NEURAL_TTS_PREFERENCES })}>Сбросить</button></div>
        <small>Эти параметры сохранены только в этом браузере.</small>
      </section>
      <ul>{NEURAL_VOICE_PACKAGES.map((asset) => {
        const state = states[asset.id];
        const busy = state === 'checking' || state === 'downloading';
        const result = benchmarks[asset.id];
        return <li key={asset.id}><div><strong>{asset.displayName}</strong><span>{asset.language} · {formatPackageSize(packageByteSize(asset))}</span><small>{STATE_LABELS[state]}{result ? ` · RTF ${result.rtf.toFixed(2)}` : ''}</small></div><div className="actions">{state === 'ready' ? <button type="button" className="danger" disabled={liveActive || benchmarking !== null} onClick={() => void remove(asset)}>Удалить из браузера</button> : <button type="button" className="secondary" disabled={liveActive || busy || state === 'unsupported'} onClick={() => void download(asset)}>{state === 'downloading' ? 'Загружаем…' : 'Скачать и проверить'}</button>}</div></li>;
      })}</ul>
      <small>Пакеты хранятся в отдельном кэше этого браузера. Авторизация, чат и настройки туда не попадают.</small>
    </div>
  </details>;
}
