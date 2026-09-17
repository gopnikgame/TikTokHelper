import { useCallback, useEffect, useRef, useState } from 'react';

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
    let registration: ServiceWorkerRegistration | undefined;
    let cancelled = false;

    const inspectInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const onStateChange = () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller && !cancelled) {
          setWaitingWorker(registration?.waiting ?? worker);
        }
      };
      worker.addEventListener('statechange', onStateChange);
    };
    const onControllerChange = () => {
      if (reloadRequested.current) window.location.reload();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void registration?.update();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((registered) => {
      if (cancelled) return;
      registration = registered;
      if (registered.waiting && navigator.serviceWorker.controller) setWaitingWorker(registered.waiting);
      registered.addEventListener('updatefound', () => inspectInstalling(registered.installing));
      void registered.update();
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
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
