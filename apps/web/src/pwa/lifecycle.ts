import { useCallback, useEffect, useRef, useState } from 'react';
import { APPLICATION_BASE, appPath } from '../app-path.js';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export interface PwaLifecycle {
  installed: boolean;
  manualInstallHelp: boolean;
  updateReady: boolean;
  install(): Promise<void>;
  dismissManualInstallHelp(): void;
  applyUpdate(): void;
}

export function updateBlockedByLive(connectionState: string): boolean {
  return connectionState === 'connecting' || connectionState === 'live' || connectionState === 'reconnecting';
}

export function genericInstallInstructions(): string {
  return 'Откройте меню браузера и выберите «Установить приложение» или «Добавить на экран Домой».';
}

function runningStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as NavigatorWithStandalone).standalone);
}

export function usePwaLifecycle(): PwaLifecycle {
  const [installed, setInstalled] = useState(() => runningStandalone());
  const [manualInstallHelp, setManualInstallHelp] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const reloadRequested = useRef(false);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); setManualInstallHelp(false); };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
    const serviceWorker = navigator.serviceWorker;
    const scope = new URL(APPLICATION_BASE, window.location.origin).href;
    const script = new URL(appPath('sw.js'), window.location.origin).href;
    const ownsController = () => serviceWorker.controller?.scriptURL === script;
    const cleanup = new AbortController();
    let registration: ServiceWorkerRegistration | undefined;

    const onUpdateFound = () => {
      const worker = registration?.installing;
      if (!worker) return;
      const onStateChange = () => {
        if (worker.state === 'installed' && ownsController()) {
          setWaitingWorker(registration?.waiting ?? worker);
        }
      };
      worker.addEventListener('statechange', onStateChange, { signal: cleanup.signal });
    };
    const onControllerChange = () => {
      if (reloadRequested.current && ownsController()) {
        reloadRequested.current = false;
        window.location.reload();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => undefined);
    };

    serviceWorker.addEventListener('controllerchange', onControllerChange, { signal: cleanup.signal });
    document.addEventListener('visibilitychange', onVisibilityChange, { signal: cleanup.signal });
    void serviceWorker.register(script, { scope, updateViaCache: 'none' }).then((registered) => {
      if (cleanup.signal.aborted || registered.scope !== scope) return;
      registration = registered;
      if (registered.waiting && ownsController()) setWaitingWorker(registered.waiting);
      registered.addEventListener('updatefound', onUpdateFound, { signal: cleanup.signal });
      onUpdateFound();
      return registered.update();
    }).catch(() => undefined);

    return () => cleanup.abort();
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) { setManualInstallHelp(true); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome !== 'accepted') setManualInstallHelp(true);
  }, [installPrompt]);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return;
    reloadRequested.current = true;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }, [waitingWorker]);

  return {
    installed,
    manualInstallHelp,
    updateReady: waitingWorker !== null,
    install,
    dismissManualInstallHelp: () => setManualInstallHelp(false),
    applyUpdate,
  };
}
