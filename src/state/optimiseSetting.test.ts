import { describe, expect, it, beforeEach } from 'vitest';
import { readAutoOptimiseDefault, writeAutoOptimiseDefault, useAutoOptimiseDefault, optimiseEnabledForDeck } from './optimiseSetting';
import { renderHook, act } from '@testing-library/react';

const KEY = 'lacuna.autoOptimise';

beforeEach(() => {
  localStorage.clear();
});

describe('readAutoOptimiseDefault', () => {
  it('returns true when nothing is stored', () => {
    expect(readAutoOptimiseDefault()).toBe(true);
  });

  it('returns false when off is stored', () => {
    localStorage.setItem(KEY, 'off');
    expect(readAutoOptimiseDefault()).toBe(false);
  });

  it('returns true for any non-off value', () => {
    localStorage.setItem(KEY, 'on');
    expect(readAutoOptimiseDefault()).toBe(true);
  });
});

describe('writeAutoOptimiseDefault', () => {
  it('persists the value to localStorage', () => {
    writeAutoOptimiseDefault(false);
    expect(localStorage.getItem(KEY)).toBe('off');
  });
});

describe('useAutoOptimiseDefault', () => {
  it('returns the current value and a setter', () => {
    const { result } = renderHook(() => useAutoOptimiseDefault());
    expect(result.current[0]).toBe(true);
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('off');
  });
});

describe('optimiseEnabledForDeck', () => {
  it('uses deck override when provided', () => {
    expect(optimiseEnabledForDeck(false, true)).toBe(false);
    expect(optimiseEnabledForDeck(true, false)).toBe(true);
  });

  it('falls back to global default when deck override is undefined', () => {
    expect(optimiseEnabledForDeck(undefined, true)).toBe(true);
    expect(optimiseEnabledForDeck(undefined, false)).toBe(false);
  });
});
