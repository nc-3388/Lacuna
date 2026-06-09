import { describe, expect, it } from 'vitest';
import {
  maxCooldown,
  applyCooldown,
  decrementCooldowns,
  selectNextCard,
  type CooldownMap,
} from './cooldown';
import { makeEngine } from './fsrs';
import { defaultFsrsParameters } from './params';
import type { Card, Deck } from '../db/types';
import type { ObjectiveContext } from './objective';

const NOW = new Date('2026-06-04T10:00:00').getTime();

function makeCard(id: string): Card {
  return {
    id,
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
  };
}

function makeObjectiveContext(objective: 'expectedMarks' | 'securedTopics' = 'expectedMarks'): ObjectiveContext {
  const params = defaultFsrsParameters();
  const engine = makeEngine(params);
  return {
    objective,
    deck: {
      id: 'd1',
      name: 'Test Deck',
      examDate: NOW + 7 * 86_400_000,
      createdAt: NOW,
      fsrsVersion: 6,
      fsrsParameters: params,
      examObjective: objective,
    } as Deck,
    ctx: {
      fsrs: engine,
      decay: -params.w[20],
      expectedGrade: 3,
    },
  };
}

describe('maxCooldown', () => {
  it('returns 5 for decks with 6 or more cards', () => {
    expect(maxCooldown(6)).toBe(5);
    expect(maxCooldown(100)).toBe(5);
  });

  it('scales down for small decks', () => {
    expect(maxCooldown(5)).toBe(4);
    expect(maxCooldown(4)).toBe(3);
    expect(maxCooldown(3)).toBe(2);
    expect(maxCooldown(2)).toBe(1);
    expect(maxCooldown(1)).toBe(0);
    expect(maxCooldown(0)).toBe(0);
  });
});

describe('applyCooldown', () => {
  it('sets the cooldown for a failed card', () => {
    const map: CooldownMap = new Map();
    applyCooldown(map, 'c1', 10);
    expect(map.get('c1')).toBe(5);
  });

  it('overwrites an existing cooldown', () => {
    const map: CooldownMap = new Map();
    map.set('c1', 2);
    applyCooldown(map, 'c1', 10);
    expect(map.get('c1')).toBe(5);
  });
});

describe('decrementCooldowns', () => {
  it('decrements every other card by one', () => {
    const map: CooldownMap = new Map();
    map.set('c1', 5);
    map.set('c2', 3);
    map.set('c3', 1);
    decrementCooldowns(map, 'c1');
    expect(map.get('c1')).toBe(5); // reviewed card keeps its cooldown
    expect(map.get('c2')).toBe(2);
    expect(map.get('c3')).toBeUndefined(); // expired, removed
  });

  it('removes entries that drop to zero', () => {
    const map: CooldownMap = new Map();
    map.set('c1', 1);
    decrementCooldowns(map, 'c2');
    expect(map.has('c1')).toBe(false);
  });

  it('does nothing on an empty map', () => {
    const map: CooldownMap = new Map();
    decrementCooldowns(map, 'c1');
    expect(map.size).toBe(0);
  });
});

describe('selectNextCard', () => {
  it('returns null for an empty card list', () => {
    expect(selectNextCard([], makeObjectiveContext(), new Map(), NOW)).toBeNull();
  });

  it('returns the only card when no cooldowns are active', () => {
    const card = makeCard('c1');
    const next = selectNextCard(
      [card],
      makeObjectiveContext(),
      new Map(),
      NOW,
    );
    expect(next).toBe(card);
  });

  it('skips cards that are on cooldown', () => {
    const c1 = makeCard('c1');
    const c2 = makeCard('c2');
    const map: CooldownMap = new Map();
    map.set('c1', 2);
    const next = selectNextCard(
      [c1, c2],
      makeObjectiveContext(),
      map,
      NOW,
    );
    expect(next).toBe(c2);
  });

  it('serves the soonest-eligible card when all are on cooldown', () => {
    const c1 = makeCard('c1');
    const c2 = makeCard('c2');
    const c3 = makeCard('c3');
    const map: CooldownMap = new Map();
    map.set('c1', 3);
    map.set('c2', 1);
    map.set('c3', 5);
    const next = selectNextCard(
      [c1, c2, c3],
      makeObjectiveContext(),
      map,
      NOW,
    );
    expect(next).toBe(c2);
  });

  it('falls back to the first scored card if no cooldown entries exist', () => {
    const c1 = makeCard('c1');
    const c2 = makeCard('c2');
    const next = selectNextCard(
      [c1, c2],
      makeObjectiveContext(),
      new Map(),
      NOW,
    );
    expect(next).toBe(c1);
  });
});
