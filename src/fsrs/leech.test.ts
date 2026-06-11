import { describe, expect, it } from 'vitest';
import { isLeech, DEFAULT_LEECH_LAPSE_THRESHOLD } from './leech';
import type { Card } from '../db/types';

function cardWithLapses(lapses: number): Card {
  return {
    id: 'c1',
    deckId: 'd1',
    type: 'front_back',
    front: 'q',
    back: 'a',
    stability: 1,
    difficulty: 5,
    lastReviewed: Date.now(),
    reps: lapses,
    lapses,
    state: 2,
    due: Date.now(),
    scheduledDays: 1,
    learningSteps: 0,
    history: [],
    createdAt: Date.now(),
  };
}

describe('isLeech', () => {
  it('is false below the threshold', () => {
    expect(isLeech(cardWithLapses(DEFAULT_LEECH_LAPSE_THRESHOLD - 1))).toBe(false);
  });

  it('is true at and above the threshold', () => {
    expect(isLeech(cardWithLapses(DEFAULT_LEECH_LAPSE_THRESHOLD))).toBe(true);
    expect(isLeech(cardWithLapses(DEFAULT_LEECH_LAPSE_THRESHOLD + 5))).toBe(true);
  });
});
