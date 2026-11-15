import { useEffect, useId, useRef, useState } from 'react';
import { appPath } from '../app-path.js';
import { TutorialPractice } from './TutorialPractice.js';
import './tutorial.css';

const ADMIN_LESSON = '07-regional-gifts';

const LESSONS = [
  { file: '01-login', title: 'Вход в VLine и переход в пульт', label: 'Вход в пульт', seconds: 30, description: 'Войдите в личный кабинет VLine и откройте TikTokHelper.' },
  { file: '02-live', title: 'Подключение эфира', label: 'Подключение эфира', seconds: 24, description: 'Запустите эфир в TikTok, введите @ник и дождитесь первого сообщения.' },
  { file: '03-gifts', title: 'Звук на подарки', label: 'Звук на подарки', seconds: 35, description: 'Включите звук в этой вкладке и назначьте реакцию на подарок.' },
  { file: '04-custom-sound', title: 'Свой звук и настройки серии', label: 'Свой звук и серия', seconds: 39, description: 'Загрузите аудиофайл и сравните повторы при разном перекрытии.' },
  { file: '05-live-desk', title: 'Пульт во время эфира', label: 'Пульт во время эфира', seconds: 33, description: 'Читайте чат в режиме «Только эфир», закрепляйте реплики и переключайте профиль звука.' },
  { file: '06-live-goals', title: 'Активность и цели эфира', label: 'Активность и цели', seconds: 43, description: 'Смотрите активность зрителей и настройте цели по лайкам и подаркам.' },
  { file: ADMIN_LESSON, title: 'Подарки по регионам', label: 'Подарки по регионам', seconds: 29, description: 'Выберите регион, найдите подарок по названию или ID и назначьте ему звук.' },
  { file: '08-gift-reactions', title: 'Расширенные реакции на подарки', label: 'Реакции на подарки', seconds: 43, description: 'Задайте реакцию на подарок или завершённую серию и проверьте правило на учебном примере.' },
  { file: '09-chat-poll', title: 'Голосование в чате', label: 'Голосование в чате', seconds: 26, description: 'Создайте опрос, предложите зрителям команды и посмотрите итоги голосования.' },
  { file: '10-obs-widgets', title: 'Виджеты в OBS', label: 'Виджеты в OBS', seconds: 35, description: 'Создайте ссылки на виджеты и добавьте их как браузерные источники в сцену OBS.' },
] as const;

type Lesson = (typeof LESSONS)[number];
type Topic = Lesson['file'] | 'practice';

export function TutorialGuide({ isAdmin }: { isAdmin: boolean }) {
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
      {opened ? <TutorialContent isAdmin={isAdmin} /> : null}
    </dialog>
  </>;
}

function TutorialContent({ isAdmin }: { isAdmin: boolean }) {
  const [topic, setTopic] = useState<Topic>(LESSONS[0].file);
  const lessons = LESSONS.filter((item) => isAdmin || item.file !== ADMIN_LESSON);
  const lesson = topic === 'practice' ? null : lessons.find((item) => item.file === topic) ?? LESSONS[0];
  const selectedTopic = lesson?.file ?? 'practice';

  return <div className="tutorial-layout">
    <nav className="tutorial-navigation" aria-label="Уроки и тренировка">
      <label className="tutorial-picker">Урок или тренировка
        <select value={selectedTopic} onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === 'practice') setTopic(next);
          else {
            const nextLesson = lessons.find((item) => item.file === next);
            if (nextLesson) setTopic(nextLesson.file);
          }
        }}>
          {lessons.map((item) => <option key={item.file} value={item.file}>{item.label} · {item.seconds} с</option>)}
          <option value="practice">Тренировка</option>
        </select>
      </label>
      <ol className="tutorial-chapters">
        {lessons.map((item) => <li key={item.file}>
          <button type="button" className="quiet tutorial-chapter" aria-pressed={selectedTopic === item.file} onClick={() => setTopic(item.file)}>
            <span>{item.label}</span><small>{item.seconds} с</small>
          </button>
        </li>)}
      </ol>
      <button type="button" className="quiet tutorial-practice-tab" aria-pressed={selectedTopic === 'practice'} onClick={() => setTopic('practice')}>Тренировка</button>
    </nav>
    {lesson ? <LessonPlayer key={lesson.file} lesson={lesson} /> : <TutorialPractice />}
  </div>;
}

function LessonPlayer({ lesson }: { lesson: Lesson }) {
  const player = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const mediaDirectory = lesson.file === ADMIN_LESSON ? 'api/tutorial/admin' : 'tutorial';
  const mediaPath = appPath(`${mediaDirectory}/${lesson.file}`);
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
      <video ref={player} className="tutorial-video" controls={started} playsInline preload="metadata" aria-labelledby={titleId}
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
