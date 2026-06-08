import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartColours } from '../analytics/useChartColours';
import { forgettingCurve } from '../../fsrs/forwardSim';
import { decayOf } from '../../fsrs/fsrs';
import { MS_PER_DAY } from '../../fsrs/params';
import type { Card, Deck, Grade } from '../../db/types';

interface CardAnalyticsProps {
  card: Card;
  deck: Deck;
  motionMultiplier?: number;
}

export function CardAnalytics({ card, deck, motionMultiplier }: CardAnalyticsProps) {
  const m = motionMultiplier ?? 1;
  const c = useChartColours();
  const now = Date.now();
  const decay = decayOf(deck.fsrsParameters);

  const curveData = useMemo(() => {
    if (card.stability === null || card.lastReviewed === null) return [];
    const start = card.lastReviewed;
    const end = deck.examDate + 14 * MS_PER_DAY;
    const points: { t: number; r: number }[] = [];
    for (let t = start; t <= end; t += MS_PER_DAY) {
      const days = (t - card.lastReviewed) / MS_PER_DAY;
      const r = forgettingCurve(days, card.stability, decay);
      points.push({ t, r: Math.round(r * 100) });
    }
    return points;
  }, [card, deck.examDate, decay]);

  const reviewDots = useMemo(() => {
    const dots: { x: number; y: number; grade: Grade }[] = [];
    for (const log of card.history) {
      const r = log.retrievabilityAtReview ?? 0;
      dots.push({ x: log.timestamp, y: Math.round(r * 100), grade: log.grade });
    }
    return dots;
  }, [card.history]);

  const gradeCounts = useMemo(() => {
    const counts: Record<Grade, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const log of card.history) {
      counts[log.grade] = (counts[log.grade] ?? 0) + 1;
    }
    return counts;
  }, [card.history]);

  const vitalStats = (() => {
    const stats: { label: string; value: string }[] = [];
    if (card.stability !== null) {
      stats.push({ label: 'Stability', value: `${card.stability.toFixed(1)}d` });
    }
    if (card.difficulty !== null) {
      stats.push({ label: 'Difficulty', value: card.difficulty.toFixed(1) });
    }
    if (card.stability !== null && card.lastReviewed !== null) {
      const days = (now - card.lastReviewed) / MS_PER_DAY;
      const r = forgettingCurve(days, card.stability, decay);
      stats.push({ label: 'Current R', value: `${(r * 100).toFixed(0)}%` });
    }
    if (card.stability !== null && card.lastReviewed !== null) {
      const days = Math.max(deck.examDate - card.lastReviewed, 0) / MS_PER_DAY;
      const r = forgettingCurve(days, card.stability, decay);
      stats.push({ label: 'Predicted exam R', value: `${(r * 100).toFixed(0)}%` });
    }
    stats.push({ label: 'Total reviews', value: String(card.reps) });
    stats.push({ label: 'Lapses', value: String(card.lapses) });
    if (card.due !== null) {
      const dueStr = new Date(card.due).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      });
      stats.push({ label: 'Due', value: dueStr });
    }
    if (card.lastReviewed !== null) {
      const days = Math.floor((now - card.lastReviewed) / MS_PER_DAY);
      stats.push({ label: 'Days since review', value: `${days}d` });
    }
    if (card.history.length > 0) {
      const meanTime =
        card.history.reduce((sum, log) => sum + log.responseTimeSec, 0) / card.history.length;
      stats.push({ label: 'Mean response time', value: `${meanTime.toFixed(1)}s` });
      const correct = card.history.filter((log) => log.grade > 1).length;
      stats.push({
        label: 'Accuracy',
        value: `${Math.round((correct / card.history.length) * 100)}%`,
      });
    }
    return stats;
  })();

  const axisProps = {
    stroke: c.inkFaint,
    tick: { fill: c.inkFaint, fontSize: 11 },
    tickLine: false,
  };

  const tooltipStyle = {
    background: c.surface,
    border: `1px solid ${c.line}`,
    borderRadius: 10,
    color: c.ink,
    fontSize: 13,
  } as const;

  const hasData = curveData.length > 0;

  const gradeLabels: Record<Grade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
  const gradeColours: Record<Grade, string> = {
    1: 'hsl(6 62% 48%)',
    2: 'hsl(32 90% 48%)',
    3: c.positive,
    4: c.accent,
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="mb-6">
        <h4 className="mb-2 font-display text-lg tracking-tight">Forgetting curve</h4>
        {hasData ? (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={curveData}
                margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
              >
                <defs>
                  <linearGradient id={`card-traj-${card.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={c.line} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[curveData[0].t, curveData[curveData.length - 1].t]}
                  tickFormatter={(v: number) =>
                    new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  }
                  {...axisProps}
                />
                <YAxis domain={[0, 100]} unit="%" {...axisProps} width={44} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${v}%`, 'Retrievability']}
                  cursor={{ stroke: c.line }}
                />
                <Area
                  type="monotone"
                  dataKey="r"
                  stroke={c.accent}
                  strokeWidth={2}
                  fill={`url(#card-traj-${card.id})`}
                  dot={false}
                />
                <ReferenceLine
                  x={deck.examDate}
                  stroke={c.positive}
                  strokeDasharray="4 4"
                  label={{
                    value: 'Exam',
                    position: 'insideTopLeft',
                    fill: c.positive,
                    fontSize: 11,
                  }}
                />
                {([1, 2, 3, 4] as Grade[]).map((g) => {
                  const dots = reviewDots.filter((d) => d.grade === g);
                  if (dots.length === 0) return null;
                  return (
                    <Scatter
                      key={g}
                      data={dots}
                      fill={gradeColours[g]}
                      shape="circle"
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-ink-faint">
            This card has not been reviewed yet. Study it to see a forgetting curve.
          </p>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {vitalStats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 * m, delay: i * 0.03 * m }}
            className="rounded-xl border border-line bg-surface-raised p-3"
          >
            <div className="text-[11px] uppercase tracking-wide text-ink-faint">{stat.label}</div>
            <div className="mt-1 font-display text-lg tracking-tight">{stat.value}</div>
          </motion.div>
        ))}
      </div>

      {card.history.length > 0 && (
        <div>
          <h4 className="mb-2 font-display text-lg tracking-tight">Grade distribution</h4>
          <div className="flex items-end gap-3">
            {([1, 2, 3, 4] as Grade[]).map((g) => {
              const count = gradeCounts[g];
              const max = Math.max(...Object.values(gradeCounts));
              const maxBarHeight = 80;
              const heightPx = max > 0 ? Math.round((count / max) * maxBarHeight) : 0;
              return (
                <div key={g} className="flex flex-1 flex-col items-center gap-1">
                  <div className="text-xs font-medium text-ink-soft">{count}</div>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: heightPx }}
                    transition={{ duration: 0.28 * m, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full rounded-t-md"
                    style={{ backgroundColor: gradeColours[g] }}
                  />
                  <div className="text-[11px] text-ink-faint">{gradeLabels[g]}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
