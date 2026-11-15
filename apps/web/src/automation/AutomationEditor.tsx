import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  AutomationConfiguration, EventReaction, ObservedGift, ReactionEventType, SaveEventReaction, SaveSupportLevel,
  SoundAsset, SupportLevel, TemplateVariable, UpdateWorkspaceSpeechPolicy,
} from '@tiktok-helper/contracts';
import { GIFT_REACTION_TEMPLATE_VARIABLES, hasOnlyKnownTemplateVariables, templateVariables } from '@tiktok-helper/contracts/automation';
import { appPath } from '../app-path.js';
import { renderTemplate } from '../speech/policy.js';
import type { SpeechPlaybackPreferences, SpeechPlaybackQueue, SpeechVoiceLike } from '../speech/playback.js';

const VARIABLES: { key: TemplateVariable; label: string }[] = [
  { key: 'user', label: 'Имя' }, { key: 'username', label: 'Логин' }, { key: 'message', label: 'Сообщение' },
  { key: 'gift', label: 'Подарок' }, { key: 'count', label: 'Количество' },
  { key: 'points', label: 'Баллы' }, { key: 'total', label: 'Всего баллов' },
  { key: 'level', label: 'Уровень' }, { key: 'threshold', label: 'Порог' }, { key: 'language', label: 'Язык' },
];
const LEVEL_VARIABLES: TemplateVariable[] = ['user', 'username', 'points', 'total', 'level', 'threshold'];
const PARTICIPANT_VARIABLES: TemplateVariable[] = ['user', 'username', 'language'];
const GRANT_VARIABLES: TemplateVariable[] = ['user', 'username', 'points', 'total', 'level', 'threshold'];
const EVENT_LABELS: Record<ReactionEventType, string> = {
  moderator_seen: 'Модератор появился в чате', donor_seen: 'Даритель появился в чате', support_level_reached: 'Достигнут уровень поддержки',
  gift_completed: 'Подарок или завершение серии',
};
const EMPTY_LEVEL: SaveSupportLevel = {
  name: 'Новый уровень', thresholdPoints: 10_000, pointsScope: 'lifetime', privilegeDuration: 'permanent',
  privilegeDurationDays: null, grantsChatSpeech: true, chatSpeechCooldownSeconds: 30,
  announcementTemplate: '{user}, теперь ваши сообщения будут прочитаны вслух!', soundAssetId: null,
  isEnabled: true, position: 0,
};
const EMPTY_REACTION: SaveEventReaction = {
  name: 'Новая реакция', eventType: 'moderator_seen', supportLevelId: null,
  speechTemplate: null, soundAssetId: null, cooldownSeconds: 60, isEnabled: true, position: 0,
};
const EXAMPLE_VARIABLES = { user: 'Анна', username: 'anna', message: 'Спасибо!', points: 500, total: 10_000, level: 'Голос', threshold: 10_000, language: 'ru-RU' };

interface Props {
  workspaceId: string;
  configuration: AutomationConfiguration;
  sounds: SoundAsset[];
  speechSupported: boolean;
  speechQueue: SpeechPlaybackQueue | null;
  giftReactionCatalog: readonly ObservedGift[];
  giftReactionCheckDisabledReason?: string | null;
  onCheckGiftReaction?(ruleId: string, trigger: HTMLButtonElement): void;
  onConfigurationChange(configuration: AutomationConfiguration): void;
  onPreviewSound(soundId: string): void;
  onNotice(message: string): void;
}

export function AutomationStatus({ status, onRetry }: { status: 'loading' | 'error'; onRetry?(): void }) {
  return status === 'loading'
    ? <section className="automation-panel automation-status" aria-busy="true"><b>Загружаем правила озвучивания…</b><span>Остальные функции эфира уже доступны.</span></section>
    : <section className="automation-panel automation-status" role="alert"><b>Правила озвучивания не загрузились</b><span>Настройки и звуки не удалены. Проверьте соединение и попробуйте снова.</span><button type="button" onClick={onRetry}>Повторить</button></section>;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as T;
}

function SoundSelect({ sounds, value, onChange }: { sounds: SoundAsset[]; value: string | null; onChange(value: string | null): void }) {
  const active = sounds.filter((sound) => sound.status === 'active');
  return <label>Звук<select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
    <option value="">Без звука</option>
    {value && !active.some((sound) => sound.id === value) ? <option value={value} disabled>Выбранный звук недоступен</option> : null}
    {active.map((sound) => <option key={sound.id} value={sound.id}>{sound.displayName}</option>)}
  </select></label>;
}

function TemplateField({ label, value, variables, error, onChange }: {
  label: string; value: string | null; variables: readonly TemplateVariable[];
  error?: string; onChange(value: string | null): void;
}) {
  const errorId = useId();
  const insert = (variable: TemplateVariable) => onChange(`${value ?? ''}{${variable}}`);
  return <div className="template-field">
    <label>{label}<textarea rows={3} maxLength={500} value={value ?? ''}
      placeholder="Оставьте пустым, чтобы ничего не произносить"
      aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
      onChange={(event) => onChange(event.target.value || null)} /></label>
    <div className="variable-chips" aria-label="Добавить переменную">
      {VARIABLES.filter((variable) => variables.includes(variable.key)).map((variable) => <button key={variable.key}
        type="button" className="variable-chip" disabled={(value?.length ?? 0) + variable.key.length + 2 > 500}
        onClick={() => insert(variable.key)}>+ {variable.label}</button>)}
    </div>
    {error ? <small className="rule-field-error" id={errorId}>{error}</small> : null}
  </div>;
}

function LevelForm({ initial, sounds, busy, onSave, onCancel }: { initial: SaveSupportLevel; sounds: SoundAsset[]; busy: boolean; onSave(value: SaveSupportLevel): void; onCancel(): void }) {
  const [draft, setDraft] = useState(initial);
  return <form className="rule-form" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
    <label>Название уровня<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <div className="two-fields"><label>Нужно баллов<input type="number" min="1" required value={draft.thresholdPoints} onChange={(event) => setDraft({ ...draft, thresholdPoints: event.target.valueAsNumber })} /></label><label>Считать<select value={draft.pointsScope} onChange={(event) => setDraft({ ...draft, pointsScope: event.target.value as SaveSupportLevel['pointsScope'] })}><option value="lifetime">За всё время</option><option value="stream">В этом эфире</option></select></label></div>
    <label className="check-row"><input type="checkbox" checked={draft.grantsChatSpeech} onChange={(event) => setDraft({ ...draft, grantsChatSpeech: event.target.checked })} /><span>Читать сообщения этого зрителя вслух</span></label>
    {draft.grantsChatSpeech ? <label>Не чаще одного сообщения раз в…<div className="number-suffix"><input type="number" min="5" max="3600" value={draft.chatSpeechCooldownSeconds} onChange={(event) => setDraft({ ...draft, chatSpeechCooldownSeconds: event.target.valueAsNumber })} /><span>сек.</span></div></label> : null}
    <div className="two-fields"><label>Срок привилегии<select value={draft.privilegeDuration} onChange={(event) => { const privilegeDuration = event.target.value as SaveSupportLevel['privilegeDuration']; setDraft({ ...draft, privilegeDuration, privilegeDurationDays: privilegeDuration === 'days' ? (draft.privilegeDurationDays ?? 30) : null }); }}><option value="permanent">Навсегда</option><option value="stream">До конца эфира</option><option value="days">На несколько дней</option></select></label>{draft.privilegeDuration === 'days' ? <label>Количество дней<input type="number" min="1" max="3650" value={draft.privilegeDurationDays ?? 30} onChange={(event) => setDraft({ ...draft, privilegeDurationDays: event.target.valueAsNumber })} /></label> : <span />}</div>
    <TemplateField label="Что сказать при достижении уровня" value={draft.announcementTemplate} variables={LEVEL_VARIABLES} onChange={(announcementTemplate) => setDraft({ ...draft, announcementTemplate })} />
    <SoundSelect sounds={sounds} value={draft.soundAssetId} onChange={(soundAssetId) => setDraft({ ...draft, soundAssetId })} />
    <label className="check-row"><input type="checkbox" checked={draft.isEnabled} onChange={(event) => setDraft({ ...draft, isEnabled: event.target.checked })} /><span>Уровень включён</span></label>
    <div className="actions"><button disabled={busy}>Сохранить</button><button type="button" className="quiet" onClick={onCancel}>Отмена</button></div>
  </form>;
}

function GiftReactionPicker({ catalog, value, onChange }: {
  catalog: readonly ObservedGift[]; value: string | null; onChange(value: string | null): void;
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const matchingGifts = catalog.filter((gift) => gift.giftName.toLocaleLowerCase().includes(search) || gift.giftId.toLocaleLowerCase().includes(search));
  const selected = catalog.find((gift) => gift.giftId === value);
  const gifts = selected && !matchingGifts.includes(selected) ? [selected, ...matchingGifts] : matchingGifts;

  return <div className="gift-reaction-picker">
    <div className={catalog.length ? 'two-fields' : undefined}>
      {catalog.length ? <label>Найти подарок по названию или ID
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label> : null}
      <label>Подарок<select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Любой подарок</option>
        {value && !selected ? <option value={value}>Подарок · ID {value}</option> : null}
        {gifts.map((gift) => <option key={gift.giftId} value={gift.giftId}>{gift.giftName} · ID {gift.giftId}</option>)}
      </select></label>
    </div>
    {!catalog.length ? <small className="rule-field-hint">В каталоге пока нет подарков.</small>
      : matchingGifts.length === 0 ? <small className="rule-field-hint" role="status">Подарки по запросу не найдены. Измените поиск.</small> : null}
    {selected ? <div className="gift-reaction-selected">
      {selected.imageUrl ? <img src={selected.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
      <div><strong>{selected.giftName}</strong><small className="rule-field-hint">
        {selected.diamondCount === null ? 'Стоимость пока неизвестна' : `${selected.diamondCount.toLocaleString('ru-RU')} баллов за штуку`}
      </small></div>
    </div> : null}
  </div>;
}

function ReactionForm({ initial, levels, sounds, giftReactionCatalog, busy, onSave, onCancel }: {
  initial: SaveEventReaction; levels: SupportLevel[]; sounds: SoundAsset[];
  giftReactionCatalog: readonly ObservedGift[]; busy: boolean;
  onSave(value: SaveEventReaction): void; onCancel(): void;
}) {
  const [draft, setDraft] = useState(initial);
  const thresholdHintId = useId();
  const cooldownHintId = useId();
  const giftRule = draft.eventType === 'gift_completed';
  const speechTemplate = draft.speechTemplate?.trim() || null;
  const invalidGiftTemplate = giftRule && speechTemplate && (!hasOnlyKnownTemplateVariables(speechTemplate)
    || templateVariables(speechTemplate).some((key) => !GIFT_REACTION_TEMPLATE_VARIABLES.some((variable) => variable === key)));
  const giftRuleNeedsAction = giftRule && draft.isEnabled && !speechTemplate
    && !sounds.some((sound) => sound.id === draft.soundAssetId && sound.status === 'active');
  function changeType(eventType: ReactionEventType) {
    const changes = eventType === 'gift_completed' && initial.eventType !== 'gift_completed'
      ? { cooldownSeconds: 0, isEnabled: false }
      : giftRule && initial.eventType !== 'gift_completed'
        ? { cooldownSeconds: initial.cooldownSeconds, isEnabled: initial.isEnabled } : {};
    setDraft({ ...draft, ...changes, eventType, supportLevelId: eventType === 'support_level_reached' ? draft.supportLevelId : null });
  }
  return <form className={`rule-form${giftRule ? ' gift-reaction-form' : ''}`} onSubmit={(event) => {
    event.preventDefault();
    if (!busy && !invalidGiftTemplate && !giftRuleNeedsAction) onSave(giftRule ? { ...draft, speechTemplate } : draft);
  }}>
    <label>Название реакции<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>Когда срабатывать<select value={draft.eventType} onChange={(event) => changeType(event.target.value as ReactionEventType)}>
      {Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {draft.eventType === 'support_level_reached' ? <label>Для какого уровня<select value={draft.supportLevelId ?? ''} onChange={(event) => setDraft({ ...draft, supportLevelId: event.target.value || null })}><option value="">Для любого уровня</option>{levels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label> : null}
    {giftRule ? <>
      <GiftReactionPicker catalog={giftReactionCatalog} value={draft.giftId ?? null}
        onChange={(giftId) => setDraft({ ...draft, giftId })} />
      <div className="two-fields">
        <div className="gift-reaction-field">
          <label>Минимальная стоимость в баллах<input type="number" min="0" max="2147483647" step="1" required
            value={Number.isNaN(draft.minimumGiftPoints) ? '' : draft.minimumGiftPoints ?? 0} aria-describedby={thresholdHintId}
            onChange={(event) => setDraft({ ...draft, minimumGiftPoints: event.target.valueAsNumber })} /></label>
          <small className="rule-field-hint" id={thresholdHintId}>Считается стоимость всей серии. 0 — без порога, подходит и неизвестная стоимость.</small>
        </div>
        <div className="gift-reaction-field">
          <label>Пауза между реакциями<span className="number-suffix">
            <input type="number" min="0" max="86400" step="1" required aria-describedby={cooldownHintId}
              value={Number.isNaN(draft.cooldownSeconds) ? '' : draft.cooldownSeconds}
              onChange={(event) => setDraft({ ...draft, cooldownSeconds: event.target.valueAsNumber })} /><span>сек.</span>
          </span></label>
          <small className="rule-field-hint" id={cooldownHintId}>0 — срабатывать при каждом подходящем событии.</small>
        </div>
      </div>
    </> : null}
    <TemplateField label={giftRule ? 'Текст благодарности' : 'Что произнести'} value={draft.speechTemplate}
      variables={giftRule ? GIFT_REACTION_TEMPLATE_VARIABLES : draft.eventType === 'support_level_reached' ? GRANT_VARIABLES : PARTICIPANT_VARIABLES}
      error={invalidGiftTemplate ? 'Используйте переменные из кнопок под текстом.' : undefined}
      onChange={(speechTemplate) => setDraft({ ...draft, speechTemplate })} />
    <SoundSelect sounds={sounds} value={draft.soundAssetId} onChange={(soundAssetId) => setDraft({ ...draft, soundAssetId })} />
    {!giftRule ? <label>Не повторять реакцию чаще<div className="number-suffix"><input type="number" min="0" max="86400" value={draft.cooldownSeconds} onChange={(event) => setDraft({ ...draft, cooldownSeconds: event.target.valueAsNumber })} /><span>сек.</span></div></label> : null}
    <label className="check-row"><input type="checkbox" checked={draft.isEnabled} onChange={(event) => setDraft({ ...draft, isEnabled: event.target.checked })} /><span>Реакция включена</span></label>
    {giftRuleNeedsAction ? <small className="rule-field-error" role="status">Чтобы включить реакцию, выберите звук или напишите благодарность.</small> : null}
    <div className="actions"><button disabled={busy || Boolean(invalidGiftTemplate) || giftRuleNeedsAction}>Сохранить</button><button type="button" className="quiet" onClick={onCancel}>Отмена</button></div>
  </form>;
}

function eventReactionInput(value: SaveEventReaction, position: number): SaveEventReaction {
  const { name, eventType, supportLevelId, speechTemplate, soundAssetId, cooldownSeconds, isEnabled } = value;
  return {
    name, eventType, supportLevelId, speechTemplate, soundAssetId, cooldownSeconds, isEnabled, position,
    ...(eventType === 'gift_completed' ? { giftId: value.giftId ?? null, minimumGiftPoints: value.minimumGiftPoints ?? 0 } : {}),
  };
}

export function AutomationEditor(props: Props) {
  const {
    workspaceId, configuration, sounds, speechSupported, speechQueue, giftReactionCatalog,
    giftReactionCheckDisabledReason, onCheckGiftReaction, onConfigurationChange, onPreviewSound, onNotice,
  } = props;
  const [policy, setPolicy] = useState<UpdateWorkspaceSpeechPolicy>(() => ({ ...configuration.policy }));
  const [editingLevel, setEditingLevel] = useState<string | 'new' | null>(null);
  const [editingReaction, setEditingReaction] = useState<string | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const [voices, setVoices] = useState<SpeechVoiceLike[]>(() => speechQueue?.voices ?? []);
  const checkHintId = useId();
  const storageKey = `tiktok-helper.speech-device.v1.${workspaceId}`;
  const [preferences, setPreferences] = useState<SpeechPlaybackPreferences>(() => {
    try { return { voiceName: '', rate: 1, volume: 1, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<SpeechPlaybackPreferences> }; }
    catch { return { voiceName: '', rate: 1, volume: 1 }; }
  });
  const activeSounds = useMemo(() => new Map(sounds.filter((sound) => sound.status === 'active').map((sound) => [sound.id, sound])), [sounds]);
  const giftById = useMemo(() => new Map(giftReactionCatalog.map((gift) => [gift.giftId, gift])), [giftReactionCatalog]);
  const reactions = configuration.eventReactions;
  const hasGiftReactions = reactions.some((reaction) => reaction.eventType === 'gift_completed');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { speechQueue?.setPreferences(preferences); localStorage.setItem(storageKey, JSON.stringify(preferences)); }, [preferences, speechQueue, storageKey]);
  useEffect(() => {
    if (!speechSupported) return;
    const update = () => setVoices(speechQueue?.voices ?? []);
    update(); window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, [speechQueue, speechSupported]);

  const endpoint = appPath(`api/workspaces/${encodeURIComponent(workspaceId)}/automation`);
  async function refresh() {
    const next = await readJson<AutomationConfiguration>(await fetch(endpoint));
    if (!mounted.current) return;
    onConfigurationChange(next); setPolicy({ ...next.policy });
  }
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      if (!mounted.current) return;
      await refresh();
      if (mounted.current) onNotice(success);
    } catch {
      if (mounted.current) onNotice('Не удалось сохранить правило. Проверьте поля и попробуйте ещё раз.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function savePolicy(event: FormEvent) {
    event.preventDefault(); await run(async () => { await readJson(await fetch(`${endpoint}/policy`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(policy) })); }, 'Правила озвучивания сохранены');
  }
  async function saveLevel(id: string | 'new', value: SaveSupportLevel) {
    await run(async () => { await readJson(await fetch(id === 'new' ? `${endpoint}/support-levels` : `${endpoint}/support-levels/${id}`, { method: id === 'new' ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...value, position: id === 'new' ? configuration.supportLevels.length : value.position }) })); setEditingLevel(null); }, 'Уровень поддержки сохранён');
  }
  async function saveReaction(id: string | 'new', value: SaveEventReaction) {
    const lastPosition = Math.max(-1, ...reactions.map((reaction) => reaction.position));
    const position = id === 'new' ? Math.min(10_000, lastPosition + 1) : value.position;
    await run(async () => {
      await readJson(await fetch(id === 'new' ? `${endpoint}/event-reactions` : `${endpoint}/event-reactions/${id}`, {
        method: id === 'new' ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(eventReactionInput(value, position)),
      }));
      setEditingReaction(null);
    }, 'Реакция сохранена');
  }
  async function remove(kind: 'support-levels' | 'event-reactions', id: string, label: string) {
    if (!window.confirm(`Удалить «${label}»? Это действие нельзя отменить.`)) return;
    await run(async () => { const response = await fetch(`${endpoint}/${kind}/${id}`, { method: 'DELETE' }); if (!response.ok) throw new Error(); }, 'Правило удалено');
  }
  async function resetSupporterStatistics() {
    if (!window.confirm('Сбросить статистику донатеров? Накопленные баллы и выданные уровни будут удалены без возможности восстановления. Подарки, звуки, привязки и правила останутся.')) return;
    setBusy(true);
    try {
      const result = await readJson<{ deletedSupporters: number }>(await fetch(
        appPath(`api/workspaces/${encodeURIComponent(workspaceId)}/supporters/statistics`),
        { method: 'DELETE' },
      ));
      if (!mounted.current) return;
      onNotice(result.deletedSupporters > 0
        ? `Статистика сброшена: удалено донатеров — ${result.deletedSupporters}`
        : 'Статистика уже была пустой');
    } catch {
      if (mounted.current) onNotice('Не удалось сбросить статистику донатеров. Попробуйте ещё раз.');
    } finally { if (mounted.current) setBusy(false); }
  }
  async function move<T extends SupportLevel | EventReaction>(kind: 'support-levels' | 'event-reactions', items: T[], index: number, direction: -1 | 1) {
    const other = items[index + direction]; const item = items[index]; if (!item || !other) return;
    if (kind === 'event-reactions') {
      await run(async () => {
        const response = await fetch(`${endpoint}/event-reactions/${item.id}/move`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ direction: direction < 0 ? 'up' : 'down' }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }, 'Порядок правил изменён');
      return;
    }
    const strip = (value: T) => { const { id, workspaceId: itemWorkspaceId, ...input } = value; void id; void itemWorkspaceId; return input; };
    await run(async () => { await Promise.all([
      readJson(await fetch(`${endpoint}/${kind}/${item.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...strip(item), position: other.position }) })),
      readJson(await fetch(`${endpoint}/${kind}/${other.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...strip(other), position: item.position }) })),
    ]); }, 'Порядок правил изменён');
  }
  function testSpeech(template = '{user}, проверка озвучивания работает') {
    if (!speechQueue) { onNotice('Этот браузер не поддерживает озвучивание текста'); return; }
    speechQueue.unlock(); speechQueue.enqueue({ id: `test-${Date.now()}`, text: renderTemplate(template, EXAMPLE_VARIABLES), language: policy.fallbackLanguage, priority: 'moderator' }, policy.maxQueueSize);
    onNotice('Воспроизводим проверочную фразу');
  }

  return <details className="automation-panel"><summary><span><b>Озвучивание чата и реакции</b><small>{configuration.supportLevels.length} уровней · {reactions.length} реакций</small></span><span>Настроить</span></summary><div className="automation-content">
    <section className="automation-section"><header><div><p className="section-kicker">Это устройство</p><h2>Голос браузера</h2></div><span className={speechSupported ? 'capability-ok' : 'capability-off'}>{speechSupported ? `Доступно · голосов ${voices.length}` : 'Не поддерживается'}</span></header>{speechSupported ? <div className="rule-form"><label>Голос<select value={preferences.voiceName} onChange={(event) => setPreferences({ ...preferences, voiceName: event.target.value })}><option value="">Автоматически по языку</option>{voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>)}</select></label><div className="two-fields"><label>Скорость <output>{preferences.rate.toFixed(1)}×</output><input type="range" min="0.5" max="2" step="0.1" value={preferences.rate} onChange={(event) => setPreferences({ ...preferences, rate: event.target.valueAsNumber })} /></label><label>Громкость <output>{Math.round(preferences.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={preferences.volume} onChange={(event) => setPreferences({ ...preferences, volume: event.target.valueAsNumber })} /></label></div><button type="button" className="secondary" onClick={() => testSpeech()}>Проверить голос</button></div> : <p className="automation-empty">Звуки подарков продолжат работать, но чтение сообщений в этом браузере недоступно.</p>}</section>

    <section className="automation-section"><header><div><p className="section-kicker">Общие правила</p><h2>Чтение сообщений</h2></div></header><form className="rule-form" onSubmit={(event) => void savePolicy(event)}><label className="check-row"><input type="checkbox" checked={policy.moderatorSpeechEnabled} onChange={(event) => setPolicy({ ...policy, moderatorSpeechEnabled: event.target.checked })} /><span>Всегда читать сообщения модераторов</span></label>{policy.moderatorSpeechEnabled ? <label>Модератор — не чаще одного сообщения раз в<div className="number-suffix"><input type="number" min="5" max="3600" value={policy.moderatorCooldownSeconds} onChange={(event) => setPolicy({ ...policy, moderatorCooldownSeconds: event.target.valueAsNumber })} /><span>сек.</span></div></label> : null}<label className="check-row"><input type="checkbox" checked={policy.readUserName} onChange={(event) => setPolicy({ ...policy, readUserName: event.target.checked })} /><span>Произносить имя перед сообщением</span></label><div className="two-fields"><label>Максимальная длина<input type="number" min="20" max="500" value={policy.maxMessageCharacters} onChange={(event) => setPolicy({ ...policy, maxMessageCharacters: event.target.valueAsNumber })} /></label><label>Сообщений в очереди<input type="number" min="1" max="100" value={policy.maxQueueSize} onChange={(event) => setPolicy({ ...policy, maxQueueSize: event.target.valueAsNumber })} /></label></div><label>Язык, если TikTok его не сообщил<input value={policy.fallbackLanguage} pattern="[A-Za-z]{2,3}(-[A-Za-z]{2,4})?" onChange={(event) => setPolicy({ ...policy, fallbackLanguage: event.target.value })} /></label><button disabled={busy}>Сохранить общие правила</button></form></section>

    <section className="automation-section"><header><div><p className="section-kicker">Привилегии</p><h2>Уровни поддержки</h2></div><button type="button" onClick={() => setEditingLevel('new')}>Добавить уровень</button></header>{editingLevel === 'new' ? <LevelForm initial={{ ...EMPTY_LEVEL, position: configuration.supportLevels.length }} sounds={sounds} busy={busy} onSave={(value) => void saveLevel('new', value)} onCancel={() => setEditingLevel(null)} /> : null}<ul className="rule-list">{configuration.supportLevels.map((level, index) => <li key={level.id} className={level.isEnabled ? '' : 'is-disabled'}><div className="rule-heading"><div><strong>{level.name}</strong><span>{level.thresholdPoints.toLocaleString('ru-RU')} баллов · {level.grantsChatSpeech ? 'читает сообщения' : 'без чтения'}</span>{level.soundAssetId && activeSounds.get(level.soundAssetId) ? <small>Звук: {activeSounds.get(level.soundAssetId)?.displayName}</small> : null}</div><span className="rule-state">{level.isEnabled ? 'Включён' : 'Выключен'}</span></div>{editingLevel === level.id ? <LevelForm initial={level} sounds={sounds} busy={busy} onSave={(value) => void saveLevel(level.id, value)} onCancel={() => setEditingLevel(null)} /> : <div className="rule-actions"><button type="button" className="quiet" onClick={() => setEditingLevel(level.id)}>Изменить</button>{level.announcementTemplate ? <button type="button" className="quiet" onClick={() => testSpeech(level.announcementTemplate ?? '')}>Проверить речь</button> : null}{level.soundAssetId ? <button type="button" className="quiet" onClick={() => onPreviewSound(level.soundAssetId!)}>Проверить звук</button> : null}<button type="button" className="quiet" aria-label={`Поднять ${level.name}`} disabled={index === 0 || busy} onClick={() => void move('support-levels', configuration.supportLevels, index, -1)}>↑</button><button type="button" className="quiet" aria-label={`Опустить ${level.name}`} disabled={index === configuration.supportLevels.length - 1 || busy} onClick={() => void move('support-levels', configuration.supportLevels, index, 1)}>↓</button><button type="button" className="danger" onClick={() => void remove('support-levels', level.id, level.name)}>Удалить</button></div>}</li>)}</ul>{configuration.supportLevels.length === 0 && editingLevel !== 'new' ? <p className="automation-empty">Пока нет уровней. Добавьте первый порог, после которого зритель получит озвучивание сообщений.</p> : null}</section>

    <section className="automation-section"><header><div><p className="section-kicker">События</p><h2>Реакции</h2></div><button type="button" onClick={() => setEditingReaction('new')}>Добавить реакцию</button></header>
      {hasGiftReactions ? <p className="rule-list-hint">Для каждого подарка или завершённой серии срабатывает первое подходящее правило сверху.</p> : null}
      {hasGiftReactions && onCheckGiftReaction && giftReactionCheckDisabledReason ? <p className="rule-list-hint" id={checkHintId}>{giftReactionCheckDisabledReason}</p> : null}
      {editingReaction === 'new' ? <ReactionForm key="new" initial={EMPTY_REACTION} levels={configuration.supportLevels}
        sounds={sounds} giftReactionCatalog={giftReactionCatalog} busy={busy}
        onSave={(value) => void saveReaction('new', value)} onCancel={() => setEditingReaction(null)} /> : null}
      <ul className="rule-list">{reactions.map((reaction, index) => {
        const giftRule = reaction.eventType === 'gift_completed';
        const gift = reaction.giftId ? giftById.get(reaction.giftId) : undefined;
        const giftLabel = reaction.giftId ? `${gift?.giftName ?? 'Подарок'} · ID ${reaction.giftId}` : 'Любой подарок';
        const minimum = reaction.minimumGiftPoints ?? 0;
        const sound = reaction.soundAssetId ? activeSounds.get(reaction.soundAssetId) : undefined;
        return <li key={reaction.id} className={reaction.isEnabled ? '' : 'is-disabled'}>
          <div className="rule-heading">
            <div><strong>{reaction.name}</strong><span>{EVENT_LABELS[reaction.eventType]}</span>
              {giftRule ? <small>{giftLabel} · {minimum > 0 ? `от ${minimum.toLocaleString('ru-RU')} баллов` : 'без порога'}
                {reaction.cooldownSeconds > 0 ? ` · пауза ${reaction.cooldownSeconds.toLocaleString('ru-RU')} сек.` : ''}</small> : null}
              {sound ? <small>Звук — {sound.displayName}</small> : giftRule && reaction.soundAssetId ? <small>Выбранный звук недоступен</small> : null}
              {giftRule && reaction.speechTemplate?.trim() ? <small>Благодарность настроена</small> : null}
            </div>
            <span className="rule-state">{reaction.isEnabled ? 'Включена' : 'Выключена'}</span>
          </div>
          {editingReaction === reaction.id ? <ReactionForm initial={reaction} levels={configuration.supportLevels}
            sounds={sounds} giftReactionCatalog={giftReactionCatalog} busy={busy}
            onSave={(value) => void saveReaction(reaction.id, value)} onCancel={() => setEditingReaction(null)} /> : <div className="rule-actions">
              <button type="button" className="quiet" onClick={() => setEditingReaction(reaction.id)}>Изменить</button>
              {giftRule && onCheckGiftReaction ? <button type="button" className="quiet" aria-haspopup="dialog"
                aria-disabled={giftReactionCheckDisabledReason ? true : undefined}
                aria-describedby={giftReactionCheckDisabledReason ? checkHintId : undefined}
                onClick={(event) => { if (!giftReactionCheckDisabledReason) onCheckGiftReaction(reaction.id, event.currentTarget); }}>
                Проверить правило
              </button> : null}
              {!giftRule && reaction.speechTemplate ? <button type="button" className="quiet" onClick={() => testSpeech(reaction.speechTemplate ?? '')}>Проверить речь</button> : null}
              {sound ? <button type="button" className="quiet" onClick={() => onPreviewSound(sound.id)}>Проверить звук</button> : null}
              <button type="button" className="quiet" aria-label={`Поднять ${reaction.name}`} disabled={index === 0 || busy}
                onClick={() => void move('event-reactions', reactions, index, -1)}>↑</button>
              <button type="button" className="quiet" aria-label={`Опустить ${reaction.name}`} disabled={index === reactions.length - 1 || busy}
                onClick={() => void move('event-reactions', reactions, index, 1)}>↓</button>
              <button type="button" className="danger" onClick={() => void remove('event-reactions', reaction.id, reaction.name)}>Удалить</button>
            </div>}
        </li>;
      })}</ul>
      {reactions.length === 0 && editingReaction !== 'new' ? <p className="automation-empty">Реакций пока нет. По умолчанию ничего не произносится и не воспроизводится.</p> : null}
    </section>

    <section className="automation-section danger-zone"><header><div><p className="section-kicker">Данные рабочего пространства</p><h2>Статистика донатеров</h2></div></header><p>Сбрасывает баллы для уровней поддержки и выданные привилегии. Новые подарки снова начнут приносить баллы для уровней.</p><button type="button" className="danger" disabled={busy} onClick={() => void resetSupporterStatistics()}>Сбросить статистику донатеров</button></section>
  </div></details>;
}
