// Review heatmap data: a contribution-style calendar of reviews per day, built
// from the review logs already stored on each card. Pure and timezone-correct:
// reviews are bucketed by *local* calendar day (via startOfDay), which is what a
// user expects from an Anki-style heatmap.

import { startOfDay } from '../utils/datetime';
import type { Card } from '../db/types';

export interface HeatmapDay {
  /** Local start-of-day epoch for this cell. */
  day: number;
  /** Number of reviews recorded on that local day. */
  count: number;
}

/** Every review timestamp across the given cards (one per logged review). */
export function reviewTimestamps(cards: Card[]): number[] {
  const out: number[] = [];
  for (const card of cards) for (const log of card.history) out.push(log.timestamp);
  return out;
}

/** Count reviews per local calendar day. */
export function bucketReviewsByDay(timestamps: number[]): Map<number, number> {
  const buckets = new Map<number, number>();
  for (const t of timestamps) {
    const day = startOfDay(t);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return buckets;
}

/** DST-safe helper: add/subtract days from a local-midnight epoch. */
function addDays(dayStart: number, days: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + days);
  return startOfDay(d.getTime());
}

/**
 * A contiguous run of daily buckets ending today (oldest first), so the calendar
 * always shows the recent window even on days with no reviews.
 */
export function reviewHeatmap(
  cards: Card[],
  days: number,
  now: number = Date.now(),
): HeatmapDay[] {
  const buckets = bucketReviewsByDay(reviewTimestamps(cards));
  const today = startOfDay(now);
  const out: HeatmapDay[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    out.push({ day, count: buckets.get(day) ?? 0 });
  }
  return out;
}
