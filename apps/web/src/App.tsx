import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AutomationConfiguration, AuthPrincipal, ChatEvent, GiftCompletedEvent, GiftEvent, GiftGoalState, GiftSoundMapping, ObservedGift, RealtimeEvent, RecentChannel, RegionalGift, RegionalGiftRegion, SaveGiftGoal, SaveLikeGoal, SoundAsset, SupportLevelGrantedEvent, UpdateGiftSoundMapping, UpdateWorkspaceSettings, WorkspaceSettings } from '@tiktok-helper/contracts';
import { isLivePollState, type CloseLivePoll, type StartLivePoll } from '@tiktok-helper/contracts/live-poll';
import { appPath, USES_CABINET } from './app-path.js';
import { AudioOwnership, SoundPlaybackQueue } from './audio/playback.js';
import { AudioProfileSwitch } from './audio-profiles/AudioProfileSwitch.js';
import { QuietProfileEditor } from './audio-profiles/QuietProfileEditor.js';
import { readAudioProfile, resolveAudioProfile, saveAudioProfileMode, saveQuietProfileOptions, type AudioProfileMode, type QuietProfileOptions } from './audio-profiles/model.js';
import { operatorEventCount } from './event-model.js';
import { createRealtimeClient, EMPTY_REALTIME_STATE, type RealtimeClient, type RealtimeViewState } from './realtime/client.js';
import { DEFAULT_SETTINGS } from './settings-model.js';
import { beginLogin, endSession, loadAccess, loadSession } from './auth-client.js';
import { SpeechPolicyEngine } from './speech/policy.js';
import { browserSpeechSynthesisSupported, SpeechPlaybackQueue } from './speech/playback.js';
import { NeuralTtsExperiment } from './speech/NeuralTtsExperiment.js';
import { AutomationEditor, AutomationStatus } from './automation/AutomationEditor.js';
import { ReactionCheck, type ReactionCheckHandle } from './automation/ReactionCheck.js';
import { APPLICATION_SOURCE } from './source-link.js';
import { genericInstallInstructions, type PwaLifecycle, updateBlockedByLive, usePwaLifecycle } from './pwa/lifecycle.js';
import { TutorialGuide } from './tutorial/TutorialGuide.js';
import { LiveFeeds } from './LiveFeeds.js';
import { GiftGoalPanel } from './gift-goal/GiftGoalPanel.js';
import { StreamOverlayControls } from './gift-goal-overlay/GiftGoalOverlayControls.js';
import { LiveActivityPanel } from './live-activity/LiveActivityPanel.js';
import { LivePollPanel } from './live-poll/LivePollPanel.js';
import { CatalogGiftImage } from './gifts/CatalogGiftImage.js';
import { RegionalGiftCatalog } from './gifts/RegionalGiftCatalog.js';
import './live-view.css';

const STATE_COPY = { stopped: 'Остановлен', connecting: 'Подключаемся…', live: 'В эфире', reconnecting: 'Восстанавливаем связь…', offline: 'Аккаунт сейчас не в эфире', failed: 'Не удалось подключиться' } as const;
const CONNECTION_NOTICE = { live: 'Эфир подключён — принимаем чат и подарки', reconnecting: 'Связь прервалась — подключаемся снова…', offline: 'Эфир завершён или аккаунт сейчас не в эфире', failed: 'Не удалось подключиться к эфиру' } as const;
const LIVE_VIEW_DUPLICATE_NOTICES = new Set([
  'Готово к работе', 'Звук и озвучивание включены в этой вкладке', 'Звук включён в тихом профиле', ...Object.values(CONNECTION_NOTICE),
]);
type SessionState = { status: 'loading' } | { status: 'anonymous'; loginFailed?: boolean } | { status: 'error' } | { status: 'authenticated'; principal: AuthPrincipal; mode: 'local' | 'vline' };
const AUTH_ERROR_COPY: Record<string, string> = {
  subscription_required: 'Для доступа нужна активная подписка VLine.',
  subscription_expired: 'Срок подписки VLine закончился. Продлите её и попробуйте войти снова.',
  subscription_frozen: 'Подписка VLine сейчас заморожена. Возобновите её и попробуйте войти снова.',
  account_disabled: 'Учётная запись VLine недоступна. Обратитесь в поддержку.',
  access_verification_unavailable: 'Не удалось проверить доступ. Попробуйте войти ещё раз.',
};

function diagnosticBoolean(value: boolean | undefined): string {
  return value === undefined ? 'нет данных' : value ? 'да' : 'нет';
}

export function App() {
  const [entry] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('auth_error');
    const authError = code === null ? null : Object.hasOwn(AUTH_ERROR_COPY, code)
      ? AUTH_ERROR_COPY[code]! : 'Не удалось подтвердить вход через VLine. Попробуйте войти снова.';
    return { authError, fromCabinet: params.get('from') === 'cabinet' };
  });
  const [sessionState, setSessionState] = useState<SessionState>({ status: USES_CABINET && entry.authError ? 'anonymous' : 'loading' });
  const [liveSessionActive, setLiveSessionActive] = useState(false);
  const pwa = usePwaLifecycle();
  useEffect(() => {
    if (entry.authError) {
      if (USES_CABINET) return;
      const url = new URL(window.location.href);
      url.searchParams.delete('auth_error');
      window.history.replaceState(window.history.state, '', url);
    }
    const controller = new AbortController();
    void loadSession(controller.signal).then(async (session) => {
      if (controller.signal.aborted) return;
      if (USES_CABINET && (!session || entry.fromCabinet)) {
        try { await beginLogin(); }
        catch { if (!controller.signal.aborted) setSessionState({ status: 'anonymous', loginFailed: true }); }
        return;
      }
      setSessionState(session ? { status: 'authenticated', principal: session.user, mode: session.mode } : { status: 'anonymous' });
    }).catch(() => {
      if (!controller.signal.aborted) setSessionState({ status: 'error' });
    });
    return () => controller.abort();
  }, [entry]);

  const onLoggedOut = useCallback(() => setSessionState({ status: 'anonymous' }), []);
  let content;
  if (sessionState.status === 'loading') content = <AccessScreen title="Проверяем вход…" message="Подготавливаем ваше рабочее место." />;
  else if (sessionState.status === 'anonymous') content = <LoginScreen authError={entry.authError} loginFailed={sessionState.loginFailed} />;
  else if (sessionState.status === 'error') content = <AccessScreen title="Сервис входа недоступен" message="Обновите страницу через минуту. Настройки и звуки останутся на месте." retry />;
  else content = <AuthenticatedApp key={`${sessionState.mode}:${sessionState.principal.userId}`}
    principal={sessionState.principal} authMode={sessionState.mode} onLoggedOut={onLoggedOut} pwa={pwa}
    onLiveSessionActiveChange={setLiveSessionActive} />;

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
  return <main className="access-shell"><section className="access-card"><p className="eyebrow">TikTokHelper</p><h1>{title}</h1><p>{message}</p>{retry ? <><button type="button" onClick={() => window.location.reload()}>Попробовать снова</button><CabinetLink /></> : null}<SourceLink /></section></main>;
}

function LoginScreen({ authError, loginFailed = false }: { authError: string | null; loginFailed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(loginFailed);
  async function login() {
    setBusy(true); setFailed(false);
    try { await beginLogin(); } catch { setBusy(false); setFailed(true); }
  }
  return <main className="access-shell"><section className="access-card"><p className="eyebrow">TikTokHelper</p><h1>Пульт трансляции</h1><p>Войдите через аккаунт VLine, чтобы открыть свои эфиры, звуки и привязки подарков.</p>{authError ? <p className="access-error" role="alert">{authError}</p> : null}<button type="button" disabled={busy} onClick={() => void login()}>{busy ? 'Открываем VLine…' : 'Войти через VLine'}</button>{failed ? <p className="access-error" role="alert">Не удалось начать вход. Проверьте соединение и попробуйте снова.</p> : null}<CabinetLink /><SourceLink /></section></main>;
}

function CabinetLink({ live = false }: { live?: boolean }) {
  if (!USES_CABINET) return null;
  return <a className="cabinet-link" href="/cabinet" target={live ? '_blank' : undefined} rel={live ? 'noopener' : undefined}>
    {live ? 'Открыть кабинет в новой вкладке' : 'В кабинет'}
  </a>;
}

function SourceLink() {
  return <a className="source-link" href={APPLICATION_SOURCE.url} target="_blank" rel="noreferrer" title={`Исходный код версии ${APPLICATION_SOURCE.revision}`}><span>Исходный код</span><code>{APPLICATION_SOURCE.label}</code></a>;
}

function AuthenticatedApp({ principal, authMode, onLoggedOut, pwa, onLiveSessionActiveChange }: { principal: AuthPrincipal; authMode: 'local' | 'vline'; onLoggedOut: () => void; pwa: PwaLifecycle; onLiveSessionActiveChange: (active: boolean) => void }) {
  const [workspaceId, setWorkspaceId] = useState(() => {
    const saved = sessionStorage.getItem('tiktok-helper.workspace');
    return principal.workspaces.some((workspace) => workspace.id === saved) ? saved! : (principal.workspaces[0]?.id ?? '');
  });
  const workspacePath = appPath(`api/workspaces/${encodeURIComponent(workspaceId)}`);
  const currentWorkspace = useRef(workspaceId);
  const [settings, setSettings] = useState<UpdateWorkspaceSettings>(DEFAULT_SETTINGS);
  const [audioProfile, setAudioProfile] = useState(() => readAudioProfile(workspaceId));
  const audioOutput = useMemo(() => resolveAudioProfile(settings, audioProfile), [settings, audioProfile]);
  const [notice, setNotice] = useState('Загружаем рабочее место…');
  const [accessWarning, setAccessWarning] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeViewState>(EMPTY_REALTIME_STATE);
  const [sounds, setSounds] = useState<SoundAsset[]>([]);
  const [mappings, setMappings] = useState<GiftSoundMapping[]>([]);
  const [gifts, setGifts] = useState<ObservedGift[]>([]);
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [automation, setAutomation] = useState<AutomationConfiguration | null>(null);
  const [automationStatus, setAutomationStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceSettingsLoaded, setWorkspaceSettingsLoaded] = useState(false);
  const [soundLibraryLoaded, setSoundLibraryLoaded] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
  const [giftSelection, setGiftSelection] = useState('');
  const [regionalChoice, setRegionalChoice] = useState<{ region: RegionalGiftRegion; gift: RegionalGift } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [soundSelection, setSoundSelection] = useState<string | null>(null);
  const [soundFile, setSoundFile] = useState<File | null>(null);
  const [isUploadingSound, setIsUploadingSound] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioCacheStatus, setAudioCacheStatus] = useState<'idle' | 'warming' | 'ready' | 'fallback'>('idle');
  const [liveOnly, setLiveOnly] = useState(false);
  const realtimeClient = useRef<RealtimeClient | null>(null);
  const reactionCheck = useRef<ReactionCheckHandle | null>(null);
  const liveEntry = useRef<HTMLButtonElement>(null);
  const liveHeading = useRef<HTMLHeadingElement>(null);
  const consoleScroll = useRef(0);
  const returnFocus = useRef<'entry' | 'mapping' | null>(null);
  const mappingInput = useRef<HTMLSelectElement | null>(null);
  const soundFileInput = useRef<HTMLInputElement | null>(null);
  const [player] = useState(() => new SoundPlaybackQueue(undefined, (reason) => setNotice(reason === 'controlled_volume_unavailable'
    ? 'Браузер не смог ограничить громкость. Этот звук пропущен.' : 'Браузер не смог воспроизвести звук')));
  const speechPolicy = useRef(new SpeechPolicyEngine());
  const [speechSupported] = useState(() => browserSpeechSynthesisSupported());
  const [speechQueue] = useState(() => speechSupported ? new SpeechPlaybackQueue() : null);
  const ownership = useRef<AudioOwnership | null>(null);
  const automationRef = useRef<AutomationConfiguration | null>(null);
  const soundsRef = useRef<ReadonlyMap<string, SoundAsset>>(new Map());
  const mappingsRef = useRef<ReadonlyMap<string, GiftSoundMapping>>(new Map());
  const audioOutputRef = useRef(audioOutput);
  const audioEnabledRef = useRef(audioEnabled);
  const soundLibraryRequest = useRef(0);
  useEffect(() => { automationRef.current = automation; }, [automation]);
  useEffect(() => { soundsRef.current = new Map(sounds.map((sound) => [sound.id, sound])); }, [sounds]);
  useEffect(() => { mappingsRef.current = new Map(mappings.map((mapping) => [mapping.giftId, mapping])); }, [mappings]);
  useLayoutEffect(() => {
    const previous = audioOutputRef.current;
    audioOutputRef.current = audioOutput;
    speechQueue?.setVolumeLimit(audioOutput.speechVolumeLimit);
    const modeChanged = previous.playback.requiresControlledVolume !== audioOutput.playback.requiresControlledVolume;
    const quietSettingsChanged = audioOutput.playback.requiresControlledVolume && (
      previous.playback.volumePercent !== audioOutput.playback.volumePercent || previous.speechEnabled !== audioOutput.speechEnabled
      || previous.speechVolumeLimit !== audioOutput.speechVolumeLimit
    );
    if (modeChanged || quietSettingsChanged) {
      player.stopAll();
      speechQueue?.stop();
    }
  }, [audioOutput, player, speechQueue]);
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

  const playReaction = useCallback((reaction: ReturnType<SpeechPolicyEngine['evaluateParticipantSeen']>, maxQueueSize: number) => {
    const output = audioOutputRef.current;
    if (reaction.speech && output.speechEnabled) speechQueue?.enqueue(reaction.speech, maxQueueSize);
    for (const soundAssetId of reaction.soundAssetIds) {
      const sound = soundsRef.current.get(soundAssetId);
      if (sound?.status === 'active') player.enqueue(sound, 1, output.playback);
    }
  }, [player, speechQueue]);

  const handleSupportLevelGranted = useCallback((event: SupportLevelGrantedEvent) => {
    const config = automationRef.current;
    if (!audioEnabledRef.current || !config) return;
    playReaction(speechPolicy.current.evaluateGrant(event, config), config.policy.maxQueueSize);
  }, [playReaction]);

  const handleGiftCompleted = useCallback((event: GiftCompletedEvent) => {
    const config = automationRef.current;
    if (!audioEnabledRef.current || !config) return;
    const reaction = speechPolicy.current.evaluateGiftCompletion(event, config, (id) => soundsRef.current.get(id)?.status === 'active');
    if (reaction) playReaction(reaction, config.policy.maxQueueSize);
  }, [playReaction]);

  const handleGiftGoalReached = useCallback(({ configuration }: GiftGoalState) => {
    if (!audioEnabledRef.current || !configuration?.soundAssetId) return;
    const sound = soundsRef.current.get(configuration.soundAssetId);
    if (sound?.status === 'active') player.enqueue(sound, 1, audioOutputRef.current.playback);
  }, [player]);

  const handleLiveEvent = useCallback((event: RealtimeEvent) => {
    if (!audioEnabledRef.current || event.type === 'connection.state') return;
    const config = automationRef.current;
    if (event.type === 'gift.received') {
      const mapping = mappingsRef.current.get(event.giftId);
      const sound = mapping?.isEnabled ? soundsRef.current.get(mapping.soundAssetId) : undefined;
      if (sound?.status === 'active') player.enqueue(sound, event.repeatCount, audioOutputRef.current.playback);
      if (config) playReaction(speechPolicy.current.evaluateParticipantSeen('donor_seen', event, config), config.policy.maxQueueSize);
      return;
    }
    if (!config) return;
    const maxQueue = config.policy.maxQueueSize;
    if (event.speakerContext?.isModerator) playReaction(speechPolicy.current.evaluateParticipantSeen('moderator_seen', event, config), maxQueue);
    if (event.speakerContext?.isGiftGiver) playReaction(speechPolicy.current.evaluateParticipantSeen('donor_seen', event, config), maxQueue);
    if (audioOutputRef.current.speechEnabled) {
      const job = speechPolicy.current.evaluateChat(event, config);
      if (job) speechQueue?.enqueue(job, maxQueue);
    }
  }, [playReaction, player, speechQueue]);

  const reloadSoundLibrary = useCallback(async (changedSoundId?: string) => {
    const request = ++soundLibraryRequest.current;
    if (changedSoundId) {
      player.stopAll();
      const availableSounds = new Map(soundsRef.current);
      availableSounds.delete(changedSoundId);
      soundsRef.current = availableSounds;
      setSounds((current) => current.filter((sound) => sound.id !== changedSoundId));
    }
    const [soundsResponse, mappingsResponse] = await Promise.all([
      fetch(`${workspacePath}/sounds`),
      fetch(`${workspacePath}/gift-mappings`),
    ]);
    if (!soundsResponse.ok || !mappingsResponse.ok) {
      if (request === soundLibraryRequest.current) setNotice('Не удалось обновить библиотеку звуков. Обновите страницу.');
      return;
    }
    const loadedSounds = await soundsResponse.json() as SoundAsset[];
    const loadedMappings = await mappingsResponse.json() as GiftSoundMapping[];
    if (request !== soundLibraryRequest.current) return;
    setSounds(loadedSounds); setMappings(loadedMappings);
    setSoundLibraryLoaded(true);
    setSoundSelection((current) => loadedSounds.some((sound) => sound.id === current && sound.status === 'active') ? current : null);
    if (changedSoundId) {
      setNotice('Библиотека звуков обновлена — очередь воспроизведения очищена');
    }
  }, [player, workspacePath]);

  const refreshChangedSound = useCallback((soundId: string) => {
    void reloadSoundLibrary(soundId).catch(() => setNotice('Не удалось обновить библиотеку звуков. Обновите страницу.'));
  }, [reloadSoundLibrary]);

  useEffect(() => {
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && currentWorkspace.current === workspaceId;
    const soundRequest = soundLibraryRequest.current;
    void Promise.all([
      fetch(`${workspacePath}/settings`, { signal: controller.signal }),
      fetch(`${workspacePath}/sounds`, { signal: controller.signal }),
      fetch(`${workspacePath}/gift-mappings`, { signal: controller.signal }),
      fetch(`${workspacePath}/gifts`, { signal: controller.signal }),
      fetch(`${workspacePath}/recent-channels`, { signal: controller.signal }),
      fetch(`${workspacePath}/automation`, { signal: controller.signal }),
    ]).then(async ([settingsResponse, soundsResponse, mappingsResponse, giftsResponse, recentChannelsResponse, automationResponse]) => {
      if (!isCurrent()) return;
      if ([settingsResponse, soundsResponse, mappingsResponse, giftsResponse, recentChannelsResponse, automationResponse].some((response) => response.status === 401)) {
        onLoggedOut(); return;
      }
      if (settingsResponse.ok) {
        const loaded = await settingsResponse.json() as WorkspaceSettings;
        if (!isCurrent()) return;
        setSettings(loaded);
        setWorkspaceSettingsLoaded(true);
      }
      const [loadedSounds, loadedMappings] = await Promise.all([
        soundsResponse.ok ? soundsResponse.json() as Promise<SoundAsset[]> : null,
        mappingsResponse.ok ? mappingsResponse.json() as Promise<GiftSoundMapping[]> : null,
      ]);
      if (!isCurrent()) return;
      if (soundRequest === soundLibraryRequest.current) {
        if (loadedSounds) setSounds(loadedSounds);
        if (loadedMappings) setMappings(loadedMappings);
        setSoundLibraryLoaded(Boolean(loadedSounds && loadedMappings));
      }
      if (giftsResponse.ok) {
        const loaded = await giftsResponse.json() as ObservedGift[];
        if (!isCurrent()) return;
        setGifts(loaded);
        setGiftSelection((current) => current || loaded[0]?.giftId || '');
      }
      if (recentChannelsResponse.ok) {
        const loaded = await recentChannelsResponse.json() as RecentChannel[];
        if (!isCurrent()) return;
        setRecentChannels(loaded);
      }
      if (automationResponse.ok) {
        const loaded = await automationResponse.json() as AutomationConfiguration;
        if (!isCurrent()) return;
        setAutomation(loaded);
        setAutomationStatus('ready');
      } else setAutomationStatus('error');
      setWorkspaceReady(true);
      setNotice('Готово к работе');
    }).catch(() => {
      if (isCurrent()) {
        setAutomationStatus('error');
        setNotice('Не удалось загрузить настройки');
      }
    });
    return () => controller.abort();
  }, [onLoggedOut, workspaceId, workspacePath]);

  useEffect(() => {
    let previous = EMPTY_REALTIME_STATE;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && currentWorkspace.current === workspaceId;
    function whileCurrent<T>(receive: (value: T) => void) {
      return (value: T) => { if (isCurrent()) receive(value); };
    }
    const verifyInterruptedSession = USES_CABINET ? () => {
      if (!isCurrent()) return;
      void loadSession(controller.signal).then((session) => {
        if (!isCurrent()) return;
        if (!session || session.user.userId !== principal.userId || session.user.isAdmin !== principal.isAdmin ||
            !session.user.workspaces.some((workspace) => workspace.id === workspaceId)) onLoggedOut();
        else setNotice('Соединение с пультом закрыто. Чтобы восстановить его, откройте TikTokHelper из кабинета.');
      }).catch(() => {
        if (isCurrent()) setNotice('Не удалось проверить вход. Проверьте доступ в кабинете.');
      });
    } : undefined;
    const client = createRealtimeClient(workspaceId, whileCurrent((next: RealtimeViewState) => {
      if (next.generation !== previous.generation ||
          (next.connectionId && previous.connectionId && next.connectionId !== previous.connectionId) ||
          next.lastSequence < previous.lastSequence) {
        speechPolicy.current.reset();
        player.stopAll();
        speechQueue?.stop();
      }
      if (next.connectionState !== previous.connectionState) {
        if (next.connectionState in CONNECTION_NOTICE) {
          setNotice(CONNECTION_NOTICE[next.connectionState as keyof typeof CONNECTION_NOTICE]);
        }
      }
      previous = next;
      setRealtime(next);
    }), undefined, whileCurrent(refreshChangedSound), whileCurrent(handleSupportLevelGranted), verifyInterruptedSession, whileCurrent(handleLiveEvent),
    whileCurrent(handleGiftCompleted), whileCurrent(handleGiftGoalReached));
    realtimeClient.current = client;
    return () => { controller.abort(); realtimeClient.current = null; client.close(); };
  }, [handleGiftCompleted, handleGiftGoalReached, handleLiveEvent, handleSupportLevelGranted, onLoggedOut, player, principal.isAdmin, principal.userId, refreshChangedSound, speechQueue, workspaceId]);
  useEffect(() => {
    const owner = new AudioOwnership(() => {
      audioEnabledRef.current = false;
      setAudioEnabled(false); player.stopAll(); speechQueue?.stop(); setNotice('Звук включён в другой вкладке');
    });
    ownership.current = owner;
    return () => { owner.close(); player.stopAll(); speechQueue?.stop(); };
  }, [player, speechQueue]);

  const savedMappingByGift = useMemo(() => new Map(mappings.map((item) => [item.giftId, item])), [mappings]);
  const mappingByGift = useMemo(() => new Map([...savedMappingByGift].filter(([, mapping]) => mapping.isEnabled)), [savedMappingByGift]);
  const soundById = useMemo(() => new Map(sounds.map((sound) => [sound.id, sound])), [sounds]);
  const goalSoundId = realtime.giftGoal?.configuration?.isEnabled ? realtime.giftGoal.configuration.soundAssetId : null;
  const warmSounds = useMemo(() => {
    const ids = new Set(mappings.filter((mapping) => mapping.isEnabled).map((mapping) => mapping.soundAssetId));
    for (const level of automation?.supportLevels ?? []) if (level.isEnabled && level.soundAssetId) ids.add(level.soundAssetId);
    for (const reaction of automation?.eventReactions ?? []) if (reaction.isEnabled && reaction.soundAssetId) ids.add(reaction.soundAssetId);
    if (goalSoundId) ids.add(goalSoundId);
    return [...ids].map((id) => soundById.get(id)).filter((sound): sound is SoundAsset => sound?.status === 'active');
  }, [automation, goalSoundId, mappings, soundById]);
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
    return [...catalogue.values()].sort((left, right) => (right.lastSeenAt ?? '').localeCompare(left.lastSeenAt ?? ''));
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
  const draftGift: ObservedGift | null = regionalChoice && !observedGifts.some((gift) => gift.giftId === regionalChoice.gift.giftId)
    ? { ...regionalChoice.gift, firstSeenAt: null, lastSeenAt: null } : null;
  const mappingGifts = draftGift ? [draftGift, ...observedGifts] : observedGifts;
  const selectedGift = mappingGifts.find((gift) => gift.giftId === giftSelection);
  const giftId = selectedGift?.giftId ?? '';
  const savedMapping = savedMappingByGift.get(giftId);
  const mappedSound = soundById.get(mappingByGift.get(giftId)?.soundAssetId ?? '');
  const selectedSoundId = soundSelection ?? (mappedSound?.status === 'active' ? mappedSound.id : '');
  const reactionCheckDisabled = realtime.connectionState !== 'stopped' ? 'Нажмите «Остановить», чтобы проверить реакцию перед эфиром.'
    : !realtime.isTransportConnected || !realtime.hasCurrentSnapshot ? 'Ждём состояние подключения к эфиру.'
    : !workspaceReady ? 'Загружаем настройки звука…'
    : !workspaceSettingsLoaded || !soundLibraryLoaded ? 'Не удалось загрузить привязки или настройки звука. Обновите страницу.'
    : null;
  const liveActive = updateBlockedByLive(realtime.connectionState);
  const liveStateKnown = realtime.isTransportConnected && realtime.hasCurrentSnapshot;

  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current) setAudioCacheStatus(audioEnabled ? 'warming' : 'idle'); });
    if (!audioEnabled || !workspaceReady) return () => { current = false; };
    void player.reconcile(warmSounds).then(() => player.warm(warmSounds)).then((result) => {
      if (current) setAudioCacheStatus(result.failed > 0 ? 'fallback' : 'ready');
    });
    return () => { current = false; };
  }, [audioEnabled, player, warmSounds, workspaceReady]);

  useLayoutEffect(() => {
    if (liveOnly) {
      window.scrollTo(0, 0);
      liveHeading.current?.focus({ preventScroll: true });
      return;
    }
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target === 'mapping') {
      mappingInput.current?.focus({ preventScroll: true });
      mappingInput.current?.scrollIntoView({ block: 'center' });
    }
    if (target === 'entry') {
      window.scrollTo(0, consoleScroll.current);
      liveEntry.current?.focus({ preventScroll: true });
      liveEntry.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [liveOnly]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('Сохраняем настройки…');
    const client = realtimeClient.current;
    const response = await fetch(`${workspacePath}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) });
    if (client !== realtimeClient.current || currentWorkspace.current !== workspaceId) return;
    if (!response.ok) { setNotice('Настройки не сохранились. Проверьте значения.'); return; }
    const saved = await response.json() as WorkspaceSettings;
    if (client !== realtimeClient.current || currentWorkspace.current !== workspaceId) return;
    setSettings(saved); setNotice('Настройки сохранены');
  }
  async function connectLive() {
    const username = settings.tiktokUsername.trim(); if (!username) { setNotice('Введите TikTok ID'); return; }
    const client = realtimeClient.current;
    const pendingNotice = 'Ищем активную трансляцию…';
    setNotice(pendingNotice);
    const result = await client?.connectLive(username);
    if (client !== realtimeClient.current || currentWorkspace.current !== workspaceId) return;
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
      setNotice((current) => current === pendingNotice ? 'Команда принята — подключаемся…' : current);
      return;
    }
    setNotice('Сервер не принял команду подключения');
  }
  async function disconnectLive() {
    const client = realtimeClient.current;
    const result = await client?.disconnectLive();
    if (client === realtimeClient.current && currentWorkspace.current === workspaceId) {
      setNotice(result?.ok ? 'Подключение остановлено' : 'Не удалось остановить подключение');
    }
  }

  async function saveGiftGoal(input: SaveGiftGoal): Promise<void> {
    const client = realtimeClient.current;
    const response = await fetch(`${workspacePath}/gift-goal`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (client === realtimeClient.current && currentWorkspace.current === workspaceId) client?.refreshSnapshot();
  }

  async function saveLikeGoal(input: SaveLikeGoal): Promise<void> {
    const client = realtimeClient.current;
    const response = await fetch(`${workspacePath}/like-goal`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (client === realtimeClient.current && currentWorkspace.current === workspaceId) client?.refreshSnapshot();
  }

  async function updateLivePoll(method: 'POST' | 'PATCH', input: StartLivePoll | CloseLivePoll, pollId?: string): Promise<void> {
    const client = realtimeClient.current;
    const endpoint = workspacePath + '/live-polls' + (pollId ? '/' + encodeURIComponent(pollId) : '');
    const response = await fetch(endpoint, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (client !== realtimeClient.current || currentWorkspace.current !== workspaceId) return;
    if (!response?.ok) {
      client?.refreshSnapshot();
      if (response?.status === 401) onLoggedOut();
      if (response?.status === 409) throw new Error('Эфир или голосование изменились. Проверьте состояние и повторите.');
      if (response?.status === 403 || response?.status === 401) throw new Error('Нет доступа к управлению голосованием.');
      if (response?.status === 400) throw new Error('Проверьте вопрос и варианты ответа. Варианты должны различаться.');
      throw new Error('Не удалось подтвердить действие. Проверьте состояние голосования и повторите при необходимости.');
    }
    const next: unknown = await response.json().catch(() => null);
    if (client !== realtimeClient.current || currentWorkspace.current !== workspaceId) return;
    if (!isLivePollState(next) || next.workspaceId !== workspaceId) {
      client?.refreshSnapshot();
      throw new Error('Не удалось получить состояние голосования. Проверьте соединение.');
    }
    client?.applyLivePoll(next);
  }

  async function reloadAutomation() {
    setAutomationStatus('loading');
    const client = realtimeClient.current;
    const isCurrent = () => client === realtimeClient.current && currentWorkspace.current === workspaceId;
    try {
      const response = await fetch(`${workspacePath}/automation`);
      if (!isCurrent()) return;
      if (response.status === 401) { onLoggedOut(); return; }
      if (!response.ok) throw new Error();
      const loaded = await response.json() as AutomationConfiguration;
      if (!isCurrent()) return;
      setAutomation(loaded); setAutomationStatus('ready'); setNotice('Настройки озвучивания загружены');
    } catch {
      if (isCurrent()) {
        setAutomationStatus('error');
        setNotice('Настройки озвучивания пока недоступны');
      }
    }
  }
  async function enableAudio(): Promise<boolean> {
    ownership.current?.claim();
    const preview = mappedSound?.status === 'active' ? mappedSound : sounds.find((sound) => sound.status === 'active');
    const playback = audioOutputRef.current.playback;
    const audioReady = player.unlock(playback.maxConcurrentSounds, playback.requiresControlledVolume ? undefined : preview?.url);
    try { speechQueue?.unlock(); } catch { /* A speech failure does not prevent gift sounds. */ }
    try {
      await audioReady;
      audioEnabledRef.current = true;
      setAudioEnabled(true);
      setNotice(!audioOutputRef.current.speechEnabled ? 'Звук включён в тихом профиле'
        : speechSupported ? 'Звук и озвучивание включены в этой вкладке' : 'Звуки включены, но этот браузер не поддерживает озвучивание текста');
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      audioEnabledRef.current = false;
      setAudioEnabled(false); setNotice('Браузер не разрешил звук. Нажмите ещё раз.');
      return false;
    }
  }
  function stopAudio() {
    player.stopAll();
    speechQueue?.stop();
    setNotice('Текущий звук остановлен, очередь очищена. Новые реакции используют выбранный профиль.');
  }
  function changeAudioProfile(mode: AudioProfileMode) {
    if (audioProfile.mode === mode) return;
    setAudioProfile({ ...audioProfile, mode });
    const saved = saveAudioProfileMode(workspaceId, mode);
    const name = mode === 'quiet' ? 'Тихий' : 'Обычный';
    setNotice(saved ? `Профиль «${name}» включён` : `Профиль «${name}» действует до перезагрузки`);
  }
  function saveQuietProfile(quiet: QuietProfileOptions) {
    setAudioProfile({ ...audioProfile, quiet });
    setNotice(saveQuietProfileOptions(workspaceId, quiet) ? 'Тихий профиль сохранён' : 'Настройки тихого профиля действуют до перезагрузки');
  }
  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGift || !selectedSoundId) { setNotice('Выберите подарок и звук'); return; }
    const data: UpdateGiftSoundMapping = { giftId, soundAssetId: selectedSoundId, isEnabled: true };
    if (draftGift?.giftId === giftId && regionalChoice) data.catalogRegion = regionalChoice.region;
    try {
      const response = await fetch(`${workspacePath}/gift-mappings`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
      });
      if (currentWorkspace.current !== workspaceId) return;
      if (!response.ok) {
        setNotice(data.catalogRegion && response.status === 404
          ? 'Подарок больше не найден в списке региона или звук недоступен. Проверьте их и повторите.'
          : 'Не удалось сохранить привязку');
        return;
      }
      const saved = await response.json() as GiftSoundMapping;
      if (currentWorkspace.current !== workspaceId) return;
      setMappings((current) => [...current.filter((item) => item.giftId !== saved.giftId), saved]);
      if (data.catalogRegion) {
        setGifts((current) => current.some((gift) => gift.giftId === saved.giftId) ? current : [...current, selectedGift]);
        setRegionalChoice((current) => current?.gift.giftId === saved.giftId ? null : current);
      }
      setNotice(`Подарок ${selectedGift.giftName} привязан к звуку`);
    } catch {
      if (currentWorkspace.current === workspaceId) setNotice('Не удалось сохранить привязку. Проверьте соединение и повторите.');
    }
  }
  function previewSound() {
    previewSoundById(selectedSoundId);
  }
  function previewSoundById(soundId: string) {
    const sound = sounds.find((item) => item.id === soundId); if (!sound || sound.status !== 'active') return;
    const { volumePercent, requiresControlledVolume } = audioOutputRef.current.playback;
    if (requiresControlledVolume && volumePercent === 0) {
      setNotice('В тихом профиле текущая громкость звука 0%.');
      return;
    }
    if (requiresControlledVolume && player.busy) {
      setNotice('Дождитесь окончания звука или очистите очередь.');
      return;
    }
    ownership.current?.claim();
    void player.preview(sound, volumePercent, requiresControlledVolume).then(() => {
      audioEnabledRef.current = true;
      setAudioEnabled(true); setNotice('Проверочный звук воспроизводится');
    }).catch((error: unknown) => {
      if (!requiresControlledVolume && !(error instanceof DOMException && error.name === 'AbortError')) {
        audioEnabledRef.current = false;
        setAudioEnabled(false);
      }
    });
  }
  async function uploadSound() {
    if (!soundFile || isUploadingSound) return;
    setIsUploadingSound(true); setNotice(`Загружаем «${soundFile.name}»…`);
    try {
      const response = await fetch(`${workspacePath}/sounds?displayName=${encodeURIComponent(soundFile.name)}`, {
        method: 'POST', headers: { 'content-type': soundFile.type || 'application/octet-stream' }, body: soundFile,
      });
      if (!response.ok) {
        const message = response.status === 413 ? 'Файл слишком большой. Максимум 10 МБ.' : 'Формат не поддерживается. Используйте WAV, MP3, OGG или M4A.';
        setNotice(message); return;
      }
      const uploaded = await response.json() as SoundAsset;
      setSounds((current) => [...current, uploaded]); setSoundSelection(uploaded.id); setSoundFile(null);
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
    const response = await fetch(`${workspacePath}/sounds/${encodeURIComponent(sound.id)}/quarantine`, {
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
    const response = await fetch(`${workspacePath}/sounds/${encodeURIComponent(sound.id)}`, { method: 'DELETE' });
    if (!response.ok) {
      setNotice(response.status === 409 ? 'Звук используется: сначала удалите все привязки' : 'Не удалось удалить звук'); return;
    }
    await reloadSoundLibrary(sound.id); setNotice(`Звук «${sound.displayName}» удалён`);
  }
  function changeMappingGift(id: string) {
    setGiftSelection(id);
    setSoundSelection(null);
    setRegionalChoice((current) => current?.gift.giftId === id ? current : null);
  }
  function selectGiftForMapping(id: string) {
    changeMappingGift(id);
    if (liveOnly) {
      returnFocus.current = 'mapping';
      setLiveOnly(false);
      return;
    }
    mappingInput.current?.focus();
    mappingInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function selectRegionalGift(region: RegionalGiftRegion, gift: RegionalGift) {
    selectGiftForMapping(gift.giftId);
    setRegionalChoice({ region, gift });
  }
  function selectWorkspace(nextWorkspaceId: string) {
    currentWorkspace.current = nextWorkspaceId;
    sessionStorage.setItem('tiktok-helper.workspace', nextWorkspaceId);
    soundLibraryRequest.current += 1;
    setNotice('Загружаем рабочее место…');
    setWorkspaceReady(false);
    setWorkspaceSettingsLoaded(false); setSoundLibraryLoaded(false);
    setGiftSelection(''); setSoundSelection(null); setRegionalChoice(null);
    soundsRef.current = new Map(); mappingsRef.current = new Map(); automationRef.current = null;
    speechPolicy.current.reset(); player.stopAll(); speechQueue?.stop();
    setSettings(DEFAULT_SETTINGS);
    setRealtime(EMPTY_REALTIME_STATE);
    setSounds([]); setMappings([]); setGifts([]); setRecentChannels([]); setAutomation(null); setAutomationStatus('loading');
    setAudioProfile(readAudioProfile(nextWorkspaceId));
    setWorkspaceId(nextWorkspaceId);
  }

  return <main className={liveOnly ? 'console-shell live-only' : 'console-shell'}>
    <header className="topbar" hidden={liveOnly}>
      <div>
        <p className="eyebrow">TikTokHelper</p>
        <h1>Пульт трансляции</h1>
        <div className="topbar-links">
          <CabinetLink live={liveActive} />
          <TutorialGuide isAdmin={principal.isAdmin} />
        </div>
      </div>
      <div className="account-area">
        <div className="presence-pill" aria-live="polite"><span aria-hidden="true">●</span>Онлайн в TikTokHelper <b>{realtime.onlineUsers ?? '—'}</b></div>
        <div className={`live-pill state-${realtime.connectionState}`}><span aria-hidden="true">●</span>{STATE_COPY[realtime.connectionState]}</div>
        {!pwa.installed ? <button type="button" className="quiet install-app-button" onClick={() => void pwa.install()}>Установить</button> : null}
        <div className="account-control"><span>{principal.displayName ?? 'Пользователь VLine'}</span>{principal.workspaces.length > 1 ? <label>Рабочее место<select value={workspaceId} onChange={(event) => selectWorkspace(event.target.value)}>{principal.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.displayName}</option>)}</select></label> : <small>{principal.workspaces[0]?.displayName ?? 'Рабочее место не назначено'}</small>}{authMode === 'vline' ? <button type="button" className="quiet" onClick={() => void endSession().then(onLoggedOut).catch(() => setNotice('Не удалось выйти. Попробуйте ещё раз.'))}>Выйти</button> : null}</div>
      </div>
    </header>
    {liveOnly ? <header className="live-view-header">
      <div className="live-view-heading">
        <h1 ref={liveHeading} tabIndex={-1}>Только эфир</h1>
        <div className="live-view-status" role="status">
          <div className={`live-pill state-${liveStateKnown ? realtime.connectionState : 'stopped'}`}>
            <span aria-hidden="true">●</span>{liveStateKnown ? STATE_COPY[realtime.connectionState] : 'Ждём состояние эфира'}
          </div>
          <span className="live-view-transport">{realtime.isTransportConnected ? 'Браузер на связи' : 'Браузер без связи'}</span>
        </div>
      </div>
      <div className="live-view-actions">
        <button type="button" className={audioEnabled ? 'danger' : undefined} disabled={!workspaceReady}
          title={audioEnabled ? 'Остановить текущий звук и очистить очередь' : undefined}
          onClick={audioEnabled ? stopAudio : () => void enableAudio()}>{audioEnabled ? 'Остановить звук' : 'Включить звук'}</button>
        <button type="button" className="quiet live-view-return" onClick={() => {
          returnFocus.current = 'entry';
          setLiveOnly(false);
        }}>К пульту</button>
        <AudioProfileSwitch mode={audioProfile.mode} onChange={changeAudioProfile} />
      </div>
    </header> : null}
    <p className="notice" role="status" hidden={liveOnly && LIVE_VIEW_DUPLICATE_NOTICES.has(notice)}>{notice}</p>
    {accessWarning ? <p className="access-error" role="alert">{accessWarning} Уже подключённый эфир продолжит работать, но новое подключение будет недоступно.</p> : null}
    <section className="connection-panel" aria-labelledby="connection-title" hidden={liveOnly}>
      <div><h2 id="connection-title">Подключение</h2><p>TikTokHelper читает уже запущенный эфир — сам эфир запускается на телефоне.</p></div>
      <div className="username-field"><label><span>TikTok ID</span><input required value={settings.tiktokUsername} placeholder="@username" onChange={(event) => setSettings((current) => ({ ...current, tiktokUsername: event.target.value }))} /></label>{recentChannels.length > 0 ? <div className="recent-channels" aria-label="Недавние TikTok ID">{recentChannels.slice(0, 8).map((channel) => <button type="button" className="channel-chip" key={channel.tiktokUsername} onClick={() => setSettings((current) => ({ ...current, tiktokUsername: `@${channel.tiktokUsername}` }))}>@{channel.tiktokUsername}</button>)}</div> : <span className="field-hint">История появится после первого подключения.</span>}</div>
      <div className="actions">
        <button type="button" onClick={() => void connectLive()} disabled={!realtime.isTransportConnected}>Подключить эфир</button>
        <button type="button" className="secondary" onClick={() => void disconnectLive()}>Остановить</button>
        <button ref={liveEntry} type="button" className="quiet live-view-entry" onClick={() => {
          consoleScroll.current = window.scrollY;
          setLiveOnly(true);
        }}>Только эфир</button>
        <AudioProfileSwitch mode={audioProfile.mode} onChange={changeAudioProfile} />
      </div>
      <div className="connection-facts"><span>Браузер <b>{realtime.isTransportConnected ? 'на связи' : 'без связи'}</b></span><span>Чат и подарки <b>{operatorEventCount(realtime.events)}</b></span></div>
    </section>
    <LiveActivityPanel key={`activity:${workspaceId}`} state={realtime.liveActivity} isCurrent={liveStateKnown}
      isLive={realtime.connectionState === 'live'} liveOnly={liveOnly} onSave={saveLikeGoal}
      onRetry={() => realtimeClient.current?.refreshSnapshot()} />
    <GiftGoalPanel key={`gift-goal:${workspaceId}`} state={realtime.giftGoal} isCurrent={liveStateKnown}
      liveOnly={liveOnly} gifts={observedGifts} sounds={sounds} error={liveStateKnown && !realtime.giftGoal}
      onRetry={() => realtimeClient.current?.refreshSnapshot()} onSave={saveGiftGoal} onPreviewSound={previewSoundById} />
    <LivePollPanel key={`poll:${workspaceId}:${realtime.connectionId ?? ''}`} state={realtime.livePoll}
      isCurrent={liveStateKnown && realtime.livePoll !== null} isLive={realtime.connectionState === 'live'} liveOnly={liveOnly}
      onStart={(input) => updateLivePoll('POST', input)} onClose={(id) => updateLivePoll('PATCH', { status: 'closed' }, id)} />
    <div hidden={liveOnly}><StreamOverlayControls workspaceId={workspaceId} /></div>
    <LiveFeeds key={`${workspaceId}:${realtime.generation}:${realtime.connectionId ?? ''}`} chat={chatEvents} gifts={giftEvents} mappings={mappingByGift}
      liveOnly={liveOnly} liveActive={liveActive} onConfigureGift={selectGiftForMapping} />
    <div hidden={liveOnly}>
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
    {principal.isAdmin ? <NeuralTtsExperiment liveActive={liveActive} /> : null}
    <details className="catalog-panel" onToggle={(event) => setCatalogOpen(event.currentTarget.open)}>
      <summary><span><b>Каталог подарков и звуков</b><small>{observedGifts.length} подарков · {mappings.length} привязок</small></span><span aria-hidden="true">Развернуть</span></summary>
      {principal.isAdmin && catalogOpen && !liveOnly ? <RegionalGiftCatalog key={workspaceId}
        workspacePath={workspacePath} mappings={mappingByGift} onSelect={selectRegionalGift} /> : null}
      <div className="catalog-tools"><label>Поиск по названию, ID или звуку<input type="search" value={catalogQuery} placeholder="Например: Rose, 5655 или Пук" onChange={(event) => setCatalogQuery(event.target.value)} /></label><fieldset><legend>Показывать</legend><div className="filter-pills"><button type="button" className={catalogFilter === 'all' ? 'active' : ''} aria-pressed={catalogFilter === 'all'} onClick={() => setCatalogFilter('all')}>Все <span>{observedGifts.length}</span></button><button type="button" className={catalogFilter === 'unassigned' ? 'active' : ''} aria-pressed={catalogFilter === 'unassigned'} onClick={() => setCatalogFilter('unassigned')}>Без звука <span>{observedGifts.length - assignedGiftCount}</span></button><button type="button" className={catalogFilter === 'assigned' ? 'active' : ''} aria-pressed={catalogFilter === 'assigned'} onClick={() => setCatalogFilter('assigned')}>Настроенные <span>{assignedGiftCount}</span></button></div></fieldset></div>
      {filteredGifts.length === 0 ? <p className="catalog-empty">Ничего не найдено. Измените запрос или дождитесь новых подарков в эфире.</p> : <ul className="catalog-list">
        {filteredGifts.map((gift) => {
          const mapping = mappingByGift.get(gift.giftId);
          return <li key={gift.giftId}>
            <CatalogGiftImage key={gift.imageUrl} imageUrl={gift.imageUrl} />
            <div><strong>{gift.giftName}</strong><code>ID {gift.giftId}</code>
              {!gift.firstSeenAt ? <small>Из регионального каталога</small> : null}
            </div>
            <div className={mapping ? 'mapping-state assigned' : 'mapping-state'}>
              <span>{mapping ? 'Назначен звук' : 'Без звука'}</span>
              <b>{mapping?.soundDisplayName ?? 'Выберите реакцию'}</b>
            </div>
            <button type="button" className="quiet" onClick={() => selectGiftForMapping(gift.giftId)}>Настроить</button>
          </li>;
        })}
      </ul>}
    </details>
    <details className="sound-library-panel">
      <summary><span><b>Библиотека звуков</b><small>{sounds.filter((sound) => sound.status === 'active').length} доступно · {sounds.filter((sound) => sound.status === 'quarantined').length} в карантине</small></span><span aria-hidden="true">Развернуть</span></summary>
      <ul className="sound-library-list">{sounds.map((sound) => <li key={sound.id} className={sound.status === 'quarantined' ? 'is-quarantined' : ''}>
        <div><strong>{sound.displayName}</strong><code>ID {sound.id}</code><small>{sound.status === 'quarantined' ? `Карантин: ${sound.quarantineReason}` : sound.isOwnedByCurrentUser ? 'Загружен вами' : 'Общий звук'} · привязок: {sound.usageCount}</small></div>
        <div className="actions">{sound.status === 'active' ? <button type="button" className="secondary" onClick={() => { setSoundSelection(sound.id); previewSoundById(sound.id); }}>Прослушать</button> : null}{sound.canQuarantine ? <button type="button" className="danger" onClick={() => void quarantineSound(sound)}>В карантин</button> : null}{sound.canDelete ? <button type="button" className="danger" onClick={() => void deleteSound(sound)}>Удалить</button> : null}</div>
      </li>)}</ul>
    </details>
    {automationStatus === 'loading' ? <AutomationStatus status="loading" /> : null}
    {automationStatus === 'error' ? <AutomationStatus status="error" onRetry={() => void reloadAutomation()} /> : null}
    {automationStatus === 'ready' && automation ? <AutomationEditor key={workspaceId} workspaceId={workspaceId}
      configuration={automation} sounds={sounds} speechSupported={speechSupported} speechQueue={speechQueue}
      giftReactionCatalog={observedGifts} giftReactionCheckDisabledReason={reactionCheckDisabled}
      onCheckGiftReaction={(ruleId, trigger) => reactionCheck.current?.openGiftRule(ruleId, trigger)}
      onConfigurationChange={(next) => { if (currentWorkspace.current === workspaceId) setAutomation(next); }}
      onPreviewSound={previewSoundById} onNotice={(message) => { if (currentWorkspace.current === workspaceId) setNotice(message); }} /> : null}
    <section className="control-grid" aria-label="Настройки звука">
      <div className="control-card audio-card">
        <p className="section-kicker">Эта вкладка</p><h2>Звук</h2>
        <p>{!audioEnabled ? 'Браузеру нужно разрешить звук одним нажатием.'
          : !audioOutput.speechEnabled ? 'Озвучивание чата и реакций выключено в тихом профиле.'
          : speechSupported ? 'Подарки и разрешённые сообщения озвучиваются здесь.' : 'Звуки работают, синтез речи в этом браузере недоступен.'}</p>
        {audioEnabled ? <small>{audioCacheStatus === 'warming' ? `Подготавливаем используемые звуки: ${warmSounds.length}` : audioCacheStatus === 'fallback' ? 'Часть звуков будет загружаться обычным способом' : `Используемые звуки готовы: ${warmSounds.length}`}</small> : null}
        <div className="actions"><button type="button" disabled={!workspaceReady} onClick={() => void enableAudio()}>{audioEnabled ? 'Звук включён' : workspaceReady ? 'Включить звук' : 'Загружаем звуки…'}</button><button type="button" className="danger" onClick={stopAudio}>Стоп / очистить очередь</button></div>
        <QuietProfileEditor key={workspaceId} value={audioProfile.quiet} onSave={saveQuietProfile} />
      </div>
      <form className="control-card mapping-card" onSubmit={(event) => void saveMapping(event)}>
        <p className="section-kicker">Реакция на подарок</p>
        <h2>Привязка звука</h2>
        <label>Подарок
          <select ref={mappingInput} value={giftId} onChange={(event) => changeMappingGift(event.target.value)}>
            <option value="" disabled>{mappingGifts.length ? 'Выберите подарок' : 'В каталоге пока нет доступных подарков'}</option>
            {mappingGifts.map((gift) => <option key={gift.giftId} value={gift.giftId}>{gift.giftName} · ID {gift.giftId}</option>)}
          </select>
        </label>
        <label>Звук
          <select value={selectedSoundId} onChange={(event) => setSoundSelection(event.target.value)}>
            <option value="" disabled>Выберите звук</option>
            {sounds.filter((sound) => sound.status === 'active').map((sound) => <option key={sound.id} value={sound.id}>{sound.displayName}</option>)}
          </select>
        </label>
        <div className="upload-box">
          <strong>Добавить свой звук</strong><span>WAV, MP3, OGG или M4A · до 10 МБ</span>
          <label className="file-picker">
            <input ref={soundFileInput} aria-label="Аудиофайл" type="file" accept=".wav,.mp3,.ogg,.m4a,audio/wav,audio/mpeg,audio/ogg,audio/mp4" onChange={(event) => setSoundFile(event.target.files?.[0] ?? null)} />
            <span className="file-picker-button">Выбрать файл</span>
            <span className="file-picker-name">{soundFile?.name ?? 'Файл не выбран'}</span>
          </label>
          <button type="button" className="secondary" disabled={!soundFile || isUploadingSound} onClick={() => void uploadSound()}>
            {isUploadingSound ? 'Загружаем…' : 'Загрузить и выбрать'}
          </button>
        </div>
        <div className="actions">
          <button type="button" className="secondary" disabled={!selectedSoundId} onClick={previewSound}>Прослушать</button>
          <button type="submit" disabled={!giftId || !selectedSoundId}>Сохранить привязку</button>
        </div>
        <div className="reaction-check-entry">
          <ReactionCheck key={workspaceId} ref={reactionCheck} gift={selectedGift} gifts={observedGifts}
            savedMapping={savedMapping} sounds={soundById} audioOutput={audioOutput}
            automation={automation} disabledReason={reactionCheckDisabled} audioEnabled={audioEnabled}
            onEnableAudio={enableAudio} player={player} speechQueue={speechQueue} />
        </div>
        <p className="helper">В базе подарков: {observedGifts.length}. Сохранено привязок: {mappings.length}</p>
      </form>
      <form className="control-card settings-card" onSubmit={(event) => void saveSettings(event)}><p className="section-kicker">Поведение серии</p><h2>Наложение</h2><label>Режим<select value={settings.playbackMode} onChange={(event) => setSettings((current) => ({ ...current, playbackMode: event.target.value as UpdateWorkspaceSettings['playbackMode'] }))}><option value="controlled_overlap">Умеренное наложение</option><option value="sequential">Последовательно</option><option value="strong_overlap">Сильное наложение</option></select></label><label>Перекрытие звука <output>{settings.overlapPercent}%</output><input type="range" min="0" max="100" value={settings.overlapPercent} onChange={(event) => setSettings((current) => ({ ...current, overlapPercent: event.target.valueAsNumber }))} /></label><div className="two-fields"><label>Одновременно<input type="number" min="1" max="32" value={settings.maxConcurrentSounds} onChange={(event) => setSettings((current) => ({ ...current, maxConcurrentSounds: event.target.valueAsNumber }))} /></label><label>Громкость <output>{settings.volumePercent}%</output><input type="range" min="0" max="100" value={settings.volumePercent} onChange={(event) => setSettings((current) => ({ ...current, volumePercent: event.target.valueAsNumber }))} /></label></div><button type="submit">Сохранить настройки</button></form>
    </section>
    </div>
    <footer>{liveOnly ? null : <span>Недавние сообщения чата временно хранятся в памяти сервера и открытого браузера. В базу данных они не записываются.</span>}<SourceLink /></footer>
  </main>;
}
