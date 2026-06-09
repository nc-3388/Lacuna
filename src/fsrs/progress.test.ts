import { describe, it, expect } from 'vitest';
import {
  deckDecay,
  predictedExamRetrievability,
  masteryFraction,
  averagePredictedRetrievability,
} from './progress';
import { defaultFsrsParameters, MS_PER_DAY } from './params';
import type { Card, Deck } from '../db/types';

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Deck',
    examDate: 7 * MS_PER_DAY,
    createdAt: 0,
    fsrsVersion: 6,
    fsrsParameters: defaultFsrsParameters(),
    examObjective: 'expectedMarks',
    ...overrides,
  };
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    deckId: 'd1',
    type: 'front_back',
    front: 'q',
    back: 'a',
    stability: null,
    difficulty: null,
    lastReviewed: null,
    reps: 0,
    lapses: 0,
    state: 0,
    due: null,
    scheduledDays: 0,
    learningSteps: 0,
    history: [],
    createdAt: 0,
    ...overrides,
  };
}

describe('deckDecay', () => {
  it('returns the negative of w20', () => {
    const deck = makeDeck();
    expect(deckDecay(deck)).toBe(-deck.fsrsParameters.w[20]);
  });
});

describe('predictedExamRetrievability', () => {
  it('is 0 for a never-reviewed card', () => {
    const deck = makeDeck({ examDate: 10 * MS_PER_DAY });
    const card = makeCard();
    expect(predictedExamRetrievability(card, deck, 0)).toBe(0);
  });

  it('equals 0.90 when the exam is exactly one stability-length away', () => {
    const S = 7;
    const deck = makeDeck({ examDate: S * MS_PER_DAY });
    const card = makeCard({ stability: S, difficulty: 5, lastReviewed: 0, state: 2, reps: 1 });
    expect(predictedExamRetrievability(card, deck, 0)).toBeCloseTo(0.9, 12);
  });
});

describe('masteryFraction', () => {
  it('returns 1 for an empty deck', () => {
    expect(masteryFraction([], makeDeck(), 0)).toBe(1);
  });

  it('counts the fraction of cards at or above 0.90', () => {
    const deck = makeDeck({ examDate: 10 * MS_PER_DAY });
    const cards = [
      makeCard({ stability: 0.5, lastReviewed: 0, state: 2, reps: 1 }), // low
      makeCard({ stability: 100, lastReviewed: 0, state: 2, reps: 1 }), // high
      makeCard({ stability: 50, lastReviewed: 0, state: 2, reps: 1 }), // high
    ];
    expect(masteryFraction(cards, deck, 0)).toBeCloseTo(2 / 3, 10);
  });

  it('treats never-reviewed cards as 0 (not mastered)', () => {
    const deck = makeDeck({ examDate: 10 * MS_PER_DAY });
    const cards = [
      makeCard(), // new
      makeCard({ stability: 100, lastReviewed: 0, state: 2, reps: 1 }), // mastered
    ];
    expect(masteryFraction(cards, deck, 0)).toBeCloseTo(0.5, 10);
  });
});

describe('averagePredictedRetrievability', () => {
  it('returns 1 for an empty deck', () => {
    expect(averagePredictedRetrievability([], makeDeck(), 0)).toBe(1);
  });

  it('returns the mean predicted retrievability across cards', () => {
    const deck = makeDeck({ examDate: 10 * MS_PER_DAY });
    const cards = [
      makeCard({ stability: 0.5, lastReviewed: 0, state: 2, reps: 1 }),
      makeCard({ stability: 100, lastReviewed: 0, state: 2, reps: 1 }),
    ];
    const avg = averagePredictedRetrievability(cards, deck, 0);
    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThan(1);
    // The high-stability card dominates, so average should be > 0.5.
    expect(avg).toBeGreaterThan(0.5);
  });

  it('includes never-reviewed cards as 0 in the mean', () => {
    const deck = makeDeck({ examDate: 10 * MS_PER_DAY });
    const cards = [
      makeCard(), // 0
      makeCard({ stability: 100, lastReviewed: 0, state: 2, reps: 1 }), // ~1
    ];
    expect(averagePredictedRetrievability(cards, deck, 0)).toBeCloseTo(0.5, 1);
  });
});
