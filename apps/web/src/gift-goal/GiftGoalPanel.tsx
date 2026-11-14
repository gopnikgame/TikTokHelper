import { type FormEvent, useId, useState } from 'react';
import type { GiftGoalConfiguration, GiftGoalState, ObservedGift, SaveGiftGoal, SoundAsset } from '@tiktok-helper/contracts';
import { GIFT_GOAL_MAX_TARGET } from '@tiktok-helper/contracts/gift-goal';
import './gift-goal.css';

interface Props {
  state: GiftGoalState | null;
  isCurrent: boolean;
  liveOnly: boolean;
  gifts: readonly ObservedGift[];
  sounds: readonly SoundAsset[];
  error?: boolean;
  onRetry?(): void;
  onSave(input: SaveGiftGoal): Promise<void>;
  onPreviewSound?(soundId: string): void;
}

const number = new Intl.NumberFormat('ru-RU');
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function Time({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : <time dateTime={value}>{clock.format(date)}</time>;
}

function GoalProgress({ state, gift }: { state: GiftGoalState; gift?: ObservedGift }) {
  const goal = state.configuration;
  if (!goal) return <p className="gift-goal-hint">Выберите подарок и задайте количество.</p>;

  const complete = state.progress >= goal.targetCount;
  const status = complete ? 'Цель достигнута' : !goal.isEnabled ? 'Цель на паузе' : null;
  return <div className="gift-goal-progress" data-complete={complete}>
    <div className="gift-goal-progress-heading">
      <span className="gift-goal-item">
        {gift?.imageUrl ? <img alt="" width="28" height="28" src={gift.imageUrl} referrerPolicy="no-referrer" /> : null}
        <bdi>{gift?.giftName ?? `Подарок · ID ${goal.giftId}`}</bdi>
      </span>
      <strong className="gift-goal-quantity">{number.format(state.progress)} из {number.format(goal.targetCount)}</strong>
    </div>
    <progress aria-label="Прогресс цели" aria-valuetext={`${number.format(state.progress)} из ${number.format(goal.targetCount)}`}
      value={Math.min(state.progress, goal.targetCount)} max={goal.targetCount} />
    {status || (state.goalStartedAt && state.goalStartedAt !== state.startedAt) ? <div className="gift-goal-progress-meta">
      {status ? <span role="status">{status}</span> : null}
      {state.goalStartedAt && state.goalStartedAt !== state.startedAt ? <span>Цель с <Time value={state.goalStartedAt} /></span> : null}
    </div> : null}
  </div>;
}

function GiftGoalStats({ state }: { state: GiftGoalState }) {
  const last = state.lastDonor;
  return <div className="gift-goal-stats">
    <div className="gift-goal-last">
      <span className="gift-goal-hint">Последний даритель</span>
      {last ? <div className="gift-goal-last-value">
        <bdi>{last.displayName}</bdi>
        <span><bdi>{last.giftName}</bdi> ×{number.format(last.quantity)}</span>
      </div> : <span className="gift-goal-hint">{state.startedAt ? 'Ждём первый подарок' : 'После подключения к эфиру'}</span>}
    </div>
    {state.startedAt ? <details className="gift-goal-top">
      <summary>Топ дарителей<span aria-hidden="true" className="gift-goal-chevron" /></summary>
      <div className="gift-goal-ranking">
        <p className="gift-goal-hint">Баллы за подарки</p>
        {state.topDonors.length > 0 ? <ol aria-label="Дарители по баллам">
          {state.topDonors.map((donor, position) => <li key={position}>
            <div><bdi>{donor.displayName}</bdi><strong>{number.format(donor.points)}</strong></div>
          </li>)}
        </ol> : <p className="gift-goal-hint">Ждём подарки с известной стоимостью.</p>}
        {state.rankingLimited ? <p className="gift-goal-hint">В топе учтена часть дарителей этого эфира.</p> : null}
      </div>
    </details> : null}
  </div>;
}

function GiftGoalForm({ configuration, gifts, sounds, saving, onSave, onPreviewSound }: {
  configuration: GiftGoalConfiguration | null;
  gifts: readonly ObservedGift[];
  sounds: readonly SoundAsset[];
  saving: boolean;
  onSave(input: SaveGiftGoal): void;
  onPreviewSound?(soundId: string): void;
}) {
  const [giftId, setGiftId] = useState(configuration?.giftId ?? '');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(String(configuration?.targetCount ?? 10));
  const [soundId, setSoundId] = useState(configuration?.soundAssetId ?? '');
  const [enabled, setEnabled] = useState(configuration?.isEnabled ?? false);
  const search = query.trim().toLocaleLowerCase();
  const selected = gifts.find((gift) => gift.giftId === giftId);
  const matching = gifts.filter((gift) => gift.giftName.toLocaleLowerCase().includes(search) || gift.giftId.toLocaleLowerCase().includes(search));
  const choices = selected && !matching.includes(selected) ? [selected, ...matching] : matching;
  const activeSounds = sounds.filter((sound) => sound.status === 'active');
  const selectedSound = activeSounds.find((sound) => sound.id === soundId);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetCount = Number(target);
    if (saving || !giftId || !Number.isInteger(targetCount) || targetCount < 1 || targetCount > GIFT_GOAL_MAX_TARGET) return;
    onSave({ giftId, targetCount, soundAssetId: soundId || null, isEnabled: enabled });
  }

  return <form onSubmit={save}>
    <fieldset className="gift-goal-form" disabled={saving} aria-label="Настройки цели">
      {gifts.length > 0 ? <label>Найти подарок по названию или ID
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label> : null}
      <label>Подарок для цели
        <select required value={giftId} onChange={(event) => setGiftId(event.target.value)}>
          <option value="">Выберите подарок</option>
          {giftId && !selected ? <option value={giftId}>Подарок · ID {giftId}</option> : null}
          {choices.map((gift) => <option key={gift.giftId} value={gift.giftId}>{gift.giftName} · ID {gift.giftId}</option>)}
        </select>
      </label>
      {gifts.length === 0 ? <p className="gift-goal-hint">Каталог пополнится с первыми подарками в эфире.</p>
        : matching.length === 0 ? <p className="gift-goal-hint" role="status">Измените запрос, чтобы найти подарок.</p> : null}
      <div className="gift-goal-form-fields">
        <label>Сколько подарков собрать
          <input required type="number" inputMode="numeric" min={1} max={GIFT_GOAL_MAX_TARGET} step={1} value={target}
            onChange={(event) => setTarget(event.target.value)} />
        </label>
        <label>Звук при достижении цели
          <select value={soundId} onChange={(event) => setSoundId(event.target.value)}>
            <option value="">Без звука</option>
            {soundId && !selectedSound ? <option value={soundId} disabled>Выбранный звук недоступен</option> : null}
            {activeSounds.map((sound) => <option key={sound.id} value={sound.id}>{sound.displayName}</option>)}
          </select>
        </label>
      </div>
      {selectedSound && onPreviewSound ? <button type="button" className="quiet" onClick={() => onPreviewSound(selectedSound.id)}>Проверить звук</button> : null}
      <label className="check-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Включить цель</label>
      {configuration ? <p className="gift-goal-hint">При смене подарка или количества счёт цели начнётся заново.</p> : null}
      <button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить цель'}</button>
    </fieldset>
  </form>;
}

export function GiftGoalPanel({ state, isCurrent, liveOnly, gifts, sounds, error, onRetry, onSave, onPreviewSound }: Props) {
  const headingId = useId();
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'failed' | null>(null);
  const activeGift = gifts.find((gift) => gift.giftId === state?.configuration?.giftId);
  const save = async (input: SaveGiftGoal) => {
    setSaveStatus('saving');
    try {
      await onSave(input);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('failed');
    }
  };

  return <section className="gift-goal-panel" data-compact={liveOnly} aria-labelledby={headingId}>
    <div className="gift-goal-heading">
      <h2 id={headingId}>Цель по подаркам</h2>
      {state?.startedAt ? <span className="gift-goal-hint">Статистика с <Time value={state.startedAt} /></span> : null}
    </div>
    {error || !state || !isCurrent ? <div className="gift-goal-load" role="status">
      <span>{error ? 'Не удалось обновить статистику.' : 'Ждём обновления статистики…'}</span>
      {error && onRetry ? <button type="button" className="quiet" onClick={onRetry}>Повторить</button> : null}
    </div> : null}
    {state ? <div className="gift-goal-body">
      <GoalProgress state={state} gift={activeGift} />
      <GiftGoalStats state={state} />
    </div> : null}
    {state ? <details className="gift-goal-settings" hidden={liveOnly}>
      <summary>Настроить цель<span aria-hidden="true" className="gift-goal-chevron" /></summary>
      <GiftGoalForm key={`${state.configuration?.revision ?? 0}:${state.configuration?.soundAssetId ?? ''}`} configuration={state.configuration} gifts={gifts} sounds={sounds}
        saving={saveStatus === 'saving'} onSave={(input) => void save(input)} onPreviewSound={onPreviewSound} />
      {saveStatus === 'saved' ? <p className="gift-goal-save-status" role="status">Цель сохранена.</p> : null}
      {saveStatus === 'failed' ? <p className="gift-goal-save-status" role="alert">Не удалось сохранить цель. Проверьте подарок и звук или попробуйте ещё раз.</p> : null}
    </details> : null}
  </section>;
}
