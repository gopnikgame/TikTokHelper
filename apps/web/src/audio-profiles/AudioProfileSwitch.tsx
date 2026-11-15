import type { AudioProfileMode } from './model.js';
import './audio-profiles.css';

interface AudioProfileSwitchProps {
  mode: AudioProfileMode;
  onChange: (mode: AudioProfileMode) => void;
}

export function AudioProfileSwitch({ mode, onChange }: AudioProfileSwitchProps) {
  return <div className="audio-profile-switch" role="group" aria-label="Профиль звука">
    <button type="button" className="quiet" aria-pressed={mode === 'normal'} onClick={() => onChange('normal')}>
      Обычный
    </button>
    <button type="button" className="quiet" aria-pressed={mode === 'quiet'} onClick={() => onChange('quiet')}>
      Тихий
    </button>
  </div>;
}
