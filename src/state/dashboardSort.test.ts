import { describe, expect, it, beforeEach } from 'vitest';
import { readDashboardSort, writeDashboardSort, useDashboardSort } from './dashboardSort';
import { renderHook, act } from '@testing-library/react';

const KEY = 'lacuna.dashboardSort';

beforeEach(() => {
  localStorage.clear();
});

describe('readDashboardSort', () => {
  it('returns recent when nothing is stored', () => {
    expect(readDashboardSort()).toBe('recent');
  });

  it('returns the stored sort when valid', () => {
    localStorage.setItem(KEY, 'mastery');
    expect(readDashboardSort()).toBe('mastery');
  });

  it('returns recent for invalid stored values', () => {
    localStorage.setItem(KEY, 'invalid');
    expect(readDashboardSort()).toBe('recent');
  });
});

describe('writeDashboardSort', () => {
  it('persists the sort to localStorage', () => {
    writeDashboardSort('exam');
    expect(localStorage.getItem(KEY)).toBe('exam');
  });

  it('dispatches a custom event', () => {
    let detail: string | null = null;
    const handler = (e: Event) => {
      detail = (e as CustomEvent).detail;
    };
    window.addEventListener('lacuna:dashboard-sort', handler);
    writeDashboardSort('name');
    window.removeEventListener('lacuna:dashboard-sort', handler);
    expect(detail).toBe('name');
  });
});

describe('useDashboardSort', () => {
  it('returns the current sort and a setter', () => {
    const { result } = renderHook(() => useDashboardSort());
    expect(result.current[0]).toBe('recent');
    act(() => {
      result.current[1]('mastery');
    });
    expect(result.current[0]).toBe('mastery');
    expect(localStorage.getItem(KEY)).toBe('mastery');
  });
});
