import { MS_PER_DAY } from '../fsrs/params';

/** The user's current IANA time zone (e.g. 'Europe/London'). */
export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Elapsed days between two epoch-millisecond instants (fractional, never negative). */
export function elapsedDays(fromMs: number, toMs: number): number {
  return Math.max(toMs - fromMs, 0) / MS_PER_DAY;
}

/** Days from now until a future instant, clamped at zero (past exams read as "today"). */
export function daysUntil(targetMs: number, nowMs: number = Date.now()): number {
  return Math.max(targetMs - nowMs, 0) / MS_PER_DAY;
}

/** Default exam date: creation + 7 days, set to 23:59 local time. Returns UTC ms. */
export function defaultExamDate(createdAtMs: number = Date.now()): number {
  const d = new Date(createdAtMs);
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

/** Format an epoch instant as a British-style date in the given time zone. */
export function formatDate(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timeZone ?? getLocalTimeZone(),
  });
}

/** Format an epoch instant as date and time in the given time zone. */
export function formatDateTime(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone ?? getLocalTimeZone(),
  });
}

/** Format just the time portion in the given time zone. */
export function formatTime(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone ?? getLocalTimeZone(),
  });
}

/** Convert an epoch instant to the value expected by <input type="datetime-local">. */
export function toDateTimeLocalValue(ms: number, timeZone?: string): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  // When a specific time zone is provided, we want the datetime-local input to
  // show the time in that zone, not the browser's local zone. We reconstruct
  // the components using the zone-aware formatter.
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).formatToParts(d);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Parse a <input type="datetime-local"> value back to an epoch instant.
 *
 * We manually construct the Date from components rather than passing the raw
 * string to the Date constructor, because browser behaviour for strings like
 * "2026-06-07T23:59" is inconsistent (some parse as local time, some as UTC).
 * This guarantees the value is always interpreted in the user's local timezone.
 *
 * When a `timeZone` is provided, the input is treated as wall-clock time in that
 * zone (e.g. "2026-06-07T23:59" with "America/New_York" means 23:59 in New York).
 */
export function fromDateTimeLocalValue(value: string, timeZone?: string): number {
  const [datePart, timePart] = value.split('T');
  if (!datePart || !timePart) return Number.NaN;

  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').slice(0, 2).map(Number);

  if (
    [year, month, day, hours, minutes].some((n) => Number.isNaN(n))
  ) {
    return Number.NaN;
  }

  if (!timeZone) {
    // Use the constructor with explicit local-time components to avoid
    // day-overflow issues that can happen when mutating an existing Date.
    return new Date(year, month - 1, day, hours, minutes).getTime();
  }

  // Find the UTC ms such that the target time zone shows the given wall-clock time.
  // We start with a naive UTC candidate and iteratively refine.
  const getComponents = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
  };

  let candidate = Date.UTC(year, month - 1, day, hours, minutes);
  const target = { year, month, day, hour: hours, minute: minutes };

  for (let i = 0; i < 5; i++) {
    const c = getComponents(candidate);
    if (c.year === target.year && c.month === target.month && c.day === target.day && c.hour === target.hour && c.minute === target.minute) {
      return candidate;
    }
    const diffMs = (target.hour - c.hour) * 3600000 + (target.minute - c.minute) * 60000;
    const diffDay = (target.year - c.year) * 365 + (target.month - c.month) * 30 + (target.day - c.day);
    candidate += diffMs + diffDay * 86400000;
  }

  return candidate;
}

/** Extract year, month (0-based), day, hours, minutes from an epoch instant in a given time zone. */
export function getComponentsInZone(ms: number, timeZone?: string) {
  if (!timeZone) {
    const d = new Date(ms);
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      hours: d.getHours(),
      minutes: d.getMinutes(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return {
    year: get('year'),
    month: get('month') - 1,
    day: get('day'),
    hours: get('hour'),
    minutes: get('minute'),
  };
}

/** Start-of-day epoch for grouping (midnight in the given time zone). */
export function startOfDay(ms: number, timeZone?: string): number {
  const d = new Date(ms);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone,
    }).formatToParts(d);
    const getPart = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return new Date(getPart('year'), getPart('month') - 1, getPart('day')).getTime();
  }
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A short relative description of a future exam date, e.g. "in 7 days" or "today". */
export function relativeExam(targetMs: number, nowMs: number = Date.now(), timeZone?: string): string {
  const targetDay = startOfDay(targetMs, timeZone);
  const today = startOfDay(nowMs, timeZone);
  const days = Math.round((targetDay - today) / MS_PER_DAY);
  if (days < 0) return 'past';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
