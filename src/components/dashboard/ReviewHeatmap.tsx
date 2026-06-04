import { useMemo } from 'react';
import { bucketReviewsByDay, reviewTimestamps } from '../../fsrs/heatmap';
import { formatDate, startOfDay } from '../../utils/datetime';
import { MS_PER_DAY } from '../../fsrs/params';
import type { Card } from '../../db/types';

/** How many weeks of history the calendar shows. */
const WEEKS = 26;
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

interface Cell {
  day: number;
  count: number;
  future: boolean;
}

/**
 * A contribution-style review calendar (reviews per local day), theme-aware via the
 * accent colour. Built entirely from existing review logs; nothing is persisted.
 */
export function ReviewHeatmap({ cards }: { cards: Card[] }) {
  const { columns, total, max } = useMemo(() => {
    const buckets = bucketReviewsByDay(reviewTimestamps(cards));
    const today = startOfDay(Date.now());
    // Monday-indexed weekday so weeks read left-to-right, Monday at the top.
    const weekday = (new Date(today).getDay() + 6) % 7;
    const gridEnd = today + (6 - weekday) * MS_PER_DAY; // Sunday of the current week
    const gridStart = gridEnd - (WEEKS * 7 - 1) * MS_PER_DAY;

    const cols: Cell[][] = [];
    let maxCount = 0;
    let sum = 0;
    for (let w = 0; w < WEEKS; w += 1) {
      const col: Cell[] = [];
      for (let d = 0; d < 7; d += 1) {
        const day = gridStart + (w * 7 + d) * MS_PER_DAY;
        const count = buckets.get(day) ?? 0;
        maxCount = Math.max(maxCount, count);
        sum += count;
        col.push({ day, count, future: day > today });
      }
      cols.push(col);
    }
    return { columns: cols, total: sum, max: maxCount };
  }, [cards]);

  // Five intensity bands, GitHub-style, expressed as accent opacity so they track
  // the chosen accent colour and the light/dark theme automatically.
  function cellStyle(cell: Cell): React.CSSProperties {
    if (cell.future) return { visibility: 'hidden' };
    if (cell.count === 0) return { background: 'hsl(var(--line) / 0.7)' };
    const band = max <= 1 ? 1 : Math.ceil((cell.count / max) * 4);
    const alpha = [0.25, 0.45, 0.65, 0.85, 1][Math.min(band, 4)];
    return { background: `hsl(var(--accent) / ${alpha})` };
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg">Review activity</h2>
        <span className="text-sm text-ink-faint">
          {total} review{total === 1 ? '' : 's'} in the last {WEEKS} weeks
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="flex flex-col gap-[3px] pt-[2px] text-[10px] text-ink-faint">
          {WEEKDAY_LABELS.map((label, i) => (
            <span key={i} className="h-[12px] leading-[12px]">
              {label}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {columns.map((col, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {col.map((cell) => (
                <span
                  key={cell.day}
                  className="h-[12px] w-[12px] rounded-[2px]"
                  style={cellStyle(cell)}
                  title={
                    cell.future
                      ? undefined
                      : `${cell.count} review${cell.count === 1 ? '' : 's'} on ${formatDate(cell.day)}`
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-ink-faint">
        <span>Less</span>
        {[0, 0.25, 0.45, 0.65, 1].map((alpha, i) => (
          <span
            key={i}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{
              background: alpha === 0 ? 'hsl(var(--line) / 0.7)' : `hsl(var(--accent) / ${alpha})`,
            }}
          />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
