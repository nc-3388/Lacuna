import type { Card, Grade, ReviewLog } from '../db/types';
import { startOfDay } from '../utils/datetime';

export interface PredictionAccuracyPoint {
  day: number;
  label: string;
  brier: number;
  predicted: number;
  actual: number;
  reviews: number;
}

export interface GradeQualitySummary {
  totalReviews: number;
  gradeCounts: Record<Grade, number>;
  fasterResponseRecallLift: number | null;
}

function label(day: number): string {
  return new Date(day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function recalled(log: ReviewLog): 0 | 1 {
  return log.grade > 1 ? 1 : 0;
}

/** Brier score by local day: lower means predicted retrievability matched recall better. */
export function predictionAccuracySeries(cards: Card[]): PredictionAccuracyPoint[] {
  const buckets = new Map<
    number,
    { brier: number; predicted: number; actual: number; reviews: number }
  >();

  for (const card of cards) {
    for (const log of card.history) {
      if (log.retrievabilityAtReview === null) continue;
      const day = startOfDay(log.timestamp);
      const actual = recalled(log);
      const predicted = Math.max(0, Math.min(1, log.retrievabilityAtReview));
      const bucket = buckets.get(day) ?? { brier: 0, predicted: 0, actual: 0, reviews: 0 };
      bucket.brier += (predicted - actual) ** 2;
      bucket.predicted += predicted;
      bucket.actual += actual;
      bucket.reviews += 1;
      buckets.set(day, bucket);
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, bucket]) => ({
      day,
      label: label(day),
      brier: Number((bucket.brier / bucket.reviews).toFixed(4)),
      predicted: Number((bucket.predicted / bucket.reviews).toFixed(4)),
      actual: Number((bucket.actual / bucket.reviews).toFixed(4)),
      reviews: bucket.reviews,
    }));
}

/**
 * Developer-facing quality summary for the invisible grader. It reports grade spread
 * and whether the faster half of correct responses had higher next-review recall than
 * the slower half, using only stored histories.
 */
export function gradeQualitySummary(cards: Card[]): GradeQualitySummary {
  const gradeCounts: Record<Grade, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const pairs: { responseTimeSec: number; nextRecall: 0 | 1 }[] = [];
  let totalReviews = 0;

  for (const card of cards) {
    for (let i = 0; i < card.history.length; i += 1) {
      const log = card.history[i];
      if ((log.grade as number) >= 1 && (log.grade as number) <= 4) {
        gradeCounts[log.grade] += 1;
      }
      totalReviews += 1;
      const next = card.history[i + 1];
      if (log.grade > 1 && next) {
        pairs.push({ responseTimeSec: log.responseTimeSec, nextRecall: recalled(next) });
      }
    }
  }

  pairs.sort((a, b) => a.responseTimeSec - b.responseTimeSec);
  const midpoint = Math.floor(pairs.length / 2);
  const faster = pairs.slice(0, midpoint);
  const slower = pairs.slice(midpoint);
  const mean = (xs: { nextRecall: 0 | 1 }[]) =>
    xs.length ? xs.reduce((sum, x) => sum + x.nextRecall, 0) / xs.length : null;
  const fastMean = mean(faster);
  const slowMean = mean(slower);

  return {
    totalReviews,
    gradeCounts,
    fasterResponseRecallLift:
      fastMean === null || slowMean === null ? null : Number((fastMean - slowMean).toFixed(4)),
  };
}
