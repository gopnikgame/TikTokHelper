import { useEffect, useId, useRef, useState } from 'react';
import { appPath } from '../app-path.js';

type PracticeGift = { id: number; count: 1 | 2; series: boolean };
type SoundState = 'idle' | 'loading' | 'playing' | 'error';

const FEED_LIMIT = 4;
const MESSAGE = 'Привет! Эфир видно.';

function releaseAudio(audio: HTMLAudioElement | null) {
  if (!audio?.hasAttribute('src')) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export function TutorialPractice() {
  const titleId = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const playback = useRef(0);
  const nextId = useRef(0);
  const [messages, setMessages] = useState<number[]>([]);
  const [gifts, setGifts] = useState<PracticeGift[]>([]);
  const [overlap, setOverlap] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundState, setSoundState] = useState<SoundState>('idle');

  useEffect(() => {
    const element = audio.current;
    return () => {
      playback.current += 1;
      releaseAudio(element);
    };
  }, []);

  function stopSound() {
    playback.current += 1;
    releaseAudio(audio.current);
    setSoundState('idle');
  }

  function playGift(count: 1 | 3) {
    const element = audio.current;
    if (!element || !soundEnabled) return;
    const request = ++playback.current;
    const file = count === 1 ? 'practice-single' : `practice-series-${overlap}`;
    releaseAudio(element);
    element.src = appPath(`tutorial/${file}.wav`);
    setSoundState('loading');
    void element.play().then(() => {
      if (playback.current === request) setSoundState('playing');
    }).catch(() => {
      if (playback.current === request) setSoundState('error');
    });
  }

  function addMessage() {
    const id = ++nextId.current;
    setMessages((current) => [id, ...current].slice(0, FEED_LIMIT));
  }

  function addGift(count: 1 | 3) {
    const first: PracticeGift = { id: ++nextId.current, count: 1, series: count === 3 };
    const received: PracticeGift[] = count === 3
      ? [{ id: ++nextId.current, count: 2, series: true }, first]
      : [first];
    setGifts((current) => [...received, ...current].slice(0, FEED_LIMIT));
    playGift(count);
  }

  const soundMessage = soundState === 'error'
    ? 'Не удалось воспроизвести звук. Нажмите на подарок ещё раз.'
    : soundState === 'loading' ? 'Загружаем учебный звук…'
      : soundState === 'playing' ? 'Играет учебный звук.'
        : soundEnabled ? 'Учебный звук включён.' : 'Учебный звук выключен.';

  return <section className="tutorial-panel tutorial-practice" aria-labelledby={titleId}>
    <div className="tutorial-panel-heading">
      <h3 id={titleId}>Учебный эфир</h3>
      <p>Получите сообщение или подарок и проверьте реакцию пульта. Учебные события появляются только здесь.</p>
    </div>
    <div className="tutorial-practice-options">
      <label>Перекрытие звука
        <select value={overlap} onChange={(event) => { stopSound(); setOverlap(Number(event.target.value)); }}>
          <option value="0">0% · Последовательно</option>
          <option value="50">50% · С перекрытием</option>
        </select>
      </label>
      <button type="button" className="secondary" onClick={() => {
        stopSound();
        setSoundEnabled(!soundEnabled);
      }}>{soundEnabled ? 'Выключить учебный звук' : 'Включить учебный звук'}</button>
    </div>
    <p className="tutorial-sound-status" role="status" data-error={soundState === 'error' || undefined}>{soundMessage}</p>
    <div className="actions tutorial-practice-actions">
      <button type="button" className="secondary" onClick={addMessage}>Получить сообщение</button>
      <button type="button" onClick={() => addGift(1)}>Подарок ×1</button>
      <button type="button" onClick={() => addGift(3)}>Серия из 3</button>
    </div>

    <div className="tutorial-practice-feeds">
      <section className="tutorial-feed" aria-label="Учебный чат">
        <h4>Чат</h4>
        <ul aria-live="polite">
          {messages.length === 0 ? <li className="tutorial-feed-empty">Сообщений пока нет.</li> : messages.map((id) => <li key={id}>
            <strong>Учебный зритель</strong><span>{MESSAGE}</span>
          </li>)}
        </ul>
      </section>
      <section className="tutorial-feed" aria-label="Учебные подарки">
        <h4>Подарки</h4>
        <ul aria-live="polite">
          {gifts.length === 0 ? <li className="tutorial-feed-empty">Подарков пока нет.</li> : gifts.map((gift) => <li key={gift.id}>
            <strong>Роза ×{gift.count}</strong><span>{gift.series ? 'Добавление серии' : 'Одиночный подарок'}</span>
          </li>)}
        </ul>
      </section>
    </div>
    <div className="actions tutorial-practice-tools">
      <button type="button" className="quiet" disabled={soundState !== 'playing' && soundState !== 'loading'} onClick={stopSound}>Остановить звук</button>
      <button type="button" className="quiet" disabled={!messages.length && !gifts.length} onClick={() => {
        stopSound();
        setMessages([]);
        setGifts([]);
      }}>Очистить тренировку</button>
    </div>
    <audio ref={audio} preload="none" onEnded={(event) => {
      if (event.currentTarget.ended) setSoundState('idle');
    }} onError={(event) => {
      if (event.currentTarget.error) {
        playback.current += 1;
        setSoundState('error');
      }
    }} />
  </section>;
}
