import { describe, expect, it, vi } from 'vitest';
import { installStaleChunkRecovery, recoverFromChunkFailure } from './staleChunkRecovery';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('stale chunk recovery', () => {
  it('leaves cached application state intact when a dynamic import fails offline', async () => {
    const events = new EventTarget();
    const clearPwaState = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const confirmOnline = vi.fn().mockResolvedValue(false);
    const environment = {
      events,
      storage: memoryStorage(),
      clearPwaState,
      reload,
      now: () => 1_000,
      online: () => false,
      confirmOnline,
    };
    installStaleChunkRecovery(environment);

    const event = new Event('vite:preloadError', { cancelable: true });
    events.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(false);
    expect(confirmOnline).not.toHaveBeenCalled();
    expect(clearPwaState).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not clear cached state when the browser online signal is a false positive', async () => {
    const events = new EventTarget();
    const clearPwaState = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const confirmOnline = vi.fn().mockResolvedValue(false);
    installStaleChunkRecovery({
      events,
      storage: memoryStorage(),
      clearPwaState,
      reload,
      now: () => 1_000,
      online: () => true,
      confirmOnline,
    });

    const event = new Event('vite:preloadError', { cancelable: true });
    events.dispatchEvent(event);
    await vi.waitFor(() => expect(confirmOnline).toHaveBeenCalledOnce());

    expect(event.defaultPrevented).toBe(false);
    expect(clearPwaState).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears stale PWA state and reloads once for a failed Vite dynamic import', async () => {
    const events = new EventTarget();
    const clearPwaState = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const confirmOnline = vi.fn().mockResolvedValue(true);
    const remove = installStaleChunkRecovery({
      events,
      storage: memoryStorage(),
      clearPwaState,
      reload,
      now: () => 1_000,
      online: () => true,
      confirmOnline,
    });

    const first = new Event('vite:preloadError', { cancelable: true });
    events.dispatchEvent(first);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

    expect(first.defaultPrevented).toBe(false);
    expect(clearPwaState).toHaveBeenCalledOnce();

    const second = new Event('vite:preloadError', { cancelable: true });
    events.dispatchEvent(second);
    await vi.waitFor(() => expect(confirmOnline).toHaveBeenCalledTimes(2));

    expect(second.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    remove();
  });

  it('does not risk a reload loop when session storage is unavailable', async () => {
    const events = new EventTarget();
    const reload = vi.fn();
    installStaleChunkRecovery({
      events,
      storage: {
        ...memoryStorage(),
        getItem: () => {
          throw new Error('blocked');
        },
      },
      clearPwaState: vi.fn().mockResolvedValue(undefined),
      reload,
      now: () => 1_000,
      online: () => true,
      confirmOnline: vi.fn().mockResolvedValue(true),
    });

    const event = new Event('vite:preloadError', { cancelable: true });
    events.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('awaited stale chunk recovery', () => {
  it('clears cached state and reloads once for callers that await recovery', async () => {
    const clearPwaState = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const confirmOnline = vi.fn().mockResolvedValue(true);
    const environment = {
      events: new EventTarget(),
      storage: memoryStorage(),
      clearPwaState,
      reload,
      now: () => 1_000,
      online: () => true,
      confirmOnline,
    };

    await expect(recoverFromChunkFailure(environment)).resolves.toBe(true);
    expect(confirmOnline).toHaveBeenCalledOnce();
    expect(clearPwaState).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();

    // The claim inside the same storage throttles a repeat into a denial with
    // no second clear.
    await expect(recoverFromChunkFailure(environment)).resolves.toBe(false);
    expect(confirmOnline).toHaveBeenCalledTimes(2);
    expect(clearPwaState).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('collapses a second caller while one recovery is already running', async () => {
    let resolveProbe!: (confirmed: boolean) => void;
    const clearPwaState = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const environment = {
      events: new EventTarget(),
      storage: memoryStorage(),
      clearPwaState,
      reload,
      now: () => 1_000,
      online: () => true,
      confirmOnline: () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve;
        }),
    };

    const first = recoverFromChunkFailure(environment);
    await expect(recoverFromChunkFailure(environment)).resolves.toBe(false);
    resolveProbe(true);
    await expect(first).resolves.toBe(true);
    expect(environment.clearPwaState).toHaveBeenCalledOnce();
    expect(environment.reload).toHaveBeenCalledOnce();
  });
});
