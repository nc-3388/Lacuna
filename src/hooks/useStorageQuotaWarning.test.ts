import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStorageQuotaWarning } from './useStorageQuotaWarning';

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({
    notify: vi.fn(),
  }),
}));

describe('useStorageQuotaWarning', () => {
  it('does not throw when navigator.storage is unavailable', () => {
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      value: undefined,
      configurable: true,
    });
    expect(() => renderHook(() => useStorageQuotaWarning())).not.toThrow();
    Object.defineProperty(navigator, 'storage', {
      value: originalStorage,
      configurable: true,
    });
  });

  it('does not throw when estimate is unavailable', () => {
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: undefined },
      configurable: true,
    });
    expect(() => renderHook(() => useStorageQuotaWarning())).not.toThrow();
    Object.defineProperty(navigator, 'storage', {
      value: originalStorage,
      configurable: true,
    });
  });
});
