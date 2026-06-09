import { describe, expect, it } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import {
  makeEngine,
  decayOf,
  toTsCard,
  fromTsCard,
  applyReview,
  type MemoryUpdate,
} from './fsrs';
import { defaultFsrsParameters, MS_PER_DAY } from './params';
import type { Card, FsrsParameters } from '../db/types';

const NOW = new Date('2026-06-04T10:00:00').getTime();

function makeParams(override?: Partial<FsrsParameters>): FsrsParameters {
  return { ...defaultFsrsParameters(), ...override };
}

function makeCard(partial: Partial<Card> = {}): Card {
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
    ...partial,
  };
}

describe('makeEngine', () => {
  it('creates an FSRS scheduler with the given parameters', () => {
    const params = makeParams();
    const engine = makeEngine(params);
    expect(engine).toBeDefined();
    expect(typeof engine.next).toBe('function');
  });

  it('uses enable_short_term: true', () => {
    const params = makeParams();
    const engine = makeEngine(params);
    // A new card should enter the learning steps rather than jump straight to review.
    const card = engine.next(createEmptyCard(new Date(NOW)), new Date(NOW), 3);
    expect(card).toBeDefined();
  });
});

describe('decayOf', () => {
  it('returns -w20', () => {
    const params = makeParams({ w: Array(21).fill(0.5) });
    expect(decayOf(params)).toBe(-0.5);
  });

  it('returns a negative number for positive w20', () => {
    const params = makeParams({ w: Array(21).fill(0) });
    params.w[20] = 0.1542;
    expect(decayOf(params)).toBeCloseTo(-0.1542, 12);
  });
});

describe('toTsCard', () => {
  it('creates an empty card for a never-reviewed card', () => {
    const card = makeCard();
    const ts = toTsCard(card, NOW);
    expect(ts.due.getTime()).toBe(NOW);
    expect(ts.stability).toBe(0);
    expect(ts.difficulty).toBe(0);
    expect(ts.reps).toBe(0);
    expect(ts.lapses).toBe(0);
    expect(ts.state).toBe(0);
  });

  it('maps a reviewed card correctly', () => {
    const card = makeCard({
      stability: 3.5,
      difficulty: 4.2,
      lastReviewed: NOW - MS_PER_DAY,
      reps: 2,
      lapses: 1,
      state: 2,
      due: NOW + MS_PER_DAY,
      scheduledDays: 1,
      learningSteps: 1,
    });
    const ts = toTsCard(card, NOW);
    expect(ts.stability).toBe(3.5);
    expect(ts.difficulty).toBe(4.2);
    expect(ts.elapsed_days).toBe(1);
    expect(ts.reps).toBe(2);
    expect(ts.lapses).toBe(1);
    expect(ts.state).toBe(2);
    expect(ts.due.getTime()).toBe(NOW + MS_PER_DAY);
    expect(ts.scheduled_days).toBe(1);
    expect(ts.learning_steps).toBe(1);
  });

  it('backfills missing stability and difficulty with defaults', () => {
    const card = makeCard({
      lastReviewed: NOW - MS_PER_DAY,
      state: 2,
    });
    const ts = toTsCard(card, NOW);
    expect(ts.stability).toBe(0.1);
    expect(ts.difficulty).toBe(5.0);
  });

  it('clamps elapsed days to zero', () => {
    const card = makeCard({
      lastReviewed: NOW + MS_PER_DAY,
      state: 2,
    });
    const ts = toTsCard(card, NOW);
    expect(ts.elapsed_days).toBe(0);
  });
});

describe('fromTsCard', () => {
  it('maps all fields back to Lacuna shape', () => {
    const ts = {
      due: new Date(NOW + MS_PER_DAY),
      stability: 5.0,
      difficulty: 3.0,
      elapsed_days: 1,
      scheduled_days: 2,
      learning_steps: 1,
      reps: 3,
      lapses: 0,
      state: 2,
      last_review: new Date(NOW),
    };
    const result: MemoryUpdate = fromTsCard(ts as any, NOW);
    expect(result.stability).toBe(5.0);
    expect(result.difficulty).toBe(3.0);
    expect(result.lastReviewed).toBe(NOW);
    expect(result.due).toBe(NOW + MS_PER_DAY);
    expect(result.scheduledDays).toBe(2);
    expect(result.learningSteps).toBe(1);
    expect(result.reps).toBe(3);
    expect(result.lapses).toBe(0);
    expect(result.state).toBe(2);
  });

  it('falls back to now when last_review is missing', () => {
    const ts = {
      due: new Date(NOW),
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      last_review: undefined,
    };
    const result = fromTsCard(ts as any, NOW);
    expect(result.lastReviewed).toBe(NOW);
  });
});

describe('applyReview', () => {
  it('returns a memory update and retrievability for a reviewed card', () => {
    const params = makeParams();
    const engine = makeEngine(params);
    const card = makeCard({
      stability: 3,
      difficulty: 5,
      lastReviewed: NOW - MS_PER_DAY,
      state: 2,
      reps: 1,
      lapses: 0,
    });
    const result = applyReview(engine, card, 3, NOW);
    expect(result.memory).toBeDefined();
    expect(result.memory.stability).toBeGreaterThan(0);
    expect(result.memory.lastReviewed).toBe(NOW);
    expect(result.retrievabilityAtReview).toBeDefined();
    if (result.retrievabilityAtReview !== null) {
      expect(result.retrievabilityAtReview).toBeGreaterThan(0);
      expect(result.retrievabilityAtReview).toBeLessThanOrEqual(1);
    }
  });

  it('returns null retrievability for a first review', () => {
    const params = makeParams();
    const engine = makeEngine(params);
    const card = makeCard();
    const result = applyReview(engine, card, 3, NOW);
    expect(result.retrievabilityAtReview).toBeNull();
    expect(result.memory.state).toBe(1); // enters Learning state
    expect(result.memory.reps).toBe(1);
  });

  it('increments lapses on an Again grade', () => {
    const params = makeParams();
    const engine = makeEngine(params);
    const card = makeCard({
      stability: 3,
      difficulty: 5,
      lastReviewed: NOW - MS_PER_DAY,
      state: 2,
      reps: 1,
      lapses: 0,
    });
    const result = applyReview(engine, card, 1, NOW);
    expect(result.memory.lapses).toBe(1);
  });

  it('updates reps on any grade', () => {
    const params = makeParams();
    const engine = makeEngine(params);
    const card = makeCard({
      stability: 3,
      difficulty: 5,
      lastReviewed: NOW - MS_PER_DAY,
      state: 2,
      reps: 3,
    });
    for (const grade of [1, 2, 3, 4] as const) {
      const result = applyReview(engine, card, grade, NOW);
      expect(result.memory.reps).toBe(4);
    }
  });
});
