import { useEffect, useState } from 'react';
import {
  formatPackageSize, NEURAL_VOICE_PACKAGES, NeuralAssetCache,
  type NeuralAssetState, type NeuralVoicePackage,
} from './neural-assets.js';

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
      await assetCache.download(asset);
      setStates((current) => ({ ...current, [asset.id]: 'ready' }));
      setMessage(`Пакет ${asset.displayName} проверен по SHA-256 и сохранён в этом браузере.`);
    } catch (error) {
      setStates((current) => ({ ...current, [asset.id]: 'error' }));
      setMessage(error instanceof Error && error.message === 'TTS package is not published'
        ? 'Пакеты ещё не опубликованы на сервере. Рабочая озвучка не изменена.'
        : 'Не удалось скачать и проверить пакет. Кэш не изменён.');
    }
  }

  async function remove(asset: NeuralVoicePackage) {
    await assetCache.remove(asset);
    setStates((current) => ({ ...current, [asset.id]: 'missing' }));
    setMessage(`Пакет ${asset.displayName} удалён только из этого браузера.`);
  }

  return <details className="neural-tts-panel">
    <summary><span><b>Нейросетевая озвучка</b><small>Эксперимент для администра · RU / EN</small></span><span aria-hidden="true">Развернуть</span></summary>
    <div className="neural-tts-content">
      <p className="neural-tts-warning" role="status">{liveActive ? 'Загрузка заблокирована: сначала остановите эфир.' : message}</p>
      <ul>{NEURAL_VOICE_PACKAGES.map((asset) => {
        const state = states[asset.id];
        const busy = state === 'checking' || state === 'downloading';
        return <li key={asset.id}><div><strong>{asset.displayName}</strong><span>{asset.language} · {formatPackageSize(asset.byteSize)}</span><small>{STATE_LABELS[state]}</small></div><div className="actions">{state === 'ready' ? <button type="button" className="danger" disabled={liveActive} onClick={() => void remove(asset)}>Удалить из браузера</button> : <button type="button" className="secondary" disabled={liveActive || busy || state === 'unsupported'} onClick={() => void download(asset)}>{state === 'downloading' ? 'Загружаем…' : 'Скачать и проверить'}</button>}</div></li>;
      })}</ul>
      <small>Пакеты хранятся в отдельном кэше этого браузера. Авторизация, чат и настройки туда не попадают.</small>
    </div>
  </details>;
}
