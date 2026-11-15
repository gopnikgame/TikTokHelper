import { useEffect, useRef, useState } from 'react';
import { STREAM_OVERLAY_KINDS, isGiftGoalOverlayToken, type StreamOverlayKind } from '@tiktok-helper/contracts/overlays';
import { appPath } from '../app-path.js';
import './controls.css';

type LinkAction = 'load' | 'enable' | 'revoke';
type LinkState =
  | { status: 'working'; action: LinkAction }
  | { status: 'error'; action: LinkAction }
  | { status: 'ready'; token: string | null };

const actionText = {
  load: { label: 'Повторить', working: 'Проверяем состояние ссылки…', error: 'Не удалось проверить состояние ссылки.' },
  enable: { label: 'Создать ссылку', working: 'Создаём ссылку…', error: 'Не удалось подтвердить создание ссылки.' },
  revoke: { label: 'Отозвать ссылку', working: 'Отзываем ссылку…', error: 'Не удалось подтвердить отзыв ссылки.' },
} satisfies Record<LinkAction, { label: string; working: string; error: string }>;

const kindNames = {
  'gift-goal': 'Цель по подаркам',
  'last-gift': 'Последний подарок',
  'like-goal': 'Цель по лайкам',
  'live-poll': 'Голосование',
} satisfies Record<StreamOverlayKind, string>;

const loadingState = { status: 'working', action: 'load' } satisfies LinkState;

function sourceUrl(kind: StreamOverlayKind, token: string) {
  const url = new URL(appPath('gift-goal-overlay.html'), window.location.origin);
  if (kind !== 'gift-goal') url.searchParams.set('view', kind);
  url.hash = token;
  return url.href;
}

function LinkControls({ workspaceId }: { workspaceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<StreamOverlayKind>('gift-goal');
  const [states, setStates] = useState<Partial<Record<StreamOverlayKind, LinkState>>>({});
  const [copy, setCopy] = useState<'copied' | 'manual' | null>(null);
  const requests = useRef(new Map<StreamOverlayKind, AbortController>());
  const copyAttempt = useRef(0);
  const manualInput = useRef<HTMLInputElement | null>(null);

  function resetCopy() {
    copyAttempt.current += 1;
    setCopy(null);
  }

  function changeLink(kind: StreamOverlayKind, action: LinkAction) {
    resetCopy();
    const pending = requests.current;
    if (pending.has(kind)) return;
    const controller = new AbortController();
    pending.set(kind, controller);
    setStates((current) => ({ ...current, [kind]: { status: 'working', action } }));
    const timeout = action === 'load' ? window.setTimeout(() => controller.abort(), 10_000) : undefined;
    const update = action === 'load' ? {} : {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: action === 'enable' }),
    };
    const endpoint = appPath(`api/workspaces/${encodeURIComponent(workspaceId)}/${kind}-overlay`);
    void fetch(endpoint, {
      ...update, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Overlay link request failed');
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('token' in result)) {
        throw new Error('Invalid overlay link response');
      }
      const { token } = result;
      if (token !== null && !isGiftGoalOverlayToken(token)) throw new Error('Invalid overlay token');
      if (pending.get(kind) === controller) {
        setStates((current) => ({ ...current, [kind]: { status: 'ready', token } }));
      }
    }).catch(() => {
      if (pending.get(kind) === controller) {
        setStates((current) => ({ ...current, [kind]: { status: 'error', action } }));
      }
    }).finally(() => {
      window.clearTimeout(timeout);
      if (pending.get(kind) === controller) pending.delete(kind);
    });
  }

  useEffect(() => {
    const pending = requests.current;
    return () => {
      copyAttempt.current += 1;
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (copy === 'manual') manualInput.current?.focus();
  }, [copy]);

  function toggleDetails(open: boolean) {
    setExpanded(open);
    if (open) {
      changeLink(selection, 'load');
    } else {
      resetCopy();
    }
  }

  function selectKind(value: string) {
    const kind = STREAM_OVERLAY_KINDS.find((item) => item === value);
    if (!kind || kind === selection) return;
    setSelection(kind);
    changeLink(kind, 'load');
  }

  async function copyLink(token: string) {
    if (requests.current.has(selection)) return;
    const attempt = ++copyAttempt.current;
    if (copy === 'manual') {
      manualInput.current?.focus();
      manualInput.current?.select();
      return;
    }
    try {
      await navigator.clipboard.writeText(sourceUrl(selection, token));
      if (copyAttempt.current === attempt) setCopy('copied');
    } catch {
      if (copyAttempt.current === attempt) setCopy('manual');
    }
  }

  const state = states[selection] ?? loadingState;
  const token = state.status === 'ready' ? state.token : null;
  const working = state.status === 'working';
  const action = state.status === 'ready' ? (token ? 'revoke' : 'enable') : (working ? state.action : 'load');
  const statusText = working ? actionText[state.action].working : token ? 'Ссылка активна.' : 'Виджет выключен.';

  return <details className="stream-overlay-settings" onToggle={(event) => toggleDetails(event.currentTarget.open)}>
    <summary>Виджеты для OBS и LIVE Studio</summary>
    {expanded ? <div className="stream-overlay-controls">
      <label className="stream-overlay-field">Вид виджета
        <select value={selection} onChange={(event) => selectKind(event.target.value)}>
          {STREAM_OVERLAY_KINDS.map((kind) => <option key={kind} value={kind}>{kindNames[kind]}</option>)}
        </select>
      </label>
      <p className="stream-overlay-hint">Вставьте ссылку в источник «Браузер» в OBS или «Ссылка» в LIVE Studio.</p>
      <p className="stream-overlay-hint">Ссылка выбранного виджета действует до отзыва или перезапуска сервера.</p>
      {state.status === 'error' ? <p className="stream-overlay-error" role="alert">{actionText[state.action].error}</p> :
        <p className="stream-overlay-hint" role="status">
          {copy === 'copied' ? 'Ссылка скопирована.' : copy === 'manual' ? 'Скопируйте ссылку из поля.' : statusText}
        </p>}
      <div className="actions" aria-busy={working}>
        {token ? <button type="button" className="quiet" onClick={() => void copyLink(token)}>Скопировать ссылку</button> : null}
        <button type="button" className="quiet" aria-disabled={working || undefined} onClick={() => changeLink(selection, action)}>
          {actionText[action].label}
        </button>
      </div>
      {token && copy === 'manual' ? <label className="stream-overlay-field">Ссылка для источника
        <input ref={manualInput} type="text" value={sourceUrl(selection, token)} readOnly dir="ltr" spellCheck={false} autoComplete="off"
          onFocus={(event) => event.currentTarget.select()} />
      </label> : null}
    </div> : null}
  </details>;
}

export function StreamOverlayControls({ workspaceId }: { workspaceId: string }) {
  return <LinkControls key={workspaceId} workspaceId={workspaceId} />;
}
