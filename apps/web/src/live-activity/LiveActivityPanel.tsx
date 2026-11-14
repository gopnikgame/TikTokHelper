import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { LiveActivityState, SaveLikeGoal } from '@tiktok-helper/contracts';
import { LIKE_GOAL_MAX_TARGET } from '@tiktok-helper/contracts/live-activity';
import './live-activity.css';

interface Props {
  state: LiveActivityState | null;
  isCurrent: boolean;
  isLive?: boolean;
  liveOnly: boolean;
  onSave(input: SaveLikeGoal): Promise<void>;
  onRetry?(): void;
}

const number = new Intl.NumberFormat('ru-RU');

function Counter({ label, value }: { label: string; value: number | null }) {
  return <div className="live-activity-counter">
    <dt>{label}</dt>
    <dd aria-label={value === null ? 'Нет свежих данных' : undefined}>{value === null ? '—' : number.format(value)}</dd>
  </div>;
}

function LikeProgress({ target, baseline, total }: { target: number; baseline: number | null; total: number | null }) {
  const progress = baseline === null || total === null ? null : Math.max(0, total - baseline);
  const label = progress === null ? null : `${number.format(progress)} из ${number.format(target)}`;
  const reached = progress !== null && progress >= target;

  return <div className="live-activity-goal">
    <div className="live-activity-goal-caption">
      <span className={reached ? 'live-activity-achieved' : undefined} role={reached ? 'status' : undefined}>
        {reached ? 'Цель по лайкам достигнута' : 'Цель по лайкам'}
      </span>
      <strong>{label ?? `До ${number.format(target)} новых лайков`}</strong>
    </div>
    {progress === null ? <span className="live-activity-hint">Ждём первую отметку лайков</span> :
      <progress aria-label="Прогресс цели по лайкам" aria-valuetext={label ?? undefined} value={Math.min(progress, target)} max={target} />}
  </div>;
}

function RecentActions({ actions }: { actions: LiveActivityState['recentActions'] }) {
  return <details className="live-activity-details">
    <summary>Подписки и репосты</summary>
    {actions.length > 0 ? <ul className="live-activity-events" aria-label="Недавние действия зрителей">
      {actions.map((action, index) => <li key={index}>
        <bdi>{action.displayName ?? 'Зритель'}</bdi>
        <span>{action.kind === 'follow' ? 'Подписался на автора' : 'Поделился эфиром'}</span>
      </li>)}
    </ul> : <p className="live-activity-hint">Пока нет новых подписок на автора и репостов.</p>}
  </details>;
}

function LikeGoalSettings({ goal, isCurrent, onSave }: {
  goal: LiveActivityState['likeGoal'] | undefined;
  isCurrent: boolean;
  onSave(input: SaveLikeGoal): Promise<void>;
}) {
  const hintId = useId();
  const targetInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ value: string; revision: number | undefined }>();
  const [status, setStatus] = useState<'saving' | 'saved' | 'disabled' | 'error'>();
  const target = goal?.targetCount ?? null;
  const input = draft && draft.revision === goal?.revision ? draft.value : target?.toString() ?? '';
  const saving = status === 'saving';

  useEffect(() => {
    if (status === 'disabled' && target === null && document.activeElement === document.body) {
      targetInput.current?.focus({ preventScroll: true });
    }
  }, [status, target]);

  async function save(targetCount: number | null) {
    if (saving || !isCurrent || !goal) return;
    setStatus('saving');
    try {
      await onSave({ targetCount });
      if (targetCount === null) setDraft(undefined);
      setStatus(targetCount === null ? 'disabled' : 'saved');
    } catch {
      setStatus('error');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetCount = Number(input);
    if (Number.isInteger(targetCount) && targetCount >= 1 && targetCount <= LIKE_GOAL_MAX_TARGET) {
      void save(targetCount);
    }
  }

  return <details className="live-activity-details">
    <summary>Настроить цель по лайкам</summary>
    <form onSubmit={submit}>
      <fieldset className="live-activity-settings" disabled={!isCurrent || !goal || saving} aria-busy={saving}>
        <label>Сколько новых лайков собрать
          <input ref={targetInput} type="number" inputMode="numeric" required min={1} max={LIKE_GOAL_MAX_TARGET} step={1}
            aria-describedby={hintId} value={input}
            onChange={(event) => { setDraft({ value: event.target.value, revision: goal?.revision }); setStatus(undefined); }} />
        </label>
        <p id={hintId} className="live-activity-hint">После изменения цели отсчёт пойдёт от текущей отметки TikTok. В новом эфире отсчёт начнётся с первой полученной отметки.</p>
        <div className="live-activity-setting-actions">
          <button type="submit">{saving ? 'Сохраняем…' : 'Сохранить цель по лайкам'}</button>
          {target !== null ? <button type="button" className="quiet" onClick={() => void save(null)}>Выключить цель по лайкам</button> : null}
        </div>
      </fieldset>
      {status === 'saved' ? <p className="live-activity-feedback" role="status">Цель по лайкам сохранена.</p> : null}
      {status === 'disabled' ? <p className="live-activity-feedback" role="status">Цель по лайкам выключена.</p> : null}
      {status === 'error' ? <p className="live-activity-feedback" role="alert">Не удалось сохранить цель. Попробуйте ещё раз.</p> : null}
    </form>
  </details>;
}

export function LiveActivityPanel({ state, isCurrent, isLive = true, liveOnly, onSave, onRetry }: Props) {
  const target = state?.likeGoal.targetCount ?? null;
  const total = state?.totalLikes ?? null;
  return <section className="live-activity-panel" data-compact={liveOnly} aria-label="Активность эфира">
    <div className="live-activity-overview" data-has-goal={target !== null}>
      <dl className="live-activity-metrics">
        <Counter label="Зрители TikTok" value={isCurrent && isLive ? state?.viewers ?? null : null} />
        <Counter label="Лайки TikTok" value={total} />
      </dl>
      {target !== null ? <LikeProgress target={target} baseline={state?.likeGoal.baselineLikes ?? null} total={total} /> : null}
    </div>
    {(!isCurrent || !isLive) && total !== null ? <p className="live-activity-hint" role="status">Лайки по последней отметке</p> : null}
    {!state && isCurrent && onRetry ? <div className="live-activity-retry" role="status">
      <p className="live-activity-hint">Не удалось получить активность эфира.</p>
      <button type="button" className="quiet" onClick={onRetry}>Обновить активность</button>
    </div> : null}
    <div className="live-activity-options" hidden={liveOnly}>
      <LikeGoalSettings goal={state?.likeGoal} isCurrent={isCurrent} onSave={onSave} />
      {state?.connectionId ? <RecentActions actions={state.recentActions} /> : null}
    </div>
  </section>;
}
