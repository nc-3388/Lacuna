// The invisible rating engine. The user sees only "Yes (Correct)" and "No (Incorrect)";
// an FSRS grade is inferred from correctness and the response time, calibrated per deck.

import type { Grade, UserPerformance } from '../db/types';

/** Number of correct reviews required before switching from fixed to adaptive thresholds. */
export const CALIBRATION_THRESHOLD = 20;

/** Fixed thresholds (seconds) used during the calibration period. */
const FAST_SECONDS = 3.0;
const SLOW_SECONDS = 8.0;

/** Number of standard deviations either side of the mean for adaptive grading. */
const SIGMA_FACTOR = 0.75;

/**
 * Map a "Yes/No" answer and response time to an FSRS grade.
 *  - "No" always maps to g = 1 (Again).
 *  - "Yes" maps to Easy/Good/Hard by speed, using fixed thresholds during calibration
 *    (totalCorrectReviews < 20) and mu +/- 0.75*sigma thereafter.
 */
export function gradeFromResponse(
  correct: boolean,
  responseTimeSec: number,
  perf: UserPerformance | undefined,
): Grade {
  if (!correct) return 1;

  const totalCorrect = perf?.totalCorrectReviews ?? 0;

  if (totalCorrect < CALIBRATION_THRESHOLD) {
    if (totalCorrect <= 1) {
      // No meaningful data yet (zero or one correct review): fall back to absolute
      // thresholds. With a single observation the running mean equals that first
      // response time and the variance is zero, which would make all subsequent
      // responses fall into the "slow" band. Fixed thresholds are more reliable here.
      if (responseTimeSec < FAST_SECONDS) return 4;
      if (responseTimeSec > SLOW_SECONDS) return 2;
      return 3;
    }
    // Warm-up: use the running mean and a minimum sigma so the bands are usable
    // even with very few observations.
    const mu = perf!.runningMeanResponseTime;
    const sigma = Math.max(perf!.runningStdDevResponseTime, mu * 0.2, 0.5);
    if (responseTimeSec < mu - SIGMA_FACTOR * sigma) return 4;
    if (responseTimeSec > mu + SIGMA_FACTOR * sigma) return 2;
    return 3;
  }

  const mu = perf!.runningMeanResponseTime;
  const sigma = perf!.runningStdDevResponseTime;
  if (responseTimeSec < mu - SIGMA_FACTOR * sigma) return 4;
  if (responseTimeSec > mu + SIGMA_FACTOR * sigma) return 2;
  return 3;
}

/** An empty performance profile for a deck that has had no correct reviews yet. */
export function emptyPerformance(deckId: string): UserPerformance {
  return {
    deckId,
    runningMeanResponseTime: 0,
    runningStdDevResponseTime: 0,
    m2: 0,
    totalCorrectReviews: 0,
  };
}

/**
 * Update a deck's running mean and standard deviation of correct response times,
 * using Welford's online algorithm. Only correct reviews are folded in.
 * This is a biased sample on high-failure decks because slow failures are excluded;
 * the prediction-accuracy analytics use review outcomes to make that bias visible.
 */
export function updatePerformance(
  perf: UserPerformance,
  responseTimeSec: number,
): UserPerformance {
  const n = perf.totalCorrectReviews + 1;
  const delta = responseTimeSec - perf.runningMeanResponseTime;
  const mean = perf.runningMeanResponseTime + delta / n;
  const delta2 = responseTimeSec - mean;
  const m2 = perf.m2 + delta * delta2;
  const variance = m2 / n;
  return {
    deckId: perf.deckId,
    runningMeanResponseTime: mean,
    runningStdDevResponseTime: Math.sqrt(variance),
    m2,
    totalCorrectReviews: n,
  };
}
