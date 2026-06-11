import { describe, expect, it } from 'vitest';
import { searchCards } from './search';
import { DEFAULT_LEECH_LAPSE_THRESHOLD } from '../fsrs/leech';
import type { Card, Deck } from './types';

const NOW = 1_000_000_000_000;

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    deckId: 'd1',
    type: 'front_back',
    front: `front ${id}`,
    back: `back ${id}`,
    stability: 1,
    difficulty: 5,
    lastReviewed: NOW - 1000,
    reps: 1,
    lapses: 0,
    state: 2,
    due: NOW + 1000,
    scheduledDays: 1,
    learningSteps: 0,
    history: [],
    createdAt: NOW,
    ...over,
  };
}

const deck: Deck = {
  id: 'd1',
  name: 'Deck one',
  examDate: NOW,
  createdAt: NOW,
  fsrsVersion: 6,
  fsrsParameters: { w: [], requestRetention: 0.9, enable_fuzz: true, maximum_interval: 36500, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] },
  examObjective: 'expectedMarks',
};

describe('searchCards', () => {
  it('returns nothing without a query or filter', () => {
    expect(searchCards('', [card('a')], [deck])).toEqual([]);
  });

  it('still substring-searches when given a query', () => {
    const results = searchCards('front a', [card('a'), card('b')], [deck]);
    expect(results.map((r) => r.card.id)).toEqual(['a']);
  });

  it('lists due cards with an empty query when the due filter is on', () => {
    const cards = [
      card('due', { due: NOW - 1, lastReviewed: NOW - 5000 }),
      card('later', { due: NOW + 100_000 }),
      card('fresh', { due: null, lastReviewed: null }),
    ];
    const results = searchCards('', cards, [deck], { filters: ['due'], now: NOW });
    expect(results.map((r) => r.card.id)).toEqual(['due']);
  });

  it('filters new, leech, flagged and suspended cards', () => {
    const cards = [
      card('new', { lastReviewed: null, due: null }),
      card('leech', { lapses: DEFAULT_LEECH_LAPSE_THRESHOLD }),
      card('flag', { flagged: true }),
      card('susp', { suspended: true }),
      card('plain'),
    ];
    expect(searchCards('', cards, [deck], { filters: ['new'] }).map((r) => r.card.id)).toEqual([
      'new',
    ]);
    expect(
      searchCards('', cards, [deck], { filters: ['leech'] }).map((r) => r.card.id),
    ).toEqual(['leech']);
    expect(
      searchCards('', cards, [deck], { filters: ['flagged'] }).map((r) => r.card.id),
    ).toEqual(['flag']);
    expect(
      searchCards('', cards, [deck], { filters: ['suspended'] }).map((r) => r.card.id),
    ).toEqual(['susp']);
  });

  it('combines multiple filters with AND', () => {
    const cards = [
      card('both', { flagged: true, lapses: DEFAULT_LEECH_LAPSE_THRESHOLD }),
      card('flagOnly', { flagged: true }),
      card('leechOnly', { lapses: DEFAULT_LEECH_LAPSE_THRESHOLD }),
    ];
    const results = searchCards('', cards, [deck], { filters: ['flagged', 'leech'] });
    expect(results.map((r) => r.card.id)).toEqual(['both']);
  });

  it('intersects a text query with active filters', () => {
    const cards = [
      card('a', { flagged: true, front: 'apple' }),
      card('b', { flagged: true, front: 'banana' }),
      card('c', { flagged: false, front: 'apple' }),
    ];
    const results = searchCards('apple', cards, [deck], { filters: ['flagged'] });
    expect(results.map((r) => r.card.id)).toEqual(['a']);
  });
});
