import { useEffect, useId, useRef, useState } from 'react';
import { appPath } from '../app-path.js';
import { TutorialPractice } from './TutorialPractice.js';
import './tutorial.css';

const LESSONS = [
  { file: '01-login', title: 'Вход в VLine и переход в пульт', label: 'Вход в пульт', seconds: 30, description: 'Войдите в личный кабинет VLine и откройте TikTokHelper.' },
  { file: '02-live', title: 'Подключение эфира', label: 'Подключение эфира', seconds: 24, description: 'Запустите эфир в TikTok, введите @ник и дождитесь первого сообщения.' },
  { file: '03-gifts', title: 'Звук на подарки', label: 'Звук на подарки', seconds: 35, description: 'Включите звук в этой вкладке и назначьте реакцию на подарок.' },
  { file: '04-custom-sound', title: 'Свой звук и настройки серии', label: 'Свой звук и серия', seconds: 39, description: 'Загрузите аудиофайл и сравните повторы при разном перекрытии.' },
] as const;

type Lesson = (typeof LESSONS)[number];
type Topic = Lesson['file'] | 'practice';

export function TutorialGuide() {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);

  function openGuide() {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
    setOpened(true);
  }

  return <>
    <button ref={trigger} type="button" className="secondary tutorial-trigger" aria-haspopup="dialog" onClick={openGuide}>Как пользоваться</button>
    <dialog ref={dialog} className="tutorial-dialog" aria-labelledby={titleId} onClose={() => {
      if (dialog.current?.open) return;
      setOpened(false);
      trigger.current?.focus({ preventScroll: true });
    }}>
      <header className="tutorial-dialog-header">
        <h2 id={titleId}>Как пользоваться</h2>
        <button type="button" className="quiet" onClick={() => dialog.current?.close()}>Закрыть</button>
      </header>
      {opened ? <TutorialContent /> : null}
    </dialog>
  </>;
}

function TutorialContent() {
  const [topic, setTopic] = useState<Topic>(LESSONS[0].file);
  const lesson = LESSONS.find((item) => item.file === topic);

  return <div className="tutorial-layout">
    <nav className="tutorial-navigation" aria-label="Уроки и тренировка">
      <ol className="tutorial-chapters">
        {LESSONS.map((item) => <li key={item.file}>
          <button type="button" className="quiet tutorial-chapter" aria-pressed={topic === item.file} onClick={() => setTopic(item.file)}>
            <span>{item.label}</span><small>{item.seconds} с</small>
          </button>
        </li>)}
      </ol>
      <button type="button" className="quiet tutorial-practice-tab" aria-pressed={topic === 'practice'} onClick={() => setTopic('practice')}>Тренировка</button>
    </nav>
    {lesson ? <LessonPlayer key={lesson.file} lesson={lesson} /> : <TutorialPractice />}
  </div>;
}

function LessonPlayer({ lesson }: { lesson: Lesson }) {
  const player = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const mediaPath = appPath(`tutorial/${lesson.file}`);
  useEffect(() => {
    const video = player.current;
    return () => video?.pause();
  }, []);

  function startLesson() {
    const video = player.current;
    if (!video) return;
    void video.play().catch((error: unknown) => {
      if (video.isConnected && !(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    });
    video.scrollIntoView({ block: 'nearest' });
    video.focus({ preventScroll: true });
  }

  return <section className="tutorial-panel tutorial-lesson" aria-labelledby={titleId}>
    <div className="tutorial-panel-heading">
      <h3 id={titleId}>{lesson.title}</h3>
      <p>{lesson.description}</p>
    </div>
    <div className="tutorial-video-frame">
      <video ref={player} className="tutorial-video" controls playsInline preload="metadata" aria-labelledby={titleId}
        src={`${mediaPath}.mp4`} poster={`${mediaPath}.webp`} onPlaying={() => {
          setStarted(true);
          setFailed(false);
        }} onError={() => setFailed(true)}>
        <track kind="captions" src={`${mediaPath}.ru.vtt`} srcLang="ru" label="Русский" />
      </video>
      {!started && !failed ? <button type="button" className="tutorial-video-start" onClick={startLesson}>Смотреть урок</button> : null}
    </div>
    {failed ? <p className="tutorial-media-error" role="alert">Видео не загрузилось. <a href={`${mediaPath}.mp4`} target="_blank" rel="noopener">Открыть MP4 в новой вкладке</a></p> : null}
  </section>;
}
