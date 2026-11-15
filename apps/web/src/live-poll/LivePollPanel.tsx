import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
  LIVE_POLL_MAX_OPTIONS, LIVE_POLL_MIN_OPTIONS, LIVE_POLL_OPTION_MAX_LENGTH, LIVE_POLL_QUESTION_MAX_LENGTH,
  type LivePoll, type LivePollState, type StartLivePoll,
} from '@tiktok-helper/contracts/live-poll';
import './live-poll.css';

interface Props {
  state: LivePollState | null;
  isCurrent: boolean;
  isLive: boolean;
  liveOnly: boolean;
  onStart(input: StartLivePoll): Promise<void>;
  onClose(pollId: string): Promise<void>;
}

const initialOptions = Array<string>(LIVE_POLL_MIN_OPTIONS).fill('');
const number = new Intl.NumberFormat('ru-RU');
const plural = new Intl.PluralRules('ru-RU');
const voteNouns = { one: 'голос', few: 'голоса', many: 'голосов', other: 'голоса', zero: 'голосов', two: 'голоса' };

function formatVotes(count: number): string {
  return `${number.format(count)} ${voteNouns[plural.select(count)]}`;
}

function PollResults({ poll, acceptsVotes }: { poll: LivePoll; acceptsVotes: boolean }) {
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);

  return <div className="live-poll-results">
    <div className="live-poll-result-heading">
      <h3 dir="auto">{poll.question}</h3>
      <p className="live-poll-total">Всего {formatVotes(total)}</p>
    </div>
    {acceptsVotes ? <p className="live-poll-hint">
      Попросите зрителей отправить в чат TikTok только команду рядом с вариантом ответа. Засчитывается первый голос.
    </p> : null}
    <ul className="live-poll-options" aria-label="Голоса по вариантам">
      {poll.options.map((option, index) => <li key={index}>
        <code dir="ltr">!{index + 1}</code>
        <bdi>{option.label}</bdi>
        <strong>{formatVotes(option.votes)}</strong>
        <progress aria-hidden="true" max={Math.max(1, total)} value={option.votes} />
      </li>)}
    </ul>
  </div>;
}

export function LivePollPanel({ state, isCurrent, isLive, liveOnly, onStart, onClose }: Props) {
  const headingId = useId();
  const availabilityId = useId();
  const errorId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const optionInputs = useRef<(HTMLInputElement | null)[]>([]);
  const optionToFocus = useRef<number | null>(null);
  const restoreFocus = useRef(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(initialOptions);
  const [pending, setPending] = useState<'start' | 'close' | null>(null);
  const [error, setError] = useState('');
  const poll = state?.poll;
  const pollOpen = poll?.status === 'open';
  const connectionId = state?.connectionId;
  const canStart = Boolean(isCurrent && isLive && connectionId && !pollOpen);

  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    if (document.activeElement === document.body) heading.current?.focus({ preventScroll: true });
  }, [poll?.id, poll?.status]);

  useEffect(() => {
    const index = optionToFocus.current;
    if (index === null) return;
    optionToFocus.current = null;
    optionInputs.current[index]?.focus();
  }, [options.length]);

  async function updatePoll(action: 'start' | 'close', request: () => Promise<void>) {
    if (pending) return;
    setError('');
    setPending(action);
    restoreFocus.current = true;
    try {
      await request();
      if (action === 'start') {
        setQuestion('');
        setOptions(initialOptions);
      }
    } catch (cause) {
      restoreFocus.current = false;
      const fallback = action === 'start' ? 'Не удалось начать голосование.' : 'Не удалось завершить голосование.';
      setError(cause instanceof Error && cause.message ? cause.message : fallback);
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canStart || !connectionId) return;
    const input = {
      connectionId,
      previousPollId: poll?.id ?? null,
      question: question.trim(),
      options: options.map((option) => option.trim()),
    } satisfies StartLivePoll;
    void updatePoll('start', () => onStart(input));
  }

  function addOption() {
    optionToFocus.current = options.length;
    setOptions([...options, '']);
  }

  function removeOption() {
    optionToFocus.current = options.length - 2;
    setOptions(options.slice(0, -1));
    setError('');
  }

  if (liveOnly && !poll) return null;
  let availability = '';
  if (!isCurrent) {
    availability = poll ? 'Показаны последние полученные голоса. Ждём обновления.' : 'Ждём данные голосования…';
  } else if (!state || (isLive && !connectionId)) {
    availability = 'Данные голосования пока недоступны.';
  } else if (!isLive) {
    availability = pollOpen ? 'Ждём подключения к эфиру.' : 'Подключите эфир, чтобы начать голосование.';
  }

  return <section className="live-poll-panel" data-compact={liveOnly} aria-labelledby={headingId}>
    <header className="live-poll-heading">
      <h2 id={headingId} ref={heading} tabIndex={-1}>Голосование в чате</h2>
      <div className="live-poll-status">
        <p role="status">
          {isCurrent && poll ? pollOpen ? 'Голосование открыто' : 'Голосование завершено' : ''}
        </p>
        {pollOpen ? <button type="button" className="quiet" disabled={!isCurrent || pending !== null}
          aria-describedby={availability ? availabilityId : undefined}
          onClick={() => void updatePoll('close', () => onClose(poll.id))}>
          {pending === 'close' ? 'Завершаем…' : 'Завершить голосование'}
        </button> : null}
      </div>
    </header>
    <p className="live-poll-availability live-poll-hint" id={availabilityId} role="status">{availability}</p>
    {poll ? <PollResults poll={poll} acceptsVotes={isCurrent && isLive && pollOpen} /> : null}
    {!liveOnly && !pollOpen && connectionId ? <details className="live-poll-draft">
      <summary>Создать голосование</summary>
      <form onSubmit={submit} aria-describedby={error ? errorId : availability ? availabilityId : undefined}>
        <fieldset disabled={!canStart || pending !== null} aria-busy={pending === 'start'} aria-label="Настройки голосования">
          <label>Вопрос
            <input required dir="auto" value={question} maxLength={LIVE_POLL_QUESTION_MAX_LENGTH} pattern={String.raw`.*\S.*`}
              onChange={(event) => { setQuestion(event.target.value); setError(''); }} />
          </label>
          <div className="live-poll-draft-options">
            {options.map((option, index) => <label key={index}>Вариант {index + 1}
              <input required dir="auto" value={option} maxLength={LIVE_POLL_OPTION_MAX_LENGTH} pattern={String.raw`.*\S.*`}
                ref={(input) => { optionInputs.current[index] = input; }}
                onChange={(event) => {
                  const value = event.target.value;
                  setOptions((current) => current.map((item, position) => position === index ? value : item));
                  setError('');
                }} />
            </label>)}
          </div>
          <div className="live-poll-actions">
            {options.length < LIVE_POLL_MAX_OPTIONS ? <button type="button" className="quiet" onClick={addOption}>Добавить вариант</button> : null}
            {options.length > LIVE_POLL_MIN_OPTIONS ? <button type="button" className="quiet" onClick={removeOption}>Убрать последний вариант</button> : null}
            <button type="submit">{pending === 'start' ? 'Запускаем…' : 'Начать голосование'}</button>
          </div>
        </fieldset>
      </form>
    </details> : null}
    <p className="live-poll-error" id={errorId} role="alert">{error}</p>
  </section>;
}
