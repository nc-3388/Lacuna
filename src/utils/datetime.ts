import { MS_PER_DAY } from '../fsrs/params';

/** Elapsed days between two epoch-millisecond instants (fractional, never negative). */
export function elapsedDays(fromMs: number, toMs: number): number {
  return Math.max(toMs - fromMs, 0) / MS_PER_DAY;
}

/** Days from now until a future instant, clamped at zero (past exams read as "today"). */
export function daysUntil(targetMs: number, nowMs: number = Date.now()): number {
  return Math.max(targetMs - nowMs, 0) / MS_PER_DAY;
}

/** Default exam date: creation + 7 days, set to 23:59 local time. */
export function defaultExamDate(createdAtMs: number = Date.now()): number {
  const d = new Date(createdAtMs);
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

/** Format an epoch instant as a British-style date, e.g. "3 June 2026". */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Format an epoch instant as date and time, e.g. "3 June 2026, 23:59". */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Convert an epoch instant to the value expected by <input type="datetime-local">. */
export function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Parse a <input type="datetime-local"> value back to an epoch instant. */
export function fromDateTimeLocalValue(value: string): number {
  return new Date(value).getTime();
}

/** Start-of-day epoch for grouping (local midnight). */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A short relative description of a future exam date, e.g. "in 7 days" or "today". */
export function relativeExam(targetMs: number, nowMs: number = Date.now()): string {
  const targetDay = startOfDay(targetMs);
  const today = startOfDay(nowMs);
  const days = Math.round((targetDay - today) / MS_PER_DAY);
  if (days < 0) return 'past';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
