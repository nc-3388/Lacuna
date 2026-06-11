import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionReport } from './SessionReport';
import type { SessionSummary } from './types';

vi.mock('../../state/motionSpeed', () => ({
  useMotionSpeed: () => ['fast'],
  speedMultiplier: () => 1,
}));

vi.mock('../analytics/useChartColours', () => ({
  useChartColours: () => ({
    accent: 'hsl(220 90% 56%)',
    ink: 'hsl(220 20% 10%)',
    inkSoft: 'hsl(220 10% 50%)',
    inkFaint: 'hsl(220 10% 70%)',
    line: 'hsl(220 10% 90%)',
    positive: 'hsl(150 60% 45%)',
    surface: 'hsl(220 20% 98%)',
  }),
}));

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
}));

const mockSummary: SessionSummary = {
  events: [
    { grade: 3, correct: true, responseTimeSec: 2.5, distracted: false },
    { grade: 1, correct: false, responseTimeSec: 1.0, distracted: false },
    { grade: 4, correct: true, responseTimeSec: 1.8, distracted: false },
  ],
  masteryBefore: 0.4,
  masteryAfter: 0.55,
  objectiveLabel: 'Expected marks',
  focusFraction: 0.95,
  reachedGoal: true,
  limitReached: false,
  timeLimitReached: false,
};

describe('SessionReport', () => {
  it('renders the session report with correct title when goal reached', () => {
    const onReturn = vi.fn();
    render(<SessionReport summary={mockSummary} onReturn={onReturn} />);
    expect(screen.getByText('Goal reached')).toBeInTheDocument();
    expect(screen.getByText('You\u2019ve reached your goal')).toBeInTheDocument();
  });

  it('renders correct stat values', () => {
    render(<SessionReport summary={mockSummary} onReturn={vi.fn()} />);
    expect(screen.getByText('Cards reviewed')).toBeInTheDocument();
    expect(screen.getByText('Accuracy')).toBeInTheDocument();
    expect(screen.getByText('Mean time')).toBeInTheDocument();
    expect(screen.getByText('Focus')).toBeInTheDocument();
  });

  it('shows the progress bar section', () => {
    render(<SessionReport summary={mockSummary} onReturn={vi.fn()} />);
    expect(screen.getByText('Expected marks')).toBeInTheDocument();
    expect(screen.getByText('40% →')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
  });

  it('renders the grade distribution chart', () => {
    render(<SessionReport summary={mockSummary} onReturn={vi.fn()} />);
    expect(screen.getByText('How you rated')).toBeInTheDocument();
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('calls onReturn when Back to deck is clicked', () => {
    const onReturn = vi.fn();
    render(<SessionReport summary={mockSummary} onReturn={onReturn} />);
    fireEvent.click(screen.getByText('Back to deck'));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('shows Continue button when limit is reached', () => {
    const limitSummary: SessionSummary = {
      ...mockSummary,
      reachedGoal: false,
      limitReached: true,
    };
    const onReturn = vi.fn();
    const onContinue = vi.fn();
    render(<SessionReport summary={limitSummary} onReturn={onReturn} onContinue={onContinue} />);
    expect(screen.getByText('You\u2019ve hit your daily limit')).toBeInTheDocument();
    expect(screen.getByText('Continue anyway')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue anyway'));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('shows distraction notice when there were distractions', () => {
    const distractedSummary: SessionSummary = {
      ...mockSummary,
      events: [
        ...mockSummary.events,
        { grade: 3, correct: true, responseTimeSec: 3.0, distracted: true },
      ],
    };
    render(<SessionReport summary={distractedSummary} onReturn={vi.fn()} />);
    expect(screen.getByText(/left the page during/)).toBeInTheDocument();
  });
});
