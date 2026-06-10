import { describe, expect, it, beforeEach } from 'vitest';
import { readStored, writeSidebarSettings, useSidebarSettings, DEFAULT_NAV_ITEMS, DEFAULTS } from './sidebarSettings';
import { renderHook, act } from '@testing-library/react';

const KEY = 'lacuna.sidebarSettings';

beforeEach(() => {
  localStorage.clear();
});

describe('readStored', () => {
  it('returns defaults when nothing is stored', () => {
    const settings = readStored();
    expect(settings.showDueCounts).toBe(DEFAULTS.showDueCounts);
    expect(settings.showArchived).toBe(DEFAULTS.showArchived);
    expect(settings.compactMode).toBe(DEFAULTS.compactMode);
    expect(settings.navItems).toEqual(DEFAULT_NAV_ITEMS);
  });

  it('returns merged nav items when stored items are missing new defaults', () => {
    const stored = { showDueCounts: false, navItems: [{ id: 'dashboard', label: 'Dashboard', visible: true }] };
    localStorage.setItem(KEY, JSON.stringify(stored));
    const settings = readStored();
    expect(settings.showDueCounts).toBe(false);
    expect(settings.navItems.length).toBeGreaterThanOrEqual(DEFAULT_NAV_ITEMS.length);
  });

  it('falls back to defaults on invalid JSON', () => {
    localStorage.setItem(KEY, 'not-json');
    const settings = readStored();
    expect(settings.showDueCounts).toBe(DEFAULTS.showDueCounts);
  });
});

describe('useSidebarSettings', () => {
  it('returns the current settings and a setter', () => {
    const { result } = renderHook(() => useSidebarSettings());
    expect(result.current[0].showDueCounts).toBe(true);
    act(() => {
      result.current[1]({ compactMode: true });
    });
    expect(result.current[0].compactMode).toBe(true);
  });
});

describe('writeSidebarSettings', () => {
  it('persists partial settings to localStorage', () => {
    writeSidebarSettings({ compactMode: true });
    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.compactMode).toBe(true);
  });
});


