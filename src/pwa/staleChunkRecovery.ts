const RECOVERY_ATTEMPT_KEY = 'lacuna-stale-chunk-recovery-at';
const RECOVERY_COOLDOWN_MS = 60_000;

export interface StaleChunkRecoveryEnvironment {
  events: EventTarget;
  storage: Storage;
  clearPwaState(): Promise<void>;
  reload(): void;
  now(): number;
  online(): boolean;
  confirmOnline(): Promise<boolean>;
}

let recoveryPending = false;

/**
 * Clear every service worker and cache still serving the route stale bytes,
 * then reload the document so the current deployment's shell is fetched.
 * Proving network access is asynchronous, so callers that keep a UI alive
 * should treat `false` as "keep what is shown until now" instead of retrying:
 * an offline start would clear the shell keeping the application usable, and a
 * claimed cooldown would reload repeatedly inside the failing minute.
 */
export async function recoverFromChunkFailure(
  environment: StaleChunkRecoveryEnvironment = browserEnvironment(),
): Promise<boolean> {
  if (!environment.online() || recoveryPending) return false;
  recoveryPending = true;
  try {
    const confirmed = await environment.confirmOnline();
    if (!confirmed) return false;
    if (!claimRecoveryAttempt(environment.storage, environment.now())) return false;
    await environment.clearPwaState().finally(() => environment.reload());
    return true;
  } catch {
    return false;
  } finally {
    recoveryPending = false;
  }
}

/**
 * Vite reports a missing deployment chunk before React sees the rejected import.
 * Recover at most once per cooldown; the claim is shared with lazy-route
 * recovery so both reporting paths run one replacement document, not two.
 */
export function installStaleChunkRecovery(
  environment: StaleChunkRecoveryEnvironment = browserEnvironment(),
): () => void {
  const onPreloadError = () => {
    void recoverFromChunkFailure(environment);
  };

  environment.events.addEventListener('vite:preloadError', onPreloadError);
  return () => environment.events.removeEventListener('vite:preloadError', onPreloadError);
}

function claimRecoveryAttempt(storage: Storage, now: number): boolean {
  try {
    const previous = Number(storage.getItem(RECOVERY_ATTEMPT_KEY));
    if (Number.isFinite(previous) && previous > 0 && now - previous < RECOVERY_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(RECOVERY_ATTEMPT_KEY, String(now));
    return true;
  } catch {
    // Without a durable guard, reloading could trap the page in a loop.
    return false;
  }
}

function browserEnvironment(): StaleChunkRecoveryEnvironment {
  return {
    events: window,
    storage: sessionStorage,
    clearPwaState,
    reload: () => window.location.reload(),
    now: Date.now,
    online: () => navigator.onLine,
    confirmOnline: async () => {
      try {
        const probe = new URL('/sw.js', window.location.origin);
        probe.searchParams.set('online-probe', String(Date.now()));
        return (await fetch(probe, { cache: 'no-store' })).ok;
      } catch {
        return false;
      }
    },
  };
}

async function clearPwaState(): Promise<void> {
  const registrations =
    'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
  const cacheNames = 'caches' in window ? await caches.keys() : [];
  await Promise.all([
    ...registrations.map((registration) => registration.unregister()),
    ...cacheNames.map((cacheName) => caches.delete(cacheName)),
  ]);
}
