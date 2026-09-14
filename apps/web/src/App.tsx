import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { UpdateWorkspaceSettings, WorkspaceSettings } from '@tiktok-helper/contracts';
import { DEFAULT_SETTINGS } from './settings-model.js';
import {
  createRealtimeClient, type RealtimeClient, type RealtimeViewState,
} from './realtime/client.js';

const INITIAL_REALTIME_STATE: RealtimeViewState = {
  connectionState: 'stopped', events: [], generation: 0, lastSequence: 0,
  isTransportConnected: false,
};

export function App() {
  const [settings, setSettings] = useState<UpdateWorkspaceSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState('Загрузка настроек…');
  const [realtime, setRealtime] = useState<RealtimeViewState>(INITIAL_REALTIME_STATE);
  const realtimeClient = useRef<RealtimeClient | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/workspaces/primary/settings', { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<WorkspaceSettings> : null)
      .then((loaded) => {
        if (loaded) setSettings(loaded);
        setStatus(loaded ? `Загружено, версия ${loaded.revision}` : 'Новые настройки');
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStatus('Сервер настроек недоступен');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const client = createRealtimeClient('primary', setRealtime);
    realtimeClient.current = client;
    return () => { realtimeClient.current = null; client.close(); };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus('Сохранение…');
    const response = await fetch('/api/workspaces/primary/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
    });
    if (!response.ok) { setStatus('Не удалось сохранить'); return; }
    const saved = await response.json() as WorkspaceSettings;
    setSettings(saved); setStatus(`Сохранено, версия ${saved.revision}`);
  }

  async function connectLive() {
    const username = settings.tiktokUsername.trim();
    if (!username) { setStatus('Сначала введите TikTok ID'); return; }
    setStatus('Подключение к трансляции…');
    const result = await realtimeClient.current?.connectLive(username);
    setStatus(result?.ok ? 'Команда подключения отправлена' : 'Не удалось подключиться');
  }

  async function disconnectLive() {
    const result = await realtimeClient.current?.disconnectLive();
    setStatus(result?.ok ? 'Трансляция остановлена' : 'Не удалось остановить подключение');
  }

  return <main>
    <p className="eyebrow">TikTokHelper</p>
    <h1>Настройки трансляции</h1>
    <p className="status" role="status">{status}</p>
    <section className="live-status" aria-label="Состояние трансляции">
      <span>Сервер: {realtime.isTransportConnected ? 'подключён' : 'нет связи'}</span>
      <span>Эфир: {realtime.connectionState}</span>
      <span>Событий: {realtime.events.length}</span>
    </section>
    <form onSubmit={(event) => void save(event)}>
      <label>TikTok ID
        <input required value={settings.tiktokUsername} placeholder="@username"
          onChange={(event) => setSettings((current) => ({ ...current, tiktokUsername: event.target.value }))} />
      </label>
      <label>Режим серии
        <select value={settings.playbackMode}
          onChange={(event) => setSettings((current) => ({ ...current, playbackMode: event.target.value as UpdateWorkspaceSettings['playbackMode'] }))}>
          <option value="controlled_overlap">Умеренное наложение</option>
          <option value="sequential">Последовательно</option>
          <option value="strong_overlap">Сильное наложение</option>
        </select>
      </label>
      <label>Наложение: {settings.overlapPercent}%
        <input type="range" min="0" max="100" value={settings.overlapPercent}
          onChange={(event) => setSettings((current) => ({ ...current, overlapPercent: event.target.valueAsNumber }))} />
      </label>
      <label>Одновременно звуков
        <input type="number" min="1" max="32" value={settings.maxConcurrentSounds}
          onChange={(event) => setSettings((current) => ({ ...current, maxConcurrentSounds: event.target.valueAsNumber }))} />
      </label>
      <label>Громкость: {settings.volumePercent}%
        <input type="range" min="0" max="100" value={settings.volumePercent}
          onChange={(event) => setSettings((current) => ({ ...current, volumePercent: event.target.valueAsNumber }))} />
      </label>
      <div className="actions">
        <button type="submit">Сохранить</button>
        <button type="button" onClick={() => void connectLive()}>Подключить эфир</button>
        <button type="button" className="secondary" onClick={() => void disconnectLive()}>Остановить</button>
      </div>
    </form>
    <footer><a href="https://github.com/gopnikgame/TikTokHelper_ASP.NET/tree/rewrite/typescript">Исходный код сервера</a></footer>
  </main>;
}
