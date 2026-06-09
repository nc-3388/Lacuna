import { describe, it, expect } from 'vitest';
import {
  trajectorySeries,
  stabilityProfile,
  reviewVolume,
  forecastSeries,
  studyTimeSeries,
  retentionByAge,
  leechCountByDeck,
} from './prepare';
import type { Card, SessionHistoryEntry } from '../../db/types';

const NOW = new Date(2026, 5, 4, 12, 0, 0).getTime();

function sessionHistory(timestamp: number, avgR: number): SessionHistoryEntry {
  return { timestamp, deckId: 'd1', averagePredictedRetrievability: avgR };
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    deckId: 'd1',
    type: 'front_back',
    front: 'q',
    back: 'a',
    stability: 1,
    difficulty: 5,
    lastReviewed: NOW - 86_400_000,
    reps: 1,
    lapses: 0,
    state: 2,
    due: NOW,
    scheduledDays: 1,
    learningSteps: 0,
    history: [],
    createdAt: NOW,
    ...overrides,
  };
}

describe('trajectorySeries', () => {
  it('keeps only the last snapshot per calendar day', () => {
    const morning = new Date(2026, 5, 1, 9, 0).getTime();
    const evening = new Date(2026, 5, 1, 22, 0).getTime();
    const history: SessionHistoryEntry[] = [
      sessionHistory(morning, 0.5),
      sessionHistory(evening, 0.6),
    ];
    const series = trajectorySeries(history);
    expect(series).toHaveLength(1);
    expect(series[0].retrievability).toBe(60);
  });

  it('sorts days chronologically', () => {
    const history: SessionHistoryEntry[] = [
      sessionHistory(new Date(2026, 5, 3).getTime(), 0.3),
      sessionHistory(new Date(2026, 5, 1).getTime(), 0.5),
      sessionHistory(new Date(2026, 5, 2).getTime(), 0.4),
    ];
    const series = trajectorySeries(history);
    expect(series.map((s) => s.retrievability)).toEqual([50, 40, 30]);
  });

  it('rounds retrievability to whole percentages', () => {
    const history: SessionHistoryEntry[] = [
      sessionHistory(NOW, 0.1234),
    ];
    expect(trajectorySeries(history)[0].retrievability).toBe(12);
  });

  it('returns 0 for non-finite retrievability', () => {
    const history: SessionHistoryEntry[] = [
      { timestamp: NOW, deckId: 'd1', averagePredictedRetrievability: NaN },
    ];
    expect(trajectorySeries(history)[0].retrievability).toBe(0);
  });
});

describe('stabilityProfile', () => {
  it('buckets new cards correctly', () => {
    const cards: Card[] = [
      card({ stability: null }),
      card({ stability: 0.5 }),
      card({ stability: 3 }),
      card({ stability: 15 }),
      card({ stability: 50 }),
    ];
    const buckets = stabilityProfile(cards);
    expect(buckets[0].count).toBe(1); // New
    expect(buckets[1].count).toBe(1); // < 1 day
    expect(buckets[2].count).toBe(1); // 1-7 days
    expect(buckets[3].count).toBe(1); // 7-30 days
    expect(buckets[4].count).toBe(1); // 30+ days
  });

  it('handles an empty card list', () => {
    const buckets = stabilityProfile([]);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('handles invalid stability as new', () => {
    const buckets = stabilityProfile([card({ stability: NaN })]);
    expect(buckets[0].count).toBe(1);
  });
});

describe('reviewVolume', () => {
  it('returns a contiguous window ending today', () => {
    const result = reviewVolume([], 30, NOW);
    expect(result).toHaveLength(30);
    expect(result[result.length - 1].day).toBe(new Date(2026, 5, 4, 0, 0, 0, 0).getTime());
  });

  it('counts reviews per local calendar day', () => {
    const morning = new Date(2026, 5, 3, 9, 0).getTime();
    const evening = new Date(2026, 5, 3, 22, 0).getTime();
    const cards: Card[] = [
      card({
        history: [
          { timestamp: morning, grade: 3, responseTimeSec: 1, distracted: false, stabilityBefore: null, stabilityAfter: 1, difficultyBefore: null, difficultyAfter: 5, retrievabilityAtReview: null },
          { timestamp: evening, grade: 3, responseTimeSec: 1, distracted: false, stabilityBefore: null, stabilityAfter: 1, difficultyBefore: null, difficultyAfter: 5, retrievabilityAtReview: null },
        ],
      }),
    ];
    const result = reviewVolume(cards, 5, NOW);
    const day3 = result.find((p) => p.day === new Date(2026, 5, 3, 0, 0, 0, 0).getTime())!;
    expect(day3.reviews).toBe(2);
  });
});

describe('forecastSeries', () => {
  it('returns one bucket per day for the requested window', () => {
    const result = forecastSeries([], 7, NOW);
    expect(result).toHaveLength(7);
  });

  it('buckets due cards by their due day', () => {
    const cards: Card[] = [
      card({ due: NOW + 86_400_000, suspended: false }),
      card({ due: NOW + 2 * 86_400_000, suspended: false }),
      card({ due: NOW + 86_400_000, suspended: false }),
    ];
    const result = forecastSeries(cards, 7, NOW);
    expect(result[1].due).toBe(2);
    expect(result[2].due).toBe(1);
  });

  it('counts new cards (due === null) as due today', () => {
    const cards: Card[] = [card({ due: null, state: 0 })];
    const result = forecastSeries(cards, 7, NOW);
    expect(result[0].newCards).toBe(1);
    expect(result[0].due).toBe(0);
  });

  it('ignores suspended cards', () => {
    const cards: Card[] = [card({ due: NOW, suspended: true })];
    const result = forecastSeries(cards, 7, NOW);
    expect(result[0].due).toBe(0);
  });
});

describe('studyTimeSeries', () => {
  it('returns a contiguous window', () => {
    const result = studyTimeSeries([], 7, NOW);
    expect(result).toHaveLength(7);
  });

  it('sums response times into minutes per day', () => {
    const day = new Date(2026, 5, 3, 0, 0, 0, 0).getTime();
    const cards: Card[] = [
      card({
        history: [
          { timestamp: day + 1000, grade: 3, responseTimeSec: 120, distracted: false, stabilityBefore: null, stabilityAfter: 1, difficultyBefore: null, difficultyAfter: 5, retrievabilityAtReview: null },
          { timestamp: day + 2000, grade: 3, responseTimeSec: 180, distracted: false, stabilityBefore: null, stabilityAfter: 1, difficultyBefore: null, difficultyAfter: 5, retrievabilityAtReview: null },
        ],
      }),
    ];
    const result = studyTimeSeries(cards, 5, NOW);
    const point = result.find((p) => p.day === day)!;
    expect(point.minutes).toBe(5); // (120 + 180) / 60 = 5
  });
});

describe('retentionByAge', () => {
  it('groups cards by age and computes retention', () => {
    const now = new Date(2026, 5, 4, 12, 0, 0).getTime();
    const cards: Card[] = [
      card({
        history: [
          { timestamp: now - 3 * 86_400_000, grade: 3, responseTimeSec: 1, distracted: false, stabilityBefore: null, stabilityAfter: 1, difficultyBefore: null, difficultyAfter: 5, retrievabilityAtReview: null },
        ],
      }),
      card({
        history: [
          { timestamp: now - 3 * 86_400_000, grade: 1, responseTimeSec: 1, distracted: false, stabilityBefore: null, stabilityAfter: 1, difficultyBefore: null, difficultyAfter: 5, retrievabilityAtReview: null },
        ],
      }),
    ];
    const result = retentionByAge(cards, now);
    const bucket = result.find((b) => b.ageLabel === '0–7 days')!;
    expect(bucket.retention).toBe(50);
    expect(bucket.count).toBe(2);
  });

  it('excludes cards with no history', () => {
    const result = retentionByAge([card({ history: [] })], NOW);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });
});

describe('leechCountByDeck', () => {
  it('counts leeches per deck and sorts descending', () => {
    const cards: Card[] = [
      card({ deckId: 'd1', lapses: 8 }),
      card({ deckId: 'd1', lapses: 8 }),
      card({ deckId: 'd2', lapses: 8 }),
      card({ deckId: 'd2', lapses: 3 }), // not a leech
    ];
    const deckMap = new Map<string, string>([
      ['d1', 'Deck A'],
      ['d2', 'Deck B'],
    ]);
    const result = leechCountByDeck(cards, deckMap);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Deck A', count: 2 });
    expect(result[1]).toEqual({ name: 'Deck B', count: 1 });
  });

  it('returns an empty array when there are no leeches', () => {
    const result = leechCountByDeck([card({ lapses: 0 })], new Map());
    expect(result).toEqual([]);
  });
});
