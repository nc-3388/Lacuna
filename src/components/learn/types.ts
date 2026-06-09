import type { Grade } from '../../db/types';

/** A single answered card within a Learn session, retained for the end report. */
export interface SessionEvent {
  grade: Grade;
  correct: boolean;
  responseTimeSec: number;
  distracted: boolean;
}

/** Aggregated outcome of a Learn session, shown in the report. */
export interface SessionSummary {
  events: SessionEvent[];
  /** Objective-aware progress (0..1) before and after the session. */
  masteryBefore: number;
  masteryAfter: number;
  /** Heading describing what the progress figures mean for this deck's objective. */
  objectiveLabel: string;
  focusFraction: number;
  reachedGoal: boolean;
  /** True when the session ended because the daily review limit was reached. */
  limitReached: boolean;
}
