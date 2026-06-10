import { describe, expect, it, beforeEach } from 'vitest';
import { readInputMode, resolveInputMode, writeInputMode } from './inputMode';

const KEY = 'lacuna.inputMode';

beforeEach(() => {
  localStorage.clear();
  // Reset window event listeners if needed
});

describe('readInputMode', () => {
  it('returns auto when nothing is stored', () => {
    expect(readInputMode()).toBe('auto');
  });

  it('returns keyboard when stored', () => {
    localStorage.setItem(KEY, 'keyboard');
    expect(readInputMode()).toBe('keyboard');
  });

  it('returns touch when stored', () => {
    localStorage.setItem(KEY, 'touch');
    expect(readInputMode()).toBe('touch');
  });

  it('returns auto for invalid stored values', () => {
    localStorage.setItem(KEY, 'mouse');
    expect(readInputMode()).toBe('auto');
  });
});

describe('resolveInputMode', () => {
  it('returns keyboard when mode is keyboard', () => {
    expect(resolveInputMode('keyboard')).toBe('keyboard');
  });

  it('returns touch when mode is touch', () => {
    expect(resolveInputMode('touch')).toBe('touch');
  });

  it('auto resolves based on device capabilities', () => {
    const result = resolveInputMode('auto');
    expect(result === 'keyboard' || result === 'touch').toBe(true);
  });
});

describe('writeInputMode', () => {
  it('persists the mode to localStorage', () => {
    writeInputMode('touch');
    expect(localStorage.getItem(KEY)).toBe('touch');
  });

  it('dispatches a custom event', () => {
    let eventFired = false;
    const handler = () => { eventFired = true; };
    window.addEventListener('lacuna:input-mode', handler);
    writeInputMode('keyboard');
    window.removeEventListener('lacuna:input-mode', handler);
    expect(eventFired).toBe(true);
  });
});

describe('resolveInputMode auto', () => {
  it('returns a valid device type for auto mode', () => {
    const result = resolveInputMode('auto');
    expect(result === 'keyboard' || result === 'touch').toBe(true);
  });
});
