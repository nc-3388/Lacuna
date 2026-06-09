import { describe, it, expect } from 'vitest';
import {
  gradeFromResponse,
  emptyPerformance,
  updatePerformance,
  CALIBRATION_THRESHOLD,
} from './grading';

describe('gradeFromResponse', () => {
  it('always returns 1 (Again) for an incorrect answer', () => {
    expect(gradeFromResponse(false, 1, undefined)).toBe(1);
    expect(gradeFromResponse(false, 10, emptyPerformance('d1'))).toBe(1);
  });

  it('uses fixed thresholds during the first two correct reviews (calibration)', () => {
    const perf = emptyPerformance('d1');
    // With zero correct reviews: fast < 3s -> Easy, slow > 8s -> Hard, else Good
    expect(gradeFromResponse(true, 1, perf)).toBe(4);
    expect(gradeFromResponse(true, 5, perf)).toBe(3);
    expect(gradeFromResponse(true, 10, perf)).toBe(2);
  });

  it('uses fixed thresholds with one correct review (still <= 1)', () => {
    const perf = updatePerformance(emptyPerformance('d1'), 5);
    expect(gradeFromResponse(true, 1, perf)).toBe(4);
    expect(gradeFromResponse(true, 5, perf)).toBe(3);
    expect(gradeFromResponse(true, 10, perf)).toBe(2);
  });

  it('uses adaptive warm-up bands for 2–19 correct reviews', () => {
    // Build a performance profile with 10 correct reviews, mean ~5s.
    let perf = emptyPerformance('d1');
    for (let i = 0; i < 10; i++) {
      perf = updatePerformance(perf, 5);
    }
    expect(perf.totalCorrectReviews).toBe(10);
    // Very fast response should be Easy.
    expect(gradeFromResponse(true, 0.5, perf)).toBe(4);
    // Very slow response should be Hard.
    expect(gradeFromResponse(true, 20, perf)).toBe(2);
    // Near-mean response should be Good.
    expect(gradeFromResponse(true, 5, perf)).toBe(3);
  });

  it('uses adaptive mu +/- 0.75*sigma after 20+ correct reviews', () => {
    let perf = emptyPerformance('d1');
    for (let i = 0; i < CALIBRATION_THRESHOLD; i++) {
      perf = updatePerformance(perf, 5);
    }
    expect(perf.totalCorrectReviews).toBe(CALIBRATION_THRESHOLD);
    // Fast (more than 0.75 sigma below mean)
    expect(gradeFromResponse(true, 0.5, perf)).toBe(4);
    // Slow (more than 0.75 sigma above mean)
    expect(gradeFromResponse(true, 20, perf)).toBe(2);
    // Near mean
    expect(gradeFromResponse(true, 5, perf)).toBe(3);
  });
});

describe('emptyPerformance', () => {
  it('returns a zeroed profile with the given deck id', () => {
    const perf = emptyPerformance('deck-a');
    expect(perf.deckId).toBe('deck-a');
    expect(perf.totalCorrectReviews).toBe(0);
    expect(perf.runningMeanResponseTime).toBe(0);
    expect(perf.runningStdDevResponseTime).toBe(0);
    expect(perf.m2).toBe(0);
  });
});

describe('updatePerformance', () => {
  it('computes Welford running mean and variance correctly', () => {
    let perf = emptyPerformance('d1');
    perf = updatePerformance(perf, 2);
    expect(perf.totalCorrectReviews).toBe(1);
    expect(perf.runningMeanResponseTime).toBe(2);
    expect(perf.runningStdDevResponseTime).toBe(0);

    perf = updatePerformance(perf, 4);
    expect(perf.totalCorrectReviews).toBe(2);
    expect(perf.runningMeanResponseTime).toBe(3);
    expect(perf.runningStdDevResponseTime).toBe(1);

    perf = updatePerformance(perf, 6);
    expect(perf.totalCorrectReviews).toBe(3);
    expect(perf.runningMeanResponseTime).toBe(4);
    expect(perf.runningStdDevResponseTime).toBeCloseTo(1.632993161855452, 10);
  });

  it('produces a stable mean for a large symmetric set', () => {
    let perf = emptyPerformance('d1');
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const v of values) {
      perf = updatePerformance(perf, v);
    }
    expect(perf.runningMeanResponseTime).toBe(5.5);
    expect(perf.totalCorrectReviews).toBe(10);
    expect(perf.runningStdDevResponseTime).toBeCloseTo(2.872, 2);
  });

  it('handles identical values without NaN', () => {
    let perf = emptyPerformance('d1');
    for (let i = 0; i < 5; i++) {
      perf = updatePerformance(perf, 3);
    }
    expect(perf.runningMeanResponseTime).toBe(3);
    expect(perf.runningStdDevResponseTime).toBe(0);
    expect(perf.totalCorrectReviews).toBe(5);
  });
});
