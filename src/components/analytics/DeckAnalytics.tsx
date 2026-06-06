import { useEffect, useMemo } from 'react';
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
import { ChartCard } from './ChartCard';
import { useChartColours } from './useChartColours';
import {
  reviewVolume,
  stabilityProfile,
  trajectorySeries,
} from './prepare';
import { gradeQualitySummary, predictionAccuracySeries } from '../../fsrs/calibration';
import type { Card, SessionHistoryEntry } from '../../db/types';

interface DeckAnalyticsProps {
  cards: Card[];
  history: SessionHistoryEntry[];
}

export function DeckAnalytics({ cards, history }: DeckAnalyticsProps) {
  const c = useChartColours();

  const trajectory = useMemo(() => trajectorySeries(history), [history]);
  const profile = useMemo(() => stabilityProfile(cards), [cards]);
  const volume = useMemo(() => reviewVolume(cards), [cards]);
  const predictionAccuracy = useMemo(() => predictionAccuracySeries(cards), [cards]);
  const hasReviews = useMemo(
    () => cards.some((card) => card.history.length > 0),
    [cards],
  );

  useEffect(() => {
    const target = window as typeof window & {
      lacunaGradeQualitySummary?: () => ReturnType<typeof gradeQualitySummary>;
    };
    target.lacunaGradeQualitySummary = () => gradeQualitySummary(cards);
    return () => {
      delete target.lacunaGradeQualitySummary;
    };
  }, [cards]);

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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ChartCard
          title="Predicted exam-day score"
          description="Average predicted retrievability at your exam date, over time."
          empty={trajectory.length < 2}
          emptyMessage="Study this deck to start plotting your trajectory."
          delay={0}
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
      </div>

      <ChartCard
        title="Prediction accuracy"
        description="Brier score for predicted recall versus actual recall. Lower is better."
        empty={predictionAccuracy.length === 0}
        emptyMessage="Review cards with existing memory state to measure prediction accuracy."
        delay={0.08}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={predictionAccuracy}
            margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
          >
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

      <ChartCard
        title="Card stability profile"
        description="How many cards fall into each stability range."
        empty={cards.length === 0}
        emptyMessage="Add cards to see their stability profile."
        delay={0.16}
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

      <ChartCard
        title="Review volume"
        description="Reviews completed each day over the past 30 days."
        empty={!hasReviews}
        emptyMessage="Your daily review counts will appear here."
        delay={0.24}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={volume} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={c.line} vertical={false} />
            <XAxis
              dataKey="label"
              {...axisProps}
              interval={6}
              minTickGap={8}
            />
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
    </div>
  );
}
