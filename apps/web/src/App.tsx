import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { GiftEvent, GiftSoundMapping, ObservedGift, RecentChannel, SoundAsset, UpdateWorkspaceSettings, WorkspaceSettings } from '@tiktok-helper/contracts';
import { AudioOwnership, SoundPlaybackQueue } from './audio/playback.js';
import { operatorEventCount } from './event-model.js';
import { createRealtimeClient, type RealtimeClient, type RealtimeViewState } from './realtime/client.js';
import { DEFAULT_SETTINGS } from './settings-model.js';
import { chatContentParts } from './chat-content.js';

const WORKSPACE_ID = 'primary';
const INITIAL_REALTIME_STATE: RealtimeViewState = { connectionState: 'stopped', events: [], generation: 0, lastSequence: 0, isTransportConnected: false };
const STATE_COPY = { stopped: 'Остановлен', connecting: 'Подключаемся…', live: 'В эфире', reconnecting: 'Восстанавливаем связь…', offline: 'Аккаунт сейчас не в эфире', failed: 'Не удалось подключиться' } as const;

export function App() {
  const [settings, setSettings] = useState<UpdateWorkspaceSettings>(DEFAULT_SETTINGS);
  const [notice, setNotice] = useState('Загружаем рабочее место…');
  const [realtime, setRealtime] = useState<RealtimeViewState>(INITIAL_REALTIME_STATE);
  const [sounds, setSounds] = useState<SoundAsset[]>([]);
  const [mappings, setMappings] = useState<GiftSoundMapping[]>([]);
  const [gifts, setGifts] = useState<ObservedGift[]>([]);
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [giftId, setGiftId] = useState('');
  const [selectedSoundId, setSelectedSoundId] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [followChat, setFollowChat] = useState(true);
  const realtimeClient = useRef<RealtimeClient | null>(null);
  const chatFeed = useRef<HTMLUListElement | null>(null);
  const mappingInput = useRef<HTMLSelectElement | null>(null);
  const lastPlayedSequence = useRef(0);
  const player = useRef(new SoundPlaybackQueue(undefined, () => setNotice('Браузер не смог воспроизвести звук')));
  const ownership = useRef<AudioOwnership | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/workspaces/${WORKSPACE_ID}/settings`, { signal: controller.signal }),
      fetch(`/api/workspaces/${WORKSPACE_ID}/sounds`, { signal: controller.signal }),
      fetch(`/api/workspaces/${WORKSPACE_ID}/gift-mappings`, { signal: controller.signal }),
      fetch(`/api/workspaces/${WORKSPACE_ID}/gifts`, { signal: controller.signal }),
      fetch(`/api/workspaces/${WORKSPACE_ID}/recent-channels`, { signal: controller.signal }),
    ]).then(async ([settingsResponse, soundsResponse, mappingsResponse, giftsResponse, recentChannelsResponse]) => {
      if (settingsResponse.ok) setSettings(await settingsResponse.json() as WorkspaceSettings);
      if (soundsResponse.ok) { const loaded = await soundsResponse.json() as SoundAsset[]; setSounds(loaded); setSelectedSoundId(loaded[0]?.id ?? ''); }
      if (mappingsResponse.ok) setMappings(await mappingsResponse.json() as GiftSoundMapping[]);
      if (giftsResponse.ok) { const loaded = await giftsResponse.json() as ObservedGift[]; setGifts(loaded); setGiftId(loaded[0]?.giftId ?? ''); }
      if (recentChannelsResponse.ok) setRecentChannels(await recentChannelsResponse.json() as RecentChannel[]);
      setNotice('Готово к работе');
    }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('Не удалось загрузить настройки'); });
    return () => controller.abort();
  }, []);

  useEffect(() => { const client = createRealtimeClient(WORKSPACE_ID, setRealtime); realtimeClient.current = client; return () => { realtimeClient.current = null; client.close(); }; }, []);
  useEffect(() => { const playback = player.current; const owner = new AudioOwnership(() => { setAudioEnabled(false); playback.stopAll(); setNotice('Звук включён в другой вкладке'); }); ownership.current = owner; return () => { owner.close(); playback.stopAll(); }; }, []);

  const mappingByGift = useMemo(() => new Map(mappings.filter((item) => item.isEnabled).map((item) => [item.giftId, item])), [mappings]);
  const chatEvents = useMemo(() => realtime.events.filter((event) => event.type === 'chat.message'), [realtime.events]);
  const giftEvents = useMemo(() => realtime.events.filter((event): event is GiftEvent => event.type === 'gift.received'), [realtime.events]);
  const observedGifts = useMemo(() => {
    const now = new Date().toISOString();
    const catalogue = new Map(gifts.map((gift) => [gift.giftId, gift]));
    for (const event of giftEvents) {
      const known = catalogue.get(event.giftId);
      catalogue.set(event.giftId, {
        giftId: event.giftId, giftName: event.giftName,
        imageUrl: event.imageUrl ?? known?.imageUrl ?? null,
        diamondCount: event.diamondCount ?? known?.diamondCount ?? null,
        firstSeenAt: known?.firstSeenAt ?? now, lastSeenAt: now,
      });
    }
    return [...catalogue.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }, [giftEvents, gifts]);
  const filteredGifts = useMemo(() => {
    const query = catalogQuery.trim().toLocaleLowerCase();
    if (!query) return observedGifts;
    return observedGifts.filter((gift) => {
      const mapping = mappingByGift.get(gift.giftId);
      return [gift.giftName, gift.giftId, mapping?.soundDisplayName].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [catalogQuery, mappingByGift, observedGifts]);

  useEffect(() => {
    if (!audioEnabled) return;
    for (const event of giftEvents) {
      if (event.sequence <= lastPlayedSequence.current) continue;
      lastPlayedSequence.current = event.sequence;
      const mapping = mappingByGift.get(event.giftId);
      if (mapping) player.current.enqueue(mapping.soundUrl, event.repeatCount, settings);
    }
  }, [audioEnabled, giftEvents, mappingByGift, settings]);
  useEffect(() => { if (followChat) chatFeed.current?.scrollTo({ top: chatFeed.current.scrollHeight, behavior: 'smooth' }); }, [chatEvents.length, followChat]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('Сохраняем настройки…');
    const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) });
    if (!response.ok) { setNotice('Настройки не сохранились. Проверьте значения.'); return; }
    setSettings(await response.json() as WorkspaceSettings); setNotice('Настройки сохранены');
  }
  async function connectLive() {
    const username = settings.tiktokUsername.trim(); if (!username) { setNotice('Введите TikTok ID'); return; }
    setNotice('Ищем активную трансляцию…'); const result = await realtimeClient.current?.connectLive(username);
    if (result?.ok) {
      const normalized = username.replace(/^@/, '').toLocaleLowerCase();
      const now = new Date().toISOString();
      setRecentChannels((current) => [{
        tiktokUsername: normalized,
        connectionCount: (current.find((item) => item.tiktokUsername === normalized)?.connectionCount ?? 0) + 1,
        lastConnectedAt: now,
      }, ...current.filter((item) => item.tiktokUsername !== normalized)].slice(0, 20));
    }
    setNotice(result?.ok ? 'Команда отправлена — ждём ответ TikTok' : 'Сервер не принял команду подключения');
  }
  async function disconnectLive() { const result = await realtimeClient.current?.disconnectLive(); setNotice(result?.ok ? 'Подключение остановлено' : 'Не удалось остановить подключение'); }
  async function enableAudio() {
    lastPlayedSequence.current = realtime.lastSequence; ownership.current?.claim();
    const preview = sounds.find((sound) => sound.id === selectedSoundId);
    const urls = [...mappings.filter((mapping) => mapping.isEnabled).map((mapping) => mapping.soundUrl), ...(preview ? [preview.url] : [])];
    await player.current.unlock(urls, settings.maxConcurrentSounds);
    setAudioEnabled(true); setNotice('Звук включён в этой вкладке');
    if (preview) player.current.enqueue(preview.url, 1, settings);
  }
  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!giftId || !selectedSoundId) { setNotice('Выберите замеченный подарок и звук'); return; }
    const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/gift-mappings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ giftId, soundAssetId: selectedSoundId, isEnabled: true }) });
    if (!response.ok) { setNotice('Не удалось сохранить привязку'); return; }
    const saved = await response.json() as GiftSoundMapping; setMappings((current) => [...current.filter((item) => item.giftId !== saved.giftId), saved]); setNotice(`Подарок ${observedGifts.find((gift) => gift.giftId === saved.giftId)?.giftName ?? saved.giftId} привязан к звуку`);
  }
  async function previewSound() { const sound = sounds.find((item) => item.id === selectedSoundId); if (!sound) return; lastPlayedSequence.current = realtime.lastSequence; ownership.current?.claim(); await player.current.unlock([sound.url], settings.maxConcurrentSounds); setAudioEnabled(true); player.current.enqueue(sound.url, 1, settings); }
  function selectGiftForMapping(id: string) { setGiftId(id); mappingInput.current?.focus(); mappingInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  return <main className="console-shell">
    <header className="topbar"><div><p className="eyebrow">TikTokHelper</p><h1>Пульт трансляции</h1></div><div className={`live-pill state-${realtime.connectionState}`}><span aria-hidden="true">●</span>{STATE_COPY[realtime.connectionState]}</div></header>
    <p className="notice" role="status" aria-live="polite">{notice}</p>
    <section className="connection-panel" aria-labelledby="connection-title">
      <div><h2 id="connection-title">Подключение</h2><p>TikTokHelper читает уже запущенный эфир — сам эфир запускается на телефоне.</p></div>
      <div className="username-field"><label><span>TikTok ID</span><input required value={settings.tiktokUsername} placeholder="@username" onChange={(event) => setSettings((current) => ({ ...current, tiktokUsername: event.target.value }))} /></label>{recentChannels.length > 0 ? <div className="recent-channels" aria-label="Недавние TikTok ID">{recentChannels.slice(0, 8).map((channel) => <button type="button" className="channel-chip" key={channel.tiktokUsername} onClick={() => setSettings((current) => ({ ...current, tiktokUsername: `@${channel.tiktokUsername}` }))}>@{channel.tiktokUsername}</button>)}</div> : <span className="field-hint">История появится после первого подключения.</span>}</div>
      <div className="actions"><button type="button" onClick={() => void connectLive()} disabled={!realtime.isTransportConnected}>Подключить эфир</button><button type="button" className="secondary" onClick={() => void disconnectLive()}>Остановить</button></div>
      <div className="connection-facts"><span>Браузер <b>{realtime.isTransportConnected ? 'на связи' : 'без связи'}</b></span><span>Чат и подарки <b>{operatorEventCount(realtime.events)}</b></span></div>
    </section>
    <div className="feed-grid">
      <section className="feed-panel chat-panel" aria-labelledby="chat-title"><header><div><p className="section-kicker">Прямой эфир</p><h2 id="chat-title">Чат</h2></div>{!followChat ? <button type="button" className="quiet" onClick={() => setFollowChat(true)}>К новым сообщениям</button> : null}</header><ul ref={chatFeed} className="chat-list" aria-live="polite" onScroll={(event) => { const target = event.currentTarget; setFollowChat(target.scrollHeight - target.scrollTop - target.clientHeight < 56); }}>{chatEvents.length === 0 ? <li className="empty-state"><strong>Сообщений пока нет</strong><span>После подключения новые реплики появятся здесь крупным текстом.</span></li> : chatEvents.map((message) => <li key={message.eventId} className="chat-message"><div><strong>{message.senderDisplayName}</strong><span>@{message.senderUsername}</span></div><p>{chatContentParts(message.text, message.emotes).map((part, index) => part.type === 'text' ? part.value : <img key={`${part.value.emoteId}-${index}`} className="chat-emote" src={part.value.imageUrl} alt={`:${part.value.emoteId}:`} loading="lazy" referrerPolicy="no-referrer" />)}</p></li>)}</ul></section>
      <aside className="feed-panel gift-panel" aria-labelledby="gift-title"><header><div><p className="section-kicker">Реакции</p><h2 id="gift-title">Подарки</h2></div></header><ul className="gift-list">{giftEvents.length === 0 ? <li className="empty-state"><strong>Ждём первый подарок</strong><span>Серии будут показаны по реально добавленному количеству.</span></li> : giftEvents.slice(-30).toReversed().map((gift) => <li key={gift.eventId}>{gift.imageUrl ? <img className="gift-image" src={gift.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="gift-count">×{gift.repeatCount}</span>}<div><strong>{gift.giftName} ×{gift.repeatCount}</strong><span>{gift.senderDisplayName}</span></div><small>{mappingByGift.has(gift.giftId) ? 'звук назначен' : `ID ${gift.giftId} · без звука`}</small><button type="button" className="quiet" onClick={() => selectGiftForMapping(gift.giftId)}>Настроить</button></li>)}</ul></aside>
    </div>
    <details className="catalog-panel">
      <summary><span><b>Каталог подарков и звуков</b><small>{observedGifts.length} подарков · {mappings.length} привязок</small></span><span aria-hidden="true">Развернуть</span></summary>
      <div className="catalog-tools"><label>Поиск по названию, ID или звуку<input type="search" value={catalogQuery} placeholder="Например: Rose, 5655 или Пук" onChange={(event) => setCatalogQuery(event.target.value)} /></label></div>
      {filteredGifts.length === 0 ? <p className="catalog-empty">Ничего не найдено. Измените запрос или дождитесь новых подарков в эфире.</p> : <ul className="catalog-list">{filteredGifts.map((gift) => { const mapping = mappingByGift.get(gift.giftId); return <li key={gift.giftId}>{gift.imageUrl ? <img src={gift.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="catalog-placeholder" aria-hidden="true">🎁</span>}<div><strong>{gift.giftName}</strong><code>ID {gift.giftId}</code></div><div className={mapping ? 'mapping-state assigned' : 'mapping-state'}><span>{mapping ? 'Назначен звук' : 'Без звука'}</span><b>{mapping?.soundDisplayName ?? 'Выберите реакцию'}</b></div><button type="button" className="quiet" onClick={() => selectGiftForMapping(gift.giftId)}>Настроить</button></li>; })}</ul>}
    </details>
    <section className="control-grid" aria-label="Настройки звука">
      <div className="control-card audio-card"><p className="section-kicker">Эта вкладка</p><h2>Звук</h2><p>{audioEnabled ? 'Подарки озвучиваются здесь.' : 'Браузеру нужно разрешить звук одним нажатием.'}</p><div className="actions"><button type="button" onClick={() => void enableAudio()}>{audioEnabled ? 'Звук включён' : 'Включить звук'}</button><button type="button" className="danger" onClick={() => { player.current.stopAll(); setNotice('Все звуки и очередь остановлены'); }}>Стоп / очистить очередь</button></div></div>
      <form className="control-card" onSubmit={(event) => void saveMapping(event)}><p className="section-kicker">Реакция на подарок</p><h2>Привязка звука</h2><label>Замеченный подарок<select ref={mappingInput} value={giftId} onChange={(event) => setGiftId(event.target.value)}><option value="">Сначала дождитесь подарка в эфире</option>{observedGifts.map((gift) => <option key={gift.giftId} value={gift.giftId}>{gift.giftName} · ID {gift.giftId}</option>)}</select></label><label>Звук<select value={selectedSoundId} onChange={(event) => setSelectedSoundId(event.target.value)}>{sounds.map((sound) => <option key={sound.id} value={sound.id}>{sound.displayName}</option>)}</select></label><div className="actions"><button type="button" className="secondary" onClick={() => void previewSound()}>Прослушать</button><button type="submit" disabled={!giftId || !selectedSoundId}>Сохранить привязку</button></div><p className="helper">В базе подарков: {observedGifts.length}. Сохранено привязок: {mappings.length}</p></form>
      <form className="control-card settings-card" onSubmit={(event) => void saveSettings(event)}><p className="section-kicker">Поведение серии</p><h2>Наложение</h2><label>Режим<select value={settings.playbackMode} onChange={(event) => setSettings((current) => ({ ...current, playbackMode: event.target.value as UpdateWorkspaceSettings['playbackMode'] }))}><option value="controlled_overlap">Умеренное наложение</option><option value="sequential">Последовательно</option><option value="strong_overlap">Сильное наложение</option></select></label><label>Перекрытие звука <output>{settings.overlapPercent}%</output><input type="range" min="0" max="100" value={settings.overlapPercent} onChange={(event) => setSettings((current) => ({ ...current, overlapPercent: event.target.valueAsNumber }))} /></label><div className="two-fields"><label>Одновременно<input type="number" min="1" max="32" value={settings.maxConcurrentSounds} onChange={(event) => setSettings((current) => ({ ...current, maxConcurrentSounds: event.target.valueAsNumber }))} /></label><label>Громкость <output>{settings.volumePercent}%</output><input type="range" min="0" max="100" value={settings.volumePercent} onChange={(event) => setSettings((current) => ({ ...current, volumePercent: event.target.valueAsNumber }))} /></label></div><button type="submit">Сохранить настройки</button></form>
    </section>
    <footer><span>Короткая история чата хранится только в памяти сервера.</span><a href="https://github.com/gopnikgame/TikTokHelper_ASP.NET/tree/rewrite/typescript">Исходный код сервера</a></footer>
  </main>;
}
