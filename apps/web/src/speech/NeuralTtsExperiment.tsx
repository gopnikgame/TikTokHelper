import { useEffect, useState } from 'react';
import {
  formatPackageSize, NEURAL_VOICE_PACKAGES, NeuralAssetCache, NeuralAssetError, packageByteSize,
  type NeuralAssetState, type NeuralVoicePackage,
} from './neural-assets.js';
import { NeuralTtsWorkerClient, type NeuralBenchmarkResult } from './neural-worker.js';

type PackageStates = Record<NeuralVoicePackage['id'], NeuralAssetState | 'checking' | 'downloading' | 'error'>;
const INITIAL_STATES: PackageStates = { 'ru-RU-irina-medium-int8': 'checking', 'en-US-lessac-medium-int8': 'checking' };
const STATE_LABELS: Record<PackageStates[NeuralVoicePackage['id']], string> = {
  checking: 'Проверяем…', downloading: 'Загружаем и проверяем…', ready: 'Готово в этом браузере',
  missing: 'Не загружено', unsupported: 'Браузер не поддерживает кэш', error: 'Ошибка проверки',
};

export function NeuralTtsExperiment({ liveActive }: { liveActive: boolean }) {
  const [assetCache] = useState(() => new NeuralAssetCache());
  const [states, setStates] = useState<PackageStates>(INITIAL_STATES);
  const [message, setMessage] = useState('Модели загружаются только по вашей команде и не содержат данных пользователей.');
  const [benchmarks, setBenchmarks] = useState<Partial<Record<NeuralVoicePackage['id'], NeuralBenchmarkResult>>>({});
  const [benchmarking, setBenchmarking] = useState<NeuralVoicePackage['id'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(NEURAL_VOICE_PACKAGES.map(async (asset) => [asset.id, await assetCache.state(asset)] as const))
      .then((entries) => { if (!cancelled) setStates(Object.fromEntries(entries) as PackageStates); });
    return () => { cancelled = true; };
  }, [assetCache]);

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

  async function benchmark(asset: NeuralVoicePackage) {
    setBenchmarking(asset.id); setMessage(`Проверяем скорость ${asset.displayName}…`);
    const text = asset.language === 'ru-RU' ? 'Ваше сообщение теперь будет прочитано вслух.' : 'Your message will now be read aloud.';
    try {
      const result = await new NeuralTtsWorkerClient().benchmark(asset, text);
      setBenchmarks((current) => ({ ...current, [asset.id]: result }));
      setMessage(`${asset.displayName}: генерация ${(result.generationMs / 1000).toFixed(2)} с, RTF ${result.rtf.toFixed(2)}.`);
    } catch { setMessage('Не удалось запустить Worker. Рабочая озвучка не изменена.'); }
    finally { setBenchmarking(null); }
  }

  return <details className="neural-tts-panel">
    <summary><span><b>Нейросетевая озвучка</b><small>Эксперимент для администра · RU / EN</small></span><span aria-hidden="true">Развернуть</span></summary>
    <div className="neural-tts-content">
      <p className="neural-tts-warning" role="status">{liveActive ? 'Загрузка заблокирована: сначала остановите эфир.' : message}</p>
      <ul>{NEURAL_VOICE_PACKAGES.map((asset) => {
        const state = states[asset.id];
        const busy = state === 'checking' || state === 'downloading';
        const result = benchmarks[asset.id];
        return <li key={asset.id}><div><strong>{asset.displayName}</strong><span>{asset.language} · {formatPackageSize(packageByteSize(asset))}</span><small>{STATE_LABELS[state]}{result ? ` · RTF ${result.rtf.toFixed(2)}` : ''}</small></div><div className="actions">{state === 'ready' ? <><button type="button" className="secondary" disabled={liveActive || benchmarking !== null} onClick={() => void benchmark(asset)}>{benchmarking === asset.id ? 'Проверяем…' : 'Проверить скорость'}</button><button type="button" className="danger" disabled={liveActive || benchmarking !== null} onClick={() => void remove(asset)}>Удалить из браузера</button></> : <button type="button" className="secondary" disabled={liveActive || busy || state === 'unsupported'} onClick={() => void download(asset)}>{state === 'downloading' ? 'Загружаем…' : 'Скачать и проверить'}</button>}</div></li>;
      })}</ul>
      <small>Пакеты хранятся в отдельном кэше этого браузера. Авторизация, чат и настройки туда не попадают.</small>
    </div>
  </details>;
}
