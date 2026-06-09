import { describe, it, expect } from 'vitest';
import {
  FSRS_VERSION,
  DEFAULT_REQUEST_RETENTION,
  MIN_REQUEST_RETENTION,
  MAX_REQUEST_RETENTION,
  clampRequestRetention,
  defaultFsrsParameters,
  MASTERY_R,
  MS_PER_DAY,
  D_MIN,
  D_MAX,
} from './params';
import { default_w, default_request_retention } from 'ts-fsrs';

describe('constants', () => {
  it('FSRS_VERSION is 6', () => {
    expect(FSRS_VERSION).toBe(6);
  });

  it('MASTERY_R is 0.9', () => {
    expect(MASTERY_R).toBe(0.9);
  });

  it('MS_PER_DAY is 86,400,000', () => {
    expect(MS_PER_DAY).toBe(86_400_000);
  });

  it('D_MIN and D_MAX are 1 and 10', () => {
    expect(D_MIN).toBe(1.0);
    expect(D_MAX).toBe(10.0);
  });

  it('default constants match ts-fsrs exports', () => {
    expect(DEFAULT_REQUEST_RETENTION).toBe(default_request_retention);
    expect(DEFAULT_REQUEST_RETENTION).toBeGreaterThanOrEqual(MIN_REQUEST_RETENTION);
    expect(DEFAULT_REQUEST_RETENTION).toBeLessThanOrEqual(MAX_REQUEST_RETENTION);
  });
});

describe('clampRequestRetention', () => {
  it('returns the value when within bounds', () => {
    expect(clampRequestRetention(0.9)).toBe(0.9);
    expect(clampRequestRetention(0.85)).toBe(0.85);
    expect(clampRequestRetention(0.95)).toBe(0.95);
  });

  it('clamps below the minimum up to the minimum', () => {
    expect(clampRequestRetention(0.5)).toBe(MIN_REQUEST_RETENTION);
    expect(clampRequestRetention(0.79)).toBe(MIN_REQUEST_RETENTION);
  });

  it('clamps above the maximum down to the maximum', () => {
    expect(clampRequestRetention(1.0)).toBe(MAX_REQUEST_RETENTION);
    expect(clampRequestRetention(0.98)).toBe(MAX_REQUEST_RETENTION);
  });

  it('falls back to the default for non-finite values', () => {
    expect(clampRequestRetention(NaN)).toBe(DEFAULT_REQUEST_RETENTION);
    expect(clampRequestRetention(Infinity)).toBe(MAX_REQUEST_RETENTION);
    expect(clampRequestRetention(-Infinity)).toBe(MIN_REQUEST_RETENTION);
  });
});

describe('defaultFsrsParameters', () => {
  it('returns a fresh copy with 21 weights and default request retention', () => {
    const p1 = defaultFsrsParameters();
    const p2 = defaultFsrsParameters();
    expect(p1.w).toHaveLength(21);
    expect(p2.w).toHaveLength(21);
    expect(p1.w).toEqual([...default_w]);
    expect(p1.requestRetention).toBe(default_request_retention);
    // Fresh copy so mutations do not leak.
    p1.w[0] = 999;
    expect(p2.w[0]).toBe(default_w[0]);
  });
});
