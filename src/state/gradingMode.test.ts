import { describe, expect, it, beforeEach } from 'vitest';
import { readGradingMode, writeGradingMode, useGradingMode } from './gradingMode';
import { renderHook, act } from '@testing-library/react';

const KEY = 'lacuna.gradingMode';

beforeEach(() => {
  localStorage.clear();
});

describe('readGradingMode', () => {
  it('returns silent when nothing is stored', () => {
    expect(readGradingMode()).toBe('silent');
  });

  it('returns manual when stored', () => {
    localStorage.setItem(KEY, 'manual');
    expect(readGradingMode()).toBe('manual');
  });

  it('returns silent for any non-manual value', () => {
    localStorage.setItem(KEY, 'something');
    expect(readGradingMode()).toBe('silent');
  });
});

describe('writeGradingMode', () => {
  it('persists the mode to localStorage', () => {
    writeGradingMode('manual');
    expect(localStorage.getItem(KEY)).toBe('manual');
  });

  it('dispatches a custom event', () => {
    let detail: string | null = null;
    const handler = (e: Event) => {
      detail = (e as CustomEvent).detail;
    };
    window.addEventListener('lacuna:grading-mode', handler);
    writeGradingMode('manual');
    window.removeEventListener('lacuna:grading-mode', handler);
    expect(detail).toBe('manual');
  });
});

describe('useGradingMode', () => {
  it('returns the current mode and a setter', () => {
    const { result } = renderHook(() => useGradingMode());
    expect(result.current[0]).toBe('silent');
    act(() => {
      result.current[1]('manual');
    });
    expect(result.current[0]).toBe('manual');
    expect(localStorage.getItem(KEY)).toBe('manual');
  });
});
