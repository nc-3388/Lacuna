import { describe, expect, it } from 'vitest';
import { isAvailable, studyPool } from './eligibility';
import { MS_PER_DAY } from './params';
import type { Card, Deck, ReviewLog } from '../db/types';

const NOW = new Date('2026-06-04T10:00:00').getTime();

function makeCard(over: Partial<Card> & Pick<Card, 'id'>): Card {
  return {
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
    tags: [],
    suspended: false,
    buriedUntil: null,
    ...over,
  };
}

function review(timestamp: number): ReviewLog {
  return {
    timestamp,
    grade: 3,
    responseTimeSec: 2,
    distracted: false,
    stabilityBefore: null,
    stabilityAfter: 3,
    difficultyBefore: null,
    difficultyAfter: 5,
    retrievabilityAtReview: null,
  };
}

const deck = (newCardsPerDay?: number): Deck => ({
  id: 'd1',
  name: 'Deck',
  examDate: NOW + 30 * MS_PER_DAY,
  createdAt: 0,
  fsrsVersion: 6,
  fsrsParameters: { w: [], requestRetention: 0.9 },
  examObjective: 'expectedMarks',
  newCardsPerDay,
});

describe('isAvailable', () => {
  it('excludes suspended cards', () => {
    expect(isAvailable(makeCard({ id: 'a', suspended: true }), NOW)).toBe(false);
  });

  it('excludes cards buried into the future but includes once the bury has passed', () => {
    expect(isAvailable(makeCard({ id: 'a', buriedUntil: NOW + 1000 }), NOW)).toBe(false);
    expect(isAvailable(makeCard({ id: 'a', buriedUntil: NOW - 1000 }), NOW)).toBe(true);
  });
});

describe('studyPool', () => {
  it('returns all available cards when the cap is unlimited', () => {
    const cards = [makeCard({ id: 'a' }), makeCard({ id: 'b' }), makeCard({ id: 'c' })];
    expect(studyPool(cards, deck(undefined), NOW)).toHaveLength(3);
  });

  it('drops suspended and buried cards from the pool', () => {
    const cards = [
      makeCard({ id: 'a' }),
      makeCard({ id: 'b', suspended: true }),
      makeCard({ id: 'c', buriedUntil: NOW + MS_PER_DAY }),
    ];
    expect(studyPool(cards, deck(undefined), NOW).map((c) => c.id)).toEqual(['a']);
  });

  it('rations new cards to the daily cap, oldest first, keeping review cards', () => {
    const cards = [
      makeCard({ id: 'new1', createdAt: 1 }),
      makeCard({ id: 'new2', createdAt: 2 }),
      makeCard({ id: 'new3', createdAt: 3 }),
      makeCard({ id: 'rev', state: 2, createdAt: 4, lastReviewed: NOW - MS_PER_DAY }),
    ];
    const pool = studyPool(cards, deck(2), NOW).map((c) => c.id);
    expect(pool).toContain('rev'); // review cards are never capped
    expect(pool).toContain('new1');
    expect(pool).toContain('new2');
    expect(pool).not.toContain('new3'); // beyond the 2-new budget
  });

  it('counts new cards already introduced today against the budget', () => {
    const cards = [
      // Started today: counts as one new card already introduced.
      makeCard({ id: 'today', state: 2, createdAt: 1, lastReviewed: NOW, history: [review(NOW)] }),
      makeCard({ id: 'new1', createdAt: 2 }),
      makeCard({ id: 'new2', createdAt: 3 }),
    ];
    const pool = studyPool(cards, deck(2), NOW).map((c) => c.id);
    // Budget 2 minus 1 introduced today = 1 remaining new card.
    expect(pool).toContain('today');
    expect(pool).toContain('new1');
    expect(pool).not.toContain('new2');
  });

  it('does not count cards first reviewed more than 24 hours ago', () => {
    const twoDaysAgo = NOW - 2 * MS_PER_DAY;
    const cards = [
      makeCard({
        id: 'old',
        state: 2,
        createdAt: 1,
        lastReviewed: NOW,
        history: [review(twoDaysAgo)],
      }),
      makeCard({ id: 'new1', createdAt: 2 }),
      makeCard({ id: 'new2', createdAt: 3 }),
    ];
    const pool = studyPool(cards, deck(2), NOW).map((c) => c.id);
    // Nothing introduced in the last 24 hours, so the full budget of 2 new cards is available.
    expect(pool).toContain('new1');
    expect(pool).toContain('new2');
  });
});
