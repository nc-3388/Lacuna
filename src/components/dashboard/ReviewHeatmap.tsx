import { useMemo } from 'react';
import { motion } from 'motion/react';
import { bucketReviewsByDay, reviewTimestamps } from '../../fsrs/heatmap';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
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
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const { columns, total, max } = useMemo(() => {
    const buckets = bucketReviewsByDay(reviewTimestamps(cards));
    const today = startOfDay(Date.now());
    // Monday-indexed weekday so weeks read left-to-right, Monday at the top.
    const weekday = (new Date(today).getDay() + 6) % 7;
    // DST-safe: use date arithmetic instead of raw ms subtraction.
    const gridEnd = (() => {
      const d = new Date(today);
      d.setDate(d.getDate() + (6 - weekday));
      return startOfDay(d.getTime());
    })();
    const gridStart = (() => {
      const d = new Date(gridEnd);
      d.setDate(d.getDate() - (WEEKS * 7 - 1));
      return startOfDay(d.getTime());
    })();

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
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 * m, ease: [0.25, 0.1, 0.25, 1] }}
      className="rounded-2xl border border-line bg-surface p-5"
    >
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
            <motion.div
              key={w}
              initial={{ opacity: 0, scaleY: 0.8 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{
                duration: 0.16 * m,
                delay: Math.min(w * 0.015, 0.3) * m,
                ease: [0.25, 0.1, 0.25, 1],
              }}
              className="flex flex-col gap-[3px] origin-top"
            >
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
            </motion.div>
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
    </motion.section>
  );
}
