import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { m as motion, AnimatePresence } from 'motion/react';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';
import { useChartColours } from '../analytics/useChartColours';
import {
  CheckIcon,
  CardsIcon,
  CloseIcon,
  ClockIcon,
  FlagIcon,
  InfoIcon,
} from '../ui/icons';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
import { cn } from '../ui/cn';
import type { SessionSummary } from './types';

const GRADE_LABELS: Record<number, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

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
        // Ease-out cubic
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

/** Small burst of confetti particles that celebrate a reached goal. */
function ConfettiBurst({ multiplier }: { multiplier: number }) {
  const particles = useMemo(() => {
    const colours = ['#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa', '#f472b6'];
    return Array.from({ length: 30 }).map((_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 500,
      y: -Math.random() * 300 - 100,
      rotation: Math.random() * 720 - 360,
      scale: 0.4 + Math.random() * 0.8,
      colour: colours[i % colours.length],
      delay: Math.random() * 0.25,
      duration: 0.8 + Math.random() * 0.8,
    }));
  }, []);

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32 * multiplier }}
    >
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute left-1/2 top-1/3 h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: p.colour }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
          animate={{
            x: p.x,
            y: p.y,
            opacity: [1, 1, 0],
            scale: p.scale,
            rotate: p.rotation,
          }}
          transition={{
            duration: p.duration * multiplier,
            delay: p.delay * multiplier,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      ))}
    </motion.div>
  );
}

export function SessionReport({
  summary,
  onReturn,
  onContinue,
}: {
  summary: SessionSummary;
  onReturn: () => void;
  /** Offered when the user can keep studying (goal not reached or limit was reached). */
  onContinue?: () => void;
}) {
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const c = useChartColours();
  const { events } = summary;

  const total = events.length;
  const correct = events.filter((e) => e.correct).length;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const distractions = events.filter((e) => e.distracted).length;

  const meanResponse = useMemo(() => {
    const correctEvents = events.filter((e) => e.correct);
    if (correctEvents.length === 0) return 0;
    return (
      correctEvents.reduce((s, e) => s + e.responseTimeSec, 0) / correctEvents.length
    );
  }, [events]);

  const gradeData = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const e of events) counts[e.grade]++;
    return [1, 2, 3, 4].map((g) => ({
      grade: GRADE_LABELS[g],
      count: counts[g],
      g,
    }));
  }, [events]);

  const gradeColour = (g: number) =>
    g === 1 ? c.inkFaint : g === 2 ? c.inkSoft : g === 3 ? c.accent : c.positive;

  const countTotal = useCountUp(total, 1000, 300);
  const countAccuracy = useCountUp(accuracy, 1000, 450);
  const countMean = useCountUp(Math.round(meanResponse * 10), 1000, 600);
  const countFocus = useCountUp(Math.round(summary.focusFraction * 100), 1000, 750);

  // Animate progress bar from before to after over 1.2 seconds.
  const [animatedProgress, setAnimatedProgress] = useState(summary.masteryBefore);
  useEffect(() => {
    const id = window.setTimeout(() => setAnimatedProgress(summary.masteryAfter), 150);
    return () => window.clearTimeout(id);
  }, [summary.masteryAfter]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <AnimatePresence>
        {summary.reachedGoal && <ConfettiBurst key="confetti" multiplier={m} />}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32 * m, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Reaching the goal earns a badge that springs in — the moment worth savouring. */}
        {summary.reachedGoal && (
          <motion.div
            initial={{ scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.15 }}
            className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-positive/15 text-positive"
          >
            <CheckIcon width={28} height={28} />
          </motion.div>
        )}
        <p className="mb-1 text-sm uppercase tracking-[0.18em] text-ink-faint">
          {summary.reachedGoal
            ? 'Goal reached'
            : summary.timeLimitReached
              ? 'Time limit reached'
              : summary.limitReached
                ? 'Daily limit reached'
                : 'Session complete'}
        </p>
        <h1 className="mb-8 font-display text-4xl tracking-tight md:text-5xl">
          {summary.reachedGoal
            ? 'You’ve reached your goal'
            : summary.timeLimitReached
              ? 'Time’s up'
              : summary.limitReached
                ? 'You’ve hit your daily limit'
                : 'Nice work'}
        </h1>
        {summary.limitReached && (
          <p className="mb-6 text-sm text-ink-soft">
            You have reached the daily review limit for this deck. You can continue
            studying if you wish, or come back tomorrow.
          </p>
        )}
        {summary.timeLimitReached && (
          <p className="mb-6 text-sm text-ink-soft">
            You have reached the session time limit for this deck. You can continue
            studying if you wish, or take a break.
          </p>
        )}

        {/* Progress before/after with animated fill */}
        <div className="mb-6 rounded-2xl border border-line bg-surface p-6">
          <div className="mb-3 flex items-center justify-between text-sm text-ink-soft">
            <span className="flex items-center gap-2">
              <FlagIcon width={16} height={16} />
              {summary.objectiveLabel}
            </span>
            <span className="tabular text-ink">
              {Math.round(summary.masteryBefore * 100)}% →{' '}
              <motion.span
                className="font-medium text-accent"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 * m, duration: 0.24 * m }}
              >
                {Math.round(summary.masteryAfter * 100)}%
              </motion.span>
            </span>
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 * m, duration: 0.24 * m }}
          >
            <ProgressBar value={animatedProgress} height={12} />
          </motion.div>
          {/* Delta badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.4 * m, duration: 0.24 * m }}
            className="mt-3 flex items-center gap-2"
          >
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
                summary.masteryAfter >= summary.masteryBefore
                  ? 'bg-positive/10 text-positive'
                  : 'bg-negative/10 text-negative',
              )}
            >
              {summary.masteryAfter >= summary.masteryBefore ? (
                <>
                  <CheckIcon width={12} height={12} />
                  +{Math.round((summary.masteryAfter - summary.masteryBefore) * 100)}%
                </>
              ) : (
                <>
                  <CloseIcon width={12} height={12} />
                  {Math.round((summary.masteryAfter - summary.masteryBefore) * 100)}%
                </>
              )}
            </span>
            <span className="text-xs text-ink-faint">change this session</span>
          </motion.div>
        </div>

        {/* Stat tiles — revealed one after another with count-up numbers and icons. */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            index={0}
            label="Cards reviewed"
            value={String(countTotal)}
            icon={<CardsIcon width={16} height={16} />}
            colour="accent"
            motionMultiplier={m}
          />
          <Stat
            index={1}
            label="Accuracy"
            value={`${countAccuracy}%`}
            icon={<CheckIcon width={16} height={16} />}
            colour="positive"
            motionMultiplier={m}
          />
          <Stat
            index={2}
            label="Mean time"
            value={`${(countMean / 10).toFixed(1)}s`}
            icon={<ClockIcon width={16} height={16} />}
            colour="ink"
            motionMultiplier={m}
          />
          <Stat
            index={3}
            label="Focus"
            value={`${countFocus}%`}
            icon={<InfoIcon width={16} height={16} />}
            colour="ink"
            motionMultiplier={m}
          />
        </div>

        {/* Grade distribution — hidden in simple mode (no meaningful grades). */}
        {!summary.simpleMode && (
          <div className="mb-6 rounded-2xl border border-line bg-surface p-6">
            <h3 className="mb-4 font-display text-xl">How you rated</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gradeData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="grade"
                    stroke={c.inkFaint}
                    tick={{ fill: c.inkFaint, fontSize: 12 }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke={c.inkFaint}
                    tick={{ fill: c.inkFaint, fontSize: 11 }}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: c.line, opacity: 0.4 }}
                    contentStyle={{
                      background: c.surface,
                      border: `1px solid ${c.line}`,
                      borderRadius: 10,
                      color: c.ink,
                      fontSize: 13,
                    }}
                    formatter={(v: number) => [v, 'Cards']}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {gradeData.map((d) => (
                      <Cell key={d.g} fill={gradeColour(d.g)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {distractions > 0 && (
          <p className="mb-6 text-sm text-ink-soft">
            You left the page during{' '}
            <strong className="text-ink">{distractions}</strong> of {total} cards. This
            did not affect your grades, but staying focused keeps the timing accurate.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {onContinue && (
            <Button variant="secondary" size="lg" onClick={onContinue}>
              {summary.limitReached || summary.timeLimitReached ? 'Continue anyway' : 'Keep studying'}
            </Button>
          )}
          <Button variant="primary" size="lg" onClick={onReturn}>
            Back to deck
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function Stat({
  label,
  value,
  index,
  icon,
  colour,
  motionMultiplier,
}: {
  label: string;
  value: string;
  index: number;
  icon: React.ReactNode;
  colour: 'accent' | 'positive' | 'ink';
  motionMultiplier?: number;
}) {
  const m = motionMultiplier ?? 1;
  const colourMap = {
    accent: 'text-accent bg-accent/8',
    positive: 'text-positive bg-positive/8',
    ink: 'text-ink-soft bg-ink/5',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 * m, delay: (0.2 + index * 0.07) * m, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-line bg-surface p-4"
    >
      <div className={cn('mb-2 inline-flex rounded-lg p-1.5', colourMap[colour])}>
        {icon}
      </div>
      <motion.div
        className="font-display text-3xl tabular tracking-tight"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
      >
        {value}
      </motion.div>
      <div className="mt-1 text-xs uppercase tracking-wide text-ink-faint">{label}</div>
    </motion.div>
  );
}
