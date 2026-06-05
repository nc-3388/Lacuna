import { describe, it, expect } from 'vitest';
import {
  computeParameters,
  FSRSBindingItem,
  FSRSBindingReview,
} from '@open-spaced-repetition/binding';
import { checkParameters, default_w } from 'ts-fsrs';
import {
  cardsToBindingReviewData,
  chronologicallySplitSequences,
  countReviews,
  evaluateParameters,
  optimiseParameters,
  reviewSequences,
  sequenceToBindingReviews,
  tryValidateFittedWeights,
  validateFittedWeights,
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

const bindingDeps = {
  computeParameters,
  createItem: (reviews: { rating: number; deltaT: number }[]) =>
    new FSRSBindingItem(
      reviews.map((r) => new FSRSBindingReview(r.rating, r.deltaT)),
    ),
};

describe('history-to-binding conversion', () => {
  it('maps grade sequences to binding reviews with deltaT in days', () => {
    const card = cardWith([3, 4, 2], Date.UTC(2026, 0, 1), 3);
    const reviews = sequenceToBindingReviews(reviewSequences([card])[0]);
    expect(reviews[0]).toEqual({ rating: 3, deltaT: 0 });
    expect(reviews[1]).toEqual({ rating: 4, deltaT: 3 });
    expect(reviews[2]).toEqual({ rating: 2, deltaT: 3 });
  });

  it('produces one review array per card with history', () => {
    const cards = syntheticDeck();
    const data = cardsToBindingReviewData(cards);
    expect(data).toHaveLength(cards.length);
    for (const reviews of data) {
      expect(reviews[0].deltaT).toBe(0);
      expect(reviews.every((r) => r.rating >= 1 && r.rating <= 4)).toBe(true);
    }
  });
});

describe('review extraction and gating', () => {
  it('counts every review and extracts non-empty sequences', () => {
    const cards = syntheticDeck();
    const totalGrades = 5 + 5 + 6 + 4 + 6 + 4;
    expect(countReviews(cards)).toBe(totalGrades);
    expect(reviewSequences(cards)).toHaveLength(cards.length);
  });

  it('exposes a sensible minimum-review threshold', () => {
    expect(MIN_OPTIMISE_REVIEWS).toBeGreaterThanOrEqual(100);
    expect(countReviews(syntheticDeck())).toBeLessThan(MIN_OPTIMISE_REVIEWS);
  });
});

describe('validateFittedWeights', () => {
  it('accepts the default FSRS weight set', () => {
    expect(() => validateFittedWeights([...default_w])).not.toThrow();
    expect(tryValidateFittedWeights([...default_w]).ok).toBe(true);
  });

  it('rejects weights outside FSRS valid ranges', () => {
    const bad = [...default_w];
    bad[0] = 999;
    expect(tryValidateFittedWeights(bad).ok).toBe(false);
    expect(() => validateFittedWeights(bad)).toThrow();
  });

  it('rejects the wrong number of weights', () => {
    expect(tryValidateFittedWeights([1, 2, 3]).ok).toBe(false);
  });
});

describe('chronological train/validation split', () => {
  it('puts roughly the train fraction of reviews into training', () => {
    const cards = syntheticDeck();
    const seqs = reviewSequences(cards);
    const total = countReviews(cards);
    const split = chronologicallySplitSequences(seqs, 0.8);
    const validationSequences = split.validationSequences;
    const cutoffTimestamp = split.cutoffTimestamp;

    const trainCount = split.trainSequences.reduce((s, seq) => s + seq.grades.length, 0);
    const valCount = validationSequences.reduce((s, seq) => s + seq.grades.length, 0);

    expect(trainCount + valCount).toBe(total);
    // Every validation review is strictly after the cutoff.
    for (const seq of validationSequences) {
      for (const t of seq.timestamps) {
        expect(t).toBeGreaterThan(cutoffTimestamp);
      }
    }
    // Every training review is at or before the cutoff.
    for (const seq of split.trainSequences) {
      for (const t of seq.timestamps) {
        expect(t).toBeLessThanOrEqual(cutoffTimestamp);
      }
    }
  });

  it('handles a deck with every review before the cutoff', () => {
    const cards = syntheticDeck();
    const seqs = reviewSequences(cards);
    const split = chronologicallySplitSequences(seqs, 1.0);
    const valCount = split.validationSequences.reduce((s, seq) => s + seq.grades.length, 0);
    expect(valCount).toBe(0);
  });
});

describe('evaluateParameters', () => {
  it('returns a finite mean log loss over scored (non-first) reviews', () => {
    const seqs = reviewSequences(syntheticDeck());
    const { logLoss, scored } = evaluateParameters(seqs, [...default_w]);
    expect(Number.isFinite(logLoss)).toBe(true);
    expect(logLoss).toBeGreaterThan(0);
    const expectedScored = countReviews(syntheticDeck()) - syntheticDeck().length;
    expect(scored).toBe(expectedScored);
  });

  it('only scores reviews after scoreAfterTimestamp when given', () => {
    const cards = syntheticDeck();
    const seqs = reviewSequences(cards);
    const { cutoffTimestamp } = chronologicallySplitSequences(seqs, 0.8);
    const { scored } = evaluateParameters(seqs, [...default_w], undefined, {
      scoreAfterTimestamp: cutoffTimestamp,
    });
    const allScored = countReviews(cards) - cards.length;
    expect(scored).toBeLessThan(allScored);
    expect(scored).toBeGreaterThanOrEqual(0);
  });
});

describe('optimiseParameters', () => {
  it('produces a valid 21-weight array via the official trainer', async () => {
    const cards = syntheticDeck();
    const result = await optimiseParameters(cards, bindingDeps);

    expect(result.w).toHaveLength(21);
    expect(() => checkParameters(result.w)).not.toThrow();
    expect(Number.isFinite(result.before)).toBe(true);
    expect(Number.isFinite(result.after)).toBe(true);
    expect(result.scored).toBeGreaterThanOrEqual(0);
    // isOutOfSampleWin is present and a boolean.
    expect(typeof result.isOutOfSampleWin).toBe('boolean');
  });

  it('computes before/after on the held-out validation portion', async () => {
    const cards = syntheticDeck();
    const result = await optimiseParameters(cards, bindingDeps);

    // The metrics should reflect the validation split: scored <= total - train_count
    const allSeqs = reviewSequences(cards);
    const totalNonFirst = countReviews(cards) - cards.length;
    const trainSplit = chronologicallySplitSequences(allSeqs, 0.8);
    const trainNonFirst =
      trainSplit.trainSequences.reduce((s, seq) => s + seq.grades.length, 0) -
      trainSplit.trainSequences.filter((seq) => seq.grades.length > 0).length;
    expect(result.scored).toBeLessThanOrEqual(totalNonFirst - trainNonFirst);
  });

  it('rejects out-of-range trainer output', async () => {
    const badCompute: typeof computeParameters = async () => {
      const w = [...default_w];
      w[0] = 999;
      return w;
    };
    await expect(
      optimiseParameters(syntheticDeck(), {
        ...bindingDeps,
        computeParameters: badCompute,
      }),
    ).rejects.toThrow(/outside FSRS valid ranges/);
  });

  it('forwards trainer progress callbacks as fractions from 0 to 1', async () => {
    const seen: number[] = [];
    const mockCompute: typeof computeParameters = async (_items, options) => {
      options?.progress?.(1, 4);
      options?.progress?.(2, 4);
      options?.progress?.(4, 4);
      return [...default_w];
    };
    await optimiseParameters(syntheticDeck(), {
      computeParameters: mockCompute,
      createItem: bindingDeps.createItem,
      onProgress: (f) => seen.push(f),
    });
    expect(seen).toEqual([0.25, 0.5, 1]);
  });
});
