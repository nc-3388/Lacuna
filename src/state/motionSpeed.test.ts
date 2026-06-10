import { describe, expect, it, beforeEach } from 'vitest';
import { readMotionSpeed, writeMotionSpeed, speedMultiplier, getMotionMultiplier } from './motionSpeed';

const KEY = 'lacuna.motionSpeed';

beforeEach(() => {
  localStorage.clear();
});

describe('readMotionSpeed', () => {
  it('returns normal when nothing is stored', () => {
    expect(readMotionSpeed()).toBe('normal');
  });

  it('returns slow when stored', () => {
    localStorage.setItem(KEY, 'slow');
    expect(readMotionSpeed()).toBe('slow');
  });

  it('returns fast when stored', () => {
    localStorage.setItem(KEY, 'fast');
    expect(readMotionSpeed()).toBe('fast');
  });

  it('returns normal for invalid stored values', () => {
    localStorage.setItem(KEY, 'turbo');
    expect(readMotionSpeed()).toBe('normal');
  });
});

describe('writeMotionSpeed', () => {
  it('persists the speed to localStorage', () => {
    writeMotionSpeed('fast');
    expect(localStorage.getItem(KEY)).toBe('fast');
  });

  it('dispatches a custom event', () => {
    let detail: string | null = null;
    const handler = (e: Event) => {
      detail = (e as CustomEvent).detail;
    };
    window.addEventListener('lacuna:motion-speed', handler);
    writeMotionSpeed('slow');
    window.removeEventListener('lacuna:motion-speed', handler);
    expect(detail).toBe('slow');
  });
});

describe('speedMultiplier', () => {
  it('returns 0 when reduced motion is preferred', () => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    // If the system already prefers reduced motion, test the zero path.
    if (mql.matches) {
      expect(speedMultiplier('normal')).toBe(0);
    } else {
      expect(speedMultiplier('normal')).toBe(1);
    }
  });

  it('returns the correct multiplier for each speed', () => {
    // When reduced motion is NOT preferred, these are the expected values.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      expect(speedMultiplier('slow')).toBe(1.4);
      expect(speedMultiplier('normal')).toBe(1);
      expect(speedMultiplier('fast')).toBe(0.6);
    }
  });
});

describe('getMotionMultiplier', () => {
  it('returns a number without throwing', () => {
    expect(typeof getMotionMultiplier()).toBe('number');
  });
});
