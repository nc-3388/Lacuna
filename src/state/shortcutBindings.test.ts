import { describe, expect, it, beforeEach } from 'vitest';
import { loadBindings, saveBindings, resetBindings, keyMatches, formatBinding, DEFAULT_BINDINGS } from './shortcutBindings';

const STORAGE_KEY = 'lacuna-shortcut-bindings';

beforeEach(() => {
  localStorage.clear();
});

describe('loadBindings', () => {
  it('returns defaults when nothing is stored', () => {
    const bindings = loadBindings();
    expect(bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('merges stored overrides with defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reveal: 'Enter' }));
    const bindings = loadBindings();
    expect(bindings.reveal).toBe('Enter');
    expect(bindings.yes).toBe(DEFAULT_BINDINGS.yes);
  });

  it('ignores invalid stored JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const bindings = loadBindings();
    expect(bindings).toEqual(DEFAULT_BINDINGS);
  });
});

describe('saveBindings', () => {
  it('persists bindings to localStorage', () => {
    saveBindings({ ...DEFAULT_BINDINGS, again: 'a' });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.again).toBe('a');
  });
});

describe('resetBindings', () => {
  it('resets to defaults and clears storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reveal: 'Enter' }));
    const bindings = resetBindings();
    expect(bindings).toEqual(DEFAULT_BINDINGS);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!)).toEqual(DEFAULT_BINDINGS);
  });
});

describe('keyMatches', () => {
  it('matches Space binding', () => {
    const e = new KeyboardEvent('keydown', { code: 'Space' });
    expect(keyMatches(e, 'Space')).toBe(true);
    expect(keyMatches(e, 'Enter')).toBe(false);
  });

  it('matches letter bindings case-insensitively', () => {
    const e = new KeyboardEvent('keydown', { key: 'Y' });
    expect(keyMatches(e, 'y')).toBe(true);
    expect(keyMatches(e, 'n')).toBe(false);
  });

  it('matches arrow keys', () => {
    const e = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    expect(keyMatches(e, 'ArrowUp')).toBe(true);
    expect(keyMatches(e, 'ArrowDown')).toBe(false);
  });
});

describe('formatBinding', () => {
  it('formats special keys', () => {
    expect(formatBinding(' ')).toBe('Space');
    expect(formatBinding('ArrowUp')).toBe('Up');
    expect(formatBinding('ArrowDown')).toBe('Arrow down');
    expect(formatBinding('ArrowLeft')).toBe('Left');
    expect(formatBinding('ArrowRight')).toBe('Right');
  });

  it('returns the binding as-is for normal keys', () => {
    expect(formatBinding('y')).toBe('y');
    expect(formatBinding('1')).toBe('1');
  });
});
