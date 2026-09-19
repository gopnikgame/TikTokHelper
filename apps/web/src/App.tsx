import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AutomationConfiguration, AuthPrincipal, ChatEvent, GiftEvent, GiftSoundMapping, ObservedGift, RecentChannel, SoundAsset, SupportLevelGrantedEvent, UpdateWorkspaceSettings, WorkspaceSettings } from '@tiktok-helper/contracts';
import { AudioOwnership, SoundPlaybackQueue } from './audio/playback.js';
import { operatorEventCount } from './event-model.js';
import { createRealtimeClient, type RealtimeClient, type RealtimeViewState } from './realtime/client.js';
import { DEFAULT_SETTINGS } from './settings-model.js';
import { chatContentParts } from './chat-content.js';
import { beginLogin, endSession, loadAccess, loadSession } from './auth-client.js';
import { SpeechPolicyEngine } from './speech/policy.js';
import { browserSpeechSynthesisSupported, SpeechPlaybackQueue } from './speech/playback.js';
import { NeuralTtsExperiment } from './speech/NeuralTtsExperiment.js';
import { AutomationEditor, AutomationStatus } from './automation/AutomationEditor.js';
import { APPLICATION_SOURCE } from './source-link.js';
import { genericInstallInstructions, type PwaLifecycle, updateBlockedByLive, usePwaLifecycle } from './pwa/lifecycle.js';

const INITIAL_REALTIME_STATE: RealtimeViewState = { connectionState: 'stopped', events: [], generation: 0, lastSequence: 0, isTransportConnected: false };
const STATE_COPY = { stopped: 'Остановлен', connecting: 'Подключаемся…', live: 'В эфире', reconnecting: 'Восстанавливаем связь…', offline: 'Аккаунт сейчас не в эфире', failed: 'Не удалось подключиться' } as const;
const CONNECTION_NOTICE = { live: 'Эфир подключён — принимаем чат и подарки', reconnecting: 'Связь прервалась — подключаемся снова…', offline: 'Эфир завершён или аккаунт сейчас не в эфире', failed: 'Не удалось подключиться к эфиру' } as const;
type SessionState = { status: 'loading' } | { status: 'anonymous' } | { status: 'error' } | { status: 'authenticated'; principal: AuthPrincipal; mode: 'local' | 'vline' };
const AUTH_ERROR_COPY: Record<string, string> = {
  subscription_required: 'Для доступа нужна активная подписка VLine.',
  subscription_expired: 'Срок подписки VLine закончился. Продлите её и попробуйте войти снова.',
  subscription_frozen: 'Подписка VLine сейчас заморожена. Возобновите её и попробуйте войти снова.',
  account_disabled: 'Учётная запись VLine недоступна. Обратитесь в поддержку.',
};

function diagnosticBoolean(value: boolean | undefined): string {
  return value === undefined ? 'нет данных' : value ? 'да' : 'нет';
}

export function App() {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'loading' });
  const [authError] = useState(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('auth_error');
    if (code) { url.searchParams.delete('auth_error'); window.history.replaceState({}, '', url.pathname + url.search + url.hash); }
    return code && AUTH_ERROR_COPY[code] ? AUTH_ERROR_COPY[code] : null;
  });
  const [liveSessionActive, setLiveSessionActive] = useState(false);
  const pwa = usePwaLifecycle();
  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal).then((session) => {
      setSessionState(session ? { status: 'authenticated', principal: session.user, mode: session.mode } : { status: 'anonymous' });
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setSessionState({ status: 'error' });
    });
    return () => controller.abort();
  }, []);

  const onLoggedOut = useCallback(() => setSessionState({ status: 'anonymous' }), []);
  let content;
  if (sessionState.status === 'loading') content = <AccessScreen title="Проверяем вход…" message="Подготавливаем ваше рабочее место." />;
  else if (sessionState.status === 'anonymous') content = <LoginScreen authError={authError} />;
  else if (sessionState.status === 'error') content = <AccessScreen title="Сервис входа недоступен" message="Обновите страницу через минуту. Настройки и звуки останутся на месте." retry />;
  else content = <AuthenticatedApp principal={sessionState.principal} authMode={sessionState.mode} onLoggedOut={onLoggedOut} pwa={pwa} onLiveSessionActiveChange={setLiveSessionActive} />;

  return <>{content}<PwaNotices pwa={pwa} liveSessionActive={liveSessionActive} /></>;
}

function PwaNotices({ pwa, liveSessionActive }: { pwa: PwaLifecycle; liveSessionActive: boolean }) {
  return <div className="pwa-notices" aria-live="polite">
    {pwa.updateReady ? <section className="pwa-notice update-ready" role="status">
      <div><strong>Доступна новая версия</strong><span>{liveSessionActive ? 'Обновление подождёт: сначала остановите эфир.' : 'Версия загружена и применится только по вашей команде.'}</span></div>
      <button type="button" disabled={liveSessionActive} onClick={pwa.applyUpdate}>{liveSessionActive ? 'Сначала остановите эфир' : 'Обновить сейчас'}</button>
    </section> : null}
    {pwa.manualInstallHelp ? <section className="pwa-notice install-help" role="status">
      <div><strong>Установка через меню браузера</strong><span>{genericInstallInstructions()}</span></div>
      <button type="button" className="quiet" onClick={pwa.dismissManualInstallHelp}>Понятно</button>
    </section> : null}
  </div>;
}

function AccessScreen({ title, message, retry = false }: { title: string; message: string; retry?: boolean }) {
  return <main className="access-shell"><section className="access-card"><p className="eyebrow">TikTokHelper</p><h1>{title}</h1><p>{message}</p>{retry ? <button type="button" onClick={() => window.location.reload()}>Попробовать снова</button> : null}<SourceLink /></section></main>;
}

function LoginScreen({ authError }: { authError: string | null }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function login() {
    setBusy(true); setFailed(false);
    try { await beginLogin(); } catch { setBusy(false); setFailed(true); }
  }
  return <main className="access-shell"><section className="access-card"><p className="eyebrow">TikTokHelper</p><h1>Пульт трансляции</h1><p>Войдите через аккаунт VLine, чтобы открыть свои эфиры, звуки и привязки подарков.</p>{authError ? <p className="access-error" role="alert">{authError}</p> : null}<button type="button" disabled={busy} onClick={() => void login()}>{busy ? 'Открываем VLine…' : 'Войти через VLine'}</button>{failed ? <p className="access-error" role="alert">Не удалось начать вход. Проверьте соединение и попробуйте снова.</p> : null}<SourceLink /></section></main>;
}

function SourceLink() {
  return <a className="source-link" href={APPLICATION_SOURCE.url} target="_blank" rel="noreferrer" title={`Исходный код версии ${APPLICATION_SOURCE.revision}`}><span>Исходный код</span><code>{APPLICATION_SOURCE.label}</code></a>;
}

function AuthenticatedApp({ principal, authMode, onLoggedOut, pwa, onLiveSessionActiveChange }: { principal: AuthPrincipal; authMode: 'local' | 'vline'; onLoggedOut: () => void; pwa: PwaLifecycle; onLiveSessionActiveChange: (active: boolean) => void }) {
  const [workspaceId, setWorkspaceId] = useState(() => {
    const saved = sessionStorage.getItem('tiktok-helper.workspace');
    return principal.workspaces.some((workspace) => workspace.id === saved) ? saved! : (principal.workspaces[0]?.id ?? '');
  });
  const [settings, setSettings] = useState<UpdateWorkspaceSettings>(DEFAULT_SETTINGS);
  const [notice, setNotice] = useState('Загружаем рабочее место…');
  const [accessWarning, setAccessWarning] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeViewState>(INITIAL_REALTIME_STATE);
  const [sounds, setSounds] = useState<SoundAsset[]>([]);
  const [mappings, setMappings] = useState<GiftSoundMapping[]>([]);
  const [gifts, setGifts] = useState<ObservedGift[]>([]);
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [automation, setAutomation] = useState<AutomationConfiguration | null>(null);
  const [automationStatus, setAutomationStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
  const [giftId, setGiftId] = useState('');
  const [selectedSoundId, setSelectedSoundId] = useState('');
  const [soundFile, setSoundFile] = useState<File | null>(null);
  const [isUploadingSound, setIsUploadingSound] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioCacheStatus, setAudioCacheStatus] = useState<'idle' | 'warming' | 'ready' | 'fallback'>('idle');
  const [followChat, setFollowChat] = useState(true);
  const realtimeClient = useRef<RealtimeClient | null>(null);
  const chatFeed = useRef<HTMLUListElement | null>(null);
  const mappingInput = useRef<HTMLSelectElement | null>(null);
  const soundFileInput = useRef<HTMLInputElement | null>(null);
  const lastPlayedSequence = useRef(0);
  const lastSpokenSequence = useRef(0);
  const player = useRef(new SoundPlaybackQueue(undefined, () => setNotice('Браузер не смог воспроизвести звук')));
  const speechPolicy = useRef(new SpeechPolicyEngine());
  const [speechSupported] = useState(() => browserSpeechSynthesisSupported());
  const [speechQueue] = useState(() => speechSupported ? new SpeechPlaybackQueue() : null);
  const ownership = useRef<AudioOwnership | null>(null);
  const automationRef = useRef<AutomationConfiguration | null>(null);
  const soundsRef = useRef<SoundAsset[]>([]);
  const settingsRef = useRef(settings);
  const audioEnabledRef = useRef(audioEnabled);
  useEffect(() => { automationRef.current = automation; }, [automation]);
  useEffect(() => { soundsRef.current = sounds; }, [sounds]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);
  useEffect(() => {
    if (authMode !== 'vline') return;
    let active = true;
    let controller: AbortController | undefined;
    const check = () => {
      controller?.abort(); controller = new AbortController();
      void loadAccess(controller.signal).then((access) => {
        if (!active) return;
        setAccessWarning(access.allowed ? null : (AUTH_ERROR_COPY[access.reason] ?? 'Доступ к новым подключениям ограничен.'));
      }).catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, 10 * 60 * 1000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, [authMode]);
  useEffect(() => {
    onLiveSessionActiveChange(updateBlockedByLive(realtime.connectionState));
    return () => onLiveSessionActiveChange(false);
  }, [onLiveSessionActiveChange, realtime.connectionState]);

  const handleSupportLevelGranted = useCallback((event: SupportLevelGrantedEvent) => {
    const currentAutomation = automationRef.current;
    if (!audioEnabledRef.current || !currentAutomation) return;
    const reaction = speechPolicy.current.evaluateGrant(event, currentAutomation);
    if (reaction.speech) speechQueue?.enqueue(reaction.speech, currentAutomation.policy.maxQueueSize);
    for (const soundAssetId of reaction.soundAssetIds) {
      const sound = soundsRef.current.find((item) => item.id === soundAssetId && item.status === 'active');
      if (sound) player.current.enqueue(sound, 1, settingsRef.current);
    }
  }, [speechQueue]);

  const playReaction = useCallback((reaction: ReturnType<SpeechPolicyEngine['evaluateParticipantSeen']>) => {
    const currentAutomation = automationRef.current;
    if (!audioEnabledRef.current || !currentAutomation) return;
    if (reaction.speech) speechQueue?.enqueue(reaction.speech, currentAutomation.policy.maxQueueSize);
    for (const soundAssetId of reaction.soundAssetIds) {
      const sound = soundsRef.current.find((item) => item.id === soundAssetId && item.status === 'active');
      if (sound) player.current.enqueue(sound, 1, settingsRef.current);
    }
  }, [speechQueue]);

  const reloadSoundLibrary = useCallback(async (changedSoundId?: string) => {
    const workspacePath = encodeURIComponent(workspaceId);
    const [soundsResponse, mappingsResponse] = await Promise.all([
      fetch(`/api/workspaces/${workspacePath}/sounds`),
      fetch(`/api/workspaces/${workspacePath}/gift-mappings`),
    ]);
    if (!soundsResponse.ok || !mappingsResponse.ok) return;
    const loadedSounds = await soundsResponse.json() as SoundAsset[];
    const loadedMappings = await mappingsResponse.json() as GiftSoundMapping[];
    setSounds(loadedSounds); setMappings(loadedMappings);
    setSelectedSoundId((current) => loadedSounds.some((sound) => sound.id === current && sound.status === 'active')
      ? current : (loadedSounds.find((sound) => sound.status === 'active')?.id ?? ''));
    if (changedSoundId) {
      player.current.stopAll();
      setNotice('Библиотека звуков обновлена — очередь воспроизведения очищена');
    }
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    const workspacePath = encodeURIComponent(workspaceId);
    void Promise.all([
      fetch(`/api/workspaces/${workspacePath}/settings`, { signal: controller.signal }),
      fetch(`/api/workspaces/${workspacePath}/sounds`, { signal: controller.signal }),
      fetch(`/api/workspaces/${workspacePath}/gift-mappings`, { signal: controller.signal }),
      fetch(`/api/workspaces/${workspacePath}/gifts`, { signal: controller.signal }),
      fetch(`/api/workspaces/${workspacePath}/recent-channels`, { signal: controller.signal }),
      fetch(`/api/workspaces/${workspacePath}/automation`, { signal: controller.signal }),
    ]).then(async ([settingsResponse, soundsResponse, mappingsResponse, giftsResponse, recentChannelsResponse, automationResponse]) => {
      if ([settingsResponse, soundsResponse, mappingsResponse, giftsResponse, recentChannelsResponse, automationResponse].some((response) => response.status === 401)) {
        onLoggedOut(); return;
      }
      if (settingsResponse.ok) setSettings(await settingsResponse.json() as WorkspaceSettings);
      if (soundsResponse.ok) { const loaded = await soundsResponse.json() as SoundAsset[]; setSounds(loaded); setSelectedSoundId(loaded[0]?.id ?? ''); }
      if (mappingsResponse.ok) setMappings(await mappingsResponse.json() as GiftSoundMapping[]);
      if (giftsResponse.ok) { const loaded = await giftsResponse.json() as ObservedGift[]; setGifts(loaded); setGiftId(loaded[0]?.giftId ?? ''); }
      if (recentChannelsResponse.ok) setRecentChannels(await recentChannelsResponse.json() as RecentChannel[]);
      if (automationResponse.ok) { setAutomation(await automationResponse.json() as AutomationConfiguration); setAutomationStatus('ready'); }
      else setAutomationStatus('error');
      setWorkspaceReady(true);
      setNotice('Готово к работе');
    }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) { setAutomationStatus('error'); setNotice('Не удалось загрузить настройки'); } });
    return () => controller.abort();
  }, [onLoggedOut, workspaceId]);

  useEffect(() => {
    let previousState = INITIAL_REALTIME_STATE.connectionState;
    const client = createRealtimeClient(workspaceId, (next) => {
      if (next.connectionState !== previousState) {
        previousState = next.connectionState;
        if (next.connectionState in CONNECTION_NOTICE) {
          setNotice(CONNECTION_NOTICE[next.connectionState as keyof typeof CONNECTION_NOTICE]);
        }
      }
      setRealtime(next);
    }, undefined, (soundId) => void reloadSoundLibrary(soundId), handleSupportLevelGranted);
    realtimeClient.current = client;
    return () => { realtimeClient.current = null; client.close(); };
  }, [handleSupportLevelGranted, reloadSoundLibrary, workspaceId]);
  useEffect(() => { const playback = player.current; const owner = new AudioOwnership(() => { setAudioEnabled(false); playback.stopAll(); speechQueue?.stop(); setNotice('Звук включён в другой вкладке'); }); ownership.current = owner; return () => { owner.close(); playback.stopAll(); speechQueue?.stop(); }; }, [speechQueue]);

  const mappingByGift = useMemo(() => new Map(mappings.filter((item) => item.isEnabled).map((item) => [item.giftId, item])), [mappings]);
  const soundById = useMemo(() => new Map(sounds.map((sound) => [sound.id, sound])), [sounds]);
  const warmSounds = useMemo(() => {
    const ids = new Set(mappings.filter((mapping) => mapping.isEnabled).map((mapping) => mapping.soundAssetId));
    for (const level of automation?.supportLevels ?? []) if (level.isEnabled && level.soundAssetId) ids.add(level.soundAssetId);
    for (const reaction of automation?.eventReactions ?? []) if (reaction.isEnabled && reaction.soundAssetId) ids.add(reaction.soundAssetId);
    return [...ids].map((id) => soundById.get(id)).filter((sound): sound is SoundAsset => sound?.status === 'active');
  }, [automation, mappings, soundById]);
  const chatEvents = useMemo(() => realtime.events.filter((event): event is ChatEvent => event.type === 'chat.message'), [realtime.events]);
  const participantObservations = useMemo(() => {
    const observations = new Map<string, ChatEvent>();
    for (const event of chatEvents.toReversed()) {
      const key = event.participant?.userId ?? event.senderUsername.toLocaleLowerCase();
      if (!observations.has(key)) observations.set(key, event);
      if (observations.size >= 50) break;
    }
    return [...observations.values()];
  }, [chatEvents]);
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
    return observedGifts.filter((gift) => {
      const mapping = mappingByGift.get(gift.giftId);
      if (catalogFilter === 'assigned' && !mapping) return false;
      if (catalogFilter === 'unassigned' && mapping) return false;
      return !query || [gift.giftName, gift.giftId, mapping?.soundDisplayName].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [catalogFilter, catalogQuery, mappingByGift, observedGifts]);
  const assignedGiftCount = mappingByGift.size;

  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current) setAudioCacheStatus(audioEnabled ? 'warming' : 'idle'); });
    if (!audioEnabled || !workspaceReady) return () => { current = false; };
    void player.current.reconcile(warmSounds).then(() => player.current.warm(warmSounds)).then((result) => {
      if (current) setAudioCacheStatus(result.failed > 0 ? 'fallback' : 'ready');
    });
    return () => { current = false; };
  }, [audioEnabled, warmSounds, workspaceReady]);

  useEffect(() => {
    if (!audioEnabled) return;
    for (const event of giftEvents) {
      if (event.sequence <= lastPlayedSequence.current) continue;
      lastPlayedSequence.current = event.sequence;
      const mapping = mappingByGift.get(event.giftId);
      const sound = mapping ? soundById.get(mapping.soundAssetId) : undefined;
      if (sound?.status === 'active') player.current.enqueue(sound, event.repeatCount, settings);
    }
  }, [audioEnabled, giftEvents, mappingByGift, settings, soundById]);
  useEffect(() => {
    if (!audioEnabled || !automation) return;
    for (const event of realtime.events) {
      if (event.sequence <= lastSpokenSequence.current) continue;
      lastSpokenSequence.current = event.sequence;
      if (event.type === 'chat.message') {
        if (event.speakerContext?.isModerator) playReaction(speechPolicy.current.evaluateParticipantSeen('moderator_seen', event, automation));
        if (event.speakerContext?.isGiftGiver) playReaction(speechPolicy.current.evaluateParticipantSeen('donor_seen', event, automation));
        const job = speechPolicy.current.evaluateChat(event, automation);
        if (job) speechQueue?.enqueue(job, automation.policy.maxQueueSize);
      }
      if (event.type === 'gift.received') playReaction(speechPolicy.current.evaluateParticipantSeen('donor_seen', event, automation));
    }
  }, [audioEnabled, automation, playReaction, realtime.events, speechQueue]);
  useEffect(() => { if (followChat) chatFeed.current?.scrollTo({ top: chatFeed.current.scrollHeight, behavior: 'smooth' }); }, [chatEvents.length, followChat]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('Сохраняем настройки…');
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) });
    if (!response.ok) { setNotice('Настройки не сохранились. Проверьте значения.'); return; }
    setSettings(await response.json() as WorkspaceSettings); setNotice('Настройки сохранены');
  }
  async function connectLive() {
    const username = settings.tiktokUsername.trim(); if (!username) { setNotice('Введите TikTok ID'); return; }
    speechPolicy.current.reset(); lastSpokenSequence.current = realtime.lastSequence;
    setNotice('Ищем активную трансляцию…'); const result = await realtimeClient.current?.connectLive(username);
    if (result && !result.ok && result.error.code === 'ACCESS_DENIED') {
      setNotice(AUTH_ERROR_COPY[result.error.message] ?? 'Подписка не разрешает новое подключение к эфиру.'); return;
    }
    if (result && !result.ok && result.error.code === 'ACCESS_UNAVAILABLE') {
      setNotice('Не удалось проверить подписку. Текущий эфир не остановлен; новое подключение временно недоступно.'); return;
    }
    if (result?.ok) {
      const normalized = username.replace(/^@/, '').toLocaleLowerCase();
      const now = new Date().toISOString();
      setRecentChannels((current) => [{
        tiktokUsername: normalized,
        connectionCount: (current.find((item) => item.tiktokUsername === normalized)?.connectionCount ?? 0) + 1,
        lastConnectedAt: now,
      }, ...current.filter((item) => item.tiktokUsername !== normalized)].slice(0, 20));
    }
    setNotice(result?.ok ? 'Команда принята — подключаемся…' : 'Сервер не принял команду подключения');
  }
  async function disconnectLive() { const result = await realtimeClient.current?.disconnectLive(); setNotice(result?.ok ? 'Подключение остановлено' : 'Не удалось остановить подключение'); }
  async function reloadAutomation() {
    setAutomationStatus('loading');
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/automation`);
      if (response.status === 401) { onLoggedOut(); return; }
      if (!response.ok) throw new Error();
      setAutomation(await response.json() as AutomationConfiguration); setAutomationStatus('ready'); setNotice('Настройки озвучивания загружены');
    } catch { setAutomationStatus('error'); setNotice('Настройки озвучивания пока недоступны'); }
  }
  async function enableAudio() {
    lastPlayedSequence.current = realtime.lastSequence; lastSpokenSequence.current = realtime.lastSequence; ownership.current?.claim();
    const preview = sounds.find((sound) => sound.id === selectedSoundId);
    try {
      await player.current.unlock(settings.maxConcurrentSounds, preview?.url);
      speechQueue?.unlock();
      setAudioEnabled(true); setNotice(speechSupported ? 'Звук и озвучивание включены в этой вкладке' : 'Звуки включены, но этот браузер не поддерживает озвучивание текста');
    } catch {
      setAudioEnabled(false); setNotice('Браузер не разрешил звук. Нажмите ещё раз.');
    }
  }
  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!giftId || !selectedSoundId) { setNotice('Выберите замеченный подарок и звук'); return; }
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/gift-mappings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ giftId, soundAssetId: selectedSoundId, isEnabled: true }) });
    if (!response.ok) { setNotice('Не удалось сохранить привязку'); return; }
    const saved = await response.json() as GiftSoundMapping; setMappings((current) => [...current.filter((item) => item.giftId !== saved.giftId), saved]); setNotice(`Подарок ${observedGifts.find((gift) => gift.giftId === saved.giftId)?.giftName ?? saved.giftId} привязан к звуку`);
  }
  function previewSound() {
    previewSoundById(selectedSoundId);
  }
  function previewSoundById(soundId: string) {
    const sound = sounds.find((item) => item.id === soundId); if (!sound || sound.status !== 'active') return;
    lastPlayedSequence.current = realtime.lastSequence; ownership.current?.claim();
    void player.current.preview(sound, settings.volumePercent).then(() => {
      setAudioEnabled(true); setNotice('Проверочный звук воспроизводится');
    }).catch(() => { setAudioEnabled(false); });
  }
  async function uploadSound() {
    if (!soundFile || isUploadingSound) return;
    setIsUploadingSound(true); setNotice(`Загружаем «${soundFile.name}»…`);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sounds?displayName=${encodeURIComponent(soundFile.name)}`, {
        method: 'POST', headers: { 'content-type': soundFile.type || 'application/octet-stream' }, body: soundFile,
      });
      if (!response.ok) {
        const message = response.status === 413 ? 'Файл слишком большой. Максимум 10 МБ.' : 'Формат не поддерживается. Используйте WAV, MP3, OGG или M4A.';
        setNotice(message); return;
      }
      const uploaded = await response.json() as SoundAsset;
      setSounds((current) => [...current, uploaded]); setSelectedSoundId(uploaded.id); setSoundFile(null);
      if (soundFileInput.current) soundFileInput.current.value = '';
      setNotice(`Звук «${uploaded.displayName}» загружен и выбран`);
    } catch {
      setNotice('Не удалось загрузить звук. Проверьте соединение и повторите.');
    } finally {
      setIsUploadingSound(false);
    }
  }
  async function quarantineSound(sound: SoundAsset) {
    const reason = window.prompt('Причина помещения в карантин', 'Нарушение авторских прав')?.trim();
    if (!reason) return;
    if (!window.confirm(`Поместить «${sound.displayName}» в карантин? Звук перестанет воспроизводиться у всех пользователей.`)) return;
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sounds/${encodeURIComponent(sound.id)}/quarantine`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    if (!response.ok) { setNotice('Не удалось поместить звук в карантин'); return; }
    await reloadSoundLibrary(sound.id); setNotice(`Звук «${sound.displayName}» помещён в карантин`);
  }
  async function deleteSound(sound: SoundAsset) {
    const warning = sound.status === 'quarantined'
      ? `Окончательно удалить «${sound.displayName}» и ${sound.usageCount} привязок? Отменить это действие нельзя.`
      : `Удалить ваш звук «${sound.displayName}»? Отменить это действие нельзя.`;
    if (!window.confirm(warning)) return;
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sounds/${encodeURIComponent(sound.id)}`, { method: 'DELETE' });
    if (!response.ok) {
      setNotice(response.status === 409 ? 'Звук используется: сначала удалите все привязки' : 'Не удалось удалить звук'); return;
    }
    await reloadSoundLibrary(sound.id); setNotice(`Звук «${sound.displayName}» удалён`);
  }
  function selectGiftForMapping(id: string) {
    setGiftId(id);
    const mapping = mappingByGift.get(id);
    if (mapping) setSelectedSoundId(mapping.soundAssetId);
    mappingInput.current?.focus();
    mappingInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function selectWorkspace(nextWorkspaceId: string) {
    sessionStorage.setItem('tiktok-helper.workspace', nextWorkspaceId);
    setNotice('Загружаем рабочее место…');
    setWorkspaceReady(false);
    speechPolicy.current.reset(); speechQueue?.stop();
    setRealtime(INITIAL_REALTIME_STATE);
    setSounds([]); setMappings([]); setGifts([]); setRecentChannels([]); setAutomation(null); setAutomationStatus('loading');
    setWorkspaceId(nextWorkspaceId);
  }

  return <main className="console-shell">
    <header className="topbar"><div><p className="eyebrow">TikTokHelper</p><h1>Пульт трансляции</h1></div><div className="account-area"><div className={`live-pill state-${realtime.connectionState}`}><span aria-hidden="true">●</span>{STATE_COPY[realtime.connectionState]}</div>{!pwa.installed ? <button type="button" className="quiet install-app-button" onClick={() => void pwa.install()}>Установить</button> : null}<div className="account-control"><span>{principal.displayName ?? 'Пользователь VLine'}</span>{principal.workspaces.length > 1 ? <label>Рабочее место<select value={workspaceId} onChange={(event) => selectWorkspace(event.target.value)}>{principal.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.displayName}</option>)}</select></label> : <small>{principal.workspaces[0]?.displayName ?? 'Рабочее место не назначено'}</small>}{authMode === 'vline' ? <button type="button" className="quiet" onClick={() => void endSession().then(onLoggedOut).catch(() => setNotice('Не удалось выйти. Попробуйте ещё раз.'))}>Выйти</button> : null}</div></div></header>
    <p className="notice" role="status" aria-live="polite">{notice}</p>
    {accessWarning ? <p className="access-error" role="alert">{accessWarning} Уже подключённый эфир продолжит работать, но новое подключение будет недоступно.</p> : null}
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
    {principal.isAdmin ? <details className="diagnostics-panel">
      <summary><span><b>Диагностика участников чата</b><small>{participantObservations.length} замечено в текущей истории</small></span><span aria-hidden="true">Развернуть</span></summary>
      <div className="diagnostics-intro"><strong>Безопасный просмотр</strong><span>Показываются только нормализованные поля текущего эфира. Исходные события, secUid, биографии и текст сообщений здесь не сохраняются.</span></div>
      {participantObservations.length === 0 ? <p className="catalog-empty">Данные появятся после первого нового сообщения в подключённом эфире.</p> : <ul className="diagnostics-list">{participantObservations.map((message) => {
        const participant = message.participant;
        return <li key={participant?.userId ?? message.senderUsername}>
          <div className="participant-heading">{participant?.avatarUrl ? <img src={participant.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="participant-placeholder" aria-hidden="true">👤</span>}<div><strong>{message.senderDisplayName}</strong><span>@{message.senderUsername}</span>{participant?.userId ? <code>ID {participant.userId}</code> : null}</div></div>
          <dl>
            <div><dt>Модератор</dt><dd>{diagnosticBoolean(participant?.moderator)}</dd></div>
            <div><dt>Подписчик</dt><dd>{diagnosticBoolean(participant?.subscriber)}</dd></div>
            <div><dt>Фолловер</dt><dd>{diagnosticBoolean(participant?.follower)}</dd></div>
            <div><dt>Взаимная подписка</dt><dd>{diagnosticBoolean(participant?.mutualFollow)}</dd></div>
            <div><dt>Даритель</dt><dd>{diagnosticBoolean(participant?.giftGiver)}</dd></div>
            <div><dt>Автор эфира</dt><dd>{diagnosticBoolean(participant?.anchor)}</dd></div>
            <div><dt>Верифицирован</dt><dd>{diagnosticBoolean(participant?.verified)}</dd></div>
            <div><dt>secUid получен</dt><dd>{participant?.secUidAvailable ? 'да, скрыт' : 'нет'}</dd></div>
            <div><dt>Уровень дарителя</dt><dd>{participant?.gifterLevel ?? 'нет данных'}</dd></div>
            <div><dt>Фан-клуб</dt><dd>{participant?.fanClubName ?? 'нет данных'}{participant?.fanClubLevel !== undefined ? ` · уровень ${participant.fanClubLevel}` : ''}</dd></div>
            <div><dt>Подписчики профиля</dt><dd>{participant?.followerCount ?? 'нет данных'}</dd></div>
            <div><dt>Подписки профиля</dt><dd>{participant?.followingCount ?? 'нет данных'}</dd></div>
            <div><dt>Язык сообщения</dt><dd>{message.language ?? 'нет данных'}</dd></div>
            <div><dt>Упоминания</dt><dd>{message.mentionedUsernames?.map((name) => `@${name}`).join(', ') || 'нет'}</dd></div>
          </dl>
        </li>;
      })}</ul>}
    </details> : null}
    {principal.isAdmin ? <NeuralTtsExperiment liveActive={updateBlockedByLive(realtime.connectionState)} /> : null}
    <details className="catalog-panel">
      <summary><span><b>Каталог подарков и звуков</b><small>{observedGifts.length} подарков · {mappings.length} привязок</small></span><span aria-hidden="true">Развернуть</span></summary>
      <div className="catalog-tools"><label>Поиск по названию, ID или звуку<input type="search" value={catalogQuery} placeholder="Например: Rose, 5655 или Пук" onChange={(event) => setCatalogQuery(event.target.value)} /></label><fieldset><legend>Показывать</legend><div className="filter-pills"><button type="button" className={catalogFilter === 'all' ? 'active' : ''} aria-pressed={catalogFilter === 'all'} onClick={() => setCatalogFilter('all')}>Все <span>{observedGifts.length}</span></button><button type="button" className={catalogFilter === 'unassigned' ? 'active' : ''} aria-pressed={catalogFilter === 'unassigned'} onClick={() => setCatalogFilter('unassigned')}>Без звука <span>{observedGifts.length - assignedGiftCount}</span></button><button type="button" className={catalogFilter === 'assigned' ? 'active' : ''} aria-pressed={catalogFilter === 'assigned'} onClick={() => setCatalogFilter('assigned')}>Настроенные <span>{assignedGiftCount}</span></button></div></fieldset></div>
      {filteredGifts.length === 0 ? <p className="catalog-empty">Ничего не найдено. Измените запрос или дождитесь новых подарков в эфире.</p> : <ul className="catalog-list">{filteredGifts.map((gift) => { const mapping = mappingByGift.get(gift.giftId); return <li key={gift.giftId}>{gift.imageUrl ? <img src={gift.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="catalog-placeholder" aria-hidden="true">🎁</span>}<div><strong>{gift.giftName}</strong><code>ID {gift.giftId}</code></div><div className={mapping ? 'mapping-state assigned' : 'mapping-state'}><span>{mapping ? 'Назначен звук' : 'Без звука'}</span><b>{mapping?.soundDisplayName ?? 'Выберите реакцию'}</b></div><button type="button" className="quiet" onClick={() => selectGiftForMapping(gift.giftId)}>Настроить</button></li>; })}</ul>}
    </details>
    <details className="sound-library-panel">
      <summary><span><b>Библиотека звуков</b><small>{sounds.filter((sound) => sound.status === 'active').length} доступно · {sounds.filter((sound) => sound.status === 'quarantined').length} в карантине</small></span><span aria-hidden="true">Развернуть</span></summary>
      <ul className="sound-library-list">{sounds.map((sound) => <li key={sound.id} className={sound.status === 'quarantined' ? 'is-quarantined' : ''}>
        <div><strong>{sound.displayName}</strong><code>ID {sound.id}</code><small>{sound.status === 'quarantined' ? `Карантин: ${sound.quarantineReason}` : sound.isOwnedByCurrentUser ? 'Загружен вами' : 'Общий звук'} · привязок: {sound.usageCount}</small></div>
        <div className="actions">{sound.status === 'active' ? <button type="button" className="secondary" onClick={() => { setSelectedSoundId(sound.id); previewSoundById(sound.id); }}>Прослушать</button> : null}{sound.canQuarantine ? <button type="button" className="danger" onClick={() => void quarantineSound(sound)}>В карантин</button> : null}{sound.canDelete ? <button type="button" className="danger" onClick={() => void deleteSound(sound)}>Удалить</button> : null}</div>
      </li>)}</ul>
    </details>
    {automationStatus === 'loading' ? <AutomationStatus status="loading" /> : null}
    {automationStatus === 'error' ? <AutomationStatus status="error" onRetry={() => void reloadAutomation()} /> : null}
    {automationStatus === 'ready' && automation ? <AutomationEditor key={workspaceId} workspaceId={workspaceId} configuration={automation} sounds={sounds} speechSupported={speechSupported} speechQueue={speechQueue} onConfigurationChange={setAutomation} onPreviewSound={previewSoundById} onNotice={setNotice} /> : null}
    <section className="control-grid" aria-label="Настройки звука">
      <div className="control-card audio-card"><p className="section-kicker">Эта вкладка</p><h2>Звук</h2><p>{audioEnabled ? (speechSupported ? 'Подарки и разрешённые сообщения озвучиваются здесь.' : 'Звуки работают, синтез речи в этом браузере недоступен.') : 'Браузеру нужно разрешить звук одним нажатием.'}</p>{audioEnabled ? <small>{audioCacheStatus === 'warming' ? `Подготавливаем используемые звуки: ${warmSounds.length}` : audioCacheStatus === 'fallback' ? 'Часть звуков будет загружаться обычным способом' : `Используемые звуки готовы: ${warmSounds.length}`}</small> : null}<div className="actions"><button type="button" disabled={!workspaceReady} onClick={() => void enableAudio()}>{audioEnabled ? 'Звук включён' : workspaceReady ? 'Включить звук' : 'Загружаем звуки…'}</button><button type="button" className="danger" onClick={() => { player.current.stopAll(); speechQueue?.stop(); setNotice('Все звуки и очередь остановлены'); }}>Стоп / очистить очередь</button></div></div>
      <form className="control-card mapping-card" onSubmit={(event) => void saveMapping(event)}><p className="section-kicker">Реакция на подарок</p><h2>Привязка звука</h2><label>Замеченный подарок<select ref={mappingInput} value={giftId} onChange={(event) => setGiftId(event.target.value)}><option value="">Сначала дождитесь подарка в эфире</option>{observedGifts.map((gift) => <option key={gift.giftId} value={gift.giftId}>{gift.giftName} · ID {gift.giftId}</option>)}</select></label><label>Звук<select value={selectedSoundId} onChange={(event) => setSelectedSoundId(event.target.value)}>{sounds.filter((sound) => sound.status === 'active').map((sound) => <option key={sound.id} value={sound.id}>{sound.displayName}</option>)}</select></label><div className="upload-box"><strong>Добавить свой звук</strong><span>WAV, MP3, OGG или M4A · до 10 МБ</span><label className="file-picker"><input ref={soundFileInput} aria-label="Аудиофайл" type="file" accept=".wav,.mp3,.ogg,.m4a,audio/wav,audio/mpeg,audio/ogg,audio/mp4" onChange={(event) => setSoundFile(event.target.files?.[0] ?? null)} /><span className="file-picker-button">Выбрать файл</span><span className="file-picker-name">{soundFile?.name ?? 'Файл не выбран'}</span></label><button type="button" className="secondary" disabled={!soundFile || isUploadingSound} onClick={() => void uploadSound()}>{isUploadingSound ? 'Загружаем…' : 'Загрузить и выбрать'}</button></div><div className="actions"><button type="button" className="secondary" onClick={previewSound}>Прослушать</button><button type="submit" disabled={!giftId || !selectedSoundId}>Сохранить привязку</button></div><p className="helper">В базе подарков: {observedGifts.length}. Сохранено привязок: {mappings.length}</p></form>
      <form className="control-card settings-card" onSubmit={(event) => void saveSettings(event)}><p className="section-kicker">Поведение серии</p><h2>Наложение</h2><label>Режим<select value={settings.playbackMode} onChange={(event) => setSettings((current) => ({ ...current, playbackMode: event.target.value as UpdateWorkspaceSettings['playbackMode'] }))}><option value="controlled_overlap">Умеренное наложение</option><option value="sequential">Последовательно</option><option value="strong_overlap">Сильное наложение</option></select></label><label>Перекрытие звука <output>{settings.overlapPercent}%</output><input type="range" min="0" max="100" value={settings.overlapPercent} onChange={(event) => setSettings((current) => ({ ...current, overlapPercent: event.target.valueAsNumber }))} /></label><div className="two-fields"><label>Одновременно<input type="number" min="1" max="32" value={settings.maxConcurrentSounds} onChange={(event) => setSettings((current) => ({ ...current, maxConcurrentSounds: event.target.valueAsNumber }))} /></label><label>Громкость <output>{settings.volumePercent}%</output><input type="range" min="0" max="100" value={settings.volumePercent} onChange={(event) => setSettings((current) => ({ ...current, volumePercent: event.target.valueAsNumber }))} /></label></div><button type="submit">Сохранить настройки</button></form>
    </section>
    <footer><span>Короткая история чата хранится только в памяти сервера.</span><SourceLink /></footer>
  </main>;
}
