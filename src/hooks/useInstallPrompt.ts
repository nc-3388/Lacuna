import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Captures the `beforeinstallprompt` event so the app can show its own
 * "Install" UI instead of relying on the browser's default mini-infobar.
 * Returns whether the app is installable and a function to trigger the prompt.
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Detect if the app is already installed (standalone or display-mode: standalone).
    const mq = window.matchMedia('(display-mode: standalone)');
    setIsInstalled(mq.matches);

    const onChange = (e: MediaQueryListEvent) => setIsInstalled(e.matches);
    mq.addEventListener('change', onChange);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstallable(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null);
      setIsInstallable(false);
      setIsInstalled(true);
    }
  }, [deferredPrompt]);

  return { isInstallable, isInstalled, promptInstall };
}
