import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDecks, useAllCards, useAllSessionHistory } from '../state/useData';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';
import { ChartCard } from '../components/analytics/ChartCard';
import { useChartColours } from '../components/analytics/useChartColours';
import {
  forecastSeries,
  studyTimeSeries,
  retentionByAge,
  leechCountByDeck,
  reviewVolume,
  stabilityProfile,
  trajectorySeries,
} from '../components/analytics/prepare';
import { predictionAccuracySeries } from '../fsrs/calibration';

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-ink/5" />
        <div className="h-5 w-64 animate-pulse rounded-lg bg-ink/5" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-4 space-y-2">
              <div className="h-7 w-32 animate-pulse rounded-lg bg-ink/5" />
              <div className="h-4 w-72 animate-pulse rounded-lg bg-ink/5" />
            </div>
            <div className="h-56 animate-pulse rounded-lg bg-ink/5" />
          </div>
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-4 space-y-2">
              <div className="h-7 w-36 animate-pulse rounded-lg bg-ink/5" />
              <div className="h-4 w-60 animate-pulse rounded-lg bg-ink/5" />
            </div>
            <div className="h-56 animate-pulse rounded-lg bg-ink/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Analytics() {
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const decks = useDecks();
  const allCards = useAllCards();
  const history = useAllSessionHistory();
  const c = useChartColours();

  const deckMap = useMemo(
    () => new Map((decks ?? []).map((d) => [d.id, d.name])),
    [decks],
  );

  const cards = allCards ?? [];

  const forecast = useMemo(() => forecastSeries(cards), [cards]);
  const studyTime = useMemo(() => studyTimeSeries(cards), [cards]);
  const volume = useMemo(() => reviewVolume(cards), [cards]);
  const retention = useMemo(() => retentionByAge(cards), [cards]);
  const leeches = useMemo(() => leechCountByDeck(cards, deckMap), [cards, deckMap]);
  const profile = useMemo(() => stabilityProfile(cards), [cards]);
  const prediction = useMemo(() => predictionAccuracySeries(cards), [cards]);
  const trajectory = useMemo(() => trajectorySeries(history ?? []), [history]);

  const hasReviews = useMemo(
    () => cards.some((card) => card.history.length > 0),
    [cards],
  );

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

  if (decks === undefined || allCards === undefined || history === undefined) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading analytics">
        <AnalyticsSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 * m, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <h1 className="font-display text-3xl tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Insights across every deck.
        </p>
      </motion.header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Forecast */}
        <div className="lg:col-span-2">
          <ChartCard
            title="Forecast"
            description="Cards due and new cards scheduled per day for the next 30 days."
            empty={cards.length === 0}
            emptyMessage="Add cards to see your forecast."
            delay={0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecast} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="dueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="newFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.positive} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.positive} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={c.line} vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} width={40} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ stroke: c.line }}
                />
                <Area
                  type="monotone"
                  dataKey="due"
                  stackId="1"
                  stroke={c.accent}
                  strokeWidth={2}
                  fill="url(#dueFill)"
                />
                <Area
                  type="monotone"
                  dataKey="newCards"
                  stackId="1"
                  stroke={c.positive}
                  strokeWidth={2}
                  fill="url(#newFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Predicted exam-day score */}
        <ChartCard
          title="Predicted exam-day score"
          description="Average predicted retrievability across all decks over time."
          empty={trajectory.length < 2}
          emptyMessage="Study cards to start plotting your trajectory."
          delay={0.06}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trajectory} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="trajFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={c.line} vertical={false} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis domain={[0, 100]} unit="%" {...axisProps} width={44} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v}%`, 'Predicted']}
                cursor={{ stroke: c.line }}
              />
              <Area
                type="monotone"
                dataKey="retrievability"
                stroke={c.accent}
                strokeWidth={2}
                fill="url(#trajFill)"
                dot={{ r: 2.5, fill: c.accent, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Prediction accuracy */}
        <ChartCard
          title="Prediction accuracy"
          description="Brier score for predicted recall versus actual recall. Lower is better."
          empty={prediction.length === 0}
          emptyMessage="Review cards with existing memory state to measure prediction accuracy."
          delay={0.12}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={prediction} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={c.line} vertical={false} />
              <XAxis dataKey="label" {...axisProps} minTickGap={8} />
              <YAxis yAxisId="score" domain={[0, 1]} {...axisProps} width={40} />
              <YAxis yAxisId="recall" orientation="right" domain={[0, 1]} hide />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ stroke: c.line }}
                formatter={(v: number, name: string) => {
                  if (name === 'brier') return [v.toFixed(3), 'Brier score'];
                  return [`${Math.round(v * 100)}%`, name === 'predicted' ? 'Predicted' : 'Actual'];
                }}
              />
              <Line
                yAxisId="score"
                type="monotone"
                dataKey="brier"
                stroke={c.accent}
                strokeWidth={2}
                dot={{ r: 2.5, fill: c.accent, strokeWidth: 0 }}
              />
              <Line
                yAxisId="recall"
                type="monotone"
                dataKey="predicted"
                stroke={c.inkFaint}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                yAxisId="recall"
                type="monotone"
                dataKey="actual"
                stroke={c.positive}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Review volume */}
        <ChartCard
          title="Review volume"
          description="Reviews completed each day over the past 30 days."
          empty={!hasReviews}
          emptyMessage="Your daily review counts will appear here."
          delay={0.18}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={volume} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={c.line} vertical={false} />
              <XAxis dataKey="label" {...axisProps} interval={6} minTickGap={8} />
              <YAxis allowDecimals={false} {...axisProps} width={32} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: c.line, opacity: 0.4 }}
                formatter={(v: number) => [v, 'Reviews']}
              />
              <Bar dataKey="reviews" fill={c.positive} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Study time */}
        <ChartCard
          title="Study time"
          description="Minutes spent studying each day over the past 30 days."
          empty={!hasReviews}
          emptyMessage="Study time will appear after your first review sessions."
          delay={0.24}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={studyTime} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="timeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={c.line} vertical={false} />
              <XAxis dataKey="label" {...axisProps} interval={6} minTickGap={8} />
              <YAxis allowDecimals={false} {...axisProps} width={40} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v} min`, 'Time']}
                cursor={{ stroke: c.line }}
              />
              <Area
                type="monotone"
                dataKey="minutes"
                stroke={c.accent}
                strokeWidth={2}
                fill="url(#timeFill)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Retention by age */}
        <ChartCard
          title="Retention by age"
          description="Recall rate grouped by how long each card has been in review."
          empty={!hasReviews}
          emptyMessage="Retention data will appear after your first reviews."
          delay={0.30}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={retention} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={c.line} vertical={false} />
              <XAxis dataKey="ageLabel" {...axisProps} interval={0} />
              <YAxis domain={[0, 100]} unit="%" {...axisProps} width={40} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: c.line, opacity: 0.4 }}
                formatter={(v: number) => [`${v}%`, 'Retention']}
              />
              <Bar dataKey="retention" radius={[6, 6, 0, 0]}>
                {retention.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.retention >= 80 ? c.positive : c.accent}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Leech count by deck */}
        <ChartCard
          title="Leech count by deck"
          description="Number of leech cards in each deck."
          empty={leeches.length === 0}
          emptyMessage="No leeches found — great job keeping up with reviews!"
          delay={0.36}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={leeches} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={c.line} vertical={false} />
              <XAxis dataKey="name" {...axisProps} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} {...axisProps} width={32} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: c.line, opacity: 0.4 }}
                formatter={(v: number) => [v, 'Leeches']}
              />
              <Bar dataKey="count" fill={c.accent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Stability profile */}
        <ChartCard
          title="Stability profile"
          description="How many cards fall into each stability range."
          empty={cards.length === 0}
          emptyMessage="Add cards to see their stability profile."
          delay={0.42}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={profile} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={c.line} vertical={false} />
              <XAxis dataKey="range" {...axisProps} interval={0} />
              <YAxis allowDecimals={false} {...axisProps} width={32} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: c.line, opacity: 0.4 }}
                formatter={(v: number) => [v, 'Cards']}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {profile.map((entry, i) => (
                  <Cell key={i} fill={entry.range === 'New' ? c.inkFaint : c.accent} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
