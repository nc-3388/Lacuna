import { describe, it, expect } from 'vitest';
import { checkParameters, default_w } from 'ts-fsrs';
import {
  countReviews,
  evaluateParameters,
  optimiseParameters,
  reviewSequences,
  MIN_OPTIMISE_REVIEWS,
} from './optimise';
import { MS_PER_DAY } from './params';
import type { Card, Grade, ReviewLog } from '../db/types';

/** A card carrying a synthetic grade/timestamp sequence (other fields are filler). */
function cardWith(grades: Grade[], startMs: number, gapDays = 2): Card {
  const history: ReviewLog[] = grades.map((grade, i) => ({
    timestamp: startMs + i * gapDays * MS_PER_DAY,
    grade,
    responseTimeSec: 2,
    distracted: false,
    stabilityBefore: null,
    stabilityAfter: 1,
    difficultyBefore: null,
    difficultyAfter: 5,
    retrievabilityAtReview: null,
  }));
  return {
    id: Math.random().toString(36).slice(2),
    deckId: 'd',
    type: 'front_back',
    front: '',
    back: '',
    stability: 1,
    difficulty: 5,
    lastReviewed: history[history.length - 1]?.timestamp ?? null,
    reps: grades.length,
    lapses: grades.filter((g) => g === 1).length,
    state: 2,
    due: null,
    scheduledDays: 0,
    learningSteps: 0,
    history,
    createdAt: startMs,
  };
}

// A spread of realistic sequences: mostly recalled, the odd lapse.
function syntheticDeck(): Card[] {
  const start = Date.UTC(2026, 0, 1);
  const patterns: Grade[][] = [
    [3, 3, 3, 4, 3],
    [3, 1, 3, 3, 2],
    [2, 3, 3, 1, 3, 3],
    [4, 4, 3, 3],
    [3, 1, 1, 3, 3, 4],
    [3, 3, 2, 3],
  ];
  return patterns.map((p, i) => cardWith(p, start + i * MS_PER_DAY));
}

describe('review extraction and gating', () => {
  it('counts every review and extracts non-empty sequences', () => {
    const cards = syntheticDeck();
    const totalGrades = 5 + 5 + 6 + 4 + 6 + 4;
    expect(countReviews(cards)).toBe(totalGrades);
    expect(reviewSequences(cards)).toHaveLength(cards.length);
  });

  it('exposes a sensible minimum-review threshold', () => {
    expect(MIN_OPTIMISE_REVIEWS).toBeGreaterThanOrEqual(100);
    // A tiny deck is below the bar (the UI gates the action on this).
    expect(countReviews(syntheticDeck())).toBeLessThan(MIN_OPTIMISE_REVIEWS);
  });
});

describe('evaluateParameters', () => {
  it('returns a finite mean log loss over scored (non-first) reviews', () => {
    const seqs = reviewSequences(syntheticDeck());
    const { logLoss, scored } = evaluateParameters(seqs, [...default_w]);
    expect(Number.isFinite(logLoss)).toBe(true);
    expect(logLoss).toBeGreaterThan(0);
    // First review of each card is unscored (no prior prediction).
    const expectedScored = countReviews(syntheticDeck()) - syntheticDeck().length;
    expect(scored).toBe(expectedScored);
  });
});

describe('optimiseParameters', () => {
  it('produces a valid 21-weight array within FSRS bounds and never worsens the loss', () => {
    const cards = syntheticDeck();
    const result = optimiseParameters(cards, { passes: 3 });

    expect(result.w).toHaveLength(21);
    // checkParameters throws if any weight is out of range.
    expect(() => checkParameters(result.w)).not.toThrow();
    // Hill-climb only accepts improvements, so the fit never gets worse.
    expect(result.after).toBeLessThanOrEqual(result.before + 1e-9);
    expect(result.scored).toBeGreaterThan(0);
  });

  it('reports progress from 0 to 1', () => {
    const seen: number[] = [];
    optimiseParameters(syntheticDeck(), { passes: 2, onProgress: (f) => seen.push(f) });
    expect(seen[seen.length - 1]).toBeCloseTo(1, 6);
    expect(seen.every((f) => f > 0 && f <= 1)).toBe(true);
  });
});
