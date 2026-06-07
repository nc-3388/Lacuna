// Pure data-shaping helpers for the analytics charts.

import { startOfDay } from '../../utils/datetime';
import { isLeech } from '../../fsrs/leech';
import type { Card, SessionHistoryEntry } from '../../db/types';

/** DST-safe day offset: add/subtract whole days from a local-midnight epoch. */
function addDays(dayStart: number, days: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + days);
  return startOfDay(d.getTime());
}

export interface TrajectoryPoint {
  day: number;
  label: string;
  retrievability: number;
}

/**
 * Aggregate per-card SessionHistory snapshots into one point per calendar day
 * (the last snapshot of each day), keeping the trajectory line legible.
 */
export function trajectorySeries(history: SessionHistoryEntry[]): TrajectoryPoint[] {
  const lastPerDay = new Map<number, SessionHistoryEntry>();
  for (const entry of history) {
    const day = startOfDay(entry.timestamp);
    const existing = lastPerDay.get(day);
    if (!existing || entry.timestamp >= existing.timestamp) {
      lastPerDay.set(day, entry);
    }
  }
  return [...lastPerDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, entry]) => ({
      day,
      label: new Date(day).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      }),
      retrievability: Number.isFinite(entry.averagePredictedRetrievability)
        ? Math.round(entry.averagePredictedRetrievability * 100)
        : 0,
    }));
}

export interface StabilityBucket {
  range: string;
  count: number;
}

/** Group cards by stability range for the stability profile chart. */
export function stabilityProfile(cards: Card[]): StabilityBucket[] {
  const buckets: StabilityBucket[] = [
    { range: 'New', count: 0 },
    { range: '< 1 day', count: 0 },
    { range: '1–7 days', count: 0 },
    { range: '7–30 days', count: 0 },
    { range: '30+ days', count: 0 },
  ];
  for (const card of cards) {
    const s = card.stability;
    if (s === null || !Number.isFinite(s)) buckets[0].count++;
    else if (s < 1) buckets[1].count++;
    else if (s < 7) buckets[2].count++;
    else if (s < 30) buckets[3].count++;
    else buckets[4].count++;
  }
  return buckets;
}

export interface VolumePoint {
  day: number;
  label: string;
  reviews: number;
}

/** Daily review counts over the past `days` days, drawn from card review logs. */
export function reviewVolume(cards: Card[], days = 30, now = Date.now()): VolumePoint[] {
  const today = startOfDay(now);
  const counts = new Map<number, number>();
  for (const card of cards) {
    for (const log of card.history) {
      const day = startOfDay(log.timestamp);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  const points: VolumePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    points.push({
      day,
      label: new Date(day).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      }),
      reviews: Number.isFinite(counts.get(day) ?? 0) ? (counts.get(day) ?? 0) : 0,
    });
  }
  return points;
}

export interface ForecastPoint {
  day: number;
  label: string;
  due: number;
  newCards: number;
}

/** Cards due per day for the next `days` days (forecast). */
export function forecastSeries(cards: Card[], days = 30, now = Date.now()): ForecastPoint[] {
  const today = startOfDay(now);
  const buckets = new Map<number, { due: number; newCards: number }>();
  for (let i = 0; i < days; i++) {
    buckets.set(addDays(today, i), { due: 0, newCards: 0 });
  }
  for (const card of cards) {
    if (card.suspended) continue;
    if (card.due === null) {
      const bucket = buckets.get(today);
      if (bucket) bucket.newCards++;
    } else {
      const dueDay = startOfDay(card.due);
      const bucket = buckets.get(dueDay);
      if (bucket) bucket.due++;
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, bucket]) => ({
      day,
      label: new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      due: Number.isFinite(bucket.due) ? bucket.due : 0,
      newCards: Number.isFinite(bucket.newCards) ? bucket.newCards : 0,
    }));
}

export interface StudyTimePoint {
  day: number;
  label: string;
  minutes: number;
}

/** Daily study time (minutes) over the past `days` days. */
export function studyTimeSeries(cards: Card[], days = 30, now = Date.now()): StudyTimePoint[] {
  const today = startOfDay(now);
  const counts = new Map<number, number>();
  for (const card of cards) {
    for (const log of card.history) {
      const day = startOfDay(log.timestamp);
      counts.set(day, (counts.get(day) ?? 0) + log.responseTimeSec);
    }
  }
  const points: StudyTimePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const seconds = counts.get(day) ?? 0;
    points.push({
      day,
      label: new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      minutes: Number.isFinite(seconds) ? Math.round(seconds / 60) : 0,
    });
  }
  return points;
}

export interface RetentionByAgePoint {
  ageLabel: string;
  retention: number;
  count: number;
}

/** Retention rate grouped by card age (time since first review). */
export function retentionByAge(cards: Card[], now = Date.now()): RetentionByAgePoint[] {
  const dayMs = 86_400_000;
  const buckets = [
    { label: '0–7 days', min: 0, max: 7, total: 0, recalled: 0 },
    { label: '7–30 days', min: 7, max: 30, total: 0, recalled: 0 },
    { label: '30–90 days', min: 30, max: 90, total: 0, recalled: 0 },
    { label: '90–180 days', min: 90, max: 180, total: 0, recalled: 0 },
    { label: '180+ days', min: 180, max: Infinity, total: 0, recalled: 0 },
  ];
  for (const card of cards) {
    if (card.history.length === 0) continue;
    const firstReview = card.history[0].timestamp;
    const ageDays = Math.floor((now - firstReview) / dayMs);
    const lastLog = card.history[card.history.length - 1];
    const wasRecalled = lastLog.grade > 1;
    for (const bucket of buckets) {
      if (ageDays >= bucket.min && ageDays < bucket.max) {
        bucket.total++;
        if (wasRecalled) bucket.recalled++;
        break;
      }
    }
  }
  return buckets.map((b) => ({
    ageLabel: b.label,
    retention: b.total > 0 ? Math.round((b.recalled / b.total) * 100) : 0,
    count: b.total,
  }));
}

export interface LeechCount {
  name: string;
  count: number;
}

/** Leech counts per deck, sorted descending. */
export function leechCountByDeck(cards: Card[], deckMap: Map<string, string>): LeechCount[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (isLeech(card)) {
      const deckName = deckMap.get(card.deckId) ?? 'Unknown';
      counts.set(deckName, (counts.get(deckName) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
