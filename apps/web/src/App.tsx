import { getHealthLabel } from './health-label.js';

export function App() {
  return (
    <main>
      <p className="eyebrow">TikTokHelper</p>
      <h1>Помощник для трансляции переезжает в браузер</h1>
      <p>{getHealthLabel({ status: 'ok' })}</p>
    </main>
  );
}
