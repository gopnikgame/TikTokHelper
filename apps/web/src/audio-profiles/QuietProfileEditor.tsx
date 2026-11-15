import { useId, useState } from 'react';
import type { QuietProfileOptions } from './model.js';
import './audio-profiles.css';

interface QuietProfileEditorProps {
  value: QuietProfileOptions;
  onSave: (value: QuietProfileOptions) => void;
}

export function QuietProfileEditor({ value, onSave }: QuietProfileEditorProps) {
  const [draft, setDraft] = useState(value);
  const volumeId = useId();
  const volumePercent = `${draft.volumeLimitPercent}%`;

  return <details className="quiet-profile-editor">
    <summary>Настроить тихий профиль</summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      onSave(draft);
    }}>
      <div className="quiet-profile-volume">
        <div className="quiet-profile-volume-label">
          <label htmlFor={volumeId}>Предел громкости</label>
          <span aria-hidden="true">{volumePercent}</span>
        </div>
        <input
          id={volumeId}
          type="range"
          min={0}
          max={100}
          value={draft.volumeLimitPercent}
          aria-valuetext={volumePercent}
          onChange={(event) => {
            const volumeLimitPercent = event.currentTarget.valueAsNumber;
            setDraft((current) => ({ ...current, volumeLimitPercent }));
          }}
        />
      </div>
      <label className="check-row quiet-profile-speech">
        <input type="checkbox" checked={draft.speechEnabled} onChange={(event) => {
          const speechEnabled = event.currentTarget.checked;
          setDraft((current) => ({ ...current, speechEnabled }));
        }} />
        Озвучивать чат и реакции
      </label>
      <p>Звуки подарков играют по очереди. Настройки сохраняются в этом браузере.</p>
      <button type="submit" className="quiet">Сохранить тихий профиль</button>
    </form>
  </details>;
}
