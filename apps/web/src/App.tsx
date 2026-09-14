import { type FormEvent, useEffect, useState } from 'react';
import type { UpdateWorkspaceSettings, WorkspaceSettings } from '@tiktok-helper/contracts';
import { DEFAULT_SETTINGS } from './settings-model.js';

export function App() {
  const [settings, setSettings] = useState<UpdateWorkspaceSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState('Загрузка настроек…');

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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus('Сохранение…');
    const response = await fetch('/api/workspaces/primary/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
    });
    if (!response.ok) { setStatus('Не удалось сохранить'); return; }
    const saved = await response.json() as WorkspaceSettings;
    setSettings(saved); setStatus(`Сохранено, версия ${saved.revision}`);
  }

  return <main>
    <p className="eyebrow">TikTokHelper</p>
    <h1>Настройки трансляции</h1>
    <p className="status" role="status">{status}</p>
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
      <button type="submit">Сохранить</button>
    </form>
  </main>;
}
