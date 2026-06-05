import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestPersistentStorage,
  checkPersistentStorage,
} from './persistence';

describe('persistent storage', () => {
  let storageMock: {
    persist: ReturnType<typeof vi.fn>;
    persisted: ReturnType<typeof vi.fn>;
    estimate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    storageMock = {
      persist: vi.fn(),
      persisted: vi.fn(),
      estimate: vi.fn(),
    };
    Object.defineProperty(navigator, 'storage', {
      value: storageMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns unsupported when the Storage API is absent', async () => {
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true, writable: true });
    const state = await checkPersistentStorage();
    expect(state.supported).toBe(false);
    expect(state.persisted).toBe(false);
  });

  it('reads persisted true and estimate values when already granted', async () => {
    storageMock.persisted.mockResolvedValue(true);
    storageMock.estimate.mockResolvedValue({ usage: 1024 * 1024, quota: 1024 * 1024 * 100 });

    const state = await checkPersistentStorage();
    expect(state.supported).toBe(true);
    expect(state.persisted).toBe(true);
    expect(state.granted).toBe(true);
    expect(state.usage).toBe(1024 * 1024);
    expect(state.quota).toBe(1024 * 1024 * 100);
  });

  it('requests persistence and returns granted when the browser accepts', async () => {
    storageMock.persisted.mockResolvedValue(false);
    storageMock.persist.mockResolvedValue(true);
    storageMock.estimate.mockResolvedValue({ usage: 0, quota: 0 });

    const state = await requestPersistentStorage();
    expect(state.supported).toBe(true);
    expect(state.persisted).toBe(true);
    expect(state.granted).toBe(true);
  });

  it('returns denied when the browser refuses persistence', async () => {
    storageMock.persisted.mockResolvedValue(false);
    storageMock.persist.mockResolvedValue(false);
    storageMock.estimate.mockResolvedValue({});

    const state = await requestPersistentStorage();
    expect(state.supported).toBe(true);
    expect(state.persisted).toBe(false);
    expect(state.granted).toBe(false);
  });

  it('survives a thrown estimate() gracefully', async () => {
    storageMock.persisted.mockResolvedValue(true);
    storageMock.estimate.mockRejectedValue(new Error('quota error'));

    const state = await checkPersistentStorage();
    expect(state.supported).toBe(true);
    expect(state.persisted).toBe(true);
    expect(state.usage).toBeUndefined();
    expect(state.quota).toBeUndefined();
  });
});
