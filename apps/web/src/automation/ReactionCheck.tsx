import { type Ref, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AutomationConfiguration, GiftSoundMapping, ObservedGift, SoundAsset, UpdateWorkspaceSettings } from '@tiktok-helper/contracts';
import { playbackOverlapPercent, type SoundPlaybackQueue } from '../audio/playback.js';
import type { SpeechPlaybackQueue } from '../speech/playback.js';
import { giftTotalPoints } from '../speech/policy.js';
import {
  donorCheckActions, giftCheckActions, giftCompletionCheckActions, validPlaybackSettings,
  type GiftCheckSampleGift, type ReactionCheckAction,
} from './reaction-check.js';
import './reaction-check.css';

const MODES = {
  controlled_overlap: 'Умеренное наложение',
  sequential: 'Последовательно',
  strong_overlap: 'Сильное наложение',
};
const DEMO_GIFT: GiftCheckSampleGift = { giftId: 'preview:demo-gift', giftName: 'Тестовый подарок', diamondCount: 100 };

type Sample = 'gift' | 'donor' | 'gift-completed';
type GiftCount = 1 | 3 | 100;
type Result = { label: string; detail?: string; total: number; played: number; failed: number };
type Report = { status: 'running' | 'finished' | 'stopped'; results: Result[] };
type Run = { sound?: SoundPlaybackQueue; speech?: SpeechPlaybackQueue };

export interface ReactionCheckHandle {
  openGiftRule(ruleId: string, trigger: HTMLButtonElement): void;
}

interface Props {
  ref?: Ref<ReactionCheckHandle>;
  gift: ObservedGift | undefined;
  gifts: ObservedGift[];
  savedMapping: GiftSoundMapping | undefined;
  sounds: ReadonlyMap<string, SoundAsset>;
  settings: UpdateWorkspaceSettings;
  automation: AutomationConfiguration | null;
  disabledReason: string | null;
  audioEnabled: boolean;
  onEnableAudio: () => Promise<boolean>;
  player: SoundPlaybackQueue;
  speechQueue: SpeechPlaybackQueue | null;
}

function resultFor(action: ReactionCheckAction): Result {
  if (action.type === 'skipped') return { label: action.label, detail: action.reason, total: 0, played: 0, failed: 0 };
  if (action.type === 'speech') return { label: 'Озвучка', detail: action.job.text, total: 1, played: 0, failed: 0 };
  return { label: action.asset.displayName, total: action.count, played: 0, failed: 0 };
}

function resultStatus(result: Result, status: Report['status']) {
  if (!result.total) return 'Пропущено';
  if (result.failed === result.total) return 'Ошибка воспроизведения';
  if (result.played === result.total) return result.total === 1 ? 'Воспроизведено' : `Готово · ${result.played} из ${result.total}`;
  if (result.played + result.failed === result.total) return `Воспроизведено ${result.played} из ${result.total}`;
  return status === 'stopped' ? `Остановлено · ${result.played} из ${result.total}` : `Выполнено ${result.played} из ${result.total}`;
}

export function ReactionCheck({ ref, gift, gifts, savedMapping, sounds, settings, automation, disabledReason, audioEnabled, onEnableAudio, player, speechQueue }: Props) {
  const titleId = useId();
  const hintId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLButtonElement>(null);
  const run = useRef<Run | null>(null);
  const [opened, setOpened] = useState(false);
  const [sample, setSample] = useState<Sample>(gift ? 'gift' : 'donor');
  const [count, setCount] = useState<GiftCount>(1);
  const [completionGiftId, setCompletionGiftId] = useState('');
  const [completionRuleId, setCompletionRuleId] = useState('');
  const [completionCount, setCompletionCount] = useState('1');
  const [withinCooldown, setWithinCooldown] = useState(false);
  const [repeatDonor, setRepeatDonor] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState('');
  const [enablingAudio, setEnablingAudio] = useState(false);
  const running = report?.status === 'running';
  const settingsValid = validPlaybackSettings(settings);
  const giftRules = automation?.eventReactions.filter((rule) => rule.eventType === 'gift_completed') ?? [];
  const completionRule = giftRules.find((rule) => rule.id === completionRuleId);
  const completionGift = gifts.find((item) => item.giftId === completionGiftId)
    ?? (completionGiftId === DEMO_GIFT.giftId ? DEMO_GIFT : undefined);
  const completionQuantity = Number(completionCount);
  const validQuantity = Number.isInteger(completionQuantity) && completionQuantity >= 1 && completionQuantity <= 2_147_483_647;
  const sampleValid = sample !== 'gift-completed' || (!!completionGift && validQuantity);
  const totalPoints = completionGift && validQuantity
    ? giftTotalPoints({ diamondCount: completionGift.diamondCount ?? undefined, repeatCount: completionQuantity })
    : undefined;
  let actions: ReactionCheckAction[] = [];
  if (opened && sampleValid) {
    const voiceVolume = speechQueue?.preferences.volume;
    if (sample === 'gift') actions = giftCheckActions(savedMapping, sounds, count, settings.volumePercent);
    else if (sample === 'donor') actions = donorCheckActions(automation, repeatDonor, sounds, settings.volumePercent, voiceVolume);
    else if (completionGift) actions = giftCompletionCheckActions(automation, sounds, {
      gift: completionGift, count: completionQuantity, ruleId: completionRuleId, withinCooldown, soundVolume: settings.volumePercent, voiceVolume,
    });
  }
  const firstSound = actions.find((action) => action.type === 'sound');
  const speechIndex = actions.findIndex((action) => action.type === 'speech');
  const needsAudio = (Boolean(firstSound) || speechIndex !== -1) && !audioEnabled;

  function resetResults() {
    setReport(null);
    setPlaybackNotice('');
  }

  const cancel = useCallback(() => {
    const previous = run.current;
    run.current = null;
    if (previous?.sound) player.stopPreview(previous.sound);
    if (previous?.speech) speechQueue?.stopPreview(previous.speech);
  }, [player, speechQueue]);

  useEffect(() => cancel, [cancel]);
  useLayoutEffect(() => {
    if (!disabledReason || !dialog.current?.open) return;
    cancel();
    dialog.current.close();
  }, [cancel, disabledReason]);

  function openCheck(trigger: HTMLButtonElement, ruleId = '') {
    if (disabledReason || !dialog.current || dialog.current.open) return;
    returnFocusTo.current = trigger;
    setSample(ruleId || (!gift && giftRules.length) ? 'gift-completed' : gift ? 'gift' : 'donor');
    setCount(1);
    setCompletionGiftId(giftRules.find((rule) => rule.id === ruleId)?.giftId ?? gift?.giftId ?? gifts[0]?.giftId ?? DEMO_GIFT.giftId);
    setCompletionRuleId(ruleId);
    setCompletionCount('1');
    setWithinCooldown(false);
    setRepeatDonor(false);
    resetResults();
    setOpened(true);
    dialog.current.showModal();
  }

  useImperativeHandle(ref, () => ({ openGiftRule: (ruleId, trigger) => openCheck(trigger, ruleId) }));

  function closeCheck() {
    cancel();
    dialog.current?.close();
  }

  function updateResult(current: Run, index: number, outcome: 'ended' | 'failed', completedCount = 1) {
    if (run.current !== current) return;
    setReport((previous) => {
      if (!previous || previous.status !== 'running' || run.current !== current) return previous;
      const results = previous.results.map((result, position) => position !== index ? result : {
        ...result, played: result.played + (outcome === 'ended' ? completedCount : 0),
        failed: result.failed + (outcome === 'failed' ? completedCount : 0),
      });
      const finished = results.every((result) => result.played + result.failed === result.total);
      return { status: finished ? 'finished' : 'running', results };
    });
  }

  function startCheck() {
    if (running || enablingAudio || disabledReason || !settingsValid || !sampleValid) return;
    const hasPlayback = Boolean(firstSound) || speechIndex !== -1;
    if (needsAudio) {
      setEnablingAudio(true);
      void onEnableAudio().then((enabled) => {
        setEnablingAudio(false);
        if (!dialog.current?.open) return;
        setPlaybackNotice(enabled ? '' : 'Звук не включён. Проверьте доступность файла и попробуйте ещё раз.');
      });
      return;
    }
    if (hasPlayback && (player.busy || speechQueue?.active || speechQueue?.pending)) {
      setPlaybackNotice('Дождитесь окончания звука или остановите его в пульте.');
      return;
    }
    setPlaybackNotice('');
    cancel();
    const current: Run = {};
    run.current = current;
    setReport({ status: hasPlayback ? 'running' : 'finished', results: actions.map(resultFor) });

    const interrupted = () => {
      if (run.current !== current) return;
      cancel();
      setReport((previous) => previous?.status === 'running' ? { ...previous, status: 'stopped' } : previous);
    };
    if (firstSound) {
      const testSound = player.createPreviewQueue(interrupted);
      current.sound = testSound;
      void testSound.unlock(settings.maxConcurrentSounds, firstSound.asset.url).then(() => {
        if (run.current !== current) return;
        actions.forEach((action, index) => {
          if (action.type === 'sound') {
            testSound.enqueue(action.asset, action.count, settings, (outcome) => updateResult(current, index, outcome));
          }
        });
      }).catch(() => {
        actions.forEach((action, index) => {
          if (action.type === 'sound') updateResult(current, index, 'failed', action.count);
        });
      });
    }

    const speech = actions[speechIndex];
    if (speech?.type === 'speech' && speechQueue && automation) {
      const testSpeech = speechQueue.createPreviewQueue(interrupted);
      current.speech = testSpeech;
      try {
        if (!testSpeech.enqueue(speech.job, automation.policy.maxQueueSize, (outcome) => updateResult(current, speechIndex, outcome))) {
          updateResult(current, speechIndex, 'failed');
        }
      } catch {
        updateResult(current, speechIndex, 'failed');
      }
    }
  }

  return <>
    <button type="button" className="quiet" aria-haspopup="dialog" aria-disabled={disabledReason ? true : undefined}
      aria-describedby={disabledReason ? hintId : undefined} onClick={(event) => openCheck(event.currentTarget)}>Проверить правило</button>
    {disabledReason ? <small className="reaction-check-hint" id={hintId}>{disabledReason}</small> : null}
    {createPortal(<dialog ref={dialog} className="reaction-check-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); closeCheck(); }}
      onClose={() => {
        if (dialog.current?.open) return;
        cancel();
        setOpened(false);
        returnFocusTo.current?.focus({ preventScroll: true });
        returnFocusTo.current = null;
      }}>
      <header>
        <h2 id={titleId}>Проверка реакции</h2>
        <button type="button" className="quiet" onClick={closeCheck}>Закрыть</button>
      </header>
      {opened ? <div className="reaction-check-body">
        <fieldset className="reaction-check-segments" disabled={running}>
          <legend>Что проверяем</legend>
          <button type="button" className="secondary" disabled={!gift} aria-pressed={sample === 'gift'}
            onClick={() => { setSample('gift'); resetResults(); }}>Подарок</button>
          {giftRules.length ? <button type="button" className="secondary" aria-pressed={sample === 'gift-completed'}
            onClick={() => { setSample('gift-completed'); resetResults(); }}>Завершение серии</button> : null}
          <button type="button" className="secondary" aria-pressed={sample === 'donor'}
            onClick={() => { setSample('donor'); resetResults(); }}>Появление дарителя</button>
        </fieldset>
        {sample === 'gift' && gift ? <>
          <div className="reaction-check-gift">
            {gift.imageUrl ? <img src={gift.imageUrl} alt="" referrerPolicy="no-referrer" /> : null}
            <div>
              <strong>{gift.giftName}</strong>
              <span>ID {gift.giftId}</span>
              <small>{savedMapping?.isEnabled ? `Сохранённый звук — ${savedMapping.soundDisplayName}` : savedMapping ? 'Привязка выключена' : 'Звук ещё не назначен'}</small>
            </div>
          </div>
          <fieldset className="reaction-check-segments" disabled={running}>
            <legend>Количество подарков</legend>
            {([1, 3, 100] as const).map((value) => <button key={value} type="button" className="secondary"
              aria-pressed={count === value} aria-label={value === 1 ? 'Один подарок' : `Серия из ${value} подарков`}
              onClick={() => { setCount(value); resetResults(); }}>×{value}</button>)}
          </fieldset>
          {count === 100 ? <p className="reaction-check-note">Длинную серию можно остановить в любой момент.</p> : null}
        </> : null}
        {sample === 'gift-completed' ? <fieldset className="reaction-check-fields" disabled={running}>
          <legend>Одиночный подарок или готовая серия</legend>
          <label>Правило<select value={completionRuleId} onChange={(event) => {
            const id = event.target.value;
            setCompletionRuleId(id);
            const configuredGift = giftRules.find((rule) => rule.id === id)?.giftId;
            if (configuredGift) setCompletionGiftId(configuredGift);
            setWithinCooldown(false);
            resetResults();
          }}>
            <option value="">Первое подходящее</option>
            {giftRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}{rule.isEnabled ? '' : ' · выключено'}</option>)}
          </select></label>
          {completionRule ? <p className="reaction-check-note">В результате будут действия и условия выбранного правила.</p> : null}
          <label>Тестовый подарок<select value={completionGiftId} onChange={(event) => { setCompletionGiftId(event.target.value); resetResults(); }}>
            <option value={DEMO_GIFT.giftId}>Тестовый подарок · {DEMO_GIFT.diamondCount} баллов за штуку</option>
            {gifts.map((item) => <option key={item.giftId} value={item.giftId}>{item.giftName} · ID {item.giftId}</option>)}
          </select></label>
          <label>Количество в серии<input type="number" min="1" max="2147483647" step="1" inputMode="numeric" value={completionCount}
            onChange={(event) => { setCompletionCount(event.target.value); resetResults(); }} /></label>
          {completionGift ? <p className="reaction-check-note">{!validQuantity ? 'Укажите целое количество от 1.'
            : totalPoints === undefined ? 'Итоговая стоимость неизвестна.' : `Итоговая стоимость — ${totalPoints.toLocaleString('ru-RU')} баллов.`}</p> : null}
          {completionRule && completionRule.cooldownSeconds > 0 ? <label className="reaction-check-checkbox">
            <input type="checkbox" checked={withinCooldown} onChange={(event) => { setWithinCooldown(event.target.checked); resetResults(); }} />
            Правило только что сработало
          </label> : null}
        </fieldset> : null}
        {sample === 'donor' ? <fieldset className="reaction-check-segments" disabled={running}>
          <legend>Тестовый зритель</legend>
          <button type="button" className="secondary" aria-pressed={!repeatDonor}
            onClick={() => { setRepeatDonor(false); resetResults(); }}>Появился впервые</button>
          <button type="button" className="secondary" aria-pressed={repeatDonor}
            onClick={() => { setRepeatDonor(true); resetResults(); }}>Появился снова</button>
        </fieldset> : null}
        {settingsValid && sample !== 'gift-completed' ? <p className="reaction-check-settings">
          <strong>{MODES[settings.playbackMode]}</strong>
          <span>{playbackOverlapPercent(settings)}% перекрытия · до {settings.maxConcurrentSounds} одновременно · громкость {settings.volumePercent}%</span>
        </p> : null}
        {!settingsValid ? <p className="reaction-check-note">Закройте окно и проверьте значения в блоке «Наложение».</p> : null}
        <div className="actions reaction-check-controls">
          <button type="button" className={running ? 'danger' : undefined}
            disabled={!running && (Boolean(disabledReason) || enablingAudio || !settingsValid || !sampleValid)}
            onClick={running ? () => {
              cancel();
              setReport((previous) => previous ? { ...previous, status: 'stopped' } : null);
            } : startCheck}>
            {running ? 'Остановить проверку' : enablingAudio ? 'Разрешаем звук…' : needsAudio ? 'Включить звук в этой вкладке' : 'Запустить проверку'}
          </button>
        </div>
        {playbackNotice ? <p className="reaction-check-note" role="status">{playbackNotice}</p> : null}
        {needsAudio && !playbackNotice ? <p className="reaction-check-note">Если звук идёт в другой вкладке, он переключится сюда.</p> : null}
        <p className="reaction-check-note">Проверка не влияет на статистику эфира.</p>
        <p className="reaction-check-summary" role="status">{report?.status === 'running' ? 'Проверяем реакцию…'
          : report?.status === 'stopped' ? 'Проверка остановлена.' : report ? 'Проверка завершена.' : ''}</p>
        {report ? <ul className="reaction-check-results" aria-label="Результаты проверки">{report.results.map((result, index) => <li key={index}>
          <strong>{result.label}</strong>
          <span data-error={result.failed > 0}>{resultStatus(result, report.status)}</span>
          {result.detail ? <small>{result.detail}</small> : null}
          {result.failed > 0 ? <small>Сбоев — {result.failed}. Проверьте звук или голос в браузере и попробуйте снова.</small> : null}
        </li>)}</ul> : null}
        {report?.results.some((result) => result.played > 0 || result.failed > 0) ? <p className="reaction-check-note">
          Проверьте громкость устройства и беззвучный режим, если звук пропал.
        </p> : null}
      </div> : null}
    </dialog>, document.body)}
  </>;
}
