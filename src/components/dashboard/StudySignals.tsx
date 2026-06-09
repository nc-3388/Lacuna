import { useEffect, useMemo, useRef, useState } from 'react';
import { m as motion, AnimatePresence } from 'motion/react';
import type { StudyStats, DayForecast } from '../../fsrs/stats';
import type { Deck } from '../../db/types';
import { FlameIcon, CalendarIcon, SparklesIcon } from '../ui/icons';
import { cn } from '../ui/cn';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';

/** A simple spring-driven count-up hook that animates a number from 0 to target. */
function useCountUp(target: number, durationMs = 1200, delayMs = 0) {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    setValue(0);
    startTime.current = null;
    const delayId = window.setTimeout(() => {
      const tick = (now: number) => {
        if (startTime.current === null) startTime.current = now;
        const elapsed = now - startTime.current;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = Math.round(eased * target);
        setValue((prev) => (next !== prev ? next : prev));
        if (progress < 1) {
          raf.current = requestAnimationFrame(tick);
        }
      };
      raf.current = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      window.clearTimeout(delayId);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, durationMs, delayMs]);

  return value;
}

/** A thin horizontal animated bar used for streak and reviewed-today metrics. */
function MetricBar({
  value,
  max,
  colourClass,
  title,
  motionMultiplier,
}: {
  value: number;
  max: number;
  colourClass: string;
  title: string;
  motionMultiplier?: number;
}) {
  const m = motionMultiplier ?? 1;
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div
      className="mt-1.5 h-1.5 w-full rounded-full bg-ink/5 overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.min(value, max)}
      aria-valuemax={max}
      aria-label={title}
      title={title}
    >        <motion.div
        key={value}
        className={cn('h-full rounded-full', colourClass)}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6 * m, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

/** Round minutes to a friendly label: "—", "<1 min", "12 min". */
function minutesLabel(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 1) return '<1 min';
  return `${Math.round(minutes)} min`;
}

/** Short weekday for a day, with today and tomorrow named. */
function dayLabel(dayStart: number, index: number): string {
  if (index === 0) return 'Today';
  return new Date(dayStart).toLocaleDateString('en-GB', { weekday: 'short' });
}

interface StudySignalsProps {
  stats: StudyStats;
  decks?: Deck[];
}

/**
 * The dashboard's motivation strip: a study streak, today's review count, and a seven-day
 * forecast of how many *minutes* of study lie ahead (estimated from each deck's measured
 * pace). All values are read-only aggregates over data already stored.
 */
export function StudySignals({ stats, decks }: StudySignalsProps) {
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const { streak, reviewedToday, forecast } = stats;
  const totalMinutes = forecast.reduce((sum, d) => sum + d.minutes, 0);
  const totalCards = forecast.reduce((sum, d) => sum + d.dueCount + d.newCount, 0);
  const maxMinutes = Math.max(1, ...forecast.map((d) => d.minutes));
  const lit = streak > 0;

  // Count-up numbers for a satisfying entrance animation.
  const countStreak = useCountUp(streak, 1000, 300);
  const countReviewed = useCountUp(reviewedToday, 1000, 450);

  // Milestone celebration: subtle sparkles when streak hits a notable number.
  const milestone = streak > 0 && (streak === 7 || streak === 14 || streak === 30 || streak === 60 || streak === 100);
  const [showMilestone, setShowMilestone] = useState(false);
  useEffect(() => {
    if (milestone) {
      setShowMilestone(true);
      const id = window.setTimeout(() => setShowMilestone(false), 2500);
      return () => window.clearTimeout(id);
    }
  }, [milestone]);

  // Detail panel defaults to the first day with cards so touch users always see something useful.
  const firstBusyDay = forecast.findIndex((d) => d.dueCount + d.newCount > 0);
  const defaultDetail = firstBusyDay >= 0 ? firstBusyDay : 0;
  const [detailDay, setDetailDay] = useState<number>(defaultDetail);

  const resetDetail = () => setDetailDay(defaultDetail);

  const deckMap = useMemo(() => {
    const map = new Map<string, Deck>();
    for (const d of decks ?? []) map.set(d.id, d);
    return map;
  }, [decks]);

  const allClear = totalCards === 0;

  // Find the busiest day for the insight line.
  const busiestIndex = useMemo(() => {
    if (allClear) return -1;
    let max = 0;
    let idx = 0;
    forecast.forEach((d, i) => {
      const total = d.dueCount + d.newCount;
      if (total > max) {
        max = total;
        idx = i;
      }
    });
    return idx;
  }, [forecast, allClear]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 * m }}
      className="mb-6 grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-[180px_1fr] sm:items-stretch"
    >      {/* Left column: streak + reviewed today */}
      <div className="flex flex-col justify-center gap-5 sm:pr-5">
        {/* Streak */}
        <div>
          <div className="flex items-center gap-2">
            <motion.span
              className={cn(
                'relative grid h-9 w-9 shrink-0 place-items-center rounded-full',
                lit ? 'bg-accent-soft text-accent' : 'bg-ink/5 text-ink-faint',
              )}
              animate={
                lit
                  ? { scale: [1, 1.08, 1], rotate: [0, -3, 3, 0] }
                  : { scale: 1, rotate: 0 }
              }
              transition={lit ? { duration: 2.0 * m, repeat: Infinity, ease: 'easeInOut' } : undefined}
            >
              <FlameIcon width={18} height={18} />
              <AnimatePresence>
                {showMilestone && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                    className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-positive text-positive"
                  >
                    <SparklesIcon width={10} height={10} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.span>
            <div className="flex items-baseline gap-1">
              <motion.span
                key={streak}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                className="font-display text-xl tabular leading-none"
              >
                {countStreak}
              </motion.span>
              <span className="text-xs text-ink-soft">day{streak === 1 ? '' : 's'}</span>
            </div>
          </div>
          <MetricBar value={streak} max={14} colourClass="bg-amber-400/60" title={`${streak} day streak`} motionMultiplier={m} />
          <div className="mt-1 text-[11px] text-ink-faint">study streak</div>
          <AnimatePresence>
            {showMilestone && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.3 * m, delay: 0.1 * m }}
                className="mt-1 text-[11px] font-medium text-positive"
              >
                {streak} day milestone reached
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Reviewed today */}
        <div>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-xl tabular leading-none">{countReviewed}</span>
            <span className="text-xs text-ink-soft">card{reviewedToday === 1 ? '' : 's'}</span>
          </div>
          <MetricBar value={reviewedToday} max={100} colourClass="bg-accent/50" title={`${reviewedToday} cards reviewed today`} motionMultiplier={m} />
          <div className="mt-1 text-[11px] text-ink-faint">reviewed today</div>
        </div>
      </div>

      {/* Seven-day time forecast */}
      <div className="sm:border-l sm:border-line sm:pl-5" onMouseLeave={resetDetail}>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">
            Next 7 days
          </span>
          <span className="text-xs text-ink-soft">
            {allClear
              ? 'all clear'
              : `${totalCards} card${totalCards === 1 ? '' : 's'} · ${Math.round(totalMinutes)} min`}
          </span>
        </div>

        {allClear ? (
          <EmptyForecast motionMultiplier={m} />
        ) : (
          <>
            <div className="flex h-20 items-end gap-1.5">
              {forecast.map((day, i) => {
                const isToday = i === 0;
                const isActive = detailDay === i;
                const dayTotal = day.dueCount + day.newCount;
                const heightPct = Math.max(
                  day.minutes > 0 ? 10 : 3,
                  (day.minutes / maxMinutes) * 100,
                );

                return (
                  <div key={day.dayStart} className="flex flex-1 flex-col items-center">
                <div
                  className="group flex flex-col items-center gap-1 py-3 px-1 w-full cursor-default"
                  onMouseEnter={() => setDetailDay(i)}
                >
                      {/* Card count label */}
                    <AnimatePresence>
                      {dayTotal > 0 && (
                        <motion.span
                          key={day.dayStart}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.2 * m, delay: (0.1 + i * 0.04) * m }}
                          className={cn(
                            'text-[10px] tabular font-medium transition-colors',
                            isToday ? 'text-accent' : 'text-ink-soft',
                            isActive && 'text-ink',
                          )}
                        >
                          {dayTotal}
                        </motion.span>
                      )}
                    </AnimatePresence>

                    {/* Stacked bar */}
                    <div
                      className="flex w-full flex-1 items-end"
                      title={`${minutesLabel(day.minutes)} · ${day.dueCount} due${day.newCount > 0 ? ` · ${day.newCount} new` : ''}`}
                    >
                      {day.byDeck.length === 0 ? (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${heightPct}%` }}
                          transition={{
                            duration: 0.5 * m,
                            delay: (0.1 + i * 0.06) * m,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                          className="w-full rounded-md bg-ink/10"
                        />
                      ) : (
                        <div className="flex w-full flex-col-reverse rounded-md overflow-hidden">
                          {[...day.byDeck]
                            .sort((a, b) => a.deckId.localeCompare(b.deckId))
                            .map((slice, si) => {
                            const deck = deckMap.get(slice.deckId);
                            const colour = deck?.colour;
                            const sliceHeight = (slice.minutes / maxMinutes) * 100;
                            const pct = Math.max(sliceHeight, 1);

                            return (
                              <motion.div
                                key={slice.deckId}
                                initial={{ height: 0 }}
                                animate={{ height: `${pct}%` }}
                                transition={{
                                  duration: 0.5 * m,
                                  delay: (0.1 + i * 0.06 + si * 0.03) * m,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                                className={cn('w-full', !colour && 'bg-accent/70')}
                                style={colour ? { backgroundColor: colour, opacity: 0.7 } : undefined}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Day label */}
                      <span
                        className={cn(
                          'text-[10px] transition-colors',
                          isToday ? 'text-accent font-medium' : 'text-ink-faint',
                          isActive && 'text-ink',
                        )}
                      >
                        {dayLabel(day.dayStart, i)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Insight line */}
            <div className="mt-2 text-[11px] text-ink-faint">
              {busiestIndex >= 0 && (
                <span>
                  Busiest day:{' '}
                  <span className="font-medium text-ink-soft">
                    {dayLabel(forecast[busiestIndex].dayStart, busiestIndex)}
                  </span>{' '}
                  · {forecast[busiestIndex].dueCount + forecast[busiestIndex].newCount} card
                  {forecast[busiestIndex].dueCount + forecast[busiestIndex].newCount === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {/* Detail panel — always visible, defaults to today so touch users see it */}
            <AnimatePresence mode="popLayout">
              <motion.div
                key={forecast[detailDay].dayStart}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 * m, ease: [0.4, 0, 0.2, 1] }}
              >
                <DayDetail day={forecast[detailDay]} deckMap={deckMap} index={detailDay} motionMultiplier={m} />
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  );
}

function EmptyForecast({ motionMultiplier }: { motionMultiplier?: number }) {
  const m = motionMultiplier ?? 1;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 * m, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-20 items-center gap-4 rounded-xl border border-dashed border-line-strong bg-accent-soft/20 px-5"
    >
      <motion.div
        initial={{ scale: 0.8, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 * m }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
      >
        <CalendarIcon width={20} height={20} />
      </motion.div>
      <div>
        <p className="text-sm font-medium text-ink-soft">Nothing due this week</p>
        <p className="text-[11px] text-ink-faint">
          You are all caught up. Enjoy the calm before your next batch of reviews.
        </p>
      </div>
    </motion.div>
  );
}

function DayDetail({
  day,
  deckMap,
  index,
  motionMultiplier,
}: {
  day: DayForecast;
  deckMap: Map<string, Deck>;
  index: number;
  motionMultiplier?: number;
}) {
  const m = motionMultiplier ?? 1;
  const label = dayLabel(day.dayStart, index);
  const total = day.dueCount + day.newCount;

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface/80 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium text-ink">{label}</span>
        <span className="text-[11px] text-ink-soft">
          {total} card{total === 1 ? '' : 's'} · {minutesLabel(day.minutes)}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {day.byDeck
          .filter((d) => d.dueCount > 0 || d.newCount > 0)
          .sort((a, b) => b.dueCount + b.newCount - (a.dueCount + a.newCount))
          .map((slice, si) => {
            const deck = deckMap.get(slice.deckId);
            const colour = deck?.colour;
            const sliceTotal = slice.dueCount + slice.newCount;
            const barPct = total > 0 ? (sliceTotal / total) * 100 : 0;
            return (
              <div key={slice.deckId} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn('h-2 w-2 shrink-0 rounded-full', !colour && 'bg-accent')}
                    style={colour ? { backgroundColor: colour } : undefined}
                  />
                  <span className="flex-1 text-xs text-ink-soft truncate">
                    {deck?.name ?? 'Unknown deck'}
                  </span>
                  <span className="text-[11px] tabular text-ink-faint">
                    {sliceTotal}
                    {slice.newCount > 0 && (
                      <span className="ml-0.5 text-accent">({slice.newCount} new)</span>
                    )}
                  </span>
                </div>
                {/* Deck proportion bar */}
                <div className="h-1 w-full rounded-full bg-ink/5 overflow-hidden">
                  <motion.div
                    key={`${slice.deckId}-${sliceTotal}`}
                    className={cn('h-full rounded-full', !colour && 'bg-accent/60')}
                    style={colour ? { backgroundColor: colour, opacity: 0.6 } : undefined}
                    initial={{ width: 0 }}
                    animate={{ width: `${barPct}%` }}
                    transition={{
                      duration: 0.5 * m,
                      delay: (0.08 + si * 0.04) * m,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
