import { describe, it, expect } from 'vitest';
import { bucketReviewsByDay, reviewHeatmap, reviewTimestamps } from './heatmap';
import { startOfDay } from '../utils/datetime';
import { MS_PER_DAY } from './params';
import type { Card } from '../db/types';

function cardWith(timestamps: number[]): Card {
  return {
    id: 'c',
    deckId: 'd',
    type: 'front_back',
    front: '',
    back: '',
    stability: 1,
    difficulty: 5,
    lastReviewed: timestamps[timestamps.length - 1] ?? null,
    reps: timestamps.length,
    lapses: 0,
    state: 2,
    due: null,
    scheduledDays: 0,
    learningSteps: 0,
    history: timestamps.map((t) => ({
      timestamp: t,
      grade: 3 as const,
      responseTimeSec: 1,
      distracted: false,
      stabilityBefore: null,
      stabilityAfter: 1,
      difficultyBefore: null,
      difficultyAfter: 5,
      retrievabilityAtReview: null,
    })),
    createdAt: 0,
  };
}

describe('review heatmap bucketing', () => {
  it('buckets reviews on the same local day together', () => {
    const morning = new Date(2026, 0, 15, 9, 0).getTime();
    const evening = new Date(2026, 0, 15, 22, 30).getTime();
    const buckets = bucketReviewsByDay([morning, evening]);
    expect(buckets.size).toBe(1);
    expect(buckets.get(startOfDay(morning))).toBe(2);
  });

  it('separates reviews either side of local midnight', () => {
    const lateNight = new Date(2026, 0, 15, 23, 59).getTime();
    const justAfter = new Date(2026, 0, 16, 0, 1).getTime();
    const buckets = bucketReviewsByDay([lateNight, justAfter]);
    expect(buckets.size).toBe(2);
    expect(buckets.get(startOfDay(lateNight))).toBe(1);
    expect(buckets.get(startOfDay(justAfter))).toBe(1);
  });

  it('collects every review timestamp across cards', () => {
    const a = cardWith([1000, 2000]);
    const b = cardWith([3000]);
    expect(reviewTimestamps([a, b]).sort((x, y) => x - y)).toEqual([1000, 2000, 3000]);
  });

  it('produces a contiguous window ending today, with zeros for empty days', () => {
    const now = new Date(2026, 0, 20, 12, 0).getTime();
    const twoDaysAgo = startOfDay(now) - 2 * MS_PER_DAY + 5 * 60 * 1000;
    const series = reviewHeatmap([cardWith([twoDaysAgo, now])], 5, now);
    expect(series).toHaveLength(5);
    expect(series[series.length - 1]).toEqual({ day: startOfDay(now), count: 1 });
    expect(series[2]).toEqual({ day: startOfDay(twoDaysAgo), count: 1 });
    expect(series[0].count).toBe(0);
  });
});
