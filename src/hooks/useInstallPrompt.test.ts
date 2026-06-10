import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInstallPrompt } from './useInstallPrompt';

function createMediaQueryList(matches: boolean) {
  return {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

describe('useInstallPrompt', () => {
  it('returns initial state', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(() => createMediaQueryList(false));
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstallable).toBe(false);
    expect(result.current.isInstalled).toBe(false);
    expect(typeof result.current.promptInstall).toBe('function');
    window.matchMedia = originalMatchMedia;
  });

  it('detects installed state when display-mode is standalone', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(() => createMediaQueryList(true));
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstalled).toBe(true);
    window.matchMedia = originalMatchMedia;
  });
});
