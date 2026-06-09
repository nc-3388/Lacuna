import { describe, it, expect } from 'vitest';
import {
  elapsedDays,
  daysUntil,
  defaultExamDate,
  formatDate,
  formatDateTime,
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  startOfDay,
  relativeExam,
} from './datetime';
import { MS_PER_DAY } from '../fsrs/params';

describe('elapsedDays', () => {
  it('returns 0 when to is before from', () => {
    expect(elapsedDays(100, 50)).toBe(0);
  });

  it('returns exact days for whole-day gaps', () => {
    expect(elapsedDays(0, MS_PER_DAY)).toBe(1);
    expect(elapsedDays(0, 7 * MS_PER_DAY)).toBe(7);
  });

  it('returns fractional days for partial gaps', () => {
    expect(elapsedDays(0, MS_PER_DAY / 2)).toBe(0.5);
  });
});

describe('daysUntil', () => {
  it('returns 0 for a past target', () => {
    expect(daysUntil(0, 100)).toBe(0);
  });

  it('returns exact days for future targets', () => {
    expect(daysUntil(7 * MS_PER_DAY, 0)).toBe(7);
  });
});

describe('defaultExamDate', () => {
  it('is exactly 7 days ahead at 23:59 local time', () => {
    const created = new Date(2026, 5, 4, 10, 0, 0).getTime();
    const expected = new Date(2026, 5, 11, 23, 59, 0, 0).getTime();
    expect(defaultExamDate(created)).toBe(expected);
  });
});

describe('formatDate', () => {
  it('produces a British-style date string', () => {
    const ms = new Date(2026, 5, 4).getTime();
    const formatted = formatDate(ms);
    expect(formatted).toContain('4');
    expect(formatted).toContain('June');
    expect(formatted).toContain('2026');
  });
});

describe('formatDateTime', () => {
  it('includes both date and time', () => {
    const ms = new Date(2026, 5, 4, 14, 30).getTime();
    const formatted = formatDateTime(ms);
    expect(formatted).toContain('4');
    expect(formatted).toContain('June');
    expect(formatted).toContain('2026');
    expect(formatted).toContain('14');
    expect(formatted).toContain('30');
  });
});

describe('toDateTimeLocalValue', () => {
  it('round-trips a local datetime through fromDateTimeLocalValue', () => {
    const original = new Date(2026, 5, 4, 14, 30).getTime();
    const value = toDateTimeLocalValue(original);
    const parsed = fromDateTimeLocalValue(value);
    expect(parsed).toBe(original);
  });

  it('formats midnight correctly with zero padding', () => {
    const ms = new Date(2026, 0, 1, 0, 5).getTime();
    expect(toDateTimeLocalValue(ms)).toBe('2026-01-01T00:05');
  });
});

describe('fromDateTimeLocalValue', () => {
  it('returns NaN for malformed input', () => {
    expect(Number.isNaN(fromDateTimeLocalValue(''))).toBe(true);
    expect(Number.isNaN(fromDateTimeLocalValue('hello'))).toBe(true);
    expect(Number.isNaN(fromDateTimeLocalValue('2026-06-04'))).toBe(true);
  });

  it('parses a valid datetime-local string to local epoch', () => {
    const result = fromDateTimeLocalValue('2026-06-04T14:30');
    expect(result).toBe(new Date(2026, 5, 4, 14, 30).getTime());
  });

  it('ignores seconds if present', () => {
    const result = fromDateTimeLocalValue('2026-06-04T14:30:45');
    expect(result).toBe(new Date(2026, 5, 4, 14, 30).getTime());
  });
});

describe('startOfDay', () => {
  it('returns local midnight for any time on the same day', () => {
    const base = new Date(2026, 5, 4, 12, 30, 45).getTime();
    const expected = new Date(2026, 5, 4, 0, 0, 0, 0).getTime();
    expect(startOfDay(base)).toBe(expected);
  });
});

describe('relativeExam', () => {
  it('returns "today" for the same day', () => {
    const now = new Date(2026, 5, 4, 12, 0).getTime();
    expect(relativeExam(now, now)).toBe('today');
  });

  it('returns "tomorrow" for the next day', () => {
    const now = new Date(2026, 5, 4, 12, 0).getTime();
    expect(relativeExam(now + MS_PER_DAY, now)).toBe('tomorrow');
  });

  it('returns "past" for a past date', () => {
    const now = new Date(2026, 5, 4, 12, 0).getTime();
    expect(relativeExam(now - MS_PER_DAY, now)).toBe('past');
  });

  it('returns a day count for dates further out', () => {
    const now = new Date(2026, 5, 4, 12, 0).getTime();
    expect(relativeExam(now + 7 * MS_PER_DAY, now)).toBe('in 7 days');
  });
});
